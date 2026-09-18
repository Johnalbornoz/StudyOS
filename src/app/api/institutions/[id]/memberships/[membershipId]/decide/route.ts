/**
 * F2 -- POST approve/reject a PENDING teacher membership. Gated by
 * canAccessInstitution (INSTITUTION_MEMBER_APPROVE) against THIS
 * route's own `[id]` institution -- `membershipId` is validated to
 * actually belong to that institution before any decision is applied
 * (never trusts that a membershipId under one institution's URL
 * actually belongs to it).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyAuth } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { canAccessInstitution } from '@/lib/authorization';
import { db } from '@/lib/db';
import { decideMembership } from '@/services/institution.service';

const Schema = z.object({ decision: z.enum(['APPROVED', 'REJECTED']) });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; membershipId: string }> }) {
  const { id: institutionId, membershipId } = await params;
  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);
  const allowed = await canAccessInstitution(actor.id, institutionId, 'INSTITUTION_MEMBER_APPROVE');
  if (!allowed) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  let validated;
  try {
    validated = Schema.parse(await request.json());
  } catch (error: any) {
    return NextResponse.json({ error: 'INVALID_INPUT', message: error.errors?.[0]?.message }, { status: 400 });
  }

  const belongs = await db.query(`SELECT 1 FROM institution_memberships WHERE id = $1 AND institution_id = $2`, [membershipId, institutionId]);
  if (belongs.rows.length === 0) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  const decided = await decideMembership(membershipId, actor.id, validated.decision);
  if (!decided) return NextResponse.json({ error: 'NOT_PENDING' }, { status: 409 });

  return NextResponse.json({ success: true });
}
