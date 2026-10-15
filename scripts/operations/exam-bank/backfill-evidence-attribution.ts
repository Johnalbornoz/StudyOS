/**
 * F7 -- deterministic backfill of the SYSTEM attribution of Exam Readiness evidence written before attribution existed.
 *
 * A row with no system_id gets the family of the exam definition of its own exam version (exam_versions ->
 * exam_definitions.exam_family): the same rule the recorder applies to every new row. Nothing is inferred from items,
 * concepts or Students; a row whose version has no definition family stays NULL and is reported. Only system_id is
 * written, only where it is NULL.
 *
 *   DRY RUN (default)   counts, then ROLLBACK.   --apply   the same, then COMMIT.
 *
 *   EXAM_BANK_PUBLICATION_FP=<fp> npx tsx --env-file=<dev or candidate env> scripts/operations/exam-bank/backfill-evidence-attribution.ts [--apply]
 *
 * Authorised targets: DEV and the pilot candidate's own database. Never the frozen Preview database, Stage or Production.
 * It calls no provider and prints no credentials.
 */
import { createHash } from 'crypto';

const AUTHORISED_TARGETS: Readonly<Record<string, string>> = { '2a29b99ee14a22b4': 'DEV', '4baac799b9bd2a6a': 'PILOT_CANDIDATE_20261015' };

async function main(): Promise<number> {
  const apply = process.argv.includes('--apply');
  const url = new URL(process.env.DATABASE_URL ?? '');
  const fp = createHash('sha256').update(url.hostname + '|' + url.pathname.slice(1)).digest('hex').slice(0, 16);
  const target = AUTHORISED_TARGETS[fp];
  if (!target || process.env.EXAM_BANK_PUBLICATION_FP !== fp) { console.error(`REFUSING: database ${fp} is not an authorised target, or EXAM_BANK_PUBLICATION_FP does not name it.`); return 2; }
  const { db } = await import('@/lib/db');
  const client = await (db as any).connect();
  try {
    await client.query('BEGIN');
    const count = async () => (await client.query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE system_id IS NULL)::int AS unattributed FROM exam_readiness_evidence`)).rows[0];
    const before = await count();
    const upd = await client.query(
      `UPDATE exam_readiness_evidence e SET system_id = d.exam_family
         FROM exam_versions v JOIN exam_definitions d ON d.id = v.exam_definition_id
        WHERE e.system_id IS NULL AND v.id = e.exam_version_id AND d.exam_family IS NOT NULL`);
    const after = await count();
    const left = (await client.query(`SELECT exam_version_id, count(*)::int AS n FROM exam_readiness_evidence WHERE system_id IS NULL GROUP BY 1`)).rows;
    const bySystem = (await client.query(`SELECT system_id, count(*)::int AS n FROM exam_readiness_evidence GROUP BY 1 ORDER BY 1`)).rows;
    console.log(JSON.stringify({ target, fp, mode: apply ? 'APPLY' : 'DRY_RUN', before, updated: upd.rowCount, after, unresolvable: left, bySystem }, null, 2));
    await client.query(apply ? 'COMMIT' : 'ROLLBACK');
    return 0;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error(e instanceof Error ? e.message : String(e));
    return 1;
  } finally { client.release(); await (db as any).end?.(); }
}
main().then((c) => process.exit(c));
