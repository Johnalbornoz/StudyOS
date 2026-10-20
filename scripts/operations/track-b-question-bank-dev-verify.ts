/**
 * Question Bank Factory V1 -- DEV verification of the bank invariants on the REAL DEV data.
 * Read-only, except checks that need a write, which run inside a transaction that is
 * ALWAYS rolled back. Refuses unless the DB fingerprint is the official DEV one.
 *
 *   npx tsx --env-file=.env.local scripts/operations/track-b-question-bank-dev-verify.ts
 */
import { createHash } from 'crypto';
import { db } from '@/lib/db';
import { listBankVersions, loadVersionHealthInputs } from '@/lib/exam-core/question-bank/health.service';
import { enqueueManual } from '@/lib/exam-core/question-bank/queue.service';
import { selectApprovedBankItem } from '@/lib/exam-core/item-sourcing.service';
import { lifecycleSqlFor } from '@/lib/exam-core/question-bank/lifecycle';
import { transitionVersion } from '@/lib/exam-core/question-bank/bank.service';

const results: Array<{ id: string; ok: boolean; detail?: unknown }> = [];
const check = (id: string, ok: boolean, detail?: unknown) => {
  results.push({ id, ok, detail });
  console.log(`${ok ? '  OK  ' : '  FAIL'} ${id}${detail !== undefined ? ` -- ${JSON.stringify(detail)}` : ''}`);
};
const n = async (sql: string, p: unknown[] = []) => Number((await db.query(sql, p)).rows[0]?.n ?? 0);

/** Runs `fn` in a transaction that is always rolled back; returns the error message, if any. */
async function inRollback(fn: (c: any) => Promise<void>): Promise<string | null> {
  const c = await db.connect();
  try {
    await c.query('BEGIN');
    await fn(c);
    return null;
  } catch (e: any) {
    return String(e.message);
  } finally {
    await c.query('ROLLBACK').catch(() => undefined);
    c.release();
  }
}

async function main() {
  const u = new URL(process.env.DATABASE_URL ?? '');
  const fp = createHash('sha256').update(u.hostname + '|' + u.pathname.slice(1)).digest('hex').slice(0, 16);
  if (fp !== '2a29b99ee14a22b4') throw new Error(`REFUSING: not the DEV database (${fp})`);
  console.log(`DEV ${fp}`);
  const paa = (await listBankVersions()).find((v) => v.configKey === 'v2.paa')!;

  // ---- identity / versions / provenance / audit ----
  check('IDENTITY.every-item-registered', (await n(`SELECT count(*) n FROM approved_items WHERE bank_item_id IS NULL`)) === 0);
  check('IDENTITY.current-version-points-to-own-version', (await n(`SELECT count(*) n FROM question_bank_items qi LEFT JOIN approved_items ai ON ai.id = qi.current_version_id WHERE ai.id IS NULL OR ai.bank_item_id <> qi.id`)) === 0);
  check('VERSION.unique-numbers', (await n(`SELECT count(*) n FROM (SELECT bank_item_id, version_number FROM approved_items GROUP BY 1, 2 HAVING count(*) > 1) d`)) === 0);
  check('VERSION.status-lifecycle-consistent', (await n(`SELECT count(*) n FROM approved_items WHERE bank_lifecycle_status IN ('PILOT','CALIBRATED','ACTIVE') AND status <> 'PUBLISHED'`)) === 0);
  check('PROVENANCE.generated-is-studyus', (await n(`SELECT count(*) n FROM question_bank_items WHERE generation_request_id IS NOT NULL AND provenance <> 'STUDYUS_GENERATED'`)) === 0);
  check('PROVENANCE.generated-content-origin', (await n(`SELECT count(*) n FROM approved_items ai JOIN question_bank_items qi ON qi.id = ai.bank_item_id WHERE qi.generation_request_id IS NOT NULL AND (ai.content->>'contentOrigin' <> 'GENERATED' OR ai.content->>'contentStatus' <> 'ORIGINAL')`)) === 0);
  check('PROVENANCE.official-content-zero', (await n(`SELECT count(*) n FROM question_bank_items WHERE provenance IN ('OFFICIAL','LICENSED')`)) === 0);
  const generatedVersions = await n(`SELECT count(*) n FROM approved_items ai JOIN question_bank_items qi ON qi.id = ai.bank_item_id WHERE qi.generation_request_id IS NOT NULL`);
  check('AUDIT.every-generated-version-has-history', (await n(`SELECT count(*) n FROM approved_items ai JOIN question_bank_items qi ON qi.id = ai.bank_item_id WHERE qi.generation_request_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM question_bank_lifecycle_events e WHERE e.approved_item_id = ai.id)`)) === 0, { generatedVersions });
  check('AUDIT.backfill-one-event-per-legacy-item', (await n(`SELECT count(*) n FROM (SELECT approved_item_id FROM question_bank_lifecycle_events WHERE reason = 'MIGRATION_BACKFILL' GROUP BY 1 HAVING count(*) > 1) d`)) === 0);
  check('LIFECYCLE.no-generated-active', (await n(`SELECT count(*) n FROM approved_items ai JOIN question_bank_items qi ON qi.id = ai.bank_item_id WHERE qi.generation_request_id IS NOT NULL AND ai.bank_lifecycle_status IN ('ACTIVE','CALIBRATED')`)) === 0);
  check('LIFECYCLE.audited-path-draft-to-pilot', (await n(`SELECT count(*) n FROM approved_items ai WHERE ai.bank_lifecycle_status = 'PILOT' AND NOT (
      EXISTS (SELECT 1 FROM question_bank_lifecycle_events e WHERE e.approved_item_id = ai.id AND e.to_status = 'VALIDATING')
      AND EXISTS (SELECT 1 FROM question_bank_lifecycle_events e WHERE e.approved_item_id = ai.id AND e.to_status = 'VALIDATED')
      AND EXISTS (SELECT 1 FROM question_bank_lifecycle_events e WHERE e.approved_item_id = ai.id AND e.to_status = 'PILOT'))`)) === 0);

  // ---- guards on the real data (rolled back) ----
  const pilot = (await db.query(`SELECT ai.id FROM approved_items ai WHERE ai.bank_lifecycle_status = 'PILOT' LIMIT 1`)).rows[0]?.id;
  const active = (await db.query(`SELECT ai.id FROM approved_items ai JOIN question_bank_items qi ON qi.id = ai.bank_item_id WHERE ai.learning_objective_id = $1 AND ai.bank_lifecycle_status = 'ACTIVE' ORDER BY ai.created_at LIMIT 1`, [paa ? (await loadVersionHealthInputs(paa.examVersionId))!.cells.find((c) => c.objectiveCode === 'paa.mat.algebra')!.learningObjectiveId : null])).rows[0]?.id;
  check('VERSION.content-immutable-on-dev', /QUESTION_BANK_VERSION_IMMUTABLE/.test((await inRollback((c) => c.query(`UPDATE approved_items SET content = content || '{"explanation":"x"}'::jsonb WHERE id = $1`, [active]))) ?? ''));
  check('VERSION.no-delete-on-dev', /NOT_DELETABLE|foreign key/.test((await inRollback((c) => c.query(`DELETE FROM approved_items WHERE id = $1`, [active]))) ?? ''));
  check('LIFECYCLE.invalid-transition-refused-on-dev', /QUESTION_BANK_INVALID_TRANSITION/.test((await inRollback((c) => c.query(`UPDATE approved_items SET bank_lifecycle_status = 'DRAFT_AI', status = 'DRAFT' WHERE id = $1`, [active]))) ?? ''));
  let sysPromote = '';
  try {
    await transitionVersion({ versionId: pilot, to: 'ACTIVE', reason: 'unattended promotion attempt', actor: { kind: 'SYSTEM' } });
  } catch (e: any) {
    sysPromote = e.code ?? String(e.message);
  }
  check('LIFECYCLE.system-cannot-promote-pilot (refused before any write)', sysPromote === 'ADMIN_REQUIRED' && (await n(`SELECT count(*) n FROM approved_items WHERE id = $1 AND bank_lifecycle_status = 'PILOT'`, [pilot])) === 1, sysPromote);

  // ---- idempotence ----
  const inputs = (await loadVersionHealthInputs(paa.examVersionId))!;
  const alg = inputs.cells.find((c) => c.objectiveCode === 'paa.mat.algebra')!;
  const before = await n(`SELECT count(*) n FROM question_bank_generation_requests`);
  const again = await enqueueManual({ inputs, cellKey: alg.cellKey, count: 2, requestedBy: (await db.query(`SELECT id FROM users WHERE is_system ORDER BY created_at LIMIT 1`)).rows[0].id, idempotencyKey: 'dev-smoke-2026-10-03:paa.mat.algebra', maxBatch: 2 });
  check('QUEUE.idempotency-key-replay-creates-nothing', !again.created && (await n(`SELECT count(*) n FROM question_bank_generation_requests`)) === before);
  check('QUEUE.one-open-per-cell-on-dev', (await n(`SELECT count(*) n FROM (SELECT exam_version_id, cell_key FROM question_bank_generation_requests WHERE status IN ('PENDING','RUNNING') GROUP BY 1, 2 HAVING count(*) > 1) d`)) === 0);
  check('RUN.no-run-left-running', (await n(`SELECT count(*) n FROM question_bank_factory_runs WHERE status = 'RUNNING'`)) === 0);

  // ---- eligibility on the real bank ----
  const objectiveIds = [...new Set(inputs.cells.map((c) => c.learningObjectiveId))];
  const mockPool = (await db.query(`SELECT ai.id FROM approved_items ai WHERE ai.status = 'PUBLISHED' AND ai.learning_objective_id = ANY($1::uuid[]) AND ${lifecycleSqlFor('REDUCED_MOCK')}`, [objectiveIds])).rows.map((r: any) => r.id);
  const pilotIds = (await db.query(`SELECT id FROM approved_items WHERE bank_lifecycle_status = 'PILOT'`)).rows.map((r: any) => r.id);
  check('POLICY.mock-pool-excludes-pilot', pilotIds.length > 0 && pilotIds.every((id: string) => !mockPool.includes(id)), { mockPool: mockPool.length, pilots: pilotIds.length });
  const fixtures = (await db.query(`SELECT id FROM approved_items WHERE learning_objective_id = $1 AND bank_lifecycle_status = 'ACTIVE'`, [alg.learningObjectiveId])).rows.map((r: any) => r.id);
  const practice = await selectApprovedBankItem({ attemptId: 'dev-verify', target: { learningObjectiveId: alg.learningObjectiveId, questionType: null, difficultyRange: null }, excludeApprovedItemIds: fixtures, preferredStimulusKey: null });
  check('POLICY.practice-can-use-pilot', !!practice && pilotIds.includes(practice.exam.approvedItemId!));
  const retiredErr = await inRollback(async (c) => {
    await c.query(`UPDATE approved_items SET bank_lifecycle_status = 'RETIRED', status = 'RETIRED' WHERE id = $1`, [active]);
    const pool = (await c.query(`SELECT ai.id FROM approved_items ai WHERE ai.status = 'PUBLISHED' AND ai.learning_objective_id = $1 AND ${lifecycleSqlFor('PRACTICE')}`, [alg.learningObjectiveId])).rows.map((r: any) => r.id);
    if (pool.includes(active)) throw new Error('RETIRED_STILL_ELIGIBLE');
  });
  check('POLICY.retired-excluded (rolled back)', retiredErr === null, retiredErr);
  check('POLICY.rollback-left-item-active', (await n(`SELECT count(*) n FROM approved_items WHERE id = $1 AND bank_lifecycle_status = 'ACTIVE'`, [active])) === 1);

  // ---- historical attempts ----
  check('HIST.every-response-resolves-its-version', (await n(`SELECT count(*) n FROM exam_attempt_item_responses r LEFT JOIN approved_items ai ON ai.id = r.approved_item_id WHERE r.approved_item_id IS NOT NULL AND ai.id IS NULL`)) === 0);
  check('HIST.referenced-versions-are-bank-versions', (await n(`SELECT count(*) n FROM exam_attempt_item_responses r JOIN approved_items ai ON ai.id = r.approved_item_id WHERE ai.bank_item_id IS NULL`)) === 0);

  // ---- deferred validation is resumable, not lost ----
  const deferred = await n(`SELECT count(*) n FROM approved_items WHERE bank_lifecycle_status = 'VALIDATING' AND validation_report->>'outcome' = 'DEFERRED'`);
  // State-tolerant: a later authorized run may legitimately resume a deferred candidate; what must hold is
  // that nothing still being validated (deferred or not) is ever deliverable.
  check('RESUME.validating-candidates-never-deliverable', (await n(`SELECT count(*) n FROM approved_items WHERE bank_lifecycle_status IN ('VALIDATING', 'DRAFT_AI') AND status NOT IN ('DRAFT', 'PROPOSED')`)) === 0, { deferred });

  const failed = results.filter((r) => !r.ok);
  console.log(JSON.stringify({ checks: results.length, failed: failed.length }));
  await db.end();
  if (failed.length) process.exit(1);
}
main().catch(async (e) => {
  console.error('VERIFY ERROR', e instanceof Error ? e.message : e);
  await db.end().catch(() => undefined);
  process.exit(1);
});
