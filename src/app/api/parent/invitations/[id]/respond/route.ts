/**
 * Onboarding/authorization rework (2026-09-21) -- a Parent accepts or
 * declines an invitation. The invitation's own `invited_email` is
 * checked server-side against the caller's own verified Clerk email
 * (`acceptParentInvitation`/`declineParentInvitation`, never trusting
 * the client) -- a caller can never accept an invitation addressed to
 * someone else's email by guessing/enumerating its id.
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth, currentUser } from '@clerk/nextjs/server';
import { z } from 'zod';
import { getOrCreateParentId } from '@/lib/auth';
import { acceptParentInvitation, declineParentInvitation } from '@/services/parent.service';

const Schema = z.object({ decision: z.enum(['accept', 'decline']) });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: invitationId } = await params;
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress ?? user?.emailAddresses?.[0]?.emailAddress;
  if (!email) return NextResponse.json({ error: 'NO_EMAIL' }, { status: 400 });

  let validated;
  try {
    validated = Schema.parse(await request.json());
  } catch (error: any) {
    return NextResponse.json({ error: 'INVALID_INPUT', message: error.errors?.[0]?.message }, { status: 400 });
  }

  if (validated.decision === 'decline') {
    const declined = await declineParentInvitation(invitationId, email);
    if (!declined) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    return NextResponse.json({ success: true, data: { status: 'declined' } });
  }

  const parentId = await getOrCreateParentId(clerkUserId);
  const accepted = await acceptParentInvitation(invitationId, parentId, email);
  if (!accepted) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  return NextResponse.json({ success: true, data: { status: 'accepted' } });
}
