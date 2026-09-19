/**
 * F11-C1 -- Concept Reinforcement Execution Orchestration. This file
 * is an ORCHESTRATOR, never a learning engine: it never writes
 * learning_evidence/mastery_records/readiness_snapshots/diagnoses, and
 * never duplicates F8's or the Practice engine's own logic. It launches
 * a real TOPIC_PRACTICE quiz via the SAME service functions the
 * existing `/api/quizzes/generate-and-take` route itself calls
 * (`generatePracticeQuestions`, `storeQuiz`), records a REFERENCE to it
 * in `teacher_intervention_executions`, and later RECONCILES completion
 * by reading `quiz_sessions` back (`getQuizSession`) -- it never
 * duplicates or re-implements the student's own submit/grading flow,
 * which remains entirely unmodified and un-called-into from here.
 *
 * Execution authority is Student/Owner ONLY (`isOwner`) -- never
 * Teacher (`canTeacherAccessLearner`/`canTeacherManageIntervention`),
 * never Parent (`isActiveParentOf`), never the generic composed
 * `canAccessLearner`. A Teacher assigning an intervention never
 * authorizes the Teacher to execute it.
 */
import { db } from '@/lib/db';
import { isOwner } from '@/lib/authorization';
import { generatePracticeQuestions } from '@/services/quiz-generation.service';
import { storeQuiz, getQuizSession } from '@/services/quiz-persistence.service';

export class StudentInterventionAccessDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StudentInterventionAccessDeniedError';
  }
}

export class StudentInterventionNotFoundError extends Error {
  constructor(interventionId: string) {
    super(`No teacher_interventions row found for id ${interventionId}`);
    this.name = 'StudentInterventionNotFoundError';
  }
}

export class StudentInterventionNotStartableError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'StudentInterventionNotStartableError';
  }
}

export type TeacherInterventionStatus = 'ASSIGNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'EXPIRED';

/**
 * Stored status is the operational record of what actually happened
 * (a real execution started / a real execution completed / a Teacher
 * cancelled it). Effective status additionally accounts for time
 * passing (`due_at`) WITHOUT a cron/job ever mutating the stored row --
 * derived on every read, exactly like this codebase's other lazy
 * time-based checks. A row's stored status is never itself EXPIRED by
 * this function; only the value returned to callers is.
 */
export function getEffectiveStatus(storedStatus: TeacherInterventionStatus, dueAt: string | null): TeacherInterventionStatus {
  if (dueAt && (storedStatus === 'ASSIGNED' || storedStatus === 'IN_PROGRESS') && new Date(dueAt).getTime() < Date.now()) {
    return 'EXPIRED';
  }
  return storedStatus;
}

export interface StudentTeacherIntervention {
  id: string;
  studentId: string;
  classId: string;
  targetType: string;
  interventionType: string;
  reason: string | null;
  instructions: string | null;
  assignedAt: string;
  dueAt: string | null;
  storedStatus: TeacherInterventionStatus;
  effectiveStatus: TeacherInterventionStatus;
}

function toStudentIntervention(row: any): StudentTeacherIntervention {
  const storedStatus: TeacherInterventionStatus = row.status;
  const dueAt = row.due_at instanceof Date ? row.due_at.toISOString() : row.due_at;
  return {
    id: row.id,
    studentId: row.student_id,
    classId: row.class_id,
    targetType: row.target_type,
    interventionType: row.intervention_type,
    reason: row.reason,
    instructions: row.instructions,
    assignedAt: row.assigned_at instanceof Date ? row.assigned_at.toISOString() : row.assigned_at,
    dueAt,
    storedStatus,
    effectiveStatus: getEffectiveStatus(storedStatus, dueAt),
  };
}

/**
 * `studentId` here is always server-resolved by the caller (the route)
 * from the actor's own canonical identity -- never a client-supplied
 * value -- so there is nothing here TO leak to another student; the
 * WHERE clause is the whole authorization boundary for this list.
 * Cancelled interventions never appear. An effectively-EXPIRED one is
 * still returned (visible, but not startable -- see
 * startConceptReinforcementExecution) so the student can see it was
 * missed, not silently hidden.
 */
export async function getStudentPendingTeacherInterventions(studentId: string): Promise<StudentTeacherIntervention[]> {
  await reconcileCompletionsForStudent(studentId);
  const result = await db.query(
    `SELECT * FROM teacher_interventions WHERE student_id = $1 AND status IN ('ASSIGNED', 'IN_PROGRESS') ORDER BY assigned_at DESC`,
    [studentId]
  );
  return result.rows.map(toStudentIntervention);
}

/**
 * Lazy reconciliation (task's own preferred option 3 -- derive/reconcile
 * from canonical persistence, since the existing submit route has no
 * hook and must not be modified): for every ACTIVE execution linked to
 * one of this student's non-terminal interventions, check whether the
 * REAL quiz_sessions row it references has independently reached
 * 'completed' (written by the existing, unmodified submit route this
 * file never calls into). If so, mark the execution and the
 * intervention COMPLETED. This performs no evidence writes and derives
 * no academic judgment -- it only observes an already-true fact.
 */
async function reconcileCompletionsForStudent(studentId: string): Promise<void> {
  const activeExecutions = await db.query(
    `
    SELECT tie.id AS execution_id, tie.execution_reference, tie.teacher_intervention_id
    FROM teacher_intervention_executions tie
    JOIN teacher_interventions ti ON ti.id = tie.teacher_intervention_id
    WHERE ti.student_id = $1 AND ti.status = 'IN_PROGRESS' AND tie.execution_type = 'TOPIC_PRACTICE' AND tie.status = 'ACTIVE'
    `,
    [studentId]
  );

  for (const row of activeExecutions.rows) {
    const quizSession = await getQuizSession(row.execution_reference).catch(() => null);
    if (quizSession?.status !== 'completed') continue;

    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE teacher_intervention_executions SET status = 'COMPLETED', completed_at = now(), updated_at = now() WHERE id = $1 AND status = 'ACTIVE'`,
        [row.execution_id]
      );
      await client.query(
        `UPDATE teacher_interventions SET status = 'COMPLETED', updated_at = now() WHERE id = $1 AND status = 'IN_PROGRESS'`,
        [row.teacher_intervention_id]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

export type StartExecutionResult =
  | { outcome: 'STARTED'; executionId: string; executionReference: string }
  | { outcome: 'RECOVERED'; executionId: string; executionReference: string }
  | { outcome: 'NOT_EXECUTABLE_YET'; interventionType: string };

/**
 * The full authorization + executability + idempotency chain, in one
 * lock-serialized operation per intervention (mirrors F8's own
 * `recordInterventionAttempt` SELECT ... FOR UPDATE precedent):
 *   1. resolve the intervention row (404 if missing)
 *   2. actor IS the intervention's own student (isOwner ONLY --
 *      never Teacher, never Parent, never the generic composed check)
 *   3. effective status must be ASSIGNED or IN_PROGRESS (never
 *      CANCELLED, COMPLETED, or effectively-EXPIRED)
 *   4. only CONCEPT_REINFORCEMENT + target_type=CONCEPT is executable
 *      in F11-C1 -- every other type returns NOT_EXECUTABLE_YET, never
 *      a silent translation
 *   5. idempotency: an existing row for (interventionId, idempotencyKey)
 *      is returned as-is (RECOVERED), never re-launched
 *   6. otherwise: generate + store a real TOPIC_PRACTICE quiz (the
 *      SAME functions the existing route calls), record the execution
 *      reference, and transition the intervention to IN_PROGRESS --
 *      all within the same lock.
 */
export async function startConceptReinforcementExecution(
  actorUserId: string,
  interventionId: string,
  idempotencyKey: string
): Promise<StartExecutionResult> {
  const client = await db.connect();
  let claimed: { studentId: string; conceptId: string; classId: string } | null = null;
  try {
    await client.query('BEGIN');
    const interventionRow = await client.query(`SELECT * FROM teacher_interventions WHERE id = $1 FOR UPDATE`, [interventionId]);
    if (interventionRow.rows.length === 0) {
      await client.query('ROLLBACK');
      throw new StudentInterventionNotFoundError(interventionId);
    }
    const intervention = interventionRow.rows[0];

    const ownsIntervention = await isOwner(actorUserId, intervention.student_id);
    if (!ownsIntervention) {
      await client.query('ROLLBACK');
      throw new StudentInterventionAccessDeniedError('actor does not own this intervention (Teacher and Parent relationships never authorize execution)');
    }

    const effectiveStatus = getEffectiveStatus(intervention.status, intervention.due_at ? new Date(intervention.due_at).toISOString() : null);
    if (effectiveStatus !== 'ASSIGNED' && effectiveStatus !== 'IN_PROGRESS') {
      await client.query('ROLLBACK');
      throw new StudentInterventionNotStartableError(`intervention effective status is ${effectiveStatus}, not startable`);
    }

    if (intervention.intervention_type !== 'CONCEPT_REINFORCEMENT' || intervention.target_type !== 'CONCEPT' || !intervention.concept_id) {
      await client.query('COMMIT');
      return { outcome: 'NOT_EXECUTABLE_YET', interventionType: intervention.intervention_type };
    }

    const existing = await client.query(
      `SELECT id, execution_reference FROM teacher_intervention_executions WHERE teacher_intervention_id = $1 AND idempotency_key = $2`,
      [interventionId, idempotencyKey]
    );
    if (existing.rows.length > 0) {
      await client.query('COMMIT');
      return { outcome: 'RECOVERED', executionId: existing.rows[0].id, executionReference: existing.rows[0].execution_reference };
    }

    claimed = { studentId: intervention.student_id, conceptId: intervention.concept_id, classId: intervention.class_id };
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  if (!claimed) throw new Error('unreachable: claimed must be set when reaching this point');

  // Real generation + persistence happens OUTSIDE the row lock (these
  // call out to AI generation, which must never hold a DB lock open) --
  // the idempotency_key UNIQUE constraint below is the actual
  // concurrency guard for the (rare) case of two truly simultaneous
  // requests both passing the lock-protected check above.
  const conceptRow = await db.query(`SELECT subject_id FROM concepts WHERE id = $1`, [claimed.conceptId]);
  const subjectId = conceptRow.rows[0]?.subject_id;
  if (!subjectId) throw new Error(`concept ${claimed.conceptId} has no subject_id`);

  const questions = await generatePracticeQuestions(claimed.conceptId, claimed.studentId, subjectId, {});
  const quizId = await storeQuiz(claimed.studentId, claimed.conceptId, subjectId, questions, 'en', 'topic_practice', []);

  try {
    const insertResult = await db.query(
      `
      INSERT INTO teacher_intervention_executions (teacher_intervention_id, execution_type, execution_reference, idempotency_key, status)
      VALUES ($1, 'TOPIC_PRACTICE', $2, $3, 'ACTIVE')
      RETURNING id
      `,
      [interventionId, quizId, idempotencyKey]
    );
    await db.query(
      `UPDATE teacher_interventions SET status = 'IN_PROGRESS', updated_at = now() WHERE id = $1 AND status = 'ASSIGNED'`,
      [interventionId]
    );
    return { outcome: 'STARTED', executionId: insertResult.rows[0].id, executionReference: quizId };
  } catch (error: any) {
    if (error?.code === '23505') {
      // Lost a genuine race to another concurrent request with the SAME
      // idempotency key -- recover its row rather than surfacing a
      // duplicate-key error. The just-created quiz_sessions row above
      // becomes a harmless, unreferenced orphan (ordinary practice
      // data, not a correctness issue for F11's own state).
      const recovered = await db.query(
        `SELECT id, execution_reference FROM teacher_intervention_executions WHERE teacher_intervention_id = $1 AND idempotency_key = $2`,
        [interventionId, idempotencyKey]
      );
      if (recovered.rows.length > 0) {
        return { outcome: 'RECOVERED', executionId: recovered.rows[0].id, executionReference: recovered.rows[0].execution_reference };
      }
    }
    throw error;
  }
}
