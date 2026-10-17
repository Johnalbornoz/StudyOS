/**
 * TRACK B -- why a catalogue node does (not) resolve for a Student: catalogue node -> persisted row -> configuration
 * registry -> bank-health snapshot -> overlay -> Readiness Engine -> resolveExamLevel. READ ONLY (every statement is
 * guarded; anything but a read is refused before it reaches the database). DEV / pilot candidate only.
 *
 *   npx tsx --env-file=<env> scripts/operations/exam-bank/catalogue-resolution-trace.ts pisa.2022 pisa.2022.full pisa.2022.math paa.full-length [--out <json>]
 */
import { createHash } from 'crypto';
import { writeFileSync } from 'fs';
import { assertReadOnly } from '@/lib/exam-bank/readiness/read-only-guard';

process.env.EXAM_BANK_DELIVERY_SCOPE = 'PILOT_PREVIEW';
process.env.QUESTION_BANK_READINESS_MODE = 'ENFORCE';
const TARGETS: Readonly<Record<string, string>> = { '2a29b99ee14a22b4': 'DEV', '4baac799b9bd2a6a': 'PILOT_CANDIDATE_20261015' };

async function main(): Promise<number> {
  const at = process.argv.indexOf('--out'); const out = at > 0 ? process.argv[at + 1] : null;
  const keys = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--out');
  const u = new URL(process.env.DATABASE_URL ?? '');
  const fp = createHash('sha256').update(`${u.hostname}|${u.pathname.slice(1)}`).digest('hex').slice(0, 16);
  if (!TARGETS[fp]) { console.error(`REFUSING: database ${fp} is not an authorised target`); return 2; }
  const { db } = await import('@/lib/db');
  const raw = (db as any).query.bind(db);
  (db as any).query = (text: unknown, ...rest: unknown[]) => { assertReadOnly(text); return raw(text, ...rest); };
  const { configsByKey } = await import('@/lib/exam-core/catalog/structure.service');
  const { flattenCatalog } = await import('@/lib/exam-core/catalog/structure');
  const { latestSnapshots } = await import('@/lib/exam-core/question-bank/health.service');
  const { HEALTH_ENGINE_VERSION, readinessForBinding } = await import('@/lib/exam-core/question-bank/health');
  const { applyBankReadinessOverlay } = await import('@/lib/exam-core/question-bank/capability-overlay.service');
  const { engineReadinessForVersion } = await import('@/lib/exam-bank/readiness/readiness-authority.service');
  const { resolveExamLevel } = await import('@/lib/exam-core/catalog/structure.service');
  const configs = configsByKey();
  const report: Record<string, unknown> = { kind: 'CATALOGUE_RESOLUTION_TRACE', database: TARGETS[fp], healthEngine: HEALTH_ENGINE_VERSION, nodes: {} };
  for (const key of keys) {
    const node = flattenCatalog().find((f) => f.node.key === key)?.node ?? null;
    const row = (await db.query(`SELECT * FROM assessment_structure_nodes WHERE node_key = $1`, [key])).rows[0] ?? null;
    const t: Record<string, unknown> = {
      catalogueNode: node ? { bind: node.bind ?? null, modes: node.modes ?? null, purpose: node.purpose ?? null } : 'NOT_IN_CATALOGUE',
      configRegistered: node?.bind ? configs.has(node.bind.configKey) : null,
      row: row ? { status: row.status, selectable: row.selectable, examVersionId: row.exam_version_id, componentId: row.assessment_component_id, persisted: row.metadata?.readiness ? { state: row.metadata.readiness.state, modes: row.metadata.readiness.modes, audience: row.metadata.readiness.audience, model: row.metadata.readiness.model } : null } : 'NO_ROW',
    };
    if (row?.exam_version_id) {
      const anySnap = (await db.query(`SELECT engine_version, computed_at FROM question_bank_health_snapshots WHERE exam_version_id = $1 ORDER BY computed_at DESC LIMIT 1`, [row.exam_version_id])).rows[0] ?? null;
      const cur = (await latestSnapshots([row.exam_version_id], { currentEngineOnly: true })).get(row.exam_version_id) ?? null;
      const bind = row.metadata?.bind ?? {};
      t.snapshot = { latestAny: anySnap, current: cur ? { components: cur.components.length, readiness: readinessForBinding(cur, bind.sectionKey ? [bind.sectionKey] : bind.sectionKeys ?? null, bind.objectiveCodes?.length ? bind.objectiveCodes : null) } : null };
      const e = await engineReadinessForVersion(row.exam_version_id).catch((err: Error) => ({ error: err.message }));
      t.engine = e && !(e as any).error ? { practiceBySection: (e as any).practiceBySection, reducedMock: (e as any).reducedMock, fullMock: (e as any).fullMock, challenge: (e as any).challenge, mockAttemptType: (e as any).mockAttemptType, reasons: (e as any).reasons } : e;
      const [ov] = await applyBankReadinessOverlay([row]);
      t.overlaid = { selectable: ov.selectable, state: ov.metadata?.readiness?.state, modes: ov.metadata?.readiness?.modes };
    }
    const lvl = await resolveExamLevel(key, 'es').catch((err: Error) => ({ error: err.message }));
    t.resolveExamLevel = lvl ? ((lvl as any).error ? lvl : { modes: (lvl as any).modes, components: (lvl as any).components?.length, examVersionId: (lvl as any).examVersionId }) : null;
    (report.nodes as any)[key] = t;
    console.log(key, JSON.stringify(t));
  }
  if (out) writeFileSync(out, JSON.stringify(report, null, 1));
  await (db as any).end?.();
  return 0;
}
main().then((c) => process.exit(c), (e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
