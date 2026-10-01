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

/**
 * Track A product amendment (2026-10-01) -- ONE canonical user, ONE primary
 * functional persona. STUDENT / PARENT / TEACHER are personas: an account
 * holds at most one, chosen once (self-service) and stable afterwards.
 * INSTITUTION_ADMIN and STUDYUS_ADMIN are CAPABILITIES (privileges granted
 * by invitation / allowlist), never personas: they never count as "another
 * role", are never offered for selection, and are reached by route
 * (/dashboard/institution/**, /dashboard/admin/**), not by switching.
 */
export type PrimaryPersona = SelfServiceRole;
export const PRIMARY_PERSONAS: readonly PrimaryPersona[] = SELF_SERVICE_ROLES;
export type Capability = Extract<Role, 'INSTITUTION_ADMIN' | 'STUDYUS_ADMIN'>;
export const CAPABILITY_ROLES: readonly Capability[] = ['INSTITUTION_ADMIN', 'STUDYUS_ADMIN'];
export const PERSONA_WORKSPACES: readonly Workspace[] = ['STUDENT', 'PARENT', 'TEACHER'];

export function isPrimaryPersona(role: unknown): role is PrimaryPersona {
  return isSelfServiceRole(role);
}

export function isPersonaWorkspace(workspace: unknown): workspace is Workspace {
  return typeof workspace === 'string' && (PERSONA_WORKSPACES as readonly string[]).includes(workspace);
}

/**
 * The persona workspace among the available ones. With the single-persona
 * invariant there is at most one; for a legacy account that still holds
 * several, the stored one wins, then priority order -- deterministic.
 */
export function personaWorkspaceOf(available: readonly Workspace[], stored: Workspace | null = null): Workspace | null {
  const personas = available.filter(isPersonaWorkspace);
  if (personas.length === 0) return null;
  if (stored && personas.includes(stored)) return stored;
  return WORKSPACE_PRIORITY.find((w) => personas.includes(w)) ?? null;
}

/** Fase 2A -- ARCHIVED added alongside the pre-existing ACTIVE/SUSPENDED (F1). Widens the type to match the widened `users_status_check_v2` DB constraint -- no existing row's value changes. */
export type UserAccountStatus = 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';

export interface CanonicalUser {
  id: string;
  clerkId: string;
  email: string | null;
  status: UserAccountStatus;
  activeWorkspace: Workspace | null;
  /** True only for an admin-created account whose temporary password has not yet been changed by its owner -- see dashboard/layout.tsx and /account/change-password. */
  passwordChangeRequired: boolean;
}

export interface UserRoleGrant {
  role: Role;
  status: 'ACTIVE' | 'REVOKED';
  grantedVia: 'SELF_REGISTRATION' | 'BACKFILL' | 'INVITATION';
}
