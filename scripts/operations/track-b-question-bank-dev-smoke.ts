/**
 * Question Bank Factory V1 -- ONE controlled real-AI PAA smoke on DEV.
 *
 * gap (bank health, P1 deficits) -> queue (two bounded small batches on P1 cells: one
 * mathematics, one reading) -> generation -> validation (deterministic math; reading
 * evidence + independent validator) -> repair / reject -> PILOT -> coverage delta.
 *
 * Hard limits: DEV fingerprint only; --confirm-ai required; AI_MAX_CALLS_PER_DAY must be
 * given explicitly (the shared-cap reserve is computed against it, never raised);
 * maxPerRun = --max-calls (<= 6); enabled for THIS process only (no scheduled /
 * continuous generation remains: the deployment keeps the factory disabled).
 *
 *   AI_MAX_CALLS_PER_DAY=<shared cap> npx tsx --env-file=.env.local \
 *     scripts/operations/track-b-question-bank-dev-smoke.ts --max-calls 6 --confirm-ai
 */
import { createHash } from 'crypto';
import { db } from '@/lib/db';
import { refreshVersionHealth, listBankVersions } from '@/lib/exam-core/question-bank/health.service';
import { enqueueManual } from '@/lib/exam-core/question-bank/queue.service';
import { runFactory, budgetSnapshot } from '@/lib/exam-core/question-bank/factory.service';
import { factoryConfig } from '@/lib/exam-core/question-bank/policy';
import { prioritizeGaps } from '@/lib/exam-core/question-bank/health';

const args = process.argv.slice(2);
const opt = (n: string) => (args.indexOf(n) >= 0 ? args[args.indexOf(n) + 1] : undefined);

async function main() {
  const u = new URL(process.env.DATABASE_URL ?? '');
  const fp = createHash('sha256').update(u.hostname + '|' + u.pathname.slice(1)).digest('hex').slice(0, 16);
  if (fp !== '2a29b99ee14a22b4') throw new Error(`REFUSING: not the DEV database (${fp})`);
  if (!args.includes('--confirm-ai')) throw new Error('REFUSING: --confirm-ai required');
  if (!process.env.AI_MAX_CALLS_PER_DAY) throw new Error('REFUSING: AI_MAX_CALLS_PER_DAY must be given explicitly (shared cap)');
  const maxCalls = Number(opt('--max-calls'));
  if (!Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > 6) throw new Error('--max-calls must be 1..6');

  const paa = (await listBankVersions()).find((v) => v.configKey === 'v2.paa');
  if (!paa) throw new Error('PAA version not found');
  const base = factoryConfig({ ...process.env, QUESTION_BANK_FACTORY_ENABLED: 'true' });
  const cfg = { ...base, enabled: true, maxPerRun: maxCalls, dailyBudget: Math.max(base.dailyBudget, maxCalls), maxBatch: 2, maxRepairsPerCandidate: 1, examConfigKeys: [] };
  const budget = await budgetSnapshot(cfg);
  console.log(JSON.stringify({ at: 'budget', usedToday: budget.usedToday, platformRemaining: budget.platformRemaining, stop: budget.stop, maxPerRun: cfg.maxPerRun, reserve: cfg.minRemainingAiReserve }));
  if (budget.stop) throw new Error(`STOP: budget says ${budget.stop}`);

  // gap: the live bank's prioritized deficits
  const h = (await refreshVersionHealth(paa.examVersionId))!;
  const gaps = prioritizeGaps(h.health.cells);
  console.log(JSON.stringify({ at: 'gaps', count: gaps.length, top: gaps.slice(0, 5).map((g) => ({ cell: g.cellKey, priority: g.priority, deficit: g.deficit, need: g.generationNeed })) }));
  const pick = (code: string) => gaps.find((g) => g.objectiveCode === code);
  const targets = [pick('paa.mat.algebra'), pick('paa.lect.inferencia')].filter((x): x is NonNullable<typeof x> => !!x);
  if (targets.length !== 2) throw new Error('expected both target cells to be open gaps');

  // queue: two bounded small batches (idempotent per cell)
  const system = (await db.query(`SELECT id FROM users WHERE is_system ORDER BY created_at LIMIT 1`)).rows[0].id;
  const ids: string[] = [];
  for (const g of targets) {
    const r = await enqueueManual({ inputs: h.inputs, cellKey: g.cellKey, count: 2, requestedBy: system, idempotencyKey: `dev-smoke-2026-10-03:${g.objectiveCode}`, maxBatch: 2 });
    ids.push(r.request.id);
    console.log(JSON.stringify({ at: 'queued', cell: g.cellKey, priority: g.priority, deficit: g.deficit, requestId: r.request.id, created: r.created, count: r.request.requestedCount }));
  }

  // generation -> validation -> PILOT, bounded by maxPerRun; no gap re-analysis (no extra queue)
  const run = await runFactory({ trigger: 'CLI', examVersionIds: [paa.examVersionId], cfg, skipGapAnalysis: true });
  console.log(JSON.stringify({ at: 'run', runId: run.runId, status: run.status, counters: run.counters, requestsProcessed: run.requestsProcessed, notes: run.notes }));
  console.log(JSON.stringify({ at: 'coverage', delta: run.coverage }));
  const cands = await db.query(
    `SELECT qi.item_key, qi.cell_key, ai.version_number, ai.bank_lifecycle_status lc, ai.validation_report->>'stage' stage, ai.validation_report->>'outcome' outcome,
            ai.validation_report->'validator'->>'model' validator_model, ai.validation_report->'validator'->>'escalated' escalated, ai.validation_report->'issues' issues, ai.content->>'question' q
       FROM question_bank_items qi JOIN approved_items ai ON ai.bank_item_id = qi.id WHERE qi.generation_request_id = ANY($1::uuid[]) ORDER BY ai.created_at`,
    [ids]
  );
  for (const c of cands.rows) console.log(JSON.stringify({ at: 'candidate', cell: c.cell_key, v: c.version_number, lifecycle: c.lc, stage: c.stage, outcome: c.outcome, validator: c.validator_model, escalated: c.escalated, issues: (c.issues ?? []).map((i: any) => i.code), question: String(c.q).slice(0, 140) }));
  const reqs = await db.query(`SELECT cell_key, status, attempt_count, candidates_created, accepted, rejected, repaired, review_required, last_error FROM question_bank_generation_requests WHERE id = ANY($1::uuid[])`, [ids]);
  for (const r of reqs.rows) console.log(JSON.stringify({ at: 'request', ...r }));
  await db.end();
}

main().catch(async (err) => {
  console.error('SMOKE ERROR', err instanceof Error ? err.message : err);
  await db.end().catch(() => undefined);
  process.exit(1);
});
