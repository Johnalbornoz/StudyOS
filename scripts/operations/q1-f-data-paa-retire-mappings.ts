/**
 * Q1 / F-DATA -- retires exactly the five PAA objective -> concept mappings
 * that the Q1-C.1 certified catalogue replaces. `applyObjectiveLearningLinks`
 * only ever adds mappings, so the links removed from
 * `objective-learning-links.ts` stay PUBLISHED until this step retires them.
 * Nothing is deleted: the rows keep their history with status RETIRED.
 *
 * This is a one-purpose step, not a cleanup tool: the list below is closed,
 * every code is a PAA objective, and the run aborts unless it finds exactly
 * the expected rows (or finds them all already retired).
 *
 * Run AFTER track-b-v2-learning-catalog.ts --write: every objective touched
 * here must already have its replacement mapping published.
 *
 * DEV only (DB fingerprint guard). Dry-run by default; --write commits.
 *   npx tsx --env-file=.env.neon-dev scripts/operations/q1-f-data-paa-retire-mappings.ts [--write]
 */
import { createHash } from 'crypto';
import { Client } from 'pg';

const DEV_DB_FINGERPRINT = '2a29b99ee14a22b4';

/** objective code -> the concept that no longer belongs to it, and the concept that replaces it there. */
export const RETIRED_PAA_LINKS: Array<{ code: string; subject: string; concept: string; replacedBy: string; reason: string }> = [
  { code: 'paa.red.adicion', subject: 'Redacción', concept: 'Economía del lenguaje', replacedBy: 'Adición: ampliación estilística', reason: 'Adición is the opposite operation of Elisión; it has its own concept' },
  { code: 'paa.red.integracion', subject: 'Redacción', concept: 'Síntesis y generalización', replacedBy: 'Integración: síntesis global', reason: 'Integración has its own concept; this one stays with Generalización' },
  { code: 'paa.red.particularizacion', subject: 'Redacción', concept: 'Cohesión y conectores', replacedBy: 'Particularización: expresión indirecta', reason: 'Cohesión y conectores has no official PAA Domain; Particularización has its own concept' },
  { code: 'paa.lect.literario', subject: 'Lectura crítica', concept: 'Análisis literario', replacedBy: 'Figuras retóricas y lenguaje figurado', reason: 'Domain-level label replaced by four literary concepts' },
  { code: 'paa.ing.redaccion', subject: 'English', concept: 'English sentence structure', replacedBy: 'English paragraph organization and coherence', reason: 'Sentence structure belongs to Uso del lenguaje (paa.ing.lenguaje)' },
];
const EXPECTED_ROWS = 5;

const PAIR_SQL = `
  SELECT m.id, m.status, m.learning_objective_id
    FROM objective_concept_mappings m
    JOIN learning_objectives lo ON lo.id = m.learning_objective_id
    JOIN canonical_concepts cc ON cc.id = m.canonical_concept_id
    JOIN canonical_subjects cs ON cs.id = cc.canonical_subject_id
   WHERE lo.code = $1 AND cs.name = $2 AND cc.name = $3 AND m.status = ANY($4::text[])`;

async function main() {
  const write = process.argv.includes('--write');
  const url = new URL(process.env.DATABASE_URL ?? '');
  const fp = createHash('sha256').update(`${url.hostname}|${url.pathname.slice(1)}`).digest('hex').slice(0, 16);
  if (fp !== DEV_DB_FINGERPRINT) throw new Error(`Refusing: DB fingerprint ${fp} is not DEV ${DEV_DB_FINGERPRINT}`);
  if (RETIRED_PAA_LINKS.some((l) => !l.code.startsWith('paa.'))) throw new Error('Refusing: a non-PAA objective code is listed');

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const ledger: Array<Record<string, unknown>> = [];
  const problems: string[] = [];
  let alreadyRetired = 0;
  let committed = false;
  try {
    await client.query('BEGIN');
    const before = Number((await client.query(`SELECT count(*) FROM objective_concept_mappings WHERE status = 'PUBLISHED'`)).rows[0].count);
    for (const link of RETIRED_PAA_LINKS) {
      const published = (await client.query(PAIR_SQL, [link.code, link.subject, link.concept, ['PUBLISHED']])).rows;
      if (published.length === 0) {
        const retired = (await client.query(PAIR_SQL, [link.code, link.subject, link.concept, ['RETIRED']])).rows;
        if (retired.length === 1) alreadyRetired += 1;
        else problems.push(`${link.code} -> ${link.concept}: expected 1 PUBLISHED row, found 0 (and ${retired.length} RETIRED)`);
        continue;
      }
      if (published.length !== 1) {
        problems.push(`${link.code} -> ${link.concept}: expected 1 PUBLISHED row, found ${published.length}`);
        continue;
      }
      const row = published[0];
      // Precondition: the certified replacement is already published on the same objective.
      const replacement = (await client.query(PAIR_SQL.replace('lo.code = $1', 'm.learning_objective_id = $1'), [row.learning_objective_id, link.subject, link.replacedBy, ['PUBLISHED']])).rows;
      if (replacement.length !== 1) {
        problems.push(`${link.code}: replacement "${link.replacedBy}" is not published on this objective -- run track-b-v2-learning-catalog.ts --write first`);
        continue;
      }
      const updated = await client.query(`UPDATE objective_concept_mappings SET status = 'RETIRED' WHERE id = $1 AND status = 'PUBLISHED'`, [row.id]);
      if (updated.rowCount !== 1) {
        problems.push(`${link.code} -> ${link.concept}: update touched ${updated.rowCount} rows`);
        continue;
      }
      ledger.push({ table: 'objective_concept_mappings', id: row.id, objective: link.code, concept: `${link.subject}/${link.concept}`, old: 'PUBLISHED', new: 'RETIRED', replacedBy: link.replacedBy, reason: link.reason, rollback: `UPDATE objective_concept_mappings SET status = 'PUBLISHED' WHERE id = '${row.id}'` });
    }
    const after = Number((await client.query(`SELECT count(*) FROM objective_concept_mappings WHERE status = 'PUBLISHED'`)).rows[0].count);
    if (ledger.length + alreadyRetired !== EXPECTED_ROWS) problems.push(`expected ${EXPECTED_ROWS} rows in scope, found ${ledger.length} to retire and ${alreadyRetired} already retired`);
    if (before - after !== ledger.length) problems.push(`published mappings changed by ${before - after}, expected ${ledger.length}`);
    if (write && problems.length === 0) {
      await client.query('COMMIT');
      committed = true;
    } else {
      await client.query('ROLLBACK');
    }
    console.log(JSON.stringify({ db: fp, mode: committed ? 'APPLIED' : problems.length ? 'ABORTED (rolled back)' : 'DRY_RUN (rolled back)', expected: EXPECTED_ROWS, retired: ledger.length, alreadyRetired, publishedBefore: before, publishedAfter: after, problems, ledger }, null, 2));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
  if (problems.length) process.exit(2);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
