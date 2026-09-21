/**
 * Onboarding/authorization rework (2026-09-21) -- GET a Parent's own
 * pending invitations. `verifiedEmail` is always the caller's own
 * Clerk-verified email, resolved server-side via `currentUser()` --
 * never a request parameter, so this can never become a
 * search-by-arbitrary-email oracle (the exact pattern the task
 * requires: a Parent must never be able to browse/link a student by
 * email themselves).
 */
import { NextResponse } from 'next/server';
import { auth, currentUser } from '@clerk/nextjs/server';
import { listPendingInvitationsForEmail } from '@/services/parent.service';

export async function GET() {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress ?? user?.emailAddresses?.[0]?.emailAddress;
  if (!email) return NextResponse.json({ success: true, data: { invitations: [] } });

  const invitations = await listPendingInvitationsForEmail(email);
  return NextResponse.json({ success: true, data: { invitations } });
}
