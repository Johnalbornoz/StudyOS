/**
 * TRACK B -- records the bank-health snapshot of ONE published exam version (the derived measurement the Student
 * catalogue overlay reads under ENFORCE; with no snapshot a node keeps its structure-only persisted readiness). Never
 * touches content, supply, usage or a blueprint: it measures the bank as it is. The Readiness Engine still restricts
 * every node afterwards (a snapshot can never widen past the engine).
 *
 * DRY RUN by default (computes and prints, stores nothing); --write stores the snapshot. DEV / pilot candidate only.
 *
 *   npx tsx --env-file=<env> scripts/operations/exam-bank/refresh-version-health.ts --version <examVersionId> [--write]
 */
import { createHash } from 'crypto';

process.env.EXAM_BANK_DELIVERY_SCOPE = 'PILOT_PREVIEW';
process.env.QUESTION_BANK_READINESS_MODE = 'ENFORCE';
const TARGETS: Readonly<Record<string, string>> = { '2a29b99ee14a22b4': 'DEV', '4baac799b9bd2a6a': 'PILOT_CANDIDATE_20261015' };

async function main(): Promise<number> {
  const write = process.argv.includes('--write');
  const at = process.argv.indexOf('--version');
  const versionId = at > 0 ? process.argv[at + 1] : '';
  if (!/^[0-9a-f-]{36}$/.test(versionId ?? '')) { console.error('usage: --version <examVersionId> [--write]'); return 2; }
  const u = new URL(process.env.DATABASE_URL ?? '');
  const fp = createHash('sha256').update(`${u.hostname}|${u.pathname.slice(1)}`).digest('hex').slice(0, 16);
  if (!TARGETS[fp]) { console.error(`REFUSING: database ${fp} is not an authorised target`); return 2; }
  const { db } = await import('@/lib/db');
  const { loadVersionHealthInputs, healthFromInputs, refreshVersionHealth, latestSnapshots } = await import('@/lib/exam-core/question-bank/health.service');
  const { HEALTH_ENGINE_VERSION } = await import('@/lib/exam-core/question-bank/health');
  const v = (await db.query(`SELECT v.id, v.status, d.config_key FROM exam_versions v JOIN exam_definitions d ON d.id = v.exam_definition_id WHERE v.id = $1`, [versionId])).rows[0];
  if (!v || v.status !== 'PUBLISHED') { console.error(`REFUSING: ${versionId} is not a published exam version`); await (db as any).end?.(); return 2; }
  const before = (await latestSnapshots([versionId], { currentEngineOnly: true })).get(versionId) ?? null;
  const inputs = await loadVersionHealthInputs(versionId);
  if (!inputs) { console.error('NO_HEALTH_INPUTS'); await (db as any).end?.(); return 1; }
  const health = write ? (await refreshVersionHealth(versionId))!.health : healthFromInputs(inputs);
  console.log(JSON.stringify({
    target: TARGETS[fp], mode: write ? 'WRITE' : 'DRY_RUN', configKey: v.config_key, examVersionId: versionId, healthEngine: HEALTH_ENGINE_VERSION,
    hadCurrentSnapshot: !!before, totals: health.totals, components: health.components.map((c: any) => c.sectionKey), readiness: health.readiness,
  }));
  await (db as any).end?.();
  return 0;
}
main().then((c) => process.exit(c), (e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
