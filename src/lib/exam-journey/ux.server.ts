/**
 * Student Exam Journey -- server reads for the approved entry UX.
 *
 * Request-scoped (React `cache`): the dashboard layout (navigation prominence) and
 * the page share ONE resolution per request. Every function is read-only and only
 * called when STUDENT_JOURNEY_V2=UX.
 */
import { cache } from 'react';
import { db } from '@/lib/db';
import { resolveStudentExamJourneys } from './shadow.server';
import { loadInstitutionalAcademicContext } from './institutional-context.server';
import type { ExamTargetRow } from './exam-target';
import { examPrepIsPrimary } from './ux';

const todayIso = () => new Date().toISOString().slice(0, 10);

export const getStudentExamJourneys = cache(async (studentId: string) => resolveStudentExamJourneys(studentId, todayIso()));

export const getStudentInstitutionalContext = cache(async (studentId: string) => loadInstitutionalAcademicContext(studentId));

/** Navigation: "Exámenes" is primary only while a target is in active preparation. Fails closed (secondary). */
export async function examPrepNavPrimary(studentId: string): Promise<boolean> {
  try {
    const has = await db.query(`SELECT 1 FROM student_exam_profiles WHERE student_id = $1 AND status <> 'ARCHIVED' LIMIT 1`, [studentId]);
    if (!has.rows.length) return false;
    return examPrepIsPrimary(await getStudentExamJourneys(studentId));
  } catch {
    return false;
  }
}

/**
 * Whether this database has the J3.2 schedule columns (migration 20261101_1000). The migration
 * is not applied to hosted environments yet: without it, only the legacy exam date can be stored
 * and the personal-date / month options are not offered.
 */
export const scheduleColumnsAvailable = cache(async (): Promise<boolean> => {
  try {
    const r = await db.query(
      `SELECT count(*)::int AS n FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'student_exam_profiles' AND column_name IN ('personal_target_date', 'estimated_exam_month', 'field_provenance')`
    );
    return (r.rows[0]?.n ?? 0) === 3;
  } catch {
    return false;
  }
});

/** The stored target row as JSON (absent columns read as undefined on an un-migrated database). */
export async function loadExamTargetRow(profileId: string, studentId: string): Promise<ExamTargetRow | null> {
  const r = await db.query(`SELECT to_jsonb(p) AS row FROM student_exam_profiles p WHERE p.id = $1 AND p.student_id = $2`, [profileId, studentId]);
  return (r.rows[0]?.row as ExamTargetRow | undefined) ?? null;
}

/** Every non-archived target row of the Student as JSON (one query; absent columns read as undefined). */
export const loadExamTargetRows = cache(async (studentId: string): Promise<Map<string, ExamTargetRow>> => {
  const r = await db.query(`SELECT to_jsonb(p) AS row FROM student_exam_profiles p WHERE p.student_id = $1 AND p.status <> 'ARCHIVED'`, [studentId]);
  return new Map(r.rows.map((x: any) => [x.row.id as string, x.row as ExamTargetRow]));
});
