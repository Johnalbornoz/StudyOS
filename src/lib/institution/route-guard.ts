/**
 * Track A -- the one guard every institution-admin write route uses:
 * authenticated (401) + APPROVED INSTITUTION_ADMIN of THIS institution
 * (`canAccessInstitution`, 403). Institution A's admin can never act on
 * Institution B: the institution id comes from the route path and is
 * re-checked against the actor's own membership on every request.
 */
import { NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { getOrCreateCanonicalUser, type CanonicalUser } from '@/lib/identity';
import { canAccessInstitution } from '@/lib/authorization';
import type { InstitutionPermission } from '@/lib/authorization/permissions';

export async function requireInstitutionAdminActor(
  institutionId: string,
  permission: InstitutionPermission
): Promise<{ actor: CanonicalUser } | { response: NextResponse }> {
  const authContext = await verifyAuth();
  if (!authContext) return { response: NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 }) };
  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);
  const allowed = await canAccessInstitution(actor.id, institutionId, permission);
  if (!allowed) return { response: NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 }) };
  return { actor };
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Path ids are untrusted: a malformed id is a clean 404, never a DB cast error (500). */
export function allUuids(...ids: string[]): boolean {
  return ids.every((id) => UUID_RE.test(id));
}
