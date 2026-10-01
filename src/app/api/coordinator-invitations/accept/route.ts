/**
 * Track A -- POST /api/coordinator-invitations/accept { token }
 * The signed-in person accepts a coordinator invitation. Their account's
 * email must be the invited one (403 EMAIL_MISMATCH otherwise); the
 * invitation is single use (409 ALREADY_USED), expires (410 EXPIRED) and
 * can be withdrawn (410 REVOKED). Acceptance creates no persona: the
 * account gets the coordinator capability of that one institution.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyAuth, resolveClerkIdentity } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { readJson } from '@/lib/institution/route-guard';
import { acceptCoordinatorInvitation } from '@/services/institution-admin.service';

const Schema = z.object({ token: z.string().min(20).max(200) });

const STATUS: Record<string, number> = {
  ACCEPTED: 200,
  ALREADY_ACCEPTED: 200,
  NOT_FOUND: 404,
  EXPIRED: 410,
  REVOKED: 410,
  ALREADY_USED: 409,
  EMAIL_MISMATCH: 403,
  INSTITUTION_NOT_AVAILABLE: 409,
  ROLE_REVOKED: 409,
};

export async function POST(request: NextRequest) {
  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const parsed = Schema.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  const identity = await resolveClerkIdentity(authContext.userId);
  const user = await getOrCreateCanonicalUser(authContext.userId, identity.email);
  const result = await acceptCoordinatorInvitation(parsed.data.token, { userId: user.id, email: identity.email });
  const status = STATUS[result.outcome] ?? 400;
  if (status !== 200) return NextResponse.json({ error: result.outcome }, { status });
  return NextResponse.json({ success: true, data: result });
}
