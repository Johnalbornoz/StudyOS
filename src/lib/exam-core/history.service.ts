/**
 * Exam history -- one delete contract for every row of the Student's exam
 * history, whatever produced it.
 *
 *   Attempt with an Exam V2 instance  -> the instance's own rules
 *                                        (exam-instance.service deleteExamInstance).
 *   Attempt without an instance       -> soft hide (simulation_attempts.hidden_at);
 *   (pre-V2 Exam Prep simulations)       an ACTIVE / PAUSED one is ABANDONED first.
 *
 * Never deleted or reset, in either case: the attempt row, its responses, its
 * scored result and audit trail, consolidated learning evidence and learner
 * state ("Deleting a completed exam must not annul or delete consolidated
 * learner evidence"). Owner-scoped: another Student's attempt is NOT_FOUND.
 * Idempotent: deleting an already deleted row returns the same outcome.
 */
import { db } from '@/lib/db';
import { getSimulationAttempt, abandonSimulationAttempt } from '@/lib/simulation/attempt.service';
import { findInstanceByAttempt, deleteExamInstance, ExamInstanceError } from './exam-instance.service';

/** What the Student is about to delete, in the words of the history UI. */
export type HistoryDeleteKind = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';

export interface HistoryDeleteOutcome {
  status: 'DELETED';
  /** The scored result (if any) is kept as audit history. */
  resultPreserved: boolean;
  /** An in-progress attempt was cancelled and can never be resumed. */
  attemptAbandoned: boolean;
  alreadyDeleted: boolean;
}

/** True when the attempt no longer belongs to the Student's visible history. */
export async function isAttemptDeletedFromHistory(simulationAttemptId: string): Promise<boolean> {
  const r = await db.query(
    `SELECT sa.hidden_at IS NOT NULL OR EXISTS (SELECT 1 FROM exam_instances i WHERE i.simulation_attempt_id = sa.id AND i.status = 'DELETED') AS deleted
       FROM simulation_attempts sa WHERE sa.id = $1`,
    [simulationAttemptId]
  );
  return r.rows[0]?.deleted === true;
}

export async function deleteAttemptFromHistory(simulationAttemptId: string, params: { confirm: boolean; ownerStudentId: string; reason?: string }): Promise<HistoryDeleteOutcome> {
  const attempt = await getSimulationAttempt(simulationAttemptId);
  if (!attempt || attempt.studentId !== params.ownerStudentId) throw new ExamInstanceError('NOT_FOUND');

  const instance = await findInstanceByAttempt(attempt.id);
  if (instance) {
    const wasDeleted = instance.status === 'DELETED';
    const out = await deleteExamInstance(instance.id, { confirm: params.confirm, ownerStudentId: params.ownerStudentId, reason: params.reason });
    return { status: 'DELETED', resultPreserved: out.resultPreserved, attemptAbandoned: out.attemptAbandoned, alreadyDeleted: wasDeleted };
  }

  const hidden = (await db.query(`SELECT hidden_at FROM simulation_attempts WHERE id = $1`, [attempt.id])).rows[0]?.hidden_at;
  if (hidden) return { status: 'DELETED', resultPreserved: attempt.status === 'COMPLETED', attemptAbandoned: false, alreadyDeleted: true };
  if (!params.confirm) throw new ExamInstanceError('CONFIRMATION_REQUIRED', attempt.status);

  let attemptAbandoned = false;
  if (attempt.status === 'ACTIVE' || attempt.status === 'PAUSED') {
    try {
      await abandonSimulationAttempt(attempt.id);
      attemptAbandoned = true;
    } catch {
      // It finished in between (COMPLETED): it is then hidden as a completed attempt.
    }
  }
  const after = await getSimulationAttempt(attempt.id);
  await db.query(`UPDATE simulation_attempts SET hidden_at = now(), hidden_reason = $2 WHERE id = $1 AND hidden_at IS NULL`, [attempt.id, (params.reason ?? 'STUDENT_REQUEST').slice(0, 200)]);
  const resultPreserved = after?.status === 'COMPLETED';
  console.log('[exam-core]', JSON.stringify({ at: 'exam_attempt_hidden', attemptId: attempt.id, from: attempt.status, resultPreserved, attemptAbandoned }));
  return { status: 'DELETED', resultPreserved, attemptAbandoned, alreadyDeleted: false };
}
