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

import { db, type DbExecutor } from '@/lib/db';
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
import type { AIProvenance } from '@/lib/ai';
import { toResponseTimingEntries, withBehaviorMetadata, type ResponseTiming } from '@/lib/algorithms/response-timing';
import { KNOWN_COGNITIVE_LEVELS, type CognitiveLevel } from './quiz-generation.service';

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
 *
 * Phase 3C.4 (measurement-consequence fix): `wasFreshQuestion` defaults
 * to `true` for every existing caller/test, and must be explicitly
 * passed `false` when the verification question was the fallback path
 * -- the SAME item the student already answered, reused verbatim
 * because a genuinely fresh, equivalent variant could not be generated
 * (see generateQuestionVariant's documented null-on-failure contract).
 * A same-question re-ask provides no new independent evidence: the
 * student can simply recall or repeat their own prior response, so a
 * CONFIRMED outcome earned that way must not receive the same +15
 * "fresh independent confirmation" boost a genuine variant-based
 * CONFIRMED earns -- it is treated as a no-op for confidence purposes,
 * the same as INCONCLUSIVE (confidence left exactly where it was
 * before verification). A CONTRADICTED outcome is NOT weakened by this
 * -- disagreeing with your own answer to the identical question moments
 * later is, if anything, stronger evidence of unreliable evidence, not
 * weaker, so the full -25 penalty still applies regardless of question
 * freshness. This closes the "same exact memorized question" false-
 * validation path (Phase 3 Master Implementation §3C.7/§3G.4/§3G.7).
 */
export function recalculateConfidenceAfterVerification(
  assessmentConfidenceBefore: number,
  outcome: VerificationOutcome,
  wasFreshQuestion: boolean = true
): number {
  const verificationResult =
    outcome === 'CONFIRMED' ? (wasFreshQuestion ? 'confirmed' : null) : outcome === 'CONTRADICTED' ? 'contradicted' : null;
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
  /** Phase 3-R Finding 3: the question's own cognitive-level tag, when the AI generation step produced one -- carried through additively so a qualifying evidence event can genuinely contribute to the bounded cognitive-demand summary (§getAssessmentStateForConcept). Never fabricated when the source question had no tag. */
  cognitiveLevel?: CognitiveLevel | null;
  reasoningErrorTypes?: string[];
  assessmentProfile?: string;
  /** Phase 0E1: AI provenance for this evidence, when it was produced by an AI grading call (free-text verification questions only). */
  aiExecution?: AIProvenance;
  /** Phase 1D: already-normalized by the caller (normalizeResponseTiming) -- this function never re-derives or re-validates it, only carries it through additively into metadata.behavior. */
  responseTiming?: ResponseTiming;
  /**
   * Phase 2B: verification_attempts.id -- already the correct stable
   * logical identity for "resolving THIS verification attempt" (it is
   * created once, server-side, when the trigger fires, and never
   * regenerated). Required so this, the only evidence-producing path
   * in this file, is idempotent the same way every other evidence
   * writer this phase covers is; there is no legitimate reason to call
   * this function without a real verification attempt behind it.
   */
  verificationAttemptId: string;
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
    // Phase 2B: verification_attempts.id is created once, server-side,
    // when the trigger fires -- already the correct stable logical
    // identity; a resolved attempt cannot be re-resolved into a second
    // piece of cognitive evidence.
    identity: { operationType: 'VERIFICATION_RESOLUTION', operationId: input.verificationAttemptId, conceptId: input.conceptId },
    telemetry: {
      activityType: 'quiz',
      // ASSESSMENT Evidence Mode is always SOLO -- matches Phase 3A's
      // own derivation (evidenceMode === 'PRACTICE' ? 'COACH' : 'SOLO').
      learningMode: 'SOLO',
    },
    metadata: withBehaviorMetadata(
      {
        activityType: input.activityType,
        evidenceMode: input.evidenceMode,
        assessmentConfidence: input.assessmentConfidence,
        verificationOutcome: input.verificationOutcome ?? null,
        verificationTriggerIds: (input.verificationTriggers ?? []).map((t) => t.triggerId),
        variantEquivalenceConfidence: input.variantEquivalenceConfidence ?? null,
        cognitiveLevel: input.cognitiveLevel ?? null,
        reasoningErrorTypes: input.reasoningErrorTypes ?? [],
        assessmentProfile: input.assessmentProfile ?? null,
        ...(input.aiExecution ? { aiExecution: input.aiExecution } : {}),
      },
      input.responseTiming ? toResponseTimingEntries([{ timing: input.responseTiming }]) : []
    ),
    // Phase 0E2: links the resulting MASTERY_UPDATED decision_events row
    // to the AI grading execution that produced this evidence, when there
    // was one (free-text verification questions only -- see Step 15).
    aiExecutionId: input.aiExecution?.aiExecutionId ?? null,
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
  /**
   * Phase 3C.4: null exactly when the fallback-to-original path was
   * used at creation time (generateQuestionVariant failed or returned
   * a non-equivalent candidate) -- the SAME reliable signal
   * createPendingVerificationAttempt already persists for
   * variant_equivalence_confidence, now also read back so
   * /api/quizzes/verify can tell a genuinely fresh verification
   * question apart from a same-question re-ask before deciding how
   * much confidence a CONFIRMED outcome earns (see
   * recalculateConfidenceAfterVerification's wasFreshQuestion
   * parameter). No new column, no new derivation -- this is the exact
   * value already recorded at trigger time, simply exposed.
   */
  variantEquivalenceConfidence: number | null;
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
    `SELECT id, quiz_session_id, student_id, concept_id, verification_question, original_score_percent, assessment_confidence_before, variant_equivalence_confidence
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
    variantEquivalenceConfidence:
      row.variant_equivalence_confidence === null || row.variant_equivalence_confidence === undefined
        ? null
        : Number(row.variant_equivalence_confidence),
  };
}

/**
 * Phase 2B: defense-in-depth, not the primary guarantee -- the
 * evidence idempotency key on the resulting updateMastery call is what
 * actually prevents a second cognitive effect. This is a narrower,
 * additional guard against the same concurrent race (two requests
 * both reading `outcome IS NULL` before either writes) overwriting
 * verification_attempts' own outcome/response with whichever request
 * happened to finish last. `WHERE ... AND outcome IS NULL` makes the
 * UPDATE itself the atomic claim; the caller checks the returned
 * boolean rather than assuming success.
 */
export async function resolveVerificationAttempt(
  id: string,
  params: { verificationResponse: string; gradingConfidence: number; outcome: VerificationOutcome; assessmentConfidenceAfter: number }
): Promise<boolean> {
  const result = await db.query(
    `UPDATE verification_attempts
     SET verification_response = $2, verification_grading_confidence = $3, outcome = $4, assessment_confidence_after = $5, resolved_at = NOW()
     WHERE id = $1 AND outcome IS NULL`,
    [id, params.verificationResponse, params.gradingConfidence, params.outcome, params.assessmentConfidenceAfter]
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Same-question fallback SOLO_VERIFICATION rows must never count as
 * qualifying independent evidence anywhere in this summary (Phase 3-R
 * Finding 1/2/3) -- defense in depth: after the Finding 1 fix, no NEW
 * row like this is ever written (submitQualifiedAssessmentEvidence is
 * skipped entirely for a same-question fallback), but this exclusion
 * still protects every reader below against any such row that may
 * already exist. `metadata->>'variantEquivalenceConfidence' IS NULL`
 * is true both when the key is absent and when it was stored as JSON
 * `null` -- exactly "fallback was used," the same signal
 * PendingVerificationAttempt.variantEquivalenceConfidence already
 * relies on.
 */
const EXCLUDE_SAME_QUESTION_VERIFICATION_SQL = `NOT (source_type = 'SOLO_VERIFICATION' AND metadata->>'variantEquivalenceConfidence' IS NULL)`;

/** Bounded scan window for the cognitive-demand summary below -- same "recent window of rows, not full history" contract as readResponseTimingSignal's rowLimit. */
const COGNITIVE_DEMAND_SCAN_LIMIT = 30;

/**
 * Phase 3-R Finding 3: bounded FACTUAL state only -- "what cognitive
 * demand has the learner actually demonstrated under qualifying
 * independent conditions", never a competency decision. Deliberately
 * does NOT expose a `competencyScore`, `requiredLevelMet`, or any
 * curriculum-readiness judgment -- those belong to a future phase.
 *
 * `observedLevels` carries no ranking/ordering claim: this codebase
 * has no certified canonical CognitiveLevel ordering constant anywhere
 * (grepped the full source -- only the bare union type declaration in
 * quiz-generation.service.ts exists, in Bloom's-taxonomy textual order,
 * but never encoded as a ranking used by any decision logic). Rather
 * than silently fabricate a ladder, this exposes an honest bounded set
 * plus the single most recent observation (`latestObservedLevel`) --
 * a fact about the latest evidence, not a "highest" judgment. A future
 * phase that wants a genuine ranking must introduce and certify that
 * ordering explicitly, not infer it from this summary.
 */
export interface CognitiveDemandSummary {
  /** Distinct cognitive levels observed among qualifying evidence within the bounded scan window below. Empty when no qualifying, tagged evidence exists yet -- never fabricated. */
  observedLevels: CognitiveLevel[];
  /** The tag on the single most recent qualifying, cognitiveLevel-tagged evidence found in the scan window. Null when none exists (missing tags remain missing -- never guessed). */
  latestObservedLevel: CognitiveLevel | null;
  /** Count of qualifying, cognitiveLevel-tagged observations found within the bounded scan window -- NOT a lifetime total; a concept with more history than the scan window undercounts honestly rather than doing an unbounded read. */
  sampleSize: number;
  lastObservedAt: string | null;
}

/**
 * Phase 3F/3-R: a read-only, concept-scoped Assessment/Verification
 * state summary for the Digital Learning Twin/DecisionContext -- same
 * rationale and shape contract as remediation.service.ts's
 * InterventionStateSummary (Phase 2D) and validation-cycle.service.ts's
 * ConceptValidationSummary (Phase 2E): exposes just enough for a future
 * Decision Engine to tell "never independently assessed" from
 * "assessed, evidence still provisional pending verification" from
 * "assessed and confirmed independently" -- without becoming the
 * assessment/verification engine itself. Bounded, indexed queries only
 * -- no unbounded history, no per-question N+1.
 */
export interface AssessmentStateSummary {
  /**
   * Phase 3-R Finding 2 (renamed from `lastIndependentAssessment` --
   * the old name was ambiguous with the broader `lastIndependentEvidence`
   * below): this student's most recent FORMAL, trust-scored assessment
   * evidence for this concept specifically -- evidenceMode = 'ASSESSMENT'
   * (stamped by every in-app quiz/verification writer) OR a
   * REAL_SCHOOL_EXAM row (exam-result.service.ts::recordExamResult,
   * included by source_type since that legacy writer predates the
   * Phase 3A Evidence Mode system and never stamps that metadata
   * field). Deliberately narrower than `lastIndependentEvidence`:
   * quick_check/retention_check (EvidenceMode INDEPENDENT) do NOT
   * count here. Null when this concept has no formal assessment
   * evidence yet -- never fabricated from a different mode's score.
   */
  lastFormalAssessment: { scorePercent: number; occurredAt: string; activityType: string | null; sourceType: string } | null;
  /**
   * Phase 3-R Finding 2: the broader "did the student demonstrate this
   * without instructional AI assistance" signal -- EvidenceMode
   * INDEPENDENT or ASSESSMENT, or a REAL_SCHOOL_EXAM row. A strict
   * superset of `lastFormalAssessment`'s criteria, so this may report a
   * MORE RECENT row than `lastFormalAssessment` (e.g. a quick_check
   * completed after the student's last formal assessment). PRACTICE/
   * REVIEW are excluded by EvidenceMode; COACH (Explain & Defend) and
   * Transfer evidence are excluded structurally -- neither writer ever
   * stamps metadata.evidenceMode at all, so they never match this
   * filter no matter how the query is phrased. No historical evidence
   * is ever relabeled -- this reads existing metadata honestly, never
   * infers EvidenceMode retroactively for a row that never recorded it.
   */
  lastIndependentEvidence: { scorePercent: number; occurredAt: string; activityType: string | null; evidenceMode: string | null; sourceType: string } | null;
  /**
   * This student's most recent RESOLVED verification_attempts row for
   * this concept, across every quiz session. `wasFreshQuestion` (Phase
   * 3-R) makes the CONFIRMED_FRESH vs. CONFIRMED_SAME_QUESTION
   * distinction (§1.5) directly readable here, from the same two
   * already-persisted fields, without a second outcome taxonomy. Null
   * when no verification has ever fired and resolved for this concept.
   */
  lastVerification: {
    outcome: 'CONFIRMED' | 'CONTRADICTED' | 'INCONCLUSIVE';
    resolvedAt: string;
    assessmentConfidenceAfter: number | null;
    wasFreshQuestion: boolean;
  } | null;
  /** True when this concept currently has an unresolved verification_attempts row -- its most recent ASSESSMENT-mode evidence is still provisional, awaiting an independence check. */
  hasPendingVerification: boolean;
  /** Phase 3-R Finding 3 -- see CognitiveDemandSummary's own doc comment. */
  cognitiveDemand: CognitiveDemandSummary;
}

export async function getAssessmentStateForConcept(
  studentId: string,
  conceptId: string,
  client: DbExecutor = db
): Promise<AssessmentStateSummary> {
  const [lastFormal, lastIndependent, lastVerification, pending, cognitiveDemandScan] = await Promise.all([
    client.query(
      `SELECT timestamp, score_percent, activity_type, source_type FROM learning_evidence
       WHERE student_id = $1 AND concept_id = $2
         AND (metadata->>'evidenceMode' = 'ASSESSMENT' OR source_type = 'REAL_SCHOOL_EXAM')
         AND ${EXCLUDE_SAME_QUESTION_VERIFICATION_SQL}
       ORDER BY timestamp DESC LIMIT 1`,
      [studentId, conceptId]
    ),
    client.query(
      `SELECT timestamp, score_percent, activity_type, metadata->>'evidenceMode' AS evidence_mode, source_type FROM learning_evidence
       WHERE student_id = $1 AND concept_id = $2
         AND (metadata->>'evidenceMode' IN ('INDEPENDENT', 'ASSESSMENT') OR source_type = 'REAL_SCHOOL_EXAM')
         AND ${EXCLUDE_SAME_QUESTION_VERIFICATION_SQL}
       ORDER BY timestamp DESC LIMIT 1`,
      [studentId, conceptId]
    ),
    client.query(
      `SELECT outcome, resolved_at, assessment_confidence_after, variant_equivalence_confidence FROM verification_attempts
       WHERE student_id = $1 AND concept_id = $2 AND outcome IS NOT NULL
       ORDER BY resolved_at DESC LIMIT 1`,
      [studentId, conceptId]
    ),
    client.query(
      `SELECT COUNT(*)::int AS n FROM verification_attempts WHERE student_id = $1 AND concept_id = $2 AND outcome IS NULL`,
      [studentId, conceptId]
    ),
    // Phase 3-R Finding 3: bounded scan (LIMIT COGNITIVE_DEMAND_SCAN_LIMIT
    // recent rows, most-recent-first) -- never an unbounded read, never
    // a per-question follow-up query. Qualification and cognitiveLevel
    // extraction happen in JS below (see the doc comment on
    // CognitiveDemandSummary for exactly what qualifies).
    client.query(
      `SELECT timestamp, source_type, metadata FROM learning_evidence
       WHERE student_id = $1 AND concept_id = $2 AND metadata IS NOT NULL
       ORDER BY timestamp DESC LIMIT $3`,
      [studentId, conceptId, COGNITIVE_DEMAND_SCAN_LIMIT]
    ),
  ]);

  const formalRow = lastFormal.rows[0];
  const independentRow = lastIndependent.rows[0];
  const verificationRow = lastVerification.rows[0];

  // Phase 3-R Finding 3: qualification mirrors lastIndependentEvidence's
  // own criteria exactly (INDEPENDENT/ASSESSMENT EvidenceMode, or
  // REAL_SCHOOL_EXAM, excluding any same-question SOLO_VERIFICATION
  // row) -- cognitive demand is only ever derived from evidence that
  // already counts as independent proof. A cognitiveLevel tag is read
  // from `metadata.questionSemantics[].cognitiveLevel` (the original
  // multi-question quiz-submission shape) and `metadata.cognitiveLevel`
  // (the single-question SOLO_VERIFICATION shape, added this phase) --
  // only a value in KNOWN_COGNITIVE_LEVELS is ever accepted; anything
  // else (a stale/invalid tag) is silently skipped, never guessed.
  const observedLevels = new Set<CognitiveLevel>();
  let latestObservedLevel: CognitiveLevel | null = null;
  let lastObservedAt: string | null = null;
  let cognitiveSampleSize = 0;
  for (const row of cognitiveDemandScan.rows) {
    const metadata = row.metadata ?? {};
    const evidenceMode = metadata.evidenceMode ?? null;
    const sourceType = row.source_type;
    const isSameQuestionVerification =
      sourceType === 'SOLO_VERIFICATION' && (metadata.variantEquivalenceConfidence === null || metadata.variantEquivalenceConfidence === undefined);
    const qualifies = !isSameQuestionVerification && (evidenceMode === 'INDEPENDENT' || evidenceMode === 'ASSESSMENT' || sourceType === 'REAL_SCHOOL_EXAM');
    if (!qualifies) continue;

    const rawLevels: unknown[] = [];
    if (Array.isArray(metadata.questionSemantics)) {
      for (const qs of metadata.questionSemantics) {
        if (qs && typeof qs === 'object' && 'cognitiveLevel' in qs) rawLevels.push((qs as Record<string, unknown>).cognitiveLevel);
      }
    }
    if (typeof metadata.cognitiveLevel === 'string') rawLevels.push(metadata.cognitiveLevel);

    for (const raw of rawLevels) {
      if (typeof raw !== 'string' || !KNOWN_COGNITIVE_LEVELS.has(raw)) continue; // unknown/missing stays missing -- never guessed
      const level = raw as CognitiveLevel;
      observedLevels.add(level);
      cognitiveSampleSize++;
      if (latestObservedLevel === null) {
        // First qualifying, tagged row encountered = the most recent one,
        // since the scan is ORDER BY timestamp DESC.
        latestObservedLevel = level;
        lastObservedAt = row.timestamp;
      }
    }
  }

  return {
    lastFormalAssessment: formalRow
      ? {
          scorePercent: formalRow.score_percent !== null ? Number(formalRow.score_percent) : 0,
          occurredAt: formalRow.timestamp,
          activityType: formalRow.activity_type ?? null,
          sourceType: formalRow.source_type,
        }
      : null,
    lastIndependentEvidence: independentRow
      ? {
          scorePercent: independentRow.score_percent !== null ? Number(independentRow.score_percent) : 0,
          occurredAt: independentRow.timestamp,
          activityType: independentRow.activity_type ?? null,
          evidenceMode: independentRow.evidence_mode ?? null,
          sourceType: independentRow.source_type,
        }
      : null,
    lastVerification: verificationRow
      ? {
          outcome: verificationRow.outcome,
          resolvedAt: verificationRow.resolved_at,
          assessmentConfidenceAfter:
            verificationRow.assessment_confidence_after !== null ? Number(verificationRow.assessment_confidence_after) : null,
          wasFreshQuestion: verificationRow.variant_equivalence_confidence !== null && verificationRow.variant_equivalence_confidence !== undefined,
        }
      : null,
    hasPendingVerification: pending.rows[0].n > 0,
    cognitiveDemand: {
      observedLevels: Array.from(observedLevels),
      latestObservedLevel,
      sampleSize: cognitiveSampleSize,
      lastObservedAt,
    },
  };
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
