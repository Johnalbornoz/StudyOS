import { db } from '@/lib/db';

// Single super-admin, tied directly to the account that owns this
// deployment -- not a role stored in the DB, since there's exactly one
// person this should ever apply to.
const ADMIN_EMAILS = ['john@jalbornoz.com'];

export function isAdminEmail(email: string | null | undefined): boolean {
  return !!email && ADMIN_EMAILS.includes(email.toLowerCase());
}

export interface StudentSummary {
  id: string;
  name: string | null;
  email: string;
  createdAt: string;
  subjectCount: number;
  conceptCount: number;
  subscriptionStatus: 'unpaid' | 'active' | 'past_due' | 'canceled';
}

export async function getAllStudents(): Promise<StudentSummary[]> {
  const result = await db.query(`
    SELECT
      s.id, s.name, s.email, s.created_at,
      (SELECT COUNT(*) FROM subjects sub WHERE sub.student_id = s.id AND sub.status = 'active') AS subject_count,
      (SELECT COUNT(*) FROM concepts c JOIN subjects sub2 ON c.subject_id = sub2.id WHERE sub2.student_id = s.id) AS concept_count,
      COALESCE(sc.status, 'unpaid') AS subscription_status
    FROM students s
    LEFT JOIN subscriptions sc ON sc.student_id = s.id
    ORDER BY s.created_at DESC
  `);
  return result.rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    createdAt: r.created_at,
    subjectCount: Number(r.subject_count),
    conceptCount: Number(r.concept_count),
    subscriptionStatus: r.subscription_status,
  }));
}

export async function getStudentById(studentId: string): Promise<{ id: string; name: string | null; email: string; createdAt: string } | null> {
  const result = await db.query(`SELECT id, name, email, created_at FROM students WHERE id = $1`, [studentId]);
  const row = result.rows[0];
  if (!row) return null;
  return { id: row.id, name: row.name, email: row.email, createdAt: row.created_at };
}

/**
 * Unconditionally deletes a subject and every row anywhere in the
 * schema that references it or its concepts -- unlike the student-
 * facing delete (src/app/api/subjects/[id]/route.ts), this does NOT
 * block on existing practice history. Admin-only, irreversible.
 *
 * Order matters: children before parents, all inside one transaction
 * so a missed dependency rolls back cleanly instead of leaving a
 * partially-deleted subject.
 */
export async function adminForceDeleteSubject(subjectId: string): Promise<void> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    await client.query(`DELETE FROM mastery_events WHERE mastery_id IN (SELECT id FROM mastery_records WHERE subject_id = $1)`, [subjectId]);
    await client.query(`DELETE FROM concept_explanations WHERE concept_id IN (SELECT id FROM concepts WHERE subject_id = $1)`, [subjectId]);
    await client.query(`DELETE FROM concept_localizations WHERE concept_id IN (SELECT id FROM concepts WHERE subject_id = $1)`, [subjectId]);
    await client.query(`DELETE FROM learning_evidence WHERE concept_id IN (SELECT id FROM concepts WHERE subject_id = $1)`, [subjectId]);
    await client.query(`DELETE FROM study_session_items WHERE concept_id IN (SELECT id FROM concepts WHERE subject_id = $1)`, [subjectId]);

    await client.query(`DELETE FROM errors WHERE subject_id = $1`, [subjectId]);
    await client.query(`DELETE FROM learning_debt WHERE subject_id = $1`, [subjectId]);
    await client.query(`DELETE FROM mastery_records WHERE subject_id = $1`, [subjectId]);
    await client.query(`DELETE FROM quiz_sessions WHERE subject_id = $1`, [subjectId]);

    await client.query(`DELETE FROM content_chunks WHERE source_id IN (SELECT id FROM content_sources WHERE subject_id = $1)`, [subjectId]);
    await client.query(`DELETE FROM content_sources WHERE subject_id = $1`, [subjectId]);

    await client.query(`DELETE FROM assessment_results WHERE occurrence_id IN (SELECT id FROM assessment_occurrences WHERE subject_id = $1)`, [subjectId]);
    await client.query(`DELETE FROM assessment_occurrences WHERE subject_id = $1`, [subjectId]);
    await client.query(`DELETE FROM assessment_schedule_rules WHERE subject_id = $1`, [subjectId]);

    await client.query(`DELETE FROM tutor_conversations WHERE subject_id = $1`, [subjectId]);

    await client.query(`DELETE FROM concepts WHERE subject_id = $1`, [subjectId]);

    await client.query(`DELETE FROM subtopics WHERE topic_id IN (SELECT id FROM topics WHERE subject_id = $1)`, [subjectId]);
    await client.query(`DELETE FROM topics WHERE subject_id = $1`, [subjectId]);

    await client.query(`DELETE FROM subjects WHERE id = $1`, [subjectId]);

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Unconditionally deletes a single concept, regardless of practice
 * history. Admin-only, irreversible.
 */
export async function adminForceDeleteConcept(conceptId: string): Promise<void> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    await client.query(`DELETE FROM mastery_events WHERE mastery_id IN (SELECT id FROM mastery_records WHERE concept_id = $1)`, [conceptId]);
    await client.query(`DELETE FROM concept_explanations WHERE concept_id = $1`, [conceptId]);
    await client.query(`DELETE FROM concept_localizations WHERE concept_id = $1`, [conceptId]);
    await client.query(`DELETE FROM learning_evidence WHERE concept_id = $1`, [conceptId]);
    await client.query(`DELETE FROM study_session_items WHERE concept_id = $1`, [conceptId]);
    await client.query(`DELETE FROM errors WHERE concept_id = $1`, [conceptId]);
    await client.query(`DELETE FROM learning_debt WHERE concept_id = $1`, [conceptId]);
    await client.query(`DELETE FROM mastery_records WHERE concept_id = $1`, [conceptId]);
    await client.query(`DELETE FROM quiz_sessions WHERE concept_id = $1`, [conceptId]);

    await client.query(`DELETE FROM concepts WHERE id = $1`, [conceptId]);

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
