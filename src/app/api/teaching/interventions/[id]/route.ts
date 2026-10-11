/**
 * F8 -- GET /api/teaching/interventions/[id]
 *
 * Session + its attempt history. LEARNER_PROGRESS_VIEW (owner/parent/
 * teacher), checked against the session's OWN studentId.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { resolveLearnerReadScope } from '@/lib/authorization';
import { getInterventionSession, listAttemptsForSession } from '@/lib/teaching/session.service';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

async function handleGET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);

  const session = await getInterventionSession(id);
  if (!session) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  const scope = await resolveLearnerReadScope(actor.id, session.studentId);
  if (!scope.permissions.includes('LEARNER_PROGRESS_VIEW')) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  // L10 SF-4 (D-1): the attempts are the learner's raw item-level responses.
  // Without LEARNER_ASSESSMENT_DETAIL_VIEW (a Parent) only their count is returned.
  const attempts = await listAttemptsForSession(id);
  if (!scope.permissions.includes('LEARNER_ASSESSMENT_DETAIL_VIEW')) {
    return NextResponse.json({ success: true, data: { session, attempts: [], attemptCount: attempts.length, detailWithheld: true } });
  }
  return NextResponse.json({ success: true, data: { session, attempts } });
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const GET = withAiRequestMetrics('GET /api/teaching/interventions/[id]', handleGET);
