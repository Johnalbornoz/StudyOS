/**
 * J1.1 -- read-only loader for the institutional academic context. One SELECT for the
 * enrollments (with grade, class subject, institution curriculum and catalogue links)
 * plus the Student's own Academic Profile through the existing services. Writes nothing.
 */
import { db } from '@/lib/db';
import { getAcademicProfile } from '@/services/academic-profile.service';
import { getProfileCurriculum } from '@/services/academic-profile-catalogue.service';
import { normaliseGradeLevel } from '@/lib/exam-core/eligibility/grade-level';
import { resolveInstitutionalAcademicContext, type InstitutionalAcademicContext, type InstitutionalContextFacts, type InstitutionalEnrollmentFact } from './institutional-context';

export const INSTITUTIONAL_ENROLLMENTS_SQL = `
  SELECT ce.status AS enrollment_status,
         i.id AS institution_id, i.name AS institution_name, i.country AS institution_country,
         c.id AS class_id, c.name AS class_name, c.period AS class_period,
         g.id AS grade_id, g.name AS grade_name, g.academic_level, g.academic_year AS grade_academic_year,
         gp.id AS grade_programme_id, gp.name AS grade_programme_name,
         cs.id AS canonical_subject_id, cs.name AS canonical_subject_name,
         ic.id AS curriculum_id, ic.source_type AS curriculum_source_type, ic.academic_year AS curriculum_academic_year, ic.base_structure_version_id,
         cp.id AS curriculum_programme_id, cp.name AS curriculum_programme_name,
         s.id AS academic_subject_id, s.name AS academic_subject_name, s.level AS academic_subject_level,
         (cp.id IS NOT NULL AND c.canonical_subject_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM academic_subjects s2 WHERE s2.programme_id = cp.id AND s2.canonical_subject_id = c.canonical_subject_id AND s2.level IS NOT NULL)) AS level_options_exist
    FROM class_enrollments ce
    JOIN classes c ON c.id = ce.class_id AND c.status = 'ACTIVE'
    JOIN institutions i ON i.id = c.institution_id AND i.status = 'ACTIVE'
    LEFT JOIN grades g ON g.id = c.grade_id AND g.status = 'ACTIVE'
    LEFT JOIN academic_programmes gp ON gp.id = g.academic_programme_id
    LEFT JOIN canonical_subjects cs ON cs.id = c.canonical_subject_id
    LEFT JOIN institution_curricula ic ON ic.id = c.institution_curriculum_id AND ic.status = 'ACTIVE'
    LEFT JOIN academic_subjects s ON s.id = ic.base_academic_subject_id
    LEFT JOIN academic_programmes cp ON cp.id = COALESCE(ic.academic_programme_id, s.programme_id)
   WHERE ce.student_id = $1 AND ce.status IN ('ACTIVE', 'PENDING') AND ce.ended_at IS NULL`;

export function toEnrollmentFact(r: any): InstitutionalEnrollmentFact {
  return {
    enrollmentStatus: r.enrollment_status === 'PENDING' ? 'PENDING' : 'ACTIVE',
    institution: { id: r.institution_id, name: r.institution_name, country: r.institution_country ?? null },
    class: { id: r.class_id, name: r.class_name, period: r.class_period ?? null },
    grade: r.grade_id
      ? { id: r.grade_id, name: r.grade_name, academicLevel: r.academic_level ?? null, academicYear: r.grade_academic_year ?? null, programme: r.grade_programme_id ? { id: r.grade_programme_id, label: r.grade_programme_name } : null }
      : null,
    classSubject: r.canonical_subject_id ? { canonicalSubjectId: r.canonical_subject_id, label: r.canonical_subject_name } : null,
    curriculum: r.curriculum_id
      ? {
          id: r.curriculum_id,
          sourceType: r.curriculum_source_type ?? null,
          academicYear: r.curriculum_academic_year ?? null,
          structureVersionId: r.base_structure_version_id ?? null,
          programme: r.curriculum_programme_id ? { id: r.curriculum_programme_id, label: r.curriculum_programme_name } : null,
          academicSubject: r.academic_subject_id ? { id: r.academic_subject_id, label: r.academic_subject_name, level: r.academic_subject_level ?? null } : null,
          levelOptionsExist: !!r.level_options_exist,
        }
      : null,
  };
}

/** The Student's own declaration (Academic Profile), as the STUDENT layer. */
export function studentDeclaredContext(
  profile: Awaited<ReturnType<typeof getAcademicProfile>>,
  curriculum: Awaited<ReturnType<typeof getProfileCurriculum>>
): InstitutionalContextFacts['student'] {
  if (!profile) return null;
  return {
    programme: curriculum?.programmeId ? { id: curriculum.programmeId, label: curriculum.programme ?? '' } : null,
    gradeLevel: curriculum?.gradeLevel ?? normaliseGradeLevel(profile),
    academicYear: profile.academicYear ?? null,
  };
}

export async function loadInstitutionalContextFacts(studentId: string): Promise<InstitutionalContextFacts> {
  const [rows, profile, curriculum] = await Promise.all([
    db.query(INSTITUTIONAL_ENROLLMENTS_SQL, [studentId]),
    getAcademicProfile(studentId).catch(() => null),
    getProfileCurriculum(studentId).catch(() => null),
  ]);
  return {
    enrollments: rows.rows.map(toEnrollmentFact),
    student: studentDeclaredContext(profile, curriculum),
  };
}

export async function loadInstitutionalAcademicContext(studentId: string): Promise<InstitutionalAcademicContext> {
  return resolveInstitutionalAcademicContext(await loadInstitutionalContextFacts(studentId));
}
