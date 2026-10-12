/**
 * QF V5.1 -- persistence of construct cores, applicability and item instances, against a REAL PostgreSQL with
 * migration 20261121_1100 applied.
 *
 * It runs only when QF51_TEST_DATABASE_URL names a THROWAWAY database (never DEV, Stage or Production: the
 * migration is not applied to any environment). Without it the suite is skipped, which is not a pass.
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CAMBRIDGE_9709_P1_COMPONENT, CAMBRIDGE_SYSTEM_PROFILE, IB_MATH_AA_HL_P1_COMPONENT, IB_SYSTEM_PROFILE, MATHEMATICS_ADAPTATION_POLICY, MATH_POC_APPLICABILITY, PAA_MATEMATICAS_COMPONENT, PAA_SYSTEM_PROFILE, PISA_MATHEMATICS_COMPONENT, PISA_SYSTEM_PROFILE } from '@/lib/assessment-adaptation';
import { mathPocFamilyOf } from '@/lib/exam-core/question-bank/task-families';
import {
  QUADRATIC_FACTORISING_STRATEGY, adapterOfComponent, composeAssessmentSpecification, createAssessmentSystemRegistry, listRegisteredSystems, persistRegisteredSystem, constructCoreOf, createAssessmentInstanceRenderer, deriveCoreApplicability, getApplicability, getCore, insertCore,
  listCertifiedCores, recordApplicability, registerRenderer, storeInstance, studentEligibleInstances, transitionCore, upsertAdapter, type ConstructCoreRecord, type Queryable,
} from '@/lib/assessment-instance';
import { FIXTURE_VERSION, fixtureRegistry } from './qf51-fixtures';

const URL_ = process.env.QF51_TEST_DATABASE_URL;
const throwaway = !!URL_ && /throwaway/.test(URL_) && /127\.0\.0\.1|localhost/.test(URL_);

const SHORTCUTS = [{ id: 'substitute-the-options', bypass: 'With options to choose from, each one can be substituted into the equation instead of factorising it.', excludedFormats: ['SELECTED_RESPONSE', 'MULTI_SELECT'], instanceRule: null }];
const CERT = { certificationVersion: 'test-cert-1', certifiedBy: 'test-fixture', certifiedAt: '2026-10-12T00:00:00.000Z' };
const base = mathPocFamilyOf('tf.math.quadratic.solve-by-factorising')!;
const VERSION = `1.0.0-test-${process.pid}`;
const coreOf = (lifecycle: 'DRAFT' | 'IN_REVIEW' | 'CERTIFIED'): ConstructCoreRecord => {
  const family = { ...base, version: VERSION, lifecycle, reviewStatus: lifecycle === 'CERTIFIED' ? ('REVIEWED' as const) : lifecycle === 'IN_REVIEW' ? ('IN_REVIEW' as const) : ('UNREVIEWED' as const) };
  const r = constructCoreOf({ family, shortcutConstraints: SHORTCUTS, certification: lifecycle === 'CERTIFIED' ? CERT : undefined });
  if (!r.ok) throw new Error(`${r.issue}: ${r.details.join('; ')}`);
  return r.core;
};
const certifiedProfile = <T extends { status: string; certification: unknown }>(p: T): T => ({ ...p, status: 'CERTIFIED', certification: { certifiedBy: 'test-fixture', certifiedAt: '2026-10-12T00:00:00Z' } });
// the four fixture systems are REGISTERED through the public calls, then persisted: the database knows a system only as a row
const REGISTRY = fixtureRegistry([[IB_SYSTEM_PROFILE, IB_MATH_AA_HL_P1_COMPONENT], [CAMBRIDGE_SYSTEM_PROFILE, CAMBRIDGE_9709_P1_COMPONENT], [PISA_SYSTEM_PROFILE, PISA_MATHEMATICS_COMPONENT], [PAA_SYSTEM_PROFILE, PAA_MATEMATICAS_COMPONENT]].map(([s, c]) => ({ system: certifiedProfile(s as typeof IB_SYSTEM_PROFILE), component: certifiedProfile(c as typeof IB_MATH_AA_HL_P1_COMPONENT) })));

describe.skipIf(!throwaway)('QF V5.1 persistence (throwaway PostgreSQL)', () => {
  let client: pg.Client;
  let db: Queryable;
  beforeAll(async () => {
    client = new pg.Client({ connectionString: URL_ });
    await client.connect();
    db = { query: (sql, params) => client.query(sql, params as unknown[]) };
    for (const s of REGISTRY.systems()) await persistRegisteredSystem(db, REGISTRY, s.systemId);
  });

  it('the registry is rows, not a list: registered systems are stored with their versions and nodes, and a new one needs no schema change', async () => {
    expect((await listRegisteredSystems(db)).filter((s) => ['CAMBRIDGE', 'IB', 'PAA', 'PISA'].includes(s.systemId))).toEqual(['CAMBRIDGE', 'IB', 'PAA', 'PISA'].map((systemId) => ({ systemId, systemType: 'EXAM', lifecycle: 'ACTIVE', versions: [FIXTURE_VERSION] })));
    // a system nobody has heard of: registered and persisted through the same calls
    const other = createAssessmentSystemRegistry();
    const provenance = { basis: 'TEST_FIXTURE', sources: [], recordedBy: 'test-fixture' };
    const id = `TEST_NEW_SYSTEM_${process.pid}`;
    expect(other.registerSystem({ v: 1, systemId: id, displayName: 'A system registered by a test', organization: 'test', region: 'ZZ', systemType: 'NATIONAL_STANDARD', lifecycle: 'ACTIVE', metadata: {}, provenance }).ok).toBe(true);
    expect(other.registerVersion({ v: 1, systemId: id, versionId: 'plan-2031', label: 'Plan 2031', lifecycle: 'ACTIVE', effectiveFrom: '2031-01-01', effectiveTo: null, provenance }).ok).toBe(true);
    expect(other.registerVersion({ v: 1, systemId: id, versionId: 'plan-2025', label: 'Plan 2025', lifecycle: 'RETIRED', effectiveFrom: '2025-01-01', effectiveTo: '2030-12-31', provenance }).ok).toBe(true);
    expect(other.registerNode({ v: 1, nodeId: `${id}.GRADE_9`, systemId: id, versionId: 'plan-2031', kind: 'LEVEL', parentNodeId: null, code: 'GRADE_9', displayName: 'Grade 9' }).ok).toBe(true);
    expect(other.registerNode({ v: 1, nodeId: `${id}.GRADE_9.MATH`, systemId: id, versionId: 'plan-2031', kind: 'COMPONENT', parentNodeId: `${id}.GRADE_9`, code: 'MATH', displayName: 'Mathematics' }).ok).toBe(true);
    await persistRegisteredSystem(db, other, id);
    await persistRegisteredSystem(db, other, id); // idempotent
    expect((await listRegisteredSystems(db)).find((s) => s.systemId === id)).toEqual({ systemId: id, systemType: 'NATIONAL_STANDARD', lifecycle: 'ACTIVE', versions: ['plan-2025', 'plan-2031'] });
    const nodes = await client.query(`SELECT node_id, kind, parent_node_id FROM assessment_system_nodes WHERE system_id = $1 ORDER BY node_id`, [id]);
    expect(nodes.rows).toEqual([{ node_id: `${id}.GRADE_9`, kind: 'LEVEL', parent_node_id: null }, { node_id: `${id}.GRADE_9.MATH`, kind: 'COMPONENT', parent_node_id: `${id}.GRADE_9` }]);
    // the database refuses what the registry refuses
    await expect(client.query(`INSERT INTO assessment_system_versions (system_id, version_id, label, provenance) VALUES ('NOBODY_REGISTERED_THIS', 'v1', 'x', '{"basis":"TEST_FIXTURE"}')`)).rejects.toThrow(/foreign key/);
    await expect(client.query(`INSERT INTO assessment_system_versions (system_id, version_id, label, effective_from, effective_to, provenance) VALUES ($1, 'bad-dates', 'x', '2031-01-01', '2030-01-01', '{"basis":"TEST_FIXTURE"}')`, [id])).rejects.toThrow(/dates_ck/);
    await expect(client.query(`INSERT INTO assessment_system_nodes (node_id, system_id, version_id, kind, code, display_name) VALUES ('IB.STRAY', $1, 'plan-2031', 'COMPONENT', 'STRAY', 'x')`, [id])).rejects.toThrow(/under_system_ck/);
    await expect(client.query(`INSERT INTO assessment_adapters (adapter_id, adapter_version, source, system_id, system_version_id, definition, content_hash) VALUES ($1, 'v1', 'EA1_COMPONENT_PROFILE', $2, 'plan-2031', '{}'::jsonb, $3)`, [`${id}.NOT_A_NODE`, id, 'a'.repeat(64)])).rejects.toThrow(/foreign key/);
  });
  afterAll(async () => { await client?.end(); });

  it('core persistence: a core is stored as a draft and read back identical', async () => {
    const draft = coreOf('DRAFT');
    const stored = await insertCore(db, draft);
    expect(stored).toMatchObject({ constructFamilyId: draft.constructFamilyId, familyVersion: VERSION, lifecycle: 'DRAFT', certification: null, contentHash: draft.contentHash });
    expect(stored.family).toEqual(draft.family);
    expect(await getCore(db, draft.constructFamilyId, VERSION)).toEqual(stored);
    await expect(insertCore(db, draft)).rejects.toThrow(/assessment_construct_cores_version_uq/);
    await expect(insertCore(db, coreOf('CERTIFIED'))).rejects.toThrow(/CORE_IS_CREATED_AS_A_DRAFT/);
    await expect(client.query(`INSERT INTO assessment_construct_cores (construct_family_id, family_version, family_type, canonical_subject, primary_concept_stable_id, lifecycle, certification_version, certified_by, certified_at, family, content_hash) SELECT 'tf.math.x', 'v', family_type, canonical_subject, primary_concept_stable_id, 'CERTIFIED', 'c', 'b', now(), jsonb_set(jsonb_set(family, '{familyId}', '"tf.math.x"'), '{version}', '"v"'), content_hash FROM assessment_construct_cores LIMIT 1`)).rejects.toThrow(/CORE_IS_CREATED_AS_A_DRAFT/);
  });

  it('lifecycle: the database refuses a skipped step and freezes a certified core', async () => {
    const draft = (await getCore(db, base.familyId, VERSION))!;
    await expect(client.query(`UPDATE assessment_construct_cores SET lifecycle = 'CERTIFIED', certification_version = 'x', certified_by = 'y', certified_at = now() WHERE id = $1`, [draft.id])).rejects.toThrow(/CORE_LIFECYCLE_TRANSITION_REFUSED: DRAFT -> CERTIFIED/);
    await expect(transitionCore(db, draft, 'CERTIFIED')).rejects.toThrow(/CORE_LIFECYCLE_TRANSITION_REFUSED/);
    const review = await transitionCore(db, draft, 'UNDER_REVIEW');
    expect(review.lifecycle).toBe('UNDER_REVIEW');
    expect(await listCertifiedCores(db, 'math.alg.quadratics')).toEqual([]);
    const certified = await transitionCore(db, review, 'CERTIFIED', { core: coreOf('CERTIFIED'), certification: CERT });
    expect(certified).toMatchObject({ lifecycle: 'CERTIFIED', certification: CERT });
    expect(certified.family.lifecycle).toBe('CERTIFIED');
    expect((await listCertifiedCores(db, 'math.alg.quadratics')).map((c) => c.familyVersion)).toContain(VERSION);
    await expect(client.query(`UPDATE assessment_construct_cores SET family = jsonb_set(family, '{canonicalSubject}', '"Other"') WHERE id = $1`, [certified.id])).rejects.toThrow(/CERTIFIED_CORE_IS_IMMUTABLE/);
    await expect(client.query(`UPDATE assessment_construct_cores SET lifecycle = 'DRAFT', certification_version = NULL, certified_by = NULL, certified_at = NULL WHERE id = $1`, [certified.id])).rejects.toThrow(/CORE_LIFECYCLE_TRANSITION_REFUSED: CERTIFIED -> DRAFT/);
  });

  it('applicability is persisted per core x adapter, with a reason whenever it is not plainly supported', async () => {
    const core = (await getCore(db, base.familyId, VERSION))!;
    const ib = deriveCoreApplicability(core, { systemProfileId: 'IB', componentId: 'IB.MATH_AA_HL.P1' }, MATH_POC_APPLICABILITY);
    const pisa = deriveCoreApplicability(core, { systemProfileId: 'PISA', componentId: 'PISA.MATHEMATICS' }, MATH_POC_APPLICABILITY);
    const paa = deriveCoreApplicability(core, { systemProfileId: 'PAA', componentId: 'PAA.MATEMATICAS' }, MATH_POC_APPLICABILITY);
    for (const r of [ib, pisa, paa]) await recordApplicability(db, core.id, r);
    expect(await getApplicability(db, core.id, 'IB.MATH_AA_HL.P1')).toMatchObject({ status: 'SUPPORTED', reason: null });
    expect(await getApplicability(db, core.id, 'PISA.MATHEMATICS')).toMatchObject({ status: 'NOT_APPLICABLE' });
    expect(await getApplicability(db, core.id, 'PAA.MATEMATICAS')).toMatchObject({ status: 'CONDITIONAL', constraints: [expect.objectContaining({ kind: 'RESPONSE_FORMAT_ONLY' })] });
    expect(await getApplicability(db, core.id, 'CAMBRIDGE.9709.P1')).toBeNull();
    await expect(client.query(`INSERT INTO assessment_construct_core_applicability (core_id, system_profile_id, adapter_id, status, basis) VALUES ($1, 'X', 'X.Y', 'NOT_APPLICABLE', '{}'::jsonb)`, [core.id])).rejects.toThrow(/reason_ck/);
  });

  it('an instance is stored only from a certified core + certified adapter + certified renderer + supported applicability', async () => {
    const core = (await getCore(db, base.familyId, VERSION))!;
    const renderer = createAssessmentInstanceRenderer([{ ...QUADRATIC_FACTORISING_STRATEGY, status: 'CERTIFIED' }]);
    const make = (system: typeof IB_SYSTEM_PROFILE, component: typeof IB_MATH_AA_HL_P1_COMPONENT, objective: string, seed: string) => {
      const s = certifiedProfile(system); const c = certifiedProfile(component);
      const adapter = REGISTRY.adapter(c.componentId)!;
      const applicability = deriveCoreApplicability(core, { systemProfileId: s.profileId, componentId: c.componentId }, MATH_POC_APPLICABILITY);
      const bucket = { bucketId: `test/${c.componentId}/${objective}#0`, configKey: 'test', sectionKey: c.componentId, adapterId: c.componentId, objectiveCode: objective, primaryConceptStableIds: ['math.alg.quadratics'], responseFormat: null, blueprintClass: 'FULL' as const };
      const spec = composeAssessmentSpecification({ registry: REGISTRY, use: 'STUDENT_DELIVERY', core, adapter, system: s, component: c, coreApplicability: [applicability], applicabilityRegister: MATH_POC_APPLICABILITY, bucket, disciplinePolicy: MATHEMATICS_ADAPTATION_POLICY, request: { purpose: 'PRACTICE', difficultyBand: 'STANDARD', language: 'en', contentUseClass: 'EVIDENCE_BEARING' } });
      if (!spec.ok) throw new Error(`${spec.code}: ${spec.detail}`);
      const r = renderer.render({ registry: REGISTRY, use: 'STUDENT_DELIVERY', core, adapter, applicability, specification: spec.specification, bucket, seed });
      if (!r.ok) throw new Error(`${r.code}: ${r.detail}`);
      return { adapter, applicability, bucket, instance: r.instance };
    };
    const ib = make(IB_SYSTEM_PROFILE, IB_MATH_AA_HL_P1_COMPONENT, 'aahl.p1.functions', 'db-1');

    // nothing registered yet: no adapter row -> foreign key; then adapter provisional -> refused by the guard
    await registerRenderer(db, { ...QUADRATIC_FACTORISING_STRATEGY, status: 'PROVISIONAL' });
    await upsertAdapter(db, { ...ib.adapter, status: 'PROVISIONAL' });
    await expect(storeInstance(db, core.id, ib.instance)).rejects.toThrow(/INSTANCE_NEEDS_A_CERTIFIED_ADAPTER/);
    await upsertAdapter(db, ib.adapter);
    await expect(storeInstance(db, core.id, ib.instance)).rejects.toThrow(/INSTANCE_NEEDS_A_CERTIFIED_RENDERER/);
    await registerRenderer(db, { ...QUADRATIC_FACTORISING_STRATEGY, status: 'CERTIFIED' });

    const id = await storeInstance(db, core.id, ib.instance);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    // the same controlled input is the same instance: stored once
    expect(await storeInstance(db, core.id, ib.instance)).toBeNull();
    expect((await studentEligibleInstances(db, ib.bucket.bucketId)).map((x) => x.parameterSetId)).toEqual([ib.instance.lineage.parameterSetId]);

    // Cambridge: supported by the family, but no applicability row was recorded for it -> refused
    const cambridge = make(CAMBRIDGE_SYSTEM_PROFILE as never, CAMBRIDGE_9709_P1_COMPONENT as never, 'aice.9709.p1.quadratics', 'db-1');
    await upsertAdapter(db, cambridge.adapter);
    await expect(storeInstance(db, core.id, cambridge.instance)).rejects.toThrow(/INSTANCE_HAS_NO_EXPLICIT_APPLICABILITY/);
    // PISA: recorded NOT_APPLICABLE -> refused even if someone forges an instance for it
    const pisaAdapter = REGISTRY.adapter('PISA.MATHEMATICS')!;
    await upsertAdapter(db, pisaAdapter);
    // an adapter view that no registry bound to a system version is not storable at all
    await expect(upsertAdapter(db, adapterOfComponent(certifiedProfile(PISA_SYSTEM_PROFILE), certifiedProfile(PISA_MATHEMATICS_COMPONENT))!)).rejects.toThrow(/ADAPTER_IS_NOT_BOUND_TO_A_SYSTEM_VERSION/);
    // lineage that names another system than the adapter's own is refused
    await expect(storeInstance(db, core.id, { ...ib.instance, lineage: { ...ib.instance.lineage, assessmentAdapterId: pisaAdapter.adapterId, assessmentAdapterVersion: pisaAdapter.version } })).rejects.toThrow(/INSTANCE_SYSTEM_IS_NOT_THE_ADAPTER_SYSTEM/);
    const forged = { ...ib.instance, lineage: { ...ib.instance.lineage, assessmentSystemId: 'PISA', assessmentSystemVersionId: FIXTURE_VERSION, assessmentAdapterId: pisaAdapter.adapterId, assessmentAdapterVersion: pisaAdapter.version } };
    await expect(storeInstance(db, core.id, forged)).rejects.toThrow(/INSTANCE_OF_A_NOT_APPLICABLE_COMBINATION/);
    await expect(storeInstance(db, core.id, { ...ib.instance, lineage: { ...ib.instance.lineage, certificationVersion: 'older', seed: 'x', parameterSetId: 'a'.repeat(64) } })).rejects.toThrow(/INSTANCE_CERTIFICATION_VERSION_MISMATCH/);
    await expect(client.query(`UPDATE assessment_item_instances SET seed = 'changed' WHERE id = $1`, [id])).rejects.toThrow(/ITEM_INSTANCE_IS_IMMUTABLE/);
  });

  it('legacy items stay LEGACY and out of Student supply; retiring a core takes its instances out of supply', async () => {
    // every existing row is LEGACY (a throwaway database may hold none); the column defaults to LEGACY and CORE_DERIVED needs an instance
    const legacy = await client.query(`SELECT lineage_class, count(*)::int n FROM question_bank_items GROUP BY 1`);
    expect(legacy.rows.filter((r) => r.lineage_class !== 'LEGACY')).toEqual([]);
    const column = await client.query(`SELECT column_default, is_nullable FROM information_schema.columns WHERE table_name = 'question_bank_items' AND column_name = 'lineage_class'`);
    expect(column.rows).toEqual([{ column_default: "'LEGACY'::text", is_nullable: 'NO' }]);
    const check = await client.query(`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'question_bank_items_lineage_ck'`);
    expect(check.rows[0].def).toMatch(/CORE_DERIVED[\s\S]*item_instance_id IS NOT NULL/);
    if (legacy.rows.length > 0) await expect(client.query(`UPDATE question_bank_items SET lineage_class = 'CORE_DERIVED'`)).rejects.toThrow(/question_bank_items_lineage_ck/);
    const core = (await getCore(db, base.familyId, VERSION))!;
    const before = await client.query(`SELECT count(*)::int n FROM student_eligible_item_instances WHERE core_id = $1`, [core.id]);
    expect(before.rows[0].n).toBe(1);
    // a system version that is retired supplies nothing; reactivated, its instances are in supply again
    await client.query(`UPDATE assessment_system_versions SET lifecycle = 'RETIRED' WHERE system_id = 'IB' AND version_id = $1`, [FIXTURE_VERSION]);
    expect((await client.query(`SELECT count(*)::int n FROM student_eligible_item_instances WHERE core_id = $1`, [core.id])).rows[0].n).toBe(0);
    await client.query(`UPDATE assessment_system_versions SET lifecycle = 'ACTIVE' WHERE system_id = 'IB' AND version_id = $1`, [FIXTURE_VERSION]);
    expect((await client.query(`SELECT count(*)::int n FROM student_eligible_item_instances WHERE core_id = $1`, [core.id])).rows[0].n).toBe(1);
    await transitionCore(db, core, 'RETIRED');
    const after = await client.query(`SELECT count(*)::int n FROM student_eligible_item_instances WHERE core_id = $1`, [core.id]);
    expect(after.rows[0].n).toBe(0);
    expect((await listCertifiedCores(db)).some((c) => c.familyVersion === VERSION)).toBe(false);
  });
});
