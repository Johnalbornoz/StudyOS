/**
 * Curriculum convergence -- re-run the catalogue resolution of every UNRESOLVED Student concept, after the
 * catalogue gained concepts or reviewed aliases (operator step).
 *
 * The resolver is the application's own (`reresolveUnresolvedCatalogMapping`): canonical name or reviewed alias
 * of the same-named canonical subject, nothing else. A concept that resolves also gets its curriculum lineage
 * recorded, from an academic subject the Student explicitly has that maps the canonical concept
 * (`deriveCurriculumProvenance`); with none, no lineage is written.
 *
 * Written: `concept_catalog_mapping` rows that were UNRESOLVED and resolve (status, canonical concept, method,
 * alias), one candidate row each, and one `learner_concept_curriculum_provenance` row where a lineage exists.
 * NOT written: students, subjects, concepts, labels, evidence, mastery, plan entries -- verified by hash.
 *
 * Dry run by default (one transaction, rolled back); --write commits. Ephemeral -> DEV -> Preview. Never Production.
 *   CURRICULUM_CONVERGENCE_FP=<fp> npx tsx --env-file=<env> scripts/operations/curriculum-reresolve-student-concepts.ts [--write]
 */
import { createHash } from 'crypto';

for (const k of Object.keys(process.env)) if (/(ANTHROPIC|OPENAI|GEMINI|GOOGLE_GENERATIVE|AI_GATEWAY)/i.test(k)) delete process.env[k];

const DEV = '2a29b99ee14a22b4';
const PREVIEW = '53d158d5811e7ee0';

async function main() {
  const write = process.argv.includes('--write');
  const url = new URL(process.env.DATABASE_URL ?? '');
  const fp = createHash('sha256').update(`${url.hostname}|${url.pathname.slice(1)}`).digest('hex').slice(0, 16);
  if (url.hostname !== '127.0.0.1' && !((fp === DEV || fp === PREVIEW) && process.env.CURRICULUM_CONVERGENCE_FP === fp)) throw new Error(`REFUSING: database ${fp}`);

  const { db } = await import('@/lib/db');
  const { reresolveUnresolvedCatalogMapping } = await import('@/lib/catalog/mapping.service');
  const { deriveCurriculumProvenance, recordCurriculumProvenance } = await import('@/lib/learning-plan/curriculum-provenance.service');

  const client = await db.connect();
  const problems: string[] = [];
  let committed = false;
  try {
    await client.query('BEGIN');
    const untouched = async () => (await client.query(
      `SELECT md5(COALESCE(string_agg(t, '|' ORDER BY t), '')) AS h FROM (
         SELECT 'st' || id::text || COALESCE(user_id::text, '') AS t FROM students
         UNION ALL SELECT 'su' || id::text || student_id::text || name || status FROM subjects
         UNION ALL SELECT 'co' || id::text || subject_id::text || canonical_id || COALESCE(subtopic_id::text, '') FROM concepts
         UNION ALL SELECT 'cl' || concept_id::text || language || label FROM concept_localizations
         UNION ALL SELECT 'mr' || student_id::text || concept_id::text || mastery_score::text || attempt_count::text FROM mastery_records
         UNION ALL SELECT 'pe' || id::text || plan_status FROM student_plan_entries
         UNION ALL SELECT 'cm' || id::text || status || COALESCE(canonical_concept_id::text, '') FROM concept_catalog_mapping WHERE status <> 'UNRESOLVED'
         UNION ALL SELECT 'sa' || student_id::text || academic_subject_id::text || COALESCE(ended_at::text, '') FROM student_academic_subjects) x`
    )).rows[0].h as string;
    const before = await untouched();
    const rows = (await client.query(
      `SELECT m.learner_concept_id, s.student_id, s.name AS subject_name FROM concept_catalog_mapping m JOIN concepts c ON c.id = m.learner_concept_id JOIN subjects s ON s.id = c.subject_id
        WHERE m.status = 'UNRESOLVED' ORDER BY m.created_at, m.id`
    )).rows as Array<{ learner_concept_id: string; student_id: string; subject_name: string }>;
    const ledger: Array<Record<string, unknown>> = [];
    for (const row of rows) {
      await client.query('SAVEPOINT one');
      try {
        const r = await reresolveUnresolvedCatalogMapping(row.learner_concept_id, client);
        let lineage: Awaited<ReturnType<typeof deriveCurriculumProvenance>> = null;
        let lineageRecorded = false;
        if (r.changed && r.resolution?.status === 'MATCHED') {
          lineage = await deriveCurriculumProvenance(row.student_id, r.resolution.canonicalConceptId);
          if (lineage) lineageRecorded = await recordCurriculumProvenance(client, row.learner_concept_id, r.resolution.canonicalConceptId, lineage, null);
        }
        await client.query('RELEASE SAVEPOINT one');
        ledger.push({ learnerConceptId: row.learner_concept_id, studentId: row.student_id, subject: row.subject_name, before: r.before, after: r.after, method: r.resolution?.method ?? null, aliasId: r.resolution?.aliasId ?? null, canonicalConceptId: r.resolution?.canonicalConceptId ?? null, outcome: r.changed ? 'RESOLVED' : r.resolution?.status === 'AMBIGUOUS' ? 'AMBIGUOUS_LEFT_UNRESOLVED' : 'PERSONAL_UNMAPPED', lineage, lineageRecorded });
      } catch (e) {
        await client.query('ROLLBACK TO SAVEPOINT one');
        problems.push(`${row.learner_concept_id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    const resolved = ledger.filter((l) => l.outcome === 'RESOLVED');
    const after = await untouched();
    // the rows that were already resolved, and everything else of every Student, are exactly as before
    const nowMatched = (await client.query(`SELECT md5(COALESCE(string_agg('cm' || id::text || status || COALESCE(canonical_concept_id::text, ''), '|' ORDER BY id), '')) AS h, count(*)::int AS n FROM concept_catalog_mapping WHERE learner_concept_id = ANY($1::uuid[])`, [resolved.map((l) => l.learnerConceptId)])).rows[0];
    if (resolved.length === 0 && before !== after) problems.push('UNEXPECTED_CHANGE outside the unresolved mappings');
    if (resolved.length > 0) {
      const afterWithout = (await client.query(
        `SELECT md5(COALESCE(string_agg(t, '|' ORDER BY t), '')) AS h FROM (
           SELECT 'st' || id::text || COALESCE(user_id::text, '') AS t FROM students
           UNION ALL SELECT 'su' || id::text || student_id::text || name || status FROM subjects
           UNION ALL SELECT 'co' || id::text || subject_id::text || canonical_id || COALESCE(subtopic_id::text, '') FROM concepts
           UNION ALL SELECT 'cl' || concept_id::text || language || label FROM concept_localizations
           UNION ALL SELECT 'mr' || student_id::text || concept_id::text || mastery_score::text || attempt_count::text FROM mastery_records
           UNION ALL SELECT 'pe' || id::text || plan_status FROM student_plan_entries
           UNION ALL SELECT 'cm' || id::text || status || COALESCE(canonical_concept_id::text, '') FROM concept_catalog_mapping WHERE status <> 'UNRESOLVED' AND NOT (learner_concept_id = ANY($1::uuid[]))
           UNION ALL SELECT 'sa' || student_id::text || academic_subject_id::text || COALESCE(ended_at::text, '') FROM student_academic_subjects) x`,
        [resolved.map((l) => l.learnerConceptId)]
      )).rows[0].h as string;
      if (afterWithout !== before) problems.push('UNEXPECTED_CHANGE outside the resolved mappings');
      if (nowMatched.n !== resolved.length) problems.push('resolved rows not found');
    }
    const unresolvedAfter = Number((await client.query(`SELECT count(*)::int AS n FROM concept_catalog_mapping WHERE status = 'UNRESOLVED'`)).rows[0].n);
    if (write && problems.length === 0) {
      await client.query('COMMIT');
      committed = true;
    } else await client.query('ROLLBACK');
    console.log(JSON.stringify({ db: fp, mode: committed ? 'APPLIED' : problems.length ? 'ABORTED (rolled back)' : 'DRY_RUN (rolled back)', unresolvedBefore: rows.length, resolved: resolved.length, unresolvedAfter, ledger, problems }, null, 1));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await db.end();
  }
  if (problems.length) process.exit(2);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
