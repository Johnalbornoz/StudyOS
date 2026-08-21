/**
 * Assessment Calendar Service
 *
 * Two distinct concepts, per the product spec:
 * - AssessmentScheduleRule: a recurring pattern ("Math exams are usually
 *   every Thursday"). Free-text description + the next date it applies.
 * - AssessmentOccurrence: one specific dated instance, optionally linked
 *   to a rule. Rescheduling ONE occurrence never touches the rule or
 *   any other occurrence.
 */

import { db } from '@/lib/db';

export type OccurrenceStatus =
  | 'expected'
  | 'confirmed'
  | 'rescheduled'
  | 'completed'
  | 'waiting_for_result'
  | 'result_recorded'
  | 'cancelled';

export interface AssessmentOccurrence {
  id: string;
  ruleId: string | null;
  subjectId: string;
  subjectName?: string;
  scheduledDate: string; // YYYY-MM-DD
  status: OccurrenceStatus;
  topics: string[];
  examReadiness: number | null;
  daysUntil: number;
}

function toOccurrence(row: any): AssessmentOccurrence {
  const scheduled = new Date(row.scheduled_date + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysUntil = Math.round((scheduled.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  return {
    id: row.id,
    ruleId: row.rule_id,
    subjectId: row.subject_id,
    subjectName: row.subject_name,
    scheduledDate: row.scheduled_date,
    status: row.status,
    topics: row.topics || [],
    examReadiness: row.exam_readiness !== null ? Number(row.exam_readiness) : null,
    daysUntil,
  };
}

/**
 * Schedule a one-off assessment occurrence for a subject. Pass
 * `occurrencePattern` to also create (or reuse) a recurring rule this
 * occurrence belongs to.
 */
export async function scheduleAssessment(
  subjectId: string,
  scheduledDate: string,
  options: { topics?: string[]; occurrencePattern?: string } = {}
): Promise<AssessmentOccurrence> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    let ruleId: string | null = null;
    if (options.occurrencePattern) {
      const ruleResult = await client.query(
        `
        INSERT INTO assessment_schedule_rules (subject_id, occurrence_pattern, next_scheduled_date)
        VALUES ($1, $2, $3)
        RETURNING id
        `,
        [subjectId, options.occurrencePattern, scheduledDate]
      );
      ruleId = ruleResult.rows[0].id;
    }

    const occResult = await client.query(
      `
      INSERT INTO assessment_occurrences (rule_id, subject_id, scheduled_date, status, topics)
      VALUES ($1, $2, $3, 'expected', $4)
      RETURNING id, rule_id, subject_id, scheduled_date, status, topics, exam_readiness
      `,
      [ruleId, subjectId, scheduledDate, options.topics || []]
    );

    await client.query('COMMIT');
    return toOccurrence(occResult.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Move an occurrence to a new date. This is the "school moved the exam"
 * case -- only this occurrence changes; the recurring rule and every
 * other occurrence stay exactly as they were.
 */
export async function rescheduleAssessment(
  occurrenceId: string,
  newDate: string
): Promise<AssessmentOccurrence | null> {
  const result = await db.query(
    `
    UPDATE assessment_occurrences
    SET scheduled_date = $1, status = 'rescheduled'
    WHERE id = $2
    RETURNING id, rule_id, subject_id, scheduled_date, status, topics, exam_readiness
    `,
    [newDate, occurrenceId]
  );
  return result.rows[0] ? toOccurrence(result.rows[0]) : null;
}

export async function cancelAssessment(occurrenceId: string): Promise<void> {
  await db.query(`UPDATE assessment_occurrences SET status = 'cancelled' WHERE id = $1`, [
    occurrenceId,
  ]);
}

/** The next upcoming (not cancelled/completed) occurrence for a subject. */
export async function getNextOccurrence(subjectId: string): Promise<AssessmentOccurrence | null> {
  const result = await db.query(
    `
    SELECT id, rule_id, subject_id, scheduled_date, status, topics, exam_readiness
    FROM assessment_occurrences
    WHERE subject_id = $1
      AND status NOT IN ('cancelled', 'completed', 'result_recorded')
      AND scheduled_date >= CURRENT_DATE
    ORDER BY scheduled_date ASC
    LIMIT 1
    `,
    [subjectId]
  );
  return result.rows[0] ? toOccurrence(result.rows[0]) : null;
}

/** Next upcoming occurrence per subject, across all of a student's subjects. */
export async function getUpcomingForStudent(studentId: string): Promise<AssessmentOccurrence[]> {
  const result = await db.query(
    `
    SELECT DISTINCT ON (ao.subject_id)
      ao.id, ao.rule_id, ao.subject_id, ao.scheduled_date, ao.status, ao.topics, ao.exam_readiness,
      s.name AS subject_name
    FROM assessment_occurrences ao
    JOIN subjects s ON s.id = ao.subject_id
    WHERE s.student_id = $1
      AND ao.status NOT IN ('cancelled', 'completed', 'result_recorded')
      AND ao.scheduled_date >= CURRENT_DATE
    ORDER BY ao.subject_id, ao.scheduled_date ASC
    `,
    [studentId]
  );
  return result.rows.map(toOccurrence).sort((a, b) => a.daysUntil - b.daysUntil);
}

export async function cacheReadinessScore(occurrenceId: string, score: number): Promise<void> {
  await db.query(`UPDATE assessment_occurrences SET exam_readiness = $1 WHERE id = $2`, [
    score,
    occurrenceId,
  ]);
}
