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
import { getOrCreateCanonicalUser, hasRole } from '@/lib/identity';
import { requestTeacherMembership, getMembershipStatus, InstitutionNotAvailableError } from '@/services/institution.service';
import { allUuids } from '@/lib/institution/route-guard';
import { onTeacherMembershipRequested } from '@/lib/institution/membership-events';

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: institutionId } = await params;
  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);
  // Track A: only an identity holding an ACTIVE TEACHER role may ask to
  // teach at an institution (role first, then membership).
  if (!(await hasRole(actor.id, 'TEACHER'))) return NextResponse.json({ error: 'TEACHER_ROLE_REQUIRED' }, { status: 403 });
  if (!allUuids(institutionId)) return NextResponse.json({ error: 'INSTITUTION_NOT_AVAILABLE' }, { status: 404 });

  try {
    const { newlyPending, ...membership } = await requestTeacherMembership(institutionId, actor.id);
    if (newlyPending) await onTeacherMembershipRequested(institutionId, actor.email);
    return NextResponse.json({ success: true, data: { membership } });
  } catch (error) {
    if (error instanceof InstitutionNotAvailableError) return NextResponse.json({ error: 'INSTITUTION_NOT_AVAILABLE' }, { status: 404 });
    throw error;
  }
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: institutionId } = await params;
  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);
  if (!allUuids(institutionId)) return NextResponse.json({ success: true, data: { membership: null } });
  const membership = await getMembershipStatus(institutionId, actor.id, 'TEACHER');
  return NextResponse.json({ success: true, data: { membership } });
}
