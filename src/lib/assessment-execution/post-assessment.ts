/**
 * B3 -- PostAssessmentState: the one canonical result of an executed assessment (pure contract).
 *
 * What was attempted, what was scored, what evidence was actually obtained, what changed in the Student's
 * state, what stayed unresolved, and which canonical decision exists afterwards. A consumer (B4) renders
 * it; nothing in it needs recomputing. It carries no learner-facing prose.
 */
import type { AssessmentFamily, AssessmentPath } from '@/lib/assessment-foundation/families';
import type { ExamGapCandidate } from '@/lib/assessment-foundation/exam-gap-candidate';
import type { AttributionOutcome, AttributionStatus, CoverageAccount, EvidencePlan } from './evidence-plan';

export const POST_ASSESSMENT_STATE_VERSION = 1 as const;

export type AssessmentRecord = { kind: 'QUIZ_SESSION'; id: string } | { kind: 'EXAM_INSTANCE'; id: string };

export type EvidenceApplicationStatus =
  /** The canonical writer applied it: evidence, mastery and Knowledge State moved together. */
  | 'APPLIED'
  /** This exact (attempt, response, concept) was already applied. Nothing was written again. */
  | 'DUPLICATE_IDEMPOTENT'
  /** The writer refused or failed. The score stands; the failure is recorded. */
  | 'WRITE_FAILED';

export interface EvidenceApplication {
  canonicalConceptId: string;
  learnerConceptId: string;
  status: EvidenceApplicationStatus;
  operationKey: string;
  sourceItemKeys: string[];
  mastery: { before: number; after: number } | null;
  masteryEventId: string | null;
  /** From the memory projector, for a retention check only. */
  retentionCheckQualified: boolean | null;
  error: string | null;
}

export interface ConceptStateChange {
  canonicalConceptId: string;
  learnerConceptId: string;
  /** `concept_knowledge_state.mastery_state` read before and after the writes. null = no state row. */
  before: string | null;
  after: string | null;
  changed: boolean;
}

export type NextDecisionRef =
  /** The Learning Decision authority's own answer after the state update. Opaque here: B3 does not interpret it. */
  | { status: 'AVAILABLE'; decision: unknown }
  | { status: 'NONE' }
  | { status: 'NOT_REQUESTED' }
  | { status: 'UNAVAILABLE'; error: string };

export interface ExecutionDiagnostics {
  family: AssessmentFamily;
  snapshotId: string;
  attemptRef: string;
  responseCount: number;
  scoredCount: number;
  attributedCount: number;
  nonConsequentialCount: number;
  unresolvedCount: number;
  derivedOnlyCount: number;
  duplicateCount: number;
  failedWriteCount: number;
  knowledgeStateUpdates: number;
}

export interface PostAssessmentState {
  v: typeof POST_ASSESSMENT_STATE_VERSION;
  assessment: { snapshotId: string; family: AssessmentFamily; path: AssessmentPath; intent: string | null; record: AssessmentRecord; policy: { id: string; version: string } };
  attemptRef: string;
  studentId: string;
  /** From the existing graders. Valid whatever happened to attribution. */
  score: EvidencePlan['score'];
  /** INTENDED vs OBSERVED. `consequential` is what evidence was really obtained for. */
  coverage: CoverageAccount;
  attributionOutcomes: AttributionOutcome[];
  evidence: EvidenceApplication[];
  conceptStateChanges: ConceptStateChange[];
  /** Attributions that could not become evidence, with the reason. */
  unresolvedAttributions: AttributionOutcome[];
  /** Exam families: the published needs (B1 boundary). The Learning Decision authority consumes them; nothing is placed anywhere. */
  examGaps: ExamGapCandidate[] | null;
  /** Owned by the verification engine; B3 changes no trigger and reports none of its own. */
  verificationState: null;
  nextDecision: NextDecisionRef;
  /** A technical-demo attempt never produces learner evidence. */
  learnerEvidence: 'CONSEQUENTIAL' | 'NONE' | 'NO_CONSEQUENTIAL_LEARNER_EVIDENCE';
  diagnostics: ExecutionDiagnostics;
}

const UNRESOLVED: readonly AttributionStatus[] = ['UNRESOLVED_CONCEPT', 'DERIVED_ONLY', 'NO_CANONICAL_CONCEPT', 'UNSUPPORTED_DIMENSION', 'NOT_IN_SNAPSHOT'];

export function buildPostAssessmentState(p: {
  assessment: PostAssessmentState['assessment'];
  attemptRef: string;
  studentId: string;
  technicalDemo: boolean;
  plan: EvidencePlan;
  responseCount: number;
  evidence: EvidenceApplication[];
  conceptStateChanges: ConceptStateChange[];
  examGaps: ExamGapCandidate[] | null;
  nextDecision: NextDecisionRef;
}): PostAssessmentState {
  const count = (s: AttributionStatus) => p.plan.outcomes.filter((o) => o.status === s).length;
  const applied = p.evidence.filter((e) => e.status === 'APPLIED').length;
  return {
    v: POST_ASSESSMENT_STATE_VERSION,
    assessment: p.assessment,
    attemptRef: p.attemptRef,
    studentId: p.studentId,
    score: p.plan.score,
    // observed evidence is what the writer applied (now or on an earlier run of the same attempt), not what was planned
    coverage: { ...p.plan.coverage, consequential: [...new Set(p.evidence.filter((e) => e.status !== 'WRITE_FAILED').map((e) => e.canonicalConceptId))].sort() },
    attributionOutcomes: p.plan.outcomes,
    evidence: p.evidence,
    conceptStateChanges: p.conceptStateChanges,
    unresolvedAttributions: p.plan.outcomes.filter((o) => UNRESOLVED.includes(o.status)),
    examGaps: p.examGaps,
    verificationState: null,
    nextDecision: p.nextDecision,
    learnerEvidence: p.technicalDemo ? 'NO_CONSEQUENTIAL_LEARNER_EVIDENCE' : p.evidence.some((e) => e.status !== 'WRITE_FAILED') ? 'CONSEQUENTIAL' : 'NONE',
    diagnostics: {
      family: p.assessment.family,
      snapshotId: p.assessment.snapshotId,
      attemptRef: p.attemptRef,
      responseCount: p.responseCount,
      scoredCount: p.plan.score.scored,
      attributedCount: count('ATTRIBUTED'),
      nonConsequentialCount: count('NON_CONSEQUENTIAL'),
      unresolvedCount: count('UNRESOLVED_CONCEPT') + count('NO_CANONICAL_CONCEPT') + count('UNSUPPORTED_DIMENSION'),
      derivedOnlyCount: count('DERIVED_ONLY'),
      duplicateCount: p.evidence.filter((e) => e.status === 'DUPLICATE_IDEMPOTENT').length,
      failedWriteCount: p.evidence.filter((e) => e.status === 'WRITE_FAILED').length,
      knowledgeStateUpdates: applied,
    },
  };
}
