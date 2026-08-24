/**
 * Phase 3C -- Adaptive Learning Orchestrator: the single decision
 * authority that answers "what is the best pedagogical intervention for
 * this student now, and why?"
 *
 * This is the IO/loading layer only -- it reads (never writes) from
 * every existing signal source and hands the result to the pure policy
 * in @/lib/adaptive-learning-policy.ts (consolidation, intervention
 * selection, priority ranking). See that file's header for why the
 * split exists, and docs/architecture/phase-3-adaptive-learning-
 * orchestration.md for the full design writeup.
 *
 * ARCHITECTURAL BOUNDARIES (all verified by this file's own tests):
 * - Never assigns MasteryState and never writes concept_knowledge_state.
 *   Phase 2.2's evaluateValidationLifecycle remains the only place that
 *   ever happens -- this service only ever calls getSubjectKnowledgeState
 *   (a pure read of already-persisted rows).
 * - Never ranks/decides inside learning-scheduler.service.ts -- getDueItems
 *   is consumed as-is; no new logic was added there.
 * - Never re-derives an existing algorithm (forgetting risk, Learning
 *   Unlock Value, remediation/diagnosis state machines, evidenceModeForActivity)
 *   -- every one of those is called directly from its own existing service.
 * - No LLM call anywhere in this file or in the policy module.
 * - No new table/migration -- every decision is computed fresh from
 *   current state on every call.
 */

import { db } from '@/lib/db';
import {
  getSubjectKnowledgeState,
  getActiveMasteryPolicy,
  type ConceptKnowledgeState,
} from './knowledge-state.service';
import { getDueItems } from './learning-scheduler.service';
import { getActiveRemediationsWithLabels } from './remediation.service';
import { getActiveDiagnoses } from './cognitive-diagnosis.service';
import { getLearningUnlockValue } from './concept-graph.service';
import { getRecurringMisconceptions } from './misconception.service';
import { getActiveDebts } from './learning-debt.service';
import { getCalibrationConflicts, type CalibrationTag } from './external-assessment.service';
import { getUpcomingForStudent } from './assessment.service';
import { getStudentMastery } from './mastery.service';
import { getIndependentMastery } from './learner-model.service';
import { calculateReviewIntervalDays, calculateForgettingRisk } from '@/lib/algorithms/spaced-repetition';
import { EXAM_SOON_WINDOW_DAYS, FORGETTING_RISK_THRESHOLD } from './today-plan.service';
import {
  consolidateSignals,
  buildLearningDecisions,
  rankLearningDecisions,
  EXAM_CRITICAL_DAYS,
  type LearningSignal,
} from '@/lib/adaptive-learning-policy';

export {
  consolidateSignals,
  buildLearningDecision,
  buildLearningDecisions,
  rankLearningDecisions,
  selectActivityType,
  selectTargetDimension,
  dominantSignal,
  computeTemporalUrgency,
  buildFacts,
} from '@/lib/adaptive-learning-policy';
export type {
  LearningSignal,
  LearningSignalType,
  ConceptDecisionContext,
  LearningDecision,
  TargetDimension,
  PedagogicalPriority,
  LearningFact,
} from '@/lib/adaptive-learning-policy';

/** Same >=20-point mastery-vs-independent-mastery convention already used ad hoc by remediation.service.ts's determineRemediationPattern and cognitive-diagnosis.service.ts's detectCognitiveIssue -- reused here, not reinvented. */
const INDEPENDENCE_GAP_THRESHOLD = 20;

const DATA_QUALITY_ONLY_TAGS = new Set<CalibrationTag>(['LOW_MAPPING_CONFIDENCE', 'COVERAGE_MISMATCH']);

async function getActiveSubjectIds(studentId: string): Promise<string[]> {
  const result = await db.query(`SELECT id FROM subjects WHERE student_id = $1 AND status = 'active'`, [studentId]);
  return result.rows.map((r) => r.id);
}

interface LoadedSignals {
  signals: LearningSignal[];
  knowledgeStateByConceptId: Map<string, ConceptKnowledgeState>;
}

/**
 * Loads every existing signal source read-only and shapes each into a
 * LearningSignal. No consolidation/ranking happens here -- that's the
 * pure policy's job, so it can be unit-tested without any of this IO.
 */
async function loadLearningSignals(studentId: string, preferredLanguage: string): Promise<LoadedSignals> {
  const subjectIds = await getActiveSubjectIds(studentId);

  const knowledgeStateByConceptId = new Map<string, ConceptKnowledgeState>();
  const subjectStates = await Promise.all(subjectIds.map((sid) => getSubjectKnowledgeState(studentId, sid)));
  for (const rows of subjectStates) {
    for (const row of rows) knowledgeStateByConceptId.set(row.conceptId, row);
  }

  const policy = await getActiveMasteryPolicy();

  const [dueItems, activeRemediations, activeDiagnoses, recurringMisconceptions, activeDebts, calibrationConflicts, upcomingExams, masteryRows] =
    await Promise.all([
      getDueItems(studentId),
      getActiveRemediationsWithLabels(studentId).catch(() => []),
      getActiveDiagnoses(studentId).catch(() => []),
      getRecurringMisconceptions(studentId).catch(() => []),
      getActiveDebts(studentId, undefined, preferredLanguage).catch(() => []),
      getCalibrationConflicts(studentId).catch(() => []),
      getUpcomingForStudent(studentId).catch(() => []),
      getStudentMastery(studentId, undefined, preferredLanguage).catch(() => []),
    ]);

  const signals: LearningSignal[] = [];
  const resolveSubjectId = (conceptId: string, fallback?: string | null): string | null =>
    fallback ?? knowledgeStateByConceptId.get(conceptId)?.subjectId ?? null;

  // --- 1. Learning Scheduling Clock (Phase 3 Pre-flight): CONSUMED
  // as-is, never re-derived. EXAM_APPROACHING is excluded here -- it's
  // subject-scoped (no conceptId) on DueItem by design, so it's built
  // separately below directly from the same assessment.service source
  // the Scheduler itself uses.
  for (const item of dueItems) {
    if (item.type === 'EXAM_APPROACHING' || !item.conceptId) continue;
    const subjectId = resolveSubjectId(item.conceptId, item.subjectId);
    if (!subjectId) continue;
    const base = {
      source: 'learning-scheduler.service' as const,
      conceptId: item.conceptId,
      subjectId,
      dueAt: item.dueAt,
      temporalUrgency: item.urgency,
    };
    if (item.type === 'AT_RISK_CONCEPT') signals.push({ ...base, type: 'AT_RISK', metadata: {} });
    else if (item.type === 'INTERVENTION_REQUIRED_CONCEPT') signals.push({ ...base, type: 'INTERVENTION_REQUIRED', metadata: {} });
    else if (item.type === 'VALIDATION_DEADLINE_APPROACHING') signals.push({ ...base, type: 'VALIDATION_DEADLINE_APPROACHING', metadata: {} });
    else if (item.type === 'VALIDATION_DEADLINE_OVERDUE') signals.push({ ...base, type: 'VALIDATION_DEADLINE_OVERDUE', metadata: {} });
    else if (item.type === 'RETENTION_REVIEW_DUE') signals.push({ ...base, type: 'RETENTION_REVIEW_DUE', metadata: {} });
    else if (item.type === 'REMEDIATION_UNFINISHED') {
      signals.push({
        ...base,
        type: 'REMEDIATION_UNFINISHED',
        targetConceptId: item.targetConceptId,
        remediationPathId: item.remediationPathId,
        metadata: {},
      });
    }
  }

  // --- 2. Cognitive Learning Engine: active remediation (genuinely
  // in-progress repair states -- CONFIRMED/REPAIRING/VERIFYING, per
  // remediation.service.ts's own "active" definition, narrower than the
  // Scheduler's REMEDIATION_UNFINISHED above which also includes
  // DETECTED/DIAGNOSING). actionConceptId is always rootCauseConceptId
  // (P0-B contract), targetConceptId preserved as provenance.
  for (const path of activeRemediations) {
    signals.push({
      type: 'REMEDIATION_ACTIVE',
      source: 'remediation.service',
      conceptId: path.rootCauseConceptId,
      subjectId: path.subjectId,
      targetConceptId: path.targetConceptId !== path.rootCauseConceptId ? path.targetConceptId : undefined,
      remediationPathId: path.id,
      diagnosisId: path.diagnosisId ?? undefined,
      metadata: { pattern: path.pattern },
    });
  }

  // --- 3. Cognitive Learning Engine: diagnoses. A CONFIRMED root cause
  // without an active remediation yet becomes PREREQUISITE_GAP; the
  // same diagnosis is never ALSO surfaced as a gap once a repair path
  // exists for it (mirrors today-plan.service.ts's own
  // remediatedDiagnosisIds de-dup, reused here rather than
  // reimplemented differently).
  const remediatedDiagnosisIds = new Set(activeRemediations.map((p) => p.diagnosisId).filter((id): id is string => !!id));
  for (const d of activeDiagnoses) {
    if (d.state === 'CONFIRMED' && !remediatedDiagnosisIds.has(d.id)) {
      const unlock = await getLearningUnlockValue(d.candidateConceptId);
      signals.push({
        type: 'PREREQUISITE_GAP',
        source: 'cognitive-diagnosis.service',
        conceptId: d.candidateConceptId,
        subjectId: d.subjectId,
        targetConceptId: d.targetConceptId !== d.candidateConceptId ? d.targetConceptId : undefined,
        diagnosisId: d.id,
        metadata: { unlockValue: unlock.score, blockedConceptCount: unlock.blockedCount },
      });
    } else if (d.state === 'DIAGNOSIS_REQUIRED') {
      signals.push({
        type: 'DIAGNOSIS_REQUIRED',
        source: 'cognitive-diagnosis.service',
        conceptId: d.candidateConceptId,
        subjectId: d.subjectId,
        targetConceptId: d.targetConceptId !== d.candidateConceptId ? d.targetConceptId : undefined,
        diagnosisId: d.id,
        metadata: {},
      });
    }
  }

  // --- 4. Recurring misconceptions (student-wide, concept-scoped).
  for (const m of recurringMisconceptions) {
    signals.push({
      type: 'RECURRING_MISCONCEPTION',
      source: 'misconception.service',
      conceptId: m.conceptId,
      subjectId: m.subjectId,
      misconceptionCode: m.misconceptionCode,
      metadata: { occurrenceCount: m.occurrenceCount },
    });
  }

  // --- 5. Learning debt (existing debt records/service, not
  // re-derived). Known limitation: getActiveDebts lazily re-resolves
  // debts on read (a pre-existing pattern in learning-debt.service.ts,
  // not introduced here) -- documented in the architecture doc.
  // `mastery` is carried as pure display provenance (Phase 3E's
  // Learning Debt page needs it) -- never used in priority/ranking.
  for (const debt of activeDebts) {
    signals.push({
      type: 'LEARNING_DEBT',
      source: 'learning-debt.service',
      conceptId: debt.conceptId,
      subjectId: debt.subjectId,
      metadata: { severity: debt.severity, mastery: debt.mastery },
    });
  }

  // --- 6. Calibration conflicts (Phase 2.2C). A conflict is treated as
  // actionable only when it carries at least one directional tag beyond
  // the data-quality caveats -- LOW_MAPPING_CONFIDENCE/COVERAGE_MISMATCH
  // alone must never be promoted into a strong knowledge-gap claim.
  for (const conflict of calibrationConflicts) {
    const subjectId = resolveSubjectId(conflict.conceptId);
    if (!subjectId) continue;
    const actionable = conflict.possibleInterpretations.some((tag) => !DATA_QUALITY_ONLY_TAGS.has(tag));
    signals.push({
      type: 'CALIBRATION_CONFLICT',
      source: 'external-assessment.service',
      conceptId: conflict.conceptId,
      subjectId,
      calibrationConflictId: conflict.id,
      metadata: { tags: conflict.possibleInterpretations, actionable, conflictMagnitude: conflict.conflictMagnitude },
    });
  }

  // --- 7. Exam context: built directly from assessment.service (the
  // same source the Scheduler itself uses), fanned out to every
  // already-known concept (has a Knowledge State row) in the matching
  // subject whose topics include it (or the exam has no specific
  // topics, meaning "all") -- mirrors today-plan.service.ts's own
  // inExamWindow check. A concept the student has never been evaluated
  // on at all is out of scope for Phase 3C (nothing to prioritize it
  // against yet); Phase 3D may widen this.
  for (const occurrence of upcomingExams) {
    if (occurrence.daysUntil < 0 || occurrence.daysUntil > EXAM_SOON_WINDOW_DAYS) continue;
    for (const [conceptId, ks] of knowledgeStateByConceptId) {
      if (ks.subjectId !== occurrence.subjectId) continue;
      if (occurrence.topics.length > 0 && !occurrence.topics.includes(conceptId)) continue;
      signals.push({
        type: 'EXAM_APPROACHING',
        source: 'assessment.service',
        conceptId,
        subjectId: occurrence.subjectId,
        occurrenceId: occurrence.id,
        dueAt: occurrence.scheduledDate,
        temporalUrgency: occurrence.daysUntil <= EXAM_CRITICAL_DAYS ? 'CRITICAL' : occurrence.daysUntil <= 5 ? 'HIGH' : 'MEDIUM',
        metadata: { daysUntil: occurrence.daysUntil },
      });
    }
  }

  // --- 8. Knowledge State as CONTEXT (never collapsed into one
  // compensating average -- section 7's mandate): critical
  // misconception, low understanding (against Phase 2.2's own policy
  // threshold, not a re-invented flat number), Retention/Transfer proof
  // required (validationReadiness), independence gap and forgetting
  // risk (Phase 1's existing algorithms, reused verbatim).
  const masteryByConceptId = new Map<string, any>(masteryRows.map((r: any) => [r.concept_id, r]));
  const now = Date.now();

  for (const [conceptId, ks] of knowledgeStateByConceptId) {
    if (ks.criticalMisconceptionCount > 0) {
      signals.push({
        type: 'CRITICAL_MISCONCEPTION',
        source: 'knowledge-state.service',
        conceptId,
        subjectId: ks.subjectId,
        metadata: { criticalMisconceptionCount: ks.criticalMisconceptionCount },
      });
    }

    if (ks.understandingScore !== null && ks.understandingScore < policy.minimumUnderstanding) {
      signals.push({
        type: 'LOW_UNDERSTANDING',
        source: 'knowledge-state.service',
        conceptId,
        subjectId: ks.subjectId,
        metadata: { understandingScore: ks.understandingScore, gap: policy.minimumUnderstanding - ks.understandingScore },
      });
    }

    if (ks.validationReadiness === 'WAITING_FOR_RETENTION') {
      signals.push({ type: 'WAITING_FOR_RETENTION', source: 'knowledge-state.service', conceptId, subjectId: ks.subjectId, metadata: {} });
    }
    if (ks.validationReadiness === 'TRANSFER_REQUIRED') {
      signals.push({ type: 'TRANSFER_REQUIRED', source: 'knowledge-state.service', conceptId, subjectId: ks.subjectId, metadata: {} });
    }

    const masteryRow = masteryByConceptId.get(conceptId);
    if (masteryRow && masteryRow.mastery_score !== null) {
      const masteryScore = Number(masteryRow.mastery_score);
      const independentMastery = await getIndependentMastery(studentId, conceptId);
      if (independentMastery !== null && masteryScore - independentMastery >= INDEPENDENCE_GAP_THRESHOLD) {
        signals.push({
          type: 'INDEPENDENCE_GAP',
          source: 'learner-model.service',
          conceptId,
          subjectId: ks.subjectId,
          metadata: { masteryScore, independentMastery },
        });
      }

      if (masteryRow.last_practiced) {
        const daysSincePractice = Math.floor((now - new Date(masteryRow.last_practiced).getTime()) / (1000 * 60 * 60 * 24));
        const intervalDays = calculateReviewIntervalDays(masteryScore, Number(masteryRow.confidence_score) || 50);
        const forgettingRisk = calculateForgettingRisk(daysSincePractice, intervalDays);
        if (forgettingRisk >= FORGETTING_RISK_THRESHOLD) {
          signals.push({
            type: 'FORGETTING_RISK',
            source: 'lib/algorithms/spaced-repetition',
            conceptId,
            subjectId: ks.subjectId,
            metadata: { forgettingRisk, daysSincePractice },
          });
        }
      }
    }
  }

  return { signals, knowledgeStateByConceptId };
}

/**
 * Every current LearningDecision for a student, ranked highest priority
 * first. Read-only, student-isolated, deterministic, no LLM. Computed
 * fresh on every call -- nothing here is persisted.
 */
export async function getLearningDecisions(studentId: string, preferredLanguage: string = 'en') {
  const { signals, knowledgeStateByConceptId } = await loadLearningSignals(studentId, preferredLanguage);
  const contexts = consolidateSignals(signals, knowledgeStateByConceptId);
  const decisions = buildLearningDecisions(contexts);
  return rankLearningDecisions(decisions);
}

/** The single highest-priority LearningDecision, or null with nothing actionable. */
export async function getBestLearningDecision(studentId: string, preferredLanguage: string = 'en') {
  const decisions = await getLearningDecisions(studentId, preferredLanguage);
  return decisions[0] ?? null;
}
