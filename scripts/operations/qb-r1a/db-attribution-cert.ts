/**
 * QB-R1C -- the DATABASE rule: an approving review needs the item version's explicit PRIMARY attribution
 * (migration 20261112_1000). Every statement here is a direct INSERT, so nothing but the trigger decides.
 * EPHEMERAL Postgres only; one transaction, rolled back. Fixture people, fixture items, fixture grants.
 */
import { Client } from 'pg';

const checks: string[] = [];
function check(label: string, ok: boolean, detail?: unknown) {
  if (!ok) throw new Error(`QB-R1C FAIL [${label}] ${detail === undefined ? '' : JSON.stringify(detail)}`);
  checks.push(label);
}

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (url.hostname !== '127.0.0.1') throw new Error('Refusing: not an ephemeral local database');
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const one = async (sql: string, params: unknown[] = []) => (await c.query(sql, params)).rows[0];
  let n = 0;
  /** Runs a statement in a savepoint and returns the database's own refusal, or ACCEPTED (and undoes it either way unless `keep`). */
  const attempt = async (sql: string, params: unknown[], keep = false): Promise<string> => {
    const name = `s${(n += 1)}`;
    await c.query(`SAVEPOINT ${name}`);
    const out = await c.query(sql, params).then(() => 'ACCEPTED', (e) => String(e.message).split(':')[0]);
    if (out !== 'ACCEPTED' || !keep) await c.query(`ROLLBACK TO SAVEPOINT ${name}`);
    return out;
  };
  try {
    await c.query('BEGIN');
    const user = async (clerk: string, system = false) => (await one(`INSERT INTO users (clerk_id, is_system) VALUES ($1, $2) RETURNING id`, [clerk, system])).id as string;
    const [qualified, unqualified, grantor, system, humanAuthor] = [await user('r1c:qualified'), await user('r1c:unqualified'), await user('r1c:grantor'), await user('r1c:system', true), await user('r1c:author')];
    const subjectId = async (name: string) => (await one(`SELECT id FROM canonical_subjects WHERE name = $1`, [name])).id as string;
    const conceptId = async (subject: string, name: string) => (await one(`SELECT cc.id FROM canonical_concepts cc JOIN canonical_subjects cs ON cs.id = cc.canonical_subject_id WHERE cs.name = $1 AND cc.name = $2 AND cc.status = 'ACTIVE'`, [subject, name])).id as string;
    const [lectura, matematicas, redaccion] = [await subjectId('Lectura crítica'), await subjectId('Matemáticas'), await subjectId('Redacción')];
    const grant = (userId: string, subject: string, family: string) => c.query(`INSERT INTO question_bank_reviewer_qualifications (user_id, canonical_subject_id, exam_family, granted_by, valid_from) VALUES ($1, $2, $3, $4, now() - interval '1 hour')`, [userId, subject, family, grantor]);
    const item = async (key: string, objectiveCode: string, configKey: string, author: string) => {
      const ctx = await one(`SELECT lo.id AS objective, ev.id AS exam_version FROM learning_objectives lo JOIN structure_nodes n ON n.id = lo.structure_node_id JOIN structure_versions sv ON sv.id = n.structure_version_id JOIN exam_definitions ed ON ed.config_key = $2 JOIN exam_versions ev ON ev.exam_definition_id = ed.id WHERE lo.code = $1 AND sv.source_locator = 'exam-vertical-config:' || $2 LIMIT 1`, [objectiveCode, configKey]);
      const id = (await one(`INSERT INTO question_bank_items (item_key, exam_version_id, learning_objective_id, provenance, language) VALUES ($1, $2, $3, 'STUDYUS_GENERATED', 'es') RETURNING id`, [key, ctx.exam_version, ctx.objective])).id as string;
      const version = (await one(`INSERT INTO approved_items (learning_objective_id, question_type, content, created_by, status, content_origin, bank_item_id, version_number, bank_lifecycle_status, content_hash) VALUES ($1, 'multiple_choice', '{"stem":"r1c"}', $2, 'PUBLISHED', 'GENERATED', $3, 1, 'PILOT', md5($4)) RETURNING id`, [ctx.objective, author, id, key])).id as string;
      return { id, version, objective: ctx.objective as string };
    };
    const APPROVE = `INSERT INTO question_bank_reviews (approved_item_id, bank_item_id, decision, reviewed_by) VALUES ($1, $2, 'APPROVED', $3)`;
    const primary = (version: string, concept: string) => c.query(`INSERT INTO question_bank_item_concepts (approved_item_id, canonical_concept_id, role, attributed_by) VALUES ($1, $2, 'PRIMARY', $3)`, [version, concept, qualified]);

    /* ---- PAA: the objective maps to concepts; the version has no PRIMARY ---- */
    await grant(qualified, lectura, 'PAA');
    const paa = await item('r1c.paa', 'paa.lect.evidencia', 'v2.paa', system);
    const mapped = (await one(`SELECT count(*)::int AS n FROM objective_concept_mappings WHERE learning_objective_id = $1 AND status = 'PUBLISHED'`, [paa.objective])).n as number;
    check('PAA: the objective has published concept mappings in the reviewer\'s subject', mapped > 0, mapped);
    check('PAA: without an explicit PRIMARY, a reviewer QUALIFIED in the objective\'s subject is refused', (await attempt(APPROVE, [paa.version, paa.id, qualified])) === 'QUESTION_BANK_PRIMARY_ATTRIBUTION_REQUIRED');
    check('PAA: the same refusal for an unqualified reviewer -- attribution is decided before qualification', (await attempt(APPROVE, [paa.version, paa.id, unqualified])) === 'QUESTION_BANK_PRIMARY_ATTRIBUTION_REQUIRED');
    check('PAA: a SUPPORTING concept alone is not a PRIMARY', (await (async () => { await c.query('SAVEPOINT sup'); await c.query(`INSERT INTO question_bank_item_concepts (approved_item_id, canonical_concept_id, role, attributed_by) VALUES ($1, $2, 'SUPPORTING', $3)`, [paa.version, await conceptId('Lectura crítica', 'Evidencia textual'), qualified]); const r = await attempt(APPROVE, [paa.version, paa.id, qualified]); await c.query('ROLLBACK TO SAVEPOINT sup'); return r; })()) === 'QUESTION_BANK_PRIMARY_ATTRIBUTION_REQUIRED');
    check('PAA: a context tag is not a PRIMARY', (await (async () => { await c.query('SAVEPOINT tag'); await c.query(`INSERT INTO question_bank_item_context_tags (approved_item_id, canonical_concept_id, tagged_by) VALUES ($1, $2, $3)`, [paa.version, await conceptId('Lectura crítica', 'Evidencia textual'), qualified]); const r = await attempt(APPROVE, [paa.version, paa.id, qualified]); await c.query('ROLLBACK TO SAVEPOINT tag'); return r; })()) === 'QUESTION_BANK_PRIMARY_ATTRIBUTION_REQUIRED');
    check('a non-approving decision needs neither attribution nor qualification', (await attempt(`INSERT INTO question_bank_reviews (approved_item_id, bank_item_id, decision, reviewed_by, review_notes) VALUES ($1, $2, 'CORRECTION_REQUESTED', $3, 'Aclarar el enunciado.')`, [paa.version, paa.id, unqualified])) === 'ACCEPTED');

    await primary(paa.version, await conceptId('Lectura crítica', 'Evidencia textual'));
    check('PAA: once attributed, qualification is what decides: an unqualified reviewer is refused', (await attempt(APPROVE, [paa.version, paa.id, unqualified])) === 'QUESTION_BANK_REVIEWER_NOT_QUALIFIED');
    check('a system account is refused', (await attempt(APPROVE, [paa.version, paa.id, system])) === 'QUESTION_BANK_REVIEWER_IS_SYSTEM_ACCOUNT');
    const stamped = await one(`INSERT INTO question_bank_reviews (approved_item_id, bank_item_id, decision, reviewed_by) VALUES ($1, $2, 'APPROVED', $3) RETURNING reviewer_qualification_id`, [paa.version, paa.id, qualified]);
    check('PAA: attributed + qualified in the PRIMARY concept\'s subject and the exam family: accepted and stamped', !!stamped.reviewer_qualification_id);
    const own = await item('r1c.own', 'paa.lect.evidencia', 'v2.paa', qualified);
    await c.query(`INSERT INTO question_bank_item_concepts (approved_item_id, canonical_concept_id, role, attributed_by) VALUES ($1, $2, 'PRIMARY', $3)`, [own.version, await conceptId('Lectura crítica', 'Evidencia textual'), humanAuthor]);
    check('an author cannot approve their own version, qualified or not', (await attempt(APPROVE, [own.version, own.id, qualified])) === 'QUESTION_BANK_REVIEW_AUTHOR_CANNOT_APPROVE');

    /* ---- the objective's subject is never the scope ---- */
    // Objective mapped to Lectura crítica; the reviewer attributes a Redacción concept as PRIMARY. The scope is Redacción.
    const cross = await item('r1c.cross', 'paa.lect.evidencia', 'v2.paa', system);
    await primary(cross.version, await conceptId('Redacción', 'Economía del lenguaje'));
    check('a reviewer qualified only in the OBJECTIVE\'s subject cannot approve an item whose PRIMARY is in another subject', (await attempt(APPROVE, [cross.version, cross.id, qualified])) === 'QUESTION_BANK_REVIEWER_NOT_QUALIFIED');
    await grant(unqualified, redaccion, 'PAA');
    check('the reviewer qualified in the PRIMARY concept\'s subject can', (await attempt(APPROVE, [cross.version, cross.id, unqualified])) === 'ACCEPTED');
    await grant(humanAuthor, redaccion, 'ICFES');
    check('the same subject in another exam family does not qualify', (await attempt(APPROVE, [cross.version, cross.id, humanAuthor])) === 'QUESTION_BANK_REVIEWER_NOT_QUALIFIED');

    /* ---- Saber: objective -> competency, no concept mapping, no PRIMARY ---- */
    const saber = await item('r1c.saber', 'saber.formulacion', 'v2.saber11.math', system);
    const facts = await one(`SELECT (SELECT count(*) FROM objective_competency_mappings WHERE learning_objective_id = $1 AND status = 'PUBLISHED')::int AS competencies, (SELECT count(*) FROM objective_concept_mappings WHERE learning_objective_id = $1)::int AS concepts`, [saber.objective]);
    check('Saber: the objective is mapped to its competency and to no concept', facts.competencies === 1 && facts.concepts === 0, facts);
    await grant(qualified, matematicas, 'ICFES');
    check('Saber: with the competency mapping and no PRIMARY, a reviewer holding Matemáticas x ICFES is refused', (await attempt(APPROVE, [saber.version, saber.id, qualified])) === 'QUESTION_BANK_PRIMARY_ATTRIBUTION_REQUIRED');
    await primary(saber.version, await conceptId('Matemáticas', 'Proporcionalidad'));
    check('Saber: after exactly one PRIMARY concept is set, an unqualified reviewer is refused for qualification', (await attempt(APPROVE, [saber.version, saber.id, unqualified])) === 'QUESTION_BANK_REVIEWER_NOT_QUALIFIED');
    check('Saber: and the reviewer holding Matemáticas x ICFES passes the authority rule', (await attempt(APPROVE, [saber.version, saber.id, qualified])) === 'ACCEPTED');
    check('Saber: Matemáticas x PAA alone would not have been enough', (await (async () => { const other = await user('r1c:paa-math'); await grant(other, matematicas, 'PAA'); return attempt(APPROVE, [saber.version, saber.id, other]); })()) === 'QUESTION_BANK_REVIEWER_NOT_QUALIFIED');

    /* ---- nothing else changed ---- */
    check('objective -> concept mappings still serve the curriculum: untouched by the rule', (await one(`SELECT count(*)::int AS n FROM objective_concept_mappings WHERE learning_objective_id = $1 AND status = 'PUBLISHED'`, [paa.objective])).n === mapped);
    const fn = (await one(`SELECT pg_get_functiondef(p.oid) AS def FROM pg_proc p WHERE proname = 'question_bank_review_authority_guard'`)).def as string;
    check('the trigger function reads no objective mapping, no competency and no curriculum subject', !/objective_concept_mappings|objective_competency_mappings|competenc|academic_subjects|structure_/.test(fn));
    console.log(`QB_R1C_DB_ATTRIBUTION_BEFORE_APPROVAL = ${checks.length} PASS`);
  } finally {
    await c.query('ROLLBACK').catch(() => undefined);
    await c.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
