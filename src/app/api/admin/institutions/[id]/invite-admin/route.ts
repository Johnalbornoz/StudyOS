/**
 * F2 / AC-F2-12 -- POST /api/admin/institutions/[id]/invite-admin
 *
 * The ONLY path that can ever produce an INSTITUTION_ADMIN grant.
 * Gated by `isAdminEmail` -- never reachable through public
 * registration or role self-selection (F1's assignSelfServiceRole
 * cannot accept this role at the type level; this route is a
 * deliberately separate, narrower mechanism, not an extension of it).
 * `targetClerkUserId` is a Clerk user id the StudyUS admin already
 * knows out of band (e.g. from the Clerk dashboard) -- this is the
 * minimum controlled mechanism the task allows; no Admin Console is
 * built.
 */
import { auth, currentUser } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isAdminEmail } from '@/services/admin.service';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { inviteInstitutionAdmin } from '@/services/institution.service';

const Schema = z.object({ targetClerkUserId: z.string().min(1) });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: institutionId } = await params;
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const user = await currentUser();
  const email = user?.emailAddresses?.[0]?.emailAddress ?? null;
  if (!isAdminEmail(email)) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  let validated;
  try {
    validated = Schema.parse(await request.json());
  } catch (error: any) {
    return NextResponse.json({ error: 'INVALID_INPUT', message: error.errors?.[0]?.message }, { status: 400 });
  }

  const targetUser = await getOrCreateCanonicalUser(validated.targetClerkUserId);
  const membership = await inviteInstitutionAdmin(institutionId, targetUser.id);
  return NextResponse.json({ success: true, data: { membership } });
}
