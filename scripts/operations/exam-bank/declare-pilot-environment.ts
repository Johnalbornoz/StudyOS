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
const TARGETS: Readonly<Record<string, string>> = { '2a29b99ee14a22b4': 'DEV', '4c249c68e0627b9f': 'PREVIEW_TRACK_B' };
async function main(): Promise<number> {
  const url = new URL(process.env.DATABASE_URL ?? '');
  const fp = createHash('sha256').update(url.hostname + '|' + url.pathname.slice(1)).digest('hex').slice(0, 16);
  if (!TARGETS[fp] || process.env.EXAM_BANK_PUBLICATION_FP !== fp) { console.error(`REFUSING: database ${fp} may not be declared a pilot environment.`); return 2; }
  const { db } = await import('@/lib/db');
  try {
    const r = await db.query(`INSERT INTO exam_bank_pilot_environment (scope, database_fingerprint, declared_by, basis) VALUES ('PILOT_PREVIEW', $1, 'operations/exam-bank/declare-pilot-environment', $2) ON CONFLICT (singleton) DO NOTHING RETURNING declared_at`, [fp, `${TARGETS[fp]}: authorised pilot database of the PAA pilot (operator instruction 2026-10-13).`]);
    const row = (await db.query(`SELECT scope, database_fingerprint, declared_at FROM exam_bank_pilot_environment`)).rows[0];
    console.log(`${r.rowCount ? 'DECLARED' : 'ALREADY DECLARED'} ${TARGETS[fp]} ${JSON.stringify(row)}; deliverable pilot versions now: ${(await db.query(`SELECT count(*)::int AS n FROM exam_bank_pilot_deliverable_versions`)).rows[0].n}`);
    return row.database_fingerprint === fp ? 0 : 1;
  } finally { await db.end(); }
}
main().then((c) => process.exit(c), (e) => { console.error(e); process.exit(1); });
