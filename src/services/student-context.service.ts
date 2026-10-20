/**
 * REM-T1-02 -- persists the Student's context type (students.student_context_type).
 * Only the Student's own row is touched: no role, profile, preparation, class
 * membership or history is created, changed or removed. Idempotent.
 */
import { db } from '@/lib/db';
import type { StudentContextType } from '@/lib/student/student-context';

export async function getStoredStudentContextType(studentId: string): Promise<string | null> {
  const r = await db.query(`SELECT student_context_type FROM students WHERE id = $1`, [studentId]);
  return r.rows[0]?.student_context_type ?? null;
}

export async function setStudentContextType(studentId: string, type: StudentContextType): Promise<void> {
  await db.query(
    `UPDATE students
        SET student_context_type = $2,
            student_context_selected_at = CASE WHEN student_context_type IS DISTINCT FROM $2 THEN now() ELSE student_context_selected_at END
      WHERE id = $1`,
    [studentId, type]
  );
}
