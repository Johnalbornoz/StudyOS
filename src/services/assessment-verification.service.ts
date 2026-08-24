/**
 * Phase 3B: Assessment Verification Engine -- the orchestration layer.
 *
 * Architectural chain this file implements (and never breaks):
 *
 *   Assessment attempt -> grading/reasoning analysis -> Assessment
 *   Confidence -> verification decision if needed -> high-confidence
 *   Learning Evidence -> Phase 2.2 deterministic projector -> Knowledge
 *   State
 *
 * This module answers "how trustworthy is this assessment evidence,
 * and do we have enough unambiguous evidence to use it confidently?"
 * It never answers "has the student mastered the concept?" -- that
 * remains exclusively owned by recalculateConceptKnowledgeState
 * (Phase 2.2). Nothing in this file imports knowledge-state.service.ts,
 * writes to concept_knowledge_state, or computes a MasteryState. The
 * one write path this module has is a normal updateMastery call --
 * exactly the same call every other evidence-producing feature in the
 * product already makes -- with confidenceWeight scaled by Assessment
 * Confidence and rich metadata attached, never a masteryState override.
 *
 * Assessment Confidence and Knowledge Confidence stay separate: this
 * file only ever reads calculateAssessmentConfidence's existing
 * formula (never a second one) and this module's own
 * evaluateAssessmentEvidence()/qualifyEvidence() outputs -- it never
 * reads Understanding/Independence/Application/Retention/Transfer to
 * decide anything.
 */

import { db } from '@/lib/db';
import { updateMastery, type MasteryUpdateResult } from './mastery.service';
import type { LearningEvidence, EvidenceSourceType } from '@/lib/algorithms/mastery';
import { calculateAssessmentConfidence, behavioralAnomalyScore, type IntegritySignals } from '@/lib/assessment-confidence';
import {
  evaluateVerificationTriggers,
  shouldTriggerVerification as triggersFired,
  highestSeverity,
  type VerificationTriggerResult,
} from '@/lib/verification-triggers';
import { getAssessmentProfile } from '@/lib/assessment-profiles';
import type { ActivityType, EvidenceMode } from '@/lib/activity-taxonomy';

export type VerificationOutcome = 'CONFIRMED' | 'CONTRADICTED' | 'INCONCLUSIVE';
export type EvidenceStrength = 'HIGH' | 'MEDIUM' | 'LOW' | 'CONTRADICTED';

export interface AssessmentAttemptContext {
  activityType: 'CUMULATIVE_ASSESSMENT' | 'MOCK_EXAM';
  /** Per-question grading confidence (0-1) for every question counted toward this concept in this attempt. */
  gradingConfidences: number[];
  currentScorePercent: number;
  priorConceptScorePercent?: number | null;
  variantEquivalenceConfidence?: number | null;
  conceptMappingConfidence?: number | null;
  conceptCoverageBreadth?: number | null;
  reasoningConsistent?: boolean | null;
  integritySignals?: IntegritySignals;
}

export interface VerificationDecision {
  required: boolean;
  triggers: VerificationTriggerResult[];
  /** null when no trigger fired, since severity is meaningless without a reason. */
  severity: ReturnType<typeof highestSeverity>;
  assessmentConfidenceBeforeVerification: number;
  behavioralAnomalyScore: number;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function spread(values: number[]): number {
  if (values.length < 2) return 0;
  return Math.max(...values) - Math.min(...values);
}

/**
 * Concept coverage breadth, derived deterministically from the actual
 * question types asked for one concept in this attempt -- never
 * fabricated. With fewer than 2 questions there simply isn't enough
 * data to assess breadth one way or the other (a single question per
 * concept is normal, by-design behavior for Cumulative/Mock attempts
 * spread across many concepts, not evidence of narrow coverage), so
 * this returns undefined (genuinely unavailable) rather than a
 * default 0 or 1 -- the trigger engine already treats a null/undefined
 * value as "don't fire this trigger."
 *
 * With 2+ questions: repeated use of the SAME question type (e.g.
 * three multiple_choice questions in a row) is narrower evidence than
 * questions that probe the concept through genuinely different
 * formats (multiple_choice + short_answer + scenario) -- breadth is
 * the fraction of distinct types among the questions asked.
 */
export function computeConceptCoverageBreadth(questionTypes: string[]): number | undefined {
  if (questionTypes.length < 2) return undefined;
  const distinctTypes = new Set(questionTypes).size;
  return Math.min(1, distinctTypes / questionTypes.length);
}

/**
 * Concept mapping confidence for a Mock Exam attempt, derived from the
 * SAME attribution granularity Phase 3 Pre-flight already computes for
 * real school exams (exam-result.service.ts's getConceptAttribution) --
 * reused here rather than a second formula. Mock Exam concepts are
 * pulled from a real scheduled assessment_occurrences row
 * (getNextOccurrence), so its attribution is exactly as certain (or
 * uncertain) as a real exam's: CONCEPT_MAPPED (explicit coverage
 * mapping) down to SUBJECT_WIDE (no topics selected at all, the
 * coarsest, least certain tier). Returns undefined when the concept
 * isn't in the attribution list at all (nothing to report).
 *
 * Cumulative Assessment has no equivalent real signal to derive this
 * from (its concepts are picked by the app itself, not tied to a
 * scheduled exam occurrence) -- callers should pass undefined for it,
 * which correctly keeps WEAK_CONCEPT_ATTRIBUTION from ever firing
 * there rather than inventing a number with no basis.
 */
export function deriveConceptMappingConfidence(
  attributions: Array<{ conceptId: string; confidenceWeight: number }>,
  conceptId: string
): number | undefined {
  const match = attributions.find((a) => a.conceptId === conceptId);
  return match?.confidenceWeight;
}

/**
 * Deterministic, explainable selection of WHICH question within a
 * concept's bucket a verification question should target: the one
 * with the lowest grading confidence (the most ambiguous individual
 * piece of evidence), tie-broken by the lowest question index so the
 * choice never depends on array/iteration order. Never an arbitrary
 * "first question in the bucket."
 */
export function selectMostAmbiguousQuestion(questionIndexes: number[], gradingConfidences: number[]): { questionIndex: number; gradingConfidence: number } {
  const paired = questionIndexes.map((questionIndex, i) => ({ questionIndex, gradingConfidence: gradingConfidences[i] }));
  paired.sort((a, b) => a.gradingConfidence - b.gradingConfidence || a.questionIndex - b.questionIndex);
  return paired[0];
}

/**
 * Step 1-6 of the chain: compute Assessment Confidence from real
 * grading/variant/behavioral inputs (never fabricated), then run the
 * deterministic trigger engine to decide whether more evidence is
 * needed. Pure -- no DB access, no AI call, fully testable in isolation.
 */
export function evaluateAssessmentEvidence(context: AssessmentAttemptContext): VerificationDecision {
  const profile = getAssessmentProfile(context.activityType);
  const anomaly = context.integritySignals ? behavioralAnomalyScore(context.integritySignals) : 0;

  const assessmentConfidenceBeforeVerification = calculateAssessmentConfidence({
    gradingConfidences: context.gradingConfidences,
    variantEquivalenceConfidence: context.variantEquivalenceConfidence ?? null,
    behavioralAnomalyScore: anomaly,
  });

  const requiresVerificationByProfile =
    !!profile &&
    profile.verificationStrictness === 'ADAPTIVE' &&
    assessmentConfidenceBeforeVerification < profile.assessmentConfidenceThresholds.low;

  const triggers = evaluateVerificationTriggers({
    gradingConfidence: average(context.gradingConfidences),
    gradingConfidenceSpread: spread(context.gradingConfidences),
    priorConceptScorePercent: context.priorConceptScorePercent ?? null,
    currentScorePercent: context.currentScorePercent,
    variantEquivalenceConfidence: context.variantEquivalenceConfidence ?? null,
    conceptMappingConfidence: context.conceptMappingConfidence ?? null,
    conceptCoverageBreadth: context.conceptCoverageBreadth ?? null,
    behavioralAnomalyScore: anomaly,
    reasoningConsistent: context.reasoningConsistent ?? null,
    requiresVerificationByProfile,
  });

  return {
    required: triggersFired(triggers),
    triggers,
    severity: highestSeverity(triggers),
    assessmentConfidenceBeforeVerification,
    behavioralAnomalyScore: anomaly,
  };
}

/**
 * Compares the verification question's result against the original
 * answer -- verification tests the SAME concept from another angle, so
 * agreement (both strong or both weak) confirms the original evidence,
 * disagreement contradicts it, and a partial/mixed result is genuinely
 * inconclusive rather than forced into one bucket or the other.
 */
export function interpretVerificationOutcome(originalScorePercent: number, verificationScorePercent: number): VerificationOutcome {
  const originalStrong = originalScorePercent >= 70;
  const originalWeak = originalScorePercent < 50;
  const verificationStrong = verificationScorePercent >= 70;
  const verificationWeak = verificationScorePercent < 50;

  if (originalStrong && verificationStrong) return 'CONFIRMED';
  if (originalWeak && verificationWeak) return 'CONFIRMED';
  if ((originalStrong && verificationWeak) || (originalWeak && verificationStrong)) return 'CONTRADICTED';
  return 'INCONCLUSIVE';
}

/**
 * Step 9: recalculate Assessment Confidence after a verification
 * response, reusing calculateAssessmentConfidence's own
 * verificationResult adjustment (+15 confirmed / -25 contradicted)
 * rather than a second formula -- the "before" value is fed back in as
 * a synthetic single-element gradingConfidences array so the existing
 * pure function reproduces it exactly before applying the adjustment.
 * INCONCLUSIVE passes verificationResult as null, so confidence is
 * left unchanged -- an inconclusive follow-up neither confirms nor
 * contradicts anything.
 */
export function recalculateConfidenceAfterVerification(
  assessmentConfidenceBefore: number,
  outcome: VerificationOutcome
): number {
  const verificationResult = outcome === 'CONFIRMED' ? 'confirmed' : outcome === 'CONTRADICTED' ? 'contradicted' : null;
  return calculateAssessmentConfidence({
    gradingConfidences: [assessmentConfidenceBefore / 100],
    verificationResult,
  });
}

export interface EvidenceQualification {
  strength: EvidenceStrength;
  assessmentConfidence: number;
  verificationOutcome: VerificationOutcome | null;
}

/**
 * Translates a numeric Assessment Confidence (+ optional verification
 * outcome) into a human-readable evidence-strength label -- this is
 * display/interpretation only, never a mastery classification. A
 * CONTRADICTED verification always wins regardless of the numeric
 * score, since a directly contradicted answer is a different kind of
 * signal than "moderately confident."
 */
export function qualifyEvidence(assessmentConfidence: number, verificationOutcome: VerificationOutcome | null = null): EvidenceQualification {
  if (verificationOutcome === 'CONTRADICTED') {
    return { strength: 'CONTRADICTED', assessmentConfidence, verificationOutcome };
  }
  if (assessmentConfidence >= 80) return { strength: 'HIGH', assessmentConfidence, verificationOutcome };
  if (assessmentConfidence >= 55) return { strength: 'MEDIUM', assessmentConfidence, verificationOutcome };
  return { strength: 'LOW', assessmentConfidence, verificationOutcome };
}

export interface QualifiedEvidenceInput {
  studentId: string;
  conceptId: string;
  subjectId: string;
  sourceType: EvidenceSourceType;
  scorePercent: number;
  difficulty: number;
  sampleSize: number;
  activityType: ActivityType;
  evidenceMode: EvidenceMode;
  assessmentConfidence: number;
  verificationOutcome?: VerificationOutcome | null;
  verificationTriggers?: VerificationTriggerResult[];
  variantEquivalenceConfidence?: number | null;
  reasoningErrorTypes?: string[];
  assessmentProfile?: string;
}

/**
 * Step 10: produces the qualified Learning Evidence and hands it to
 * the EXISTING evidence/mastery pipeline (updateMastery ->
 * recalculateConceptKnowledgeState) -- this is the only write path in
 * this file, and it is the same call every other feature already
 * makes. confidenceWeight is scaled by Assessment Confidence (0-100 ->
 * 0-1), so low-confidence assessment evidence moves mastery less, the
 * same mechanism Phase 3 Pre-flight already uses for exam-attribution
 * granularity -- never a hardcoded weight, and never a masteryState
 * passed anywhere (updateMastery's own signature has no such
 * parameter; the deterministic algorithm + Phase 2.2 projector are the
 * only things that ever decide mastery).
 */
export async function submitQualifiedAssessmentEvidence(input: QualifiedEvidenceInput): Promise<MasteryUpdateResult> {
  const evidence: LearningEvidence = {
    result: input.scorePercent >= 70 ? 'correct' : input.scorePercent >= 50 ? 'partial' : 'incorrect',
    difficulty: input.difficulty,
    sourceType: input.sourceType,
    confidenceWeight: Math.max(0, Math.min(1, input.assessmentConfidence / 100)),
    scorePercent: input.scorePercent,
    sampleSize: input.sampleSize,
  };

  return updateMastery({
    studentId: input.studentId,
    conceptId: input.conceptId,
    subjectId: input.subjectId,
    evidence,
    telemetry: {
      activityType: 'quiz',
      // ASSESSMENT Evidence Mode is always SOLO -- matches Phase 3A's
      // own derivation (evidenceMode === 'PRACTICE' ? 'COACH' : 'SOLO').
      learningMode: 'SOLO',
    },
    metadata: {
      activityType: input.activityType,
      evidenceMode: input.evidenceMode,
      assessmentConfidence: input.assessmentConfidence,
      verificationOutcome: input.verificationOutcome ?? null,
      verificationTriggerIds: (input.verificationTriggers ?? []).map((t) => t.triggerId),
      variantEquivalenceConfidence: input.variantEquivalenceConfidence ?? null,
      reasoningErrorTypes: input.reasoningErrorTypes ?? [],
      assessmentProfile: input.assessmentProfile ?? null,
    },
  });
}

/**
 * Verification attempt persistence (migrations/030_assessment_verification.sql
 * -- NOT executed against Neon; these functions are correct-by-design
 * and covered by mocked-db unit tests, matching this codebase's
 * existing convention of inline db.query calls inside each domain's
 * service file rather than a separate repository layer).
 *
 * The "before" Assessment Confidence and the original score are
 * persisted here specifically so /api/quizzes/verify never has to
 * trust a client-supplied confidence value -- it looks up both from
 * this row instead of accepting them as request parameters.
 */
export interface PendingVerificationAttempt {
  id: string;
  quizSessionId: string;
  studentId: string;
  conceptId: string;
  verificationQuestion: unknown;
  originalScorePercent: number;
  assessmentConfidenceBefore: number;
}

export async function createPendingVerificationAttempt(params: {
  quizSessionId: string;
  studentId: string;
  conceptId: string;
  originalQuestionIndex?: number | null;
  originalQuestion: unknown;
  originalScorePercent: number;
  verificationQuestion: unknown;
  triggerIds: string[];
  originalResponse?: string | null;
  gradingConfidence?: number | null;
  variantEquivalenceConfidence?: number | null;
  assessmentConfidenceBefore: number;
}): Promise<string> {
  const result = await db.query(
    `INSERT INTO verification_attempts (
       quiz_session_id, student_id, concept_id, original_question_index, original_question,
       original_score_percent, verification_question, trigger_ids, original_response,
       grading_confidence, variant_equivalence_confidence, assessment_confidence_before
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
    [
      params.quizSessionId,
      params.studentId,
      params.conceptId,
      params.originalQuestionIndex ?? null,
      JSON.stringify(params.originalQuestion),
      params.originalScorePercent,
      JSON.stringify(params.verificationQuestion),
      JSON.stringify(params.triggerIds),
      params.originalResponse ?? null,
      params.gradingConfidence ?? null,
      params.variantEquivalenceConfidence ?? null,
      params.assessmentConfidenceBefore,
    ]
  );
  return result.rows[0].id;
}

/** The most recent unresolved verification attempt for this (quiz, concept, student) -- never another student's. */
export async function getPendingVerificationAttempt(
  quizSessionId: string,
  conceptId: string,
  studentId: string
): Promise<PendingVerificationAttempt | null> {
  const result = await db.query(
    `SELECT id, quiz_session_id, student_id, concept_id, verification_question, original_score_percent, assessment_confidence_before
     FROM verification_attempts
     WHERE quiz_session_id = $1 AND concept_id = $2 AND student_id = $3 AND outcome IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    [quizSessionId, conceptId, studentId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    quizSessionId: row.quiz_session_id,
    studentId: row.student_id,
    conceptId: row.concept_id,
    verificationQuestion: row.verification_question,
    originalScorePercent: Number(row.original_score_percent),
    assessmentConfidenceBefore: Number(row.assessment_confidence_before),
  };
}

export async function resolveVerificationAttempt(
  id: string,
  params: { verificationResponse: string; gradingConfidence: number; outcome: VerificationOutcome; assessmentConfidenceAfter: number }
): Promise<void> {
  await db.query(
    `UPDATE verification_attempts
     SET verification_response = $2, verification_grading_confidence = $3, outcome = $4, assessment_confidence_after = $5, resolved_at = NOW()
     WHERE id = $1`,
    [id, params.verificationResponse, params.gradingConfidence, params.outcome, params.assessmentConfidenceAfter]
  );
}

export interface ExamReadinessCalibration {
  predictedReadiness: number;
  actualPerformance: number;
  /** actualPerformance - predictedReadiness. Negative = underperformed prediction (e.g. time pressure, mixed-concept questions); positive = overperformed. Calibration information only -- never mutates Knowledge State. */
  calibrationDelta: number;
}

/**
 * Mock Exam only: compares actual attempt performance against the
 * already-existing exam-readiness.service.ts prediction. This is pure
 * calibration information (§14/§56) -- it never writes anywhere, and
 * is never used to adjust mastery. The caller is responsible for
 * fetching predictedReadiness via calculateExamReadiness() beforehand;
 * this function doesn't reach into that service itself so it stays
 * trivially pure and testable.
 */
export function calculateExamReadinessCalibration(predictedReadiness: number, actualPerformance: number): ExamReadinessCalibration {
  return {
    predictedReadiness,
    actualPerformance,
    calibrationDelta: actualPerformance - predictedReadiness,
  };
}
