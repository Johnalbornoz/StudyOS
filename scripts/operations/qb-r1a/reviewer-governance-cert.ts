/**
 * QB-R1A -- reviewer governance on an EPHEMERAL Postgres: the grant contract and the approval path.
 * One transaction, rolled back. Refuses any host other than 127.0.0.1. Uses fixture people and a fixture item;
 * it grants nothing outside this transaction and approves no real candidate.
 */
import { Client } from 'pg';
import { grantRefusals, grantReviewerQualification, listReviewerQualifications, requireReviewerQualification, resolveReviewScope, revokeReviewerQualification, ReviewerQualificationError } from '@/lib/exam-core/question-bank/reviewer-qualification.service';

const checks: string[] = [];
function check(label: string, ok: boolean, detail?: unknown) {
  if (!ok) throw new Error(`QB-R1A FAIL [${label}] ${detail === undefined ? '' : JSON.stringify(detail)}`);
  checks.push(label);
}
const refusal = async (fn: () => Promise<unknown>): Promise<string> => fn().then(() => 'ACCEPTED', (e) => (e instanceof ReviewerQualificationError ? e.code : `OTHER:${e.message}`));

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (url.hostname !== '127.0.0.1') throw new Error('Refusing: not an ephemeral local database');
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const one = async (sql: string, params: unknown[] = []) => (await c.query(sql, params)).rows[0];
  const x = c as never;
  try {
    await c.query('BEGIN');
    const user = async (clerk: string, system = false, status = 'ACTIVE') => (await one(`INSERT INTO users (clerk_id, is_system, status) VALUES ($1, $2, $3) RETURNING id`, [clerk, system, status])).id as string;
    const [reviewer, other, grantor, plainAdmin, system, suspended] = [await user('r1a:reviewer'), await user('r1a:other'), await user('r1a:grantor'), await user('r1a:no-role'), await user('r1a:system', true), await user('r1a:suspended', false, 'SUSPENDED')];
    await c.query(`INSERT INTO user_roles (user_id, role, status, granted_via) VALUES ($1, 'STUDYUS_ADMIN', 'ACTIVE', 'INVITATION'), ($2, 'STUDYUS_ADMIN', 'ACTIVE', 'INVITATION')`, [grantor, reviewer]);

    // The PAA candidates' shape: a generated item on a mapped PAA objective, authored by a system account.
    const ctx = await one(
      `SELECT qi.exam_version_id, lo.id AS objective, cc.canonical_subject_id AS subject, ed.exam_family
         FROM learning_objectives lo JOIN objective_concept_mappings m ON m.learning_objective_id = lo.id AND m.status = 'PUBLISHED' JOIN canonical_concepts cc ON cc.id = m.canonical_concept_id
         JOIN question_bank_items qi ON qi.learning_objective_id = lo.id JOIN exam_versions ev ON ev.id = qi.exam_version_id JOIN exam_definitions ed ON ed.id = ev.exam_definition_id
        WHERE lo.code = 'paa.lect.evidencia' AND ed.config_key = 'v2.paa' LIMIT 1`
    );
    const saber = await one(`SELECT lo.id AS objective, qi.exam_version_id FROM learning_objectives lo JOIN question_bank_items qi ON qi.learning_objective_id = lo.id WHERE lo.code = 'saber.formulacion' LIMIT 1`);
    const otherSubject = (await one(`SELECT id FROM canonical_subjects WHERE id <> $1 AND status = 'ACTIVE' AND id NOT IN (SELECT cc.canonical_subject_id FROM objective_concept_mappings m JOIN canonical_concepts cc ON cc.id = m.canonical_concept_id WHERE m.learning_objective_id = $2) ORDER BY name LIMIT 1`, [ctx.subject, ctx.objective])).id;
    const item = async (key: string, objective: string, examVersion: string, author: string) => {
      const id = (await one(`INSERT INTO question_bank_items (item_key, exam_version_id, learning_objective_id, provenance, language) VALUES ($1, $2, $3, 'STUDYUS_GENERATED', 'es') RETURNING id`, [key, examVersion, objective])).id;
      const version = (await one(`INSERT INTO approved_items (learning_objective_id, question_type, content, created_by, status, content_origin, bank_item_id, version_number, bank_lifecycle_status, content_hash) VALUES ($1, 'multiple_choice', '{"stem":"r1a"}', $2, 'PUBLISHED', 'GENERATED', $3, 1, 'PILOT', md5($4)) RETURNING id`, [objective, author, id, key])).id as string;
      return { id, version };
    };
    const paa = await item('r1a.paa', ctx.objective, ctx.exam_version_id, system);
    // A minute ago: inside one transaction the database clock is the transaction's start, earlier than this process's clock.
    const now = new Date(Date.now() - 60_000).toISOString();
    const grant = (over: Record<string, unknown> = {}) => ({ reviewerUserId: reviewer, canonicalSubjectId: ctx.subject as string, examFamily: ctx.exam_family as string, grantedByUserId: grantor, validFrom: now, ...over });

    /* ---- scope ---- */
    const scope = await resolveReviewScope(x, paa.version);
    check('the scope of a PAA item is its exam family and the canonical subject of its objective mapping', scope?.examFamily === 'PAA' && scope.canonicalSubjectIds.includes(ctx.subject) && scope.basis === 'OBJECTIVE_MAPPING', scope);
    if (saber) {
      const s = await item('r1a.saber', saber.objective, saber.exam_version_id, system);
      const sc = await resolveReviewScope(x, s.version);
      check('a Saber item has an exam family and no canonical subject', sc?.examFamily === 'ICFES' && sc.canonicalSubjectIds.length === 0 && sc.basis === 'NONE', sc);
      await grantReviewerQualification(x, grant({ reviewerUserId: other, examFamily: 'ICFES' }));
      check('it cannot be approved by anyone, whatever they hold: REVIEW_SCOPE_UNDETERMINED', (await refusal(() => requireReviewerQualification(x, { approvedItemId: s.version, reviewerUserId: other }))) === 'REVIEW_SCOPE_UNDETERMINED');
    }

    /* ---- locked by default ---- */
    check('with no grant, a person cannot approve', (await refusal(() => requireReviewerQualification(x, { approvedItemId: paa.version, reviewerUserId: reviewer }))) === 'REVIEWER_NOT_QUALIFIED');
    check('a platform administrator has no qualification by role', (await refusal(() => requireReviewerQualification(x, { approvedItemId: paa.version, reviewerUserId: grantor }))) === 'REVIEWER_NOT_QUALIFIED');
    check('a system account is refused before anything else', (await refusal(() => requireReviewerQualification(x, { approvedItemId: paa.version, reviewerUserId: system }))) === 'REVIEWER_IS_SYSTEM_ACCOUNT');
    const sp = async (name: string, fn: () => Promise<unknown>) => { await c.query(`SAVEPOINT ${name}`); const r = await fn().then(() => 'ACCEPTED', (e) => String(e.message)); await c.query(`ROLLBACK TO SAVEPOINT ${name}`); return r; };
    check('the database refuses the same approval on its own', (await sp('a', () => c.query(`INSERT INTO question_bank_reviews (approved_item_id, bank_item_id, decision, reviewed_by) VALUES ($1, $2, 'APPROVED', $3)`, [paa.version, paa.id, reviewer]))).includes('QUESTION_BANK_REVIEWER_NOT_QUALIFIED'));

    /* ---- grant contract ---- */
    const refused = async (over: Record<string, unknown>) => (await grantRefusals(x, grant(over))).join(',');
    check('no wildcard subject', (await refused({ canonicalSubjectId: 'ALL' })) === 'WILDCARD_NOT_ALLOWED' && (await refused({ canonicalSubjectId: '*' })) === 'WILDCARD_NOT_ALLOWED');
    check('no wildcard exam family', (await refused({ examFamily: 'ALL_EXAMS' })) === 'WILDCARD_NOT_ALLOWED');
    check('an exam family the catalogue does not have is refused', (await refused({ examFamily: 'PAAA' })) === 'EXAM_FAMILY_NOT_FOUND');
    check('an unknown subject is refused', (await refused({ canonicalSubjectId: '00000000-0000-4000-8000-000000000000' })) === 'SUBJECT_NOT_FOUND');
    check('a system account cannot be granted', (await refused({ reviewerUserId: system })) === 'REVIEWER_IS_SYSTEM_ACCOUNT');
    check('an inactive person cannot be granted', (await refused({ reviewerUserId: suspended })) === 'REVIEWER_NOT_ACTIVE');
    check('a system account cannot grant', (await refused({ grantedByUserId: system })) === 'GRANTOR_IS_SYSTEM_ACCOUNT');
    check('a person without the grant authority cannot grant', (await refused({ grantedByUserId: plainAdmin })) === 'GRANTOR_NOT_AUTHORIZED');
    check('nobody grants themselves, even holding the authority', (await refused({ grantedByUserId: reviewer })) === 'SELF_GRANT');
    check('validity must make sense', (await refused({ validFrom: 'soon' })) === 'VALIDITY_INVALID' && (await refused({ validTo: '2000-01-01T00:00:00Z' })) === 'VALIDITY_INVALID');
    check('a valid grant has no refusal', (await refused({})) === '');
    check('grantReviewerQualification refuses what grantRefusals refuses', (await refusal(() => grantReviewerQualification(x, grant({ grantedByUserId: plainAdmin })))) === 'GRANTOR_NOT_AUTHORIZED');

    /* ---- explicit, narrow, not inferred ---- */
    await grantReviewerQualification(x, grant({ canonicalSubjectId: otherSubject }));
    check('a qualification in another subject does not qualify for this one', (await refusal(() => requireReviewerQualification(x, { approvedItemId: paa.version, reviewerUserId: reviewer }))) === 'REVIEWER_NOT_QUALIFIED');
    const otherFamily = (await one(`SELECT exam_family FROM exam_definitions WHERE exam_family <> $1 ORDER BY 1 LIMIT 1`, [ctx.exam_family])).exam_family;
    await grantReviewerQualification(x, grant({ examFamily: otherFamily }));
    check('the same subject in another exam family does not qualify for this one', (await refusal(() => requireReviewerQualification(x, { approvedItemId: paa.version, reviewerUserId: reviewer }))) === 'REVIEWER_NOT_QUALIFIED');
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const { qualificationId: later } = await grantReviewerQualification(x, grant({ validFrom: future }));
    check('a grant that starts tomorrow does not qualify today', (await refusal(() => requireReviewerQualification(x, { approvedItemId: paa.version, reviewerUserId: reviewer }))) === 'REVIEWER_NOT_QUALIFIED');
    await revokeReviewerQualification(x, { qualificationId: later, revokedByUserId: grantor, reason: 'superseded by an immediate grant' });

    const { qualificationId } = await grantReviewerQualification(x, grant());
    const held = await requireReviewerQualification(x, { approvedItemId: paa.version, reviewerUserId: reviewer });
    check('the explicit grant for this subject and family qualifies', held.qualificationId === qualificationId && held.examFamily === 'PAA' && held.canonicalSubjectId === ctx.subject, held);
    check('the same grant twice is refused', (await refused({})) === 'QUALIFICATION_ALREADY_HELD');
    check('it qualifies nobody else', (await refusal(() => requireReviewerQualification(x, { approvedItemId: paa.version, reviewerUserId: other }))) === 'REVIEWER_NOT_QUALIFIED');
    const approved = await one(`INSERT INTO question_bank_reviews (approved_item_id, bank_item_id, decision, reviewed_by) VALUES ($1, $2, 'APPROVED', $3) RETURNING reviewer_qualification_id`, [paa.version, paa.id, reviewer]);
    check('the database accepts the approval and stamps that qualification', approved.reviewer_qualification_id === qualificationId);
    const own = await item('r1a.own', ctx.objective, ctx.exam_version_id, reviewer);
    check('a qualified reviewer still cannot approve their own item', (await sp('b', () => c.query(`INSERT INTO question_bank_reviews (approved_item_id, bank_item_id, decision, reviewed_by) VALUES ($1, $2, 'APPROVED', $3)`, [own.version, own.id, reviewer]))).includes('QUESTION_BANK_REVIEW_AUTHOR_CANNOT_APPROVE'));

    /* ---- revoke ---- */
    check('a revocation needs a reason', (await refusal(() => revokeReviewerQualification(x, { qualificationId, revokedByUserId: grantor, reason: '' }))) === 'REVOKE_REASON_REQUIRED');
    check('only the grant authority revokes', (await refusal(() => revokeReviewerQualification(x, { qualificationId, revokedByUserId: plainAdmin, reason: 'no authority here' }))) === 'GRANTOR_NOT_AUTHORIZED');
    await revokeReviewerQualification(x, { qualificationId, revokedByUserId: grantor, reason: 'end of engagement' });
    check('after revocation the reviewer is not qualified', (await refusal(() => requireReviewerQualification(x, { approvedItemId: paa.version, reviewerUserId: reviewer }))) === 'REVIEWER_NOT_QUALIFIED');
    check('a revoked qualification is not revoked twice', (await refusal(() => revokeReviewerQualification(x, { qualificationId, revokedByUserId: grantor, reason: 'again, by mistake' }))) === 'QUALIFICATION_ALREADY_REVOKED');
    const list = await listReviewerQualifications(x);
    check('the list shows every grant and which are in force', list.length >= 4 && list.some((q) => q.id === qualificationId && !q.inForce && q.revokedAt !== null));
    check('no system account holds a qualification', (await one(`SELECT count(*)::int AS n FROM question_bank_reviewer_qualifications q JOIN users u ON u.id = q.user_id WHERE u.is_system`)).n === 0);
    console.log(`QB_R1A_REVIEWER_GOVERNANCE = ${checks.length} PASS`);
  } finally {
    await c.query('ROLLBACK').catch(() => undefined);
    await c.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
