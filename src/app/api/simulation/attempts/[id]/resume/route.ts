import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { canAccessLearner } from '@/lib/authorization';
import { getSimulationAttempt, resumeSimulationAttempt, expireSimulationAttemptIfInactive } from '@/lib/simulation/attempt.service';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

async function handlePOST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);

  const attempt = await getSimulationAttempt(id);
  if (!attempt) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  const allowed = await canAccessLearner(actor.id, attempt.studentId, 'LEARNER_INTERVENTION_CREATE');
  if (!allowed) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  // Track B integrity: a paused attempt idle beyond its expiry can never be resumed.
  if (await expireSimulationAttemptIfInactive(attempt)) return NextResponse.json({ error: 'ATTEMPT_EXPIRED' }, { status: 409 });

  try {
    const resumed = await resumeSimulationAttempt(id);
    const { navigationState: _hidden, ...publicAttempt } = resumed;
    void _hidden;
    return NextResponse.json({ success: true, data: { attempt: publicAttempt } });
  } catch {
    return NextResponse.json({ error: 'INVALID_STATUS' }, { status: 409 });
  }
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const POST = withAiRequestMetrics('POST /api/simulation/attempts/[id]/resume', handlePOST);
