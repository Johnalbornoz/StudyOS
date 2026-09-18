/**
 * F1 -- Unified Identity, Roles & Workspaces.
 *
 * `Role` is the full vocabulary the platform recognizes.
 * `SelfServiceRole` is the strict subset a public registration flow may
 * ever assign -- INSTITUTION_ADMIN and STUDYUS_ADMIN are deliberately
 * absent from this narrower type, not merely rejected by a runtime
 * check, so that no caller of `assignSelfServiceRole` can even
 * TYPECHECK a request to grant one of those two roles. See
 * F1_AUTHORIZATION_BOUNDARY.md.
 */
export type Role = 'STUDENT' | 'PARENT' | 'TEACHER' | 'INSTITUTION_ADMIN' | 'STUDYUS_ADMIN';

export type SelfServiceRole = Extract<Role, 'STUDENT' | 'PARENT' | 'TEACHER'>;

export const SELF_SERVICE_ROLES: readonly SelfServiceRole[] = ['STUDENT', 'PARENT', 'TEACHER'];

export function isSelfServiceRole(value: unknown): value is SelfServiceRole {
  return typeof value === 'string' && (SELF_SERVICE_ROLES as readonly string[]).includes(value);
}

/**
 * Workspace is derived from active roles -- it is never persisted as
 * its own entity (see F1_IDENTITY_ARCHITECTURE.md §2). One role maps
 * to exactly one workspace, except INSTITUTION_ADMIN and
 * STUDYUS_ADMIN which map to INSTITUTION/ADMIN respectively (workspace
 * names describe the experience, roles describe the grant).
 */
export type Workspace = 'STUDENT' | 'PARENT' | 'TEACHER' | 'INSTITUTION' | 'ADMIN';

export function workspaceForRole(role: Role): Workspace {
  switch (role) {
    case 'STUDENT':
      return 'STUDENT';
    case 'PARENT':
      return 'PARENT';
    case 'TEACHER':
      return 'TEACHER';
    case 'INSTITUTION_ADMIN':
      return 'INSTITUTION';
    case 'STUDYUS_ADMIN':
      return 'ADMIN';
  }
}

/** Fixed priority for resolveDefaultWorkspace -- lower index wins. */
export const WORKSPACE_PRIORITY: readonly Workspace[] = ['STUDENT', 'PARENT', 'TEACHER', 'INSTITUTION', 'ADMIN'];

export interface CanonicalUser {
  id: string;
  clerkId: string;
  email: string | null;
  status: 'ACTIVE' | 'SUSPENDED';
  activeWorkspace: Workspace | null;
}

export interface UserRoleGrant {
  role: Role;
  status: 'ACTIVE' | 'REVOKED';
  grantedVia: 'SELF_REGISTRATION' | 'BACKFILL' | 'INVITATION';
}
