/**
 * CANON-R5 Part 12 -- session start's client request carries only
 * `{studentId, actionConceptId}`, no subjectId (unlike the legacy Phase
 * 3C `LearningDecision`, which already carries its own subjectId). The
 * canonical decision path needs a caller-verified subjectId of its own
 * (for the launch URL and for `learning-session-engine.service.ts`'s own
 * `verifyConceptOwnership`-style discipline) -- this is that one,
 * read-only ownership resolution: does `conceptId` genuinely belong to
 * `studentId`, and if so, via which subject.
 */
import { db, type DbExecutor } from '@/lib/db';

export async function resolveConceptSubjectForStudent(
  conceptId: string,
  studentId: string,
  client: DbExecutor = db,
): Promise<{ subjectId: string } | null> {
  const result = await client.query(
    `SELECT s.id AS subject_id
     FROM concepts c
     JOIN subjects s ON s.id = c.subject_id
     WHERE c.id = $1 AND s.student_id = $2`,
    [conceptId, studentId],
  );
  const row = result.rows[0];
  return row ? { subjectId: row.subject_id } : null;
}
