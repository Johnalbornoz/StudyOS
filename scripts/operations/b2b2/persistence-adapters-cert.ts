/**
 * B2-B2 -- the B2 persistence adapters and the protected runtime against a real (EPHEMERAL) Postgres.
 *
 *   blueprint-persistence.service   DRAFT variant + requirements + sources -> PUBLISHED -> loaded back;
 *                                   DRAFT frozen form + positions -> PUBLISHED -> loaded back and verified
 *   loadProtectedSelectionInputs    coverage (attribution, stimulus kind and group rule, rights), pools, exposure
 *   assembleProtectedForm           a form with a stimulus group, from the stored variant and those facts
 *   hardened legacy readers         still see exactly the legacy blueprint while a variant (with targets) exists
 *
 * Everything is FIXTURE content written inside ONE transaction and rolled back; nothing is left behind.
 * The legacy readers query the module pool, so for the length of the transaction the pool's `query` is
 * routed to the transaction's connection -- they run their real SQL against the uncommitted variant.
 * Refuses any database that is not on 127.0.0.1.
 */
import { Client } from 'pg';
import { db } from '@/lib/db';
import type { FormPosition } from '@/lib/exam-core/form-assembly';
import { getBlueprintForVersion } from '@/lib/assessment/blueprint.service';
import { listVersionAreas } from '@/lib/exam-core/catalog.service';
import { listBankVersions } from '@/lib/exam-core/question-bank/health.service';
import { evaluateExamVersionReadiness, loadProtectedSelectionInputs } from '@/lib/assessment-blueprint/assessment-blueprint.service';
import { createDraftFrozenForm, createDraftVariant, discardDraftFrozenForm, loadFrozenForm, loadVariants, publishFrozenForm, publishVariant } from '@/lib/assessment-blueprint/protected/blueprint-persistence.service';
import { BlueprintPersistenceError, mapDatabaseRefusal } from '@/lib/assessment-blueprint/protected/persistence-errors';
import { assembleProtectedForm } from '@/lib/assessment-blueprint/protected/protected-runtime';
import { frozenFormEligibility, frozenFormHash, frozenFormIntact, type FrozenForm } from '@/lib/assessment-blueprint/protected/frozen-form';
import { deriveSelectionUnits } from '@/lib/assessment-blueprint/protected/selection-unit';
import { blueprintKey } from '@/lib/assessment-blueprint/protected/blueprint-identity';
import type { AuthorityTaggedRequirement } from '@/lib/assessment-blueprint/protected/authority';

const checks: string[] = [];
function check(label: string, ok: boolean, detail?: unknown) {
  if (!ok) throw new Error(`B2B2 ADAPTER FAIL [${label}] ${detail === undefined ? '' : JSON.stringify(detail, (_k, v) => (v instanceof Map ? [...v] : v instanceof Set ? [...v] : v))}`);
  checks.push(label);
}
/** The typed refusal a call ends in. Anything else (a success, an untyped error) fails the certification. */
async function refusal(label: string, expected: string | string[], work: () => Promise<unknown>) {
  let code: string | null = null;
  try {
    await work();
  } catch (err) {
    if (!(err instanceof BlueprintPersistenceError)) throw new Error(`B2B2 ADAPTER FAIL [${label}] untyped error: ${err instanceof Error ? err.message : String(err)}`);
    code = err.code;
  }
  check(label, code !== null && [expected].flat().includes(code), { expected, code });
}

const K = (id: string) => `REVIEWED_EXAM_BANK:${id}`;
/** Key-order-independent JSON: jsonb does not keep the key order of an object. */
const canon = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
const AS_OF = '2026-10-10T12:00:00.000Z';

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (url.hostname !== '127.0.0.1') throw new Error('Refusing: not an ephemeral local database');
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const one = async (sql: string, params: unknown[] = []) => (await c.query(sql, params)).rows[0];
  const pool = db as unknown as { query: (...a: unknown[]) => unknown };
  const poolQuery = pool.query;
  try {
    await c.query('BEGIN');
    pool.query = (...a: unknown[]) => (c.query as (...x: unknown[]) => unknown)(...a);

    // An exam version with a legacy blueprint, a slot (target) on a mapped objective, and a source to cite.
    const ctx = await one(
      `SELECT b.id AS legacy_blueprint, b.exam_version_id, t.id AS target, t.learning_objective_id AS objective, t.assessment_component_id AS component, ac.section_key, m.canonical_concept_id AS concept
         FROM assessment_blueprints b JOIN blueprint_objective_targets t ON t.blueprint_id = b.id JOIN assessment_components ac ON ac.id = t.assessment_component_id
         JOIN exam_versions ev ON ev.id = b.exam_version_id AND ev.status = 'PUBLISHED'
         JOIN objective_concept_mappings m ON m.learning_objective_id = t.learning_objective_id AND m.status = 'PUBLISHED'
        WHERE b.purpose IS NULL AND b.status = 'PUBLISHED' ORDER BY b.id, t.id, m.canonical_concept_id LIMIT 1`
    );
    const EV = ctx.exam_version_id as string;
    const SECTION = (ctx.section_key ?? ctx.component) as string;
    const source = (await one(`SELECT source_key FROM assessment_sources ORDER BY source_key LIMIT 1`)).source_key as string;
    const foreignObjective = (await one(`SELECT lo.id FROM learning_objectives lo WHERE NOT EXISTS (SELECT 1 FROM blueprint_objective_targets t WHERE t.blueprint_id = $1 AND t.learning_objective_id = lo.id) ORDER BY lo.id LIMIT 1`, [ctx.legacy_blueprint])).id as string;

    /* ---- legacy readers, before any variant exists ---- */
    const legacyView = async () => ({
      blueprint: await getBlueprintForVersion(EV),
      areas: await listVersionAreas(EV),
      bank: (await listBankVersions()).filter((v) => v.examVersionId === EV),
      readiness: await evaluateExamVersionReadiness(EV, c as never),
    });
    const before = await legacyView();
    check('legacy reader: getBlueprintForVersion returns the legacy blueprint', before.blueprint?.id === ctx.legacy_blueprint, before.blueprint);
    check('legacy reader: listBankVersions has one row for the version, on the legacy blueprint', before.bank.length === 1 && before.bank[0].blueprintId === ctx.legacy_blueprint, before.bank);

    /* ---- fixture content, the proper way: authored, attributed, with rights, reviewed by a qualified independent reviewer ---- */
    const u = async (clerk: string) => (await one(`INSERT INTO users (clerk_id, is_system) VALUES ($1, false) RETURNING id`, [clerk])).id as string;
    const [author, reviewer, grantor] = [await u('b2b2:author'), await u('b2b2:reviewer'), await u('b2b2:grantor')];
    const newItem = async (key: string) => {
      const item = (await one(`INSERT INTO question_bank_items (item_key, exam_version_id, assessment_component_id, learning_objective_id, provenance, language) VALUES ($1, $2, $3, $4, 'STUDYUS_AUTHORED', 'es') RETURNING id`, [key, EV, ctx.component, ctx.objective])).id as string;
      const version = (await one(
        `INSERT INTO approved_items (learning_objective_id, question_type, content, created_by, status, content_origin, bank_item_id, version_number, bank_lifecycle_status, content_hash, usage_eligibility, exam_alignment)
         VALUES ($1, 'multiple_choice', '{"stem":"b2b2 fixture","difficulty":3}', $2, 'PUBLISHED', 'AUTHORED', $3, 1, 'PILOT', md5($4), ARRAY['PRACTICE','REDUCED_MOCK','FULL_MOCK'], 'MOCK_READY') RETURNING id`,
        [ctx.objective, author, item, key]
      )).id as string;
      await c.query(`UPDATE question_bank_items SET current_version_id = $1 WHERE id = $2`, [version, item]);
      await c.query(`INSERT INTO question_bank_item_concepts (approved_item_id, canonical_concept_id, role, attributed_by) VALUES ($1, $2, 'PRIMARY', $3)`, [version, ctx.concept, author]);
      return { item, version };
    };
    const rights = (type: string, id: string, access = 'NOT_APPLICABLE', reuse = 'STUDYUS_OWNED') =>
      c.query(`INSERT INTO question_bank_content_rights (content_type, content_id, source_access, reuse_rights, rights_holder, permitted_use, recorded_by) VALUES ($1, $2, $3, $4, 'StudyUs', 'delivery', $5)`, [type, id, access, reuse, author]);
    const subject = (await one(`SELECT canonical_subject_id AS s FROM canonical_concepts WHERE id = $1`, [ctx.concept])).s;
    const family = (await one(`SELECT ed.exam_family AS f FROM exam_versions ev JOIN exam_definitions ed ON ed.id = ev.exam_definition_id WHERE ev.id = $1`, [EV])).f;
    const qual = (await one(`INSERT INTO question_bank_reviewer_qualifications (user_id, canonical_subject_id, exam_family, granted_by) VALUES ($1, $2, $3, $4) RETURNING id`, [reviewer, subject, family, grantor])).id;

    const [s1, s2, g1, g2, g3, open] = [await newItem('b2b2.s1'), await newItem('b2b2.s2'), await newItem('b2b2.g1'), await newItem('b2b2.g2'), await newItem('b2b2.g3'), await newItem('b2b2.public-only')];
    const stim = (await one(`INSERT INTO question_bank_stimuli (stimulus_key, kind, language, provenance) VALUES ('b2b2.passage', 'PASSAGE', 'es', 'STUDYUS_AUTHORED') RETURNING id`)).id as string;
    const sv = (await one(`INSERT INTO question_bank_stimulus_versions (stimulus_id, version_number, created_by) VALUES ($1, 1, $2) RETURNING id`, [stim, author])).id as string;
    await c.query(`INSERT INTO question_bank_stimulus_parts (stimulus_version_id, position, part_kind, body) VALUES ($1, 1, 'TEXT', '{"paragraphs":["b2b2 fixture"]}')`, [sv]);
    await c.query(`UPDATE question_bank_stimulus_versions SET lifecycle_status = 'REVIEW_REQUIRED', content_hash = 'b2b2' WHERE id = $1`, [sv]);
    await c.query(`UPDATE question_bank_stimuli SET current_version_id = $1 WHERE id = $2`, [sv, stim]);
    // group order is the Question Bank's `position`, deliberately not the order of creation or of the ids
    for (const [v, position] of [[g2, 2], [g3, 3], [g1, 1]] as const) await c.query(`INSERT INTO question_bank_item_stimulus (approved_item_id, stimulus_version_id, position) VALUES ($1, $2, $3)`, [v.version, sv, position]);
    for (const v of [s1, s2, g1, g2, g3]) await rights('ITEM_VERSION', v.version);
    // The source of this one can be read by anyone; nobody established a right to reuse it.
    await rights('ITEM_VERSION', open.version, 'PUBLICLY_ACCESSIBLE', 'UNKNOWN');
    await rights('STIMULUS_VERSION', sv);
    await c.query(`INSERT INTO question_bank_stimulus_reviews (stimulus_version_id, decision, reviewed_by, reviewer_qualification_id) VALUES ($1, 'APPROVED', $2, $3)`, [sv, reviewer, qual]);
    await c.query(`UPDATE question_bank_stimulus_versions SET lifecycle_status = 'ACTIVE' WHERE id = $1`, [sv]);
    for (const v of [s1, s2, g1, g2, g3, open]) {
      await c.query(`INSERT INTO question_bank_reviews (approved_item_id, bank_item_id, decision, reviewed_by) VALUES ($1, $2, 'APPROVED', $3)`, [v.version, v.item, reviewer]);
      await c.query(`UPDATE approved_items SET bank_lifecycle_status = 'ACTIVE' WHERE id = $1`, [v.version]);
    }
    for (const v of [s1, s2, open]) await c.query(`INSERT INTO question_bank_pool_memberships (bank_item_id, pool, policy_id, policy_version, assigned_by) VALUES ($1, 'FULL_MOCK_1', 'b2-pilot-pools', '1', $2)`, [v.item, author]);
    await c.query(`INSERT INTO question_bank_pool_memberships (stimulus_id, pool, policy_id, policy_version, assigned_by) VALUES ($1, 'FULL_MOCK_1', 'b2-pilot-pools', '1', $2)`, [stim, author]);

    /* ---- variant: DRAFT with authority-tagged requirements and sources ---- */
    const official = (key: string, kind: AuthorityTaggedRequirement['kind'], subjectKey: string | null, value: AuthorityTaggedRequirement['value']): AuthorityTaggedRequirement => ({ key, kind, subject: subjectKey, value, authority: 'OFFICIAL', sourceRefs: [source], policyRef: null, sourceLocators: { [source]: 'p. 1' } });
    const policy = (key: string, kind: AuthorityTaggedRequirement['kind'], subjectKey: string | null, value: AuthorityTaggedRequirement['value']): AuthorityTaggedRequirement => ({ key, kind, subject: subjectKey, value, authority: 'STUDYUS_POLICY', sourceRefs: [], policyRef: { id: 'b2b2-cert', version: '1' } });
    const requirements = [
      official('TOTAL_ITEM_COUNT', 'TOTAL_ITEM_COUNT', null, 5), official(`SECTION_ITEM_COUNT:${SECTION}`, 'SECTION_ITEM_COUNT', SECTION, 5),
      policy(`STIMULUS_SET:${SECTION}`, 'STIMULUS_SET', SECTION, { kind: 'PASSAGE', sets: 1, minItems: 3, maxItems: 3 }), policy('POOL_POLICY', 'POOL_POLICY', null, 'ZERO_INTENTIONAL_OVERLAP'), policy('EXPOSURE_POLICY', 'EXPOSURE_POLICY', null, 'HARD_EXCLUDE_IF_EXPOSED'),
    ];
    const FULL_1 = { examVersionId: EV, purpose: 'FULL' as const, form: 1, revision: 1 };

    const outside = new Client({ connectionString: process.env.DATABASE_URL });
    await outside.connect();
    await refusal('writer outside a transaction is refused before writing', 'TRANSACTION_REQUIRED', () => createDraftVariant(outside as never, { identity: FULL_1, pool: 'FULL_MOCK_1', requirements }));
    await outside.end();
    await refusal('an OFFICIAL requirement without a source is refused', 'SPECIFICATION_INVALID', () => createDraftVariant(c as never, { identity: FULL_1, pool: 'FULL_MOCK_1', requirements: [{ ...requirements[0], sourceRefs: [] }] }));
    await refusal('a policy requirement without a policy reference is refused', 'SPECIFICATION_INVALID', () => createDraftVariant(c as never, { identity: FULL_1, pool: 'FULL_MOCK_1', requirements: [{ ...requirements[3], policyRef: null }] }));
    await refusal('an unknown source key is refused (no source is created)', 'UNKNOWN_SOURCE', () => createDraftVariant(c as never, { identity: FULL_1, pool: 'FULL_MOCK_1', requirements: [{ ...requirements[0], sourceRefs: ['b2b2-no-such-source'] }] }));
    await refusal('an unknown section is refused', 'UNKNOWN_SECTION', () => createDraftVariant(c as never, { identity: FULL_1, pool: 'FULL_MOCK_1', requirements: [{ ...requirements[1], subject: 'b2b2-no-such-section' }] }));
    await refusal('a pool the pool policy does not give the variant is refused', 'POOL_NOT_ALLOWED_FOR_VARIANT', () => createDraftVariant(c as never, { identity: FULL_1, pool: 'FULL_MOCK_2', requirements }));
    check('refused writes left no variant behind', (await loadVariants(EV, c as never)).variants.length === 0);

    const { blueprintId } = await createDraftVariant(c as never, { identity: FULL_1, pool: 'FULL_MOCK_1', requirements });
    await refusal('DB refusal -> typed: a variant identity is unique', 'VARIANT_IDENTITY_TAKEN', () => createDraftVariant(c as never, { identity: FULL_1, pool: 'FULL_MOCK_1', requirements }));
    let set = await loadVariants(EV, c as never);
    check('the transaction is still usable after a refusal, and the draft is loaded back', set.variants.length === 1 && set.variants[0].blueprintId === blueprintId && set.variants[0].identity.status === 'DRAFT' && set.variants[0].pool === 'FULL_MOCK_1', set.variants);
    check('requirements round-trip: keys, kinds, values, authority, policy, section, sources and locator', canon(set.variants[0].specification.requirements) === canon([...requirements].sort((a, b) => (a.key < b.key ? -1 : 1)).map((r) => ({ key: r.key, kind: r.kind, subject: r.subject, value: r.value, authority: r.authority, sourceRefs: r.sourceRefs, policyRef: r.policyRef, ...(r.sourceLocators ? { sourceLocators: r.sourceLocators } : {}) }))), set.variants[0].specification.requirements);
    check('the loaded variant passes specificationViolations and blueprintSetViolations', set.setViolations.length === 0 && Object.keys(set.specificationViolations).length === 0, set);
    check('the section subject resolves to its component id', set.variants[0].componentIdBySubject[SECTION] === ctx.component, set.variants[0].componentIdBySubject);
    check('an unpublished variant is not used for a selection', (() => { const r = assembleProtectedForm(set.variants[0], { examVersionId: EV, coverages: [], poolAssignments: new Map(), exposure: new Map(), exposedStimuli: { stimulusIds: new Set(), stimulusVersionIds: new Set() } }, { positions: [], fidelity: null, difficultyBandMet: null }); return !r.ok && r.refusals.some((x) => x.code === 'VARIANT_NOT_PUBLISHED'); })());

    // A variant may carry slot targets of its own. They must never reach a legacy reader.
    await c.query(`INSERT INTO blueprint_objective_targets SELECT (jsonb_populate_record(NULL::blueprint_objective_targets, to_jsonb(t) || jsonb_build_object('id', gen_random_uuid(), 'blueprint_id', $1::uuid, 'learning_objective_id', $3::uuid))).* FROM blueprint_objective_targets t WHERE t.id = $2`, [blueprintId, ctx.target, foreignObjective]);

    const published = await publishVariant(c as never, blueprintId);
    check('the variant is PUBLISHED', published.identity.status === 'PUBLISHED' && blueprintKey(published.identity) === `${EV}:FULL:F1:R1`);
    await refusal('publishing twice is refused', 'NOT_A_DRAFT', () => publishVariant(c as never, blueprintId));
    const rev2 = await createDraftVariant(c as never, { identity: { ...FULL_1, revision: 2 }, pool: 'FULL_MOCK_1', requirements });
    await refusal('DB refusal -> typed: one published revision per form', 'PUBLISHED_REVISION_EXISTS', () => publishVariant(c as never, rev2.blueprintId));
    // The adapter has no path that edits a published variant; the raw statement is refused by the database and named by the adapter's mapper.
    await refusal('DB refusal -> typed: requirements of a published variant are fixed', 'ASSESSMENT_BLUEPRINT_REQUIREMENTS_FIXED', async () => {
      await c.query('SAVEPOINT b2b2_raw');
      try {
        await c.query(`DELETE FROM assessment_blueprint_requirements WHERE blueprint_id = $1`, [blueprintId]);
      } catch (err) {
        await c.query('ROLLBACK TO SAVEPOINT b2b2_raw');
        throw mapDatabaseRefusal(err);
      }
    });
    set = await loadVariants(EV, c as never);
    check('revision 1 PUBLISHED and revision 2 DRAFT coexist; the set is valid', set.variants.map((v) => `${v.identity.revision}:${v.identity.status}`).join() === '1:PUBLISHED,2:DRAFT' && set.setViolations.length === 0, set.variants.map((v) => v.identity));

    /* ---- legacy readers, with a published variant (and a variant target on a foreign objective) in the same version ---- */
    const after = await legacyView();
    check('legacy reader: getBlueprintForVersion still returns the legacy blueprint', after.blueprint?.id === ctx.legacy_blueprint && JSON.stringify(after.blueprint) === JSON.stringify(before.blueprint), after.blueprint);
    check('legacy reader: listVersionAreas is unchanged (no variant target leaked)', JSON.stringify(after.areas) === JSON.stringify(before.areas) && !JSON.stringify(after.areas).includes(foreignObjective));
    check('legacy reader: listBankVersions still has one row for the version, on the legacy blueprint', after.bank.length === 1 && after.bank[0].blueprintId === ctx.legacy_blueprint, after.bank);
    check('legacy reader: evaluateExamVersionReadiness reads the same targets', after.readiness.targets === before.readiness.targets, [before.readiness.targets, after.readiness.targets]);
    const unfiltered = await one(`SELECT (SELECT count(*)::int FROM assessment_blueprints WHERE exam_version_id = $1) AS blueprints, (SELECT count(DISTINCT t.learning_objective_id)::int FROM blueprint_objective_targets t JOIN assessment_blueprints b ON b.id = t.blueprint_id WHERE b.exam_version_id = $1) AS objectives`, [EV]);
    check('control: without the filter the same readers WOULD see three blueprints and one more objective', unfiltered.blueprints === 3 && unfiltered.objectives === before.readiness.targets + 1, unfiltered);

    /* ---- Question Bank carriers, read-only, through the one entry point ---- */
    const facts = await loadProtectedSelectionInputs(EV, null, AS_OF, c as never);
    const cov = new Map(facts.coverages.map((x) => [x.ref.id, x]));
    check('coverage carries the stimulus kind and the group rule (NULL = whole)', [g1, g2, g3].every((g) => cov.get(g.version)?.stimulus?.kind === 'PASSAGE' && cov.get(g.version)?.stimulus?.selection === null && cov.get(g.version)?.stimulus?.stimulusVersionId === sv), cov.get(g1.version)?.stimulus);
    check('group members inherit the pool of their stimulus; standalone items have their own', [g1, g2, g3, s1, s2, open].every((v) => JSON.stringify(facts.poolAssignments.get(K(v.version))) === '["FULL_MOCK_1"]') && facts.poolAssignments.size === 6, [...facts.poolAssignments]);
    check('a fixed-form read carries no exposure', facts.exposure.size === 0 && facts.exposedStimuli.stimulusIds.size === 0);
    const units = deriveSelectionUnits({ coverages: facts.coverages, usableKeys: new Set([s1, s2, g1, g2, g3].map((v) => K(v.version))), poolAssignments: facts.poolAssignments });
    const group = units.units.find((x) => x.type === 'STIMULUS_GROUP');
    check('units: one WHOLE PASSAGE group in position order, and the standalone items', units.units.length === 3 && group?.integrity.kind === 'WHOLE' && group?.setKind === 'PASSAGE' && group?.pool === 'FULL_MOCK_1' && JSON.stringify(group?.memberKeys) === JSON.stringify([g1, g2, g3].map((v) => K(v.version))) && group?.stimulusVersionId === sv, units);

    /* ---- protected selection from the stored variant ---- */
    const position = (index: number): FormPosition => ({ index, blueprintObjectiveTargetId: ctx.target, assessmentComponentId: ctx.component, learningObjectiveId: ctx.objective, questionType: 'multiple_choice', difficultyRange: { min: 2, max: 4 } });
    const shape = { positions: [0, 1, 2, 3, 4].map(position), fidelity: { fidelity: 'FULL' as const, reasons: [] }, difficultyBandMet: true };
    const assembled = assembleProtectedForm(set.variants[0], facts, shape);
    if (!assembled.ok) throw new Error(`B2B2 ADAPTER FAIL [variant refused] ${JSON.stringify(assembled.refusals)}`);
    const result = assembled.result;
    check('a form is assembled from the stored variant', result.status === 'FORM_READY' && result.form !== null, { causes: result.causes, gate: result.gate, units: result.units, freeze: result.freezeViolations, fidelity: result.fidelityViolations });
    const form = result.form as FrozenForm;
    check('the group is whole, adjacent and in order; its positions record the stimulus version and the place in the group', JSON.stringify(form.positions.map((p) => [p.slotIndex, p.key, p.stimulusVersionId, p.unitPosition])) === JSON.stringify([[0, K(g1.version), sv, 1], [1, K(g2.version), sv, 2], [2, K(g3.version), sv, 3], ...[s1, s2].map((v) => K(v.version)).sort().map((k, i) => [3 + i, k, null, null])]), form.positions);
    check('rights: the publicly accessible item with no established reuse right never reached the candidates', (result.gate.ineligible.REUSE_RIGHTS_NOT_ESTABLISHED ?? 0) >= 1 && !form.positions.some((p) => p.key === K(open.version)) && result.gate.usable === 5, result.gate);
    const six = assembleProtectedForm(set.variants[0], facts, { ...shape, positions: [0, 1, 2, 3, 4, 5].map(position) });
    check('rights: even when it is the only item that could complete the form, it is not used', six.ok && six.result.status === 'NOT_AVAILABLE' && six.result.causes[0] === 'INSUFFICIENT_ELIGIBLE_ITEMS' && six.result.form === null, six.ok ? six.result.causes : six);

    /* ---- frozen form: DRAFT -> PUBLISHED -> read back and verified ---- */
    const { formId } = await createDraftFrozenForm(c as never, { blueprintId, form, createdBy: author });
    const draft = await loadFrozenForm(formId, c as never);
    check('the draft form is stored with its ordered positions and no hash yet', draft?.status === 'DRAFT' && draft.storedHash === null && draft.form.formHash === form.formHash && JSON.stringify(draft.form.positions) === JSON.stringify(form.positions), draft);
    await refusal('a form published with another digest is refused', 'FORM_CHANGED_SINCE_DRAFT', () => publishFrozenForm(c as never, { formId, formHash: 'f'.repeat(64), frozenBy: reviewer, frozenAt: AS_OF }));
    const frozen = await publishFrozenForm(c as never, { formId, formHash: form.formHash, frozenBy: reviewer, frozenAt: AS_OF });
    check('the form is PUBLISHED with form_hash, frozen_at and frozen_by', frozen.status === 'PUBLISHED' && frozen.frozenBy === reviewer && frozen.frozenAt === AS_OF && /^[0-9a-f]{64}$/.test(frozen.storedHash ?? '') && frozen.storedHash === form.formHash, frozen);
    const back = await loadFrozenForm(formId, c as never);
    check('read back into the pure FrozenForm, the digest still matches (frozenFormIntact)', !!back && back.intact && frozenFormIntact(back.form) && canon(back.form) === canon(form), back);
    check('a changed position is detected on what was read back', !!back && !frozenFormIntact({ ...back.form, positions: [back.form.positions[1], back.form.positions[0], ...back.form.positions.slice(2)].map((p, i) => ({ ...p, slotIndex: i })) }));
    await refusal('DB refusal -> typed: a published form is immutable', 'ASSESSMENT_FROZEN_FORM_IMMUTABLE', () => discardDraftFrozenForm(c as never, formId));
    const twin = await createDraftFrozenForm(c as never, { blueprintId, form, createdBy: author });
    await refusal('DB refusal -> typed: one published form per variant, one form per digest', ['PUBLISHED_FORM_EXISTS', 'FORM_HASH_TAKEN'], () => publishFrozenForm(c as never, { formId: twin.formId, formHash: form.formHash, frozenBy: reviewer, frozenAt: AS_OF }));
    await discardDraftFrozenForm(c as never, twin.formId);
    check('an unpublished form can be discarded', (await loadFrozenForm(twin.formId, c as never)) === null);
    const loose = { ...form, positions: form.positions.map((p) => ({ ...p, stimulusVersionId: null, unitPosition: null })) };
    await refusal('DB refusal -> typed: a position must carry the stimulus version of its item', 'ASSESSMENT_FROZEN_FORM_STIMULUS_MISMATCH', () => createDraftFrozenForm(c as never, { blueprintId, form: { ...loose, formHash: frozenFormHash(loose) }, createdBy: author }));
    await refusal('a form whose digest does not match its content is refused', 'FORM_NOT_INTACT', () => createDraftFrozenForm(c as never, { blueprintId, form: loose, createdBy: author }));
    await refusal('a form is stored only for its own variant', 'FORM_DOES_NOT_MATCH_VARIANT', () => createDraftFrozenForm(c as never, { blueprintId: rev2.blueprintId, form, createdBy: author }));
    const r2Identity = { ...form.identity, revision: 2 };
    const r2Form: FrozenForm = { ...form, identity: r2Identity, blueprintKey: blueprintKey(r2Identity), formHash: frozenFormHash({ ...form, identity: r2Identity }) };
    const r2 = await createDraftFrozenForm(c as never, { blueprintId: rev2.blueprintId, form: r2Form, createdBy: author });
    await refusal('DB refusal -> typed: a form is published only for a published variant', 'ASSESSMENT_FROZEN_FORM_NEEDS_PUBLISHED_BLUEPRINT', () => publishFrozenForm(c as never, { formId: r2.formId, formHash: r2Form.formHash, frozenBy: reviewer, frozenAt: AS_OF }));

    /* ---- hard exposure for one Student: any question of a group exposes the group ---- */
    const student = (await one(`INSERT INTO students (clerk_id, email) VALUES ('b2b2:student', 'b2b2@cert.invalid') RETURNING id`)).id as string;
    await c.query(`INSERT INTO exam_item_usage (student_id, approved_item_id, used_at) VALUES ($1, $2, $3)`, [student, g2.version, '2026-10-01T00:00:00Z']);
    const forStudent = await loadProtectedSelectionInputs(EV, student, AS_OF, c as never);
    check('exposure: the delivered question is seen, and its stimulus is exposed in every version', forStudent.exposure.get(K(g2.version))?.seen === true && forStudent.exposure.size === 1 && forStudent.exposedStimuli.stimulusIds.has(stim) && forStudent.exposedStimuli.stimulusVersionIds.has(sv), forStudent.exposedStimuli);
    const personal = assembleProtectedForm(set.variants[0], forStudent, { ...shape, studentId: student });
    check('exposure: the whole group is excluded for that Student (3 questions for 1 delivery) and no smaller form is offered', personal.ok && personal.result.status === 'NOT_AVAILABLE' && personal.result.causes[0] === 'EXPOSURE_SHORTAGE' && personal.result.gate.exposureRejected.EXPOSED_TO_STUDENT === 3 && personal.result.form === null, personal.ok ? [personal.result.causes, personal.result.gate] : personal);
    const eligibility = frozenFormEligibility(form, forStudent.exposure, 'HARD_EXCLUDE_IF_EXPOSED', forStudent.exposedStimuli.stimulusVersionIds);
    check('exposure: the published fixed form is not offered to that Student', !eligibility.eligible && eligibility.exposedItems.length === 3 && JSON.stringify(eligibility.exposedStimulusVersionIds) === JSON.stringify([sv]), eligibility);
    check('exposure: a Student who has seen nothing may take it', frozenFormEligibility(form, new Map(), 'HARD_EXCLUDE_IF_EXPOSED').eligible);
  } finally {
    pool.query = poolQuery;
    await c.query('ROLLBACK').catch(() => undefined);
    const left = (await c.query(`SELECT (SELECT count(*)::int FROM assessment_blueprints WHERE purpose IS NOT NULL) + (SELECT count(*)::int FROM assessment_blueprint_requirements) + (SELECT count(*)::int FROM assessment_frozen_forms) + (SELECT count(*)::int FROM question_bank_stimuli) + (SELECT count(*)::int FROM question_bank_pool_memberships) AS n`).catch(() => ({ rows: [{ n: -1 }] }))).rows[0].n;
    await c.end();
    await db.end().catch(() => undefined);
    if (left !== 0) throw new Error(`B2B2 ADAPTER FAIL [rolled back: nothing left behind] ${left}`);
  }
  console.log(`B2B2_PERSISTENCE_ADAPTERS = ${checks.length} PASS (rolled back: 0 variants, requirements, forms, stimuli, pool memberships left)`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
