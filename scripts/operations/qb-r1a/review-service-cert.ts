/**
 * QB-R1A -- `reviewVersion` (the path the admin route and the operator scripts use) under reviewer governance,
 * on an EPHEMERAL Postgres. Args: <qualified reviewer id> <administrator without qualification id> <system account id>.
 * Writes a fixture item and one review on the ephemeral database only.
 */
import { db } from '@/lib/db';
import { reviewVersion } from '@/lib/exam-core/question-bank/review.service';
import { ReviewerQualificationError } from '@/lib/exam-core/question-bank/reviewer-qualification.service';
import { setItemAttribution } from '@/lib/exam-core/question-bank/item-attribution.service';

const [reviewer, admin, system] = process.argv.slice(2);
const checks: string[] = [];
function check(label: string, ok: boolean, detail?: unknown) {
  if (!ok) throw new Error(`QB-R1A SERVICE FAIL [${label}] ${detail === undefined ? '' : JSON.stringify(detail)}`);
  checks.push(label);
}

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (url.hostname !== '127.0.0.1') throw new Error('Refusing: not an ephemeral local database');
  const ctx = (await db.query(`SELECT qi.exam_version_id, lo.id AS objective FROM learning_objectives lo JOIN question_bank_items qi ON qi.learning_objective_id = lo.id JOIN exam_versions ev ON ev.id = qi.exam_version_id JOIN exam_definitions ed ON ed.id = ev.exam_definition_id WHERE lo.code = 'paa.lect.evidencia' AND ed.config_key = 'v2.paa' LIMIT 1`)).rows[0];
  // The author is another system account (the generation pipeline), so the self-review rule is not what refuses the approvals below.
  const author = (await db.query(`SELECT id FROM users WHERE clerk_id = 'system:cert-editor'`)).rows[0].id as string;
  const item = (await db.query(`INSERT INTO question_bank_items (item_key, exam_version_id, learning_objective_id, provenance, language) VALUES ('r1a.service', $1, $2, 'STUDYUS_GENERATED', 'es') RETURNING id`, [ctx.exam_version_id, ctx.objective])).rows[0].id;
  const content = { key: 'r1a.service', type: 'multiple_choice', question: '¿Qué afirma el texto?', options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }, { id: 'c', text: 'C' }, { id: 'd', text: 'D' }], correctAnswer: 'a', explanation: 'Porque sí.', difficulty: 3, marks: 1 };
  const version = (await db.query(`INSERT INTO approved_items (learning_objective_id, question_type, content, created_by, status, content_origin, bank_item_id, version_number, bank_lifecycle_status, content_hash, validation_report) VALUES ($1, 'multiple_choice', $2, $3, 'PUBLISHED', 'GENERATED', $4, 1, 'PILOT', md5('r1a.service'), '{"outcome":"PASS"}') RETURNING id`, [ctx.objective, JSON.stringify(content), author, item])).rows[0].id as string;
  await db.query(`UPDATE question_bank_items SET current_version_id = $1 WHERE id = $2`, [version, item]);
  const approve = (reviewerUserId: string) => reviewVersion({ versionId: version, reviewerUserId, input: { decision: 'APPROVED', notes: null, validatedDifficulty: 3, usage: ['PRACTICE'], alignment: 'EXAM_STYLE' } as never });
  const code = (p: Promise<unknown>) => p.then(() => 'ACCEPTED', (e) => (e instanceof ReviewerQualificationError ? e.code : `OTHER:${(e as Error).message}`));
  const reviews = async () => (await db.query(`SELECT count(*)::int AS n FROM question_bank_reviews WHERE approved_item_id = $1`, [version])).rows[0].n as number;

  check('a system account is refused by name', (await code(approve(system))) === 'REVIEWER_IS_SYSTEM_ACCOUNT');
  check('an unattributed item is refused even for the qualified reviewer: attribution comes first', (await code(approve(reviewer))) === 'PRIMARY_ATTRIBUTION_REQUIRED');
  // The qualified reviewer establishes what the item is about, through the governed writer.
  const concept = (await db.query(`SELECT cc.id FROM canonical_concepts cc JOIN canonical_subjects cs ON cs.id = cc.canonical_subject_id WHERE cs.name = 'Lectura crítica' AND cc.name = 'Evidencia textual' AND cc.status = 'ACTIVE'`)).rows[0].id as string;
  const attribute = async (approvedItemId: string) => {
    const tx = await db.connect();
    try {
      await tx.query('BEGIN');
      await setItemAttribution(tx, { approvedItemId, reviewerUserId: reviewer, primaryConceptId: concept, reason: 'cert: the question asks for the evidence that supports a claim' });
      await tx.query('COMMIT');
    } catch (e) {
      await tx.query('ROLLBACK');
      throw e;
    } finally {
      tx.release();
    }
  };
  await attribute(version);
  check('an administrator without a qualification is refused by name', (await code(approve(admin))) === 'REVIEWER_NOT_QUALIFIED');
  check('a refused approval writes no review and leaves the item under review', (await reviews()) === 0 && (await db.query(`SELECT bank_lifecycle_status AS s FROM approved_items WHERE id = $1`, [version])).rows[0].s === 'PILOT');
  const rejected = await reviewVersion({ versionId: version, reviewerUserId: admin, input: { decision: 'CORRECTION_REQUESTED', notes: 'Aclarar el enunciado.', validatedDifficulty: null, usage: null, alignment: null } as never }).then(() => 'ACCEPTED', (e) => String((e as Error).message));
  check('a non-approving decision does not need a qualification', rejected === 'ACCEPTED', rejected);
  // the correction request moved the version; a fresh version is used for the governed approval
  const item2 = (await db.query(`INSERT INTO question_bank_items (item_key, exam_version_id, learning_objective_id, provenance, language) VALUES ('r1a.service.2', $1, $2, 'STUDYUS_GENERATED', 'es') RETURNING id`, [ctx.exam_version_id, ctx.objective])).rows[0].id;
  const version2 = (await db.query(`INSERT INTO approved_items (learning_objective_id, question_type, content, created_by, status, content_origin, bank_item_id, version_number, bank_lifecycle_status, content_hash, validation_report) VALUES ($1, 'multiple_choice', $2, $3, 'PUBLISHED', 'GENERATED', $4, 1, 'PILOT', md5('r1a.service.2'), '{"outcome":"PASS"}') RETURNING id`, [ctx.objective, JSON.stringify({ ...content, key: 'r1a.service.2' }), author, item2])).rows[0].id as string;
  await db.query(`UPDATE question_bank_items SET current_version_id = $1 WHERE id = $2`, [version2, item2]);
  await attribute(version2);
  const ok = await reviewVersion({ versionId: version2, reviewerUserId: reviewer, input: { decision: 'APPROVED', notes: null, validatedDifficulty: 3, usage: ['PRACTICE'], alignment: 'EXAM_STYLE' } as never }).then((r) => r.lifecycle, (e) => `REFUSED:${(e as Error).message}`);
  check('the qualified, independent reviewer approves through the same path', ok === 'ACTIVE', ok);
  const stamped = (await db.query(`SELECT r.reviewer_qualification_id IS NOT NULL AS stamped, u.is_system FROM question_bank_reviews r JOIN users u ON u.id = r.reviewed_by WHERE r.approved_item_id = $1 AND r.decision = 'APPROVED'`, [version2])).rows[0];
  check('the approval carries the qualification it was made under, and its reviewer is a person', stamped?.stamped === true && stamped.is_system === false, stamped);
  console.log(`QB_R1A_REVIEW_SERVICE = ${checks.length} PASS`);
  await db.end();
}

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await db.end().catch(() => undefined);
  process.exit(1);
});
