/**
 * B2-B1 -- the two read-only loaders against a real (EPHEMERAL) Postgres.
 *
 *   reviewedExamBankCoverageProvider   attribution, stimulus, assets and rights of an item version
 *   loadReviewedBankPoolAssignments    the pool of an item, own or inherited from its stimulus
 *
 * Mode `absent`  : the 20261110_* schema is not applied -> both loaders answer "no fact" and do not fail.
 * Mode `present` : content is written inside ONE transaction, read through the loaders on that same
 *                  connection, and rolled back. Nothing is left behind.
 * Refuses any database that is not on 127.0.0.1.
 */
import { Client } from 'pg';
import { reviewedExamBankCoverageProvider } from '@/lib/assessment-foundation/question-coverage.service';
import { evaluateQuestionEligibility, rightsIneligibility } from '@/lib/assessment-foundation/question-eligibility';
import { directEvidenceConceptId } from '@/lib/assessment-foundation/question-coverage';
import { loadReviewedBankPoolAssignments } from '@/lib/assessment-blueprint/assessment-blueprint.service';

const mode = process.argv[2];
const checks: string[] = [];
function check(label: string, ok: boolean, detail?: unknown) {
  if (!ok) throw new Error(`B2B1 LOADER FAIL [${label}] ${detail === undefined ? '' : JSON.stringify(detail)}`);
  checks.push(label);
}

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (url.hostname !== '127.0.0.1') throw new Error('Refusing: not an ephemeral local database');
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const one = async (sql: string, params: unknown[] = []) => (await c.query(sql, params)).rows[0];
  try {
    await c.query('BEGIN');
    const ctx = await one(
      `SELECT qi.id AS legacy_item, qi.current_version_id AS legacy_version, qi.exam_version_id, qi.learning_objective_id AS objective, m.canonical_concept_id AS concept
         FROM question_bank_items qi JOIN objective_concept_mappings m ON m.learning_objective_id = qi.learning_objective_id AND m.status = 'PUBLISHED'
        WHERE qi.exam_version_id IS NOT NULL AND qi.current_version_id IS NOT NULL ORDER BY qi.item_key, m.canonical_concept_id LIMIT 1`
    );
    const provider = reviewedExamBankCoverageProvider(c as never);
    const request = { family: 'EXAM_PREPARATION' as const, studentId: 'b2b1', examVersionId: ctx.exam_version_id as string };

    // A legacy item: unattributed, no rights record -> never deliverable to a Student. True with or without the schema.
    const [legacy] = await provider.load([ctx.legacy_version]);
    check('legacy item has no rights record', legacy.rights.length === 1 && legacy.rights[0].reuseRights === null, legacy.rights);
    check('legacy item is not directly attributed', directEvidenceConceptId(legacy) === null && legacy.concepts.every((x) => x.basis === 'OBJECTIVE_MAPPING'));
    const lv = evaluateQuestionEligibility(legacy, request);
    check('legacy item is ineligible for a Student', !lv.eligible && lv.reasons.includes('REUSE_RIGHTS_NOT_ESTABLISHED'), lv);
    const legacyPools = await loadReviewedBankPoolAssignments(ctx.exam_version_id, c as never);
    check('no legacy item is in a pool', legacyPools.size === 0, legacyPools.size);

    if (mode === 'present') {
      const u = async (clerk: string) => (await one(`INSERT INTO users (clerk_id, is_system) VALUES ($1, false) RETURNING id`, [clerk])).id as string;
      const [author, reviewer, grantor] = [await u('b2b1l:author'), await u('b2b1l:reviewer'), await u('b2b1l:grantor')];
      const newItem = async (key: string) => {
        const item = (await one(`INSERT INTO question_bank_items (item_key, exam_version_id, learning_objective_id, provenance, language) VALUES ($1, $2, $3, 'STUDYUS_AUTHORED', 'es') RETURNING id`, [key, ctx.exam_version_id, ctx.objective])).id as string;
        const version = (await one(
          `INSERT INTO approved_items (learning_objective_id, question_type, content, created_by, status, content_origin, bank_item_id, version_number, bank_lifecycle_status, content_hash, usage_eligibility, exam_alignment)
           VALUES ($1, 'multiple_choice', '{"stem":"b2b1"}', $2, 'PUBLISHED', 'AUTHORED', $3, 1, 'PILOT', md5($4), ARRAY['PRACTICE'], 'EXAM_STYLE') RETURNING id`,
          [ctx.objective, author, item, key]
        )).id as string;
        await c.query(`UPDATE question_bank_items SET current_version_id = $1 WHERE id = $2`, [version, item]);
        return { item, version };
      };
      const own = (type: string, id: string) => c.query(`INSERT INTO question_bank_content_rights (content_type, content_id, source_access, reuse_rights, rights_holder, permitted_use, recorded_by) VALUES ($1, $2, 'NOT_APPLICABLE', 'STUDYUS_OWNED', 'StudyUs', 'delivery', $3)`, [type, id, author]);
      const subject = (await one(`SELECT canonical_subject_id AS s FROM canonical_concepts WHERE id = $1`, [ctx.concept])).s;
      const family = (await one(`SELECT ed.exam_family AS f FROM exam_versions ev JOIN exam_definitions ed ON ed.id = ev.exam_definition_id WHERE ev.id = $1`, [ctx.exam_version_id])).f;
      const qual = (await one(`INSERT INTO question_bank_reviewer_qualifications (user_id, canonical_subject_id, exam_family, granted_by) VALUES ($1, $2, $3, $4) RETURNING id`, [reviewer, subject, family, grantor])).id;

      const standalone = await newItem('b2b1l.standalone');
      const grouped = await newItem('b2b1l.grouped');
      const asset = (await one(`INSERT INTO question_bank_assets (asset_key, kind, provenance, storage_provider, storage_key, sha256, media_type, size_bytes, alt_text, created_by) VALUES ('b2b1l.asset', 'GRAPH', 'STUDYUS_AUTHORED', 'any', 'qb/b2b1l.svg', repeat('a', 64), 'image/svg+xml', 10, '{"es":"grafica"}', $1) RETURNING id`, [author])).id;
      const stim = (await one(`INSERT INTO question_bank_stimuli (stimulus_key, kind, language, provenance) VALUES ('b2b1l.stim', 'COMPOSITE', 'es', 'STUDYUS_AUTHORED') RETURNING id`)).id;
      const sv = (await one(`INSERT INTO question_bank_stimulus_versions (stimulus_id, version_number, created_by) VALUES ($1, 1, $2) RETURNING id`, [stim, author])).id;
      await c.query(`INSERT INTO question_bank_stimulus_parts (stimulus_version_id, position, part_kind, body, asset_id) VALUES ($1, 1, 'TEXT', '{"paragraphs":["a"]}', NULL), ($1, 2, 'GRAPH', NULL, $2)`, [sv, asset]);
      await c.query(`UPDATE question_bank_stimulus_versions SET lifecycle_status = 'REVIEW_REQUIRED', content_hash = 'h' WHERE id = $1`, [sv]);
      await c.query(`UPDATE question_bank_stimuli SET current_version_id = $1 WHERE id = $2`, [sv, stim]);
      await c.query(`INSERT INTO question_bank_item_stimulus (approved_item_id, stimulus_version_id, position) VALUES ($1, $2, 1)`, [grouped.version, sv]);
      for (const v of [standalone, grouped]) {
        await c.query(`INSERT INTO question_bank_item_concepts (approved_item_id, canonical_concept_id, role, attributed_by) VALUES ($1, $2, 'PRIMARY', $3)`, [v.version, ctx.concept, author]);
        await own('ITEM_VERSION', v.version);
      }
      await c.query(`INSERT INTO question_bank_pool_memberships (bank_item_id, pool, policy_id, policy_version, assigned_by) VALUES ($1, 'PRACTICE', 'b2-pilot-pools', '1', $2)`, [standalone.item, author]);
      await c.query(`INSERT INTO question_bank_pool_memberships (stimulus_id, pool, policy_id, policy_version, assigned_by) VALUES ($1, 'FULL_MOCK_1', 'b2-pilot-pools', '1', $2)`, [stim, author]);

      // Stimulus not approved, stimulus and asset without rights: the grouped item is blocked, the standalone one is not.
      let [s1, g1] = await provider.load([standalone.version, grouped.version]);
      check('attribution is read from the item version', directEvidenceConceptId(s1) === ctx.concept && s1.concepts[0].basis === 'ITEM_ATTRIBUTION', s1.concepts);
      check('standalone item with an owned right passes the rights rule', rightsIneligibility(s1).length === 0, rightsIneligibility(s1));
      // still under review (PILOT): the existing delivery rule keeps it from a Student, rights or not
      check('an item under review is not deliverable yet', !evaluateQuestionEligibility(s1, request).eligible);
      const g1v = { eligible: rightsIneligibility(g1).length === 0, reasons: rightsIneligibility(g1) };
      check('stimulus and asset facts are read through the item', g1.stimulus?.stimulusId === stim && g1.assets.length === 1 && g1.rights.length === 3, g1.rights);
      check('an unapproved stimulus without rights blocks its item', !g1v.eligible && ['STIMULUS_NOT_ELIGIBLE', 'STIMULUS_RIGHTS_NOT_ESTABLISHED', 'ASSET_RIGHTS_NOT_ESTABLISHED'].every((r) => g1v.reasons.includes(r as never)), g1v);

      await own('STIMULUS_VERSION', sv);
      await own('ASSET', asset);
      await c.query(`UPDATE question_bank_assets SET lifecycle_status = 'ACTIVE' WHERE id = $1`, [asset]);
      await c.query(`INSERT INTO question_bank_stimulus_reviews (stimulus_version_id, decision, reviewed_by, reviewer_qualification_id) VALUES ($1, 'APPROVED', $2, $3)`, [sv, reviewer, qual]);
      await c.query(`UPDATE question_bank_stimulus_versions SET lifecycle_status = 'ACTIVE' WHERE id = $1`, [sv]);
      [s1, g1] = await provider.load([standalone.version, grouped.version]);
      check('with an approved, active stimulus and rights on everything, the grouped item passes the rights rule', rightsIneligibility(g1).length === 0, rightsIneligibility(g1));
      // a qualified, independent reviewer approves both items; they become active and are then fully eligible
      for (const v of [standalone, grouped]) {
        await c.query(`INSERT INTO question_bank_reviews (approved_item_id, bank_item_id, decision, reviewed_by) VALUES ($1, $2, 'APPROVED', $3)`, [v.version, v.item, reviewer]);
        await c.query(`UPDATE approved_items SET bank_lifecycle_status = 'ACTIVE' WHERE id = $1`, [v.version]);
      }
      [s1, g1] = await provider.load([standalone.version, grouped.version]);
      check('approved, active, attributed, with rights: the standalone item is eligible', evaluateQuestionEligibility(s1, request).eligible, evaluateQuestionEligibility(s1, request));
      check('approved, active, attributed, with rights: the stimulus-bound item is eligible', evaluateQuestionEligibility(g1, request).eligible, evaluateQuestionEligibility(g1, request));

      const pools = await loadReviewedBankPoolAssignments(ctx.exam_version_id, c as never);
      check('standalone item is in its own pool', JSON.stringify(pools.get(`REVIEWED_EXAM_BANK:${standalone.version}`)) === '["PRACTICE"]', [...pools]);
      check('stimulus-bound item inherits the pool of its stimulus', JSON.stringify(pools.get(`REVIEWED_EXAM_BANK:${grouped.version}`)) === '["FULL_MOCK_1"]', [...pools]);
      check('only the two new items are in a pool', pools.size === 2, pools.size);
    }
  } finally {
    await c.query('ROLLBACK').catch(() => undefined);
    await c.end();
  }
  console.log(`B2B1_LOADERS (${mode}) = ${checks.length} PASS`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
