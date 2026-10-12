/**
 * QF V5.1 -- the Assessment System Registry and the extensibility acceptance test.
 *
 * TEST_NEW_SYSTEM is a system no file under src/ has heard of. It is added here with the same public calls a real
 * system uses -- register system, version, context nodes, adapter, applicability, blueprint bucket -- and an item
 * instance is rendered for it. If that needed one line of Factory code to change, this file could not pass.
 */
import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { IB_MATH_AA_HL_P1_COMPONENT, IB_SYSTEM_PROFILE, PAA_MATEMATICAS_COMPONENT, PAA_SYSTEM_PROFILE, MATHEMATICS_ADAPTATION_POLICY, MATH_POC_APPLICABILITY, type AssessmentComponentProfile, type AssessmentSystemProfile } from '@/lib/assessment-adaptation';
import { mathPocFamilyOf } from '@/lib/exam-core/question-bank/task-families';
import {
  ASSESSMENT_ADAPTERS, ASSESSMENT_SYSTEM_TYPES, QUADRATIC_FACTORISING_STRATEGY, STUDYUS_ASSESSMENT_REGISTRY, adapterMayFeedStudentDelivery, adapterOfComponent, composeAssessmentSpecification, constructCoreOf,
  createAssessmentInstanceRenderer, createAssessmentSystemRegistry, deriveCoreApplicability, lineageClassOf, systemGate, type BlueprintBucketRef,
} from '@/lib/assessment-instance';
import { certifiedProfile, fixtureRegistry } from './qf51-fixtures';

const ROOT = path.join(__dirname, '..', '..');
const DIR = 'src/lib/assessment-instance';
const PROVENANCE = { basis: 'TEST_FIXTURE' as const, sources: [], recordedBy: 'test-fixture' };
const CERTIFICATION = { certifiedBy: 'test-fixture', certifiedAt: '2026-10-12T00:00:00Z' };
const SHORTCUTS = [{ id: 'substitute-the-options', bypass: 'With options to choose from, each one can be substituted into the equation instead of factorising it.', excludedFormats: ['SELECTED_RESPONSE', 'MULTI_SELECT'], instanceRule: 'A numeric response asks for one stated root, so the response has one value.' }];
const core = (() => {
  const family = { ...mathPocFamilyOf('tf.math.quadratic.solve-by-factorising')!, version: '1.0.0-test-certified', lifecycle: 'CERTIFIED' as const, reviewStatus: 'REVIEWED' as const };
  const r = constructCoreOf({ family, shortcutConstraints: SHORTCUTS, certification: { certificationVersion: 'test-cert-1', ...CERTIFICATION } });
  if (!r.ok) throw new Error(r.issue);
  return r.core;
})();

// ------------------------------------------------------------------ TEST_NEW_SYSTEM: data only, authored in this test
const SYSTEM_ID = 'TEST_NEW_SYSTEM';
const COMPONENT_ID = 'TEST_NEW_SYSTEM.MATH.GRADE_10.PAPER_A';
const fixtureRule = <R extends { ruleId: string; value: unknown }>(prefix: string, r: R) => ({ ruleId: `${prefix}.${r.ruleId.split('.').slice(1).join('.')}`, value: r.value, authority: { kind: 'STUDYUS_POLICY' as const, provisional: true, assumption: 'Rule of a system that exists only in this test.' } });
// its rules are a one-mark, answer-only paper: copied as values from an existing profile, owned by nobody real
const TNS_SYSTEM = {
  ...PAA_SYSTEM_PROFILE, profileId: SYSTEM_ID, version: '1.0.0-test', displayName: 'Test New System', examFamilyCode: null, status: 'CERTIFIED', certification: CERTIFICATION,
  specification: { basis: 'STUDYUS_POLICY_ONLY', records: [], note: 'A system registered by a test; it describes no real assessment.' },
  rules: Object.fromEntries(Object.entries(PAA_SYSTEM_PROFILE.rules).map(([k, r]) => [k, fixtureRule('tns', r as { ruleId: string; value: unknown })])),
} as unknown as AssessmentSystemProfile;
const TNS_COMPONENT = {
  ...PAA_MATEMATICAS_COMPONENT, componentId: COMPONENT_ID, version: '1.0.0-test', systemProfileId: SYSTEM_ID, displayName: 'Test New System — Mathematics, Grade 10, Paper A', localSubject: 'Mathematics', status: 'CERTIFIED', certification: CERTIFICATION,
  specification: { basis: 'STUDYUS_POLICY_ONLY', records: [], note: 'A component registered by a test.' }, versionBinding: null, semanticComponentKey: null,
  overrides: {
    responseFormats: fixtureRule('tns.paper-a', { ruleId: 'x.response-formats', value: ['NUMERIC_ENTRY'] }),
    calculatorPolicy: fixtureRule('tns.paper-a', { ruleId: 'x.calculator', value: { allowed: ['NONE'] } }),
  },
} as unknown as AssessmentComponentProfile;

function registerTestNewSystem() {
  const registry = createAssessmentSystemRegistry();
  const results = [
    registry.registerSystem({ v: 1, systemId: SYSTEM_ID, displayName: 'Test New System', organization: 'A ministry that does not exist', region: 'ZZ', systemType: 'NATIONAL_STANDARD', lifecycle: 'ACTIVE', metadata: { note: 'test only' }, provenance: PROVENANCE }),
    registry.registerVersion({ v: 1, systemId: SYSTEM_ID, versionId: 'plan-2031', label: 'Plan 2031', lifecycle: 'ACTIVE', effectiveFrom: '2031-01-01', effectiveTo: null, provenance: PROVENANCE }),
    registry.registerNode({ v: 1, nodeId: 'TEST_NEW_SYSTEM.MATH', systemId: SYSTEM_ID, versionId: 'plan-2031', kind: 'SUBJECT', parentNodeId: null, code: 'MATH', displayName: 'Mathematics' }),
    registry.registerNode({ v: 1, nodeId: 'TEST_NEW_SYSTEM.MATH.GRADE_10', systemId: SYSTEM_ID, versionId: 'plan-2031', kind: 'LEVEL', parentNodeId: 'TEST_NEW_SYSTEM.MATH', code: 'GRADE_10', displayName: 'Grade 10' }),
    registry.registerNode({ v: 1, nodeId: COMPONENT_ID, systemId: SYSTEM_ID, versionId: 'plan-2031', kind: 'COMPONENT', parentNodeId: 'TEST_NEW_SYSTEM.MATH.GRADE_10', code: 'PAPER_A', displayName: 'Paper A' }),
    registry.registerAdapter({ versionId: 'plan-2031', definition: { kind: 'EA1_PROFILE_PAIR', system: TNS_SYSTEM, component: TNS_COMPONENT } }),
  ];
  return { registry, results };
}
/** The concept register entry: an existing record, re-scoped. It records that the concept is assessed by the new component. */
const TNS_CONCEPT_RECORD = { ...MATH_POC_APPLICABILITY.find((r) => r.concept.stableId === 'math.alg.quadratics' && r.scope.systemProfileId === 'IB')!, scope: { systemProfileId: SYSTEM_ID, subject: 'Mathematics', componentId: COMPONENT_ID } };
const TNS_BUCKET: BlueprintBucketRef = { bucketId: `test.tns/${COMPONENT_ID}/tns.math.g10.quadratics#0`, configKey: 'test.tns', sectionKey: COMPONENT_ID, adapterId: COMPONENT_ID, objectiveCode: 'tns.math.g10.quadratics', primaryConceptStableIds: ['math.alg.quadratics'], responseFormat: null, blueprintClass: 'FULL' };

describe('the registry holds systems as registered data', () => {
  it('registers a system, its versions and a context hierarchy; refuses what is not registered or is registered twice', () => {
    const { registry, results } = registerTestNewSystem();
    expect(results.map((r) => (r.ok ? 'ok' : `${r.code}: ${r.detail}`))).toEqual(['ok', 'ok', 'ok', 'ok', 'ok', 'ok']);
    expect(registry.system(SYSTEM_ID)).toMatchObject({ systemType: 'NATIONAL_STANDARD', region: 'ZZ', lifecycle: 'ACTIVE', organization: 'A ministry that does not exist' });
    expect(registry.lineageOf(COMPONENT_ID).map((n) => `${n.kind}:${n.code}`)).toEqual(['COMPONENT:PAPER_A', 'LEVEL:GRADE_10', 'SUBJECT:MATH']);
    const again = (r: { ok: boolean; code?: string }) => (r.ok ? 'ok' : r.code);
    expect(again(registry.registerSystem({ v: 1, systemId: SYSTEM_ID, displayName: 'x', organization: 'x', region: null, systemType: 'EXAM', lifecycle: 'ACTIVE', metadata: {}, provenance: PROVENANCE }))).toBe('SYSTEM_ALREADY_REGISTERED');
    expect(again(registry.registerVersion({ v: 1, systemId: 'NOBODY', versionId: 'v1', label: 'x', lifecycle: 'ACTIVE', effectiveFrom: null, effectiveTo: null, provenance: PROVENANCE }))).toBe('SYSTEM_NOT_REGISTERED');
    expect(again(registry.registerVersion({ v: 1, systemId: SYSTEM_ID, versionId: 'plan-2031', label: 'x', lifecycle: 'ACTIVE', effectiveFrom: null, effectiveTo: null, provenance: PROVENANCE }))).toBe('VERSION_ALREADY_REGISTERED');
    expect(again(registry.registerVersion({ v: 1, systemId: SYSTEM_ID, versionId: 'bad', label: 'x', lifecycle: 'ACTIVE', effectiveFrom: '2031-01-01', effectiveTo: '2030-01-01', provenance: PROVENANCE }))).toBe('RECORD_INVALID');
    expect(again(registry.registerNode({ v: 1, nodeId: 'OTHER.MATH', systemId: SYSTEM_ID, versionId: 'plan-2031', kind: 'SUBJECT', parentNodeId: null, code: 'MATH', displayName: 'x' }))).toBe('NODE_IS_NOT_UNDER_ITS_SYSTEM');
    expect(again(registry.registerNode({ v: 1, nodeId: 'TEST_NEW_SYSTEM.SCI.P1', systemId: SYSTEM_ID, versionId: 'plan-2031', kind: 'COMPONENT', parentNodeId: 'TEST_NEW_SYSTEM.SCI', code: 'P1', displayName: 'x' }))).toBe('PARENT_NODE_NOT_REGISTERED');
    expect(again(registry.registerNode({ v: 1, nodeId: 'TEST_NEW_SYSTEM.MATH.GRADE_10.PAPER_A.X', systemId: SYSTEM_ID, versionId: 'plan-2031', kind: 'COMPONENT', parentNodeId: COMPONENT_ID, code: 'X', displayName: 'x' }))).toBe('COMPONENT_CANNOT_HAVE_CHILDREN');
    expect(again(registry.registerAdapter({ versionId: 'plan-2031', definition: { kind: 'EA1_PROFILE_PAIR', system: TNS_SYSTEM, component: TNS_COMPONENT } }))).toBe('ADAPTER_ALREADY_REGISTERED');
    // an adapter cannot be registered for a system, a version or a component nobody registered
    expect(again(createAssessmentSystemRegistry().registerAdapter({ versionId: 'plan-2031', definition: { kind: 'EA1_PROFILE_PAIR', system: TNS_SYSTEM, component: TNS_COMPONENT } }))).toBe('SYSTEM_NOT_REGISTERED');
    expect(again(registry.registerAdapter({ versionId: 'plan-1999', definition: { kind: 'EA1_PROFILE_PAIR', system: TNS_SYSTEM, component: TNS_COMPONENT } }))).toBe('VERSION_NOT_REGISTERED');
  });

  it('a version is not a system: several versions of one system, each with its effective dates', () => {
    const { registry } = registerTestNewSystem();
    expect(registry.registerVersion({ v: 1, systemId: SYSTEM_ID, versionId: 'plan-2025', label: 'Plan 2025', lifecycle: 'ACTIVE', effectiveFrom: '2025-01-01', effectiveTo: '2030-12-31', provenance: PROVENANCE }).ok).toBe(true);
    expect(registry.registerVersion({ v: 1, systemId: SYSTEM_ID, versionId: 'plan-2019', label: 'Plan 2019', lifecycle: 'RETIRED', effectiveFrom: '2019-01-01', effectiveTo: '2024-12-31', provenance: PROVENANCE }).ok).toBe(true);
    expect(registry.systems().map((s) => s.systemId)).toEqual([SYSTEM_ID]);
    expect(registry.versions(SYSTEM_ID).map((v) => v.versionId).sort()).toEqual(['plan-2019', 'plan-2025', 'plan-2031']);
    expect(registry.versionInForce(SYSTEM_ID, '2027-06-01')?.versionId).toBe('plan-2025');
    expect(registry.versionInForce(SYSTEM_ID, '2032-06-01')?.versionId).toBe('plan-2031');
    expect(registry.versionInForce(SYSTEM_ID, '2022-06-01')).toBe(null); // retired
    expect(registry.versionInForce('NOBODY', '2027-06-01')).toBe(null);
  });

  it('every kind of system is registrable, not only examinations', () => {
    const registry = createAssessmentSystemRegistry();
    for (const [i, systemType] of ASSESSMENT_SYSTEM_TYPES.entries()) expect(registry.registerSystem({ v: 1, systemId: `KIND_${i}`, displayName: systemType, organization: 'x', region: null, systemType, lifecycle: 'DRAFT', metadata: {}, provenance: PROVENANCE }).ok, systemType).toBe(true);
    expect([...ASSESSMENT_SYSTEM_TYPES]).toEqual(['EXAM', 'CURRICULUM', 'QUALIFICATION', 'NATIONAL_STANDARD', 'INSTITUTIONAL', 'HYBRID']);
  });
});

describe('today\'s systems are registrations, and the adapter resolves through them', () => {
  it('the shipped registry holds the known systems as rows, each with a version; AICE is a qualification of Cambridge', () => {
    const systems = STUDYUS_ASSESSMENT_REGISTRY.systems();
    expect(systems.map((s) => s.systemId).sort()).toEqual(['AICE', 'CAMBRIDGE', 'IB', 'ICFES', 'PAA', 'PISA']);
    for (const s of systems) expect(STUDYUS_ASSESSMENT_REGISTRY.versions(s.systemId).length, s.systemId).toBe(1);
    expect(STUDYUS_ASSESSMENT_REGISTRY.system('AICE')).toMatchObject({ systemType: 'QUALIFICATION', metadata: { qualificationOfSystem: 'CAMBRIDGE' } });
  });
  it('every adapter is the adapter of a registered system version; an unbound view is refused everywhere', () => {
    expect(ASSESSMENT_ADAPTERS.length).toBe(STUDYUS_ASSESSMENT_REGISTRY.adapters().length);
    for (const a of ASSESSMENT_ADAPTERS) {
      expect(a.adapterId.startsWith(`${a.systemId}.`), a.adapterId).toBe(true);
      expect(STUDYUS_ASSESSMENT_REGISTRY.version(a.systemId, a.systemVersionId ?? ''), a.adapterId).not.toBe(null);
      expect(STUDYUS_ASSESSMENT_REGISTRY.node(a.adapterId, a.systemVersionId ?? '')?.kind).toBe('COMPONENT');
      expect(systemGate(STUDYUS_ASSESSMENT_REGISTRY, a, 'DEV_TEST').ok, a.adapterId).toBe(true);
      expect(adapterMayFeedStudentDelivery(a), a.adapterId).toBe(false); // none is certified
    }
    const view = adapterOfComponent(certifiedProfile(IB_SYSTEM_PROFILE), certifiedProfile(IB_MATH_AA_HL_P1_COMPONENT))!;
    expect(view.systemVersionId).toBe(null);
    expect(adapterMayFeedStudentDelivery(view)).toBe(false);
    expect(systemGate(STUDYUS_ASSESSMENT_REGISTRY, view, 'DEV_TEST')).toMatchObject({ ok: false, code: 'ASSESSMENT_SYSTEM_VERSION_NOT_REGISTERED' });
    expect(systemGate(createAssessmentSystemRegistry(), view, 'DEV_TEST')).toMatchObject({ ok: false, code: 'ASSESSMENT_SYSTEM_NOT_REGISTERED' });
  });
  it('an adapter registered in one registry is not usable through another; a retired system version supplies no Student', () => {
    const mine = fixtureRegistry([{ system: certifiedProfile(IB_SYSTEM_PROFILE), component: certifiedProfile(IB_MATH_AA_HL_P1_COMPONENT) }]);
    const adapter = mine.adapter('IB.MATH_AA_HL.P1')!;
    expect(systemGate(mine, adapter, 'STUDENT_DELIVERY').ok).toBe(true);
    expect(systemGate(STUDYUS_ASSESSMENT_REGISTRY, adapter, 'STUDENT_DELIVERY')).toMatchObject({ ok: false, code: 'ASSESSMENT_SYSTEM_VERSION_NOT_REGISTERED' });
    const retired = createAssessmentSystemRegistry();
    retired.registerSystem({ v: 1, systemId: 'IB', displayName: 'x', organization: 'x', region: null, systemType: 'EXAM', lifecycle: 'ACTIVE', metadata: {}, provenance: PROVENANCE });
    retired.registerVersion({ v: 1, systemId: 'IB', versionId: 'test-certified', label: 'x', lifecycle: 'RETIRED', effectiveFrom: null, effectiveTo: null, provenance: PROVENANCE });
    retired.registerNode({ v: 1, nodeId: 'IB.MATH_AA_HL.P1', systemId: 'IB', versionId: 'test-certified', kind: 'COMPONENT', parentNodeId: null, code: 'MATH_AA_HL.P1', displayName: 'x' });
    const old = retired.registerAdapter({ versionId: 'test-certified', definition: { kind: 'EA1_PROFILE_PAIR', system: certifiedProfile(IB_SYSTEM_PROFILE), component: certifiedProfile(IB_MATH_AA_HL_P1_COMPONENT) } });
    if (!old.ok) throw new Error(old.code);
    expect(systemGate(retired, old.value, 'STUDENT_DELIVERY')).toMatchObject({ ok: false, code: 'ASSESSMENT_SYSTEM_NOT_ACTIVE' });
    expect(systemGate(retired, old.value, 'DEV_TEST').ok).toBe(true);
  });
});

describe('TEST_NEW_SYSTEM: register -> version -> adapter -> applicability -> blueprint -> rendered instance', () => {
  const { registry } = registerTestNewSystem();
  const adapter = registry.adapter(COMPONENT_ID)!;
  const register = [...MATH_POC_APPLICABILITY, TNS_CONCEPT_RECORD];
  const target = { systemProfileId: SYSTEM_ID, componentId: COMPONENT_ID };
  const declared = { constraints: [], declaredBy: 'test-fixture', reason: 'Paper A asks for a single numeric answer, which this construct can give by naming one root.' };
  const applicability = deriveCoreApplicability(core, target, register, undefined, declared);
  const compose = (over: Partial<Parameters<typeof composeAssessmentSpecification>[0]> = {}) => composeAssessmentSpecification({
    registry, use: 'STUDENT_DELIVERY', core, adapter, system: TNS_SYSTEM, component: TNS_COMPONENT, coreApplicability: [applicability], applicabilityRegister: register, bucket: TNS_BUCKET, disciplinePolicy: MATHEMATICS_ADAPTATION_POLICY,
    request: { purpose: 'PRACTICE', difficultyBand: 'STANDARD', language: 'en', contentUseClass: 'EVIDENCE_BEARING' }, ...over,
  });
  const renderer = createAssessmentInstanceRenderer([{ ...QUADRATIC_FACTORISING_STRATEGY, status: 'CERTIFIED' }]);

  it('the adapter is the registered adapter of the new system version, in the same contract as every other', () => {
    expect(adapter).toMatchObject({ adapterId: COMPONENT_ID, systemId: SYSTEM_ID, systemVersionId: 'plan-2031', status: 'CERTIFIED', source: 'EA1_COMPONENT_PROFILE', examFamily: null, responseFormats: ['NUMERIC_ENTRY'], calculator: ['NONE'] });
    expect(Object.keys(adapter).sort()).toEqual(Object.keys(ASSESSMENT_ADAPTERS[0]).sort());
    expect(adapterMayFeedStudentDelivery(adapter)).toBe(true);
  });

  it('applicability is recorded explicitly; the core is not edited to learn about the system', () => {
    expect(core.family.profileSupport[SYSTEM_ID]).toBeUndefined();
    // silent family + no declaration, or no concept record: NOT_APPLICABLE, with the reason
    expect(deriveCoreApplicability(core, target, register)).toMatchObject({ status: 'NOT_APPLICABLE', reason: expect.stringMatching(/declares no support/) });
    expect(deriveCoreApplicability(core, target, MATH_POC_APPLICABILITY, undefined, declared)).toMatchObject({ status: 'NOT_APPLICABLE', reason: expect.stringMatching(/Nothing recorded establishes/) });
    expect(applicability).toMatchObject({ status: 'SUPPORTED', systemProfileId: SYSTEM_ID, componentId: COMPONENT_ID, basis: { behaviourSupport: 'SUPPORTED', behaviourSupportDeclaredBy: 'APPLICABILITY_RECORD', conceptApplicability: { status: 'ESTABLISHED' } } });
    // what the family itself says is never overridden from outside: PISA stays NOT_APPLICABLE whatever is declared
    expect(deriveCoreApplicability(core, { systemProfileId: 'PISA', componentId: 'PISA.MATHEMATICS' }, MATH_POC_APPLICABILITY, undefined, declared).status).toBe('NOT_APPLICABLE');
    expect(deriveCoreApplicability(core, { systemProfileId: 'IB', componentId: 'IB.MATH_AA_HL.P1' }, MATH_POC_APPLICABILITY, undefined, declared).basis.behaviourSupportDeclaredBy).toBeUndefined();
  });

  it('composes a specification and renders a complete instance, with the system and its version in the lineage', () => {
    const spec = compose();
    if (!spec.ok) throw new Error(`${spec.code}: ${spec.detail}`);
    expect(spec.specification.componentProfile?.componentId).toBe(COMPONENT_ID);
    const r = renderer.render({ registry, use: 'STUDENT_DELIVERY', core, adapter, applicability: spec.applicability, specification: spec.specification, bucket: spec.bucket, seed: 'tns-001' });
    if (!r.ok) throw new Error(`${r.code}: ${r.detail}`);
    expect(r.instance.learner).toMatchObject({ language: 'en', itemType: 'NUMERIC_ENTRY', marks: 1, options: [] });
    expect(r.instance.key.answers).toHaveLength(1);
    expect(r.instance.lineage).toMatchObject({ assessmentSystemId: SYSTEM_ID, assessmentSystemVersionId: 'plan-2031', assessmentAdapterId: COMPONENT_ID, blueprintBucketId: TNS_BUCKET.bucketId, constructFamilyId: 'tf.math.quadratic.solve-by-factorising', primaryConceptId: 'math.alg.quadratics' });
    expect(lineageClassOf(r.instance.lineage)).toBe('CORE_DERIVED');
    // the same construct as the instance of any other system: same seed, same mathematics
    const others = fixtureRegistry([{ system: certifiedProfile(IB_SYSTEM_PROFILE), component: certifiedProfile(IB_MATH_AA_HL_P1_COMPONENT) }]);
    const ibAdapter = others.adapter('IB.MATH_AA_HL.P1')!;
    const ibApplicability = deriveCoreApplicability(core, { systemProfileId: 'IB', componentId: 'IB.MATH_AA_HL.P1' }, MATH_POC_APPLICABILITY);
    const ibBucket = { ...TNS_BUCKET, bucketId: 'test/IB.MATH_AA_HL.P1/aahl.p1.functions#0', sectionKey: 'IB.MATH_AA_HL.P1', adapterId: 'IB.MATH_AA_HL.P1', objectiveCode: 'aahl.p1.functions' };
    const ibSpec = composeAssessmentSpecification({ registry: others, use: 'STUDENT_DELIVERY', core, adapter: ibAdapter, system: certifiedProfile(IB_SYSTEM_PROFILE), component: certifiedProfile(IB_MATH_AA_HL_P1_COMPONENT), coreApplicability: [ibApplicability], applicabilityRegister: MATH_POC_APPLICABILITY, bucket: ibBucket, disciplinePolicy: MATHEMATICS_ADAPTATION_POLICY, request: { purpose: 'PRACTICE', difficultyBand: 'STANDARD', language: 'en', contentUseClass: 'EVIDENCE_BEARING' } });
    if (!ibSpec.ok) throw new Error(ibSpec.code);
    const ib = renderer.render({ registry: others, use: 'STUDENT_DELIVERY', core, adapter: ibAdapter, applicability: ibSpec.applicability, specification: ibSpec.specification, bucket: ibSpec.bucket, seed: 'tns-001' });
    if (!ib.ok) throw new Error(ib.code);
    expect(ib.instance.lineage.parameterSetId).toBe(r.instance.lineage.parameterSetId);
    expect(ibSpec.specification.invariantHash).toBe(spec.specification.invariantHash);
    expect(ib.instance.learner.prompt).not.toBe(r.instance.learner.prompt);
    expect(ib.instance.lineage.assessmentSystemId).toBe('IB');
  });

  it('without its registrations the same data is refused at each step', () => {
    expect(compose({ registry: createAssessmentSystemRegistry() })).toMatchObject({ ok: false, code: 'ASSESSMENT_SYSTEM_NOT_REGISTERED' });
    expect(compose({ registry: STUDYUS_ASSESSMENT_REGISTRY })).toMatchObject({ ok: false, code: 'ASSESSMENT_SYSTEM_NOT_REGISTERED' });
    expect(compose({ coreApplicability: [] })).toMatchObject({ ok: false, code: 'NO_EXPLICIT_APPLICABILITY' });
    expect(compose({ coreApplicability: [deriveCoreApplicability(core, target, register)] })).toMatchObject({ ok: false, code: 'NOT_APPLICABLE' });
    expect(compose({ bucket: { ...TNS_BUCKET, primaryConceptStableIds: [] } })).toMatchObject({ ok: false, code: 'BUCKET_HAS_NO_PRIMARY_CONCEPT_LINEAGE' });
    const spec = compose();
    if (!spec.ok) throw new Error(spec.code);
    expect(renderer.render({ registry: STUDYUS_ASSESSMENT_REGISTRY, use: 'STUDENT_DELIVERY', core, adapter, applicability: spec.applicability, specification: spec.specification, bucket: spec.bucket, seed: 's' })).toMatchObject({ ok: false, code: 'ASSESSMENT_SYSTEM_NOT_REGISTERED' });
  });
});

describe('architecture acceptance: no closed list of systems is the source of truth', () => {
  const walk = (d: string): string[] => readdirSync(path.join(ROOT, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : /\.tsx?$/.test(e.name) ? [`${d}/${e.name}`] : []));
  const code = (f: string) => readFileSync(path.join(ROOT, f), 'utf8').replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '');
  const files = readdirSync(path.join(ROOT, DIR)).filter((f) => f.endsWith('.ts')).map((f) => `${DIR}/${f}`);

  it('no file under src/ knows TEST_NEW_SYSTEM: it was added with zero code changes', () => {
    expect(walk('src').filter((f) => /TEST_NEW_SYSTEM/.test(readFileSync(path.join(ROOT, f), 'utf8')))).toEqual([]);
    expect(walk('database').length).toBe(0); // no .ts there; the migration is checked below
    expect(readFileSync(path.join(ROOT, 'database/migrations/20261121_1100_qf51_construct_core_lineage.sql'), 'utf8')).not.toMatch(/TEST_NEW_SYSTEM/);
  });
  it('only the registrations file names a system; no core module branches on, lists or imports a taxonomy of systems', () => {
    const naming = files.filter((f) => /['"`](PAA|PISA|IB|CAMBRIDGE|AICE|ICFES|SABER11?)[.'"`]/.test(code(f)));
    expect(naming).toEqual([`${DIR}/registered-systems.ts`]);
    for (const f of files) {
      const src = code(f);
      expect(src, f).not.toMatch(/EXAM_FAMILIES|ExamFamily\b|exam-core\/taxonomy/);
      expect(src, f).not.toMatch(/(===|!==|case)\s*['"`](PAA|PISA|IB|CAMBRIDGE|AICE|ICFES|TEST_NEW_SYSTEM)['"`]/);
      expect(src, f).not.toMatch(/systemId\s*(===|!==)\s*['"`]/);
    }
  });
  it('the schema lists no system either: a system is a row, and only kinds of system are a vocabulary', () => {
    const sql = readFileSync(path.join(ROOT, 'database/migrations/20261121_1100_qf51_construct_core_lineage.sql'), 'utf8').replace(/^\s*--.*$/gm, '');
    expect(sql).not.toMatch(/'(PAA|PISA|IB|CAMBRIDGE|AICE|ICFES)'/);
    expect(sql).toMatch(/system_type IN \('EXAM', 'CURRICULUM', 'QUALIFICATION', 'NATIONAL_STANDARD', 'INSTITUTIONAL', 'HYBRID'\)/);
    for (const t of ['assessment_systems', 'assessment_system_versions', 'assessment_system_nodes']) expect(sql).toContain(`CREATE TABLE IF NOT EXISTS public.${t}`);
    expect(sql).toMatch(/FOREIGN KEY \(system_id, system_version_id\) REFERENCES public\.assessment_system_versions/);
  });
});
