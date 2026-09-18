import { db } from '@/lib/db';
import { getUserRoles } from './canonical-user.service';
import { WORKSPACE_PRIORITY, workspaceForRole, type Workspace } from './types';

/**
 * F1 -- THE single canonical workspace resolver. Every page/route that
 * needs "what workspaces can this user enter" calls this, never a
 * scattered `if (role === ...)`. Derived entirely from active
 * `user_roles` rows -- no separate workspace table (see
 * F1_IDENTITY_ARCHITECTURE.md §2). De-duplicated (INSTITUTION_ADMIN and
 * STUDYUS_ADMIN both existing would still yield INSTITUTION and ADMIN
 * as two distinct entries, never a duplicate of the same workspace).
 */
export async function resolveAvailableWorkspaces(userId: string): Promise<Workspace[]> {
  const roles = await getUserRoles(userId);
  const workspaces = new Set<Workspace>();
  for (const grant of roles) {
    workspaces.add(workspaceForRole(grant.role));
  }
  return WORKSPACE_PRIORITY.filter((w) => workspaces.has(w));
}

/** First available workspace by fixed priority (STUDENT > PARENT > TEACHER > INSTITUTION > ADMIN), or null if the user has no active role at all. */
export async function resolveDefaultWorkspace(userId: string): Promise<Workspace | null> {
  const available = await resolveAvailableWorkspaces(userId);
  return available[0] ?? null;
}

export async function getActiveWorkspace(userId: string): Promise<Workspace | null> {
  const result = await db.query(`SELECT active_workspace FROM users WHERE id = $1`, [userId]);
  return result.rows[0]?.active_workspace ?? null;
}

/**
 * Fails closed: rejects (returns `false`, writes nothing) unless
 * `workspace` is currently in `resolveAvailableWorkspaces(userId)`.
 * INV-F1-11/INV-F1-14: switching workspace only ever changes which UI
 * context is presented -- it never touches, grants, or widens any
 * resource-level authorization (verifyStudentAccess and friends are
 * completely independent of this value).
 */
export async function setActiveWorkspace(userId: string, workspace: Workspace): Promise<boolean> {
  const available = await resolveAvailableWorkspaces(userId);
  if (!available.includes(workspace)) {
    return false;
  }
  await db.query(`UPDATE users SET active_workspace = $2, updated_at = NOW() WHERE id = $1`, [userId, workspace]);
  return true;
}
