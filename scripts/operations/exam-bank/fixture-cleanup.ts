/**
 * Exam Bank runtime scenarios -- removes a fixture Student (`ebr-<run>` only) and every row that belongs to them.
 * DEV only. Rows are found through the foreign keys themselves (up to three levels below a `student_id`), so an
 * exam attempt's responses, plans and usage go with it. Certified Exam Bank rows are never touched: none carries
 * a Student.
 */
import type { Pool } from 'pg';

export async function cleanupFixtureStudent(db: Pick<Pool, 'query'>, studentId: string, userId: string): Promise<number> {
  const guard = (await db.query(`SELECT 1 FROM students WHERE id = $1 AND clerk_id LIKE 'ebr-%' AND email LIKE '%@exam-bank.test'`, [studentId])).rows.length;
  if (!guard) throw new Error('REFUSING: not an exam-bank fixture Student');
  const tablesWith = async (name: string) => (await db.query(`SELECT c.table_name FROM information_schema.columns c JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE' WHERE c.table_schema = 'public' AND c.column_name = $1`, [name])).rows.map((r: any) => r.table_name as string);
  const byStudent = (await tablesWith('student_id')).filter((t) => t !== 'students');
  const fks = (await db.query(
    `SELECT con.conrelid::regclass::text AS child, att.attname AS col, con.confrelid::regclass::text AS parent, patt.attname AS parent_key
       FROM pg_constraint con JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1] JOIN pg_attribute patt ON patt.attrelid = con.confrelid AND patt.attnum = con.confkey[1]
      WHERE con.contype = 'f' AND array_length(con.conkey, 1) = 1 AND con.connamespace = 'public'::regnamespace`)).rows as Array<{ child: string; col: string; parent: string; parent_key: string }>;
  // what belongs to the Student: a table with student_id, or (up to three levels) a table that points at such a row
  const owned = new Map<string, string>(byStudent.map((t) => [t, `SELECT * FROM ${t} WHERE student_id::text = $1`]));
  const deletes: string[] = [];
  let frontier = [...owned.keys()];
  for (let depth = 0; depth < 3; depth += 1) {
    const next: string[] = [];
    for (const k of fks) {
      if (!frontier.includes(k.parent) || owned.has(k.child) || k.child === 'students' || k.child === 'users') continue;
      owned.set(k.child, `SELECT * FROM ${k.child} WHERE ${k.col} IN (SELECT ${k.parent_key} FROM (${owned.get(k.parent)}) p)`);
      next.push(k.child);
    }
    frontier = next;
  }
  for (const [table, select] of [...owned.entries()].reverse()) deletes.push(`DELETE FROM ${table} WHERE ctid IN (SELECT ctid FROM (${select.replace('SELECT *', 'SELECT ctid, *')}) x)`);
  const attempt = async (sql: string, params: unknown[]) => db.query(sql, params).then(() => true, () => false);
  const concepts = (await db.query(`SELECT c.id FROM concepts c JOIN subjects s ON s.id = c.subject_id WHERE s.student_id = $1`, [studentId])).rows.map((r: any) => r.id as string);
  const byConcept = await tablesWith('concept_id');
  for (let pass = 0; pass < 12; pass += 1) {
    let blocked = 0;
    for (const sql of deletes) if (!(await attempt(sql, [studentId]))) blocked += 1;
    for (const t of byConcept) if (!(await attempt(`DELETE FROM ${t} WHERE concept_id::text = ANY($1::text[])`, [concepts]))) blocked += 1;
    for (const sql of [
      `DELETE FROM concept_catalog_mapping_candidates WHERE mapping_id IN (SELECT id FROM concept_catalog_mapping WHERE learner_concept_id::text = ANY($1::text[]))`,
      `DELETE FROM concept_catalog_mapping WHERE learner_concept_id::text = ANY($1::text[])`,
      `DELETE FROM learner_concept_curriculum_provenance WHERE learner_concept_id::text = ANY($1::text[])`,
      `DELETE FROM concept_localizations WHERE concept_id::text = ANY($1::text[])`,
      `DELETE FROM concepts WHERE id::text = ANY($1::text[])`,
    ]) if (!(await attempt(sql, [concepts]))) blocked += 1;
    for (const sql of [`DELETE FROM student_profiles WHERE id = $1`, `DELETE FROM profiles WHERE id = $1`, `DELETE FROM students WHERE id = $1`]) if (!(await attempt(sql, [studentId]))) blocked += 1;
    for (const sql of [`DELETE FROM admin_audit_log WHERE actor_user_id = $1 OR target_id = $1::text`, `DELETE FROM user_roles WHERE user_id = $1`, `DELETE FROM users WHERE id = $1 AND is_system IS NOT TRUE`]) if (!(await attempt(sql, [userId]))) blocked += 1;
    if (blocked === 0) break;
  }
  const left = await db.query(
    `SELECT (SELECT count(*) FROM students WHERE id = $1) + (SELECT count(*) FROM subjects WHERE student_id = $1) + (SELECT count(*) FROM simulation_attempts WHERE student_id = $1) + (SELECT count(*) FROM exam_instances WHERE student_id = $1)
          + (SELECT count(*) FROM exam_item_usage WHERE student_id = $1) + (SELECT count(*) FROM learning_evidence WHERE student_id = $1) + (SELECT count(*) FROM users WHERE id = $2) AS n`, [studentId, userId]);
  return Number(left.rows[0].n);
}
