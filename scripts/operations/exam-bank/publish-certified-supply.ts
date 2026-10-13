/**
 * TRACK B -- publish the certified Exam Bank supply (QF V5.2) into a database.
 *
 * The one controlled way certification artefacts become runtime Exam Bank rows. See
 * src/lib/exam-bank/publication.service.ts for what is written and under which guarantees.
 *
 *   DRY RUN (default)   every statement runs against the database's own guards, then ROLLBACK. Nothing is kept.
 *   --apply             the same, then COMMIT.
 *   --out <file>        also write the report as JSON.
 *
 * WHERE IT MAY RUN. The target is named twice and both must agree with the connection:
 *   EXAM_BANK_PUBLICATION_FP=<fingerprint of host|database>     must equal the fingerprint of DATABASE_URL
 *   and the fingerprint must be one this script authorises: the DEV database, the Track B Preview candidate's own
 *   database, or a throwaway Postgres on 127.0.0.1 / localhost. The shared Preview database (the fallback's), Stage
 *   and Production are not authorised; promoting anywhere else is a separate, deliberate change to AUTHORISED_TARGETS.
 *
 *   EXAM_BANK_PUBLICATION_FP=2a29b99ee14a22b4 npx tsx --env-file=<dev env> scripts/operations/exam-bank/publish-certified-supply.ts [--apply]
 *
 * It calls no provider and reads no Student data.
 */
import { createHash } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
/** Databases this script may write to, by fingerprint. A throwaway local Postgres is authorised by its host. */
const AUTHORISED_TARGETS: Readonly<Record<string, string>> = {
  '2a29b99ee14a22b4': 'DEV',
  // Authorised 2026-10-13: the Track B Preview candidate's OWN database (neondb_trackb_exam), a clone of the Preview
  // database. The database of the known-good fallback (f1436f7) is a different one and is not a target.
  '4c249c68e0627b9f': 'PREVIEW_TRACK_B',
};
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
/** The artefacts the publication is computed from, pinned. A changed artefact is a different publication: it stops here. */
const EXPECTED = {
  policyVersion: 'HUMAN50_POLICY_V1',
  policyHash: '445c7793e7e79a648f2372e508a0c3192037b3bfe52df4fd77915cf0cdcc0e3b',
  // the 11 recorded human approvals are hashed against this file's content
  pilotSliceSha256: '9a82d9d6f41607ebd614d3048a49a90e73c113e7e45ca7d090134b4b70a6ff5a',
  humanDecisionsSha256: 'a3645609fedb981c4f2923b336e8ff1bc0a6797c58e14c8569d73b47290b364f',
  humanDecisions: 11,
} as const;
const PILOT_SLICE = 'src/lib/assessment-instance/pilot/step4b-pilot-slice.ts';
const HUMAN_DECISIONS = 'docs/exams/question-factory/step4b/STEP4B_CERTIFICATION_RECORDS.json';
const sha256File = (rel: string): string => createHash('sha256').update(readFileSync(join(ROOT, rel))).digest('hex');

async function main(): Promise<number> {
  const apply = process.argv.includes('--apply');
  const outAt = process.argv.indexOf('--out');
  const out = outAt > 0 ? process.argv[outAt + 1] : null;
  const url = new URL(process.env.DATABASE_URL ?? '');
  const fp = createHash('sha256').update(url.hostname + '|' + url.pathname.slice(1)).digest('hex').slice(0, 16);
  const target = AUTHORISED_TARGETS[fp] ?? (LOCAL_HOSTS.has(url.hostname) ? 'THROWAWAY' : null);
  if (!target || process.env.EXAM_BANK_PUBLICATION_FP !== fp) {
    console.error(`REFUSING: database ${fp} (${url.hostname}) is not an authorised target of this script, or EXAM_BANK_PUBLICATION_FP does not name it.`);
    return 2;
  }

  // ---- artefact pre-flight: before any connection is used
  const artefacts: string[] = [];
  if (sha256File(PILOT_SLICE) !== EXPECTED.pilotSliceSha256) artefacts.push('STEP4B_PILOT_SLICE_CHANGED');
  if (sha256File(HUMAN_DECISIONS) !== EXPECTED.humanDecisionsSha256) artefacts.push('STEP4B_HUMAN_DECISIONS_FILE_CHANGED');
  const { HUMAN50_POLICY_HASH, HUMAN50_POLICY_VERSION } = await import('@/lib/assessment-instance/v52');
  if (HUMAN50_POLICY_VERSION !== EXPECTED.policyVersion || HUMAN50_POLICY_HASH !== EXPECTED.policyHash) artefacts.push('CERTIFICATION_POLICY_IS_NOT_THE_EXPECTED_ONE');
  const human = JSON.parse(readFileSync(join(ROOT, HUMAN_DECISIONS), 'utf8'));
  if (human.kind !== 'STEP4B_CERTIFICATION_RECORDS' || !Array.isArray(human.records) || human.records.length !== EXPECTED.humanDecisions) artefacts.push('STEP4B_HUMAN_DECISIONS_ARE_NOT_THE_ELEVEN_RECORDED');
  if (artefacts.length > 0) { console.error(`REFUSING (artefacts): ${artefacts.join(', ')}`); return 3; }

  const { buildPublicationPlan, planCounts } = await import('@/lib/exam-bank/publication-plan');
  const { runPublication, PublicationConflict, PublicationRefused } = await import('@/lib/exam-bank/publication.service');
  const plan = buildPublicationPlan(human, 'PILOT_PREVIEW');
  console.log(`exam bank publication -- target ${target} db ${fp} -- ${apply ? 'APPLY' : 'DRY RUN'} -- plan ${plan.planHash.slice(0, 16)}`);
  console.log('PLAN', JSON.stringify(planCounts(plan)));
  if (plan.preflight.length > 0) { console.error(`REFUSING (plan pre-flight): ${plan.preflight.join(', ')}`); return 3; }

  const { db } = await import('@/lib/db');
  const client = await db.connect();
  try {
    const report = await runPublication(client, plan, { apply });
    const written = Object.entries(report.inserted).filter(([, n]) => n !== 0);
    console.log(`${report.mode} ${report.committed ? 'COMMITTED' : 'ROLLED BACK (nothing kept)'}`);
    console.log(`ROWS ${apply ? 'WRITTEN' : 'THAT WOULD BE WRITTEN'} = ${report.insertedTotal}`);
    for (const [t, n] of written) console.log(`  ${t} ${n}`);
    console.log('SKIPPED (already present, identical)', JSON.stringify(report.skipped));
    console.log('MATERIALIZED', JSON.stringify(report.materialized));
    const blocked: Record<string, number> = {};
    for (const b of report.blocked) blocked[`${b.kind}:${b.reason}`] = (blocked[`${b.kind}:${b.reason}`] ?? 0) + 1;
    console.log('BLOCKED', JSON.stringify(blocked));
    console.log('CONFLICTS', report.conflicts.length);
    console.log('VERIFICATION', JSON.stringify(report.verification));
    if (out) writeFileSync(out, `${JSON.stringify({ target, fingerprint: fp, ...report }, null, 2)}\n`);
    // The catalogue's readiness is a stored bank-health snapshot, never recomputed on a Student request: it is
    // refreshed here, after a committed publication, for every exam version that now holds certified rows.
    if (report.committed) {
      // The snapshot is computed in the delivery scope of the environment being published to (DEV and a throwaway
      // database are pilot environments). A deployment reads it with its own EXAM_BANK_DELIVERY_SCOPE: one that is
      // not told it is a pilot still delivers none of this supply, whatever the snapshot says.
      process.env.EXAM_BANK_DELIVERY_SCOPE = plan.scope;
      const { refreshVersionHealth } = await import('@/lib/exam-core/question-bank/health.service');
      const versions = (await db.query(`SELECT DISTINCT exam_version_id FROM question_bank_items WHERE lineage_class = 'CORE_DERIVED' AND exam_version_id IS NOT NULL ORDER BY 1`)).rows.map((r: { exam_version_id: string }) => r.exam_version_id);
      for (const v of versions) {
        const h = await refreshVersionHealth(v);
        console.log(`BANK HEALTH SNAPSHOT (scope ${plan.scope}) ${v}: ${(h?.health.components ?? []).map((x) => `${x.sectionKey} practice=${x.practice} reduced=${x.reducedAssembles} full=${x.fullAssembles}`).join('; ')}`);
      }
    }
    return 0;
  } catch (error) {
    if (error instanceof PublicationConflict) console.error(`CONFLICT (nothing written): ${error.message}`);
    else if (error instanceof PublicationRefused) console.error(`REFUSED (nothing written): ${error.reasons.join('; ')}`);
    else console.error(`FAILED (nothing written): ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  } finally {
    client.release();
    await db.end();
  }
}

main().then((code) => process.exit(code), (e) => { console.error(e); process.exit(1); });
