/**
 * Curriculum-first scenarios -- removes a fixture Student (`cfl-<run>` only) and every row that belongs to it.
 * DEV only. Used by curriculum-first-learning-scenarios.ts; runnable alone to clear a fixture a failed run left.
 *   CURRICULUM_CONVERGENCE_FP=2a29b99ee14a22b4 npx tsx --env-file=<dev env> scripts/operations/curriculum-first-fixture-cleanup.ts
 */
import { createHash } from 'crypto';
import type { Pool } from 'pg';

const DEV = '2a29b99ee14a22b4';

export async function removeFixtureStudent(db: Pick<Pool, 'query'>, studentId: string): Promise<number> {
  const guard = (await db.query(`SELECT 1 FROM students WHERE id = $1 AND clerk_id LIKE 'cfl-%' AND email LIKE '%@curriculum-first.test'`, [studentId])).rows.length;
  if (!guard) throw new Error('REFUSING: not a curriculum-first fixture Student');
  const col = async (name: string) => (await db.query(`SELECT c.table_name FROM information_schema.columns c JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE' WHERE c.table_schema = 'public' AND c.column_name = $1`, [name])).rows.map((r: any) => r.table_name as string);
  const byStudent = (await col('student_id')).filter((t) => t !== 'students');
  const byConcept = await col('concept_id');
  const bySession = [...(await col('quiz_session_id')), ...(await col('session_id'))];
  const concepts = (await db.query(`SELECT c.id FROM concepts c JOIN subjects s ON s.id = c.subject_id WHERE s.student_id = $1`, [studentId])).rows.map((r: any) => r.id as string);
  const sessions = (await db.query(`SELECT id FROM quiz_sessions WHERE student_id = $1`, [studentId])).rows.map((r: any) => r.id as string);
  // rows that belong to the Student only through a parent row (validation_events -> validation_cycles, ...)
  const children = (await db.query(
    `SELECT con.conrelid::regclass::text AS child, att.attname AS col, con.confrelid::regclass::text AS parent, patt.attname AS parent_key
       FROM pg_constraint con
       JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
       JOIN pg_attribute patt ON patt.attrelid = con.confrelid AND patt.attnum = con.confkey[1]
      WHERE con.contype = 'f' AND array_length(con.conkey, 1) = 1`
  )).rows.filter((r: any) => byStudent.includes(r.parent) && !byStudent.includes(r.child)) as Array<{ child: string; col: string; parent: string; parent_key: string }>;
  const attempt = async (sql: string, params: unknown[]) => db.query(sql, params).then(() => true, () => false);
  for (let pass = 0; pass < 10; pass++) {
    let blocked = 0;
    for (const k of children) if (!(await attempt(`DELETE FROM ${k.child} WHERE ${k.col} IN (SELECT ${k.parent_key} FROM ${k.parent} WHERE student_id::text = $1)`, [studentId]))) blocked += 1;
    for (const t of bySession) if (!(await attempt(`DELETE FROM ${t} WHERE ${t === 'quiz_responses' || bySession.indexOf(t) < (await col('quiz_session_id')).length ? 'quiz_session_id' : 'session_id'}::text = ANY($1::text[])`, [sessions]))) blocked += 1;
    for (const t of byConcept) if (!(await attempt(`DELETE FROM ${t} WHERE concept_id::text = ANY($1::text[])`, [concepts]))) blocked += 1;
    for (const t of byStudent) if (!(await attempt(`DELETE FROM ${t} WHERE student_id::text = $1`, [studentId]))) blocked += 1;
    for (const sql of [
      `DELETE FROM concept_catalog_mapping_candidates WHERE mapping_id IN (SELECT id FROM concept_catalog_mapping WHERE learner_concept_id::text = ANY($1::text[]))`,
      `DELETE FROM concept_catalog_mapping WHERE learner_concept_id::text = ANY($1::text[])`,
      `DELETE FROM learner_concept_curriculum_provenance WHERE learner_concept_id::text = ANY($1::text[])`,
      `DELETE FROM concept_localizations WHERE concept_id::text = ANY($1::text[])`,
      `DELETE FROM concepts WHERE id::text = ANY($1::text[])`,
    ]) if (!(await attempt(sql, [concepts]))) blocked += 1;
    for (const sql of [`DELETE FROM student_profiles WHERE id = $1`, `DELETE FROM profiles WHERE id = $1`, `DELETE FROM students WHERE id = $1`]) if (!(await attempt(sql, [studentId]))) blocked += 1;
    if (blocked === 0) break;
  }
  return Number((await db.query(`SELECT (SELECT count(*) FROM students WHERE id = $1) + (SELECT count(*) FROM subjects WHERE student_id = $1) + (SELECT count(*) FROM quiz_sessions WHERE student_id = $1) + (SELECT count(*) FROM question_bank_candidates WHERE student_id = $1) + (SELECT count(*) FROM learning_evidence WHERE student_id = $1) AS n`, [studentId])).rows[0].n);
}

async function main() {
  const u = new URL(process.env.DATABASE_URL ?? '');
  const fp = createHash('sha256').update(u.hostname + '|' + u.pathname.slice(1)).digest('hex').slice(0, 16);
  if (fp !== DEV || process.env.CURRICULUM_CONVERGENCE_FP !== fp) throw new Error(`REFUSING: database ${fp} (DEV only)`);
  const { db } = await import('@/lib/db');
  const fixtures = (await db.query(`SELECT id FROM students WHERE clerk_id LIKE 'cfl-%' AND email LIKE '%@curriculum-first.test'`)).rows.map((r: any) => r.id as string);
  for (const id of fixtures) console.log(`fixture ${id}: remaining rows ${await removeFixtureStudent(db, id)}`);
  console.log(`fixtures removed: ${fixtures.length}`);
  await db.end();
}

if (process.argv[1]?.endsWith('curriculum-first-fixture-cleanup.ts')) main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
