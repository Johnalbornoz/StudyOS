/**
 * TARGET MODEL -- the evidence boundary between LEARNING and EXAM PREP (pure, no IO). Executable specification of
 * docs/audits/exam-bank/EXAM_READINESS_SEPARATION_AUDIT.md, section "Target model".
 *
 *                 CANONICAL KNOWLEDGE / CURRICULUM
 *                               |
 *                    +----------+----------+
 *                 LEARNING               EXAM PREP
 *                    |                       |
 *           LEARNING EVIDENCE          EXAM EVIDENCE (EXAM_ASSESSMENT)
 *                    |                       |
 *            KNOWLEDGE STATE           EXAM READINESS
 *
 * Rules (each one asserted by tests/unit/exam-readiness-separation.test.ts):
 *   R1  Each evidence type has exactly one set of projections it may change (EVIDENCE_PROJECTIONS). Nothing else.
 *   R2  EXAM_ASSESSMENT needs an exam TARGET (Student + exam preparation + attempt), never Learning Plan membership:
 *       off-plan canonical concepts get exam evidence and Exam Readiness.
 *   R3  EXAM_ASSESSMENT never creates learner concepts, plan membership, routes or recommendations, nor mutates
 *       Knowledge State.
 *   R4  LEARNING mutates Knowledge State (under the existing Learning rules) and never Exam Readiness.
 *   R5  INTERNAL_ASSESSMENT keeps its existing Knowledge State effect and its own result stream; it never becomes
 *       Exam Readiness. LEARNING and INTERNAL_ASSESSMENT keep their existing precondition: a learner concept the
 *       Student owns (canonically linked), which is NOT plan membership.
 *   R6  Any cross-type effect exists only as an explicit, versioned, governed TRANSFER RULE. The registry ships EMPTY.
 *
 * This module is a reference; the running Learning / PAA writers are NOT rewired to it during the PAA freeze.
 * No readiness score formula is defined here: Exam Readiness stores aggregates, and `readinessScore` stays null
 * until a product rule defines it.
 */

export type EvidenceType = 'LEARNING' | 'INTERNAL_ASSESSMENT' | 'EXAM_ASSESSMENT';
export type Projection = 'KNOWLEDGE_STATE' | 'LEARNING_PLAN' | 'LEARNING_ROUTE' | 'LEARNING_RECOMMENDATION' | 'INTERNAL_ASSESSMENT_RESULT' | 'EXAM_READINESS';

/** R1: the only projections an evidence type may change, absent a governed transfer rule. */
export const EVIDENCE_PROJECTIONS: Readonly<Record<EvidenceType, readonly Projection[]>> = {
  LEARNING: ['KNOWLEDGE_STATE'],
  // Existing rule kept: an internal mastery check / diagnostic is Learning-side evidence and validates the Knowledge
  // State (SOLO_VERIFICATION, DIAGNOSTIC). It also keeps its own result stream. It never reaches Exam Readiness.
  INTERNAL_ASSESSMENT: ['KNOWLEDGE_STATE', 'INTERNAL_ASSESSMENT_RESULT'],
  EXAM_ASSESSMENT: ['EXAM_READINESS'],
};

export interface TransferRule {
  ruleId: string;
  version: number;
  from: EvidenceType;
  to: Projection;
  /** Who approved it and under which decision record. Required: no anonymous transfer. */
  approvedBy: string;
  decisionRef: string;
}
/** R6: ships empty. Adding a rule is a governed product decision, never a code default. */
export const GOVERNED_TRANSFER_RULES: readonly TransferRule[] = Object.freeze([]);

export function projectionsOf(type: EvidenceType, rules: readonly TransferRule[] = GOVERNED_TRANSFER_RULES): Projection[] {
  return [...EVIDENCE_PROJECTIONS[type], ...rules.filter((r) => r.from === type && r.approvedBy.trim() !== '' && r.decisionRef.trim() !== '').map((r) => r.to)];
}

/** The exam identity an EXAM_ASSESSMENT event carries (captured at write time, never inferred). */
export interface ExamTarget {
  examTargetId: string;
  assessmentSystem: string;
  assessmentVersion: string;
  profile: string | null;
  component: string | null;
  paper: string | null;
  blueprintBucketId: string;
  examAttemptId: string;
}

export interface EvidenceEvent {
  studentId: string;
  type: EvidenceType;
  /** Canonical concept or construct (stable id). */
  conceptStableId: string;
  correct: boolean;
  /** Fraction 0..1 of marks. */
  fraction: number;
  /** ASSISTED responses (e.g. a strategy opened before answering) are kept but never counted as independent. */
  assisted: boolean;
  responseFormat: string;
  difficultyIndex: number | null;
  responseTimeMs: number | null;
  occurredAt: string;
  examTarget: ExamTarget | null;
  idempotencyKey: string;
}

export type EvidenceRefusal = 'EXAM_EVIDENCE_WITHOUT_TARGET' | 'NON_EXAM_EVIDENCE_WITH_EXAM_TARGET' | 'LEARNING_EVIDENCE_WITHOUT_LEARNER_CONCEPT' | 'DUPLICATE';

/** Exam Readiness cell: Student x system x version/profile x component/paper x concept x bucket. Aggregates only. */
export interface ExamReadinessCell {
  key: string;
  studentId: string;
  examTargetId: string;
  assessmentSystem: string;
  assessmentVersion: string;
  profile: string | null;
  component: string | null;
  paper: string | null;
  conceptStableId: string;
  blueprintBucketId: string;
  attemptCount: number;
  correctCount: number;
  independentAttemptCount: number;
  independentCorrectCount: number;
  assistedAttemptCount: number;
  assistedCorrectCount: number;
  fractionSum: number;
  timedResponses: number;
  responseTimeMsSum: number;
  difficultyIndexSum: number;
  difficultyIndexed: number;
  responseFormats: string[];
  attemptIds: string[];
  firstAt: string;
  lastAt: string;
  /** Not defined until a product rule exists. Never invented here. */
  readinessScore: null;
}

export interface KnowledgeCell { attempts: number; correct: number; lastAt: string }

/** The reference projection store. Production tables differ; the boundaries do not. */
export interface EvidenceStores {
  /** Concepts the Student owns (canonically linked learner concept). `${studentId}|${concept}` */
  learnerConcepts: Set<string>;
  /** Learning Plan membership (student_plan_entries). Written by the plan service only. */
  learningPlan: Set<string>;
  learningRoutes: Set<string>;
  learningRecommendations: Set<string>;
  knowledgeState: Map<string, KnowledgeCell>;
  internalAssessment: Map<string, { attempts: number; fractionSum: number }>;
  examReadiness: Map<string, ExamReadinessCell>;
  seen: Set<string>;
}
export const emptyStores = (): EvidenceStores => ({ learnerConcepts: new Set(), learningPlan: new Set(), learningRoutes: new Set(), learningRecommendations: new Set(), knowledgeState: new Map(), internalAssessment: new Map(), examReadiness: new Map(), seen: new Set() });

const conceptKey = (e: Pick<EvidenceEvent, 'studentId' | 'conceptStableId'>): string => `${e.studentId}|${e.conceptStableId}`;
export const examReadinessKey = (studentId: string, t: ExamTarget, concept: string): string =>
  [studentId, t.examTargetId, t.assessmentSystem, t.assessmentVersion, t.profile ?? '-', t.component ?? '-', t.paper ?? '-', concept, t.blueprintBucketId].join('|');

/**
 * Apply one evidence event to the projections its type (and governed transfers) allow. Returns the projections
 * touched, or a refusal. Learning / internal assessment keep their existing precondition (a learner concept the
 * Student owns); exam evidence needs only its exam target -- never a learner concept, never plan membership.
 */
export function applyEvidence(s: EvidenceStores, e: EvidenceEvent, rules: readonly TransferRule[] = GOVERNED_TRANSFER_RULES): { applied: Projection[] } | { refused: EvidenceRefusal } {
  if (s.seen.has(e.idempotencyKey)) return { refused: 'DUPLICATE' };
  if (e.type === 'EXAM_ASSESSMENT' && !e.examTarget) return { refused: 'EXAM_EVIDENCE_WITHOUT_TARGET' };
  if (e.type !== 'EXAM_ASSESSMENT' && e.examTarget) return { refused: 'NON_EXAM_EVIDENCE_WITH_EXAM_TARGET' };
  if (e.type !== 'EXAM_ASSESSMENT' && !s.learnerConcepts.has(conceptKey(e))) return { refused: 'LEARNING_EVIDENCE_WITHOUT_LEARNER_CONCEPT' };
  s.seen.add(e.idempotencyKey);
  const targets = projectionsOf(e.type, rules);
  for (const p of targets) {
    if (p === 'KNOWLEDGE_STATE') {
      const k = conceptKey(e); const c = s.knowledgeState.get(k) ?? { attempts: 0, correct: 0, lastAt: e.occurredAt };
      // Learning rule placeholder: assisted work is not independent knowledge evidence.
      if (!e.assisted) s.knowledgeState.set(k, { attempts: c.attempts + 1, correct: c.correct + (e.correct ? 1 : 0), lastAt: e.occurredAt });
    } else if (p === 'INTERNAL_ASSESSMENT_RESULT') {
      const k = conceptKey(e); const c = s.internalAssessment.get(k) ?? { attempts: 0, fractionSum: 0 };
      s.internalAssessment.set(k, { attempts: c.attempts + 1, fractionSum: c.fractionSum + e.fraction });
    } else if (p === 'EXAM_READINESS') {
      const t = e.examTarget!; const key = examReadinessKey(e.studentId, t, e.conceptStableId);
      const c: ExamReadinessCell = s.examReadiness.get(key) ?? {
        key, studentId: e.studentId, examTargetId: t.examTargetId, assessmentSystem: t.assessmentSystem, assessmentVersion: t.assessmentVersion, profile: t.profile,
        component: t.component, paper: t.paper, conceptStableId: e.conceptStableId, blueprintBucketId: t.blueprintBucketId, attemptCount: 0, correctCount: 0,
        independentAttemptCount: 0, independentCorrectCount: 0, assistedAttemptCount: 0, assistedCorrectCount: 0, fractionSum: 0, timedResponses: 0, responseTimeMsSum: 0,
        difficultyIndexSum: 0, difficultyIndexed: 0, responseFormats: [], attemptIds: [], firstAt: e.occurredAt, lastAt: e.occurredAt, readinessScore: null,
      };
      c.attemptCount++; if (e.correct) c.correctCount++;
      if (e.assisted) { c.assistedAttemptCount++; if (e.correct) c.assistedCorrectCount++; } else { c.independentAttemptCount++; if (e.correct) c.independentCorrectCount++; }
      c.fractionSum += e.fraction;
      if (e.responseTimeMs !== null) { c.timedResponses++; c.responseTimeMsSum += e.responseTimeMs; }
      if (e.difficultyIndex !== null) { c.difficultyIndexed++; c.difficultyIndexSum += e.difficultyIndex; }
      if (!c.responseFormats.includes(e.responseFormat)) c.responseFormats.push(e.responseFormat);
      if (!c.attemptIds.includes(t.examAttemptId)) c.attemptIds.push(t.examAttemptId);
      if (e.occurredAt < c.firstAt) c.firstAt = e.occurredAt;
      if (e.occurredAt > c.lastAt) c.lastAt = e.occurredAt;
      s.examReadiness.set(key, c);
    }
    // LEARNING_PLAN / LEARNING_ROUTE / LEARNING_RECOMMENDATION are never evidence projections: plan membership is a
    // Student / Learning decision, written by the Learning plan service, not by evidence.
  }
  return { applied: targets };
}
