/**
 * REM-T1-04 -- loads the Student's personal context (student-context.ts) with
 * read-only queries. Degrades to "no profile subjects" on failure; it never
 * creates or rewrites anything.
 */
import { db } from '@/lib/db';
import { VALID_EXAM_TARGET_PREDICATE } from './onboarding-gate';
import { effectiveContextType, knownSubjectLevels, resolveProfileSubjects, type ResolvedStudentContext } from './student-context';

const CONTEXT_SQL = `
  SELECT s.student_context_type,
         p.profile_completed, p.curriculum_type, p.ib_programme, p.ib_year, p.school_year, p.country_of_study,
         ap.id AS programme_id, ap.name AS programme, o.name AS authority, q.name AS qualification,
         COALESCE((SELECT count(*) FROM student_exam_profiles ep WHERE ep.student_id = s.id AND ep.${VALID_EXAM_TARGET_PREDICATE}), 0)::int AS exam_target_count
    FROM students s
    LEFT JOIN student_academic_profile p ON p.student_id = s.id
    LEFT JOIN academic_programmes ap ON ap.id = p.academic_programme_id
    LEFT JOIN academic_organizations o ON o.id = ap.organization_id
    LEFT JOIN academic_qualifications q ON q.id = p.academic_qualification_id
   WHERE s.id = $1`;

const SUBJECTS_SQL = `
  SELECT a.id, a.name, a.level, cs.name AS canonical_name
    FROM student_academic_subjects sas
    JOIN academic_subjects a ON a.id = sas.academic_subject_id
    LEFT JOIN canonical_subjects cs ON cs.id = a.canonical_subject_id
   WHERE sas.student_id = $1 AND sas.ended_at IS NULL
   ORDER BY a.name, a.level NULLS FIRST`;

export async function loadResolvedStudentContext(studentId: string): Promise<ResolvedStudentContext> {
  const [ctx, subjects] = await Promise.all([
    db.query(CONTEXT_SQL, [studentId]).then((r) => r.rows[0] ?? null).catch(() => null),
    db.query(SUBJECTS_SQL, [studentId]).then((r) => r.rows).catch(() => [] as any[]),
  ]);
  const profileSubjects = resolveProfileSubjects(
    subjects.map((r: any) => ({ academicSubjectId: r.id, name: r.name, level: r.level, canonicalName: r.canonical_name }))
  );
  return {
    contextType: effectiveContextType({ stored: ctx?.student_context_type, profileCompleted: ctx?.profile_completed === true, examTargetCount: ctx?.exam_target_count ?? 0 }),
    profileCompleted: ctx?.profile_completed === true,
    programme: ctx?.programme_id ? { id: ctx.programme_id, name: ctx.programme, authority: ctx.authority ?? null } : null,
    qualification: ctx?.qualification ?? null,
    profileSubjects,
    knownLevels: knownSubjectLevels(profileSubjects),
    legacy: {
      curriculumType: ctx?.curriculum_type ?? null,
      ibProgramme: ctx?.ib_programme ?? null,
      ibYear: ctx?.ib_year ?? null,
      schoolYear: ctx?.school_year ?? null,
      countryOfStudy: ctx?.country_of_study ?? null,
    },
  };
}
