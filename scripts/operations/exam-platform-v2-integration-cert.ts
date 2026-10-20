/**
 * Exam Platform V2 integration cert (QB 802d9be + Blueprint BP-3/BP-4A) -- runs ONLY against a local,
 * ephemeral Postgres (127.0.0.1 / localhost) prepared by exam-platform-v2-migration-chain-cert.sh.
 *
 *   1. slot-constraint schema (20261102): default [] for unconstrained rows, CHECK rejects bad constraints;
 *   2. Saber 11 V2.1 applied through the real applyExamVerticalConfig: 50 slots, 9 constraint cells,
 *      competence 17/22/11, content 19/19/12, written exactly as the Blueprint V2 compiler keys them;
 *   3. the real formInputs reads the 50 constrained positions; flag OFF vs SHADOW return identical inputs;
 *      SHADOW emits one record (through the real DB store) = MATCH on the FULL_MOCK variant;
 *   4. Blueprint parity of the applied rows (cells as the runtime derives them == compiled Blueprint V2).
 * The Question Bank CLI is run separately by the shell script (read-only).
 */
import { createHash } from 'crypto';

const url = new URL(process.env.DATABASE_URL ?? 'postgres://invalid');
if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
  console.error(`REFUSED: ${url.hostname} is not a local ephemeral database`);
  process.exit(2);
}

type Check = { name: string; ok: boolean; detail?: string };
const checks: Check[] = [];
const check = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, detail });

(async () => {
  const { db } = await import('@/lib/db');
  const { applyExamVerticalConfig } = await import('@/lib/exam-core/apply-vertical-config.service');
  const { SABER11_MATH_V2, PAA_V2 } = await import('@/lib/exam-core/verticals/v2');
  const { formInputs } = await import('@/lib/exam-core/exam-instance.service');
  const bp = await import('@/lib/exam-core/blueprint-v2');
  const { constraintSignature, constraintsFromJson } = await import('@/lib/exam-core/slot-constraints');

  // Two technical identities (apply never creates users).
  for (const k of ['cert-editor', 'cert-reviewer']) {
    await db.query(`INSERT INTO users (clerk_id, email, is_system) VALUES ($1, NULL, true) ON CONFLICT (clerk_id) DO NOTHING`, [`system:${k}`]);
  }

  // 1. Saber V2.1 and an unconstrained configuration, through the real apply.
  await applyExamVerticalConfig(SABER11_MATH_V2, { write: true });
  await applyExamVerticalConfig(PAA_V2, { write: true });
  const ver = async (key: string) =>
    (await db.query(`SELECT ev.id, b.id AS blueprint_id FROM exam_versions ev JOIN exam_definitions ed ON ed.id = ev.exam_definition_id JOIN assessment_blueprints b ON b.exam_version_id = ev.id WHERE ed.config_key = $1 AND ev.status = 'PUBLISHED'`, [key])).rows[0];
  const saber = await ver('v2.saber11.math');
  const paa = await ver('v2.paa');
  const rows = (await db.query(`SELECT constraints FROM blueprint_objective_targets WHERE blueprint_id = $1`, [saber.blueprint_id])).rows;
  check('saber: 50 slots', rows.length === 50, `${rows.length}`);
  const sigs = new Map<string, number>();
  for (const r of rows) {
    const sig = constraintSignature(constraintsFromJson(r.constraints));
    sigs.set(sig, (sigs.get(sig) ?? 0) + 1);
  }
  check('saber: 9 constraint cells, none unconstrained', sigs.size === 9 && !sigs.has(''), [...sigs].map(([k, v]) => `${k}=${v}`).join(' '));
  const margin = (dim: string) => {
    const out: Record<string, number> = {};
    for (const [sig, n] of sigs) {
      const v = sig.split(';').find((x) => x.startsWith(`${dim}=`))?.slice(dim.length + 1);
      if (v) out[v] = (out[v] ?? 0) + n;
    }
    return out;
  };
  const comp = margin('COMPETENCE');
  const cont = margin('CONTENT_CATEGORY');
  check('saber: competence 17/22/11', comp.INTERPRETACION_Y_REPRESENTACION === 17 && comp.FORMULACION_Y_EJECUCION === 22 && comp.ARGUMENTACION === 11, JSON.stringify(comp));
  check('saber: content 19/19/12', cont.ALGEBRA_Y_CALCULO === 19 && cont.ESTADISTICA === 19 && cont.GEOMETRIA === 12, JSON.stringify(cont));
  const paaRows = (await db.query(`SELECT count(*)::int AS n, count(*) FILTER (WHERE constraints = '[]'::jsonb)::int AS empty FROM blueprint_objective_targets WHERE blueprint_id = $1`, [paa.blueprint_id])).rows[0];
  check('backward compatibility: unconstrained configuration keeps [] on every slot', paaRows.n > 0 && paaRows.n === paaRows.empty, JSON.stringify(paaRows));
  let rejected = false;
  await db.query('BEGIN');
  try {
    await db.query(`UPDATE blueprint_objective_targets SET constraints = '[{"dimension":"WEIGHT","value":"x"}]'::jsonb WHERE blueprint_id = $1`, [paa.blueprint_id]);
  } catch {
    rejected = true;
  }
  await db.query('ROLLBACK');
  check('CHECK rejects an unknown dimension / malformed value', rejected);

  // 2. Real runtime: formInputs with the flag OFF and SHADOW.
  const components = (await db.query(`SELECT id FROM assessment_components WHERE exam_version_id = $1 ORDER BY sequence_order`, [saber.id])).rows.map((r) => r.id);
  const student = '00000000-0000-4000-8000-000000000001';
  const lines: string[] = [];
  const orig = console.log;
  console.log = (...a: unknown[]) => {
    if (a[0] === '[blueprint_v2_shadow]') lines.push(String(a[1]));
    else orig(...a);
  };
  process.env.EXAM_BLUEPRINT_V2 = 'OFF';
  const off = await formInputs(saber.id, components, student, [], 'MOCK', 'STUDENT', { instanceId: null });
  const offLines = lines.length;
  process.env.EXAM_BLUEPRINT_V2 = 'SHADOW';
  const shadow = await formInputs(saber.id, components, student, [], 'MOCK', 'STUDENT', { instanceId: null });
  process.env.EXAM_BLUEPRINT_V2 = 'OFF';
  console.log = orig;
  const ser = (x: unknown) => JSON.stringify(x, (_k, v) => (v instanceof Set ? [...v] : v instanceof Map ? [...v] : v));
  const dims = (p: { constraints?: Array<{ dimension: string }> }) => (p.constraints ?? []).map((c) => c.dimension).sort().join(',');
  check('runtime: 50 positions, each constrained by COMPETENCE + CONTENT_CATEGORY + MARKS', off.positions.length === 50 && off.positions.every((p) => dims(p) === 'COMPETENCE,CONTENT_CATEGORY,MARKS'), `${off.positions.length} ${[...new Set(off.positions.map(dims))].join(' | ')}`);
  check('runtime: legacy use = FULL_MOCK (50 >= official 50)', off.use === 'FULL_MOCK', off.use);
  check('runtime: OFF and SHADOW inputs identical', ser(off) === ser(shadow));
  check('runtime: OFF emits no shadow record', offLines === 0);
  const rec = lines.length === 1 ? JSON.parse(lines[0]) : null;
  check('runtime: SHADOW emits exactly one record', lines.length === 1, `${lines.length}`);
  check('runtime: record MATCH on the Saber FULL_MOCK variant', rec?.parity_status === 'MATCH' && rec?.v2_blueprint_identity === 'v2.saber11.math|icfes-saber11-math@2026|FULL_MOCK|ENTIRE_ASSESSMENT|standard', `${rec?.parity_status} ${rec?.v2_blueprint_identity}`);
  check('runtime: frozen-context dry run OK', !!rec?.reasons?.includes('FROZEN_DRY_RUN_OK'));
  check('runtime: record carries no student id', !!rec && !JSON.stringify(rec).includes(student));

  // 3. QB certification can target the exact structural variant.
  const catalog = bp.buildShadowCatalog([SABER11_MATH_V2]);
  const res = bp.resolveBlueprint(catalog, bp.contextForQbCertification({ examVersionId: saber.id, examDefinitionKey: 'v2.saber11.math', specificationKey: 'icfes-saber11-math@2026', purpose: 'FULL_MOCK', scope: { type: 'ENTIRE_ASSESSMENT' }, variantKey: 'standard' }));
  check('QB certification targets one exact variant', res.status === 'EXACT_MATCH' && res.contentReadiness.status === 'NOT_EVALUATED', res.status);

  await db.end?.();
  const fp = createHash('sha256').update(`${url.hostname}|${url.pathname.slice(1)}`).digest('hex').slice(0, 16);
  console.log(JSON.stringify({ database: fp, checks }, null, 2));
  process.exit(checks.every((c) => c.ok) ? 0 : 1);
})().catch((e) => {
  console.error('CERT_ERROR', e instanceof Error ? e.message : e);
  process.exit(1);
});
