/**
 * Platform Admin (STUDYUS_ADMIN) -- POST /api/admin/question-bank/generate
 *
 * "Generate small batch" for ONE blueprint deficit. Bounded on every side:
 * strict body, 1..max batch items (Demo Mode: up to 10), the factory and
 * on-demand generation must be ON in the Platform Admin runtime settings (no
 * redeploy), the family must support generation, and the hard protections
 * (hard daily safety limit, shared-cap reserve; the soft budget only outside
 * Demo Mode) must allow at least one call. The scheduled allowlist never
 * applies to an on-demand request. Idempotent (one open request per cell; optional idempotency key).
 * Answers 202 at once; the bounded run happens in the background and every
 * candidate goes through the full validation pipeline. Audited: the request
 * and the run carry the admin, every lifecycle move is in the item history.
 */
import { after, NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { guardAdminUsersRoute } from '@/lib/admin/route-guard';
import { loadVersionHealthInputs } from '@/lib/exam-core/question-bank/health.service';
import { enqueueManual } from '@/lib/exam-core/question-bank/queue.service';
import { budgetSnapshot, runFactory } from '@/lib/exam-core/question-bank/factory.service';
import { adapterFor } from '@/lib/exam-core/question-bank/adapters';
import { effectiveConfigFor } from '@/lib/exam-core/question-bank/runtime-settings.service';
import { runWithAiMetrics, withAiRequestMetrics } from '@/lib/ai/request-metrics';

export const maxDuration = 300;

const Body = z.strictObject({
  examVersionId: z.string().uuid(),
  cellKey: z.string().min(3).max(400),
  count: z.number().int().min(1).max(25),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9._:-]{8,80}$/).optional(),
  /** V2 demand-driven batch: generate this difficulty mix (from the inventory recommendation). */
  difficultyMix: z.strictObject({ LOW: z.number().int().min(0).max(25), MEDIUM: z.number().int().min(0).max(25), HIGH: z.number().int().min(0).max(25) }).optional(),
});

async function handlePOST(request: NextRequest) {
  const guard = await guardAdminUsersRoute('admin.questionBank.generate');
  if ('error' in guard) return guard.error;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message }, { status: 400 });
  const cfg = await effectiveConfigFor('MANUAL');
  if (!cfg.enabled) return NextResponse.json({ error: cfg.unavailableReason === 'ON_DEMAND_DISABLED' ? 'ON_DEMAND_DISABLED' : 'FACTORY_DISABLED' }, { status: 409 });
  if (parsed.data.count > cfg.maxBatch) return NextResponse.json({ error: 'BATCH_TOO_LARGE', maxBatch: cfg.maxBatch }, { status: 400 });
  const budget = await budgetSnapshot(cfg);
  if (budget.stop) return NextResponse.json({ error: 'BUDGET_EXHAUSTED', reason: budget.stop }, { status: 409 });
  const inputs = await loadVersionHealthInputs(parsed.data.examVersionId);
  if (!inputs) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  if (!adapterFor(inputs.meta.family).generation.supported) return NextResponse.json({ error: 'GENERATION_NOT_SUPPORTED_FOR_FAMILY' }, { status: 409 });
  if (!inputs.cells.some((c) => c.cellKey === parsed.data.cellKey)) return NextResponse.json({ error: 'CELL_NOT_FOUND' }, { status: 404 });

  const mix = parsed.data.difficultyMix;
  if (mix && mix.LOW + mix.MEDIUM + mix.HIGH !== parsed.data.count) return NextResponse.json({ error: 'MIX_DOES_NOT_MATCH_COUNT' }, { status: 400 });
  const { request: req, created } = await enqueueManual({ inputs, cellKey: parsed.data.cellKey, count: parsed.data.count, requestedBy: guard.admin.actor.id, idempotencyKey: parsed.data.idempotencyKey ?? null, maxBatch: cfg.maxBatch, difficultyMix: mix ?? null, demand: mix ? { source: 'ADMIN_DEMAND_CTA' } : null });
  if (req.status === 'PENDING') {
    after(() =>
      runWithAiMetrics('ADMIN question-bank generate', async () => {
        const r = await runFactory({ trigger: 'MANUAL', requestedBy: guard.admin.actor.id, examVersionIds: [req.examVersionId], onlyRequestId: req.id, cfg });
        console.log('[question-bank]', JSON.stringify({ at: 'manual_run_finished', runId: r.runId, status: r.status, ...r.counters }));
      }).catch((err) => console.error('[question-bank] manual run failed', err instanceof Error ? err.message : err))
    );
  }
  return NextResponse.json({ success: true, data: { requestId: req.id, created, status: req.status, requestedCount: req.requestedCount } }, { status: 202 });
}

export const POST = withAiRequestMetrics('POST /api/admin/question-bank/generate', handlePOST);
