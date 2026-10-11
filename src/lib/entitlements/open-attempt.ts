/**
 * L11-R1 / D-8(c) -- read-only proofs that an attempt was already started.
 * Used only to decide whether the learning licence is still required; never
 * an authorization decision (ownership stays with the route / its service).
 */
import { db } from '@/lib/db';

/**
 * True when this teacher-assigned task already has an execution for this
 * idempotency key: the Student started it earlier, and "Start" / "Continue"
 * now only recovers that same activity (the dispatcher returns RECOVERED and
 * generates nothing). Any error reads as "not started".
 */
export async function hasStartedTeacherInterventionExecution(interventionId: string, idempotencyKey: string): Promise<boolean> {
  try {
    const result = await db.query(
      `SELECT 1 FROM teacher_intervention_executions WHERE teacher_intervention_id = $1 AND idempotency_key = $2 LIMIT 1`,
      [interventionId, idempotencyKey]
    );
    return result.rows.length > 0;
  } catch {
    return false;
  }
}
