/**
 * F2 -- Teacher institutional membership: self-service REQUEST only
 * (always PENDING, always TEACHER -- never INSTITUTION_ADMIN, which
 * this route's service call cannot even express) and read of the
 * caller's own status. Membership approval is a SEPARATE, admin-only
 * route (memberships/[membershipId]/decide) -- this route can never
 * approve anything itself (AC-F2-07).
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { requestTeacherMembership, getMembershipStatus } from '@/services/institution.service';

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: institutionId } = await params;
  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);
  const membership = await requestTeacherMembership(institutionId, actor.id);
  return NextResponse.json({ success: true, data: { membership } });
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: institutionId } = await params;
  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);
  const membership = await getMembershipStatus(institutionId, actor.id, 'TEACHER');
  return NextResponse.json({ success: true, data: { membership } });
}
