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
  isRecurring: boolean;
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
    isRecurring: Boolean(row.interval_days),
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
 * occurrence belongs to. `intervalDays` (e.g. 7 for "every Friday") makes
 * the rule structured, so future occurrences auto-generate as this one's
 * date passes -- see `ensureRecurringOccurrence` below.
 */
export async function scheduleAssessment(
  subjectId: string,
  scheduledDate: string,
  options: { topics?: string[]; occurrencePattern?: string; intervalDays?: number } = {}
): Promise<AssessmentOccurrence> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    let ruleId: string | null = null;
    if (options.occurrencePattern || options.intervalDays) {
      const ruleResult = await client.query(
        `
        INSERT INTO assessment_schedule_rules (subject_id, occurrence_pattern, next_scheduled_date, interval_days)
        VALUES ($1, $2, $3, $4)
        RETURNING id
        `,
        [subjectId, options.occurrencePattern || null, scheduledDate, options.intervalDays || null]
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
    return toOccurrence({ ...occResult.rows[0], interval_days: options.intervalDays || null });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Edit an existing occurrence -- its date, its topics, or both. This is
 * the "school moved the exam" / "this week also covers chapter 5" case:
 * only this one occurrence changes; the recurring rule and every other
 * occurrence stay exactly as they were. Status only flips to
 * 'rescheduled' when the date actually moves, so editing topics alone on
 * an untouched occurrence doesn't misreport it as moved.
 */
export async function updateOccurrence(
  occurrenceId: string,
  updates: { scheduledDate?: string; topics?: string[] }
): Promise<AssessmentOccurrence | null> {
  const current = await db.query(
    `SELECT scheduled_date FROM assessment_occurrences WHERE id = $1`,
    [occurrenceId]
  );
  if (!current.rows[0]) return null;

  const sets: string[] = [];
  const params: any[] = [];
  let i = 1;

  if (updates.scheduledDate && updates.scheduledDate !== current.rows[0].scheduled_date) {
    sets.push(`scheduled_date = $${i++}`);
    params.push(updates.scheduledDate);
    sets.push(`status = 'rescheduled'`);
  }
  if (updates.topics) {
    sets.push(`topics = $${i++}`);
    params.push(updates.topics);
  }
  if (sets.length === 0) {
    const row = await db.query(
      `SELECT id, rule_id, subject_id, scheduled_date, status, topics, exam_readiness FROM assessment_occurrences WHERE id = $1`,
      [occurrenceId]
    );
    return row.rows[0] ? toOccurrence(row.rows[0]) : null;
  }

  params.push(occurrenceId);
  const result = await db.query(
    `
    UPDATE assessment_occurrences
    SET ${sets.join(', ')}
    WHERE id = $${i}
    RETURNING id, rule_id, subject_id, scheduled_date, status, topics, exam_readiness
    `,
    params
  );
  const row = result.rows[0];
  if (!row) return null;

  let intervalDays = null;
  if (row.rule_id) {
    const ruleResult = await db.query(
      `SELECT interval_days FROM assessment_schedule_rules WHERE id = $1`,
      [row.rule_id]
    );
    intervalDays = ruleResult.rows[0]?.interval_days ?? null;
  }
  return toOccurrence({ ...row, interval_days: intervalDays });
}

export async function cancelAssessment(occurrenceId: string): Promise<void> {
  await db.query(`UPDATE assessment_occurrences SET status = 'cancelled' WHERE id = $1`, [
    occurrenceId,
  ]);
}

/**
 * If this subject has a recurring rule (interval_days set) whose most
 * recent occurrence has already passed, generate the next one -- rolled
 * forward in interval_days steps until it lands in the future -- and
 * update the rule's next_scheduled_date. A no-op for one-off or
 * non-recurring subjects. Never throws: called opportunistically before
 * reads, so a failure here should never break the read itself.
 *
 * The new occurrence starts with the same topics as the one it follows
 * -- this is the incremental-learning default the product asks for
 * ("last week's topics keep being covered unless someone edits them").
 * Editing that occurrence afterwards (updateOccurrence) only ever
 * touches this one instance, same as any other edit.
 */
async function ensureRecurringOccurrence(subjectId: string): Promise<void> {
  const client = await db.connect();
  try {
    const ruleResult = await client.query(
      `
      SELECT id, interval_days FROM assessment_schedule_rules
      WHERE subject_id = $1 AND interval_days IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [subjectId]
    );
    const rule = ruleResult.rows[0];
    if (!rule) return;

    const lastOccResult = await client.query(
      `
      SELECT scheduled_date, topics FROM assessment_occurrences
      WHERE rule_id = $1 AND status != 'cancelled'
      ORDER BY scheduled_date DESC
      LIMIT 1
      `,
      [rule.id]
    );
    const lastDate = lastOccResult.rows[0]?.scheduled_date;
    if (!lastDate) return;
    const lastTopics: string[] = lastOccResult.rows[0]?.topics || [];

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let cursor = new Date(lastDate + 'T00:00:00');
    let rolledForward = false;
    let guard = 0;
    while (cursor.getTime() < today.getTime() && guard < 104) {
      cursor = new Date(cursor.getTime() + rule.interval_days * 24 * 60 * 60 * 1000);
      rolledForward = true;
      guard++;
    }
    if (!rolledForward) return;

    const nextDateStr = cursor.toISOString().slice(0, 10);

    await client.query('BEGIN');
    await client.query(
      `
      INSERT INTO assessment_occurrences (rule_id, subject_id, scheduled_date, status, topics)
      VALUES ($1, $2, $3, 'expected', $4)
      ON CONFLICT DO NOTHING
      `,
      [rule.id, subjectId, nextDateStr, lastTopics]
    );
    await client.query(
      `UPDATE assessment_schedule_rules SET next_scheduled_date = $1 WHERE id = $2`,
      [nextDateStr, rule.id]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
  } finally {
    client.release();
  }
}

/** The next upcoming (not cancelled/completed) occurrence for a subject. */
export async function getNextOccurrence(subjectId: string): Promise<AssessmentOccurrence | null> {
  await ensureRecurringOccurrence(subjectId).catch(() => {});
  const result = await db.query(
    `
    SELECT ao.id, ao.rule_id, ao.subject_id, ao.scheduled_date, ao.status, ao.topics, ao.exam_readiness,
      r.interval_days
    FROM assessment_occurrences ao
    LEFT JOIN assessment_schedule_rules r ON r.id = ao.rule_id
    WHERE ao.subject_id = $1
      AND ao.status NOT IN ('cancelled', 'completed', 'result_recorded')
      AND ao.scheduled_date >= CURRENT_DATE
    ORDER BY ao.scheduled_date ASC
    LIMIT 1
    `,
    [subjectId]
  );
  return result.rows[0] ? toOccurrence(result.rows[0]) : null;
}

/** Next upcoming occurrence per subject, across all of a student's subjects. */
export async function getUpcomingForStudent(studentId: string): Promise<AssessmentOccurrence[]> {
  const recurringSubjects = await db.query(
    `
    SELECT DISTINCT r.subject_id
    FROM assessment_schedule_rules r
    JOIN subjects s ON s.id = r.subject_id
    WHERE s.student_id = $1 AND r.interval_days IS NOT NULL
    `,
    [studentId]
  );
  await Promise.all(
    recurringSubjects.rows.map((row) => ensureRecurringOccurrence(row.subject_id).catch(() => {}))
  );

  const result = await db.query(
    `
    SELECT DISTINCT ON (ao.subject_id)
      ao.id, ao.rule_id, ao.subject_id, ao.scheduled_date, ao.status, ao.topics, ao.exam_readiness,
      s.name AS subject_name, r.interval_days
    FROM assessment_occurrences ao
    JOIN subjects s ON s.id = ao.subject_id
    LEFT JOIN assessment_schedule_rules r ON r.id = ao.rule_id
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
