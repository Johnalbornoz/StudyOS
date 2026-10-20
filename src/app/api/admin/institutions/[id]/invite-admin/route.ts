/**
 * F2 / AC-F2-12 -- POST /api/admin/institutions/[id]/invite-admin
 *
 * The ONLY path that can ever produce an INSTITUTION_ADMIN grant -- never
 * reachable through public registration or role self-selection.
 *
 * Track A:
 *  - gated by `guardAdminUsersRoute` (STUDYUS_ADMIN role + allowlist);
 *  - the target is named by EMAIL of an existing StudyUs account (the
 *    person signs in once first) or, as before, by Clerk user id;
 *  - the institution must exist and be ACTIVE (404 otherwise);
 *  - an INSTITUTION_ADMIN role an administrator REVOKED is not silently
 *    re-granted here (409 ROLE_REVOKED -- reactivate it from the user's
 *    admin page, an explicit, separately audited decision);
 *  - audited (INSTITUTION_ADMIN_GRANTED).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { guardAdminUsersRoute } from '@/lib/admin/route-guard';
import { recordAdminAction } from '@/lib/admin/audit';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { inviteInstitutionAdmin, getInstitutionById } from '@/services/institution.service';
import { allUuids } from '@/lib/institution/route-guard';

const Schema = z
  .object({ email: z.string().trim().email().optional(), targetClerkUserId: z.string().min(1).optional() })
  .refine((v) => Boolean(v.email || v.targetClerkUserId), { message: 'email or targetClerkUserId is required' });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: institutionId } = await params;
  const guard = await guardAdminUsersRoute('admin.institutions.invite-admin');
  if ('error' in guard) return guard.error;
  if (!allUuids(institutionId)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  let validated;
  try {
    validated = Schema.parse(await request.json());
  } catch (error: any) {
    return NextResponse.json({ error: 'INVALID_INPUT', message: error.errors?.[0]?.message }, { status: 400 });
  }

  const institution = await getInstitutionById(institutionId);
  if (!institution || institution.status !== 'ACTIVE') return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  let targetUserId: string;
  if (validated.email) {
    const found = await db.query(`SELECT id FROM users WHERE lower(email) = lower($1) AND status = 'ACTIVE' LIMIT 1`, [validated.email]);
    if (found.rows.length === 0) return NextResponse.json({ error: 'USER_NOT_FOUND' }, { status: 404 });
    targetUserId = found.rows[0].id;
  } else {
    targetUserId = (await getOrCreateCanonicalUser(validated.targetClerkUserId!)).id;
  }

  const revoked = await db.query(`SELECT 1 FROM user_roles WHERE user_id = $1 AND role = 'INSTITUTION_ADMIN' AND status = 'REVOKED'`, [targetUserId]);
  if (revoked.rows.length > 0) return NextResponse.json({ error: 'ROLE_REVOKED' }, { status: 409 });

  const membership = await inviteInstitutionAdmin(institutionId, targetUserId);
  await recordAdminAction({
    actorUserId: guard.admin.actor.id,
    action: 'INSTITUTION_ADMIN_GRANTED',
    targetType: 'MEMBERSHIP',
    targetId: membership.id,
    newState: { institutionId, userId: targetUserId, role: 'INSTITUTION_ADMIN', status: 'APPROVED' },
  }).catch(() => {});
  return NextResponse.json({ success: true, data: { membership } }, { status: 201 });
}
