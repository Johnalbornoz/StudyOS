/**
 * F8 -- GET /api/teaching/interventions/[id]
 *
 * Session + its attempt history. LEARNER_PROGRESS_VIEW (owner/parent/
 * teacher), checked against the session's OWN studentId.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { canAccessLearner } from '@/lib/authorization';
import { getInterventionSession, listAttemptsForSession } from '@/lib/teaching/session.service';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);

  const session = await getInterventionSession(id);
  if (!session) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  const allowed = await canAccessLearner(actor.id, session.studentId, 'LEARNER_PROGRESS_VIEW');
  if (!allowed) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  const attempts = await listAttemptsForSession(id);
  return NextResponse.json({ success: true, data: { session, attempts } });
}
