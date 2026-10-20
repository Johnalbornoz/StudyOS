/**
 * B5-D -- answers in progress of a canonical learning assessment (IO).
 *
 * A draft is what the Student has written so far, kept so that leaving and coming back restores it. It is
 * stored in the EXISTING per-question response record (`quiz_responses`: "what the learner wrote", one row
 * per session and question) -- no new response model. A draft row has no grade row; every consumer of graded
 * responses joins the grade and therefore never sees a draft.
 *
 * A draft is NOT evidence: nothing here grades, scores, attributes, or touches mastery, evidence or
 * Knowledge State. Evidence is produced only by completion (the B3 loop).
 *
 * Only an ACTIVE, unexpired, CANONICAL session of the signed-in Student accepts drafts, and only for its own
 * frozen questions.
 */
import { db } from '@/lib/db';
import type { GeneratedQuestion } from '@/services/quiz-generation.service';
import { questionFingerprint } from '@/services/quiz-response-audit.service';

export interface DraftAnswer {
  /** The frozen item key the question carries (`assessmentItemKey`). */
  itemKey: string;
  /** The encoded answer; empty clears the draft. */
  answer: string;
}

export type DraftRefusal = 'NOT_FOUND' | 'NOT_CANONICAL' | 'NOT_ACTIVE';
export type DraftSaveResult = { ok: true; saved: number; cleared: number } | { ok: false; reason: DraftRefusal };

type StoredQuestion = GeneratedQuestion & { assessmentItemKey?: string };

export async function saveDraftAnswers(input: { studentId: string; sessionId: string; answers: readonly DraftAnswer[] }): Promise<DraftSaveResult> {
  const r = await db.query(
    `SELECT student_id, status, questions, activity_type, evidence_mode, (expires_at <= now()) AS expired, (assessment_snapshot IS NOT NULL) AS canonical FROM quiz_sessions WHERE id = $1`,
    [input.sessionId]
  );
  const session = r.rows[0];
  if (!session || session.student_id !== input.studentId) return { ok: false, reason: 'NOT_FOUND' };
  if (!session.canonical) return { ok: false, reason: 'NOT_CANONICAL' };
  if (session.status !== 'active' || session.expired) return { ok: false, reason: 'NOT_ACTIVE' };

  const questions = (Array.isArray(session.questions) ? session.questions : []) as StoredQuestion[];
  const indexByKey = new Map<string, number>();
  questions.forEach((q, index) => {
    if (q.assessmentItemKey) indexByKey.set(q.assessmentItemKey, index);
  });
  let saved = 0;
  let cleared = 0;
  const seen = new Set<number>();
  for (const a of input.answers) {
    const index = indexByKey.get(a.itemKey);
    // an answer to anything that is not a frozen question of this session is ignored
    if (index === undefined || seen.has(index)) continue;
    seen.add(index);
    const question = questions[index];
    if (a.answer.trim().length === 0) {
      const gone = await db.query(
        `DELETE FROM quiz_responses qr WHERE qr.quiz_session_id = $1 AND qr.question_index = $2 AND qr.student_id = $3
            AND NOT EXISTS (SELECT 1 FROM quiz_response_grades g WHERE g.response_id = qr.id)`,
        [input.sessionId, index, input.studentId]
      );
      cleared += gone.rowCount ?? 0;
      continue;
    }
    // a graded response is final: it is never overwritten by a draft
    const written = await db.query(
      `INSERT INTO quiz_responses (quiz_session_id, question_index, question_id, question_fingerprint, question_type, answer_format,
                                   canonical_activity_type, evidence_mode, student_id, concept_id, student_answer)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (quiz_session_id, question_index) DO UPDATE SET student_answer = EXCLUDED.student_answer
         WHERE quiz_responses.student_id = EXCLUDED.student_id
           AND NOT EXISTS (SELECT 1 FROM quiz_response_grades g WHERE g.response_id = quiz_responses.id)
       RETURNING id`,
      [input.sessionId, index, question.id ?? null, questionFingerprint(question), question.type, question.answerFormat ?? 'text', session.activity_type ?? null, session.evidence_mode ?? null, input.studentId, question.conceptId ?? null, a.answer]
    );
    saved += written.rowCount ?? 0;
  }
  return { ok: true, saved, cleared };
}

/** The saved answers of a session, by frozen item key. Read-only. */
export async function loadDraftAnswers(sessionId: string, studentId: string, questions: ReadonlyArray<{ assessmentItemKey?: string }>): Promise<Record<string, string>> {
  const r = await db.query(`SELECT question_index, student_answer FROM quiz_responses WHERE quiz_session_id = $1 AND student_id = $2 ORDER BY question_index`, [sessionId, studentId]);
  const out: Record<string, string> = {};
  for (const row of r.rows as Array<{ question_index: number; student_answer: string }>) {
    const key = questions[row.question_index]?.assessmentItemKey;
    if (key) out[key] = row.student_answer;
  }
  return out;
}
