/**
 * B5-R -- the ONE completion authority of a canonical learning assessment (IO).
 *
 *   submitted answers
 *     -> the existing per-question grader (`gradeQuizAnswer`), one call per frozen question
 *     -> the B3 evidence loop (attribution -> `updateMastery` -> Knowledge State)
 *     -> PostAssessmentState
 *
 * A route calls this and nothing else: it writes no evidence, computes no mastery, picks no concept and
 * builds no operation key. Answers are matched to the FROZEN questions by the item key the start stamped on
 * each; an answer to anything else is ignored, and a frozen question with no answer is unanswered (never a
 * failure).
 *
 * Only a CANONICAL attempt completes here; a session without a snapshot belongs to the legacy path.
 *
 * A repeated call (a retry) grades again but applies no evidence twice: the writer's operation key is the
 * session and the concept, enforced by the database.
 */
import { db } from '@/lib/db';
import type { EvidenceMode } from '@/lib/activity-taxonomy';
import { gradeQuizAnswer } from '@/lib/quiz/grade-question';
import type { GeneratedQuestion } from '@/services/quiz-generation.service';
import { canonicalNextDecision, completeAssessmentEvidence, type EvidenceLoopDeps } from './assessment-execution.service';
import type { ScoredResponse } from './evidence-plan';
import type { PostAssessmentState } from './post-assessment';

export interface SubmittedAnswer {
  /** The frozen item key the question carries (`assessmentItemKey`). */
  itemKey: string;
  answer: string;
  hintsUsed?: number;
}

export type CompletionRefusal = 'NOT_FOUND' | 'NOT_CANONICAL' | 'EXPIRED' | 'SNAPSHOT_UNUSABLE' | 'GRADING_FAILED';

export type CompletionResult = { ok: true; state: PostAssessmentState } | { ok: false; reason: CompletionRefusal; detail?: string };

export interface CompletionDeps {
  grade: (question: GeneratedQuestion, answer: string, language: string, evidenceMode: EvidenceMode, context: { studentId: string; subjectId: string }) => Promise<{ score: number }>;
  loop: typeof completeAssessmentEvidence;
  loopDeps: Partial<EvidenceLoopDeps>;
}

const defaults: CompletionDeps = {
  grade: (question, answer, language, evidenceMode, context) => gradeQuizAnswer(question, answer, language, evidenceMode, context),
  loop: completeAssessmentEvidence,
  // After the state update, the Learning Decision authority is asked for its own next decision.
  loopDeps: { nextDecision: canonicalNextDecision },
};

export async function completeLearningAssessment(input: { studentId: string; sessionId: string; answers: readonly SubmittedAnswer[] }, overrides: Partial<CompletionDeps> = {}): Promise<CompletionResult> {
  const deps = { ...defaults, ...overrides };
  const r = await db.query(
    `SELECT student_id, subject_id, status, language, evidence_mode, questions, hints_used_questions, (expires_at <= now()) AS expired, (assessment_snapshot IS NOT NULL) AS canonical
       FROM quiz_sessions WHERE id = $1`,
    [input.sessionId]
  );
  const session = r.rows[0];
  // another Student's session is indistinguishable from one that does not exist
  if (!session || session.student_id !== input.studentId) return { ok: false, reason: 'NOT_FOUND' };
  if (!session.canonical) return { ok: false, reason: 'NOT_CANONICAL' };
  if (session.status === 'active' && session.expired) return { ok: false, reason: 'EXPIRED' };

  const questions = (Array.isArray(session.questions) ? session.questions : []) as Array<GeneratedQuestion & { assessmentItemKey?: string }>;
  const hinted = new Set<number>((session.hints_used_questions ?? []) as number[]);
  const answerByKey = new Map<string, SubmittedAnswer>();
  for (const a of input.answers) if (typeof a.answer === 'string' && !answerByKey.has(a.itemKey)) answerByKey.set(a.itemKey, a);

  const responses: ScoredResponse[] = [];
  for (const [index, question] of questions.entries()) {
    const itemKey = question.assessmentItemKey;
    if (!itemKey) continue;
    const submitted = answerByKey.get(itemKey);
    if (!submitted || submitted.answer.trim().length === 0) {
      responses.push({ itemKey, responseRef: null, status: 'UNANSWERED', fraction: null });
      continue;
    }
    try {
      const graded = await deps.grade(question, submitted.answer, session.language ?? 'es', session.evidence_mode as EvidenceMode, { studentId: input.studentId, subjectId: session.subject_id });
      // hints recorded by the session for this question are the source; a client cannot erase them
      responses.push({ itemKey, responseRef: null, status: 'SCORED', fraction: Math.max(0, Math.min(1, Number(graded.score))), hintsUsed: Math.max(hinted.has(index) ? 1 : 0, 0) });
    } catch (e) {
      // no partial evidence: nothing has been written yet, and nothing will be for this call
      return { ok: false, reason: 'GRADING_FAILED', detail: e instanceof Error ? e.message.slice(0, 200) : undefined };
    }
  }

  const result = await deps.loop({ record: { kind: 'QUIZ_SESSION', id: input.sessionId }, studentId: input.studentId, attemptRef: input.sessionId, responses }, deps.loopDeps);
  if (!result.ok) return { ok: false, reason: 'SNAPSHOT_UNUSABLE', detail: result.reason };
  // the session is finished: it will not be resumed, and a new start is a new assessment
  await db.query(`UPDATE quiz_sessions SET status = 'completed', completed_at = COALESCE(completed_at, now()) WHERE id = $1 AND status = 'active'`, [input.sessionId]);
  return { ok: true, state: result.state };
}
