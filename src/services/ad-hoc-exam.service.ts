/**
 * A Student's own partial exam -- the scope check, against the database.
 *
 * Every concept of the exam must be one of THIS Student's concepts in THIS Subject. A concept of another
 * Subject, of another Student, or one that does not exist is refused: the selection is never repaired,
 * narrowed or widened here. Used by the exam setup and by scheduling.
 */
import { db } from '@/lib/db';
import { normalizeSelection, isUuid, type AdHocSelectionIssue } from '@/lib/ad-hoc-exam/selection';

export type AdHocScopeRefusal = AdHocSelectionIssue | 'SUBJECT_NOT_FOUND' | 'CONCEPT_OUTSIDE_SUBJECT';
export type AdHocScopeResult = { ok: true; subjectId: string; subjectName: string; conceptIds: string[] } | { ok: false; reason: AdHocScopeRefusal };

export async function resolveAdHocExamScope(studentId: string, subjectId: unknown, conceptIds: readonly unknown[]): Promise<AdHocScopeResult> {
  if (!isUuid(subjectId)) return { ok: false, reason: 'SUBJECT_NOT_FOUND' };
  const selection = normalizeSelection(conceptIds);
  if (!selection.ok) return { ok: false, reason: selection.issue };

  // the Subject is the Student's own (a Subject of someone else is "not found", never "forbidden")
  const subject = await db.query(`SELECT id, name FROM subjects WHERE id = $1 AND student_id = $2`, [subjectId, studentId]);
  if (subject.rows.length === 0) return { ok: false, reason: 'SUBJECT_NOT_FOUND' };

  // every selected concept belongs to that Subject; one that does not refuses the whole selection
  const owned = await db.query(`SELECT c.id FROM concepts c WHERE c.subject_id = $1 AND c.id = ANY($2::uuid[])`, [subjectId, selection.conceptIds]);
  const found = new Set((owned.rows as Array<{ id: string }>).map((r) => r.id));
  if (selection.conceptIds.some((id) => !found.has(id))) return { ok: false, reason: 'CONCEPT_OUTSIDE_SUBJECT' };

  return { ok: true, subjectId, subjectName: subject.rows[0].name, conceptIds: selection.conceptIds };
}
