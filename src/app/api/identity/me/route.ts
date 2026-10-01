/**
 * F1 -- GET /api/identity/me
 *
 * Resolves the caller's own canonical identity, active roles, and
 * available/active workspaces. Read-only. `userId`/`email` always come
 * from the authenticated Clerk session (`verifyAuth`), never from any
 * request parameter -- there is nothing here for a client to supply
 * about WHOSE identity to resolve.
 */
import { NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { getOrCreateCanonicalUser, getUserRoles, getRevokedRoles, resolveAvailableWorkspaces, resolveDefaultWorkspace } from '@/lib/identity';

export async function GET() {
  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const user = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);
  const [roles, availableWorkspaces, revokedRoles] = await Promise.all([
    getUserRoles(user.id),
    resolveAvailableWorkspaces(user.id),
    getRevokedRoles(user.id).catch(() => []),
  ]);

  return NextResponse.json({
    success: true,
    data: {
      userId: user.id,
      status: user.status,
      roles: roles.map((r) => r.role),
      // Track A: revoked roles are explained on /role-select (never re-addable by self-service).
      revokedRoles: revokedRoles.map((r) => r.role),
      availableWorkspaces,
      // Track A: the workspace the user is ACTUALLY in -- the stored one while
      // still available, else the default the dashboard would open (the
      // same rule as workspace entry). Never a stale or unavailable value.
      activeWorkspace:
        user.activeWorkspace && availableWorkspaces.includes(user.activeWorkspace)
          ? user.activeWorkspace
          : availableWorkspaces.length > 0
            ? await resolveDefaultWorkspace(user.id)
            : null,
    },
  });
}
