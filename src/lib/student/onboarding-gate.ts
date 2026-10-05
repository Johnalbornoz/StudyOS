/**
 * STUDENT ONBOARDING GATE -- pure decision (no DB, no Clerk).
 *
 * A Student may use the Student workspace only after:
 *   1. a COMPLETE academic profile (country, grade, curriculum, IB
 *      programme/year when the curriculum is IB, academic year, and the
 *      wizard's own completion flag) -- decided here, server-side, never
 *      inferred from merely having a `students` row;
 *   2. at least one subject (created by the student -- never automatically).
 *
 * Student Exam Journey V2 -- J0 (G-01): a VALID EXAM TARGET (a non-archived
 * `student_exam_profiles` row) is a first academic object on its own. A
 * Student who has one is READY without any subject and without a complete
 * school profile (the Independent Exam Student, e.g. PAA or a Saber 11
 * retake). While the first-subject step is pending, Exam Preparation stays
 * reachable so the Student can choose "Quiero prepararme para un examen"
 * and create that target. No subject is ever created to satisfy the gate.
 *
 * Until then every Student route redirects to the current onboarding step.
 * The gate only applies when the request's effective workspace is STUDENT
 * (same resolution as the dashboard shell), so admin/parent/teacher/
 * institution workspaces and multi-role accounts in another context are
 * unaffected. Enforced in `src/proxy.ts`, i.e. BEFORE any page renders --
 * a layout redirect cannot stop a page's parallel side effects.
 */
import { resolveShellContext } from '@/lib/admin/shell-context';
import { WORKSPACE_PRIORITY, workspaceForRole, type Role, type Workspace } from '@/lib/identity/types';

export const ACADEMIC_PROFILE_PATH = '/dashboard/profile';
export const FIRST_SUBJECT_PATH = '/dashboard/onboarding';
export const NEW_SUBJECT_PATH = '/dashboard/subjects/new';
/** The exam-preparation intent of the onboarding ("Quiero prepararme para un examen"). */
export const EXAM_PREPARATION_PATH = '/dashboard/exam-prep';

/**
 * SQL predicate (over `student_exam_profiles`) of a VALID EXAM TARGET. The ONE
 * definition shared by the gate, the first destination and the onboarding
 * bounce, so they can never disagree about whether a target exists.
 */
export const VALID_EXAM_TARGET_PREDICATE = `status <> 'ARCHIVED'`;

/** /dashboard subtrees that belong to other workspaces and authorize themselves. */
const NON_STUDENT_PREFIXES = ['/dashboard/admin', '/dashboard/parent', '/dashboard/teacher', '/dashboard/institution'];

function underPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** Student pages the gate protects (API routes are never gated). */
export function isStudentGatedPath(pathname: string): boolean {
  if (!underPrefix(pathname, '/dashboard')) return false;
  return !NON_STUDENT_PREFIXES.some((p) => underPrefix(pathname, p));
}

export interface AcademicProfileFields {
  profileCompleted: boolean;
  countryOfStudy: string | null;
  schoolYear: string | null;
  curriculumType: string | null;
  ibProgramme: string | null;
  ibYear: string | null;
  academicYear: string | null;
}

const filled = (v: string | null | undefined) => typeof v === 'string' && v.trim().length > 0;

export function isAcademicProfileComplete(p: AcademicProfileFields | null): boolean {
  if (!p || !p.profileCompleted) return false;
  if (!filled(p.countryOfStudy) || !filled(p.schoolYear) || !filled(p.curriculumType) || !filled(p.academicYear)) return false;
  if (p.curriculumType === 'ib' && (!filled(p.ibProgramme) || !filled(p.ibYear))) return false;
  return true;
}

export type StudentOnboardingStage = 'ACADEMIC_PROFILE' | 'FIRST_SUBJECT' | 'READY';

export function studentOnboardingStage(profile: AcademicProfileFields | null, subjectCount: number, examTargetCount = 0): StudentOnboardingStage {
  // J0: a valid exam target is enough on its own -- no subject, no school profile required.
  if (examTargetCount > 0) return 'READY';
  if (!isAcademicProfileComplete(profile)) return 'ACADEMIC_PROFILE';
  if (subjectCount < 1) return 'FIRST_SUBJECT';
  return 'READY';
}

export interface GateState {
  accountStatus: string;
  roles: Role[];
  storedWorkspace: Workspace | null;
  profile: AcademicProfileFields | null;
  subjectCount: number;
  /** Valid exam targets (`VALID_EXAM_TARGET_PREDICATE`). Absent = 0 (callers predating J0). */
  examTargetCount?: number;
}

/** Redirect target for this request, or null to let it through. */
export function decideStudentOnboardingGate(pathname: string, state: GateState | null): string | null {
  if (!state || state.accountStatus !== 'ACTIVE') return null; // no account yet / suspended: handled elsewhere
  if (!isStudentGatedPath(pathname)) return null;

  const held = new Set(state.roles.map(workspaceForRole));
  const available = WORKSPACE_PRIORITY.filter((w) => held.has(w));
  if (available.length === 0) return null; // role selection is handled by the dashboard layout

  const { workspace } = resolveShellContext({
    pathname,
    available,
    stored: state.storedWorkspace,
    defaultWorkspace: available[0] ?? null,
  });
  if (workspace !== 'STUDENT') return null;

  const stage = studentOnboardingStage(state.profile, state.subjectCount, state.examTargetCount ?? 0);
  if (stage === 'READY') return null;

  if (stage === 'ACADEMIC_PROFILE') {
    return underPrefix(pathname, ACADEMIC_PROFILE_PATH) ? null : ACADEMIC_PROFILE_PATH;
  }
  // FIRST_SUBJECT: the profile may still be reviewed; the subject-creation flow stays reachable,
  // and so does the exam-preparation intent (J0): choosing an exam target needs no subject.
  const allowed = [ACADEMIC_PROFILE_PATH, FIRST_SUBJECT_PATH, NEW_SUBJECT_PATH, EXAM_PREPARATION_PATH];
  return allowed.some((p) => underPrefix(pathname, p)) ? null : FIRST_SUBJECT_PATH;
}
