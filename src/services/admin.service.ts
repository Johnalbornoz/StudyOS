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
}

export async function getAllStudents(): Promise<StudentSummary[]> {
  const result = await db.query(`
    SELECT
      s.id, s.name, s.email, s.created_at,
      (SELECT COUNT(*) FROM subjects sub WHERE sub.student_id = s.id AND sub.status = 'active') AS subject_count,
      (SELECT COUNT(*) FROM concepts c JOIN subjects sub2 ON c.subject_id = sub2.id WHERE sub2.student_id = s.id) AS concept_count
    FROM students s
    ORDER BY s.created_at DESC
  `);
  return result.rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    createdAt: r.created_at,
    subjectCount: Number(r.subject_count),
    conceptCount: Number(r.concept_count),
  }));
}

export async function getStudentById(studentId: string): Promise<{ id: string; name: string | null; email: string; createdAt: string } | null> {
  const result = await db.query(`SELECT id, name, email, created_at FROM students WHERE id = $1`, [studentId]);
  const row = result.rows[0];
  if (!row) return null;
  return { id: row.id, name: row.name, email: row.email, createdAt: row.created_at };
}
