/**
 * QUIZ_RESPONSE_AUDIT_PERSISTENCE -- per-question responses and grades,
 * written once per submission (migration 20261015_1000_quiz_response_audit).
 *
 *   quiz_responses        what the learner wrote, verbatim
 *   quiz_response_grades  how it was graded (model identity + verdict)
 *
 * Separate from learning_evidence; never changes a score; idempotent (ON
 * CONFLICT DO NOTHING on (session, question) and (response, model, prompt
 * version)), so a repeated or concurrent submission never duplicates rows.
 * `getQuizReviewFromAudit` rebuilds the final review from these rows plus
 * the immutable administered questions.
 */
import { createHash } from 'crypto';
import { db } from '@/lib/db';
import type { GeneratedQuestion } from '@/services/quiz-generation.service';
import type { PedagogicalGrade } from '@/lib/grading/pedagogical-grade';
import { pedagogicalFeedbackText } from '@/lib/grading/pedagogical-feedback';

/** Stable fingerprint of the administered question (key order independent). */
export function questionFingerprint(question: unknown): string {
  const stable = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(stable)
      : v && typeof v === 'object'
        ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, stable((v as Record<string, unknown>)[k])]))
        : v;
  return createHash('sha256').update(JSON.stringify(stable(question))).digest('hex');
}

export interface GradedResponseInput {
  questionIndex: number;
  question: GeneratedQuestion;
  rawAnswer: string;
  gradeResult: {
    correct: boolean;
    score: number;
    feedback?: string;
    errorType?: string | null;
    pedagogical?: PedagogicalGrade;
    aiExecution?: { aiExecutionId?: string; aiProvider?: string; aiModel?: string; aiPromptId?: string; aiPromptVersion?: string };
  };
}

export interface GradeRow {
  gradingModel: 'PEDAGOGICAL_V1' | 'STRUCTURED' | 'LEGACY';
  graderProvider: string | null;
  graderModel: string | null;
  graderPromptId: string | null;
  graderPromptVersion: string;
  aiExecutionId: string | null;
  isCorrect: boolean;
  score: number;
  finalJudgment: 'CORRECT' | 'ALMOST' | 'INCORRECT';
  mathematicalCorrectness: string | null;
  taskCompletion: string | null;
  reasoningQuality: string | null;
  missingRequirements: string[];
  learnerSignal: string | null;
  errorType: string | null;
  misconception: string | null;
  mathCheckResult: string | null;
  mathCheckSetup: string | null;
  feedbackDidWell: string | null;
  feedbackMissing: string[];
  feedbackToFix: string | null;
  feedbackText: string | null;
}

/** Pure: the grade row for one graded response (what was decided, by which grader). */
export function toGradeRow(input: GradedResponseInput, language: string): GradeRow {
  const g = input.gradeResult;
  const p = g.pedagogical;
  const ai = g.aiExecution;
  const structured = input.question.answerFormat !== 'text';
  const gradingModel: GradeRow['gradingModel'] = structured ? 'STRUCTURED' : p ? 'PEDAGOGICAL_V1' : 'LEGACY';
  const text = p ? pedagogicalFeedbackText(p, language) : null;
  const score = Math.max(0, Math.min(1, Number.isFinite(g.score) ? g.score : 0));
  return {
    gradingModel,
    graderProvider: structured ? null : ai?.aiProvider ?? null,
    graderModel: structured ? 'deterministic-structured' : ai?.aiModel ?? null,
    graderPromptId: structured ? null : ai?.aiPromptId ?? null,
    graderPromptVersion: structured ? 'structured' : ai?.aiPromptVersion ?? 'unknown',
    aiExecutionId: structured ? null : ai?.aiExecutionId ?? null,
    isCorrect: g.correct,
    score,
    finalJudgment: p?.finalJudgment ?? (g.correct ? 'CORRECT' : score > 0 ? 'ALMOST' : 'INCORRECT'),
    mathematicalCorrectness: p?.mathematicalCorrectness ?? null,
    taskCompletion: p?.taskCompletion ?? null,
    reasoningQuality: p?.reasoningQuality ?? null,
    missingRequirements: p?.missingRequirements ?? [],
    learnerSignal: p?.learnerSignal ?? null,
    errorType: g.errorType ?? p?.errorType ?? null,
    misconception: p?.misconception ?? null,
    mathCheckResult: p?.mathCheck.result ?? null,
    mathCheckSetup: p?.mathCheck.setup ?? null,
    feedbackDidWell: text?.didWell ?? null,
    feedbackMissing: text?.missing ?? [],
    feedbackToFix: text?.toFix ?? null,
    feedbackText: (text?.combined || g.feedback || null) ?? null,
  };
}

/**
 * Persists every graded response of one submission in ONE transaction.
 * Returns how many response / grade rows were newly written (0 on a repeat).
 */
export async function recordQuizResponses(params: {
  quizSessionId: string;
  studentId: string;
  canonicalActivityType: string | null;
  evidenceMode: string | null;
  language: string;
  responses: GradedResponseInput[];
}): Promise<{ responsesWritten: number; gradesWritten: number }> {
  const client = await db.connect();
  let responsesWritten = 0;
  let gradesWritten = 0;
  try {
    await client.query('BEGIN');
    for (const r of params.responses) {
      const inserted = await client.query(
        `INSERT INTO quiz_responses (quiz_session_id, question_index, question_id, question_fingerprint, question_type, answer_format,
                                     canonical_activity_type, evidence_mode, student_id, concept_id, student_answer)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (quiz_session_id, question_index) DO NOTHING
         RETURNING id`,
        [
          params.quizSessionId, r.questionIndex, r.question.id ?? null, questionFingerprint(r.question), r.question.type,
          r.question.answerFormat ?? 'text', params.canonicalActivityType, params.evidenceMode, params.studentId,
          r.question.conceptId ?? null, r.rawAnswer,
        ],
      );
      let responseId: string | undefined = inserted.rows[0]?.id;
      if (responseId) responsesWritten++;
      else {
        const existing = await client.query(`SELECT id FROM quiz_responses WHERE quiz_session_id = $1 AND question_index = $2`, [params.quizSessionId, r.questionIndex]);
        responseId = existing.rows[0]?.id;
      }
      if (!responseId) continue;
      const g = toGradeRow(r, params.language);
      const gradeInsert = await client.query(
        `INSERT INTO quiz_response_grades (response_id, grading_model, grader_provider, grader_model, grader_prompt_id, grader_prompt_version, ai_execution_id,
                                           is_correct, score, final_judgment, mathematical_correctness, task_completion, reasoning_quality,
                                           missing_requirements, learner_signal, error_type, misconception, math_check_result, math_check_setup,
                                           feedback_did_well, feedback_missing, feedback_to_fix, feedback_text)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
         ON CONFLICT (response_id, grading_model, grader_prompt_version) DO NOTHING
         RETURNING id`,
        [
          responseId, g.gradingModel, g.graderProvider, g.graderModel, g.graderPromptId, g.graderPromptVersion, g.aiExecutionId,
          g.isCorrect, g.score, g.finalJudgment, g.mathematicalCorrectness, g.taskCompletion, g.reasoningQuality,
          g.missingRequirements, g.learnerSignal, g.errorType, g.misconception, g.mathCheckResult, g.mathCheckSetup,
          g.feedbackDidWell, g.feedbackMissing, g.feedbackToFix, g.feedbackText,
        ],
      );
      if (gradeInsert.rows.length > 0) gradesWritten++;
    }
    await client.query('COMMIT');
    return { responsesWritten, gradesWritten };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export interface AuditedReviewItem {
  questionIndex: number;
  question: GeneratedQuestion;
  questionFingerprintMatches: boolean;
  studentAnswer: string;
  finalJudgment: 'CORRECT' | 'ALMOST' | 'INCORRECT';
  isCorrect: boolean;
  score: number;
  missingRequirements: string[];
  learnerSignal: string | null;
  misconception: string | null;
  feedback: { didWell: string | null; missing: string[]; toFix: string | null };
  grader: { gradingModel: string; model: string | null; promptVersion: string };
  gradedAt: string;
}

/** Rebuilds a session's final review from the audit rows (latest grade per response) and the administered questions. */
export async function getQuizReviewFromAudit(quizSessionId: string, studentId: string): Promise<AuditedReviewItem[] | null> {
  const session = await db.query(`SELECT questions FROM quiz_sessions WHERE id = $1 AND student_id = $2`, [quizSessionId, studentId]);
  if (session.rows.length === 0) return null;
  const questions: GeneratedQuestion[] = session.rows[0].questions;
  const rows = await db.query(
    `SELECT DISTINCT ON (r.question_index)
            r.question_index, r.question_fingerprint, r.student_answer,
            g.final_judgment, g.is_correct, g.score, g.missing_requirements, g.learner_signal, g.misconception,
            g.feedback_did_well, g.feedback_missing, g.feedback_to_fix, g.grading_model, g.grader_model, g.grader_prompt_version, g.graded_at
       FROM quiz_responses r
       JOIN quiz_response_grades g ON g.response_id = r.id
      WHERE r.quiz_session_id = $1 AND r.student_id = $2
      ORDER BY r.question_index, g.graded_at DESC`,
    [quizSessionId, studentId],
  );
  return rows.rows.map((row) => {
    const question = questions[row.question_index];
    return {
      questionIndex: row.question_index,
      question,
      questionFingerprintMatches: !!question && questionFingerprint(question) === row.question_fingerprint,
      studentAnswer: row.student_answer,
      finalJudgment: row.final_judgment,
      isCorrect: row.is_correct,
      score: Number(row.score),
      missingRequirements: row.missing_requirements ?? [],
      learnerSignal: row.learner_signal,
      misconception: row.misconception,
      feedback: { didWell: row.feedback_did_well, missing: row.feedback_missing ?? [], toFix: row.feedback_to_fix },
      grader: { gradingModel: row.grading_model, model: row.grader_model, promptVersion: row.grader_prompt_version },
      gradedAt: new Date(row.graded_at).toISOString(),
    };
  });
}
