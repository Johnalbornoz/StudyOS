/**
 * LEARNING_ACTIVITY_DELIVERY -- the ONE place background work turns an
 * activity type into validated candidates, by calling the SAME certified
 * pipelines the live path used (practice chunks, Prove concurrent chunks +
 * novelty + diversity, Retain novelty, Transfer depths), with the SAME
 * per-mode guidance (quiz-mode-config.ts). Never called on a learner's
 * launch hot path.
 */
import { generatePracticeQuestions, type GeneratedQuestion, type IBContext } from '@/services/quiz-generation.service';
import { generateCanonicalProveQuestions } from '@/services/canonical-prove-generation.service';
import { generateCanonicalRetainQuestions } from '@/services/canonical-retain-generation.service';
import { generateCanonicalTransferChallenges } from '@/services/canonical-transfer-generation.service';
import { activityTypeForQuizMode, type QuizMode } from '@/services/quiz-persistence.service';
import { QUIZ_MODE_CONFIG } from '@/lib/quiz/quiz-mode-config';
import { PROMPT_REGISTRY } from '@/lib/ai/prompt-registry';
import { resolveModels } from '@/lib/ai/model-routing';
import { QUIZ_MODE_FOR_ACTIVITY, type DeliveryActivityType } from '@/lib/activity-delivery/contract';

export interface CandidateGenerationParams {
  activityType: DeliveryActivityType;
  conceptId: string;
  studentId: string;
  subjectId: string;
  count: number;
  difficulty: number;
  language: string;
  ibContext: IBContext | null;
  parentOperationId: string;
}

export interface CandidateGenerationResult {
  questions: GeneratedQuestion[];
  generator: { provider: string | null; model: string | null; promptId: string; promptVersion: string; operationId: string };
}

export async function generateActivityCandidates(p: CandidateGenerationParams): Promise<CandidateGenerationResult> {
  const quizMode = QUIZ_MODE_FOR_ACTIVITY[p.activityType] as QuizMode;
  const config = QUIZ_MODE_CONFIG[quizMode];
  const common = {
    conceptId: p.conceptId,
    studentId: p.studentId,
    subjectId: p.subjectId,
    difficulty: p.difficulty,
    guidance: config.guidance,
    language: p.language,
    visualAidRate: config.visualAidRate,
    ibContext: p.ibContext,
    activityType: activityTypeForQuizMode(quizMode),
    quizMode,
    parentOperationId: p.parentOperationId,
  };
  let questions: GeneratedQuestion[];
  switch (p.activityType) {
    case 'PROVE':
      questions = (await generateCanonicalProveQuestions({ ...common, targetCount: p.count })).questions;
      break;
    case 'RETAIN':
      questions = (await generateCanonicalRetainQuestions({ ...common, targetCount: p.count })).questions;
      break;
    case 'TRANSFER':
      questions = (
        await generateCanonicalTransferChallenges({
          conceptId: p.conceptId, studentId: p.studentId, subjectId: p.subjectId, difficulty: p.difficulty,
          guidance: config.guidance, language: p.language, visualAidRate: config.visualAidRate, ibContext: p.ibContext,
        })
      ).questions;
      break;
    default:
      questions = await generatePracticeQuestions(p.conceptId, p.studentId, p.subjectId, {
        count: p.count,
        difficulty: p.difficulty,
        guidance: config.guidance,
        language: p.language,
        visualAidRate: config.visualAidRate,
        ibContext: p.ibContext,
        activityType: common.activityType,
        quizMode,
        parentOperationId: p.parentOperationId,
        // bank candidates are individually quality-gated; a complete set is enforced at assembly
        acceptPartial: true,
      });
  }
  return { questions, generator: questionGeneratorIdentity(p.parentOperationId) };
}

/** Which generator produced a candidate (stored on every bank row). */
export function questionGeneratorIdentity(operationId: string): CandidateGenerationResult['generator'] {
  const route = resolveModels('QUESTION_GENERATION');
  const prompt = PROMPT_REGISTRY['quiz.question_generation'];
  return { provider: route.provider, model: route.primary, promptId: prompt.id, promptVersion: prompt.version, operationId };
}
