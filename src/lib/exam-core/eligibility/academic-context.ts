/**
 * Exam eligibility -- the Student's ACTIVE academic context, from what is stored.
 *
 * This adapter is the single place eligibility reads academic context from:
 *
 *   CLASS    class_enrollments (ACTIVE) -> classes.institution_curriculum_id (explicit
 *            binding only) -> institution_curricula -> catalogue programme + subject.
 *            Authoritative for the class's learning.
 *   PROFILE  student_academic_profile: country, school year (normalised grade) and the
 *            curriculum the Student declared. The legacy profile has no catalogue link,
 *            so only declarations that resolve to exactly one framework are used today
 *            (IB + DP, or IB at the DP stage -> the programmes that host IB DP exams). When the Academic Profile
 *            stores catalogue programme / subject ids, they are read HERE and nothing
 *            else changes.
 *
 * Both sources are kept side by side (never merged): a Student may follow IB at
 * school and Cambridge privately; each programme gives its own reason.
 * Class-level exam assignments (class_exam_assignments) are read for ACTIVE
 * enrollments in ACTIVE classes of ACTIVE institutions only.
 */
import { db } from '@/lib/db';
import { getAcademicProfile } from '@/services/academic-profile.service';
import { normaliseGradeLevel } from './grade-level';
import { programmesForFramework, type ContextProgramme, type EligibilityGraph, type StudentAcademicContext, type ClassExamAssignment } from './rules';

interface ClassProgrammeRow {
  class_id: string;
  class_name: string;
  programme_id: string | null;
  programme_name: string | null;
  academic_subject_id: string | null;
  subject_name: string | null;
  organization_country: string | null;
}

const ACTIVE_CLASSES_SQL = `
  SELECT c.id AS class_id, c.name AS class_name, c.institution_id, i.name AS institution_name, c.institution_curriculum_id
    FROM class_enrollments ce
    JOIN classes c ON c.id = ce.class_id AND c.status = 'ACTIVE'
    JOIN institutions i ON i.id = c.institution_id AND i.status = 'ACTIVE'
   WHERE ce.student_id = $1 AND ce.status = 'ACTIVE'`;

export async function loadClassProgrammes(studentId: string): Promise<ClassProgrammeRow[]> {
  const r = await db.query(
    `SELECT ac.class_id, ac.class_name, p.id AS programme_id, p.name AS programme_name,
            s.id AS academic_subject_id, s.name AS subject_name, o.country AS organization_country
       FROM (${ACTIVE_CLASSES_SQL}) ac
       JOIN institution_curricula ic ON ic.id = ac.institution_curriculum_id AND ic.status = 'ACTIVE'
       LEFT JOIN academic_subjects s ON s.id = ic.base_academic_subject_id
       LEFT JOIN academic_programmes p ON p.id = COALESCE(ic.academic_programme_id, s.programme_id)
       LEFT JOIN academic_organizations o ON o.id = p.organization_id`,
    [studentId]
  );
  return r.rows as ClassProgrammeRow[];
}

export async function loadClassExamAssignmentsForStudent(studentId: string): Promise<ClassExamAssignment[]> {
  const r = await db.query(
    `SELECT a.objective_key, ac.class_id, ac.class_name, ac.institution_name
       FROM (${ACTIVE_CLASSES_SQL}) ac
       JOIN class_exam_assignments a ON a.class_id = ac.class_id AND a.status = 'ACTIVE'
      ORDER BY a.created_at`,
    [studentId]
  );
  return r.rows.map((row: any) => ({ objectiveKey: row.objective_key, classId: row.class_id, className: row.class_name, institutionName: row.institution_name }));
}

/** Pure: assembles the context (exported for tests). */
export function buildAcademicContext(input: {
  profile: { countryOfStudy?: string | null; schoolYear?: string | null; curriculumType?: string | null; ibProgramme?: string | null; ibYear?: string | null; profileCompleted?: boolean } | null;
  classRows: ClassProgrammeRow[];
  assignments: ClassExamAssignment[];
  graph: EligibilityGraph;
}): StudentAcademicContext {
  const { profile, classRows, assignments, graph } = input;
  const programmes: ContextProgramme[] = [];

  for (const row of classRows) {
    if (!row.programme_id) continue;
    programmes.push({
      programmeId: row.programme_id,
      programmeName: row.programme_name ?? '',
      academicSubjectIds: row.academic_subject_id ? [row.academic_subject_id] : [],
      subjectNames: row.subject_name ? [row.subject_name] : [],
      source: 'CLASS',
      classId: row.class_id,
      className: row.class_name,
    });
  }

  // Legacy declaration with a single, unambiguous catalogue meaning: IB Diploma Programme
  // (declared DP, or IB without a programme at the DP stage -- grades 11-12).
  const gradeLevel = normaliseGradeLevel(profile);
  const ibDiploma = profile?.curriculumType === 'ib' && (profile.ibProgramme === 'DP' || (!profile.ibProgramme && gradeLevel !== null && gradeLevel >= 11));
  if (ibDiploma) {
    for (const gp of programmesForFramework(graph, 'IB_DP')) {
      if (programmes.some((p) => p.programmeId === gp.programmeId && p.source === 'PROFILE')) continue;
      programmes.push({ programmeId: gp.programmeId, programmeName: gp.programmeName, academicSubjectIds: [], subjectNames: [], source: 'PROFILE' });
    }
  }

  // Country: the Student's own profile first; else the national authority of a class curriculum (only when unambiguous).
  const classCountries = [...new Set(classRows.map((r) => r.organization_country).filter((c): c is string => !!c))];
  const country = profile?.countryOfStudy && profile.countryOfStudy !== 'OTHER' ? profile.countryOfStudy : classCountries.length === 1 ? classCountries[0] : null;

  return {
    country,
    gradeLevel,
    programmes,
    assignments,
    profileCompleted: !!profile?.profileCompleted,
  };
}

export async function loadStudentAcademicContext(studentId: string, graph: EligibilityGraph): Promise<StudentAcademicContext> {
  const [profile, classRows, assignments] = await Promise.all([
    getAcademicProfile(studentId).catch(() => null),
    loadClassProgrammes(studentId),
    loadClassExamAssignmentsForStudent(studentId),
  ]);
  return buildAcademicContext({ profile, classRows, assignments, graph });
}
