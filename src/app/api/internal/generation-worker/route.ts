/**
 * POST /api/internal/generation-worker -- drives the background generation
 * queue (LEARNING_ACTIVITY_DELIVERY) outside any learner request: a
 * scheduler (Vercel Cron in production) or an operator calls it; learners
 * never do. Protected by CRON_SECRET; fails closed when it is not set.
 */
import { NextRequest, NextResponse } from 'next/server';
import { runDeliveryWorker } from '@/services/activity-delivery-worker.service';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

export const maxDuration = 300;

async function handlePOST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }
  const stats = await runDeliveryWorker({ maxJobs: 20, concurrency: 3, deadlineMs: 270_000 });
  return NextResponse.json({ success: true, data: stats });
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const POST = withAiRequestMetrics('POST /api/internal/generation-worker', handlePOST);
