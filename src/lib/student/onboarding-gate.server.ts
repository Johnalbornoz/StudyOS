/**
 * Loads the Student onboarding gate state for a Clerk user with ONE
 * read-only query. Never creates anything (no users/students rows) --
 * accounts that do not exist yet simply are not gated here.
 */
import { db } from '@/lib/db';
import type { Role, Workspace } from '@/lib/identity/types';
import { decideStudentOnboardingGate, VALID_EXAM_TARGET_PREDICATE, type GateState } from './onboarding-gate';
import { isStudentJourneyUxEnabled } from '@/lib/exam-journey/feature-flag';

/** Active enrollments in active classes (of active institutions) that carry a subject. */
export const INSTITUTIONAL_PATH_COUNT_SQL = `COALESCE((SELECT count(*) FROM class_enrollments ce
           JOIN classes c ON c.id = ce.class_id AND c.status = 'ACTIVE' AND c.canonical_subject_id IS NOT NULL
           JOIN institutions i ON i.id = c.institution_id AND i.status = 'ACTIVE'
          WHERE ce.student_id = s.id AND ce.status = 'ACTIVE' AND ce.ended_at IS NULL), 0)::int`;

const GATE_STATE_SQL = `
  SELECT u.status,
         u.active_workspace,
         ARRAY(SELECT ur.role FROM user_roles ur WHERE ur.user_id = u.id AND ur.status = 'ACTIVE') AS roles,
         p.profile_completed, p.country_of_study, p.school_year, p.curriculum_type,
         p.ib_programme, p.ib_year, p.academic_year,
         COALESCE((SELECT count(*) FROM subjects sub WHERE sub.student_id = s.id), 0)::int AS subject_count,
         COALESCE((SELECT count(*) FROM student_exam_profiles ep WHERE ep.student_id = s.id AND ep.${VALID_EXAM_TARGET_PREDICATE}), 0)::int AS exam_target_count,
         ${INSTITUTIONAL_PATH_COUNT_SQL} AS institutional_path_count
  FROM users u
  LEFT JOIN students s ON s.clerk_id = u.clerk_id
  LEFT JOIN student_academic_profile p ON p.student_id = s.id
  WHERE u.clerk_id = $1 AND NOT u.is_system
  LIMIT 1`;

export async function loadGateState(clerkUserId: string): Promise<GateState | null> {
  const result = await db.query(GATE_STATE_SQL, [clerkUserId]);
  const row = result.rows[0];
  if (!row) return null;
  const hasProfile = row.profile_completed !== null && row.profile_completed !== undefined;
  return {
    accountStatus: row.status,
    roles: (row.roles ?? []) as Role[],
    storedWorkspace: (row.active_workspace ?? null) as Workspace | null,
    profile: hasProfile
      ? {
          profileCompleted: row.profile_completed,
          countryOfStudy: row.country_of_study,
          schoolYear: row.school_year,
          curriculumType: row.curriculum_type,
          ibProgramme: row.ib_programme,
          ibYear: row.ib_year,
          academicYear: row.academic_year,
        }
      : null,
    subjectCount: row.subject_count ?? 0,
    examTargetCount: row.exam_target_count ?? 0,
    institutionalPathCount: row.institutional_path_count ?? 0,
    journeyUx: isStudentJourneyUxEnabled(),
  };
}

/** Redirect target for this Student request, or null. */
export async function evaluateStudentOnboardingGate(clerkUserId: string, pathname: string): Promise<string | null> {
  return decideStudentOnboardingGate(pathname, await loadGateState(clerkUserId));
}
