/**
 * Track B / B10 -- GET /api/simulation/attempts/[id]/result
 *
 * The attempt's result view (exam score, sections, objectives with the
 * canonical learning state of their mapped concepts, item review when the
 * frozen policy allows it). Authorized against the attempt's OWN student:
 * owner, or a reader holding LEARNER_PROGRESS_VIEW (accepted parent, scoped
 * teacher). A guessed id of another learner's attempt is 404, never 403, so
 * existence is not confirmed.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { canAccessLearner } from '@/lib/authorization';
import { getSimulationAttempt } from '@/lib/simulation/attempt.service';
import { getAttemptResultView } from '@/lib/exam-core/result-view.service';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

async function handleGET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);

  const attempt = await getSimulationAttempt(id);
  if (!attempt) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  if (!(await canAccessLearner(actor.id, attempt.studentId, 'LEARNER_PROGRESS_VIEW'))) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  const view = await getAttemptResultView(id);
  if (!view?.result) return NextResponse.json({ error: 'NO_RESULT_YET', data: { lifecycle: view?.lifecycle ?? null } }, { status: 409 });
  return NextResponse.json({ success: true, data: view });
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const GET = withAiRequestMetrics('GET /api/simulation/attempts/[id]/result', handleGET);
