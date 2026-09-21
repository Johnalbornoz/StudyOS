/**
 * POST /api/quizzes/generate-and-take
 *
 * Complete quiz flow across 4 modes:
 * - topic_practice: one concept, everyday practice (default)
 * - quick_check: one concept, a short confidence check
 * - cumulative_assessment: several concepts across a subject, weighted
 *   toward weaker ones
 * - exam_simulation: the concepts covered by the subject's next real
 *   exam (or the whole subject if nothing is scheduled)
 *
 * 1. Generate questions (RAG-grounded, AI decides how many per concept
 *    up to an adjustable ceiling -- never padded to hit a fixed count)
 * 2. Store in database
 * 3. Return questions to student (structured questions have their
 *    correct answer/order/pairing shuffled away before sending)
 * 4. Student submits answers with quizId
 * 5. Grade: structured answers (choice/matching/ordering/classification)
 *    are graded deterministically; free-text answers go through Claude
 * 6. Update mastery per concept, log classified errors, return a full
 *    review (every question, the student's answer, the correct answer,
 *    and its explanation)
 *
 * Request body (Generate):
 * {
 *   studentId: string (uuid)
 *   subjectId: string (uuid)
 *   conceptId?: string (uuid)       -- required for topic_practice/quick_check
 *   quizMode?: 'topic_practice' | 'quick_check' | 'cumulative_assessment' | 'exam_simulation'
 *   maxQuestions?: number (1-20)     -- adjustable ceiling; AI decides the actual count up to it
 *   difficulty?: 1-5
 *   language?: string
 * }
 *
 * Request body (Submit):
 * {
 *   studentId: string (uuid)
 *   quizId: string
 *   answers: [{ questionIndex: number, answer: string }]
 * }
 */

import { randomUUID } from 'crypto';
import { NextRequest, NextResponse, after } from 'next/server';
import { verifyAuth, verifyStudentAccess, checkRateLimit, type UserRole } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { canUseCapability } from '@/lib/entitlements';
import { db } from '@/lib/db';
import {
  generateQuickCheckQuestions,
  generatePracticeQuestions,
  generateRetentionCheckQuestions,
  RETENTION_REQUIRED_COUNT,
  generateQuestionVariant,
  gradeAnswer,
  gradeStructuredAnswer,
  GeneratedQuestion,
  ALL_QUESTION_TYPES,
  IBContext,
  type QuestionType,
  type ExpectedReasoningType,
} from '@/services/quiz-generation.service';
import {
  generateGatedQuestionBatch,
  type GatedBatchInvocationDiagnostics,
} from '@/services/gated-question-generation.service';
import { generateCanonicalProveQuestions, type CanonicalProveGenerationResult } from '@/services/canonical-prove-generation.service';
import { generateCanonicalRetainQuestions, type CanonicalRetainGenerationResult } from '@/services/canonical-retain-generation.service';
import { generateCanonicalTransferChallenges, type CanonicalTransferGenerationResult } from '@/services/canonical-transfer-generation.service';
import { gradeCanonicalTransferAttempt } from '@/lib/lx/canonical-transfer-grading';
import { toCanonicalErrorCode, type CanonicalErrorCode } from '@/lib/pedagogical-decision/canonical-error-taxonomy';
import { classifyProveRetainGenerationFailure, classifyTransferGenerationFailure } from '@/lib/lx/canonical-generation-failure-classifier';
import {
  prepareCanonicalProveActivity,
  findActivePreparedActivity,
  revalidatePreparedActivity,
  consumePreparedActivity,
  invalidatePreparedActivity,
  type PreparedActivityContractSnapshot,
} from '@/services/canonical-prepared-activity.service';
import { deriveResponseEvidenceContract } from '@/lib/lx/response-evidence-contract';
import { applyResponseContractGuard } from '@/lib/lx/response-contract-grading';
import { aggregateEvidenceDifficulty, resolveTargetDifficulty } from '@/lib/lx/difficulty-contract';
import { deriveEvidenceRequirement, resolveQuestionCount } from '@/lib/lx/evidence-sufficiency-contract';
import { getActiveMasteryPolicy, getConceptKnowledgeState } from '@/services/knowledge-state.service';
import { activityTypeForQuizMode, evidenceModeForQuizMode } from '@/services/quiz-persistence.service';
import { storeQuiz, getQuizSession, completeQuiz, QuizMode, type QuizSessionV1Marker } from '@/services/quiz-persistence.service';
import {
  logCanonicalProveGenerationSummary,
  logCanonicalProveCacheSummary,
  hashStudentId,
  type CanonicalProveGenerationInvocationRecord,
  type CanonicalProveNoveltyPassRecord,
  type CanonicalProveGenerationSummary,
} from '@/lib/lx/canonical-prove-generation-observability';
import { shuffleArray, toClientQuestion } from '@/lib/quiz/client-question';
import { updateMastery } from '@/services/mastery.service';
import { getStudentMastery } from '@/services/mastery.service';
import { getIndependentMastery, shouldAskConfidence, type ConfidenceLevel } from '@/services/learner-model.service';
import { getNextOccurrence } from '@/services/assessment.service';
import { recordError } from '@/services/error-intelligence.service';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { resolveQuizLanguage } from '@/lib/i18n/language';
import { isLocale } from '@/lib/i18n/messages';
import type { LearningEvidence, EvidenceSourceType } from '@/lib/algorithms/mastery';
import { normalizeResponseTiming, toResponseTimingEntries, withBehaviorMetadata, type ResponseTiming } from '@/lib/algorithms/response-timing';
import type { AIProvenance } from '@/lib/ai';
import { recordDecisionEvent } from '@/lib/audit';
import { estimateDPGrade, estimateMYPBand } from '@/lib/ib';
import { resolveDiagnosticCheck } from '@/services/cognitive-diagnosis.service';
import { completeRemediationStep } from '@/services/remediation.service';
import { track } from '@/lib/analytics';
import {
  evaluateAssessmentEvidence,
  createPendingVerificationAttempt,
  calculateExamReadinessCalibration,
  qualifyEvidence,
  computeConceptCoverageBreadth,
  deriveConceptMappingConfidence,
  selectMostAmbiguousQuestion,
} from '@/services/assessment-verification.service';
import { calculateExamReadiness } from '@/services/exam-readiness.service';
import { getConceptAttribution } from '@/services/exam-result.service';
import { z } from 'zod';
import {
  isCanonicalEngineV1Enabled,
  verifyV1PracticeLaunchMarker,
  checkV1ActivityContractCompliance,
  getCanonicalPedagogicalDecision,
  CanonicalDecisionUnavailableError,
  resolveAuthorizedItemCount,
  type CanonicalDecisionResult,
} from '@/lib/pedagogical-decision';

// Phase 3A: single-concept quiz modes -- every other mode spans several
// concepts and is selected via selectConceptsForQuizMode/conceptIds instead.
type SingleConceptQuizMode =
  | 'topic_practice'
  | 'review'
  | 'quick_check'
  | 'retention_check'
  | 'diagnostic_check'
  | 'canonical_prove'
  | 'canonical_retain'
  | 'canonical_transfer'
  | 'canonical_learn_check';
const SINGLE_CONCEPT_MODES: readonly SingleConceptQuizMode[] = [
  'topic_practice',
  'review',
  'quick_check',
  'retention_check',
  'diagnostic_check',
  'canonical_prove',
  'canonical_retain',
  'canonical_transfer',
  'canonical_learn_check',
];
function isSingleConceptMode(mode: QuizMode): mode is SingleConceptQuizMode {
  return (SINGLE_CONCEPT_MODES as readonly QuizMode[]).includes(mode);
}

/**
 * LX-9R3-R1 OBSERVABILITY: safe, aggregate-only metadata for one
 * resolveTargetDifficulty decision -- never learner answer/question
 * content, never raw scores. `masteryState`/`criticalMisconceptionCount`
 * stand in for "journeyStage"/"supportLevel": this route does not run
 * the full Phase 4 orchestrator (LearningState/TeachingIntent) per
 * generation call -- doing so would reintroduce exactly the avoidable
 * AI/DB topology cost the prior LX-9R3 performance work removed -- so
 * the actual inputs `resolveTargetDifficulty` consulted (verbatim,
 * `decision.derivedFrom`) are logged instead of a second, redundant
 * computation of a coarser view over the SAME facts.
 */
function logDifficultyResolution(activityType: string, decision: ReturnType<typeof resolveTargetDifficulty>, knowledgeState: { masteryState: string; criticalMisconceptionCount: number } | null): void {
  try {
    // eslint-disable-next-line no-console
    console.log('[difficulty]', JSON.stringify({
      activityType,
      targetDifficulty: decision.level,
      difficultyReasonCode: decision.reasonCode,
      derivedFrom: decision.derivedFrom,
      masteryState: knowledgeState?.masteryState ?? null,
      criticalMisconceptionCount: knowledgeState?.criticalMisconceptionCount ?? null,
    }));
  } catch { /* logging must never break generation */ }
}

async function resolveLanguageForSubject(subjectId: string, studentId: string) {
  const result = await db.query(
    `SELECT target_language, quiz_language_mode FROM subjects WHERE id = $1`,
    [subjectId]
  );
  const subject = result.rows[0] || {};
  const interfaceLanguage = await getInterfaceLanguage(studentId);
  return resolveQuizLanguage(subject, interfaceLanguage);
}

async function getSubjectIBContext(subjectId: string): Promise<IBContext | null> {
  const result = await db.query(
    `SELECT ib_programme, ib_subject_group, ib_level FROM subjects WHERE id = $1`,
    [subjectId]
  );
  const row = result.rows[0];
  if (!row || row.ib_programme === 'none') return null;
  return { programme: row.ib_programme, subjectGroup: row.ib_subject_group, level: row.ib_level };
}

/**
 * Every mode offers Claude the full 18-type catalog -- it isn't
 * restricted to a fixed subset. `guidance` steers the STYLE and rigor
 * (how fast, how demanding), but which specific types actually get
 * used within that is Claude's call per question, based on what each
 * piece of content calls for.
 */
const QUIZ_MODE_CONFIG: Record<
  QuizMode,
  { guidance: string; defaultMax: number; visualAidRate: number; evidenceSource: EvidenceSourceType }
> = {
  quick_check: {
    guidance:
      'A fast, low-friction confidence check. Prefer quick-to-answer types (multiple_choice, true_false, yes_no, short_answer) -- avoid long multi-step or open-ended types here.',
    defaultMax: 6,
    visualAidRate: 0,
    evidenceSource: 'PRACTICE_QUESTION',
  },
  topic_practice: {
    guidance: 'Everyday practice on this concept. Use a natural mix of types that fit the material -- don\'t default to only multiple_choice.',
    defaultMax: 20,
    visualAidRate: 0.1,
    evidenceSource: 'PRACTICE_QUIZ',
  },
  review: {
    // Reinforcement Review (Activity Type REVIEW, Evidence Mode
    // PRACTICE) -- same cognitive shape as topic_practice, AI may
    // assist. Distinct from retention_check below, which is the other,
    // unassisted, "prove you still remember" flavor of Review.
    guidance: 'Everyday practice on this concept. Use a natural mix of types that fit the material -- don\'t default to only multiple_choice.',
    defaultMax: 20,
    visualAidRate: 0.1,
    evidenceSource: 'PRACTICE_QUIZ',
  },
  retention_check: {
    // Retention Review (Activity Type RETENTION_CHECK, Evidence Mode
    // INDEPENDENT) -- StudyUS needs unassisted proof the student still
    // remembers, so this is short and low-friction like quick_check,
    // just tagged with a different Activity Type/Evidence Mode.
    guidance:
      'A fast, low-friction confidence check. Prefer quick-to-answer types (multiple_choice, true_false, yes_no, short_answer) -- avoid long multi-step or open-ended types here.',
    defaultMax: 6,
    visualAidRate: 0,
    evidenceSource: 'PRACTICE_QUESTION',
  },
  cumulative_assessment: {
    guidance:
      'A broader check spanning several concepts. Favor types that test connections and application across ideas (comparison, classification, matching, case_study) alongside standard types, whatever each concept\'s content actually supports.',
    defaultMax: 20,
    visualAidRate: 0.15,
    evidenceSource: 'CUMULATIVE_ASSESSMENT',
  },
  exam_simulation: {
    guidance:
      'Simulate real exam rigor. Favor the most demanding types this material genuinely supports (step_by_step, case_study, error_detection, justification, numeric_problem, scenario) as well as standard types -- but never force a type onto content that doesn\'t suit it.',
    defaultMax: 20,
    visualAidRate: 0.2,
    evidenceSource: 'EXAM_SIMULATION',
  },
  diagnostic_check: {
    guidance:
      'This is a short DIAGNOSTIC check, not a teaching moment -- its only job is to reveal whether the student genuinely understands this concept independently. Prefer types that can\'t be answered by pattern-matching or formula-plugging alone (short_answer, error_detection, justification, prediction) and are hard to guess. Keep each question tightly focused on the core idea of this concept, not tangential details.',
    defaultMax: 3,
    visualAidRate: 0,
    evidenceSource: 'DIAGNOSTIC',
  },
  // CANON-R6 -- the exact-10, independent canonical v1 Prove check.
  // `defaultMax` is never actually consulted for a genuinely
  // v1-authorized request (the server-derived override below always
  // forces exactly `v1Marker.itemCount.authorized`, 10 today) -- it
  // exists only so this Record stays total and so an unauthorized
  // `canonical_prove` request (rejected before generation, see the
  // v1Marker guard) never needs to reach this value at all. Reuses the
  // SAME question-type catalog and generation prompt shape as
  // quick_check (no new prompt template) -- guidance text differs only
  // to reflect the higher item count and higher stakes; no AI provider,
  // routing, or Quality Gate code was touched.
  canonical_prove: {
    // CANON-R6R1 Part 9 -- the trailing sentence is a lightweight,
    // isolated generation-guidance nudge only (reduces churn/retries);
    // it is NEVER the enforcement mechanism -- exact-duplicate exclusion
    // is a deterministic post-generation server check
    // (`filterExactDuplicates`, run inside
    // `generateCanonicalProveQuestions` -- CANON-R6-PERF-R1/R2), which
    // runs regardless of whether Claude actually honored this text.
    guidance:
      'This is an independent mastery check -- the student demonstrates they can do this ALONE, with no help. Prefer types that cannot be answered by pattern-matching or formula-plugging alone (short_answer, error_detection, justification, prediction) and are hard to guess, the same rigor as a diagnostic check but across a full independent set. Keep each question tightly focused on the core idea of this concept. Write NEW questions -- do not repeat a question the student has already been asked while practicing this concept.',
    defaultMax: 10,
    visualAidRate: 0,
    evidenceSource: 'SOLO_VERIFICATION',
  },
  // CANON-V2-ARCH-CLEANUP -- the exact-10, independent, NOVEL canonical
  // v1 Retain check. `defaultMax` is never actually consulted for a
  // genuinely v1-authorized request (same reasoning as canonical_prove
  // above).
  canonical_retain: {
    guidance:
      'This is an independent retention check -- verify the student still genuinely remembers this concept, unaided, using NEW questions they have never seen before (never a repeat of a prior practice/prove/retain question, even reworded). Prefer types that cannot be answered by pattern-matching or formula-plugging alone (short_answer, error_detection, justification, prediction) and are hard to guess. Keep each question tightly focused on the core idea of this concept.',
    defaultMax: 10,
    visualAidRate: 0,
    evidenceSource: 'SOLO_VERIFICATION',
  },
  // CANON-V2-ARCH-CLEANUP -- the ONE canonical Transfer mode: exactly 3
  // structured, independent challenges. `defaultMax` is never consulted
  // (canonical-transfer-generation.service.ts always requests exactly
  // 3) -- present only so this Record stays total.
  canonical_transfer: {
    guidance:
      'This is an independent Transfer check -- the student must apply this concept, unaided, in contexts progressively further from how it was originally taught. Every challenge requires the student to show their reasoning, not just a final answer.',
    defaultMax: 3,
    visualAidRate: 0,
    evidenceSource: 'SOLO_VERIFICATION',
  },
  // CANON-V2-ARCH-CLEANUP -- the ONE canonical LEARN comprehension
  // checkpoint: assisted, small, focused entirely on verifying genuine
  // understanding (never a generic practice quiz relabeled).
  canonical_learn_check: {
    guidance:
      'This is a comprehension checkpoint, not a practice drill -- verify the student genuinely understands the core idea of this concept (assistance/hints are allowed; the goal is confirming understanding, not testing independence). Prefer types that reveal genuine comprehension rather than pattern-matching (short_answer, error_detection, justification).',
    defaultMax: 5,
    visualAidRate: 0,
    evidenceSource: 'PRACTICE_QUESTION',
  },
};

const GenerateQuizSchema = z.object({
  studentId: z.string().uuid(),
  subjectId: z.string().uuid(),
  conceptId: z.string().uuid().optional(),
  conceptIds: z.array(z.string().uuid()).optional(), // manual topic selection for cumulative_assessment/exam_simulation
  quizMode: z.enum([
    'topic_practice',
    'review',
    'quick_check',
    'retention_check',
    'cumulative_assessment',
    'exam_simulation',
    'diagnostic_check',
    'canonical_prove',
    'canonical_retain',
    'canonical_transfer',
    'canonical_learn_check',
  ]).default('topic_practice'),
  maxQuestions: z.number().int().min(1).max(20).optional(),
  difficulty: z.number().int().min(1).max(5).optional(),
  language: z.string().optional(),
  /**
   * CANON-R5R1 -- an INTENT signal only, set exclusively by
   * `resolveCanonicalLaunch`'s own launch URL (session start), never
   * authoritative by itself: `handleGenerateQuiz` always independently
   * re-verifies via a fresh `getCanonicalPedagogicalDecision` call
   * before ever stamping v1 evidence (see
   * verifyV1PracticeLaunchMarker's own doc comment). A legacy caller
   * that never sets this flag can never become v1-stamped, whatever its
   * concept's current canonical stage happens to be.
   */
  v1Launch: z.boolean().optional(),
});

const SubmitQuizSchema = z.object({
  studentId: z.string().uuid(),
  quizId: z.string(),
  // Only meaningful when this quiz's mode is diagnostic_check -- tells
  // the submit handler which cognitive_diagnoses row to resolve based
  // on this attempt's result. The diagnosis id isn't persisted on
  // quiz_sessions itself (no migration needed); the caller already
  // knows it from when it started the check.
  diagnosisId: z.string().uuid().optional(),
  // When this quiz was launched as a remediation step (GUIDED_PRACTICE,
  // RETRIEVAL, or SOLO_VERIFY), completing it also advances that step.
  remediationStepId: z.string().uuid().optional(),
  answers: z.array(
    z.object({
      questionIndex: z.number().int().min(0),
      answer: z.string(),
      // Self-reported, captured client-side before the student saw
      // whether they were right -- only present on questions the
      // generate step flagged with askConfidence.
      confidence: z.enum(['NOT_SURE', 'SOMEWHAT_SURE', 'VERY_SURE']).optional(),
      // Phase 1D: client-measured presentation/submission timestamps for
      // this one question -- deliberately loose (plain optional strings,
      // not z.string().datetime()) so a malformed/missing timestamp can
      // never fail Zod validation and block the actual answer submission.
      // normalizeResponseTiming (below) is what validates these, and it
      // always degrades to a quality label rather than throwing.
      questionPresentedAt: z.string().optional(),
      answerSubmittedAt: z.string().optional(),
    })
  ),
});

export async function POST(request: NextRequest) {
  try {
    const authContext = await verifyAuth();
    if (!authContext) {
      return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Authentication required' }, { status: 401 });
    }

    const body = await request.json();

    if (!body.quizId) {
      // F15 -- this is the single highest AI-cost endpoint in the app
      // (real generation per call); every other route in this codebase
      // that mutates/spends AI budget already rate-limits per user
      // (see record-evidence/route.ts) -- this one previously did not.
      // 30/min is generous for real usage (a student moving between
      // concepts/quiz modes) while bounding a scripted abuse loop.
      if (!checkRateLimit(authContext.userId, '/api/quizzes/generate-and-take:generate', 30, 60)) {
        return NextResponse.json({ error: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' }, { status: 429 });
      }
      return await handleGenerateQuiz(body, authContext.userId, authContext.role);
    } else {
      return await handleSubmitQuiz(body, authContext.userId, authContext.role);
    }
  } catch (error) {
    console.error('Error in quiz flow:', error);
    return NextResponse.json(
      {
        error: 'INTERNAL_ERROR',
        message: 'Failed to process quiz',
        details: process.env.NODE_ENV === 'development' ? String(error) : undefined,
      },
      { status: 500 }
    );
  }
}

// LX-4P-R2: shuffleArray + toClientQuestion moved to
// `@/lib/quiz/client-question` so the same-item localization endpoint
// reshapes a localized question exactly as the original was reshaped.

/**
 * Decides, per concept, whether the first question about it in this
 * quiz should ask the student to self-report confidence first (see
 * shouldAskConfidence in learner-model.service.ts for the rule and
 * why). One DB round trip for mastery_records regardless of concept
 * count, plus one getIndependentMastery call per concept (bounded by
 * maxQuestions, same pattern already used for question generation
 * itself just above this function's call site).
 */
async function computeAskConfidenceFlags(
  studentId: string,
  conceptIds: string[],
  quizMode: QuizMode
): Promise<Map<string, boolean>> {
  // A Diagnostic Check is a deliberately minimal, single-purpose
  // interaction (see quiz-generation guidance) -- it's testing the
  // candidate concept, not a moment to also calibrate confidence.
  if (quizMode === 'diagnostic_check') return new Map(conceptIds.map((id) => [id, false]));

  const masteryRows = await db.query(
    `SELECT concept_id, mastery_score, attempt_count FROM mastery_records WHERE student_id = $1 AND concept_id = ANY($2)`,
    [studentId, conceptIds]
  );
  const masteryByConcept = new Map(masteryRows.rows.map((r) => [r.concept_id as string, r]));
  const independentMasteries = await Promise.all(conceptIds.map((cId) => getIndependentMastery(studentId, cId)));

  const flags = new Map<string, boolean>();
  conceptIds.forEach((cId, i) => {
    const row = masteryByConcept.get(cId);
    flags.set(
      cId,
      shouldAskConfidence({
        quizMode,
        hasExistingMasteryRecord: !!row,
        masteryScore: row ? Number(row.mastery_score) : null,
        independentMastery: independentMasteries[i],
        attemptCount: row ? Number(row.attempt_count) : 0,
      })
    );
  });
  return flags;
}

/** Select which concepts a multi-concept quiz (cumulative/exam sim) covers. */
async function selectConceptsForQuizMode(
  quizMode: 'cumulative_assessment' | 'exam_simulation',
  studentId: string,
  subjectId: string,
  maxConcepts: number,
  language: string
): Promise<string[]> {
  if (quizMode === 'exam_simulation') {
    const occurrence = await getNextOccurrence(subjectId).catch(() => null);
    if (occurrence && occurrence.topics.length > 0) {
      return occurrence.topics.slice(0, maxConcepts);
    }
  }
  const mastery = await getStudentMastery(studentId, subjectId, language).catch(() => []);
  return mastery
    .slice()
    .sort((a: any, b: any) => Number(a.mastery_score) - Number(b.mastery_score))
    .map((m: any) => m.concept_id)
    .slice(0, maxConcepts);
}

async function handleGenerateQuiz(body: any, userId: string, role: UserRole) {
  // CANON-R6-PERF-I1 -- instrumentation-only state. `validated` itself
  // is NOT hoisted/retyped (it stays a plain `const` inside the try
  // block below, exactly as before this phase) so every existing
  // closure in this function that narrows/captures it is completely
  // unaffected. `rawQuizModeForErrorLogging` is read directly from the
  // raw, unvalidated `body` only so the outer catch (an unexpected
  // error, where schema validation may not even have completed) can
  // still decide whether a best-effort error summary applies to
  // canonical_prove -- it is NEVER used for anything but that decision.
  const requestStartedAt = Date.now();
  const rawQuizModeForErrorLogging: unknown = body?.quizMode;
  let canonicalAuthorizationMs: number | null = null;
  let priorHistoryMs: number | null = null;
  let noveltyFilterMs = 0;
  let persistenceMs: number | null = null;
  const generationInvocations: CanonicalProveGenerationInvocationRecord[] = [];
  const noveltyPasses: CanonicalProveNoveltyPassRecord[] = [];
  // CANON-R6-PERF-R1 -- concurrent-chunking observability state.
  let chunkPlan: number[] = [];
  let generationConcurrentMs: number | null = null;
  let aggregateRecoveryUsed = false;
  let aggregateRecoveryRequestedCount: number | null = null;
  let aggregateRecoveryMs: number | null = null;
  // CANON-R6-PERF-R2 -- prepared-activity cache-path observability state.
  let preparedLookupMs: number | null = null;
  let preparedValidationMs: number | null = null;
  let sessionCreationMs: number | null = null;
  let preparedCacheStatus: 'HIT' | 'MISS' | 'PREPARING' | 'INVALID' | 'EXPIRED' | 'FAILED' | null = null;
  let preparedConsumptionCandidateId: string | null = null;
  let preparedActivityFingerprintCount: number | null = null;
  let proveGenerationResult: CanonicalProveGenerationResult | null = null;
  // CANON-V2-ARCH-CLEANUP -- the Retain analog of `proveGenerationResult`,
  // captured only for a `canonical_retain` request (no prepared-activity
  // cache path exists for Retain -- that is a Prove-only performance
  // feature, CANON-R6-PERF-R2, out of scope here; every canonical_retain
  // request always runs the live generator below).
  let retainGenerationResult: CanonicalRetainGenerationResult | null = null;
  // CANON-V2-ARCH-CLEANUP Section 9 -- captured only for a
  // canonical_transfer request. No prepared-activity cache exists for
  // Transfer either (Prove-only performance feature) -- always a live
  // generation call.
  let transferGenerationResult: CanonicalTransferGenerationResult | null = null;

  try {
    const validated = GenerateQuizSchema.parse(body);

    const canAccess = await verifyStudentAccess(userId, validated.studentId, role);
    if (!canAccess) {
      return NextResponse.json({ error: 'FORBIDDEN', message: 'Cannot access this student' }, { status: 403 });
    }

    // AI quiz generation is a paid capability -- gated server-side,
    // never only hidden in the UI. An unlicensed Student's DEMO access
    // does not include on-demand AI-generated quizzes.
    const generateActor = await getOrCreateCanonicalUser(userId);
    const generateEntitled = await canUseCapability(generateActor.id, validated.studentId, 'LEARNING_FULL_ACCESS');
    if (!generateEntitled) {
      return NextResponse.json({ error: 'ENTITLEMENT_REQUIRED' }, { status: 403 });
    }

    if (isSingleConceptMode(validated.quizMode) && !validated.conceptId) {
      return NextResponse.json(
        { error: 'INVALID_INPUT', message: 'conceptId is required for this quiz mode' },
        { status: 400 }
      );
    }

    // CANON-R5R1/R6 Part 2/6/20/24/25 -- the client's `v1Launch` flag is
    // only an INTENT signal (set exclusively by resolveCanonicalLaunch's
    // own launch URL). It is never trusted on its own: only when the
    // gate is on, the flag is present, AND a FRESH canonical decision
    // independently confirms this exact (studentId, conceptId) pair is
    // genuinely an EXECUTABLE v1 activity matching the REQUESTED mode
    // does this session get stamped v1. `requestedActivityType` is
    // derived purely from the request's own `quizMode` (never from any
    // client-claimed stage) -- `topic_practice` requests PRACTICE (or
    // its REINFORCE overlay), `canonical_prove` requests PROVE ONLY.
    // A request for `canonical_prove` whose fresh decision resolves to
    // anything else (wrong stage: PRACTICE/RETAIN/LEARN/TRANSFER, or a
    // non-EXECUTABLE actionState) is REJECTED, never silently downgraded
    // or upgraded to whatever the true stage is (Part 25: "No
    // downgrade/upgrade"). Any other case (flag absent, gate off, wrong
    // mode/stage, or re-verification fails) yields `v1Marker: null`.
    // CANON-R6-PERF-I1 -- times ONLY the canonical re-verification call
    // (verifyV1PracticeLaunchMarker's own DB reads); the result is read
    // only by the canonical_prove summary emitted at the bottom of this
    // function, so this adds two `Date.now()` calls and nothing else
    // for every other quizMode/request shape.
    const canonicalAuthorizationStartedAt = Date.now();
    // CANON-V2-ARCH-CLEANUP -- widened to every canonical mode this
    // route now implements (Section 6/7: the implementation registry is
    // total). Each canonical_* mode requests EXACTLY its own activity
    // type -- never any other -- same "no downgrade/upgrade" rule
    // CANON-R6 already established for canonical_prove.
    const requestedActivityType: 'PRACTICE' | 'PROVE' | 'RETENTION_CHECK' | 'TRANSFER' | 'LEARN_CHECK' | null =
      validated.quizMode === 'topic_practice'
        ? 'PRACTICE'
        : validated.quizMode === 'canonical_prove'
        ? 'PROVE'
        : validated.quizMode === 'canonical_retain'
        ? 'RETENTION_CHECK'
        : validated.quizMode === 'canonical_transfer'
        ? 'TRANSFER'
        : validated.quizMode === 'canonical_learn_check'
        ? 'LEARN_CHECK'
        : null;
    const rawV1Marker =
      validated.v1Launch === true && isCanonicalEngineV1Enabled() && requestedActivityType && validated.conceptId
        ? await verifyV1PracticeLaunchMarker({ studentId: validated.studentId, conceptId: validated.conceptId })
        : null;
    // A REINFORCE overlay is presented as an ordinary Practice-shaped
    // activity -- it satisfies a `topic_practice` request; every other
    // canonical activity type never satisfies anything but its own exact
    // `canonical_*` request, and vice versa.
    const v1Marker =
      rawV1Marker &&
      (rawV1Marker.canonicalActivityType === requestedActivityType ||
        (requestedActivityType === 'PRACTICE' && rawV1Marker.canonicalActivityType === 'REINFORCE'))
        ? rawV1Marker
        : null;
    canonicalAuthorizationMs = Date.now() - canonicalAuthorizationStartedAt;

    // CANON-R6/CANON-V2-ARCH-CLEANUP Part 24/29 -- no `canonical_*` mode
    // has a legitimate legacy meaning (unlike `topic_practice`, which is
    // also a real legacy mode): a request for one that fails
    // verification/matching above is refused outright, never silently
    // generated with this mode's own generic `defaultMax`/guidance as if
    // it were some other kind of activity (that would be exactly
    // "relabel an incomplete/unauthorized quiz as legacy quick_check
    // after session authorization," Part 29's own prohibition,
    // generalized to every canonical_* mode).
    if (validated.quizMode === 'canonical_prove' && !v1Marker) {
      return NextResponse.json(
        { error: 'V1_PROVE_AUTHORIZATION_FAILED', canonicalErrorCode: toCanonicalErrorCode('V1_PROVE_AUTHORIZATION_FAILED').code, message: 'This concept is not currently authorized for an independent Prove check.' },
        { status: 403 }
      );
    }
    if (validated.quizMode === 'canonical_retain' && !v1Marker) {
      return NextResponse.json(
        { error: 'V1_RETAIN_AUTHORIZATION_FAILED', canonicalErrorCode: toCanonicalErrorCode('V1_RETAIN_AUTHORIZATION_FAILED').code, message: 'This concept is not currently authorized for a Retain check.' },
        { status: 403 }
      );
    }
    if (validated.quizMode === 'canonical_transfer' && !v1Marker) {
      return NextResponse.json(
        { error: 'V1_TRANSFER_AUTHORIZATION_FAILED', canonicalErrorCode: toCanonicalErrorCode('V1_TRANSFER_AUTHORIZATION_FAILED').code, message: 'This concept is not currently authorized for a Transfer challenge.' },
        { status: 403 }
      );
    }
    if (validated.quizMode === 'canonical_learn_check' && !v1Marker) {
      return NextResponse.json(
        { error: 'V1_LEARN_CHECK_AUTHORIZATION_FAILED', canonicalErrorCode: toCanonicalErrorCode('V1_LEARN_CHECK_AUTHORIZATION_FAILED').code, message: 'This concept is not currently authorized for a comprehension checkpoint.' },
        { status: 403 }
      );
    }

    const language = isLocale(validated.language)
      ? validated.language
      : await resolveLanguageForSubject(validated.subjectId, validated.studentId);
    const ibContext = await getSubjectIBContext(validated.subjectId);

    const config = QUIZ_MODE_CONFIG[validated.quizMode];
    // Diagnostic Check is always short (2-4 questions) regardless of what was requested -- it's a targeted check, not a full quiz.
    // quick_check is always exactly 6 (STABILIZATION QUIZ PERFORMANCE Step 9): its dedicated
    // fast path (generateQuickCheckQuestions) is an audited, fixed 6-slot/4-type plan, not a
    // caller-configurable count -- a maxQuestions override is no longer honored for this mode.
    let maxQuestions =
      validated.quizMode === 'quick_check'
        ? 6
        : validated.quizMode === 'diagnostic_check'
        ? Math.max(2, Math.min(4, validated.maxQuestions ?? config.defaultMax))
        : Math.max(1, Math.min(20, validated.maxQuestions ?? config.defaultMax));

    // LX-4R R8: for a canonical single-concept PRACTICE / PROVE flow the
    // question count derives from the CANONICAL evidence gap
    // (mastery_policies minimum - what the learner already has), via
    // deriveEvidenceRequirement / resolveQuestionCount. RETAIN /
    // TRANSFER / DIAGNOSE / ASSESS stay on their existing execution
    // defaults (the contract returns UNRESOLVED for them -- an
    // execution default is not pedagogical truth).
    let countAuthority: {
      status: 'CANONICAL_GAP' | 'EXECUTION_DEFAULT';
      pedagogicalRequirement?: number;
      executionMinimum?: number;
      source?: string;
      zeroGapMismatch?: boolean;
    } = { status: 'EXECUTION_DEFAULT' };
    // LX-9R3-R1 D2: the ONE canonical target-difficulty authority for
    // this request -- resolveTargetDifficulty(activityType, Knowledge
    // State). `null` only when this isn't a single-concept canonical
    // flow (multi-concept cumulative/exam paths resolve their own,
    // per-concept, at their own generation call site below). A caller
    // that explicitly sends `validated.difficulty` (the pre-existing,
    // separately-gated manual/legacy setup path -- LX-4's `setup=1`
    // slider) still overrides this at every call site (`??`, never
    // silently discarded) -- this authority only replaces the STATIC
    // `|| 3` fallback for ordinary canonical requests, which never send one.
    let resolvedDifficulty: ReturnType<typeof resolveTargetDifficulty> | null = null;
    if (validated.quizMode === 'diagnostic_check') {
      resolvedDifficulty = resolveTargetDifficulty({ activityType: 'DIAGNOSTIC_CHECK', knowledgeState: null });
      logDifficultyResolution('DIAGNOSTIC_CHECK', resolvedDifficulty, null);
    }
    if (
      isSingleConceptMode(validated.quizMode) &&
      validated.conceptId &&
      validated.quizMode !== 'diagnostic_check'
    ) {
      try {
        const activityType = activityTypeForQuizMode(validated.quizMode);
        const policy = await getActiveMasteryPolicy();
        const ks = await getConceptKnowledgeState(validated.studentId, validated.conceptId).catch(() => null);
        const ksForDifficulty = ks ? { masteryState: ks.masteryState, criticalMisconceptionCount: ks.criticalMisconceptionCount } : null;
        resolvedDifficulty = resolveTargetDifficulty({ activityType, knowledgeState: ksForDifficulty });
        logDifficultyResolution(activityType, resolvedDifficulty, ksForDifficulty);
        const requirement = deriveEvidenceRequirement({
          activityType,
          evidenceMode: evidenceModeForQuizMode(validated.quizMode),
          targetDimension: 'UNDERSTANDING',
          masteryPolicy: policy,
          currentSufficiency: ks
            ? {
                evidenceCount: ks.evidenceCount,
                independentEvidenceCount: ks.independentEvidenceCount,
                passed:
                  ks.evidenceCount >= policy.minimumEvidenceCount &&
                  ks.independentEvidenceCount >= policy.minimumIndependentEvidenceCount,
              }
            : null,
        });
        const resolved = resolveQuestionCount(requirement);
        if (resolved.status === 'DETERMINED' && requirement.questionCount.status === 'DETERMINED') {
          const gap = requirement.questionCount.pedagogicalRequirement;
          const zeroGapMismatch = gap === 0;
          if (zeroGapMismatch && (activityType === 'PRACTICE' || activityType === 'REVIEW')) {
            // LX-9R8 PART A1/C: this is no longer a mere count anomaly --
            // a zero-gap PRACTICE/REVIEW request is NOT an executable
            // canonical action at all, unless a REINFORCE-justified
            // reason (misconception/prerequisite/repair) explains it.
            // route.ts has no full LearningDecision/signals here (only
            // the already-fetched KnowledgeState), so this is a
            // deliberately CONSERVATIVE, KnowledgeState-only backstop --
            // the primary prevention is upstream (My Path/Today/Concept
            // Mission/continuation, LX-9R8 Parts A5-A8), which never
            // offer this CTA in the first place. This check exists so a
            // client bypass can never still reach Luna/Terra.
            const hasReinforceSignal = !!ks && (ks.criticalMisconceptionCount > 0 || ks.masteryState === 'INTERVENTION_REQUIRED');
            // CANON-R5R1B Part 0/4 -- ONE AUTHORITY RULE. `v1Marker`
            // (computed above, BEFORE this block, from a FRESH
            // `getCanonicalPedagogicalDecision` + `resolveV1PracticeEligibility`
            // re-verification -- never from the client's own `v1Launch`
            // claim alone) is the sole pedagogical authority for this
            // exact (studentId, conceptId) pair once it exists. This
            // legacy, KnowledgeState-only zero-gap backstop may still run
            // and log for diagnostics, but it must never VETO a request
            // the fresh canonical decision already authorized as
            // EXECUTABLE Practice -- that was the live Preview defect
            // this phase fixes (session/start returns PRACTICE/EXECUTABLE,
            // then generate-and-take's own independent re-verification
            // agrees and sets `v1Marker`, yet this 409 fired anyway).
            // `v1Marker` is `null` for every other case (gate off, no
            // `v1Launch` intent, wrong quizMode, wrong canonical stage,
            // WAITING/BLOCKED, or a re-verification that itself failed
            // or disagreed) -- so a forged/stale `v1Launch` alone can
            // never reach this branch; only a genuine, fresh,
            // independently-confirmed authorization can.
            if (!hasReinforceSignal && !v1Marker) {
              console.log('[generation]', JSON.stringify({
                conceptId: validated.conceptId,
                quizMode: validated.quizMode,
                generationPhase: 'INVALID_GENERATION_CONTRACT',
                sessionCreated: false,
                errorCode: 'INVALID_GENERATION_CONTRACT',
                reason: 'ZERO_GAP_PRACTICE_MISMATCH',
              }));
              // RELEASE-R1 PART D: this is a canonical-state MISMATCH, not
              // a generation failure -- the machine-readable `reason` is
              // now surfaced in the response body itself (previously only
              // in the server log), so the client can distinguish it from
              // a genuine AI/provider failure and show the correct
              // "your next step changed" recovery UX instead of a
              // generic "couldn't prepare this activity" error screen.
              // 409 (not 500): the request itself is well-formed: it is
              // canonical STATE that no longer permits it.
              return NextResponse.json(
                { error: 'INVALID_GENERATION_CONTRACT', reason: 'ZERO_GAP_PRACTICE_MISMATCH', message: 'This activity is no longer your next canonical step.' },
                { status: 409 }
              );
            }
            if (v1Marker && !hasReinforceSignal) {
              // CANON-R5R1B: diagnostics only -- generation continues
              // under canonical v1 authority; R5R1A's own override
              // (later in this function) still forces the actual
              // maxQuestions/difficulty from `v1Marker`'s contract, so
              // nothing about the legacy `resolved.count`/`countAuthority`
              // computed just below this block is ever actually used for
              // a v1-authorized request.
              console.log('[canon-r5r1b]', JSON.stringify({
                conceptId: validated.conceptId,
                quizMode: validated.quizMode,
                reason: 'ZERO_GAP_LEGACY_AUTHORITY_BYPASSED_BY_V1',
                canonicalRevision: v1Marker.canonicalRevision,
              }));
            } else {
              // R8: a genuine REINFORCE signal justifies running the
              // execution minimum anyway (0 questions is not a runnable
              // activity) -- surface the authority mismatch, never silent.
              console.warn(
                `[LX-4R R8] question-count authority mismatch: canonical evidence gap for concept ${validated.conceptId} (${validated.quizMode}) is 0, but a REINFORCE signal justifies running this activity. Running executionMinimum ${requirement.questionCount.executionMinimum}; not treated as a pedagogical requirement.`,
              );
            }
          }
          maxQuestions = resolved.count;
          countAuthority = {
            status: 'CANONICAL_GAP',
            pedagogicalRequirement: gap,
            executionMinimum: requirement.questionCount.executionMinimum,
            source: requirement.questionCount.source,
            zeroGapMismatch,
          };
        }
      } catch (e) {
        console.error('[LX-4R R8] evidence-requirement resolution failed, using execution default:', e);
      }
    }

    // CANON-R5R1A Part 0/3/4/7 -- PRIMARY INVARIANT: for a genuinely
    // authorized v1 Practice session, the server's own canonical
    // `activityContract` REPLACES whatever count/difficulty the legacy
    // LX-4R evidence-gap logic above (or any client-supplied value)
    // computed -- never merged, never deferred to. This is the ONLY
    // place `maxQuestions`/the difficulty actually sent to the generator
    // are finalized for a v1-authorized request; every generator call
    // site below reads `v1EffectiveDifficulty ?? validated.difficulty ??
    // resolvedDifficulty?.level ?? 3`, so a v1-authorized request's
    // client-supplied `difficulty` (or the legacy LX-4R target) is never
    // reached. `v1Marker` is `null` for every legacy/non-Practice/
    // ineligible request (computed above), so this block is a total
    // no-op for every one of them -- Part 8's "legacy flow unchanged."
    let v1EffectiveDifficulty: number | undefined;
    if (v1Marker) {
      // CANON-V2-ARCH-CLEANUP -- `itemCount` is `null` only for
      // LEARN_CHECK (the engine deliberately reports no canonical
      // item-count authority for the comprehension checkpoint): leave
      // `maxQuestions` exactly as the execution-default/canonical-gap
      // logic above already resolved it, never invent a count here.
      if (v1Marker.itemCount) maxQuestions = v1Marker.itemCount.authorized;
      v1EffectiveDifficulty = v1Marker.difficulty.target;
    }

    let conceptIds: string[];
    let primaryConceptId: string | null;

    if (isSingleConceptMode(validated.quizMode)) {
      conceptIds = [validated.conceptId!];
      primaryConceptId = validated.conceptId!;
    } else if (validated.conceptIds && validated.conceptIds.length > 0) {
      // Student picked specific topics instead of the automatic
      // weakest-first/scheduled-exam selection below.
      conceptIds = validated.conceptIds.slice(0, maxQuestions);
      primaryConceptId = null;
    } else {
      conceptIds = await selectConceptsForQuizMode(
        validated.quizMode,
        validated.studentId,
        validated.subjectId,
        maxQuestions,
        language
      );
      primaryConceptId = null;
      if (conceptIds.length === 0) {
        return NextResponse.json(
          {
            error: 'NO_CONCEPTS',
            message: 'This subject has no studied concepts yet -- upload content and practice a bit first.',
          },
          { status: 400 }
        );
      }
    }

    const perConceptCap = Math.max(1, Math.ceil(maxQuestions / conceptIds.length));
    // LX-9R6-R1 O1/O3: ONE operationId for this whole generation request,
    // threaded into every generator call below so every per-concept
    // `[practice]`/`[gated_batch]` line (there can be more than one for
    // cumulative_assessment/exam_simulation) is correlatable back to the
    // SAME top-level request. quick_check/retention_check mint their own
    // operationId internally (unchanged from LX-9R6) since they are
    // always single-concept, single-operation calls.
    const parentOperationId = randomUUID();

    // STABILIZATION QUIZ PERFORMANCE Step 9/14/22: quick_check,
    // topic_practice/review, and retention_check (count===6 only) each
    // have a dedicated fast path (Step 8's audit cleared quick_check's
    // per-question fan-out; Step 13 cleared topic_practice/review's
    // chunked fan-out; Step 21/21A benchmarked and validated
    // retention_check's own 2x3 chunked path specifically for its
    // default 6-question shape). Every other mode (diagnostic_check,
    // cumulative_assessment, exam_simulation) -- and retention_check
    // itself whenever a caller overrides maxQuestions away from 6 --
    // keeps the original single-call batch behavior below, untouched.
    // conceptIds has exactly one entry for every fast-path mode
    // (SINGLE_CONCEPT_MODES), so each still produces one inner array,
    // keeping questionArrays' shape (one array per concept) identical
    // for the flatten/askConfidence logic below regardless of which
    // path ran.
    const [questionArrays, askConfidenceFlags] = await Promise.all([
      validated.quizMode === 'quick_check'
        ? generateQuickCheckQuestions(conceptIds[0], validated.studentId, validated.subjectId, {
            // CANON-R5R1A: v1EffectiveDifficulty (set only for a
            // verified v1 Practice request) always wins over the
            // client-supplied validated.difficulty -- see its own doc
            // comment above. `undefined` for every other mode/request,
            // so this is byte-identical to before this phase there.
            difficulty: v1EffectiveDifficulty ?? validated.difficulty ?? resolvedDifficulty?.level ?? 3,
            language,
            ibContext,
          }).then((qs) => [qs])
        : validated.quizMode === 'topic_practice' || validated.quizMode === 'review'
        ? generatePracticeQuestions(conceptIds[0], validated.studentId, validated.subjectId, {
            count: perConceptCap,
            // CANON-R5R1A: v1EffectiveDifficulty (set only for a
            // verified v1 Practice request) always wins over the
            // client-supplied validated.difficulty -- see its own doc
            // comment above. `undefined` for every other mode/request,
            // so this is byte-identical to before this phase there.
            difficulty: v1EffectiveDifficulty ?? validated.difficulty ?? resolvedDifficulty?.level ?? 3,
            guidance: config.guidance,
            language,
            visualAidRate: config.visualAidRate,
            ibContext,
            activityType: activityTypeForQuizMode(validated.quizMode),
            quizMode: validated.quizMode,
            parentOperationId,
          }).then((qs) => [qs])
        : validated.quizMode === 'canonical_learn_check'
        ? // CANON-V2-ARCH-CLEANUP Section 8.A -- the dedicated LEARN
          // comprehension checkpoint. Reuses the SAME generic, mature
          // generatePracticeQuestions primitive topic_practice/review
          // already use (no new AI-generation call needed -- LEARN_CHECK
          // is assisted, has no independence/novelty/exact-count
          // requirement, exactly Practice's own generation shape) --
          // but as its OWN distinct quizMode/session/activityType,
          // never a relabeled topic_practice request (Section 13: no
          // canonical LEARN_CHECK -> generic quiz substitution). No
          // canonical item-count authority exists for this activity
          // (evidence-sufficiency-contract.ts) -- `perConceptCap` here
          // is always the EXECUTION default (QUIZ_MODE_CONFIG.canonical_learn_check.defaultMax),
          // never a fabricated canonical count.
          generatePracticeQuestions(conceptIds[0], validated.studentId, validated.subjectId, {
            count: perConceptCap,
            difficulty: v1EffectiveDifficulty ?? validated.difficulty ?? resolvedDifficulty?.level ?? 2,
            guidance: config.guidance,
            language,
            visualAidRate: config.visualAidRate,
            ibContext,
            activityType: activityTypeForQuizMode(validated.quizMode),
            quizMode: validated.quizMode,
            parentOperationId,
          }).then((qs) => [qs])
        : validated.quizMode === 'retention_check' && maxQuestions === RETENTION_REQUIRED_COUNT
        ? generateRetentionCheckQuestions(conceptIds[0], validated.studentId, validated.subjectId, {
            // CANON-R5R1A: v1EffectiveDifficulty (set only for a
            // verified v1 Practice request) always wins over the
            // client-supplied validated.difficulty -- see its own doc
            // comment above. `undefined` for every other mode/request,
            // so this is byte-identical to before this phase there.
            difficulty: v1EffectiveDifficulty ?? validated.difficulty ?? resolvedDifficulty?.level ?? 3,
            guidance: config.guidance,
            language,
            ibContext,
          }).then((qs) => [qs])
        : validated.quizMode === 'canonical_prove'
        ? // CANON-R6-PERF-R2 -- FIRST: a cache-hit check against a
          // background-prepared activity (CANON-R6-PERF-R2's own
          // pre-generation, triggered after a qualifying Practice
          // submission -- see handleSubmitQuiz below). The canonical
          // engine remains the SOLE authority regardless of outcome:
          // `v1Marker` above was ALREADY independently, freshly
          // re-verified before this branch is ever reached -- a
          // prepared activity supplies QUESTIONS only, never canonical
          // authority, and is re-validated (contract compatibility +
          // a fresh novelty re-check) before ever being trusted. On any
          // miss/invalid/expired/still-preparing outcome, falls through
          // to the SAME certified concurrent-chunk generator
          // (generateCanonicalProveQuestions, CANON-R6-PERF-R1) as the
          // cold-cache path -- never a second, cheaper generator.
          (async () => {
            const preparedContract: PreparedActivityContractSnapshot = {
              canonicalActivityType: v1Marker!.canonicalActivityType,
              // Non-null: this whole branch only ever runs for
              // canonical_prove, whose contract always carries a real
              // itemCount (CANON-V2-ARCH-CLEANUP's `null` case is
              // LEARN_CHECK-only, a different quizMode entirely).
              itemCount: v1Marker!.itemCount!,
              difficulty: v1Marker!.difficulty,
              independence: v1Marker!.independence,
              supportLevel: v1Marker!.supportLevel,
              minimumScorePercent: v1Marker!.minimumScorePercent,
            };

            const preparedLookupStartedAt = Date.now();
            const prepared = await findActivePreparedActivity(validated.studentId, primaryConceptId!, 'PROVE').catch(() => null);
            preparedLookupMs = Date.now() - preparedLookupStartedAt;

            if (prepared?.status === 'READY') {
              const preparedValidationStartedAt = Date.now();
              const revalidation = await revalidatePreparedActivity(prepared, preparedContract).catch(
                () => ({ valid: false, reason: 'NOVELTY_STALE' as const }),
              );
              preparedValidationMs = Date.now() - preparedValidationStartedAt;
              if (revalidation.valid) {
                const consumeStartedAt = Date.now();
                // The real quizId isn't minted until storeQuiz runs
                // below, well after this ternary resolves -- consume
                // against a provisional id so the atomic UPDATE can
                // still happen HERE (at the moment of use, closing the
                // race window as tightly as possible); the real quizId
                // is reconciled onto the row right after storeQuiz.
                preparedConsumptionCandidateId = prepared.id;
                const consumed = await consumePreparedActivity(prepared.id, `pending-${parentOperationId}`).catch(() => null);
                sessionCreationMs = Date.now() - consumeStartedAt;
                if (consumed) {
                  preparedCacheStatus = 'HIT';
                  preparedActivityFingerprintCount = prepared.priorPracticeFingerprintBasis?.count ?? null;
                  return [consumed];
                }
                // Lost the atomic race (another tab/request consumed it
                // first) -- fall through to cold generation, never
                // double-serve the same prepared content.
                preparedConsumptionCandidateId = null;
              } else {
                await invalidatePreparedActivity(prepared.id, revalidation.reason ?? 'INCOMPATIBLE_CONTRACT').catch(() => {});
                preparedCacheStatus =
                  revalidation.reason === 'EXPIRED' ? 'EXPIRED' : revalidation.reason === 'NOVELTY_STALE' ? 'INVALID' : 'INVALID';
              }
            } else if (prepared?.status === 'PREPARING') {
              preparedCacheStatus = 'PREPARING';
            } else {
              preparedCacheStatus = 'MISS';
            }

            // CANON-R6-PERF-R1 -- cold-cache path: the SAME certified
            // concurrent-chunk generator, never a cheaper one.
            // `v1EffectiveDifficulty` is always defined here (the
            // earlier `v1Marker` guard already rejected any
            // canonical_prove request without one) -- the `??
            // validated.difficulty ?? resolvedDifficulty?.level ?? 3`
            // fallback is purely defensive, matching every other call
            // site's own style (Part 9: client difficulty stays irrelevant).
            const proveGen = await generateCanonicalProveQuestions({
              conceptId: conceptIds[0],
              studentId: validated.studentId,
              subjectId: validated.subjectId,
              targetCount: perConceptCap,
              difficulty: v1EffectiveDifficulty ?? validated.difficulty ?? resolvedDifficulty?.level ?? 3,
              guidance: config.guidance,
              language,
              visualAidRate: config.visualAidRate,
              ibContext,
              activityType: activityTypeForQuizMode(validated.quizMode),
              quizMode: validated.quizMode,
              parentOperationId,
            });
            proveGenerationResult = proveGen;
            return [proveGen.questions];
          })()
        : validated.quizMode === 'canonical_retain'
        ? // CANON-V2-ARCH-CLEANUP Section 8/9 -- the ONE certified
          // canonical Retain generation path (generateCanonicalRetainQuestions,
          // mirroring canonical_prove but with the broader Practice+Prove+
          // Retain novelty base RETAIN's own contract requires). No
          // prepared-activity cache -- always a live generation call.
          (async () => {
            const retainGen = await generateCanonicalRetainQuestions({
              conceptId: conceptIds[0],
              studentId: validated.studentId,
              subjectId: validated.subjectId,
              targetCount: perConceptCap,
              difficulty: v1EffectiveDifficulty ?? validated.difficulty ?? resolvedDifficulty?.level ?? 3,
              guidance: config.guidance,
              language,
              visualAidRate: config.visualAidRate,
              ibContext,
              activityType: activityTypeForQuizMode(validated.quizMode),
              quizMode: validated.quizMode,
              parentOperationId,
            });
            retainGenerationResult = retainGen;
            return [retainGen.questions];
          })()
        : validated.quizMode === 'canonical_transfer'
        ? // CANON-V2-ARCH-CLEANUP Section 9/28 -- the ONE certified
          // canonical Transfer generation path: exactly 3
          // NEAR/CONTEXTUAL/HIGHER challenges (generateCanonicalTransferChallenges),
          // each an ordinary free-text GeneratedQuestion tagged with
          // transferDepth. `maxQuestions` is always exactly 3 for a
          // v1-authorized request (v1Marker.itemCount, forced above) --
          // this branch never generates a different count.
          (async () => {
            const transferGen = await generateCanonicalTransferChallenges({
              conceptId: conceptIds[0],
              studentId: validated.studentId,
              subjectId: validated.subjectId,
              difficulty: v1EffectiveDifficulty ?? validated.difficulty ?? resolvedDifficulty?.level ?? 4,
              guidance: config.guidance,
              language,
              visualAidRate: config.visualAidRate,
              ibContext,
            });
            transferGenerationResult = transferGen;
            return [transferGen.questions];
          })()
        : Promise.all(
            // LX-4P-PERF-R1C-R1: the UNIVERSAL Question Quality Gate --
            // cumulative_assessment / exam_simulation / diagnostic_check
            // (and retention_check with a non-6 override) go through the
            // gated batch (Luna -> deterministic contract + semantic
            // verify where required -> one Terra regeneration if SHORT of
            // the per-concept target). These are evidence-consequence
            // paths: they get at least the same acceptance standard as
            // Practice. LX-9R6-R1 C4: each concept's own batch is now
            // exact-`perConceptCap`-or-empty (generateGatedQuestionBatch's
            // own bounded recovery) -- per-concept partial tolerance is
            // gone; a concept whose bounded recovery still falls short
            // contributes nothing, and the aggregate insufficiency gate
            // below then fails the WHOLE request closed rather than
            // silently publishing fewer than `maxQuestions`.
            // LX-9R3-R1 D2: multi-concept modes (cumulative_assessment /
            // exam_simulation) resolve their OWN per-concept target
            // difficulty here -- diagnostic_check and a retention_check
            // override already have `resolvedDifficulty` set above
            // (single-concept), so this per-concept fetch is skipped for
            // them.
            conceptIds.map(async (cId) => {
              let perConceptDifficulty = v1EffectiveDifficulty ?? validated.difficulty ?? resolvedDifficulty?.level;
              if (perConceptDifficulty === undefined) {
                const batchActivityType = activityTypeForQuizMode(validated.quizMode);
                const batchKs = await getConceptKnowledgeState(validated.studentId, cId).catch(() => null);
                const batchKsForDifficulty = batchKs ? { masteryState: batchKs.masteryState, criticalMisconceptionCount: batchKs.criticalMisconceptionCount } : null;
                const batchDecision = resolveTargetDifficulty({ activityType: batchActivityType, knowledgeState: batchKsForDifficulty });
                logDifficultyResolution(batchActivityType, batchDecision, batchKsForDifficulty);
                perConceptDifficulty = batchDecision.level;
              }
              return generateGatedQuestionBatch(cId, validated.studentId, validated.subjectId, {
                count: perConceptCap,
                difficulty: perConceptDifficulty,
                types: ALL_QUESTION_TYPES,
                guidance: config.guidance,
                language,
                visualAidRate: config.visualAidRate,
                ibContext,
                activityType: activityTypeForQuizMode(validated.quizMode),
                quizMode: validated.quizMode,
                parentOperationId,
              });
            })
          ),
      computeAskConfidenceFlags(validated.studentId, conceptIds, validated.quizMode),
    ]);

    // Ask confidence at most once per concept per quiz (its first
    // question), never on every question -- avoids fatigue while still
    // capturing a fresh read whenever shouldAskConfidence() triggers.
    questionArrays.forEach((arr, i) => {
      if (arr.length > 0 && askConfidenceFlags.get(conceptIds[i])) {
        arr[0].askConfidence = true;
      }
    });

    let questions = shuffleArray(questionArrays.flat()).slice(0, maxQuestions);

    // CANON-R6R1 Part 1/2/6 -- MINIMUM (exact-duplicate-only) novelty
    // enforcement for v1 Prove, scoped to `canonical_prove` ONLY (Part
    // 12/13: topic_practice/quick_check generation is completely
    // untouched). Deliberately NOT semantic novelty -- see
    // src/lib/lx/exact-duplicate-novelty.ts's own doc comment.
    //
    // CANON-R6-PERF-R2 -- on the CACHE-HIT path, novelty was already
    // fully verified by `revalidatePreparedActivity` (a fresh re-check
    // against CURRENT prior-Practice fingerprints, Part 8) before the
    // prepared activity was ever consumed above -- there is nothing
    // left to filter here. On the COLD-GENERATION path (CANON-R6-PERF-R1),
    // `generateCanonicalProveQuestions` already ran the full concurrent-
    // chunk -> novelty-filter -> at-most-one-aggregate-recovery pipeline
    // itself; this block only copies its diagnostics into this route's
    // own observability state (never re-filters, never re-generates).
    let noveltyDiagnostics: NonNullable<QuizSessionV1Marker['novelty']> | null = null;
    if (validated.quizMode === 'canonical_prove') {
      if (preparedCacheStatus === 'HIT') {
        noveltyDiagnostics = {
          priorPracticeFingerprintCount: preparedActivityFingerprintCount ?? 0,
          rejectedExactDuplicateCount: 0,
          acceptedNovelQuestionCount: questions.length,
          noveltyPolicy: 'EXACT_DUPLICATE_EXCLUSION_V1',
        };
      } else if (proveGenerationResult !== null) {
        const g: CanonicalProveGenerationResult = proveGenerationResult;
        priorHistoryMs = g.priorHistoryMs;
        noveltyFilterMs = g.noveltyFilterMs;
        generationConcurrentMs = g.generationConcurrentMs;
        chunkPlan = g.chunkPlan;
        aggregateRecoveryUsed = g.aggregateRecoveryUsed;
        aggregateRecoveryRequestedCount = g.aggregateRecoveryRequestedCount;
        aggregateRecoveryMs = g.aggregateRecoveryMs;
        generationInvocations.push(...g.invocations);
        noveltyPasses.push(...g.noveltyPasses);
        noveltyDiagnostics = {
          priorPracticeFingerprintCount: g.priorPracticeFingerprintCount,
          rejectedExactDuplicateCount: g.rejectedExactDuplicateCount,
          acceptedNovelQuestionCount: questions.length,
          noveltyPolicy: 'EXACT_DUPLICATE_EXCLUSION_V1',
        };
      }
    }

    // CANON-R6-PERF-I1 Part 8 -- the ONE place every canonical_prove
    // generation outcome (SUCCESS, both INCOMPLETE guards below) emits
    // its single CANONICAL_PROVE_GENERATION_SUMMARY event. A no-op for
    // every other quizMode. Reuses `parentOperationId` (already minted
    // once per request, above) as the request-level correlation id
    // rather than inventing a second identity for the same request.
    const emitCanonicalProveSummary = (result: 'SUCCESS' | 'INCOMPLETE', finalQuestionCount: number, errorCode?: string) => {
      if (validated.quizMode !== 'canonical_prove') return;
      const fallbackCount = generationInvocations.filter((inv) => inv.fallbackUsed).length;
      const semanticVerificationCount = generationInvocations.reduce((sum, inv) => sum + inv.semanticCallCount, 0);
      const externalAiCallCount = generationInvocations.reduce((sum, inv) => sum + inv.externalAiCallCount, 0);
      // CANON-R6-PERF-R1 -- initialAcceptedCount is captured at the
      // INITIAL novelty pass (before any recovery ever ran); a request
      // with no `noveltyPasses` entry yet (shouldn't happen for
      // canonical_prove, but defensive) falls back to `finalQuestionCount`.
      const initialAcceptedCount = noveltyPasses.find((p) => p.noveltyPass === 'INITIAL')?.acceptedCount ?? finalQuestionCount;
      logCanonicalProveGenerationSummary({
        operationId: parentOperationId,
        parentOperationId,
        studentIdHash: hashStudentId(validated.studentId),
        conceptId: primaryConceptId ?? 'unknown',
        quizMode: 'canonical_prove',
        canonicalStage: v1Marker?.canonicalStage ?? null,
        targetItemCount: maxQuestions,
        difficultyTarget: v1EffectiveDifficulty ?? null,
        canonicalAuthorizationMs,
        priorHistoryMs,
        generationPrimaryMs: null, // CANON-R6-PERF-R1: superseded by generationConcurrentMs -- see the type's own doc comment.
        generationConcurrentMs,
        chunkPlan,
        chunkCount: chunkPlan.length,
        noveltyFilterMs,
        noveltyRefill1Ms: null, // CANON-R6-PERF-R1: the refill mechanism this represented no longer exists -- superseded by aggregateRecoveryMs.
        noveltyRefill2Ms: null,
        initialAcceptedCount,
        aggregateRecoveryUsed,
        aggregateRecoveryRequestedCount,
        aggregateRecoveryMs,
        persistenceMs,
        totalMs: Date.now() - requestStartedAt,
        generationInvocationCount: generationInvocations.length,
        externalAiCallCount,
        fallbackCount,
        semanticVerificationCount,
        noveltyRefillCount: aggregateRecoveryUsed ? 1 : 0,
        priorPracticeFingerprintCount: noveltyDiagnostics?.priorPracticeFingerprintCount ?? null,
        rejectedExactDuplicateCount: noveltyDiagnostics?.rejectedExactDuplicateCount ?? null,
        acceptedNovelQuestionCount: noveltyDiagnostics?.acceptedNovelQuestionCount ?? null,
        finalQuestionCount,
        invocations: generationInvocations,
        noveltyPasses,
        result,
        ...(errorCode ? { errorCode } : {}),
      });
    };

    // CANON-R6-PERF-R2 Part 28 -- the cache-PATH timeline, emitted
    // alongside (never instead of) the summary above, for EVERY
    // canonical_prove request regardless of hit/miss/preparing/invalid,
    // so cache effectiveness (hit rate, waste rate) is directly
    // computable from these lines.
    const emitCanonicalProveCacheSummary = () => {
      if (validated.quizMode !== 'canonical_prove' || !preparedCacheStatus) return;
      logCanonicalProveCacheSummary({
        operationId: parentOperationId,
        studentIdHash: hashStudentId(validated.studentId),
        conceptId: primaryConceptId ?? 'unknown',
        preparedCacheStatus,
        canonicalAuthorizationMs,
        preparedLookupMs,
        preparedValidationMs,
        sessionCreationMs,
        totalReadyHitMs: preparedCacheStatus === 'HIT' ? Date.now() - requestStartedAt : null,
      });
    };

    // LX-9R6-R1 C2/C4: the ONE choke point every mode's result converges
    // on. Every generator now either publishes exactly its own required
    // count or `[]` -- but a multi-concept gated batch (cumulative_
    // assessment/exam_simulation) can still fall short in aggregate if
    // one concept's OWN bounded recovery genuinely couldn't reach its
    // per-concept target (that concept contributes nothing, the others
    // still contribute their own exact share). A non-empty but
    // short-of-`maxQuestions` result must never silently reach the
    // learner as a shorter quiz -- fail the WHOLE request closed instead
    // of publishing it, same as the already-empty case just below.
    //
    // CANON-V2-PREVIEW-CERT Section 6/7/8 -- computed ONCE, reused by
    // both guards below, so "short of target" and "totally empty" both
    // report the SAME real classification for the SAME underlying
    // generation attempt. `null` for every non-exact-count mode (the
    // generic gated-batch/legacy path), which keeps its own existing
    // generic error shape untouched.
    let canonicalGenerationErrorCode: CanonicalErrorCode | null = null;
    if (questions.length < maxQuestions) {
      try {
        // CANON-V2-PREVIEW-CERT -- `!== null` (never a truthy `&&`
        // narrow) matches this file's own established pattern for
        // reading these closure-assigned `let`s (see the novelty-
        // diagnostics block above, `else if (proveGenerationResult !== null)`)
        // -- a bare truthy-check narrow on a `let` only ever reassigned
        // inside a nested async IIFE is a known TypeScript control-flow
        // limitation that narrows the read to `never` instead of the
        // declared type.
        if (validated.quizMode === 'canonical_prove' && proveGenerationResult !== null) {
          const proveResult: CanonicalProveGenerationResult = proveGenerationResult;
          canonicalGenerationErrorCode = classifyProveRetainGenerationFailure({
            totalSemanticRejectedCount: proveResult.invocations.reduce((sum, inv) => sum + inv.semanticRejectedCount, 0),
            finalQuestionCount: proveResult.finalQuestionCount,
            targetCount: maxQuestions,
          });
        } else if (validated.quizMode === 'canonical_retain' && retainGenerationResult !== null) {
          const retainResult: CanonicalRetainGenerationResult = retainGenerationResult;
          canonicalGenerationErrorCode = classifyProveRetainGenerationFailure({
            totalSemanticRejectedCount: retainResult.invocations.reduce((sum, inv) => sum + inv.semanticRejectedCount, 0),
            finalQuestionCount: retainResult.finalQuestionCount,
            targetCount: maxQuestions,
          });
        } else if (validated.quizMode === 'canonical_transfer' && transferGenerationResult !== null) {
          const transferResultForClassification: CanonicalTransferGenerationResult = transferGenerationResult;
          canonicalGenerationErrorCode = classifyTransferGenerationFailure(transferResultForClassification.challengeDiagnostics);
        }
      } catch {
        // Defensive only -- the classifiers themselves only throw for a
        // non-failure input, which cannot happen inside this guard
        // (already known: questions.length < maxQuestions). Never lets
        // a classification bug break the error response itself.
        canonicalGenerationErrorCode = null;
      }
    }

    if (questions.length > 0 && questions.length < maxQuestions) {
      try {
        // eslint-disable-next-line no-console
        console.log('[generation]', JSON.stringify({
          conceptId: primaryConceptId,
          quizMode: validated.quizMode,
          parentOperationId,
          targetDifficulty: resolvedDifficulty?.level ?? null,
          difficultyReasonCode: resolvedDifficulty?.reasonCode ?? null,
          requiredQuestionCount: maxQuestions,
          publishedCount: questions.length,
          generationPhase: 'GENERATION_INSUFFICIENT',
          sessionCreated: false,
          errorCode: 'QUESTION_COUNT_INSUFFICIENT',
        }));
      } catch { /* logging must never break the response */ }
      emitCanonicalProveSummary('INCOMPLETE', questions.length, 'V1_PROVE_GENERATION_INCOMPLETE');
      emitCanonicalProveCacheSummary();
      // CANON-R6/CANON-V2-ARCH-CLEANUP Part 5/29 -- a v1 Prove/Retain
      // request may NEVER silently administer fewer than its own
      // authorized exact count; this pre-existing universal guard
      // already fails the whole request closed before storeQuiz is ever
      // called (LX-9-FINAL Part G) -- this only adds the closed,
      // mode-specific reason code, additive to the generic error shape
      // every other mode already gets.
      return NextResponse.json(
        validated.quizMode === 'canonical_prove'
          ? { error: 'GENERATION_FAILED', reason: 'V1_PROVE_GENERATION_INCOMPLETE', canonicalErrorCode: canonicalGenerationErrorCode ?? toCanonicalErrorCode('V1_PROVE_GENERATION_INCOMPLETE').code, message: 'Could not generate a complete, independent 10-question Prove check.' }
          : validated.quizMode === 'canonical_retain'
          ? { error: 'GENERATION_FAILED', reason: 'V1_RETAIN_GENERATION_INCOMPLETE', canonicalErrorCode: canonicalGenerationErrorCode ?? toCanonicalErrorCode('V1_RETAIN_GENERATION_INCOMPLETE').code, message: 'Could not generate a complete, novel 10-question Retain check.' }
          : validated.quizMode === 'canonical_transfer'
          ? { error: 'GENERATION_FAILED', reason: 'V1_TRANSFER_GENERATION_INCOMPLETE', canonicalErrorCode: canonicalGenerationErrorCode ?? toCanonicalErrorCode('V1_TRANSFER_GENERATION_INCOMPLETE').code, message: 'Could not generate a complete set of 3 Transfer challenges (NEAR/CONTEXTUAL/HIGHER).' }
          : { error: 'GENERATION_FAILED', canonicalErrorCode: toCanonicalErrorCode('GENERATION_FAILED').code, message: 'Failed to generate quiz questions' },
        { status: 500 }
      );
    }

    if (questions.length === 0) {
      // LX-9 FINAL, PART U: safe, aggregate-only observability for a
      // generation failure -- never learner answer/question content.
      // No quiz_session is created past this point (Part G).
      try {
        // eslint-disable-next-line no-console
        console.log('[generation]', JSON.stringify({
          conceptId: primaryConceptId,
          quizMode: validated.quizMode,
          parentOperationId,
          targetDifficulty: resolvedDifficulty?.level ?? null,
          difficultyReasonCode: resolvedDifficulty?.reasonCode ?? null,
          generationPhase: 'GENERATION_FAILED',
          sessionCreated: false,
          errorCode: 'GENERATION_FAILED',
        }));
      } catch { /* logging must never break the response */ }
      emitCanonicalProveSummary('INCOMPLETE', questions.length, 'V1_PROVE_GENERATION_INCOMPLETE');
      emitCanonicalProveCacheSummary();
      return NextResponse.json(
        validated.quizMode === 'canonical_prove'
          ? { error: 'GENERATION_FAILED', reason: 'V1_PROVE_GENERATION_INCOMPLETE', canonicalErrorCode: canonicalGenerationErrorCode ?? toCanonicalErrorCode('V1_PROVE_GENERATION_INCOMPLETE').code, message: 'Could not generate a complete, independent 10-question Prove check.' }
          : validated.quizMode === 'canonical_retain'
          ? { error: 'GENERATION_FAILED', reason: 'V1_RETAIN_GENERATION_INCOMPLETE', canonicalErrorCode: canonicalGenerationErrorCode ?? toCanonicalErrorCode('V1_RETAIN_GENERATION_INCOMPLETE').code, message: 'Could not generate a complete, novel 10-question Retain check.' }
          : validated.quizMode === 'canonical_transfer'
          ? { error: 'GENERATION_FAILED', reason: 'V1_TRANSFER_GENERATION_INCOMPLETE', canonicalErrorCode: canonicalGenerationErrorCode ?? toCanonicalErrorCode('V1_TRANSFER_GENERATION_INCOMPLETE').code, message: 'Could not generate a complete set of 3 Transfer challenges (NEAR/CONTEXTUAL/HIGHER).' }
          : { error: 'GENERATION_FAILED', canonicalErrorCode: toCanonicalErrorCode('GENERATION_FAILED').code, message: 'Failed to generate quiz questions' },
        { status: 500 }
      );
    }

    // CANON-R6R1 Part 10 -- novelty diagnostics are attached to a NEW
    // object rather than mutating `v1Marker` itself, so Practice's own
    // marker (built once, above, before generation ever ran) is never
    // touched; `noveltyDiagnostics` is non-null only for canonical_prove.
    const v1MarkerToPersist: QuizSessionV1Marker | null = v1Marker
      ? { ...v1Marker, novelty: noveltyDiagnostics }
      : null;

    const persistenceStartedAt = Date.now();
    const quizId = await storeQuiz(
      validated.studentId,
      primaryConceptId,
      validated.subjectId,
      questions,
      language,
      validated.quizMode,
      conceptIds,
      v1MarkerToPersist
    );
    persistenceMs = Date.now() - persistenceStartedAt;

    // CANON-R6-PERF-R2 -- reconcile the just-consumed prepared
    // activity's `consumed_by_quiz_id` onto the REAL quizId (the
    // atomic consumption itself already happened above, before
    // storeQuiz ever ran, using a provisional placeholder -- the real
    // id wasn't minted yet). Best-effort: a failure here never affects
    // the learner's quiz, which already exists regardless.
    if (preparedConsumptionCandidateId) {
      db.query(`UPDATE canonical_prepared_activity SET consumed_by_quiz_id = $2 WHERE id = $1`, [preparedConsumptionCandidateId, quizId]).catch(
        (err) => console.error('[canonical-prepared-activity] consumed_by_quiz_id reconciliation failed:', err),
      );
    }

    if (validated.quizMode === 'diagnostic_check') {
      track(validated.studentId, 'diagnostic_check_started', { quizId, conceptId: primaryConceptId });
    }

    emitCanonicalProveSummary('SUCCESS', questions.length);
    emitCanonicalProveCacheSummary();

    return NextResponse.json({
      success: true,
      data: {
        quizId,
        language,
        quizMode: validated.quizMode,
        maxQuestions,
        // LX-4R R8: where the count came from -- CANONICAL_GAP (mastery
        // policy evidence gap) or EXECUTION_DEFAULT (unresolved mode).
        // `zeroGapMismatch` is set when Phase 3C launched a canonical
        // PRACTICE/PROVE activity with no remaining evidence need.
        countAuthority,
        ibProgramme: ibContext?.programme || 'none',
        quiz: {
          questions: questions.map((q, i) => toClientQuestion(q, i)),
          count: questions.length,
        },
        message: 'Quiz generated. Submit answers with this quizId to complete.',
      },
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'INVALID_INPUT', message: error.issues[0]?.message }, { status: 400 });
    }
    // CANON-R6-PERF-I1 Part 9 -- best-effort error summary: an
    // unexpected error reaching this OUTER catch means something failed
    // outside generateGatedQuestionBatch's own resilience (which never
    // throws -- it returns `[]` on any internal failure and always
    // reports its own diagnostics first). `validated`/`primaryConceptId`/
    // `parentOperationId`/`v1Marker` are declared inside the try block
    // above and are genuinely out of scope here (unchanged by this
    // phase) -- this reads only the raw, unvalidated `body` and the
    // instrumentation state hoisted above the try block, which still
    // reflects whatever real work completed before the throw. Never the
    // raw error message (only a fixed code), matching this file's
    // existing safe-logging convention elsewhere.
    if (rawQuizModeForErrorLogging === 'canonical_prove') {
      const rawStudentId = typeof body?.studentId === 'string' ? body.studentId : null;
      const rawConceptId = typeof body?.conceptId === 'string' ? body.conceptId : null;
      logCanonicalProveGenerationSummary({
        operationId: randomUUID(),
        parentOperationId: 'UNKNOWN_REQUEST_FAILED_BEFORE_CORRELATION_ID',
        studentIdHash: rawStudentId ? hashStudentId(rawStudentId) : 'unknown',
        conceptId: rawConceptId ?? 'unknown',
        quizMode: 'canonical_prove',
        canonicalStage: null,
        targetItemCount: typeof body?.maxQuestions === 'number' ? body.maxQuestions : 0,
        difficultyTarget: null,
        canonicalAuthorizationMs,
        priorHistoryMs,
        generationPrimaryMs: null,
        generationConcurrentMs,
        chunkPlan,
        chunkCount: chunkPlan.length,
        noveltyFilterMs,
        noveltyRefill1Ms: null,
        noveltyRefill2Ms: null,
        initialAcceptedCount: 0,
        aggregateRecoveryUsed,
        aggregateRecoveryRequestedCount,
        aggregateRecoveryMs,
        persistenceMs,
        totalMs: Date.now() - requestStartedAt,
        generationInvocationCount: generationInvocations.length,
        externalAiCallCount: generationInvocations.reduce((sum, inv) => sum + inv.externalAiCallCount, 0),
        fallbackCount: generationInvocations.filter((inv) => inv.fallbackUsed).length,
        semanticVerificationCount: generationInvocations.reduce((sum, inv) => sum + inv.semanticCallCount, 0),
        noveltyRefillCount: aggregateRecoveryUsed ? 1 : 0,
        priorPracticeFingerprintCount: null,
        rejectedExactDuplicateCount: null,
        acceptedNovelQuestionCount: null,
        finalQuestionCount: 0,
        invocations: generationInvocations,
        noveltyPasses,
        result: 'ERROR',
        errorCode: 'UNEXPECTED_ERROR',
      });
    }
    throw error;
  }
}

function optionText(question: GeneratedQuestion, id: string): string {
  return question.options?.find((o) => o.id === id)?.text ?? id;
}

function formatAnswerForDisplay(question: GeneratedQuestion, raw: string | undefined): string {
  if (!raw) return '';
  try {
    switch (question.answerFormat) {
      case 'single_choice':
        return optionText(question, raw);
      case 'multi_choice':
        return raw.split(',').map((id) => optionText(question, id.trim())).filter(Boolean).join(', ');
      case 'matching': {
        const map = JSON.parse(raw) as Record<string, string>;
        return Object.entries(map).map(([l, r]) => `${l} → ${r}`).join('; ');
      }
      case 'ordering':
        return (JSON.parse(raw) as string[]).join(' → ');
      case 'classification': {
        const map = JSON.parse(raw) as Record<string, string>;
        return Object.entries(map).map(([item, cat]) => `${item}: ${cat}`).join('; ');
      }
      default:
        return raw;
    }
  } catch {
    return raw;
  }
}

function correctAnswerForDisplay(question: GeneratedQuestion): string {
  switch (question.answerFormat) {
    case 'single_choice':
      return optionText(question, question.correctAnswer);
    case 'multi_choice':
      return question.correctAnswer.split(',').map((id) => optionText(question, id.trim())).join(', ');
    case 'matching':
      return (question.matchingPairs || []).map((p) => `${p.left} → ${p.right}`).join('; ');
    case 'ordering':
      return (question.orderingItems || []).join(' → ');
    case 'classification':
      return (question.classificationItems || []).map((it) => `${it.item}: ${it.category}`).join('; ');
    default:
      return question.correctAnswer;
  }
}

async function getConceptLabels(conceptIds: string[], language: string): Promise<Map<string, string>> {
  if (conceptIds.length === 0) return new Map();
  const result = await db.query(
    `
    SELECT c.id, c.canonical_id, cl.label
    FROM concepts c
    LEFT JOIN LATERAL (
      SELECT label FROM concept_localizations
      WHERE concept_id = c.id
      ORDER BY (language = $2) DESC
      LIMIT 1
    ) cl ON true
    WHERE c.id = ANY($1::uuid[])
    `,
    [conceptIds, language]
  );
  return new Map(result.rows.map((r) => [r.id, r.label || r.canonical_id]));
}

async function handleSubmitQuiz(body: any, userId: string, role: UserRole) {
  try {
    const validated = SubmitQuizSchema.parse(body);

    const canAccess = await verifyStudentAccess(userId, validated.studentId, role);
    if (!canAccess) {
      return NextResponse.json({ error: 'FORBIDDEN', message: 'Cannot access this student' }, { status: 403 });
    }

    const quizSession = await getQuizSession(validated.quizId);
    // F0-S / RR-08: ownership check folded into the same not-found branch
    // as the sibling routes (hint/verify/contextual-help/teaching-intent/
    // localize-question) -- a quiz session that exists but belongs to a
    // different student must be indistinguishable from one that does not
    // exist at all, never a separate FORBIDDEN response that would
    // confirm another student's quizId is valid.
    if (!quizSession || quizSession.studentId !== validated.studentId) {
      return NextResponse.json(
        { error: 'QUIZ_NOT_FOUND', message: 'Quiz expired or not found. Generate a new quiz.' },
        { status: 400 }
      );
    }

    // Phase 2B Step 10: defense-in-depth only -- the real, database-
    // enforced guarantee against a duplicate submission is
    // updateMastery's operation_key gate below (QUIZ_SUBMISSION,
    // scoped to this quizId+concept), which two concurrent requests
    // that both observe status='active' still cannot defeat (a status
    // check alone is not an idempotency guarantee -- Phase 2A's
    // finding). This guard exists to skip needless AI re-grading (and
    // a needless retread of diagnostic/remediation side effects that
    // are not themselves covered by the evidence-idempotency key) for
    // the common sequential-retry case, where a genuinely-completed
    // quiz is resubmitted after its first response was lost in
    // transit.
    if (quizSession.status === 'completed') {
      return NextResponse.json({
        success: true,
        alreadySubmitted: true,
        message: 'This quiz was already submitted. Its results were not changed.',
      });
    }
    const cachedQuestions = quizSession.questions;
    const language = quizSession.language;
    const config = QUIZ_MODE_CONFIG[quizSession.quizMode] || QUIZ_MODE_CONFIG.topic_practice;

    // Grade every answer -- structured formats (choice/matching/ordering/
    // classification) are checked deterministically with no AI call;
    // only free-text formats need Claude, and those run in parallel.
    const graded = await Promise.all(
      validated.answers.map(async (answer) => {
        const question = cachedQuestions[answer.questionIndex];
        if (!question) return null;

        // Phase 1D: normalized once, right next to the raw client input --
        // the client clock stops here, before any AI grading call runs
        // below, so this never measures grading/AI latency (Step 13).
        const timing = normalizeResponseTiming({
          questionPresentedAt: answer.questionPresentedAt,
          answerSubmittedAt: answer.answerSubmittedAt,
        });

        if (question.answerFormat === 'text') {
          const gradeResult = await gradeAnswer(question, answer.answer, language, {
            studentId: validated.studentId,
            subjectId: quizSession.subjectId,
          });
          // LX-4F: the Response/Evidence Contract is the grader whitelist,
          // enforced at runtime. For an ANSWER_ONLY question (e.g. a plain
          // numeric problem with no canonical PROCEDURAL reasoning tag), a
          // correct final answer can never be marked down for absent work
          // or disliked phrasing. SHOW_WORK / EXPLAIN / JUSTIFY are
          // returned unchanged (the grader legitimately scores METHOD /
          // REASONING there).
          const contract = deriveResponseEvidenceContract(
            {
              type: question.type as QuestionType,
              expectedReasoningType: (question.expectedReasoningType as ExpectedReasoningType | undefined) ?? null,
            },
            quizSession.evidenceMode,
          );
          const guarded = applyResponseContractGuard(contract, gradeResult, {
            studentAnswer: answer.answer,
            correctAnswer: question.correctAnswer,
          });
          return {
            questionIndex: answer.questionIndex,
            question,
            rawAnswer: answer.answer,
            gradeResult: { ...gradeResult, ...guarded },
            reportedConfidence: answer.confidence,
            timing,
          };
        }
        const structured = gradeStructuredAnswer(question, answer.answer);
        return {
          questionIndex: answer.questionIndex,
          question,
          rawAnswer: answer.answer,
          gradeResult: { ...structured, confidence: 1, errorType: null as null },
          reportedConfidence: answer.confidence,
          timing,
        };
      })
    );

    let correctCount = 0;
    let incorrectCount = 0;
    const review: any[] = [];
    const byConcept = new Map<
      string,
      {
        correct: number;
        // CV2-07 FIX: the sum of each question's own `gradeResult.score`
        // (0-1, partial credit included) in this bucket -- the actual
        // continuous evidence signal `conceptScore` below is meant to
        // carry ("the real score", per that computation's own long-
        // standing comment), never a count of how many questions merely
        // cleared some threshold.
        scoreSum: number;
        total: number;
        questionIndexes: number[];
        confidenceBeforeAnswer?: ConfidenceLevel;
        questionSemantics: Array<{
          questionIntent?: string;
          evidenceDimensions?: string[];
          cognitiveLevel?: string;
          expectedReasoningType?: string;
          learningObjectiveId?: string;
        }>;
        gradingConfidences: number[];
        questionTypes: string[];
        // LX-4J: the ACTUAL generated difficulty of each question in this
        // bucket -- the evidence row's difficulty is the mean of these
        // (aggregateEvidenceDifficulty), never a hardcoded constant.
        questionDifficulties: number[];
        // Phase 0E1: AI provenance for every free-text-graded question in
        // this concept's bucket -- which execution/provider/model/prompt
        // produced the grade. Empty for concepts graded only by the
        // deterministic gradeStructuredAnswer path (no AI involved).
        aiGrading: Array<{ questionIndex: number } & AIProvenance>;
        // Phase 1D: one normalized timing sample per question in this
        // concept's bucket -- never used for grading/mastery, purely
        // carried through to the evidence row's behavioral metadata.
        responseTimings: Array<{ questionIndex: number; timing: ResponseTiming }>;
      }
    >();

    for (const g of graded) {
      if (!g) continue;
      const { questionIndex, question, rawAnswer, gradeResult, reportedConfidence, timing } = g;

      // CV2-07 ROOT-CAUSE FIX: `gradeResult.correct` is the grader's OWN
      // authoritative pass/fail verdict -- the exact same field the
      // review screen's per-question chip already renders as
      // chip-good/chip-critical (never a threshold on `score`). A
      // question graded `correct: false, errorType: 'INCOMPLETE'`
      // ("Correcto hasta donde llega, pero sin terminar" / CASI) can
      // legitimately carry a mid-range partial `score` (that's what
      // `score` is FOR), but it is never "correct" -- counting it as
      // correct here produced the exact defect this fixes: a review
      // screen showing one question as CASI/incomplete (chip-critical)
      // while the aggregate simultaneously claimed "3/3 correctas,
      // 100%". `score` remains available below for partial-credit
      // EVIDENCE weighting (`scoreSum` / `conceptScore`), which is a
      // different, legitimate use -- it must never redefine what counts
      // as "correct" for a pass/fail tally.
      if (gradeResult.correct) correctCount++;
      else incorrectCount++;

      const bucket = byConcept.get(question.conceptId) || {
        correct: 0,
        scoreSum: 0,
        total: 0,
        questionIndexes: [],
        questionSemantics: [],
        gradingConfidences: [],
        questionTypes: [],
        questionDifficulties: [],
        aiGrading: [],
        responseTimings: [],
      };
      bucket.total++;
      bucket.scoreSum += gradeResult.score;
      if (gradeResult.correct) bucket.correct++;
      bucket.questionIndexes.push(questionIndex);
      bucket.gradingConfidences.push(gradeResult.confidence);
      bucket.questionTypes.push(question.type);
      bucket.questionDifficulties.push(question.difficulty);
      bucket.responseTimings.push({ questionIndex, timing });
      if ('aiExecution' in gradeResult && gradeResult.aiExecution) {
        bucket.aiGrading.push({ questionIndex, ...gradeResult.aiExecution });
      }
      // Only one question per concept is ever flagged askConfidence, so
      // at most one answer in this bucket carries a reported confidence --
      // whichever one does becomes this concept's evidence-level reading.
      if (reportedConfidence && !bucket.confidenceBeforeAnswer) bucket.confidenceBeforeAnswer = reportedConfidence;
      // Phase 3 Pre-flight: carry any question-evidence semantics through
      // to the concept's aggregated evidence row. Nothing generates these
      // yet, so this is normally an empty/no-op collection -- see the
      // GeneratedQuestion type docs in quiz-generation.service.ts.
      if (question.questionIntent || question.evidenceDimensions || question.cognitiveLevel || question.expectedReasoningType || question.learningObjectiveId) {
        bucket.questionSemantics.push({
          questionIntent: question.questionIntent,
          evidenceDimensions: question.evidenceDimensions,
          cognitiveLevel: question.cognitiveLevel,
          expectedReasoningType: question.expectedReasoningType,
          learningObjectiveId: question.learningObjectiveId,
        });
      }
      byConcept.set(question.conceptId, bucket);

      review.push({
        questionIndex,
        conceptId: question.conceptId,
        type: question.type,
        question: question.question,
        visualAid: question.visualAid,
        studentAnswer: formatAnswerForDisplay(question, rawAnswer),
        correctAnswer: correctAnswerForDisplay(question),
        correct: gradeResult.correct,
        score: gradeResult.score,
        feedback: (gradeResult as any).feedback || '',
        explanation: question.explanation,
        // LX-4R R6: canonical grader classification, passed through for
        // the pedagogical feedback structure. The client PRESENTS these;
        // it never re-derives a diagnosis.
        errorType: (gradeResult as any).errorType ?? null,
        reasoningValid: typeof (gradeResult as any).reasoningValid === 'boolean' ? (gradeResult as any).reasoningValid : null,
      });
    }

    // Log each classified mistake for error-pattern detection.
    await Promise.all(
      graded
        .filter((g): g is NonNullable<typeof g> => g !== null && !g.gradeResult.correct && !!(g.gradeResult as any).errorType)
        .map((g) =>
          recordError({
            studentId: validated.studentId,
            conceptId: g.question.conceptId,
            subjectId: quizSession.subjectId,
            errorType: (g.gradeResult as any).errorType,
            sourceType: config.evidenceSource,
          }).catch(() => {})
        )
    );

    const totalQuestions = validated.answers.length;
    const score = totalQuestions ? Math.round((correctCount / totalQuestions) * 100) : 0;

    const conceptLabels = await getConceptLabels(Array.from(byConcept.keys()), language);
    for (const item of review) {
      item.conceptLabel = conceptLabels.get(item.conceptId) || item.conceptId;
    }

    // Update mastery per concept -- each concept's own local score
    // becomes its evidence, tagged with the quiz mode's real source
    // type. SOLO vs. COACH now derives from Phase 3A's Evidence Mode
    // (the same value the hint route's canUseAI check enforces),
    // rather than a separate hardcoded quizMode list -- PRACTICE is
    // COACH (AI may assist), INDEPENDENT/ASSESSMENT are both SOLO (no
    // assistance, higher-confidence evidence). AI_NATIVE has no quiz
    // mode mapped to it yet -- no quiz mode today treats AI as part of
    // the task itself, so there's nothing to map.
    const learningMode: 'SOLO' | 'COACH' = quizSession.evidenceMode === 'PRACTICE' ? 'COACH' : 'SOLO';

    // CANON-V2-ARCH-CLEANUP Section 10/11 -- canonical Transfer's own
    // grading authority. Computed once, up front (Transfer is always
    // single-concept -- exactly one `byConcept` bucket) from the 3
    // graded challenges' own `transferDepth` tag, score, and errorType.
    // `null` for every other quizMode, and also `null` if this session
    // somehow lacks all 3 depths (the universal exact-count guard at
    // generation time already prevents that for a real request -- this
    // is a defensive fallback, never expected to fire).
    const transferChallengeGrades = graded
      .filter((g): g is NonNullable<typeof g> => g !== null && !!g.question.transferDepth)
      .map((g) => ({
        depth: g.question.transferDepth!,
        scorePercent: Math.round(g.gradeResult.score * 100),
        errorType: (g.gradeResult as any).errorType ?? null,
        reasoningProvided: g.rawAnswer.trim().length > 0,
      }));
    const transferGrading =
      quizSession.quizMode === 'canonical_transfer' && transferChallengeGrades.length === 3
        ? gradeCanonicalTransferAttempt(transferChallengeGrades)
        : null;

    // CANON-V2-PREVIEW-CERT Section 9 -- EVIDENCE_PERSISTENCE_FAILED.
    // `updateMastery` itself already guarantees transactional
    // all-or-nothing persistence (BEGIN/COMMIT with a ROLLBACK + re-throw
    // on any failure, mastery.service.ts) -- so a caught error here
    // means NO partial evidence state exists in the database; this
    // catch exists only to turn that re-thrown error into a correctly
    // labeled, learner-safe response instead of letting it fall through
    // to the generic outer catch (which has no way to distinguish
    // "grading/response-shaping bug" from "the evidence write itself
    // failed"). Never reports success; never advances canonical state.
    let perConceptResults: Array<{
      conceptId: string;
      conceptLabel: string;
      score: number;
      previousMastery: number;
      newMastery: number;
      delta: number;
      v1Qualifies: boolean;
      duplicate: boolean;
      retentionCheckQualified: boolean | undefined;
    }>;
    try {
      perConceptResults = await Promise.all(
      Array.from(byConcept.entries()).map(async ([conceptId, bucket]) => {
        // CANON-V2-ARCH-CLEANUP Section 10 -- for canonical_transfer,
        // the evidence score IS transferGrading.overallScore (the mean
        // of the 3 independently-persisted per-challenge scores), never
        // the generic correct-count percentage (which would conflate
        // "2 of 3 challenges passed" with "all 3 individually >= 70" --
        // exactly the masking Section 10's own per-challenge floor
        // exists to prevent).
        // CV2-07 FIX: the mean of each question's own continuous
        // `gradeResult.score` (0-1, partial credit included), NOT a
        // count of how many questions cleared some threshold -- this is
        // the "real score" the field's own comment below already
        // documented as the intent (e.g. a 15/15 vs. a single lucky
        // correct answer should move mastery differently), which the
        // previous `bucket.correct`-based ratio silently defeated by
        // collapsing every question to a binary hit/miss before
        // averaging.
        const conceptScore = transferGrading ? transferGrading.overallScore : Math.round((bucket.scoreSum / bucket.total) * 100);
        // LX-4J / LX-1R evidence-consistency contract: the actual mean
        // generated difficulty of this concept's questions, never a
        // hardcoded constant. CANON-R5R1A: this SAME real value is also
        // what contract-compliance checking below validates -- never a
        // second, independently-recomputed difficulty.
        const actualDifficulty = aggregateEvidenceDifficulty(bucket.questionDifficulties);
        const evidence: LearningEvidence = {
          result: transferGrading ? (transferGrading.passed ? 'correct' : 'incorrect') : conceptScore >= 70 ? 'correct' : conceptScore >= 50 ? 'partial' : 'incorrect',
          difficulty: actualDifficulty,
          sourceType: config.evidenceSource,
          confidenceWeight: 0.9,
          // The real score and how many questions backed it -- a 15/15
          // (100%) result moves mastery further than a single correct
          // answer would, instead of both collapsing into the same
          // "correct" bucket.
          scorePercent: conceptScore,
          sampleSize: bucket.total,
        };

        const hintsUsed = bucket.questionIndexes.filter((i) => quizSession.hintsUsedQuestions.includes(i)).length;
        // CANON-R5R1A Part 0/10/11/13, CANON-R6 Part 13 -- PRIMARY
        // INVARIANT: canonical STAGE verification alone (R5R1) is
        // insufficient. Before this concept's evidence may ever be
        // labeled `studyus-canonical-v1`, the ACTUALLY administered
        // activity must satisfy the AUTHORIZED contract persisted at
        // generation time (never re-derived here, never trusted from
        // this request): real item count, real aggregate difficulty,
        // and -- for an independent contract (PROVE) -- zero hints used.
        // `aiAssistanceType` mirrors `mastery.service.ts`'s own
        // `computedAiAssistanceType` derivation (hintsUsed > 0 implies
        // some assistance was recorded) rather than a second, competing
        // computation -- for a genuine v1 Prove session this should be
        // structurally unreachable anyway, since `canUseAI` already
        // denies every hint/Tutor request for an INDEPENDENT
        // (SOLO_CHECK) evidenceMode session at the source (Part 8/9) --
        // this check is defense-in-depth, never the only enforcement.
        // A violation is reported, never silently clamped/fabricated/
        // erased -- the row is simply never labeled v1 (falls through as
        // ordinary, unversioned evidence, exactly like any other legacy
        // attempt).
        const actualAiAssistanceType = hintsUsed > 0 ? (hintsUsed > 1 ? 'MULTIPLE_HINTS' : 'HINT') : 'NONE';
        const isAuthorizedConcept = !!quizSession.v1Marker && conceptId === quizSession.conceptId;
        const v1Compliance = isAuthorizedConcept
          ? checkV1ActivityContractCompliance({
              authorization: quizSession.v1Marker!,
              actualItemCount: bucket.total,
              actualDifficulty,
              actualHintsUsed: hintsUsed,
              actualAiAssistanceType,
            })
          : null;
        const v1Qualifies = isAuthorizedConcept && v1Compliance!.compliant;
        if (isAuthorizedConcept && !v1Compliance!.compliant) {
          console.warn('[canon-r5r1a]', JSON.stringify({
            reason: v1Compliance!.reason,
            detail: v1Compliance!.detail,
            quizId: validated.quizId,
            conceptId,
          }));
        }
        const masteryResult = await updateMastery({
          studentId: validated.studentId,
          conceptId,
          subjectId: quizSession.subjectId,
          evidence,
          // Phase 2B: quiz_sessions.id is minted once at generation and
          // never regenerated on retry -- the stable logical identity
          // for "this quiz submission's evidence for this concept."
          // Concept-scoped so a multi-concept quiz's other buckets
          // remain independently retryable (Phase 2B Step 13).
          identity: { operationType: 'QUIZ_SUBMISSION', operationId: validated.quizId, conceptId },
          telemetry: {
            activityType: 'quiz',
            learningMode,
            hintsUsed,
            confidenceBeforeAnswer: bucket.confidenceBeforeAnswer,
          },
          // Phase 3A: every evidence event records which Activity Type/
          // Evidence Mode produced it -- the attempt-level values fixed
          // at storeQuiz time, never re-derived from anything mutable.
          // Phase 1D: withBehaviorMetadata additively appends `behavior.
          // responseTimes` (one entry per question in this concept's
          // bucket) only when at least one question actually reported
          // usable timing -- otherwise this object is byte-identical to
          // the pre-Phase-1D metadata.
          metadata: withBehaviorMetadata(
            {
              activityType: quizSession.activityType,
              evidenceMode: quizSession.evidenceMode,
              // F11-C2: explicit Skill target, set ONLY when this exact
              // quiz was generated by Skill-reinforcement orchestration
              // for THIS concept -- never derived from the Concept->Skill
              // graph here or anywhere else. `targetSkillIds` is null for
              // every quiz that predates this phase and every ordinary
              // Practice/Concept-reinforcement quiz, so this line
              // contributes nothing to their metadata (byte-identical).
              ...(quizSession.targetSkillIds && quizSession.targetSkillIds.length > 0 && conceptId === quizSession.conceptId
                ? { skillIds: quizSession.targetSkillIds }
                : {}),
              // F11-C3: explicit Competency target, same pattern as
              // F11-C2's Skill line immediately above -- null for every
              // quiz that predates this phase and every non-Competency
              // quiz, so this line contributes nothing to their metadata.
              ...(quizSession.targetCompetencyIds && quizSession.targetCompetencyIds.length > 0 && conceptId === quizSession.conceptId
                ? { competencyIds: quizSession.targetCompetencyIds }
                : {}),
              ...(bucket.questionSemantics.length > 0 ? { questionSemantics: bucket.questionSemantics } : {}),
              // Phase 0E1: AI provenance for any free-text-graded question
              // in this concept's evidence -- additive, doesn't change the
              // meaning of any existing metadata field.
              ...(bucket.aiGrading.length > 0 ? { aiGrading: bucket.aiGrading } : {}),
              // CANON-R5R1/R5R1A -- ONLY when this bucket is the exact
              // concept a trusted, server-persisted v1 marker authorized
              // (loaded from quiz_sessions, never the request body) AND
              // the actually-administered activity satisfied that
              // marker's own contract (v1Qualifies, computed above).
              // itemCount/correctCount are the REAL administered/graded
              // counts, never the originally-requested maxQuestions.
              ...(v1Qualifies
                ? {
                    pedagogicalPolicyVersion: quizSession.v1Marker!.pedagogicalPolicyVersion,
                    canonicalRevision: quizSession.v1Marker!.canonicalRevision,
                    canonicalStage: quizSession.v1Marker!.canonicalStage,
                    // CANON-R6 Part 18: additive -- previously implied
                    // only by `activityType` (already 'SOLO_CHECK' or
                    // 'PRACTICE' at the top level); persisted here too so
                    // the canonical stage/activity pairing is explicit
                    // and auditable directly from `metadata` alone.
                    canonicalActivityType: quizSession.v1Marker!.canonicalActivityType,
                    itemCount: bucket.total,
                    correctCount: bucket.correct,
                  }
                : {}),
              // CANON-V2-ARCH-CLEANUP Section 9/10/11 -- the REAL,
              // independently-graded 3-challenge Transfer breakdown
              // (StudyUSTransferChallengeScore[], evidence-adapter.ts's
              // own required shape) plus, only on failure, the ONE
              // explicit non-misconception diagnostic
              // (CRITICAL_MISCONCEPTION is never decided here -- see
              // canonical-transfer-grading.ts's own doc comment). Only
              // ever present for a v1Qualifies canonical_transfer
              // submission; every other quizMode's metadata is
              // byte-identical to before this phase.
              ...(v1Qualifies && transferGrading
                ? {
                    transferChallenges: transferChallengeGrades.map((c) => ({
                      depth: c.depth,
                      scorePercent: c.scorePercent,
                      reasoningProvided: c.reasoningProvided,
                    })),
                    ...(transferGrading.passed ? {} : { transferFailureDiagnostic: transferGrading.diagnostic }),
                  }
                : {}),
              // CANON-R5R1A Part 11 -- an explicit, traceable diagnostic
              // for an authorized-but-violating attempt: NEVER fabricated
              // v1 compliance, NEVER erased, NEVER silently clamped --
              // the row simply carries no policyVersion/canonicalRevision/
              // canonicalStage at all (falls through as ordinary,
              // unversioned evidence), plus this marker documenting why.
              ...(isAuthorizedConcept && !v1Qualifies
                ? {
                    v1ActivityContractViolation: {
                      reason: v1Compliance!.reason,
                      detail: v1Compliance!.detail,
                      authorizedItemCount: quizSession.v1Marker!.itemCount,
                      actualItemCount: bucket.total,
                      authorizedDifficulty: quizSession.v1Marker!.difficulty,
                      actualDifficulty,
                    },
                  }
                : {}),
            },
            toResponseTimingEntries(bucket.responseTimings)
          ),
        });
        // mastery_records.mastery_score (and updateMastery's old/new/delta,
        // which read and write it) is canonically 0-100 already -- pass
        // through as-is. Do NOT multiply by 100: forensic audit confirmed
        // this column is already percentage points (see mastery-format.ts).
        // priorConceptScorePercent (Phase 3B assessment verification, a
        // few lines down) and the API response below both need this same
        // raw 0-100 value -- neither should convert it.
        return {
          conceptId,
          conceptLabel: conceptLabels.get(conceptId) || conceptId,
          score: conceptScore,
          previousMastery: masteryResult.oldMastery,
          newMastery: masteryResult.newMastery,
          delta: masteryResult.delta,
          // CANON-R5R1A -- threaded out so the Results canonical
          // re-fetch below (which only ever concerns the ONE concept a
          // v1 marker could ever authorize) knows whether THIS
          // submission's evidence actually qualified as v1, rather than
          // merely whether a marker existed at generation time.
          v1Qualifies,
          // Phase 2B: true when THIS concept bucket's evidence was
          // already applied by an earlier request for the same quizId
          // -- lets quiz-level (not concept-scoped) side effects below
          // (diagnostic resolution, remediation-step completion) avoid
          // double-processing a retried submission.
          duplicate: masteryResult.duplicate === true,
          // LX-9R3 A6/E: present only for retention_check evidence --
          // see MasteryUpdateResult.retentionCheckQualified's own doc
          // comment. The results screen must never claim retention was
          // demonstrated/completed when this is false, regardless of
          // score.
          retentionCheckQualified: masteryResult.retentionCheckQualified,
        };
      })
      );
    } catch (persistenceError) {
      try {
        // eslint-disable-next-line no-console
        console.error('[evidence-persistence]', JSON.stringify({
          canonicalErrorCode: 'EVIDENCE_PERSISTENCE_FAILED',
          operationId: validated.quizId,
          conceptId: quizSession.conceptId,
          activityType: quizSession.activityType,
        }));
      } catch { /* logging must never break the response */ }
      return NextResponse.json(
        {
          error: 'EVIDENCE_PERSISTENCE_FAILED',
          canonicalErrorCode: toCanonicalErrorCode('EVIDENCE_PERSISTENCE_FAILED').code,
          message: "We couldn't save this attempt. Your progress has not been updated. Please try again.",
        },
        { status: 500 }
      );
    }

    // Phase 3B: Assessment Verification -- only for Cumulative
    // Assessment/Mock Exam attempts. Evaluates the deterministic
    // trigger engine per concept and, when triggered, generates and
    // persists ONE verification question (evidence disambiguation, not
    // extra questions on every answer). Best-effort and isolated from
    // the main result: a failure here (e.g. AI generation unavailable)
    // never blocks the student from seeing their real result --
    // "graceful AI failure" per the Phase 3B brief.
    const verificationNeeded: Array<{ conceptId: string; conceptLabel: string; question: ReturnType<typeof toClientQuestion>; reason: string }> = [];
    // Evidence strength per concept -- never a mastery label. "HIGH"/
    // "MEDIUM"/"LOW"/"CONTRADICTED" describes how trustworthy THIS
    // attempt's evidence is, not whether the concept is mastered; that
    // still comes exclusively from Phase 2.2's Knowledge State.
    const evidenceQualifications: Record<string, ReturnType<typeof qualifyEvidence>> = {};
    if (quizSession.activityType === 'CUMULATIVE_ASSESSMENT' || quizSession.activityType === 'MOCK_EXAM') {
      // Concept mapping confidence: only Mock Exam has a real signal to
      // derive this from -- its concepts are pulled from a real
      // scheduled assessment_occurrences row, so the SAME attribution
      // granularity Phase 3 Pre-flight already computes for real exams
      // (CONCEPT_MAPPED/TOPICS_LIST/SUBJECT_WIDE) applies here too,
      // fetched once and reused across every concept in this attempt.
      // Cumulative Assessment's concepts are picked by the app itself
      // (not tied to any scheduled occurrence), so there's no equivalent
      // real signal -- conceptMappingConfidence stays genuinely
      // undefined for it, never a fabricated number.
      let examConceptAttributions: Array<{ conceptId: string; confidenceWeight: number }> = [];
      if (quizSession.activityType === 'MOCK_EXAM') {
        try {
          const occurrence = await getNextOccurrence(quizSession.subjectId).catch(() => null);
          if (occurrence) {
            examConceptAttributions = await getConceptAttribution(occurrence.id, quizSession.subjectId, occurrence.topics);
          }
        } catch (error) {
          console.error('Concept mapping confidence lookup failed:', error);
        }
      }

      await Promise.all(
        Array.from(byConcept.entries()).map(async ([conceptId, bucket]) => {
          try {
            const conceptScore = Math.round((bucket.correct / bucket.total) * 100);
            const priorResult = perConceptResults.find((r) => r.conceptId === conceptId);
            const decision = evaluateAssessmentEvidence({
              activityType: quizSession.activityType as 'CUMULATIVE_ASSESSMENT' | 'MOCK_EXAM',
              gradingConfidences: bucket.gradingConfidences,
              currentScorePercent: conceptScore,
              priorConceptScorePercent: priorResult ? priorResult.previousMastery : null,
              conceptMappingConfidence: deriveConceptMappingConfidence(examConceptAttributions, conceptId),
              conceptCoverageBreadth: computeConceptCoverageBreadth(bucket.questionTypes),
            });
            evidenceQualifications[conceptId] = qualifyEvidence(decision.assessmentConfidenceBeforeVerification);
            if (!decision.required) {
              await recordDecisionEvent({
                decisionType: 'VERIFICATION_NOT_REQUIRED',
                engine: 'verification-engine',
                engineVersion: 'v1',
                studentId: validated.studentId,
                subjectId: quizSession.subjectId,
                conceptId,
                sourceEventType: 'assessment_attempt',
                reasonCode: 'NO_TRIGGER_FIRED',
                reasonDetails: { assessmentConfidenceBeforeVerification: decision.assessmentConfidenceBeforeVerification },
              });
              return;
            }

            // Target the specific question/evidence item that actually
            // caused the trigger -- the bucket's lowest-confidence
            // (most ambiguous) graded question, tie-broken
            // deterministically -- never an arbitrary "first question."
            // Selected FIRST, before generation, so the variant request
            // below is always built from the real ambiguous question.
            const { questionIndex: originalQuestionIndex, gradingConfidence: originalGradingConfidence } = selectMostAmbiguousQuestion(
              bucket.questionIndexes,
              bucket.gradingConfidences
            );
            const originalQuestion = cachedQuestions[originalQuestionIndex];
            if (!originalQuestion) return; // defensive -- nothing to verify against

            // generateQuestionVariant is the single generation +
            // equivalence authority (quiz-generation.service.ts) -- never
            // call generateQuestionsForConcept directly for a verification
            // question, which would bypass the equivalence contract
            // entirely (the bug this fixes).
            const variantResult = await generateQuestionVariant(originalQuestion, validated.studentId, quizSession.subjectId, language);

            let verificationQuestion: GeneratedQuestion;
            let variantEquivalenceConfidence: number | null;
            if (variantResult) {
              verificationQuestion = variantResult.variant;
              variantEquivalenceConfidence = variantResult.contract.equivalenceConfidence;
            } else {
              // generateQuestionVariant's own documented contract: on any
              // failure (generation error, empty result, or the raw
              // candidate failing the equivalence gate) callers fall back
              // to reusing the original source question -- never a
              // silently non-equivalent substitute. variantEquivalenceConfidence
              // is documented (assessment-confidence.ts, verification-triggers.ts)
              // as "only set when a generated variant was used" -- reusing
              // the original question means no variant was generated and no
              // equivalence evaluation ran, so there is nothing to record
              // here. null, never a fabricated 1.0.
              verificationQuestion = originalQuestion;
              variantEquivalenceConfidence = null;
            }

            const verificationAttemptId = await createPendingVerificationAttempt({
              quizSessionId: validated.quizId,
              studentId: validated.studentId,
              conceptId,
              originalQuestionIndex,
              originalQuestion,
              originalScorePercent: conceptScore,
              verificationQuestion,
              triggerIds: decision.triggers.map((t) => t.triggerId),
              gradingConfidence: originalGradingConfidence,
              variantEquivalenceConfidence,
              assessmentConfidenceBefore: decision.assessmentConfidenceBeforeVerification,
            });

            // Phase 0E2 Step 17: verification_attempts (above) remains
            // the domain transaction; this is why the system chose to
            // require it -- the actual trigger ids that fired, never
            // duplicated/redecided here.
            await recordDecisionEvent({
              decisionType: 'VERIFICATION_REQUIRED',
              engine: 'verification-engine',
              engineVersion: 'v1',
              studentId: validated.studentId,
              subjectId: quizSession.subjectId,
              conceptId,
              sourceEventType: 'verification_attempts',
              sourceEventId: verificationAttemptId,
              newState: { assessmentConfidenceBeforeVerification: decision.assessmentConfidenceBeforeVerification, severity: decision.severity },
              reasonCode: decision.triggers.map((t) => t.triggerId).join(',') || 'NO_TRIGGER_FIRED',
              reasonDetails: { triggers: decision.triggers, variantEquivalenceConfidence },
            });

            verificationNeeded.push({
              conceptId,
              conceptLabel: conceptLabels.get(conceptId) || conceptId,
              question: toClientQuestion(verificationQuestion, originalQuestionIndex),
              reason: decision.triggers[0]?.reason ?? 'Additional evidence would help confirm this result.',
            });
          } catch (error) {
            console.error(`Verification trigger evaluation failed for concept ${conceptId}:`, error);
          }
        })
      );
    }

    await completeQuiz(validated.quizId);

    // Phase 2B: diagnostic resolution and remediation-step completion
    // are quiz-level side effects of this ONE submission, tied to the
    // quiz's primary concept -- not themselves covered by the
    // (concept-scoped) evidence idempotency key. Skip both when that
    // primary concept's evidence was already applied by an earlier
    // request for this same quizId, so a retried submission can't
    // resolve a diagnosis or complete a remediation step twice.
    const primaryBucketDuplicate = quizSession.conceptId
      ? perConceptResults.find((r) => r.conceptId === quizSession.conceptId)?.duplicate === true
      : false;

    // Diagnostic Check resolution: the diagnosis is resolved from this
    // attempt's raw correct/total, not from the mastery-adjusted score,
    // since the diagnosis question is specifically "was the candidate
    // concept demonstrably weak right now", independent of how this
    // nudges the longer-running Mastery number.
    let diagnosticOutcome: { state: string; outcome: string } | null = null;
    if (quizSession.quizMode === 'diagnostic_check' && validated.diagnosisId && !primaryBucketDuplicate) {
      const bucket = byConcept.get(quizSession.conceptId || '');
      if (bucket) {
        const resolved = await resolveDiagnosticCheck(validated.diagnosisId, bucket.correct, bucket.total).catch(() => null);
        if (resolved) {
          diagnosticOutcome = { state: resolved.diagnosis.state, outcome: resolved.outcome };
          track(validated.studentId, 'diagnostic_check_completed', {
            diagnosisId: validated.diagnosisId,
            outcome: resolved.outcome,
            correctCount: bucket.correct,
            totalCount: bucket.total,
          });
        }
      }
    }

    if (validated.remediationStepId && !primaryBucketDuplicate) {
      await completeRemediationStep(validated.remediationStepId, { success: score >= 70, score }).catch((err) =>
        console.error('Failed to complete remediation step:', err)
      );
    }

    const primaryMastery = quizSession.conceptId
      ? perConceptResults.find((r) => r.conceptId === quizSession.conceptId)
      : null;

    // Attach evidence-strength labeling where it was computed (ASSESSMENT
    // mode only) -- undefined for Practice/Independent/Diagnostic results,
    // where Assessment Confidence was never calculated because it isn't
    // the relevant concept for those Evidence Modes.
    const perConceptResultsWithEvidence = perConceptResults.map((r) => ({
      ...r,
      evidenceQualification: evidenceQualifications[r.conceptId] ?? undefined,
    }));

    const ibContext = await getSubjectIBContext(quizSession.subjectId);
    const ibEstimate = ibContext
      ? ibContext.programme === 'DP'
        ? { programme: 'DP', grade: estimateDPGrade(score) }
        : { programme: 'MYP', band: estimateMYPBand(score) }
      : null;

    // Phase 3B: Mock Exam only -- compares this attempt's actual score
    // against the existing, already-built exam-readiness.service.ts
    // prediction. Pure calibration information (never mutates mastery
    // or Knowledge State); best-effort, since a missing/failed
    // prediction should never block the student from seeing their
    // real result.
    let examReadinessCalibration: ReturnType<typeof calculateExamReadinessCalibration> | null = null;
    if (quizSession.activityType === 'MOCK_EXAM') {
      try {
        const occurrence = await getNextOccurrence(quizSession.subjectId).catch(() => null);
        const predicted = await calculateExamReadiness(validated.studentId, quizSession.subjectId, occurrence?.daysUntil ?? 14, language);
        examReadinessCalibration = calculateExamReadinessCalibration(predicted.overallScore, score);
      } catch (error) {
        console.error('Exam Readiness calibration failed:', error);
      }
    }

    // LX-4R R7: after INDEPENDENT/ASSESSMENT evidence is written for a
    // single concept, re-read CANONICAL Evidence Sufficiency. One
    // correct answer never equals "Prove complete" -- the client shows
    // an activity-complete state ONLY when the canonical independent-
    // evidence gap is 0. It never decides the next activity (LX-5).
    let proveSufficiency:
      | { conceptId: string; sufficient: boolean; currentIndependentEvidenceCount: number; canonicalMinimumIndependentEvidenceCount: number; remainingGap: number }
      | null = null;
    if (
      quizSession.conceptId &&
      (quizSession.evidenceMode === 'INDEPENDENT' || quizSession.evidenceMode === 'ASSESSMENT')
    ) {
      try {
        const [policy, ks] = await Promise.all([
          getActiveMasteryPolicy(),
          getConceptKnowledgeState(validated.studentId, quizSession.conceptId),
        ]);
        if (ks) {
          const requirement = deriveEvidenceRequirement({
            activityType: quizSession.activityType,
            evidenceMode: quizSession.evidenceMode,
            targetDimension: 'INDEPENDENCE',
            masteryPolicy: policy,
            currentSufficiency: {
              evidenceCount: ks.evidenceCount,
              independentEvidenceCount: ks.independentEvidenceCount,
              passed:
                ks.evidenceCount >= policy.minimumEvidenceCount &&
                ks.independentEvidenceCount >= policy.minimumIndependentEvidenceCount,
            },
          });
          const gap =
            requirement.questionCount.status === 'DETERMINED'
              ? requirement.questionCount.pedagogicalRequirement
              : Math.max(0, policy.minimumIndependentEvidenceCount - ks.independentEvidenceCount);
          proveSufficiency = {
            conceptId: quizSession.conceptId,
            sufficient: gap === 0,
            currentIndependentEvidenceCount: ks.independentEvidenceCount,
            canonicalMinimumIndependentEvidenceCount: policy.minimumIndependentEvidenceCount,
            remainingGap: gap,
          };
        }
      } catch (e) {
        console.error('[LX-4R R7] prove sufficiency re-check failed:', e);
      }
    }

    // CANON-R5R1 Part 13/15/22 -- Results reconciliation. ONLY for a
    // genuinely v1-stamped attempt (quizSession.v1Marker, loaded from the
    // persisted session, never re-derived from this submission's own
    // score/mode), and only AFTER the evidence writes above have already
    // completed -- never a pre-quiz decision, never the final authority
    // before the write. A failed re-fetch NEVER rolls back or discards
    // the evidence already written; it returns a controlled, closed
    // `CANONICAL_RESULTS_UNAVAILABLE` status instead (Part 15) -- the
    // legacy next-action authority (proveSufficiency, mastery deltas
    // above) is still present in the response for the learner to see
    // their outcome, but is never substituted as "the next step" for a
    // v1 attempt.
    let canonicalResults: {
      stage: string;
      actionState: string;
      nextCanonicalAction: string;
      requirements: unknown;
      journeyProgressPercent: number;
      nextEligibleAt: string | null;
      waitingReason: string | null;
      reasonCodes: string[];
      policyVersion: string;
      canonicalRevision: string;
    } | null = null;
    let canonicalResultsStatus: 'NOT_V1' | 'OK' | 'CANONICAL_RESULTS_UNAVAILABLE' | 'V1_ACTIVITY_CONTRACT_VIOLATION' = 'NOT_V1';
    // CANON-R5R1A -- gated on whether THIS submission's evidence
    // actually qualified as v1 (contract-compliant), not merely whether
    // a marker existed at generation time (R5R1's own gate). A
    // contract-violating attempt is never treated as a valid v1
    // attempt for Results purposes -- no re-fetch, an explicit status
    // instead (Part 21: "this phase only strengthens whether an attempt
    // is eligible to be stamped as v1" -- the re-fetch's own ordering
    // and fail-safe behavior are otherwise unchanged from R5R1).
    const authorizedResult = quizSession.v1Marker ? perConceptResults.find((r) => r.conceptId === quizSession.conceptId) : undefined;
    if (quizSession.v1Marker && authorizedResult && !authorizedResult.v1Qualifies) {
      canonicalResultsStatus = 'V1_ACTIVITY_CONTRACT_VIOLATION';
    } else if (quizSession.v1Marker && authorizedResult?.v1Qualifies && quizSession.conceptId) {
      try {
        const fresh: CanonicalDecisionResult = await getCanonicalPedagogicalDecision({
          studentId: validated.studentId,
          conceptId: quizSession.conceptId,
        });
        canonicalResults = {
          stage: fresh.decision.stage,
          actionState: fresh.decision.actionState,
          nextCanonicalAction: fresh.decision.nextCanonicalAction,
          requirements: fresh.decision.requirements,
          journeyProgressPercent: fresh.decision.journeyProgressPercent,
          nextEligibleAt: fresh.decision.nextEligibleAt,
          waitingReason: fresh.decision.waitingReason,
          reasonCodes: fresh.decision.reasonCodes,
          policyVersion: fresh.decision.policyVersion,
          canonicalRevision: fresh.decision.canonicalRevision,
        };
        canonicalResultsStatus = 'OK';

        // CANON-R6-PERF-R2 Part 2 -- selective Prove pre-generation
        // trigger. Fires AFTER this v1-qualifying submission's evidence
        // was already written AND the fresh canonical decision (just
        // computed above, the SOLE authority) confirms PROVE/EXECUTABLE.
        // `after()` (Next.js's own supported mechanism for post-response
        // background work, backed by Vercel's `waitUntil` in production
        // -- no queue/job platform exists in this codebase, confirmed by
        // audit) schedules the ENTIRE preparation pipeline to run once
        // this response has already been sent -- the learner's own
        // Practice Results response is never delayed by so much as one
        // extra await. A background failure is caught entirely inside
        // `prepareCanonicalProveActivity` itself (Part 14) and can never
        // surface here or affect this response, which has already
        // returned by the time it could.
        if (fresh.decision.stage === 'PROVE' && fresh.decision.actionState === 'EXECUTABLE' && fresh.decision.activityContract) {
          const contract = fresh.decision.activityContract;
          const authorizedItemCount = resolveAuthorizedItemCount(contract.itemCount);
          if (authorizedItemCount != null && contract.minimumScorePercent != null) {
            const preparedContract: PreparedActivityContractSnapshot = {
              canonicalActivityType: contract.activityType,
              itemCount: { min: contract.itemCount!.min, max: contract.itemCount!.max, authorized: authorizedItemCount },
              difficulty: { min: contract.difficulty.min, max: contract.difficulty.max, target: contract.difficulty.target },
              independence: contract.independence,
              supportLevel: contract.supportLevel,
              minimumScorePercent: contract.minimumScorePercent,
            };
            after(() =>
              prepareCanonicalProveActivity({
                studentId: validated.studentId,
                conceptId: quizSession.conceptId!,
                subjectId: quizSession.subjectId,
                pedagogicalPolicyVersion: fresh.decision.policyVersion,
                canonicalRevision: fresh.decision.canonicalRevision,
                contract: preparedContract,
                language: quizSession.language,
                // Reuses the SAME guidance string canonical_prove's own
                // live generation uses (QUIZ_MODE_CONFIG) -- never a
                // second, drifted copy.
                guidance: QUIZ_MODE_CONFIG.canonical_prove.guidance,
                visualAidRate: QUIZ_MODE_CONFIG.canonical_prove.visualAidRate,
                ibContext: null,
              }).catch((err) => console.error('[canon-r6-perf-r2] background Prove preparation failed:', err)),
            );
          }
        }
      } catch (error) {
        if (!(error instanceof CanonicalDecisionUnavailableError)) throw error;
        canonicalResultsStatus = 'CANONICAL_RESULTS_UNAVAILABLE';
        console.error('[canon-r5r1] canonical results re-fetch failed:', error, error.cause);
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        quizId: validated.quizId,
        results: { score, correctCount, incorrectCount, totalQuestions },
        proveSufficiency,
        canonicalResults,
        canonicalResultsStatus,
        // CANON-V2-FINAL-HARDENING Section 3 -- additive: the SAME
        // canonical failure category the taxonomy module reports for
        // every other canonical error path in this route, so a client
        // can key off ONE vocabulary regardless of which specific
        // status string produced it. `null` for the two non-error
        // statuses (NOT_V1, OK).
        canonicalErrorCode:
          canonicalResultsStatus === 'OK' || canonicalResultsStatus === 'NOT_V1'
            ? null
            : toCanonicalErrorCode(canonicalResultsStatus).code,
        mastery: primaryMastery
          ? { previous: primaryMastery.previousMastery, current: primaryMastery.newMastery, delta: primaryMastery.delta }
          : undefined,
        // LX-9R3 A6/E: present only when quizMode is retention_check --
        // see MasteryUpdateResult.retentionCheckQualified. The results
        // screen must derive its completion copy from THIS, never from
        // score alone (a good score on a too-soon attempt is real
        // performance, but memory-policy.ts's own spacing gate means it
        // was never counted as retention evidence).
        retentionCheckQualified: quizSession.activityType === 'RETENTION_CHECK' ? primaryMastery?.retentionCheckQualified : undefined,
        // CANON-V2-FINAL-HARDENING Section 10 -- the SAME-REQUEST
        // Transfer breakdown (Section 21: same-request consistency --
        // the client should never need a second fetch to see what it
        // just did). Present only for a v1Qualifies canonical_transfer
        // submission; `undefined` for every other quizMode/request.
        // Mirrors exactly what was just written to
        // learning_evidence.metadata (transferChallenges/
        // transferFailureDiagnostic) -- never a second, independently
        // recomputed value.
        transferResult:
          authorizedResult?.v1Qualifies && transferGrading
            ? {
                nearScore: transferGrading.nearScore,
                contextualScore: transferGrading.contextualScore,
                higherScore: transferGrading.higherScore,
                overallScore: transferGrading.overallScore,
                passed: transferGrading.passed,
                diagnostic: transferGrading.diagnostic,
              }
            : undefined,
        perConceptResults: perConceptResultsWithEvidence,
        review,
        messageKey: score >= 80 ? 'excellent' : score >= 50 ? 'good' : 'keep_going',
        ibEstimate,
        diagnosticOutcome,
        // Phase 3B: present only for Cumulative Assessment/Mock Exam
        // concepts whose evidence was ambiguous enough to warrant one
        // more disambiguating question -- empty for every Practice/
        // Independent/Diagnostic attempt and for any Assessment attempt
        // whose evidence was already strong.
        verificationNeeded,
        examReadinessCalibration,
      },
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'INVALID_INPUT', message: error.issues[0]?.message }, { status: 400 });
    }
    throw error;
  }
}
