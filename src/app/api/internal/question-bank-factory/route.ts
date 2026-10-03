/**
 * POST /api/internal/question-bank-factory -- the scheduled / operator entry
 * point of the Question Bank Factory (NOT registered as a cron anywhere: DEV
 * runs are manual). Protected by CRON_SECRET (fails closed). Answers 202 at
 * once and runs ONE bounded factory run in the background: health -> gaps ->
 * bounded queue -> generation + validation within budget -> stop safely.
 * Does nothing unless QUESTION_BANK_FACTORY_ENABLED=true for this environment.
 */
import { after, NextRequest, NextResponse } from 'next/server';
import { hasInternalBearer } from '@/lib/internal/internal-auth';
import { runFactory } from '@/lib/exam-core/question-bank/factory.service';
import { factoryConfig } from '@/lib/exam-core/question-bank/policy';
import { runWithAiMetrics, withAiRequestMetrics } from '@/lib/ai/request-metrics';

export const maxDuration = 300;

async function handlePOST(request: NextRequest) {
  if (!hasInternalBearer(request.headers.get('authorization'))) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const cfg = factoryConfig();
  if (!cfg.enabled) return NextResponse.json({ accepted: false, reason: 'FACTORY_DISABLED' }, { status: 200 });
  after(() =>
    runWithAiMetrics('WORKER question-bank-factory', async () => {
      const r = await runFactory({ trigger: 'SCHEDULED' });
      console.log('[question-bank]', JSON.stringify({ at: 'scheduled_run_finished', runId: r.runId, status: r.status, requestsCreated: r.requestsCreated, requestsProcessed: r.requestsProcessed, ...r.counters }));
    }).catch((err) => console.error('[question-bank] scheduled run failed', err instanceof Error ? err.message : err))
  );
  return NextResponse.json({ accepted: true }, { status: 202 });
}

export const POST = withAiRequestMetrics('POST /api/internal/question-bank-factory', handlePOST);
