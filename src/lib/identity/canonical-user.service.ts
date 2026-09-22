import { db } from '@/lib/db';
import type { CanonicalUser, Role, UserRoleGrant, Workspace } from './types';

/**
 * F1 -- resolves or creates the canonical `users` row for a Clerk
 * identity. Lazy, idempotent, same pattern already established by
 * `getOrCreateStudentId`/`getOrCreateParentId` in `src/lib/auth.ts` --
 * this is a sibling, not a replacement. The Clerk webhook
 * (`src/app/api/webhooks/clerk/route.ts`) is deliberately left
 * unmodified: the first F1-aware code path that needs a canonical user
 * for a given `clerk_id` creates it on demand.
 */
export async function getOrCreateCanonicalUser(clerkUserId: string, email?: string | null): Promise<CanonicalUser> {
  const existing = await db.query(
    `SELECT id, clerk_id, email, status, active_workspace, password_change_required FROM users WHERE clerk_id = $1`,
    [clerkUserId]
  );
  if (existing.rows.length > 0) {
    return toCanonicalUser(existing.rows[0]);
  }

  const inserted = await db.query(
    `INSERT INTO users (clerk_id, email) VALUES ($1, $2)
     ON CONFLICT (clerk_id) DO UPDATE SET clerk_id = EXCLUDED.clerk_id
     RETURNING id, clerk_id, email, status, active_workspace, password_change_required`,
    [clerkUserId, email ?? null]
  );
  return toCanonicalUser(inserted.rows[0]);
}

export async function getCanonicalUserByClerkId(clerkUserId: string): Promise<CanonicalUser | null> {
  const result = await db.query(
    `SELECT id, clerk_id, email, status, active_workspace, password_change_required FROM users WHERE clerk_id = $1`,
    [clerkUserId]
  );
  return result.rows.length > 0 ? toCanonicalUser(result.rows[0]) : null;
}

/** Active role grants only -- a REVOKED row is never returned here. */
export async function getUserRoles(userId: string): Promise<UserRoleGrant[]> {
  const result = await db.query(
    `SELECT role, status, granted_via FROM user_roles WHERE user_id = $1 AND status = 'ACTIVE'`,
    [userId]
  );
  return result.rows.map((row: any) => ({
    role: row.role as Role,
    status: row.status,
    grantedVia: row.granted_via,
  }));
}

export async function hasRole(userId: string, role: Role): Promise<boolean> {
  const result = await db.query(
    `SELECT 1 FROM user_roles WHERE user_id = $1 AND role = $2 AND status = 'ACTIVE' LIMIT 1`,
    [userId, role]
  );
  return result.rows.length > 0;
}

function toCanonicalUser(row: any): CanonicalUser {
  return {
    id: row.id,
    clerkId: row.clerk_id,
    email: row.email,
    status: row.status,
    activeWorkspace: row.active_workspace as Workspace | null,
    passwordChangeRequired: row.password_change_required ?? false,
  };
}
