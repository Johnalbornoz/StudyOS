/**
 * THE per-question grader -- shared by quiz submission
 * (/api/quizzes/generate-and-take, answers mode) and the assisted
 * per-question feedback check (/api/quizzes/session/[quizId]/check), so a
 * learner's immediate feedback and the evidence recorded at submission can
 * never disagree.
 *
 *  - free text: the AI grader, then the Response/Evidence Contract guard
 *    (LX-4F -- a correct final answer is never marked down for absent work
 *    on an ANSWER_ONLY question);
 *  - structured formats (single/multi choice, matching, ordering,
 *    classification): deterministic grading, confidence 1.
 *
 * Grading only -- persists nothing itself.
 */
import {
  gradeAnswer,
  gradeStructuredAnswer,
  type GeneratedQuestion,
  type QuestionType,
  type ExpectedReasoningType,
} from '@/services/quiz-generation.service';
import { deriveResponseEvidenceContract } from '@/lib/lx/response-evidence-contract';
import { applyResponseContractGuard } from '@/lib/lx/response-contract-grading';
import type { EvidenceMode } from '@/lib/activity-taxonomy';
import { pedagogicalGradeForStructured, type PedagogicalGrade } from '@/lib/grading/pedagogical-grade';

export async function gradeQuizAnswer(
  question: GeneratedQuestion,
  rawAnswer: string,
  language: string,
  evidenceMode: EvidenceMode,
  context: { studentId?: string; subjectId?: string },
) {
  if (question.answerFormat === 'text') {
    const gradeResult = await gradeAnswer(question, rawAnswer, language, context);
    const contract = deriveResponseEvidenceContract(
      {
        type: question.type as QuestionType,
        expectedReasoningType: (question.expectedReasoningType as ExpectedReasoningType | undefined) ?? null,
      },
      evidenceMode,
    );
    const guarded = applyResponseContractGuard(contract, gradeResult, {
      studentAnswer: rawAnswer,
      correctAnswer: question.correctAnswer,
    });
    // An ANSWER_ONLY repair (a verified-correct final answer) is a complete answer: the
    // pedagogical verdict follows it, so the review never contradicts the grade.
    const pedagogical: PedagogicalGrade | undefined =
      guarded.correct && gradeResult.pedagogical && gradeResult.pedagogical.finalJudgment !== 'CORRECT'
        ? { ...gradeResult.pedagogical, finalJudgment: 'CORRECT', taskCompletion: 'COMPLETE', missingRequirements: [], learnerSignal: 'NONE', errorType: null, misconception: null, score: 1, feedback: { ...gradeResult.pedagogical.feedback, toFix: null } }
        : gradeResult.pedagogical;
    return { ...gradeResult, ...guarded, pedagogical };
  }
  const structured = gradeStructuredAnswer(question, rawAnswer);
  return { ...structured, confidence: 1, errorType: null, pedagogical: pedagogicalGradeForStructured(structured.correct) };
}

export type QuizGradeResult = Awaited<ReturnType<typeof gradeQuizAnswer>>;
