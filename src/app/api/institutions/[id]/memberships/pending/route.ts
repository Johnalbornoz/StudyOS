/**
 * F2 -- GET pending memberships for an institution. Gated by
 * canAccessInstitution (INSTITUTION_MEMBER_APPROVE) -- an admin of a
 * DIFFERENT institution is denied (AC-F2-11), never sees this
 * institution's pending list.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { canAccessInstitution } from '@/lib/authorization';
import { listPendingMemberships } from '@/services/institution.service';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: institutionId } = await params;
  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);
  const allowed = await canAccessInstitution(actor.id, institutionId, 'INSTITUTION_MEMBER_APPROVE');
  if (!allowed) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  const memberships = await listPendingMemberships(institutionId);
  return NextResponse.json({ success: true, data: { memberships } });
}
