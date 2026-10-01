/**
 * A01-UX-02 / A01-LOGIC-01 -- which workspace the dashboard shell
 * presents for a given request. Pure: the layout supplies the request
 * path (forwarded by middleware as `x-studyos-pathname`) and the
 * actor's F1 workspaces; nothing here authorizes anything -- every
 * admin page still re-checks `requireStudyUSAdmin` itself.
 *
 * Rules:
 *  - Under /dashboard/admin/** an actor who holds the ADMIN workspace is
 *    shown the Administration context, whatever workspace they last
 *    selected. This is presentation only and is not persisted, so a
 *    multi-role account keeps every role and its stored preference.
 *  - The dashboard home (`/dashboard`) is a Student surface. In the
 *    ADMIN workspace it redirects to the admin console instead of
 *    rendering (and provisioning) a Student experience.
 */
import type { Workspace } from '@/lib/identity';
import { personaWorkspaceOf } from '@/lib/identity/types';
import { ADMIN_HOME } from './sections';

export const PATHNAME_HEADER = 'x-studyos-pathname';

export function isAdminRoute(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return pathname === '/dashboard/admin' || pathname.startsWith('/dashboard/admin/');
}

/** Track A: institution pages are the INSTITUTION capability's context. */
export function isInstitutionRoute(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return pathname === '/dashboard/institution' || pathname.startsWith('/dashboard/institution/');
}

export interface ShellContextInput {
  pathname: string | null;
  available: Workspace[];
  stored: Workspace | null;
  defaultWorkspace: Workspace | null;
}

export interface ShellContext {
  workspace: Workspace;
  redirectTo: string | null;
}

export function resolveShellContext(input: ShellContextInput): ShellContext {
  const { pathname, available, stored, defaultWorkspace } = input;

  if (isAdminRoute(pathname) && available.includes('ADMIN')) {
    return { workspace: 'ADMIN', redirectTo: null };
  }
  // Track A product amendment: capabilities are entered by route, never by
  // switching. Institution pages render in the INSTITUTION context; every
  // other page renders in the account's ONE persona workspace (a stored
  // capability workspace never displaces the persona). A capability-only
  // account (no persona) keeps the stored/default capability workspace.
  if (isInstitutionRoute(pathname) && available.includes('INSTITUTION')) {
    return { workspace: 'INSTITUTION', redirectTo: null };
  }

  const workspace =
    personaWorkspaceOf(available, stored) ??
    (stored && available.includes(stored) ? stored : null) ??
    defaultWorkspace ??
    available[0] ??
    'STUDENT';

  const redirectTo = workspace === 'ADMIN' && pathname === '/dashboard' ? ADMIN_HOME : null;
  return { workspace, redirectTo };
}
