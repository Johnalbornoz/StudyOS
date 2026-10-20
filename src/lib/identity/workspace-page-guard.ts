/**
 * L10 SF-5 (P2-1, CR-02) -- page-level WORKSPACE authorization.
 *
 * The proxy and the dashboard layout authenticated a request but did not
 * authorize it by workspace: a Student could render `/dashboard/teacher`
 * (an empty teacher shell), and a Parent opening a Student page hit an
 * error boundary because the page tried to resolve a learner the account
 * does not have. No data crossed a boundary (every read model re-checks its
 * own relationship), but the wrong workspace rendered.
 *
 * This is the pure decision the proxy applies BEFORE anything renders:
 * a page that belongs to a workspace the account does not hold redirects to
 * the account's own workspace home. It reads only what the account holds;
 * it grants nothing, and every page and read model keeps its own guard.
 *
 * Deliberately outside this guard:
 *  - `/dashboard` (it resolves its own entry) and `/dashboard/notifications`
 *    (one inbox shared by every workspace);
 *  - `/dashboard/admin/**`: each admin page re-checks `requireStudyUSAdmin`
 *    itself, and the allowlisted administrator's role is bootstrapped by the
 *    layout on first entry -- redirecting here would run before that grant.
 */
import { WORKSPACE_PRIORITY, personaWorkspaceOf, workspaceForRole, type Role, type Workspace } from './types';

export const ACCOUNT_SUSPENDED_PATH = '/account-suspended';
export const ROLE_SELECT_PATH = '/role-select';

/** Mirrors WORKSPACE_HOME in ./workspace-entry (kept literal here: this module must stay free of server imports so the proxy can load it). */
const WORKSPACE_HOME_PATH: Record<Workspace, string> = {
  STUDENT: '/dashboard/today',
  PARENT: '/dashboard/parent',
  TEACHER: '/dashboard/teacher',
  INSTITUTION: '/dashboard/institution',
  ADMIN: '/dashboard/admin',
};

const WORKSPACE_PREFIXES: ReadonlyArray<[string, Workspace]> = [
  ['/dashboard/parent', 'PARENT'],
  ['/dashboard/teacher', 'TEACHER'],
  ['/dashboard/institution', 'INSTITUTION'],
];

const UNGUARDED_PREFIXES = ['/dashboard/admin', '/dashboard/notifications'];

function underPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** The workspace a dashboard page belongs to, or null when the page is not workspace-bound. */
export function workspaceRequiredForPath(pathname: string): Workspace | null {
  if (!underPrefix(pathname, '/dashboard') || pathname === '/dashboard') return null;
  if (UNGUARDED_PREFIXES.some((p) => underPrefix(pathname, p))) return null;
  for (const [prefix, workspace] of WORKSPACE_PREFIXES) if (underPrefix(pathname, prefix)) return workspace;
  return 'STUDENT';
}

export interface WorkspaceGuardState {
  accountStatus: string;
  /** ACTIVE roles only. */
  roles: readonly Role[];
  storedWorkspace: Workspace | null;
}

/**
 * Redirect target for this page request, or null to let it through.
 *
 *  - No account row yet: null (nothing to decide; nothing is provisioned here).
 *  - No active role, on a workspace page: role selection.
 *  - Account not ACTIVE: the suspended page, for every dashboard page.
 *  - Page of a workspace the account does not hold: the account's own home.
 */
export function decideWorkspacePageGuard(pathname: string, state: WorkspaceGuardState | null): string | null {
  if (!state) return null;
  if (!underPrefix(pathname, '/dashboard')) return null;
  if (state.accountStatus !== 'ACTIVE') return ACCOUNT_SUSPENDED_PATH;

  const required = workspaceRequiredForPath(pathname);
  if (!required) return null;

  const held = new Set(state.roles.map(workspaceForRole));
  const available = WORKSPACE_PRIORITY.filter((w) => held.has(w));
  // L10-R1: an account with NO active role (never chose one, or every role it held was revoked) is
  // sent to role selection before a workspace page renders. The layout does the same, but a page
  // renders in parallel with its layout: a Student page would already have tried to resolve a
  // learner and failed. Role selection explains a revoked role.
  if (available.length === 0) return ROLE_SELECT_PATH;
  if (available.includes(required)) return null;

  const own = personaWorkspaceOf(available, state.storedWorkspace) ?? (state.storedWorkspace && available.includes(state.storedWorkspace) ? state.storedWorkspace : null) ?? available[0];
  const target = WORKSPACE_HOME_PATH[own];
  return target === pathname ? null : target;
}
