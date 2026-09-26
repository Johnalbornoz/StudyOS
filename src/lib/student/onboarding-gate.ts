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

export function studentOnboardingStage(profile: AcademicProfileFields | null, subjectCount: number): StudentOnboardingStage {
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

  const stage = studentOnboardingStage(state.profile, state.subjectCount);
  if (stage === 'READY') return null;

  if (stage === 'ACADEMIC_PROFILE') {
    return underPrefix(pathname, ACADEMIC_PROFILE_PATH) ? null : ACADEMIC_PROFILE_PATH;
  }
  // FIRST_SUBJECT: the profile may still be reviewed; the subject-creation flow stays reachable.
  const allowed = [ACADEMIC_PROFILE_PATH, FIRST_SUBJECT_PATH, NEW_SUBJECT_PATH];
  return allowed.some((p) => underPrefix(pathname, p)) ? null : FIRST_SUBJECT_PATH;
}
