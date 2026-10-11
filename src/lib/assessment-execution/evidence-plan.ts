/**
 * B3 -- evidence attribution, executed (pure, no IO). Scored responses + the frozen assessment -> what may
 * be written as learning evidence, for which concept, and why everything else may not.
 *
 * It decides no score and no mastery. Scores come from the existing graders; the write goes through
 * `updateMastery` (the one evidence writer), which also recalculates the Knowledge State and runs the
 * retention and transfer projectors in the same transaction. This module only builds that writer's input.
 *
 * Question coverage is not evidence credit. The B1 attribution contract (`planEvidenceAttribution`) says
 * what a response may claim; this module turns the claim into an outcome:
 *
 *   DIRECT        the question's single PRIMARY concept        -> ATTRIBUTED (consequential), when the
 *                                                                 Student has a CANONICALLY linked instance
 *   CONTRIBUTORY  a SUPPORTING concept, or one of several       -> NON_CONSEQUENTIAL: recorded on the source
 *                 PRIMARY concepts                                 response's provenance, no mastery update
 *   UNDETERMINED  reached only through the objective's mapping  -> DERIVED_ONLY: no mastery update
 *   no canonical instance (unlinked / TRANSITIONAL link)        -> UNRESOLVED_CONCEPT
 *
 * Therefore one response is consequential -- and independent -- evidence of AT MOST ONE concept.
 *
 * Event boundary (the existing canonical ones, reused, never both):
 *   LEARNING            one evidence event per (session, concept), at completion, aggregating that concept's
 *                       responses -- the same bucket, thresholds and idempotency key the quiz submission uses.
 *   exam families       one evidence event per scored item response -- the existing exam-response boundary.
 *
 * Idempotency keys are derived here from server-side identifiers only (session id / attempt id + frozen
 * position). Nothing a client sends reaches a key, a source type or an evidence mode.
 */
import type { LearningEvidence, EvidenceSourceType } from '@/lib/algorithms/mastery';
import type { EvidenceApplicationIdentity } from '@/lib/algorithms/evidence-idempotency';
import { aggregateEvidenceDifficulty } from '@/lib/lx/difficulty-contract';
import { examEvidenceScopeMetadata } from '@/lib/exam-core/evidence-scope';
import { planEvidenceAttribution, type CreditClaim, type EvidenceDimension } from '@/lib/assessment-foundation/evidence-attribution';
import { NOT_APPLICABLE, UNKNOWN, known } from '@/lib/assessment-foundation/known';
import { QUESTION_COVERAGE_VERSION, type ConceptCoverageBasis, type ConceptCoverageRole, type QuestionCoverage, type QuestionRef } from '@/lib/assessment-foundation/question-coverage';
import { canonicalConceptIdForAssessment, type ConceptIdentity } from '@/lib/catalog/concept-identity';
import type { FrozenAssessment, FrozenItem } from './frozen-assessment';

/* ------------------------------------------------------------------ */
/* Inputs                                                               */
/* ------------------------------------------------------------------ */

export type ResponseStatus =
  /** The existing grader finalised a score. */
  | 'SCORED'
  /** Served, not answered. Absence of evidence is not negative evidence. */
  | 'UNANSWERED'
  /** Answered, awaiting a reviewer's mark: not evidence until confirmed. */
  | 'PENDING_REVIEW';

export interface ScoredResponse {
  /** `<store>:<id>` of the frozen item it answers. */
  itemKey: string;
  /** The stored response row (quiz_responses.id / exam_attempt_item_responses.id), when one exists. */
  responseRef: string | null;
  status: ResponseStatus;
  /** The grader's result, 0..1. null unless SCORED. */
  fraction: number | null;
  /** Hints the existing session recorded for this question. */
  hintsUsed?: number;
}

export interface AttemptContext {
  /** LEARNING: `quiz_sessions.id`. Exam families: `exam_attempts.id`. Server-side identifiers only. */
  assessmentRef: string;
  /** Exam families: the Student's exam target (`student_exam_profiles.id`) -- the attempt's own foreign key. */
  examTargetId?: string | null;
  learningMode?: 'SOLO' | 'COACH' | 'AI_NATIVE';
  /**
   * A TRANSFER activity is graded by the existing transfer grader as a whole (per-challenge floor); its
   * verdict is the evidence score. Without it a transfer session produces no evidence here.
   */
  transferGrading?: { overallScore: number; passed: boolean } | null;
}

export interface LearnerConcepts {
  /** The Student's concept instances with their explicit catalogue link (B1 identity). */
  identities: readonly ConceptIdentity[];
  /** `concepts.subject_id` of each learner concept. */
  subjectByLearnerConcept: ReadonlyMap<string, string>;
}

/* ------------------------------------------------------------------ */
/* Outputs                                                              */
/* ------------------------------------------------------------------ */

export type AttributionStatus =
  | 'ATTRIBUTED'
  | 'NON_CONSEQUENTIAL'
  | 'UNRESOLVED_CONCEPT'
  | 'DERIVED_ONLY'
  | 'NO_CANONICAL_CONCEPT'
  | 'NOT_SCORED'
  | 'UNSUPPORTED_DIMENSION'
  | 'TECHNICAL_DEMO'
  | 'NOT_IN_SNAPSHOT';

export type AttributionReason =
  | 'SUPPORTING_COVERAGE'
  | 'SEVERAL_PRIMARY_CONCEPTS'
  | 'OBJECTIVE_MAPPING_ONLY'
  | 'NO_CANONICALLY_LINKED_LEARNER_CONCEPT'
  | 'UNANSWERED'
  | 'PENDING_REVIEW'
  | 'DIFFICULTY_UNKNOWN'
  | 'TRANSFER_GRADING_MISSING'
  | 'TECHNICAL_DEMO_CONTENT'
  | 'RESPONSE_NOT_PART_OF_ASSESSMENT';

export interface AttributionOutcome {
  itemKey: string;
  question: QuestionRef | null;
  responseRef: string | null;
  canonicalConceptId: string | null;
  learnerConceptId: string | null;
  role: ConceptCoverageRole | null;
  basis: ConceptCoverageBasis | null;
  credit: CreditClaim | null;
  status: AttributionStatus;
  reason: AttributionReason | null;
  /** May this response count toward an independent-evidence requirement of the concept? Only ever true when ATTRIBUTED. */
  independent: boolean;
}

/** One call of the canonical writer, fully built. `studentId` is the snapshot's own. */
export interface EvidenceWrite {
  learnerConceptId: string;
  canonicalConceptId: string;
  subjectId: string;
  evidence: LearningEvidence;
  identity: EvidenceApplicationIdentity;
  telemetry: { activityType: string; learningMode?: 'SOLO' | 'COACH' | 'AI_NATIVE'; hintsUsed?: number; aiAssistanceType?: 'NONE' };
  metadata: Record<string, unknown>;
  /** The frozen items whose responses this event rests on. */
  sourceItemKeys: string[];
}

export interface CoverageAccount {
  /** INTENDED: what the blueprint set out to assess. */
  intended: { canonicalConceptIds: string[]; learningObjectiveIds: string[] };
  /** Concepts any selected question covers, by any role. */
  selected: string[];
  /** ... of questions the Student answered. */
  answered: string[];
  /** ... of questions with a finalised score. */
  scored: string[];
  /** OBSERVED: concepts that received consequential evidence. */
  consequential: string[];
}

export interface EvidencePlan {
  outcomes: AttributionOutcome[];
  writes: EvidenceWrite[];
  coverage: CoverageAccount;
  score: { items: number; answered: number; scored: number; pendingReview: number; meanFraction: number | null; marks: { obtained: number; available: number } | null };
}

/* ------------------------------------------------------------------ */

/** Thresholds of the existing quiz submission (generate-and-take): >= 70 correct, >= 50 partial. Mirrored, guarded by test. */
export function learningEvidenceResult(scorePercent: number): LearningEvidence['result'] {
  return scorePercent >= 70 ? 'correct' : scorePercent >= 50 ? 'partial' : 'incorrect';
}

/** The existing exam-response rule (simulation scoring): full marks correct, some marks partial. */
export function examEvidenceResult(fraction: number): LearningEvidence['result'] {
  return fraction >= 1 ? 'correct' : fraction > 0 ? 'partial' : 'incorrect';
}

/** The evidence dimension an activity is run for (B1 vocabulary), from the session's own ActivityType. */
export function dimensionOfActivity(activityType: string | null | undefined): EvidenceDimension {
  if (activityType === 'SOLO_CHECK' || activityType === 'SOLO_VERIFY') return 'PROVE';
  if (activityType === 'RETENTION_CHECK') return 'RETAIN';
  if (activityType === 'TRANSFER') return 'TRANSFER';
  if (activityType === 'DIAGNOSTIC_CHECK') return 'DIAGNOSE';
  return 'PRACTICE';
}

/** The frozen item as the B1 attribution contract reads it: only what was frozen, nothing from the live bank. */
function coverageOfFrozenItem(item: FrozenItem): QuestionCoverage {
  return {
    v: QUESTION_COVERAGE_VERSION,
    ref: { ...item.question },
    ownerStudentId: null,
    learningObjectiveIds: item.learningObjectiveIds.length > 0 ? known([...item.learningObjectiveIds]) : UNKNOWN,
    learnerConceptId: null,
    concepts: item.coverage.map((c) => ({ canonicalConceptId: c.canonicalConceptId, role: c.role, basis: c.basis })),
    unconfirmedConceptId: null,
    conceptResolution: item.coverage.length > 0 ? { status: 'RESOLVED' } : { status: 'UNRESOLVED', reason: 'NO_ANCHOR' },
    curriculumApplicability: UNKNOWN,
    examApplicability: UNKNOWN,
    questionType: item.questionType ? known(item.questionType) : UNKNOWN,
    difficulty: item.difficulty === null ? UNKNOWN : known(item.difficulty),
    marks: item.marks === null ? UNKNOWN : known(item.marks),
    estimatedSeconds: item.estimatedSeconds === null ? UNKNOWN : known(item.estimatedSeconds),
    language: UNKNOWN,
    provenance: item.provenance,
    licensing: UNKNOWN,
    // rights, stimulus and assets decide ELIGIBILITY, which was settled before the freeze; attribution reads none of them
    rights: [],
    stimulus: null,
    assets: [],
    usage: UNKNOWN,
    review: { lifecycle: UNKNOWN, humanReviewed: UNKNOWN },
    bankFacts: null,
    cacheStatus: NOT_APPLICABLE,
  };
}

/** The Student's instance of each canonical concept, through a CANONICAL link only (never a label match). */
export function learnerConceptByCanonical(identities: readonly ConceptIdentity[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const identity of [...identities].sort((a, b) => a.learnerConceptId.localeCompare(b.learnerConceptId))) {
    const canonical = canonicalConceptIdForAssessment(identity);
    if (canonical && !out.has(canonical)) out.set(canonical, identity.learnerConceptId);
  }
  return out;
}

const uniqSorted = (list: Iterable<string>) => [...new Set(list)].sort();

export function planEvidence(frozen: FrozenAssessment, attempt: AttemptContext, responses: readonly ScoredResponse[], learner: LearnerConcepts): EvidencePlan {
  const isLearning = frozen.family === 'LEARNING';
  if (!isLearning && !(frozen.exam && attempt.examTargetId)) throw new Error('EXAM_SCOPE_REQUIRED');
  const examScope = !isLearning && frozen.exam && attempt.examTargetId ? { examTargetId: attempt.examTargetId, examVersionId: frozen.exam.examVersionId, examAttemptId: attempt.assessmentRef } : null;
  const instances = learnerConceptByCanonical(learner.identities);
  const itemByKey = new Map(frozen.items.map((i) => [i.key, i]));
  const outcomes: AttributionOutcome[] = [];
  const base = (r: ScoredResponse, item: FrozenItem | null) => ({ itemKey: r.itemKey, question: item ? { ...item.question } : null, responseRef: r.responseRef ?? null });
  const none = { canonicalConceptId: null, learnerConceptId: null, role: null, basis: null, credit: null, independent: false } as const;

  // One response per frozen item: a second response for the same item is the same logical answer (first wins).
  const byItem = new Map<string, ScoredResponse>();
  for (const r of responses) {
    if (!itemByKey.has(r.itemKey)) {
      outcomes.push({ ...base(r, null), ...none, status: 'NOT_IN_SNAPSHOT', reason: 'RESPONSE_NOT_PART_OF_ASSESSMENT' });
      continue;
    }
    if (!byItem.has(r.itemKey)) byItem.set(r.itemKey, r);
  }

  const dimension = dimensionOfActivity(frozen.activity?.activityType);
  interface Credited { item: FrozenItem; response: ScoredResponse; canonicalConceptId: string; learnerConceptId: string; independent: boolean; outcomeIndex: number }
  const credited: Credited[] = [];

  for (const item of frozen.items) {
    const r = byItem.get(item.key);
    if (!r) continue;
    if (frozen.contentAudience === 'TECHNICAL_DEMO') {
      outcomes.push({ ...base(r, item), ...none, status: 'TECHNICAL_DEMO', reason: 'TECHNICAL_DEMO_CONTENT' });
      continue;
    }
    if (r.status !== 'SCORED' || r.fraction === null) {
      outcomes.push({ ...base(r, item), ...none, status: 'NOT_SCORED', reason: r.status === 'PENDING_REVIEW' ? 'PENDING_REVIEW' : 'UNANSWERED' });
      continue;
    }
    if (item.coverage.length === 0) {
      outcomes.push({ ...base(r, item), ...none, status: 'NO_CANONICAL_CONCEPT', reason: null });
      continue;
    }
    const independentActivity = isLearning && frozen.activity?.evidenceMode === 'INDEPENDENT' && (r.hintsUsed ?? 0) === 0;
    const attribution = planEvidenceAttribution(coverageOfFrozenItem(item), {
      family: frozen.family,
      path: frozen.path,
      assessmentRef: attempt.assessmentRef,
      responseRef: r.responseRef,
      examScope,
      dimension,
      learnerConceptByCanonical: instances,
      independentActivity,
    });
    const primaries = item.coverage.filter((c) => c.role === 'PRIMARY').length;
    for (const t of attribution.targets) {
      const common = { ...base(r, item), canonicalConceptId: t.canonicalConceptId, learnerConceptId: t.learnerConceptId, role: t.role, basis: t.basis, credit: t.credit };
      if (t.credit === 'UNDETERMINED') outcomes.push({ ...common, status: 'DERIVED_ONLY', reason: 'OBJECTIVE_MAPPING_ONLY', independent: false });
      else if (t.credit === 'CONTRIBUTORY') outcomes.push({ ...common, status: 'NON_CONSEQUENTIAL', reason: t.role === 'PRIMARY' && primaries > 1 ? 'SEVERAL_PRIMARY_CONCEPTS' : 'SUPPORTING_COVERAGE', independent: false });
      else if (!t.learnerConceptId) outcomes.push({ ...common, status: 'UNRESOLVED_CONCEPT', reason: 'NO_CANONICALLY_LINKED_LEARNER_CONCEPT', independent: false });
      else {
        outcomes.push({ ...common, status: 'ATTRIBUTED', reason: null, independent: t.independentEvidenceEligible });
        credited.push({ item, response: r, canonicalConceptId: t.canonicalConceptId, learnerConceptId: t.learnerConceptId, independent: t.independentEvidenceEligible, outcomeIndex: outcomes.length - 1 });
      }
    }
  }

  /* ---- provenance shared by every event of this attempt ---- */
  const assessment = (sources: Credited[]) => ({
    snapshotId: frozen.snapshotId,
    family: frozen.family,
    path: frozen.path,
    intent: frozen.intent,
    policy: frozen.policy,
    assessmentRef: attempt.assessmentRef,
    curriculum: frozen.curriculum,
    canonicalConceptId: sources[0].canonicalConceptId,
    attributionRole: 'PRIMARY' as const,
    responses: sources.map((s) => ({ itemKey: s.item.key, question: s.item.question, order: s.item.order, responseRef: s.response.responseRef ?? null, store: s.item.question.store, provenance: s.item.provenance, independent: s.independent })),
    // what the same responses could NOT be credited to: kept with the evidence, never applied to mastery
    nonConsequential: outcomes
      .filter((o) => o.status !== 'ATTRIBUTED' && o.canonicalConceptId && sources.some((s) => s.item.key === o.itemKey))
      .map((o) => ({ itemKey: o.itemKey, canonicalConceptId: o.canonicalConceptId, role: o.role, status: o.status })),
  });
  const demote = (list: Credited[], reason: AttributionReason) => {
    for (const c of list) outcomes[c.outcomeIndex] = { ...outcomes[c.outcomeIndex], status: 'UNSUPPORTED_DIMENSION', reason, independent: false };
  };

  const writes: EvidenceWrite[] = [];
  if (isLearning) {
    const activity = frozen.activity!;
    const byConcept = new Map<string, Credited[]>();
    for (const c of credited) byConcept.set(c.learnerConceptId, [...(byConcept.get(c.learnerConceptId) ?? []), c]);
    for (const [learnerConceptId, bucket] of [...byConcept.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const subjectId = learner.subjectByLearnerConcept.get(learnerConceptId);
      const difficulties = bucket.map((c) => c.item.difficulty).filter((d): d is number => d !== null);
      if (!subjectId) {
        for (const c of bucket) outcomes[c.outcomeIndex] = { ...outcomes[c.outcomeIndex], status: 'UNRESOLVED_CONCEPT', reason: 'NO_CANONICALLY_LINKED_LEARNER_CONCEPT', independent: false };
        continue;
      }
      // No recorded difficulty: the writer needs one and none is invented.
      if (difficulties.length !== bucket.length) {
        demote(bucket, 'DIFFICULTY_UNKNOWN');
        continue;
      }
      const isTransfer = activity.activityType === 'TRANSFER';
      if (isTransfer && !attempt.transferGrading) {
        demote(bucket, 'TRANSFER_GRADING_MISSING');
        continue;
      }
      // The concept's own continuous mean, as the existing submission computes it.
      const scorePercent = isTransfer ? attempt.transferGrading!.overallScore : Math.round((bucket.reduce((a, c) => a + (c.response.fraction as number), 0) / bucket.length) * 100);
      const hintsUsed = bucket.reduce((a, c) => a + (c.response.hintsUsed ?? 0), 0);
      writes.push({
        learnerConceptId,
        canonicalConceptId: bucket[0].canonicalConceptId,
        subjectId,
        evidence: {
          result: isTransfer ? (attempt.transferGrading!.passed ? 'correct' : 'incorrect') : learningEvidenceResult(scorePercent),
          difficulty: aggregateEvidenceDifficulty(difficulties),
          sourceType: activity.evidenceSource as EvidenceSourceType,
          confidenceWeight: 0.9,
          scorePercent,
          sampleSize: bucket.length,
        },
        // the session id is minted once at generation: the existing key of "this session's evidence for this concept"
        identity: { operationType: 'QUIZ_SUBMISSION', operationId: attempt.assessmentRef, conceptId: learnerConceptId },
        telemetry: { activityType: 'quiz', ...(attempt.learningMode ? { learningMode: attempt.learningMode } : {}), hintsUsed },
        // Explicit, so the projector does not have to infer it: independent only when EVERY response behind this
        // event was an independent demonstration (independent activity, no assistance, single PRIMARY concept).
        metadata: { activityType: activity.activityType, evidenceMode: activity.evidenceMode, independenceEligible: bucket.every((c) => c.independent), assessment: assessment(bucket) },
        sourceItemKeys: bucket.map((c) => c.item.key),
      });
    }
  } else {
    for (const c of credited) {
      const subjectId = learner.subjectByLearnerConcept.get(c.learnerConceptId);
      if (!subjectId) {
        outcomes[c.outcomeIndex] = { ...outcomes[c.outcomeIndex], status: 'UNRESOLVED_CONCEPT', reason: 'NO_CANONICALLY_LINKED_LEARNER_CONCEPT', independent: false };
        continue;
      }
      if (c.item.difficulty === null) {
        demote([c], 'DIFFICULTY_UNKNOWN');
        continue;
      }
      const fraction = c.response.fraction as number;
      writes.push({
        learnerConceptId: c.learnerConceptId,
        canonicalConceptId: c.canonicalConceptId,
        subjectId,
        evidence: { sourceType: 'EXAM_SIMULATION', result: examEvidenceResult(fraction), difficulty: c.item.difficulty, scorePercent: fraction * 100 },
        // attempt id + frozen position: one item response of one attempt, whatever the transport did
        identity: { operationType: 'EXAM_SIMULATION_RESPONSE', operationId: `${attempt.assessmentRef}.${c.item.order}`, conceptId: c.learnerConceptId },
        telemetry: { activityType: 'EXAM_SIMULATION', learningMode: 'AI_NATIVE', aiAssistanceType: 'NONE' },
        metadata: {
          context: { examAttemptId: attempt.assessmentRef, simulationSource: true },
          framework: { examVersionId: frozen.exam!.examVersionId },
          examScope: examEvidenceScopeMetadata(examScope!),
          // exam performance is never independent LEARNING evidence (B1): stated, not left to inference
          independenceEligible: false,
          ...(c.item.questionType ? { questionType: c.item.questionType } : {}),
          assessment: { ...assessment([c]), exam: { ...frozen.exam!, learningObjectiveIds: c.item.learningObjectiveIds, slotIndex: c.item.slotIndex } },
        },
        sourceItemKeys: [c.item.key],
      });
    }
  }

  /* ---- intended vs observed ---- */
  const conceptsOf = (keys: Iterable<string>) => uniqSorted([...keys].flatMap((k) => itemByKey.get(k)?.coverage.map((c) => c.canonicalConceptId) ?? []));
  const answeredKeys = [...byItem.values()].filter((r) => r.status !== 'UNANSWERED').map((r) => r.itemKey);
  const scoredKeys = [...byItem.values()].filter((r) => r.status === 'SCORED' && r.fraction !== null).map((r) => r.itemKey);
  const scored = [...byItem.values()].filter((r) => r.status === 'SCORED' && r.fraction !== null);
  const withMarks = scored.map((r) => ({ r, marks: itemByKey.get(r.itemKey)!.marks }));
  const allMarked = frozen.items.every((i) => i.marks !== null);
  return {
    outcomes,
    writes,
    coverage: {
      intended: { canonicalConceptIds: [...frozen.targets.canonicalConceptIds], learningObjectiveIds: [...frozen.targets.learningObjectiveIds] },
      selected: conceptsOf(frozen.items.map((i) => i.key)),
      answered: conceptsOf(answeredKeys),
      scored: conceptsOf(scoredKeys),
      consequential: uniqSorted(writes.map((w) => w.canonicalConceptId)),
    },
    score: {
      items: frozen.items.length,
      answered: answeredKeys.length,
      scored: scored.length,
      pendingReview: [...byItem.values()].filter((r) => r.status === 'PENDING_REVIEW').length,
      meanFraction: scored.length > 0 ? scored.reduce((a, r) => a + (r.fraction as number), 0) / scored.length : null,
      // marks are stated only when every frozen item records them
      marks: allMarked ? { obtained: withMarks.reduce((a, x) => a + (x.r.fraction as number) * (x.marks as number), 0), available: frozen.items.reduce((a, i) => a + (i.marks as number), 0) } : null,
    },
  };
}
