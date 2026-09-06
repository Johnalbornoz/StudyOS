/**
 * Phase 8 -- Step 8D1: PURE construction of `OrchestrationCandidate[]`
 * from an 8C input snapshot.
 *
 * This is the bridge between "what the canonical engines already
 * decided / measured" and "what temporal opportunities the 8A allocator
 * places". It NEVER ranks a concept, NEVER re-derives Phase 4/5/6/7
 * state, and NEVER calls an AI model. Phase 4's own `priorityScore`,
 * `activityType`, `learningState` are CARRIED verbatim.
 *
 * Sources (8D1.4):
 *   A. Phase 4 LearningDecisions            -> one candidate per decision
 *   B. future retention windows (Phase 6)   -> RETENTION_DUE, earliest = nextReviewAt
 *   C. assessment occurrences (constraint)  -> tightens a hard deadline on A's
 *                                              candidates for covered concepts;
 *                                              a MOCK_EXAM candidate exists ONLY
 *                                              if Phase 4 emitted MOCK_EXAM
 *   D. transfer progression (Phase 7)       -> TRANSFER_PROGRESSION, spaced
 *   E. active remediation (blocker)         -> REMEDIATION_REQUIRED, earliest = today
 *   F. verification                         -> carried by A when Phase 4 emits SOLO_VERIFY
 *   G. curriculum progression               -> CURRICULUM_PROGRESSION (bootstrap), lowest
 *
 * De-dup: a concept that already has a Phase 4 decision never also gets
 * a B / D / G candidate; a concept with a live Phase 4 PREREQUISITE_GAP
 * is dropped from G.
 *
 * PURE. No DB, no AI, no clock -- `horizonStart` / `horizonEnd` are
 * explicit.
 */
import {
  type OrchestrationCandidate,
  type OrchestrationReasonCode,
  type OrchestrationSource,
  candidateEstimatedMinutes,
  addDaysToIsoDate,
} from '@/lib/learning-orchestration-policy';
import { TRANSFER_ROBUST_MIN_SPACING_DAYS } from '@/lib/transfer-policy';
import type { ActivityType } from '@/lib/activity-taxonomy';
import type { LearningDecision } from '@/lib/adaptive-learning-policy';

// A structural subset of the 8C snapshot -- only what the builder needs.
export interface CandidateBuilderInput {
  studentId: string;
  horizonStart: string; // YYYY-MM-DD
  horizonEnd: string; // YYYY-MM-DD

  decisions: readonly LearningDecision[];

  /** conceptId -> nextReviewAt ISO (Phase 6). */
  retentionByConcept: ReadonlyMap<string, { nextReviewAt: string | null; retentionDue: boolean }>;

  /** conceptId -> transfer readiness (Phase 7). */
  transferByConcept: ReadonlyMap<string, { transferDepth: string; transferFragile: boolean; lastSuccessfulTransferAt: string | null }>;

  assessments: ReadonlyArray<{ id: string; subjectId: string; scheduledDate: string; topics: readonly string[] }>;

  activeRemediations: ReadonlyArray<{ remediationPathId: string; rootCauseConceptId: string }>;

  curriculumEligible: ReadonlyArray<{ conceptId: string; subjectId: string }>;

  /** conceptId -> subjectId, for engine-owned candidates whose concept isn't in a Phase 4 decision. */
  conceptSubjectById: ReadonlyMap<string, string>;
}

function isoDatePart(iso: string | null): string | null {
  return iso ? iso.slice(0, 10) : null;
}

/** Map a Phase 4 decision to a Phase 8 (reasonCode, source). Phase 4 keeps WHAT; this only labels the temporal class. */
function classifyPhase4Decision(d: LearningDecision): { reasonCode: OrchestrationReasonCode; source: OrchestrationSource } {
  const primary = d.primarySignal?.type;
  const ls = d.learningState;
  if (d.activityType === 'REMEDIATION' || primary === 'REMEDIATION_ACTIVE' || primary === 'INTERVENTION_REQUIRED' || ls === 'NEEDS_REPAIR') {
    return { reasonCode: 'REMEDIATION_REQUIRED', source: 'REMEDIATION' };
  }
  if (primary === 'CRITICAL_MISCONCEPTION' || primary === 'RECURRING_MISCONCEPTION' || ls === 'MISCONCEPTION_BLOCKED') {
    return { reasonCode: 'MISCONCEPTION_BLOCK', source: 'PHASE4_DECISION' };
  }
  if (primary === 'PREREQUISITE_GAP' || primary === 'DIAGNOSIS_REQUIRED' || ls === 'PREREQUISITE_BLOCKED') {
    return { reasonCode: 'PREREQUISITE_FIRST', source: 'PREREQUISITE' };
  }
  if (primary === 'LEARNING_DEBT') {
    return { reasonCode: 'LEARNING_DEBT', source: 'PHASE4_DECISION' };
  }
  if (d.activityType === 'SOLO_VERIFY' || primary === 'VERIFICATION_PENDING') {
    return { reasonCode: 'VERIFICATION_READY', source: 'PHASE4_DECISION' };
  }
  if (d.activityType === 'RETENTION_CHECK' || ls === 'RETENTION_RISK' || primary === 'RETENTION_REVIEW_DUE' || primary === 'FORGETTING_RISK' || primary === 'WAITING_FOR_RETENTION') {
    return { reasonCode: 'RETENTION_DUE', source: 'PHASE4_DECISION' };
  }
  if (d.activityType === 'TRANSFER' || primary === 'TRANSFER_REQUIRED' || ls === 'TRANSFER_GAP') {
    return { reasonCode: 'TRANSFER_PROGRESSION', source: 'PHASE4_DECISION' };
  }
  if (d.activityType === 'MOCK_EXAM' || d.activityType === 'CUMULATIVE_ASSESSMENT' || primary === 'EXAM_APPROACHING') {
    return { reasonCode: 'ASSESSMENT_APPROACHING', source: 'ASSESSMENT_PREP' };
  }
  return { reasonCode: 'CURRICULUM_PROGRESSION', source: 'PHASE4_DECISION' };
}

export function buildOrchestrationCandidates(input: CandidateBuilderInput): OrchestrationCandidate[] {
  const { studentId, horizonStart, horizonEnd } = input;
  const out: OrchestrationCandidate[] = [];
  const phase4Concepts = new Set(input.decisions.map((d) => d.actionConceptId));
  const phase4PrereqGapConcepts = new Set(
    input.decisions.filter((d) => d.primarySignal?.type === 'PREREQUISITE_GAP').map((d) => d.actionConceptId),
  );

  // --- assessment deadline map: subjectId -> earliest assessment date in horizon (+ its topic set) ---
  const assessmentBySubject = new Map<string, { date: string; topics: Set<string> }>();
  for (const a of input.assessments) {
    if (a.scheduledDate < horizonStart || a.scheduledDate > addDaysToIsoDate(horizonEnd, 3)) continue;
    const prev = assessmentBySubject.get(a.subjectId);
    if (!prev || a.scheduledDate < prev.date) assessmentBySubject.set(a.subjectId, { date: a.scheduledDate, topics: new Set(a.topics) });
  }
  const assessmentDeadlineFor = (subjectId: string, conceptId: string | null): string | null => {
    const a = assessmentBySubject.get(subjectId);
    if (!a) return null;
    if (a.topics.size > 0 && conceptId && !a.topics.has(conceptId)) return null; // covered concepts only
    // learn/practice on or before the exam day itself
    return a.date;
  };

  // --- A. Phase 4 decisions ---
  for (const d of input.decisions) {
    const { reasonCode, source } = classifyPhase4Decision(d);
    const intendedActivityType: ActivityType = d.activityType;
    const conceptId = d.activityType === 'MOCK_EXAM' ? null : d.actionConceptId;
    const p4Deadline = isoDatePart(d.dueAt ?? null);
    const examDeadline = assessmentDeadlineFor(d.subjectId, conceptId);
    const hardDeadline = [p4Deadline, examDeadline].filter((x): x is string => !!x).sort()[0] ?? null;
    out.push({
      studentId,
      subjectId: d.subjectId,
      conceptId,
      intendedActivityType,
      reasonCode,
      source,
      phase4PriorityScore: d.priorityScore,
      hardDeadline,
      earliestDate: null,
      latestDate: null,
      estimatedMinutes: candidateEstimatedMinutes(intendedActivityType),
      candidateKey: `p4:${d.actionConceptId}:${reasonCode}`,
      provenance: {
        sourceType: 'phase4_decision',
        sourceRef: d.actionConceptId,
        facts: { reasonCode: d.reasonCode, learningState: d.learningState, activityType: d.activityType },
      },
    });
  }

  // --- B. future retention windows (Phase 6) -- concept not already in a Phase 4 decision ---
  for (const [conceptId, sig] of input.retentionByConcept) {
    if (phase4Concepts.has(conceptId)) continue;
    const due = isoDatePart(sig.nextReviewAt);
    if (!due || due > horizonEnd) continue; // outside the rolling horizon
    const subjectId = input.conceptSubjectById.get(conceptId);
    if (!subjectId) continue; // cannot form a valid plan item without a subject
    out.push({
      studentId,
      subjectId,
      conceptId,
      intendedActivityType: 'RETENTION_CHECK',
      reasonCode: 'RETENTION_DUE',
      source: 'RETENTION_WINDOW',
      phase4PriorityScore: null,
      hardDeadline: null,
      earliestDate: due, // NEVER before nextReviewAt (allocator clamps a past date to horizonStart)
      latestDate: null,
      estimatedMinutes: candidateEstimatedMinutes('RETENTION_CHECK'),
      candidateKey: `ret:${conceptId}`,
      provenance: { sourceType: 'concept_memory_state', sourceRef: conceptId, facts: { nextReviewAt: sig.nextReviewAt, retentionDue: sig.retentionDue } },
    });
  }

  // --- D. transfer progression (Phase 7) -- NEAR_DEMONSTRATED, not fragile, not already in a Phase 4 decision ---
  for (const [conceptId, sig] of input.transferByConcept) {
    if (phase4Concepts.has(conceptId)) continue;
    if (sig.transferDepth !== 'NEAR_DEMONSTRATED' || sig.transferFragile) continue;
    const subjectId = input.conceptSubjectById.get(conceptId);
    if (!subjectId) continue;
    const lastDate = isoDatePart(sig.lastSuccessfulTransferAt);
    const spacedEarliest = lastDate ? addDaysToIsoDate(lastDate, TRANSFER_ROBUST_MIN_SPACING_DAYS) : addDaysToIsoDate(horizonStart, 2);
    const earliestDate = spacedEarliest > horizonEnd ? null : spacedEarliest;
    if (earliestDate === null) continue; // spacing pushes it past the horizon
    out.push({
      studentId,
      subjectId,
      conceptId,
      intendedActivityType: 'TRANSFER',
      reasonCode: 'TRANSFER_PROGRESSION',
      source: 'TRANSFER_READINESS',
      phase4PriorityScore: null,
      hardDeadline: null,
      earliestDate,
      latestDate: null,
      estimatedMinutes: candidateEstimatedMinutes('TRANSFER'),
      candidateKey: `xfer:${conceptId}`,
      // Phase 8 NEVER manufactures FAR -- /transfer/generate re-authorizes
      // the distance against canonical concept_transfer_state (7E2).
      provenance: { sourceType: 'concept_transfer_state', sourceRef: conceptId, facts: { transferDepth: sig.transferDepth } },
    });
  }

  // --- E. active remediation blockers (not already a Phase 4 REMEDIATION decision) ---
  for (const r of input.activeRemediations) {
    if (phase4Concepts.has(r.rootCauseConceptId)) continue;
    const subjectId = input.conceptSubjectById.get(r.rootCauseConceptId);
    if (!subjectId) continue;
    out.push({
      studentId,
      subjectId,
      conceptId: r.rootCauseConceptId,
      intendedActivityType: 'REMEDIATION',
      reasonCode: 'REMEDIATION_REQUIRED',
      source: 'REMEDIATION',
      phase4PriorityScore: null,
      hardDeadline: null,
      earliestDate: horizonStart, // a blocker -- schedule immediately
      latestDate: null,
      estimatedMinutes: candidateEstimatedMinutes('REMEDIATION'),
      candidateKey: `rem:${r.rootCauseConceptId}`,
      provenance: { sourceType: 'remediation_path', sourceRef: r.remediationPathId },
    });
  }

  // --- G. curriculum progression (NOT_STARTED, not already in a Phase 4 decision, no live PREREQUISITE_GAP) ---
  const seenCurriculum = new Set<string>();
  for (const c of input.curriculumEligible) {
    if (phase4Concepts.has(c.conceptId) || phase4PrereqGapConcepts.has(c.conceptId) || seenCurriculum.has(c.conceptId)) continue;
    seenCurriculum.add(c.conceptId);
    out.push({
      studentId,
      subjectId: c.subjectId,
      conceptId: c.conceptId,
      intendedActivityType: 'PRACTICE', // canonical first-touch (bootstrapNotStartedLearningDecision)
      reasonCode: 'CURRICULUM_PROGRESSION',
      source: 'CURRICULUM_PROGRESSION',
      phase4PriorityScore: 0, // lowest -- a bootstrap never outranks a real Phase 4 decision
      hardDeadline: assessmentDeadlineFor(c.subjectId, c.conceptId),
      earliestDate: null,
      latestDate: null,
      estimatedMinutes: candidateEstimatedMinutes('PRACTICE'),
      candidateKey: `curr:${c.conceptId}`,
      provenance: { sourceType: 'curriculum_eligibility', sourceRef: c.conceptId },
    });
  }

  return out;
}
