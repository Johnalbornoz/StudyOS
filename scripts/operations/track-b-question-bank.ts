/**
 * Question Bank Factory V1 -- DEV operator CLI. Refuses unless the database
 * fingerprint is the official DEV one (or an explicitly allowed ephemeral DB).
 *
 *   npx tsx --env-file=.env.local scripts/operations/track-b-question-bank.ts <command> [flags]
 *
 *   health [--write]          bank health of every published version (prints; --write stores snapshots + registers identities)
 *   shadow                    persisted catalogue readiness vs bank-calculated readiness per node (SHADOW comparison)
 *   report                    the readiness-report metrics as JSON (reads the latest snapshots)
 *   run --exam v2.paa --max-calls N [--batch K] [--confirm-ai]
 *                             ONE bounded factory run with the REAL provider (requires --confirm-ai;
 *                             never above --max-calls; enabled only for this process)
 *
 * Never raises the shared AI cap; the run is bounded by --max-calls and by the
 * shared-cap reserve.
 */
import { createHash } from 'crypto';
import { db } from '@/lib/db';
import { ensureBankIdentities } from '@/lib/exam-core/question-bank/bank.service';
import { listBankVersions, refreshVersionHealth, loadVersionHealthInputs, healthFromInputs, latestSnapshots } from '@/lib/exam-core/question-bank/health.service';
import { overlayNodeReadiness, shadowDirection } from '@/lib/exam-core/question-bank/readiness-overlay';
import { flattenCatalog } from '@/lib/exam-core/catalog/structure';
import { runFactory, budgetSnapshot } from '@/lib/exam-core/question-bank/factory.service';
import { factoryConfig } from '@/lib/exam-core/question-bank/policy';

const DEV_FP = '2a29b99ee14a22b4';
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

function fingerprint(): string {
  const u = new URL(process.env.DATABASE_URL ?? '');
  return createHash('sha256').update(u.hostname + '|' + u.pathname.slice(1)).digest('hex').slice(0, 16);
}

async function health(write: boolean) {
  if (write) console.log(JSON.stringify({ registered: await ensureBankIdentities() }));
  for (const v of await listBankVersions()) {
    let h;
    if (write) h = (await refreshVersionHealth(v.examVersionId))?.health;
    else {
      const inputs = await loadVersionHealthInputs(v.examVersionId);
      h = inputs ? healthFromInputs(inputs) : null;
    }
    if (!h) continue;
    console.log(JSON.stringify({
      exam: v.definitionName, family: v.family, version: v.versionLabel, structureOnly: v.structureOnly,
      items: h.totals.items, active: h.totals.active, pilot: h.totals.pilot, reviewRequired: h.totals.reviewRequired, cells: h.totals.cells, empty: h.totals.cellsEmpty, formBlocking: h.totals.cellsFormBlocking,
      practice: h.readiness.practice.ready, reducedMock: h.readiness.reducedMock.ready, fullMock: h.readiness.fullMock.ready, fullMockCalibrated: h.readiness.fullMockCalibrated.ready, official: h.officialContentCoverage,
    }));
  }
}

async function shadow() {
  const declared = new Map(flattenCatalog().map((f) => [f.node.key, f.node.modes]));
  const rows = (await db.query(`SELECT node_key, selectable, metadata, exam_version_id, assessment_component_id FROM assessment_structure_nodes WHERE status = 'ACTIVE' AND exam_version_id IS NOT NULL ORDER BY node_key`)).rows;
  const snaps = await latestSnapshots([...new Set(rows.map((r: any) => r.exam_version_id))] as string[]);
  const tally: Record<string, number> = {};
  const diffs: unknown[] = [];
  for (const r of rows) {
    const snap = snaps.get(r.exam_version_id);
    const persisted = r.metadata?.readiness ?? { state: 'CATALOG_ONLY', modes: [], components: [] };
    const bind = r.metadata?.bind ?? null;
    const out = overlayNodeReadiness({
      persisted: { state: persisted.state, modes: persisted.modes ?? [], components: persisted.components ?? [], selectable: r.selectable },
      declaredModes: declared.get(r.node_key), bound: !!r.exam_version_id && (!bind?.sectionKey || !!r.assessment_component_id), bind, snapshot: snap ? { cells: snap.cells, components: snap.components } : null, mode: 'ENFORCE',
    });
    const direction = shadowDirection(persisted.state, snap ? out.state : null);
    tally[direction] = (tally[direction] ?? 0) + 1;
    if (direction !== 'SAME') diffs.push({ node: r.node_key, persisted: persisted.state, calculated: snap ? out.state : null, direction });
  }
  console.log(JSON.stringify({ shadow: tally, differences: diffs }, null, 1));
}

async function report() {
  const versions = await listBankVersions();
  const snaps = await latestSnapshots(versions.map((v) => v.examVersionId));
  const sum = (f: (s: any) => number) => [...snaps.values()].reduce((n, s) => n + f(s), 0);
  const queue = (await db.query(`SELECT status, count(*)::int AS n FROM question_bank_generation_requests GROUP BY 1`)).rows;
  const gen = (await db.query(`SELECT count(*)::int AS n FROM question_bank_items WHERE generation_request_id IS NOT NULL`)).rows[0].n;
  const passed = (await db.query(`SELECT count(*)::int AS n FROM question_bank_lifecycle_events e JOIN question_bank_items qi ON qi.id = e.bank_item_id WHERE qi.generation_request_id IS NOT NULL AND e.to_status = 'VALIDATED'`)).rows[0].n;
  const runs = (await db.query(`SELECT COALESCE(sum(ai_calls),0)::int AS calls, COALESCE(sum(input_tokens),0)::bigint AS tin, COALESCE(sum(output_tokens),0)::bigint AS tout, COALESCE(sum(estimated_cost_usd),0) AS cost FROM question_bank_factory_runs`)).rows[0];
  const byFamily: Record<string, unknown[]> = {};
  for (const v of versions) {
    const s = snaps.get(v.examVersionId);
    (byFamily[v.family] ??= []).push({
      exam: v.definitionName, version: v.versionLabel, structure: s?.readiness.structure ?? null, practice: s?.readiness.practice.ready ?? null, reducedMock: s?.readiness.reducedMock.ready ?? null,
      fullMock: s?.readiness.fullMock.ready ?? null, fullMockCalibrated: s?.readiness.fullMockCalibrated.ready ?? null, officialContentCoverage: s?.summary.officialContentCoverage ?? null,
    });
  }
  const paa = versions.find((v) => v.configKey === 'v2.paa');
  const paaSnap = paa ? snaps.get(paa.examVersionId) : undefined;
  console.log(JSON.stringify({
    TOTAL_BANK_ITEMS: sum((s) => s.summary.items), ACTIVE_ITEMS: sum((s) => s.summary.active), PILOT_ITEMS: sum((s) => s.summary.pilot), CALIBRATED_ITEMS: sum((s) => s.summary.calibrated),
    REVIEW_REQUIRED_ITEMS: sum((s) => s.summary.reviewRequired), RETIRED_ITEMS: sum((s) => s.summary.retired), BLUEPRINT_CELLS_TOTAL: sum((s) => s.summary.cells), BLUEPRINT_CELLS_EMPTY: sum((s) => s.summary.cellsEmpty),
    BLUEPRINT_CELLS_FORM_BLOCKING: sum((s) => s.summary.cellsFormBlocking), GENERATION_QUEUE_PENDING: queue.find((q: any) => q.status === 'PENDING')?.n ?? 0, GENERATION_CANDIDATES_CREATED: gen,
    VALIDATION_PASS_RATE: gen ? Math.round((passed / gen) * 1000) / 1000 : null, AI_CALLS: runs.calls, TOKENS: { input: Number(runs.tin), output: Number(runs.tout) }, COST_USD: Number(runs.cost),
    PAA_FULL_MOCK_READY: paaSnap ? (paaSnap.readiness.fullMock.ready ? 'YES' : 'NO') : null, PAA_FULL_MOCK_CALIBRATED: paaSnap ? (paaSnap.readiness.fullMockCalibrated.ready ? 'YES' : 'NO') : null,
    PAA_FULL_MOCK_REASONS: paaSnap?.readiness.fullMock.reasons ?? null,
    PAA_CELLS: paaSnap?.cells.map((c) => ({ cell: `${c.componentName} · ${c.objectiveCode}`, full: c.fullPositions, reduced: c.reducedPositions, eligible: c.counts.mockEligible, pilot: c.counts.pilot, missingForFullForm: Math.max(0, c.fullPositions - c.counts.mockEligible), target: c.targets.desired, deficit: c.deficit, priority: c.priority, state: c.state })) ?? null,
    byFamily,
  }, null, 1));
}

async function run() {
  if (!flag('--confirm-ai')) throw new Error('REFUSING: a real-AI run needs --confirm-ai');
  const maxCalls = Number(opt('--max-calls'));
  if (!Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > 30) throw new Error('--max-calls must be 1..30');
  const exam = opt('--exam') ?? 'v2.paa';
  const batch = Number(opt('--batch') ?? 3);
  // Enabled for THIS process only, bounded by --max-calls; the shared-cap reserve still applies.
  const base = factoryConfig({ ...process.env, QUESTION_BANK_FACTORY_ENABLED: 'true' });
  const cfg = { ...base, enabled: true, maxPerRun: maxCalls, dailyBudget: Math.max(base.dailyBudget, maxCalls), maxBatch: Math.min(3, Math.max(1, batch)), examConfigKeys: [exam] };
  console.log(JSON.stringify({ budget: await budgetSnapshot(cfg) }));
  const r = await runFactory({ trigger: 'CLI', cfg });
  console.log(JSON.stringify(r, null, 1));
}

async function main() {
  const fp = fingerprint();
  if (fp !== DEV_FP && process.env.TRACK_B_ALLOW_EPHEMERAL !== fp) throw new Error(`REFUSING: not the DEV database (${fp})`);
  const cmd = args[0];
  if (cmd === 'health') await health(flag('--write'));
  else if (cmd === 'shadow') await shadow();
  else if (cmd === 'report') await report();
  else if (cmd === 'run') await run();
  else throw new Error('usage: health [--write] | shadow | report | run --exam v2.paa --max-calls N --confirm-ai');
  await db.end();
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  await db.end().catch(() => undefined);
  process.exit(1);
});
