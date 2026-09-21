/**
 * Onboarding/authorization rework (2026-09-21) -- GET the caller's own
 * TEACHER institution memberships (any status), across every
 * institution, so the self-service UI can render PENDING/APPROVED/
 * REJECTED/REVOKED state without tracking which institution the
 * caller requested at. Always the caller's own resolved identity --
 * no userId/institutionId accepted from the client.
 */
import { NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { getMyTeacherMemberships } from '@/services/institution.service';

export async function GET() {
  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);
  const memberships = await getMyTeacherMemberships(actor.id);
  return NextResponse.json({ success: true, data: { memberships } });
}
