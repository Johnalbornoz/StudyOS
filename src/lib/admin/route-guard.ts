/**
 * Fase 2A -- the single chokepoint every `/api/admin/users/**` route
 * calls first. Centralizes exactly what the task requires every admin
 * route to do before touching any input: resolve the caller from the
 * server-side session (never a client-supplied actor id), require an
 * active STUDYUS_ADMIN, and rate-limit. Nothing about "which action"
 * or "what target" is ever accepted from the client here -- those are
 * the specific route's own job, always via a validated body/params.
 */
import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/auth';
import { requireStudyUSAdmin, type StudyUSAdminContext } from './authorization';

export async function guardAdminUsersRoute(endpoint: string): Promise<{ admin: StudyUSAdminContext } | { error: NextResponse }> {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) {
    return { error: NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 }) };
  }

  const admin = await requireStudyUSAdmin(clerkUserId);
  if (!admin) {
    return { error: NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 }) };
  }

  if (!checkRateLimit(admin.actor.id, endpoint, 30, 60)) {
    return { error: NextResponse.json({ error: 'RATE_LIMITED' }, { status: 429 }) };
  }

  return { admin };
}
