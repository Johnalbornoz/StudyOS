/**
 * B2-B2 -- the B2 persistence adapters, the typed refusals and the read-only protected inputs, on a recorded
 * executor (no database). What a real Postgres says is certified by
 * scripts/operations/b2b2-persistence-adapters-cert.sh; here the contract between the pure shapes and the
 * statements is pinned. Fixtures only.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

vi.mock('@/lib/db', () => ({ db: { query: vi.fn(async () => { throw new Error('the module pool must not be used by these tests'); }) } }));

import type { DbExecutor } from '@/lib/db';
import { frozenFormHash, type AuthorityTaggedRequirement, type BlueprintIdentity, type FrozenForm } from '@/lib/assessment-blueprint';
import { BlueprintPersistenceError, DATABASE_REFUSAL_CODES, mapDatabaseRefusal } from '@/lib/assessment-blueprint/protected/persistence-errors';
import { createDraftFrozenForm, createDraftVariant, discardDraftFrozenForm, loadFrozenForm, loadVariants, publishFrozenForm, publishVariant } from '@/lib/assessment-blueprint/protected/blueprint-persistence.service';
import { loadProtectedSelectionInputs, loadReviewedBankStimulusExposure } from '@/lib/assessment-blueprint/assessment-blueprint.service';
import { reviewedExamBankCoverageProvider } from '@/lib/assessment-foundation/question-coverage.service';

const ROOT = join(__dirname, '..', '..');
const sqlOf = (file: string) => readFileSync(join(ROOT, 'database/migrations', file), 'utf8');
const M7 = sqlOf('20261110_1600_assessment_blueprint_variants.sql');
const M8 = sqlOf('20261110_1700_assessment_frozen_forms.sql');

type Reply = { rows: unknown[] } | Error;
/** An executor that records every statement and answers by pattern. Unmatched statements answer with no row. */
function recorder(replies: Array<[RegExp, Reply | ((params: unknown[]) => Reply)]> = []) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const tx = {
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
      const hit = replies.find(([re]) => re.test(sql));
      const reply = hit ? (typeof hit[1] === 'function' ? hit[1](params) : hit[1]) : { rows: [] };
      if (reply instanceof Error) throw reply;
      return reply;
    },
  } as unknown as DbExecutor;
  return { tx, calls, sql: () => calls.map((c) => c.sql) };
}
const pgError = (message: string, over: Record<string, unknown> = {}) => Object.assign(new Error(message), { code: '23514', ...over });
const refusedWith = async (work: Promise<unknown>): Promise<BlueprintPersistenceError> => {
  const err = await work.then(() => null, (e) => e);
  if (!(err instanceof BlueprintPersistenceError)) throw new Error(`expected a typed refusal, got ${err === null ? 'a success' : String(err)}`);
  return err;
};

const EV = '00000000-0000-0000-0000-0000000000e1';
const official = (key: string, kind: AuthorityTaggedRequirement['kind'], subject: string | null, value: AuthorityTaggedRequirement['value']): AuthorityTaggedRequirement => ({ key, kind, subject, value, authority: 'OFFICIAL', sourceRefs: ['fixture-source'], policyRef: null, sourceLocators: { 'fixture-source': 'p. 3' } });
const policy = (key: string, kind: AuthorityTaggedRequirement['kind'], subject: string | null, value: AuthorityTaggedRequirement['value']): AuthorityTaggedRequirement => ({ key, kind, subject, value, authority: 'STUDYUS_POLICY', sourceRefs: [], policyRef: { id: 'fixture-policy', version: '2' } });
const REQUIREMENTS = [official('TOTAL_ITEM_COUNT', 'TOTAL_ITEM_COUNT', null, 3), official('SECTION_ITEM_COUNT:lectura', 'SECTION_ITEM_COUNT', 'lectura', 3), policy('STIMULUS_SET:lectura', 'STIMULUS_SET', 'lectura', { kind: 'PASSAGE', sets: 1, minItems: 2, maxItems: 2 })];
const FULL_1 = { examVersionId: EV, purpose: 'FULL' as const, form: 1, revision: 1 };
const CATALOGUE: Array<[RegExp, Reply]> = [[/FROM assessment_sources/, { rows: [{ id: 'src-1', source_key: 'fixture-source' }] }], [/FROM assessment_components WHERE exam_version_id = \$1/, { rows: [{ id: 'comp-1', section_key: 'lectura' }] }]];

describe('B2-B2 typed refusals', () => {
  it('names every code the two B2 migrations raise, and only those', () => {
    const raised = [...new Set([...`${M7}\n${M8}`.matchAll(/RAISE EXCEPTION '([A-Z_]+)[:']/g)].map((m) => m[1]))].filter((c) => c !== 'B2B1_BLUEPRINT_VARIANTS').sort();
    expect([...DATABASE_REFUSAL_CODES].sort()).toEqual(raised);
    for (const code of DATABASE_REFUSAL_CODES) {
      const mapped = mapDatabaseRefusal(pgError(`${code}: form 1 is PUBLISHED; retire it instead`));
      expect(mapped).toBeInstanceOf(BlueprintPersistenceError);
      expect((mapped as BlueprintPersistenceError).code).toBe(code);
    }
    expect((mapDatabaseRefusal(pgError('ASSESSMENT_FROZEN_FORM_STARTS_DRAFT')) as BlueprintPersistenceError).code).toBe('ASSESSMENT_FROZEN_FORM_STARTS_DRAFT');
  });

  it('names the unique indexes and checks by what they mean; the named ones exist in the migrations', () => {
    const byConstraint = (constraint: string) => (mapDatabaseRefusal(pgError(`duplicate key value violates unique constraint "${constraint}"`, { code: '23505', constraint })) as BlueprintPersistenceError).code;
    expect(byConstraint('assessment_blueprints_variant_identity_key')).toBe('VARIANT_IDENTITY_TAKEN');
    expect(byConstraint('assessment_blueprints_one_published_revision')).toBe('PUBLISHED_REVISION_EXISTS');
    expect(byConstraint('assessment_blueprints_legacy_per_version')).toBe('LEGACY_BLUEPRINT_EXISTS');
    expect(byConstraint('assessment_frozen_forms_one_published')).toBe('PUBLISHED_FORM_EXISTS');
    expect(byConstraint('assessment_frozen_forms_form_hash_key')).toBe('FORM_HASH_TAKEN');
    expect(byConstraint('assessment_frozen_form_positions_form_id_approved_item_id_key')).toBe('DUPLICATE_ITEM_IN_FORM');
    expect(byConstraint('assessment_blueprint_requirements_policy_only_kinds')).toBe('POLICY_KIND_TAGGED_OFFICIAL');
    for (const name of ['assessment_blueprints_variant_identity_key', 'assessment_blueprints_one_published_revision', 'assessment_blueprints_legacy_per_version', 'assessment_blueprints_variant_identity', 'assessment_blueprint_requirements_key', 'assessment_blueprint_requirements_policy_ref', 'assessment_blueprint_requirements_policy_only_kinds']) expect(M7, name).toContain(name);
    for (const name of ['assessment_frozen_forms_one_published', 'assessment_frozen_forms_fidelity_attempt', 'assessment_frozen_forms_frozen', 'assessment_frozen_form_positions_unit']) expect(M8, name).toContain(name);
  });

  it('an unknown refusal stays a refusal; an error that is not a refusal is never turned into one', () => {
    expect((mapDatabaseRefusal(pgError('new row violates check constraint "x"', { constraint: 'x' })) as BlueprintPersistenceError).code).toBe('DATABASE_REFUSED');
    expect((mapDatabaseRefusal(pgError('SOME_OTHER_RULE: no', { code: 'P0001' })) as BlueprintPersistenceError).code).toBe('DATABASE_REFUSED');
    expect((mapDatabaseRefusal(pgError('SAVEPOINT can only be used in transaction blocks', { code: '25P01' })) as BlueprintPersistenceError).code).toBe('TRANSACTION_REQUIRED');
    const lost = Object.assign(new Error('Connection terminated unexpectedly'), { code: 'ECONNRESET' });
    expect(mapDatabaseRefusal(lost)).toBe(lost);
    const syntax = pgError('syntax error at or near "FORM"', { code: '42601' });
    expect(mapDatabaseRefusal(syntax)).toBe(syntax);
    const typed = new BlueprintPersistenceError('FORM_NOT_INTACT');
    expect(mapDatabaseRefusal(typed)).toBe(typed);
  });
});

describe('B2-B2 variant adapter', () => {
  it('refuses, before any statement, what the pure contracts already refuse', async () => {
    const { tx, calls } = recorder(CATALOGUE);
    expect((await refusedWith(createDraftVariant(tx, { identity: FULL_1, pool: 'FULL_MOCK_1', requirements: [{ ...REQUIREMENTS[0], sourceRefs: [] }] }))).detail.specification).toEqual([{ code: 'OFFICIAL_WITHOUT_SOURCE', key: 'TOTAL_ITEM_COUNT' }]);
    expect((await refusedWith(createDraftVariant(tx, { identity: FULL_1, pool: 'FULL_MOCK_1', requirements: [{ ...REQUIREMENTS[2], policyRef: null }] }))).code).toBe('SPECIFICATION_INVALID');
    expect((await refusedWith(createDraftVariant(tx, { identity: FULL_1, pool: 'FULL_MOCK_1', requirements: [policy('POOL', 'POOL_POLICY', null, 'x'), { ...official('REDUCED_SIZE', 'REDUCED_SIZE', null, 1) }] }))).detail.specification).toEqual([{ code: 'POLICY_KIND_TAGGED_OFFICIAL', key: 'REDUCED_SIZE' }, { code: 'FULL_WITH_REDUCED_SIZE', blueprint: `${EV}:FULL:F1:R1` }]);
    expect((await refusedWith(createDraftVariant(tx, { identity: { ...FULL_1, form: 0 }, pool: 'FULL_MOCK_1', requirements: REQUIREMENTS }))).code).toBe('VARIANT_SET_INVALID');
    expect((await refusedWith(createDraftVariant(tx, { identity: FULL_1, pool: 'FULL_MOCK_2', requirements: REQUIREMENTS }))).code).toBe('POOL_NOT_ALLOWED_FOR_VARIANT');
    // Full form 3 has no pool under the pilot policy: nothing can be created for it
    expect((await refusedWith(createDraftVariant(tx, { identity: { ...FULL_1, form: 3 }, pool: 'FULL_MOCK_2', requirements: REQUIREMENTS }))).code).toBe('POOL_NOT_ALLOWED_FOR_VARIANT');
    expect(calls).toEqual([]);
  });

  it('outside a transaction it refuses before writing', async () => {
    const { tx, sql } = recorder([[/^SAVEPOINT/, pgError('SAVEPOINT can only be used in transaction blocks', { code: '25P01' })]]);
    expect((await refusedWith(createDraftVariant(tx, { identity: FULL_1, pool: 'FULL_MOCK_1', requirements: REQUIREMENTS }))).code).toBe('TRANSACTION_REQUIRED');
    expect(sql()).toEqual(['SAVEPOINT b2_blueprint_persistence']);
  });

  it('writes the variant, each requirement and its sources as one unit, and asks the commit-time source check before returning', async () => {
    let n = 0;
    const { tx, calls, sql } = recorder([...CATALOGUE, [/INSERT INTO assessment_blueprints/, { rows: [{ id: 'bp-1' }] }], [/INSERT INTO assessment_blueprint_requirements/, () => ({ rows: [{ id: `req-${(n += 1)}` }] })]]);
    expect(await createDraftVariant(tx, { identity: FULL_1, pool: 'FULL_MOCK_1', requirements: REQUIREMENTS })).toEqual({ blueprintId: 'bp-1' });
    expect(sql().map((s) => s.split(' ').slice(0, 3).join(' '))).toEqual([
      'SAVEPOINT b2_blueprint_persistence', 'SELECT id, source_key', 'SELECT id, section_key', 'INSERT INTO assessment_blueprints',
      'INSERT INTO assessment_blueprint_requirements', 'INSERT INTO assessment_blueprint_requirement_sources', 'INSERT INTO assessment_blueprint_requirements', 'INSERT INTO assessment_blueprint_requirement_sources', 'INSERT INTO assessment_blueprint_requirements',
      'SET CONSTRAINTS trg_assessment_blueprint_official_source,', 'SET CONSTRAINTS trg_assessment_blueprint_official_source,', 'RELEASE SAVEPOINT b2_blueprint_persistence',
    ]);
    const by = (re: RegExp) => calls.filter((c) => re.test(c.sql));
    // a variant row: purpose, form, revision and pool are stated; the status is the column default (DRAFT)
    expect(by(/INSERT INTO assessment_blueprints/)[0]).toMatchObject({ sql: expect.stringContaining('(exam_version_id, purpose, form_number, revision, pool)'), params: [EV, 'FULL', 1, 1, 'FULL_MOCK_1'] });
    const [total, section, set] = by(/INSERT INTO assessment_blueprint_requirements/).map((c) => c.params);
    expect(total).toEqual(['bp-1', 'TOTAL_ITEM_COUNT', 'TOTAL_ITEM_COUNT', null, '3', 'OFFICIAL', null, null]);
    expect(section).toEqual(['bp-1', 'SECTION_ITEM_COUNT:lectura', 'SECTION_ITEM_COUNT', 'comp-1', '3', 'OFFICIAL', null, null]);
    expect(set).toEqual(['bp-1', 'STIMULUS_SET:lectura', 'STIMULUS_SET', 'comp-1', JSON.stringify({ kind: 'PASSAGE', sets: 1, minItems: 2, maxItems: 2 }), 'STUDYUS_POLICY', 'fixture-policy', '2']);
    expect(by(/INSERT INTO assessment_blueprint_requirement_sources/).map((c) => c.params)).toEqual([['req-1', ['src-1'], ['p. 3']], ['req-2', ['src-1'], ['p. 3']]]);
    expect(by(/SET CONSTRAINTS/).map((c) => c.sql.split(' ').pop())).toEqual(['IMMEDIATE', 'DEFERRED']);
    // the constraint triggers it asks about are the ones migration 7 creates
    for (const name of ['trg_assessment_blueprint_official_source', 'trg_assessment_blueprint_official_source_removed']) expect(M7).toMatch(new RegExp(`CREATE CONSTRAINT TRIGGER ${name} `));
  });

  it('an unknown source or section creates nothing; a database refusal undoes the call and comes back typed', async () => {
    const noSource = recorder([[/FROM assessment_sources/, { rows: [] }], CATALOGUE[1]]);
    expect((await refusedWith(createDraftVariant(noSource.tx, { identity: FULL_1, pool: 'FULL_MOCK_1', requirements: REQUIREMENTS }))).detail.missing).toEqual(['fixture-source']);
    const noSection = recorder([CATALOGUE[0], [/FROM assessment_components/, { rows: [] }]]);
    expect(await refusedWith(createDraftVariant(noSection.tx, { identity: FULL_1, pool: 'FULL_MOCK_1', requirements: REQUIREMENTS }))).toMatchObject({ code: 'UNKNOWN_SECTION', detail: { missing: ['lectura'] } });
    for (const r of [noSource, noSection]) {
      expect(r.sql().some((s) => /^INSERT/.test(s))).toBe(false);
      expect(r.sql().slice(-2)).toEqual(['ROLLBACK TO SAVEPOINT b2_blueprint_persistence', 'RELEASE SAVEPOINT b2_blueprint_persistence']);
    }
    const taken = recorder([...CATALOGUE, [/INSERT INTO assessment_blueprints/, pgError('duplicate key value violates unique constraint', { code: '23505', constraint: 'assessment_blueprints_variant_identity_key' })]]);
    expect((await refusedWith(createDraftVariant(taken.tx, { identity: FULL_1, pool: 'FULL_MOCK_1', requirements: REQUIREMENTS }))).code).toBe('VARIANT_IDENTITY_TAKEN');
    expect(taken.sql().slice(-2)).toEqual(['ROLLBACK TO SAVEPOINT b2_blueprint_persistence', 'RELEASE SAVEPOINT b2_blueprint_persistence']);
    const unsourced = recorder([...CATALOGUE, [/INSERT INTO assessment_blueprints/, { rows: [{ id: 'bp-1' }] }], [/INSERT INTO assessment_blueprint_requirements/, { rows: [{ id: 'req' }] }], [/SET CONSTRAINTS .* IMMEDIATE/, pgError('ASSESSMENT_BLUEPRINT_OFFICIAL_WITHOUT_SOURCE: requirement req')]]);
    expect((await refusedWith(createDraftVariant(unsourced.tx, { identity: FULL_1, pool: 'FULL_MOCK_1', requirements: REQUIREMENTS }))).code).toBe('ASSESSMENT_BLUEPRINT_OFFICIAL_WITHOUT_SOURCE');
  });

  const variantRows = (rows: Array<{ id: string; revision: number; status: string; pool?: string | null }>): Array<[RegExp, Reply]> => [
    [/FROM assessment_blueprints b WHERE/, { rows: rows.map((r) => ({ id: r.id, exam_version_id: EV, purpose: 'FULL', form_number: 1, revision: r.revision, pool: r.pool === undefined ? 'FULL_MOCK_1' : r.pool, status: r.status })) }],
    [/FROM assessment_blueprint_requirements WHERE/, { rows: [
      { id: 'r-1', blueprint_id: 'bp-1', requirement_key: 'SECTION_ITEM_COUNT:lectura', kind: 'SECTION_ITEM_COUNT', assessment_component_id: 'comp-1', value: 3, authority: 'OFFICIAL', policy_id: null, policy_version: null },
      { id: 'r-2', blueprint_id: 'bp-1', requirement_key: 'STIMULUS_SET:lectura', kind: 'STIMULUS_SET', assessment_component_id: 'comp-1', value: { kind: 'PASSAGE', sets: 1, maxItems: 2, minItems: 2 }, authority: 'STUDYUS_POLICY', policy_id: 'fixture-policy', policy_version: '2' },
      { id: 'r-3', blueprint_id: 'bp-1', requirement_key: 'TOTAL_ITEM_COUNT', kind: 'TOTAL_ITEM_COUNT', assessment_component_id: null, value: 3, authority: 'OFFICIAL', policy_id: null, policy_version: null },
      { id: 'r-9', blueprint_id: 'bp-2', requirement_key: 'TOTAL_ITEM_COUNT', kind: 'TOTAL_ITEM_COUNT', assessment_component_id: null, value: 3, authority: 'OFFICIAL', policy_id: null, policy_version: null },
    ] }],
    [/FROM assessment_blueprint_requirement_sources s/, { rows: [{ requirement_id: 'r-1', source_key: 'fixture-source', locator: 'p. 3' }, { requirement_id: 'r-3', source_key: 'fixture-source', locator: null }] }],
    [/FROM assessment_components WHERE exam_version_id = ANY/, { rows: [{ id: 'comp-1', exam_version_id: EV, section_key: 'lectura' }, { id: 'comp-2', exam_version_id: EV, section_key: null }] }],
  ];

  it('loads variants back into BlueprintIdentity / BlueprintSpecification and reports what the pure contracts say about them', async () => {
    const { tx, sql } = recorder(variantRows([{ id: 'bp-1', revision: 1, status: 'PUBLISHED' }, { id: 'bp-2', revision: 2, status: 'PUBLISHED' }]));
    const set = await loadVariants(EV, tx);
    expect(sql().every((s) => s.startsWith('SELECT'))).toBe(true);
    expect(sql()[0]).toMatch(/WHERE b\.exam_version_id = \$1 AND b\.purpose IS NOT NULL ORDER BY b\.purpose, b\.form_number, b\.revision/);
    expect(set.variants.map((v) => [v.blueprintId, v.identity, v.pool])).toEqual([['bp-1', { examVersionId: EV, purpose: 'FULL', form: 1, revision: 1, status: 'PUBLISHED' }, 'FULL_MOCK_1'], ['bp-2', { examVersionId: EV, purpose: 'FULL', form: 1, revision: 2, status: 'PUBLISHED' }, 'FULL_MOCK_1']]);
    expect(set.variants[0].specification.requirements).toEqual([
      { key: 'SECTION_ITEM_COUNT:lectura', kind: 'SECTION_ITEM_COUNT', subject: 'lectura', value: 3, authority: 'OFFICIAL', sourceRefs: ['fixture-source'], policyRef: null, sourceLocators: { 'fixture-source': 'p. 3' } },
      { key: 'STIMULUS_SET:lectura', kind: 'STIMULUS_SET', subject: 'lectura', value: { kind: 'PASSAGE', sets: 1, maxItems: 2, minItems: 2 }, authority: 'STUDYUS_POLICY', sourceRefs: [], policyRef: { id: 'fixture-policy', version: '2' } },
      { key: 'TOTAL_ITEM_COUNT', kind: 'TOTAL_ITEM_COUNT', subject: null, value: 3, authority: 'OFFICIAL', sourceRefs: ['fixture-source'], policyRef: null },
    ]);
    // a section without a key is known by its id
    expect(set.variants[0].componentIdBySubject).toEqual({ lectura: 'comp-1', 'comp-2': 'comp-2' });
    // what was loaded is judged, never assumed: two published revisions of one form, and an OFFICIAL requirement with no source row
    expect(set.setViolations).toEqual([{ code: 'SEVERAL_PUBLISHED_REVISIONS', slot: `${EV}:FULL:F1` }]);
    expect(set.specificationViolations).toEqual({ [`${EV}:FULL:F1:R2`]: [{ code: 'OFFICIAL_WITHOUT_SOURCE', key: 'TOTAL_ITEM_COUNT' }] });
    expect((await loadVariants(EV, recorder().tx)).variants).toEqual([]);
  });

  it('publishes a DRAFT whose stored specification holds; anything else is refused with its reason', async () => {
    const draft = recorder(variantRows([{ id: 'bp-1', revision: 1, status: 'DRAFT' }]));
    await publishVariant(draft.tx, 'bp-1');
    expect(draft.sql().filter((s) => /^UPDATE/.test(s))).toEqual([`UPDATE assessment_blueprints SET status = 'PUBLISHED' WHERE id = $1 AND purpose IS NOT NULL AND status = 'DRAFT'`]);
    expect(draft.sql()[1]).toMatch(/WHERE b\.id = \$1 AND b\.purpose IS NOT NULL/);
    expect((await refusedWith(publishVariant(recorder().tx, 'bp-legacy-or-missing'))).code).toBe('VARIANT_NOT_FOUND');
    expect((await refusedWith(publishVariant(recorder(variantRows([{ id: 'bp-1', revision: 1, status: 'PUBLISHED' }])).tx, 'bp-1'))).code).toBe('NOT_A_DRAFT');
    const unsourced = recorder(variantRows([{ id: 'bp-2', revision: 2, status: 'DRAFT' }]));
    expect(await refusedWith(publishVariant(unsourced.tx, 'bp-2'))).toMatchObject({ code: 'SPECIFICATION_INVALID', detail: { specification: [{ code: 'OFFICIAL_WITHOUT_SOURCE', key: 'TOTAL_ITEM_COUNT' }] } });
    expect(unsourced.sql().some((s) => /^UPDATE/.test(s))).toBe(false);
    const second = recorder([...variantRows([{ id: 'bp-1', revision: 1, status: 'DRAFT' }]), [/^UPDATE assessment_blueprints/, pgError('duplicate key', { code: '23505', constraint: 'assessment_blueprints_one_published_revision' })]]);
    expect((await refusedWith(publishVariant(second.tx, 'bp-1'))).code).toBe('PUBLISHED_REVISION_EXISTS');
    const noPool = recorder([...variantRows([{ id: 'bp-1', revision: 1, status: 'DRAFT' }]), [/^UPDATE assessment_blueprints/, pgError('ASSESSMENT_BLUEPRINT_PUBLISH_NEEDS_POOL: blueprint bp-1')]]);
    expect((await refusedWith(publishVariant(noPool.tx, 'bp-1'))).code).toBe('ASSESSMENT_BLUEPRINT_PUBLISH_NEEDS_POOL');
  });
});

describe('B2-B2 frozen-form adapter', () => {
  const identity: BlueprintIdentity = { ...FULL_1, status: 'PUBLISHED' };
  const A = '00000000-0000-0000-0000-00000000000a';
  const B = '00000000-0000-0000-0000-00000000000b';
  const C = '00000000-0000-0000-0000-00000000000c';
  const SV = '00000000-0000-0000-0000-0000000000f1';
  const positions: FrozenForm['positions'] = [
    { slotIndex: 0, key: `REVIEWED_EXAM_BANK:${A}`, question: { store: 'REVIEWED_EXAM_BANK', id: A }, stimulusVersionId: SV, unitPosition: 1 },
    { slotIndex: 1, key: `REVIEWED_EXAM_BANK:${B}`, question: { store: 'REVIEWED_EXAM_BANK', id: B }, stimulusVersionId: SV, unitPosition: 2 },
    { slotIndex: 2, key: `REVIEWED_EXAM_BANK:${C}`, question: { store: 'REVIEWED_EXAM_BANK', id: C }, stimulusVersionId: null, unitPosition: null },
  ];
  const facts = { identity, pool: 'FULL_MOCK_1' as const, fidelity: 'FULL' as const, positions };
  const FORM: FrozenForm = { v: 2, ...facts, blueprintKey: `${EV}:FULL:F1:R1`, attemptType: 'FULL_MOCK', formHash: frozenFormHash(facts) };
  const variant: Array<[RegExp, Reply]> = [[/FROM assessment_blueprints b WHERE/, { rows: [{ id: 'bp-1', exam_version_id: EV, purpose: 'FULL', form_number: 1, revision: 1, pool: 'FULL_MOCK_1', status: 'PUBLISHED' }] }]];
  const stored = (over: Record<string, unknown> = {}, rows = positions): Array<[RegExp, Reply]> => [
    [/FROM assessment_frozen_forms f JOIN assessment_blueprints b/, { rows: [{ id: 'form-1', blueprint_id: 'bp-1', fidelity: 'FULL', attempt_type: 'FULL_MOCK', pool: 'FULL_MOCK_1', form_hash: null, status: 'DRAFT', frozen_at: null, frozen_by: null, exam_version_id: EV, purpose: 'FULL', form_number: 1, revision: 1, blueprint_status: 'PUBLISHED', ...over }] }],
    [/FROM assessment_frozen_form_positions WHERE form_id/, { rows: rows.map((p) => ({ slot_index: p.slotIndex, approved_item_id: p.question.id, stimulus_version_id: p.stimulusVersionId, unit_position: p.unitPosition })) }],
  ];

  it('form_hash is the pure formHash, verbatim: SHA-256 in lowercase hex, exactly what the column accepts', () => {
    expect(FORM.formHash).toMatch(/^[0-9a-f]{64}$/);
    expect(M8).toContain(`form_hash ~ '^[0-9a-f]{64}$'`);
  });

  it('stores a DRAFT form and its ordered positions, with the stimulus version and the place in the group of each', async () => {
    const { tx, calls, sql } = recorder([...variant, [/INSERT INTO assessment_frozen_forms/, { rows: [{ id: 'form-1' }] }]]);
    expect(await createDraftFrozenForm(tx, { blueprintId: 'bp-1', form: FORM, createdBy: 'user-1' })).toEqual({ formId: 'form-1' });
    const inserts = calls.filter((c) => /^INSERT/.test(c.sql));
    // no status and no hash on insert: the form starts as a DRAFT (the database refuses anything else)
    expect(inserts[0]).toMatchObject({ sql: expect.stringContaining('(blueprint_id, fidelity, attempt_type, pool, created_by)'), params: ['bp-1', 'FULL', 'FULL_MOCK', 'FULL_MOCK_1', 'user-1'] });
    expect(inserts[1].params).toEqual(['form-1', [0, 1, 2], [A, B, C], [SV, SV, null], [1, 2, null]]);
    expect(sql().at(-1)).toBe('RELEASE SAVEPOINT b2_blueprint_persistence');
  });

  it('refuses a form that is not intact, is empty, holds a non-bank question or belongs to another variant -- before writing', async () => {
    const before = recorder(variant);
    expect((await refusedWith(createDraftFrozenForm(before.tx, { blueprintId: 'bp-1', form: { ...FORM, formHash: 'f'.repeat(64) }, createdBy: 'u' }))).code).toBe('FORM_NOT_INTACT');
    const empty = { ...facts, positions: [] };
    expect((await refusedWith(createDraftFrozenForm(before.tx, { blueprintId: 'bp-1', form: { ...FORM, positions: [], formHash: frozenFormHash(empty) }, createdBy: 'u' }))).code).toBe('FORM_NOT_INTACT');
    const cached = { ...facts, positions: [{ ...positions[2], slotIndex: 0, key: 'LEARNING_ITEM_CACHE:x', question: { store: 'LEARNING_ITEM_CACHE' as const, id: 'x' } }] };
    expect((await refusedWith(createDraftFrozenForm(before.tx, { blueprintId: 'bp-1', form: { ...FORM, ...cached, formHash: frozenFormHash(cached) }, createdBy: 'u' }))).code).toBe('NOT_A_BANK_QUESTION');
    expect(before.calls).toEqual([]);
    const other = recorder([[/FROM assessment_blueprints b WHERE/, { rows: [{ id: 'bp-2', exam_version_id: EV, purpose: 'FULL', form_number: 2, revision: 1, pool: 'FULL_MOCK_2', status: 'PUBLISHED' }] }]]);
    expect((await refusedWith(createDraftFrozenForm(other.tx, { blueprintId: 'bp-2', form: FORM, createdBy: 'u' }))).code).toBe('FORM_DOES_NOT_MATCH_VARIANT');
    expect((await refusedWith(createDraftFrozenForm(recorder().tx, { blueprintId: 'bp-legacy', form: FORM, createdBy: 'u' }))).code).toBe('VARIANT_NOT_FOUND');
    for (const r of [other]) expect(r.sql().some((s) => /^INSERT/.test(s))).toBe(false);
    const mismatch = recorder([...variant, [/INSERT INTO assessment_frozen_forms/, { rows: [{ id: 'form-1' }] }], [/INSERT INTO assessment_frozen_form_positions/, pgError('ASSESSMENT_FROZEN_FORM_STIMULUS_MISMATCH: slot 0 does not carry the stimulus version its item version is asked about')]]);
    expect((await refusedWith(createDraftFrozenForm(mismatch.tx, { blueprintId: 'bp-1', form: FORM, createdBy: 'u' }))).code).toBe('ASSESSMENT_FROZEN_FORM_STIMULUS_MISMATCH');
  });

  it('reads a form back into the pure FrozenForm and verifies its digest', async () => {
    const published = await loadFrozenForm('form-1', recorder(stored({ status: 'PUBLISHED', form_hash: FORM.formHash, frozen_at: new Date('2026-10-10T12:00:00Z'), frozen_by: 'user-2' })).tx);
    expect(published).toMatchObject({ formId: 'form-1', blueprintId: 'bp-1', status: 'PUBLISHED', frozenAt: '2026-10-10T12:00:00.000Z', frozenBy: 'user-2', storedHash: FORM.formHash, intact: true });
    expect(published?.form).toEqual(FORM);
    // the rows no longer give the stored digest: reported, never repaired
    const reordered = [{ ...positions[1], slotIndex: 0, unitPosition: 1 }, { ...positions[0], slotIndex: 1, unitPosition: 2 }, positions[2]];
    expect((await loadFrozenForm('form-1', recorder(stored({ status: 'PUBLISHED', form_hash: FORM.formHash }, reordered)).tx))?.intact).toBe(false);
    expect((await loadFrozenForm('form-1', recorder(stored({ status: 'PUBLISHED', form_hash: FORM.formHash, pool: 'FULL_MOCK_2' })).tx))?.intact).toBe(false);
    // a draft has no stored hash; its form carries the digest of the rows as they are
    const draft = await loadFrozenForm('form-1', recorder(stored()).tx);
    expect(draft).toMatchObject({ status: 'DRAFT', storedHash: null, frozenAt: null, intact: true, form: { formHash: FORM.formHash } });
    expect(await loadFrozenForm('nope', recorder().tx)).toBeNull();
  });

  it('publishes with form_hash, frozen_at and frozen_by only when the stored rows give the digest the form was frozen with', async () => {
    const ok = recorder(stored());
    await publishFrozenForm(ok.tx, { formId: 'form-1', formHash: FORM.formHash, frozenBy: 'user-2', frozenAt: '2026-10-10T12:00:00.000Z' });
    expect(ok.calls.filter((c) => /^UPDATE/.test(c.sql))).toEqual([{ sql: `UPDATE assessment_frozen_forms SET status = 'PUBLISHED', form_hash = $2, frozen_at = $3, frozen_by = $4 WHERE id = $1 AND status = 'DRAFT'`, params: ['form-1', FORM.formHash, '2026-10-10T12:00:00.000Z', 'user-2'] }]);
    const changed = recorder(stored({}, positions.slice(0, 2)));
    expect((await refusedWith(publishFrozenForm(changed.tx, { formId: 'form-1', formHash: FORM.formHash, frozenBy: 'u', frozenAt: 't' }))).code).toBe('FORM_CHANGED_SINCE_DRAFT');
    expect(changed.sql().some((s) => /^UPDATE/.test(s))).toBe(false);
    expect((await refusedWith(publishFrozenForm(recorder(stored({ status: 'PUBLISHED', form_hash: FORM.formHash })).tx, { formId: 'form-1', formHash: FORM.formHash, frozenBy: 'u', frozenAt: 't' }))).code).toBe('NOT_A_DRAFT');
    expect((await refusedWith(publishFrozenForm(recorder().tx, { formId: 'nope', formHash: FORM.formHash, frozenBy: 'u', frozenAt: 't' }))).code).toBe('FORM_NOT_FOUND');
    const draftBlueprint = recorder([...stored(), [/^UPDATE assessment_frozen_forms/, pgError('ASSESSMENT_FROZEN_FORM_NEEDS_PUBLISHED_BLUEPRINT: form form-1')]]);
    expect((await refusedWith(publishFrozenForm(draftBlueprint.tx, { formId: 'form-1', formHash: FORM.formHash, frozenBy: 'u', frozenAt: 't' }))).code).toBe('ASSESSMENT_FROZEN_FORM_NEEDS_PUBLISHED_BLUEPRINT');
  });

  it('a published form is immutable: the database refuses and the refusal is typed', async () => {
    const { tx, sql } = recorder([[/^DELETE FROM assessment_frozen_form_positions/, pgError('ASSESSMENT_FROZEN_FORM_IMMUTABLE: form form-1 is PUBLISHED; its positions are fixed')]]);
    expect((await refusedWith(discardDraftFrozenForm(tx, 'form-1'))).code).toBe('ASSESSMENT_FROZEN_FORM_IMMUTABLE');
    expect(sql()).toEqual(['SAVEPOINT b2_blueprint_persistence', 'DELETE FROM assessment_frozen_form_positions WHERE form_id = $1', 'ROLLBACK TO SAVEPOINT b2_blueprint_persistence', 'RELEASE SAVEPOINT b2_blueprint_persistence']);
  });
});

describe('B2-B2 read-only protected inputs', () => {
  it('stimulus exposure: any version of any question ever asked about a stimulus exposes it, in all its versions', async () => {
    const { tx, calls } = recorder([[/to_regclass/, { rows: [{ ready: true }] }], [/FROM exam_item_usage u/, { rows: [{ stimulus_id: 'st-1', stimulus_version_id: 'st-1-v1' }, { stimulus_id: 'st-1', stimulus_version_id: 'st-1-v2' }] }]]);
    const exposed = await loadReviewedBankStimulusExposure('stu-1', '2026-10-10T00:00:00.000Z', tx);
    expect([...exposed.stimulusIds]).toEqual(['st-1']);
    expect([...exposed.stimulusVersionIds]).toEqual(['st-1-v1', 'st-1-v2']);
    const usage = calls.find((c) => /exam_item_usage/.test(c.sql))!;
    expect(usage.params).toEqual(['stu-1', '2026-10-10T00:00:00.000Z']);
    expect(usage.sql).toMatch(/sibling\.bank_item_id = seen\.bank_item_id/);
    expect(usage.sql).toMatch(/every_version\.stimulus_id = v\.stimulus_id/);
    expect(usage.sql).toMatch(/u\.student_id = \$1 AND u\.used_at <= \$2/);
    for (const c of calls) expect(c.sql).toMatch(/^SELECT/);
    // without the stimulus schema nothing is exposed and the ledger is not read
    const absent = recorder([[/to_regclass/, { rows: [{ ready: false }] }]]);
    expect((await loadReviewedBankStimulusExposure('stu-1', '2026-10-10T00:00:00.000Z', absent.tx)).stimulusIds.size).toBe(0);
    expect(absent.calls).toHaveLength(1);
  });

  it('one entry point reads coverage, pools and exposure -- SELECT only, on the executor it was given; a fixed-form read touches no ledger', async () => {
    const forStudent = recorder([[/to_regclass/, { rows: [{ ready: true }] }]]);
    const facts = await loadProtectedSelectionInputs(EV, 'stu-1', '2026-10-10T00:00:00.000Z', forStudent.tx);
    expect(facts).toMatchObject({ examVersionId: EV, coverages: [] });
    expect(forStudent.sql().every((s) => s.startsWith('SELECT'))).toBe(true);
    expect(forStudent.sql().filter((s) => /exam_item_usage/.test(s))).toHaveLength(2);
    expect(forStudent.sql().some((s) => /question_bank_pool_memberships/.test(s))).toBe(true);
    const fixed = recorder([[/to_regclass/, { rows: [{ ready: true }] }]]);
    const none = await loadProtectedSelectionInputs(EV, null, '2026-10-10T00:00:00.000Z', fixed.tx);
    expect(fixed.sql().some((s) => /exam_item_usage/.test(s))).toBe(false);
    expect([none.exposure.size, none.exposedStimuli.stimulusIds.size, none.exposedStimuli.stimulusVersionIds.size]).toEqual([0, 0, 0]);
  });

  it('the B1 coverage reader carries the stimulus kind and the group rule in its one stimulus statement', () => {
    const service = readFileSync(join(ROOT, 'src/lib/assessment-foundation/question-coverage.service.ts'), 'utf8');
    expect(service).toMatch(/st\.kind, v\.selection_min_items, v\.selection_max_items,/);
    expect(service.match(/FROM question_bank_item_stimulus s\n\s+JOIN question_bank_stimulus_versions v/g)).toHaveLength(1);
    expect(service).not.toMatch(/\b(INSERT INTO|UPDATE \w+ SET|DELETE FROM)\b/);
  });

  it('coverage reports the group rule as stored: both NULL = whole, a range = a subset; nothing is defaulted', async () => {
    const item = (id: string) => ({ id, learning_objective_id: 'lo-1', question_type: 'multiple_choice', content: {}, status: 'PUBLISHED', bank_lifecycle_status: 'ACTIVE', usage_eligibility: null, exam_alignment: null, calibration_confidence: null, content_origin: 'AUTHORED', source_ids: null, bank_item_id: `b-${id}`, provenance: 'STUDYUS_AUTHORED', exam_version_id: EV, assessment_component_id: 'comp-1', current_version_id: id, retired: false, language: 'es', structure_version_id: null, academic_subject_id: null, review_count: 1 });
    const link = (id: string, position: number, min: number | null, max: number | null, kind: string) => ({ approved_item_id: id, position, stimulus_version_id: `sv-${kind}`, stimulus_id: `st-${kind}`, lifecycle_status: 'ACTIVE', is_current: true, retired: false, approved: true, kind, selection_min_items: min, selection_max_items: max });
    const { tx } = recorder([[/to_regclass/, { rows: [{ ready: true }] }], [/FROM approved_items ai/, { rows: [item('q-1'), item('q-2'), item('q-3')] }], [/FROM question_bank_item_stimulus s\s+JOIN question_bank_stimulus_versions v/, { rows: [link('q-1', 1, null, null, 'PAIRED_PASSAGE'), link('q-2', 2, 2, 5, 'TABLE')] }]]);
    const byId = new Map((await reviewedExamBankCoverageProvider(tx).load(['q-1', 'q-2', 'q-3'])).map((c) => [c.ref.id, c.stimulus]));
    expect(byId.get('q-1')).toMatchObject({ stimulusId: 'st-PAIRED_PASSAGE', position: 1, kind: 'PAIRED_PASSAGE', selection: null });
    expect(byId.get('q-2')).toMatchObject({ stimulusId: 'st-TABLE', position: 2, kind: 'TABLE', selection: { minItems: 2, maxItems: 5 } });
    expect(byId.get('q-3')).toBeNull();
  });
});
