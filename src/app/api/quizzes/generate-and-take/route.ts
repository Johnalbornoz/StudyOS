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

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyStudentAccess, type UserRole } from '@/lib/auth';
import { db } from '@/lib/db';
import {
  generateQuestionsForConcept,
  generateQuestionVariant,
  gradeAnswer,
  gradeStructuredAnswer,
  GeneratedQuestion,
  ALL_QUESTION_TYPES,
  IBContext,
} from '@/services/quiz-generation.service';
import { storeQuiz, getQuizSession, completeQuiz, QuizMode } from '@/services/quiz-persistence.service';
import { updateMastery } from '@/services/mastery.service';
import { getStudentMastery } from '@/services/mastery.service';
import { getIndependentMastery, shouldAskConfidence, type ConfidenceLevel } from '@/services/learner-model.service';
import { getNextOccurrence } from '@/services/assessment.service';
import { recordError } from '@/services/error-intelligence.service';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { resolveQuizLanguage } from '@/lib/i18n/language';
import { isLocale } from '@/lib/i18n/messages';
import type { LearningEvidence, EvidenceSourceType } from '@/lib/algorithms/mastery';
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

// Phase 3A: single-concept quiz modes -- every other mode spans several
// concepts and is selected via selectConceptsForQuizMode/conceptIds instead.
type SingleConceptQuizMode = 'topic_practice' | 'review' | 'quick_check' | 'retention_check' | 'diagnostic_check';
const SINGLE_CONCEPT_MODES: readonly SingleConceptQuizMode[] = ['topic_practice', 'review', 'quick_check', 'retention_check', 'diagnostic_check'];
function isSingleConceptMode(mode: QuizMode): mode is SingleConceptQuizMode {
  return (SINGLE_CONCEPT_MODES as readonly QuizMode[]).includes(mode);
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
};

const GenerateQuizSchema = z.object({
  studentId: z.string().uuid(),
  subjectId: z.string().uuid(),
  conceptId: z.string().uuid().optional(),
  conceptIds: z.array(z.string().uuid()).optional(), // manual topic selection for cumulative_assessment/exam_simulation
  quizMode: z.enum(['topic_practice', 'review', 'quick_check', 'retention_check', 'cumulative_assessment', 'exam_simulation', 'diagnostic_check']).default('topic_practice'),
  maxQuestions: z.number().int().min(1).max(20).optional(),
  difficulty: z.number().int().min(1).max(5).optional(),
  language: z.string().optional(),
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

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Strip the correct answer/order/pairing before sending a question to the client. */
function toClientQuestion(q: GeneratedQuestion, index: number) {
  return {
    index,
    conceptId: q.conceptId,
    type: q.type,
    answerFormat: q.answerFormat,
    question: q.question,
    difficulty: q.difficulty,
    calculatorAllowed: q.calculatorAllowed,
    options: q.options ? shuffleArray(q.options) : undefined,
    matchingLeft: q.matchingPairs?.map((p) => p.left),
    matchingRightShuffled: q.matchingPairs ? shuffleArray(q.matchingPairs.map((p) => p.right)) : undefined,
    orderingItemsShuffled: q.orderingItems ? shuffleArray(q.orderingItems) : undefined,
    classificationItems: q.classificationItems?.map((it) => it.item),
    classificationCategories: q.classificationCategories,
    visualAid: q.visualAid,
    askConfidence: q.askConfidence || undefined,
  };
}

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
  try {
    const validated = GenerateQuizSchema.parse(body);

    const canAccess = await verifyStudentAccess(userId, validated.studentId, role);
    if (!canAccess) {
      return NextResponse.json({ error: 'FORBIDDEN', message: 'Cannot access this student' }, { status: 403 });
    }

    if (isSingleConceptMode(validated.quizMode) && !validated.conceptId) {
      return NextResponse.json(
        { error: 'INVALID_INPUT', message: 'conceptId is required for this quiz mode' },
        { status: 400 }
      );
    }

    const language = isLocale(validated.language)
      ? validated.language
      : await resolveLanguageForSubject(validated.subjectId, validated.studentId);
    const ibContext = await getSubjectIBContext(validated.subjectId);

    const config = QUIZ_MODE_CONFIG[validated.quizMode];
    // Diagnostic Check is always short (2-4 questions) regardless of what was requested -- it's a targeted check, not a full quiz.
    const maxQuestions =
      validated.quizMode === 'diagnostic_check'
        ? Math.max(2, Math.min(4, validated.maxQuestions ?? config.defaultMax))
        : Math.max(1, Math.min(20, validated.maxQuestions ?? config.defaultMax));

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

    const [questionArrays, askConfidenceFlags] = await Promise.all([
      Promise.all(
        conceptIds.map((cId) =>
          generateQuestionsForConcept(cId, validated.studentId, validated.subjectId, {
            count: perConceptCap,
            difficulty: validated.difficulty || 3,
            types: ALL_QUESTION_TYPES,
            guidance: config.guidance,
            language,
            visualAidRate: config.visualAidRate,
            ibContext,
          })
        )
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

    const questions = shuffleArray(questionArrays.flat()).slice(0, maxQuestions);

    if (questions.length === 0) {
      return NextResponse.json(
        { error: 'GENERATION_FAILED', message: 'Failed to generate quiz questions' },
        { status: 500 }
      );
    }

    const quizId = await storeQuiz(
      validated.studentId,
      primaryConceptId,
      validated.subjectId,
      questions,
      language,
      validated.quizMode,
      conceptIds
    );

    if (validated.quizMode === 'diagnostic_check') {
      track(validated.studentId, 'diagnostic_check_started', { quizId, conceptId: primaryConceptId });
    }

    return NextResponse.json({
      success: true,
      data: {
        quizId,
        language,
        quizMode: validated.quizMode,
        maxQuestions,
        ibProgramme: ibContext?.programme || 'none',
        quiz: {
          questions: questions.map(toClientQuestion),
          count: questions.length,
        },
        message: 'Quiz generated. Submit answers with this quizId to complete.',
      },
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'INVALID_INPUT', message: error.issues[0]?.message }, { status: 400 });
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
    if (!quizSession) {
      return NextResponse.json(
        { error: 'QUIZ_NOT_FOUND', message: 'Quiz expired or not found. Generate a new quiz.' },
        { status: 400 }
      );
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

        if (question.answerFormat === 'text') {
          const gradeResult = await gradeAnswer(question, answer.answer, language);
          return { questionIndex: answer.questionIndex, question, rawAnswer: answer.answer, gradeResult, reportedConfidence: answer.confidence };
        }
        const structured = gradeStructuredAnswer(question, answer.answer);
        return {
          questionIndex: answer.questionIndex,
          question,
          rawAnswer: answer.answer,
          gradeResult: { ...structured, confidence: 1, errorType: null as null },
          reportedConfidence: answer.confidence,
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
      }
    >();

    for (const g of graded) {
      if (!g) continue;
      const { questionIndex, question, rawAnswer, gradeResult, reportedConfidence } = g;

      if (gradeResult.score >= 0.5) correctCount++;
      else incorrectCount++;

      const bucket = byConcept.get(question.conceptId) || {
        correct: 0,
        total: 0,
        questionIndexes: [],
        questionSemantics: [],
        gradingConfidences: [],
        questionTypes: [],
      };
      bucket.total++;
      if (gradeResult.score >= 0.5) bucket.correct++;
      bucket.questionIndexes.push(questionIndex);
      bucket.gradingConfidences.push(gradeResult.confidence);
      bucket.questionTypes.push(question.type);
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

    const perConceptResults = await Promise.all(
      Array.from(byConcept.entries()).map(async ([conceptId, bucket]) => {
        const conceptScore = Math.round((bucket.correct / bucket.total) * 100);
        const evidence: LearningEvidence = {
          result: conceptScore >= 70 ? 'correct' : conceptScore >= 50 ? 'partial' : 'incorrect',
          difficulty: 3,
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
        const masteryResult = await updateMastery({
          studentId: validated.studentId,
          conceptId,
          subjectId: quizSession.subjectId,
          evidence,
          telemetry: {
            activityType: 'quiz',
            learningMode,
            hintsUsed,
            confidenceBeforeAnswer: bucket.confidenceBeforeAnswer,
          },
          // Phase 3A: every evidence event records which Activity Type/
          // Evidence Mode produced it -- the attempt-level values fixed
          // at storeQuiz time, never re-derived from anything mutable.
          metadata: {
            activityType: quizSession.activityType,
            evidenceMode: quizSession.evidenceMode,
            ...(bucket.questionSemantics.length > 0 ? { questionSemantics: bucket.questionSemantics } : {}),
          },
        });
        return {
          conceptId,
          conceptLabel: conceptLabels.get(conceptId) || conceptId,
          score: conceptScore,
          previousMastery: masteryResult.oldMastery,
          newMastery: masteryResult.newMastery,
          delta: masteryResult.delta,
        };
      })
    );

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
            if (!decision.required) return;

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

            await createPendingVerificationAttempt({
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

    // Diagnostic Check resolution: the diagnosis is resolved from this
    // attempt's raw correct/total, not from the mastery-adjusted score,
    // since the diagnosis question is specifically "was the candidate
    // concept demonstrably weak right now", independent of how this
    // nudges the longer-running Mastery number.
    let diagnosticOutcome: { state: string; outcome: string } | null = null;
    if (quizSession.quizMode === 'diagnostic_check' && validated.diagnosisId) {
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

    if (validated.remediationStepId) {
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

    return NextResponse.json({
      success: true,
      data: {
        quizId: validated.quizId,
        results: { score, correctCount, incorrectCount, totalQuestions },
        mastery: primaryMastery
          ? { previous: primaryMastery.previousMastery, current: primaryMastery.newMastery, delta: primaryMastery.delta }
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
