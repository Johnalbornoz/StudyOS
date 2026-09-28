/**
 * POST /api/internal/generation-worker -- THE executor of the background
 * generation queue (LEARNING_ACTIVITY_DELIVERY). Learner requests only
 * enqueue and dispatch here (worker-dispatch.service.ts); a scheduler (Vercel
 * Cron in production) or an operator may call it too. It answers 202 at once
 * and drains the queue in THIS invocation, so AI generation + validation never
 * run in an instance serving a learner. Protected by CRON_SECRET; fails closed.
 */
import { after, NextRequest, NextResponse } from 'next/server';
import { runDeliveryWorker } from '@/services/activity-delivery-worker.service';
import { runWithAiMetrics, withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { hasInternalBearer } from '@/lib/internal/internal-auth';

export const maxDuration = 300;

async function handlePOST(request: NextRequest) {
  if (!hasInternalBearer(request.headers.get('authorization'))) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }
  const invocationId = request.headers.get('x-vercel-id');
  after(() =>
    runWithAiMetrics('WORKER generation-worker drain', async () => {
      console.log('[generation-worker]', JSON.stringify({ event: 'drain_started', invocationId }));
      const stats = await runDeliveryWorker({ maxJobs: 20, concurrency: 3, deadlineMs: 270_000 });
      console.log('[generation-worker]', JSON.stringify({ event: 'drain_finished', invocationId, ...stats }));
    }).catch((error) => console.error('[generation-worker] drain failed', error)),
  );
  return NextResponse.json({ accepted: true }, { status: 202 });
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const POST = withAiRequestMetrics('POST /api/internal/generation-worker', handlePOST);
