/**
 * QF V5.1 -- architecture closeout: the registry decides what an exam is, blueprints are classified and fail
 * closed, the PISA adapter is bound to the active governed configuration (and none may bind a retired one), and a construct that needs a diagram is
 * refused until one can be drawn. Deterministic; no provider, no database.
 */
import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { MATHEMATICS_ADAPTATION_POLICY } from '@/lib/assessment-adaptation/discipline-policy';
import { MATH_POC_APPLICABILITY } from '@/lib/assessment-adaptation/math-poc-applicability';
import { IB_MATH_AA_HL_P1_COMPONENT, IB_SYSTEM_PROFILE, PISA_MATHEMATICS_COMPONENT, PISA_SYSTEM_PROFILE } from '@/lib/assessment-adaptation/system-profiles';
import { mathPocFamilyEa1aOf, mathPocFamilyOf } from '@/lib/exam-core/question-bank/task-families';
import { PISA_2022_V2, PISA_MATH_V2, RETIRED_V2_CONFIG_KEYS } from '@/lib/exam-core/verticals/v2/index';
import { profileById } from '@/lib/exam-core/question-bank/production/v5/generation-profile';
import { STEM_PLUS_APPROACH } from '@/lib/learning-approach/learning-approach-profile';
import {
  ASSESSMENT_SYSTEM_TYPES, adapterConflicts, BLUEPRINT_CLASSES, PISA_ACTIVE_CONFIG_KEY, PISA_REBOUND_COMPONENT_VERSION, PISA_REBOUND_SYSTEM_VERSION, RETIRED_CONFIGURATION_MARKERS, markersOfRetiredConfiguration, pisaMathematicsBoundToActiveConfiguration, retiredConfigurationsReferencedBy, BLUEPRINT_USE_POLICY, DRAWN_STIMULUS_KINDS, EXAMINED_SYSTEM_TYPES, QUADRATIC_FACTORISING_STRATEGY, STUDYUS_ASSESSMENT_REGISTRY, blueprintGate, classifyBlueprintSection,
  composeAssessmentSpecification, constructCoreOf, createAssessmentInstanceRenderer, createAssessmentSystemRegistry, deriveCoreApplicability, isExaminedSystemType, planByCore, readinessOf, unrenderableRepresentations,
  type BlueprintBucketRef, type BlueprintClass,
} from '@/lib/assessment-instance';
import { certifiedProfile, fixtureRegistry, testNewSystem } from './qf51-fixtures';

const ROOT = path.join(__dirname, '..', '..');
const read = (f: string) => readFileSync(path.join(ROOT, f), 'utf8');
const PROVENANCE = { basis: 'TEST_FIXTURE' as const, sources: [], recordedBy: 'test-fixture' };
const SHORTCUTS = [{ id: 'substitute-the-options', bypass: 'With options to choose from, each one can be substituted into the equation instead of factorising it.', excludedFormats: ['SELECTED_RESPONSE', 'MULTI_SELECT'], instanceRule: 'A numeric response asks for one stated root, so the response has one value.' }];
const CERT = { certificationVersion: 'test-cert-1', certifiedBy: 'test-fixture', certifiedAt: '2026-10-12T00:00:00Z' };
const coreOf = (familyOver: Record<string, unknown> = {}) => { const r = constructCoreOf({ family: { ...mathPocFamilyOf('tf.math.quadratic.solve-by-factorising')!, version: '1.0.0-test-certified', lifecycle: 'CERTIFIED', reviewStatus: 'REVIEWED', ...familyOver }, shortcutConstraints: SHORTCUTS, certification: CERT }); if (!r.ok) throw new Error(`${r.issue}: ${r.details.join('; ')}`); return r.core; };
const core = coreOf();
const IB = { system: certifiedProfile(IB_SYSTEM_PROFILE), component: certifiedProfile(IB_MATH_AA_HL_P1_COMPONENT) };
const registry = fixtureRegistry([IB]);
const adapter = registry.adapter('IB.MATH_AA_HL.P1')!;
const applicability = deriveCoreApplicability(core, { systemProfileId: 'IB', componentId: 'IB.MATH_AA_HL.P1' }, MATH_POC_APPLICABILITY);
const bucket = (over: Partial<BlueprintBucketRef> = {}): BlueprintBucketRef => ({ bucketId: 'test/IB.MATH_AA_HL.P1/aahl.p1.functions#0', configKey: 'test', sectionKey: 'IB.MATH_AA_HL.P1', adapterId: 'IB.MATH_AA_HL.P1', objectiveCode: 'aahl.p1.functions', primaryConceptStableIds: ['math.alg.quadratics'], responseFormat: null, blueprintClass: 'FULL', ...over });
const compose = (b: BlueprintBucketRef, use: 'STUDENT_DELIVERY' | 'DEV_TEST' = 'STUDENT_DELIVERY', c = core) => composeAssessmentSpecification({ registry, use, core: c, adapter, system: IB.system, component: IB.component, coreApplicability: [applicability], applicabilityRegister: MATH_POC_APPLICABILITY, bucket: b, disciplinePolicy: MATHEMATICS_ADAPTATION_POLICY, request: { purpose: 'PRACTICE', difficultyBand: 'STANDARD', language: 'en', contentUseClass: 'EVIDENCE_BEARING' } });

describe('1. the registry, not the legacy exam-family enum, decides what an exam is', () => {
  // the EA-1A version of the family declares the approach support a learning approach needs
  const approachCore = (() => { const r = constructCoreOf({ family: { ...mathPocFamilyEa1aOf('tf.math.quadratic.solve-by-factorising')!, version: '1.0.0-test-certified', lifecycle: 'CERTIFIED', reviewStatus: 'REVIEWED' }, shortcutConstraints: SHORTCUTS, certification: CERT }); if (!r.ok) throw new Error(`${r.issue}: ${r.details.join('; ')}`); return r.core; })();
  const composeFor = (systemType: 'EXAM' | 'CURRICULUM' | 'QUALIFICATION' | 'NATIONAL_STANDARD', over: { participationMode?: string; learningApproach?: unknown; contentUseClass?: string } = {}) => {
    const t = testNewSystem(systemType);
    const record = deriveCoreApplicability(approachCore, { systemProfileId: t.SYSTEM_ID, componentId: t.COMPONENT_ID }, t.register, undefined, { constraints: [], declaredBy: 'test-fixture', reason: 'Paper A asks for one numeric answer, which this construct gives by naming one root.' });
    return composeAssessmentSpecification({
      registry: t.registry, use: 'DEV_TEST', core: approachCore, adapter: t.adapter, system: t.system, component: t.component, coreApplicability: [record], applicabilityRegister: t.register, bucket: t.bucket, disciplinePolicy: MATHEMATICS_ADAPTATION_POLICY,
      ...(over.learningApproach !== undefined ? { learningApproach: over.learningApproach } : {}),
      request: { purpose: 'PRACTICE', difficultyBand: 'STANDARD', language: 'en', contentUseClass: over.contentUseClass ?? 'DEV_TEST_CONTENT', ...(over.participationMode ? { participationMode: over.participationMode } : {}) },
    });
  };

  it('TEST_NEW_SYSTEM: systemType EXAM, legacy examFamilyCode null -> treated as an EXAM by V5.1', () => {
    const t = testNewSystem('EXAM');
    expect(t.system.examFamilyCode).toBe(null);
    expect(t.adapter.examFamily).toBe(null);
    expect(t.registry.system('TEST_NEW_SYSTEM')).toMatchObject({ systemType: 'EXAM' });
    expect(isExaminedSystemType(t.registry.system('TEST_NEW_SYSTEM')!.systemType)).toBe(true);
    expect([...EXAMINED_SYSTEM_TYPES]).toEqual(['EXAM', 'QUALIFICATION', 'HYBRID']);
    expect(ASSESSMENT_SYSTEM_TYPES.filter((x) => !isExaminedSystemType(x))).toEqual(['CURRICULUM', 'NATIONAL_STANDARD', 'INSTITUTIONAL']);
    expect(composeFor('EXAM').ok).toBe(true);
  });
  it('it is sat individually, like any exam: collaborative work is refused by the registry\'s answer, not by a code', () => {
    expect(composeFor('EXAM', { participationMode: 'COLLABORATIVE', learningApproach: STEM_PLUS_APPROACH })).toMatchObject({ ok: false, code: 'EXAMINED_SYSTEM_IS_SAT_INDIVIDUALLY', detail: expect.stringMatching(/TEST_NEW_SYSTEM is registered as EXAM/) });
    expect(composeFor('QUALIFICATION', { participationMode: 'COLLABORATIVE', learningApproach: STEM_PLUS_APPROACH })).toMatchObject({ ok: false, code: 'EXAMINED_SYSTEM_IS_SAT_INDIVIDUALLY' });
    // the SAME null legacy code under a system registered as a curriculum is not refused on that ground
    const curriculum = composeFor('CURRICULUM', { participationMode: 'COLLABORATIVE', learningApproach: STEM_PLUS_APPROACH });
    expect(curriculum.ok ? 'ok' : curriculum.code).not.toBe('EXAMINED_SYSTEM_IS_SAT_INDIVIDUALLY');
  });
  it('an approach requirement "outside exams" yields to it, on the record, exactly because the registry says EXAM', () => {
    // STEM+ requires a situated context outside exams; this construct is abstract
    const exam = composeFor('EXAM', { learningApproach: STEM_PLUS_APPROACH });
    expect(exam).toMatchObject({ ok: true, approachYielded: expect.stringMatching(/stem-plus\.context\.situated/) });
    // registered as a curriculum, with the same null code, the requirement stands
    expect(composeFor('CURRICULUM', { learningApproach: STEM_PLUS_APPROACH })).toMatchObject({ ok: false, code: 'ADAPTATION_REFUSED', detail: 'LEARNING_APPROACH_REQUIREMENT_UNMET' });
    expect(composeFor('NATIONAL_STANDARD', { learningApproach: STEM_PLUS_APPROACH })).toMatchObject({ ok: false, code: 'ADAPTATION_REFUSED' });
    // with no approach in force nothing yields and nothing is recorded
    expect(composeFor('EXAM')).toMatchObject({ ok: true, approachYielded: null });
  });
  it('nothing in the instance layer reads the legacy code to decide, and the EA-1 engine earlier runs hash is untouched', () => {
    const composer = read('src/lib/assessment-instance/assessment-specification.ts');
    expect(composer).toMatch(/const examined = isExaminedSystemType\(registered\.system\.systemType\)/);
    for (const f of ['assessment-specification.ts', 'renderer.ts', 'planning-unit.ts', 'student-supply-policy.ts', 'core-applicability.ts', 'assessment-system-registry.ts', 'blueprint-classification.ts', 'instance-validators.ts']) expect(read(`src/lib/assessment-instance/${f}`).replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, ''), f).not.toMatch(/examFamilyCode|examFamily\b/);
    // every shipped system is registered with a type: none depends on the enum to be an exam
    for (const s of STUDYUS_ASSESSMENT_REGISTRY.systems()) expect(isExaminedSystemType(s.systemType), s.systemId).toBe(true);
    // the legacy enum stays, for backward compatibility only: adapt() is not edited
    expect(read('src/lib/assessment-adaptation/adapt.ts')).not.toMatch(/assessmentSystemIsExamined|isExaminedSystem/);
  });
});

describe('2. blueprint classification', () => {
  it('five classes; FULL_MOCK requires FULL; REDUCED_MOCK takes REDUCED or FULL; DEMO is never production', () => {
    expect([...BLUEPRINT_CLASSES]).toEqual(['FULL', 'ALIGNED', 'REDUCED', 'DEMO', 'NOT_APPLICABLE']);
    expect(BLUEPRINT_USE_POLICY.FULL_MOCK).toEqual(['FULL']);
    expect(BLUEPRINT_USE_POLICY.REDUCED_MOCK).toEqual(['FULL', 'REDUCED']);
    for (const use of ['PRACTICE', 'REDUCED_MOCK', 'FULL_MOCK'] as const) expect(BLUEPRINT_USE_POLICY[use], use).not.toContain('DEMO');
    for (const use of ['PRACTICE', 'REDUCED_MOCK', 'FULL_MOCK', 'DEV_TEST'] as const) expect(BLUEPRINT_USE_POLICY[use], use).not.toContain('NOT_APPLICABLE');
  });
  it('FULL_MOCK readiness fails on REDUCED, ALIGNED and DEMO, each by name', () => {
    expect(blueprintGate('FULL_MOCK', 'FULL')).toEqual({ ok: true, blueprintClass: 'FULL' });
    expect(blueprintGate('FULL_MOCK', 'REDUCED')).toMatchObject({ ok: false, code: 'BLUEPRINT_CLASS_DOES_NOT_SATISFY_THE_USE' });
    expect(blueprintGate('FULL_MOCK', 'ALIGNED')).toMatchObject({ ok: false, code: 'BLUEPRINT_CLASS_DOES_NOT_SATISFY_THE_USE' });
    expect(blueprintGate('FULL_MOCK', 'DEMO')).toMatchObject({ ok: false, code: 'BLUEPRINT_IS_A_DEMO' });
    const sections = (classes: (BlueprintClass | undefined)[]) => classes.map((blueprintClass, i) => ({ sectionId: `s${i}`, blueprintClass }));
    expect(readinessOf('FULL_MOCK', sections(['FULL', 'FULL']))).toEqual({ ready: true, blockers: [] });
    // one reduced or demo section is enough: a full mock is not declared ready over it
    expect(readinessOf('FULL_MOCK', sections(['FULL', 'REDUCED']))).toMatchObject({ ready: false, blockers: [{ sectionId: 's1', code: 'BLUEPRINT_CLASS_DOES_NOT_SATISFY_THE_USE' }] });
    expect(readinessOf('FULL_MOCK', sections(['FULL', 'DEMO']))).toMatchObject({ ready: false, blockers: [{ sectionId: 's1', code: 'BLUEPRINT_IS_A_DEMO' }] });
    expect(readinessOf('FULL_MOCK', sections(['DEMO', 'DEMO', 'REDUCED'])).blockers.length).toBe(3);
  });
  it('REDUCED_MOCK takes REDUCED or FULL; DEMO satisfies no production use; NOT_APPLICABLE satisfies nothing', () => {
    expect([blueprintGate('REDUCED_MOCK', 'REDUCED').ok, blueprintGate('REDUCED_MOCK', 'FULL').ok, blueprintGate('REDUCED_MOCK', 'ALIGNED').ok, blueprintGate('REDUCED_MOCK', 'DEMO').ok]).toEqual([true, true, false, false]);
    expect([blueprintGate('PRACTICE', 'FULL').ok, blueprintGate('PRACTICE', 'ALIGNED').ok, blueprintGate('PRACTICE', 'REDUCED').ok, blueprintGate('PRACTICE', 'DEMO').ok]).toEqual([true, true, true, false]);
    expect(blueprintGate('DEV_TEST', 'DEMO').ok).toBe(true);
    for (const use of ['PRACTICE', 'REDUCED_MOCK', 'FULL_MOCK', 'DEV_TEST'] as const) expect(blueprintGate(use, 'NOT_APPLICABLE'), use).toMatchObject({ ok: false, code: 'BLUEPRINT_NOT_APPLICABLE' });
  });
  it('a missing or unknown classification fails closed, for every use', () => {
    for (const use of ['PRACTICE', 'REDUCED_MOCK', 'FULL_MOCK', 'DEV_TEST'] as const) for (const missing of [undefined, null, '', 'full', 'OFFICIAL']) expect(blueprintGate(use, missing), `${use} ${String(missing)}`).toMatchObject({ ok: false, code: 'BLUEPRINT_NOT_CLASSIFIED' });
    expect(readinessOf('PRACTICE', [{ sectionId: 's0', blueprintClass: undefined }])).toMatchObject({ ready: false, blockers: [{ code: 'BLUEPRINT_NOT_CLASSIFIED' }] });
    expect(readinessOf('FULL_MOCK', [])).toMatchObject({ ready: false });
  });
  it('the class a section\'s recorded facts support, never raised by a fact that is not recorded', () => {
    const facts = { itemBankable: true, declaredFixture: false, fullFormDocumented: false, distributionPartlyDocumented: false, officialItemCount: null, governedSlots: 4 };
    expect(classifyBlueprintSection(facts)).toBe('REDUCED');
    expect(classifyBlueprintSection({ ...facts, distributionPartlyDocumented: true })).toBe('ALIGNED');
    expect(classifyBlueprintSection({ ...facts, declaredFixture: true })).toBe('DEMO');
    expect(classifyBlueprintSection({ ...facts, declaredFixture: true, distributionPartlyDocumented: true })).toBe('DEMO');
    expect(classifyBlueprintSection({ ...facts, declaredFixture: true, officialItemCount: 50, governedSlots: 50 })).toBe('FULL');
    expect(classifyBlueprintSection({ ...facts, officialItemCount: 50, governedSlots: 12 })).toBe('REDUCED');
    expect(classifyBlueprintSection({ ...facts, fullFormDocumented: true })).toBe('FULL');
    expect(classifyBlueprintSection({ ...facts, itemBankable: false, fullFormDocumented: true })).toBe('NOT_APPLICABLE');
  });
  it('the composer, the renderer and the planner all ask the class', () => {
    expect(compose(bucket()).ok).toBe(true);
    expect(compose(bucket({ blueprintClass: undefined }))).toMatchObject({ ok: false, code: 'BLUEPRINT_NOT_CLASSIFIED' });
    expect(compose(bucket({ blueprintClass: 'DEMO' }))).toMatchObject({ ok: false, code: 'BLUEPRINT_IS_A_DEMO' });
    expect(compose(bucket({ blueprintClass: 'NOT_APPLICABLE' }))).toMatchObject({ ok: false, code: 'BLUEPRINT_NOT_APPLICABLE' });
    expect(compose(bucket({ blueprintClass: 'REDUCED' })).ok).toBe(true); // practice may use a reduced blueprint
    // a demonstration blueprint may be exercised by developers, never delivered; "not applicable" not even that
    expect(compose(bucket({ blueprintClass: 'DEMO' }), 'DEV_TEST').ok).toBe(true);
    expect(compose(bucket({ blueprintClass: 'NOT_APPLICABLE' }), 'DEV_TEST')).toMatchObject({ ok: false, code: 'BLUEPRINT_NOT_APPLICABLE' });
    expect(compose(bucket({ blueprintClass: undefined }), 'DEV_TEST')).toMatchObject({ ok: false, code: 'BLUEPRINT_NOT_CLASSIFIED' });
    const spec = compose(bucket());
    if (!spec.ok) throw new Error(spec.code);
    const renderer = createAssessmentInstanceRenderer([{ ...QUADRATIC_FACTORISING_STRATEGY, status: 'CERTIFIED' }]);
    const render = (b: BlueprintBucketRef) => renderer.render({ registry, use: 'STUDENT_DELIVERY', core, adapter, applicability: spec.applicability, specification: spec.specification, bucket: b, seed: 's' });
    expect(render(bucket()).ok).toBe(true);
    expect(render(bucket({ blueprintClass: 'DEMO' }))).toMatchObject({ ok: false, code: 'BLUEPRINT_IS_A_DEMO' });
    expect(render(bucket({ blueprintClass: undefined }))).toMatchObject({ ok: false, code: 'BLUEPRINT_NOT_CLASSIFIED' });
    const plan = planByCore({ cores: [core], adapters: [adapter], applicability: [applicability], requiredDepth: 1, capacityOf: () => 10, buckets: [{ ...bucket(), requiredPerForm: 1 }, { ...bucket({ bucketId: 'demo#0', blueprintClass: 'DEMO' }), requiredPerForm: 1 }, { ...bucket({ bucketId: 'unclassified#0', blueprintClass: undefined }), requiredPerForm: 1 }] });
    expect(plan.refusals.map((r) => `${r.bucketId}:${r.code}`).sort()).toEqual(['demo#0:BLUEPRINT_IS_A_DEMO', 'unclassified#0:BLUEPRINT_NOT_CLASSIFIED']);
  });
});

describe('3. PISA mathematics, short response: the adapter is bound to the ACTIVE governed configuration', () => {
  const formats = (config: { sections: { key: string; definition?: { responseFormats?: string[] } }[] }) => config.sections.find((s) => s.key === 'math')!.definition!.responseFormats!;
  const STALE = { system: PISA_SYSTEM_PROFILE, component: PISA_MATHEMATICS_COMPONENT };
  it('the evidence: the EA-1 pair restates a RETIRED configuration; the ACTIVE one admits short response', () => {
    // (a) the EA-1 pair cites v2.pisa.math, and that record lists four formats, without SHORT_RESPONSE
    expect(read('src/lib/assessment-adaptation/system-profiles.ts')).toMatch(/const PISA_DEF = 'v2\.pisa\.math > sections\[math\] > definition'/);
    expect(formats(PISA_MATH_V2 as never)).toEqual(['SELECTED_RESPONSE', 'MULTI_SELECT', 'NUMERIC_ENTRY', 'MATH_EXPRESSION']);
    expect(retiredConfigurationsReferencedBy(STALE)).toEqual(['v2.pisa.math']);
    // (b) v2.pisa.math is superseded
    expect(RETIRED_V2_CONFIG_KEYS).toContain('v2.pisa.math');
    expect(RETIRED_V2_CONFIG_KEYS).not.toContain(PISA_2022_V2.key);
    // (c) the active configuration records SHORT_RESPONSE for the same mathematics section
    expect(formats(PISA_2022_V2 as never)).toEqual(['SELECTED_RESPONSE', 'MULTI_SELECT', 'NUMERIC_ENTRY', 'MATH_EXPRESSION', 'SHORT_RESPONSE']);
    // (d) the V5 items were generated for the ACTIVE configuration
    expect(profileById('PISA.MATHEMATICS')!.blueprintPolicy.configKey.test(PISA_2022_V2.key)).toBe(true);
    expect(profileById('PISA.MATHEMATICS')!.blueprintPolicy.configKey.test('v2.pisa.math')).toBe(false);
  });
  it('the fix: the registered adapter reads v2.pisa.2022, supports short response, and cites no retired configuration', () => {
    expect(PISA_ACTIVE_CONFIG_KEY).toBe('v2.pisa.2022');
    const rebound = pisaMathematicsBoundToActiveConfiguration();
    expect(retiredConfigurationsReferencedBy(rebound)).toEqual([]);
    expect(rebound.component.overrides.responseFormats!.value).toEqual(formats(PISA_2022_V2 as never));
    expect(JSON.stringify(rebound.component.overrides.responseFormats!.authority)).toContain('v2.pisa.2022 > sections[math] > definition.responseFormats');
    // a rebinding is a new version of both profiles, never the stale one under the same version
    expect(rebound.system.version).toBe(PISA_REBOUND_SYSTEM_VERSION);
    expect(rebound.component.version).toBe(PISA_REBOUND_COMPONENT_VERSION);
    expect(rebound.system.version).not.toBe(PISA_SYSTEM_PROFILE.version);
    expect(rebound.component.version).not.toBe(PISA_MATHEMATICS_COMPONENT.version);
    const adapter = STUDYUS_ASSESSMENT_REGISTRY.adapter('PISA.MATHEMATICS')!;
    expect(adapter.responseFormats).toEqual(formats(PISA_2022_V2 as never));
    expect(adapter.responseFormats).toContain('SHORT_RESPONSE');
    expect(adapter.version).toBe(`${PISA_REBOUND_SYSTEM_VERSION}+${PISA_REBOUND_COMPONENT_VERSION}`);
    // the frozen EA-1 engine file is not edited: the binding lives in the V5.1 layer
    expect(read('src/lib/assessment-instance/registered-systems.ts')).toMatch(/ACTIVE_CONFIGURATION_REBINDINGS/);
    expect(STUDYUS_ASSESSMENT_REGISTRY.profilePairOf('PISA.MATHEMATICS')!.component.version).toBe(PISA_REBOUND_COMPONENT_VERSION);
    // what is still listed between the V5 profile and the adapter is the profile being NARROWER (it never asks for
    // MATH_EXPRESSION); the adapter no longer lacks a format the active configuration records
    const left = adapterConflicts().filter((c) => c.adapterId === 'PISA.MATHEMATICS');
    expect(left.map((c) => c.dimension)).toEqual(['responseFormats']);
    expect(left[0].generationProfile.filter((f) => !left[0].adapter.includes(f))).toEqual([]);
    expect(left[0].adapter.filter((f) => !left[0].generationProfile.includes(f))).toEqual(['MATH_EXPRESSION']);
  });
  it('regression: an active V5.1 adapter can not be bound to a configuration listed as retired', () => {
    expect(Object.keys(RETIRED_CONFIGURATION_MARKERS).sort()).toEqual([...RETIRED_V2_CONFIG_KEYS].sort());
    // every adapter of the live registry that has a rule profile: no retired configuration behind it
    const pairs = STUDYUS_ASSESSMENT_REGISTRY.adapters().map((a) => ({ id: a.adapterId, pair: STUDYUS_ASSESSMENT_REGISTRY.profilePairOf(a.adapterId) })).filter((p) => p.pair);
    expect(pairs.length).toBeGreaterThanOrEqual(6);
    for (const p of pairs) expect(retiredConfigurationsReferencedBy(p.pair!), p.id).toEqual([]);
    // and the registry refuses one: the stale EA-1 pair is rejected at registration, by name
    const guarded = createAssessmentSystemRegistry({ retiredConfigurationsOf: retiredConfigurationsReferencedBy });
    expect(guarded.registerSystem({ v: 1, systemId: 'PISA', displayName: 'PISA', organization: 'OECD', region: null, systemType: 'EXAM', lifecycle: 'ACTIVE', metadata: {}, provenance: PROVENANCE })).toMatchObject({ ok: true });
    expect(guarded.registerVersion({ v: 1, systemId: 'PISA', versionId: 'stale', label: 'stale', lifecycle: 'ACTIVE', effectiveFrom: null, effectiveTo: null, provenance: PROVENANCE })).toMatchObject({ ok: true });
    expect(guarded.registerNode({ v: 1, nodeId: 'PISA.MATHEMATICS', systemId: 'PISA', versionId: 'stale', kind: 'COMPONENT', parentNodeId: null, code: 'MATHEMATICS', displayName: 'Mathematics' })).toMatchObject({ ok: true });
    const refused = guarded.registerAdapter({ versionId: 'stale', definition: { kind: 'EA1_PROFILE_PAIR', ...STALE } });
    expect(refused).toMatchObject({ ok: false, code: 'ADAPTER_BINDS_A_RETIRED_CONFIGURATION', detail: expect.stringMatching(/PISA\.MATHEMATICS cites v2\.pisa\.math/) });
    expect(guarded.adapters()).toEqual([]);
    // the same registry accepts the pair bound to the active configuration
    expect(guarded.registerAdapter({ versionId: 'stale', definition: { kind: 'EA1_PROFILE_PAIR', ...pisaMathematicsBoundToActiveConfiguration() } })).toMatchObject({ ok: true });
    // a registry built without the guard would have accepted the stale pair: the guard is what the live registry is built with
    expect(read('src/lib/assessment-instance/registered-systems.ts')).toMatch(/createAssessmentSystemRegistry\(\{ retiredConfigurationsOf: retiredConfigurationsReferencedBy \}\)/);
    // any retired key is caught, wherever a profile cites it
    for (const key of RETIRED_V2_CONFIG_KEYS) {
      const fresh = pisaMathematicsBoundToActiveConfiguration();
      const citing = { system: fresh.system, component: { ...fresh.component, specification: { ...fresh.component.specification, records: [{ ...fresh.component.specification.records[0], recordedIn: `${key} > sections[x] > definition` }] } } };
      expect(retiredConfigurationsReferencedBy(citing as never), key).toEqual([key]);
    }
    // the active key is not mistaken for a retired one
    expect(markersOfRetiredConfiguration('v2.pisa.math')).toContain('v2.pisa.math');
    expect(Object.values(RETIRED_CONFIGURATION_MARKERS).flat()).not.toContain(PISA_ACTIVE_CONFIG_KEY);
  });
});

describe('4. renderer capability: text and tables are rendered; a required diagram fails closed', () => {
  it('no strategy draws a diagram, and none claims to', () => {
    expect(QUADRATIC_FACTORISING_STRATEGY.renderableStimulusKinds).toBeUndefined();
    expect([...DRAWN_STIMULUS_KINDS]).toEqual(['GRAPH', 'FIGURE', 'COMPOSITE']);
    expect(unrenderableRepresentations(core, QUADRATIC_FACTORISING_STRATEGY)).toEqual([]); // this construct needs no stimulus
  });
  it('a construct whose required stimulus can only be a drawing is refused, for Students and for developers', () => {
    const needsFigure = coreOf({ responseConstraints: { ...core.family.responseConstraints, stimulusNeed: 'REQUIRED', stimulusKinds: ['FIGURE'] } });
    expect(unrenderableRepresentations(needsFigure, QUADRATIC_FACTORISING_STRATEGY)).toEqual(['FIGURE']);
    // a stimulus that may also be a table is renderable as the table
    expect(unrenderableRepresentations(coreOf({ responseConstraints: { ...core.family.responseConstraints, stimulusNeed: 'REQUIRED', stimulusKinds: ['FIGURE', 'TABLE'] } }), QUADRATIC_FACTORISING_STRATEGY)).toEqual([]);
    // an optional figure is not a requirement
    expect(unrenderableRepresentations(coreOf({ responseConstraints: { ...core.family.responseConstraints, stimulusNeed: 'OPTIONAL', stimulusKinds: ['FIGURE'] } }), QUADRATIC_FACTORISING_STRATEGY)).toEqual([]);
    // a strategy that declares it draws figures would be allowed: the capability is pluggable
    expect(unrenderableRepresentations(needsFigure, { renderableStimulusKinds: ['FIGURE'] })).toEqual([]);
    const spec = compose(bucket());
    if (!spec.ok) throw new Error(spec.code);
    const renderer = createAssessmentInstanceRenderer([{ ...QUADRATIC_FACTORISING_STRATEGY, status: 'CERTIFIED' }]);
    for (const use of ['STUDENT_DELIVERY', 'DEV_TEST'] as const) {
      const r = renderer.render({ registry, use, core: needsFigure, adapter, applicability: { ...spec.applicability, familyVersion: needsFigure.familyVersion }, specification: spec.specification, bucket: bucket(), seed: 's' });
      expect(r, use).toMatchObject({ ok: false, code: 'REPRESENTATION_NOT_RENDERABLE', detail: expect.stringMatching(/requires FIGURE; .* draws no diagram/) });
    }
  });
});
