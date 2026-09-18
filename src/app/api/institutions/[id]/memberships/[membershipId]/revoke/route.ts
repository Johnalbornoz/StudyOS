/**
 * F2 -- POST revoke an APPROVED membership. Soft-revoke only
 * (institution.service.ts::revokeMembership) -- ends any ACTIVE
 * assignments under it in the same transaction (access removed
 * immediately) but never deletes the membership row or any
 * assignment's historical record (INV-F2-07/08/AC-F2-10).
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { canAccessInstitution } from '@/lib/authorization';
import { db } from '@/lib/db';
import { revokeMembership } from '@/services/institution.service';

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string; membershipId: string }> }) {
  const { id: institutionId, membershipId } = await params;
  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);
  const allowed = await canAccessInstitution(actor.id, institutionId, 'INSTITUTION_MEMBER_APPROVE');
  if (!allowed) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  const belongs = await db.query(`SELECT 1 FROM institution_memberships WHERE id = $1 AND institution_id = $2`, [membershipId, institutionId]);
  if (belongs.rows.length === 0) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  const revoked = await revokeMembership(membershipId, actor.id);
  if (!revoked) return NextResponse.json({ error: 'NOT_APPROVED' }, { status: 409 });

  return NextResponse.json({ success: true });
}
