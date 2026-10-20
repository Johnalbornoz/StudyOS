/**
 * TRACK B -- declare a database a PILOT environment for the Exam Bank (migration 20261124_1200).
 *
 * Without this declaration a database accepts no automated pilot certification, activates no PILOT_CERTIFIED version
 * and delivers none. It is a deliberate operator step, allowed ONLY on the databases named here: DEV and the Track B
 * Preview candidate's own database. Never the shared Preview database, Stage or Production.
 *
 *   EXAM_BANK_PUBLICATION_FP=<fp> npx tsx --env-file=<env> scripts/operations/exam-bank/declare-pilot-environment.ts
 */
import { createHash } from 'crypto';
const TARGETS: Readonly<Record<string, string>> = { '2a29b99ee14a22b4': 'DEV', '4c249c68e0627b9f': 'PREVIEW_TRACK_B', '4baac799b9bd2a6a': 'PILOT_CANDIDATE_20261015' };
/**
 * A CLONE inherits its source's declaration row. `--redeclare-clone` rewrites that one row for the clone only: the
 * database must be a clone named here, the inherited row must carry exactly its source's fingerprint, and the source
 * itself is never written. Item and certification provenance is not touched.
 */
const CLONES: Readonly<Record<string, string>> = { '4baac799b9bd2a6a': '4c249c68e0627b9f' };
async function main(): Promise<number> {
  const url = new URL(process.env.DATABASE_URL ?? '');
  const fp = createHash('sha256').update(url.hostname + '|' + url.pathname.slice(1)).digest('hex').slice(0, 16);
  if (!TARGETS[fp] || process.env.EXAM_BANK_PUBLICATION_FP !== fp) { console.error(`REFUSING: database ${fp} may not be declared a pilot environment.`); return 2; }
  const { db } = await import('@/lib/db');
  if (process.argv.includes('--redeclare-clone')) {
    const source = CLONES[fp];
    if (!source || source === fp) { console.error(`REFUSING: ${fp} is not a declared clone`); await db.end(); return 2; }
    try {
      const r = await db.query(
        `UPDATE exam_bank_pilot_environment SET database_fingerprint = $1, declared_by = 'operations/exam-bank/declare-pilot-environment --redeclare-clone', basis = $3, declared_at = now()
          WHERE scope = 'PILOT_PREVIEW' AND database_fingerprint = $2 RETURNING scope, database_fingerprint, declared_at`,
        [fp, source, `${TARGETS[fp]}: clone redeclared; CLONED_FROM_FINGERPRINT=${source}; CANDIDATE_FINGERPRINT=${fp}`]);
      const row = (await db.query(`SELECT scope, database_fingerprint, basis, declared_at FROM exam_bank_pilot_environment`)).rows[0];
      console.log(`${r.rowCount ? 'REDECLARED' : 'NOT REDECLARED'} ${TARGETS[fp]} ${JSON.stringify(row)}; deliverable pilot versions now: ${(await db.query(`SELECT count(*)::int AS n FROM exam_bank_pilot_deliverable_versions`)).rows[0].n}`);
      return row?.database_fingerprint === fp ? 0 : 1;
    } finally { await db.end(); }
  }
  try {
    const r = await db.query(`INSERT INTO exam_bank_pilot_environment (scope, database_fingerprint, declared_by, basis) VALUES ('PILOT_PREVIEW', $1, 'operations/exam-bank/declare-pilot-environment', $2) ON CONFLICT (singleton) DO NOTHING RETURNING declared_at`, [fp, `${TARGETS[fp]}: authorised pilot database of the PAA pilot (operator instruction 2026-10-13).`]);
    const row = (await db.query(`SELECT scope, database_fingerprint, declared_at FROM exam_bank_pilot_environment`)).rows[0];
    console.log(`${r.rowCount ? 'DECLARED' : 'ALREADY DECLARED'} ${TARGETS[fp]} ${JSON.stringify(row)}; deliverable pilot versions now: ${(await db.query(`SELECT count(*)::int AS n FROM exam_bank_pilot_deliverable_versions`)).rows[0].n}`);
    return row.database_fingerprint === fp ? 0 : 1;
  } finally { await db.end(); }
}
main().then((c) => process.exit(c), (e) => { console.error(e); process.exit(1); });
