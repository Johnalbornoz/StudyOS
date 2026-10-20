/**
 * Blueprint Engine V2 / BP-2 -- Blueprint variants, cardinality and
 * resolution. T1-T12 from the BP-2 brief plus the catalog validator matrix.
 *
 * Declared variants, sessions and length evidence use an explicit TEST
 * authority; they exercise the model and claim no official fact.
 */
import { describe, it, expect } from 'vitest';
import {
  compileBlueprintVariants,
  compileExam,
  resolveBlueprint,
  validateBlueprintCatalog,
  assessmentInstanceKey,
  MOCK_ORDINAL_PATTERN,
  ExamSessionSchema,
  provenance,
  UNKNOWN_PROVENANCE,
  defaultSourceRegistry,
  type BlueprintVariantV2,
  type CatalogExam,
  type DeclaredVariantInput,
  type ExamSessionV2,
  type ResolveBlueprintRequest,
} from '@/lib/exam-core/blueprint-v2';
import { structureConfig, subjectByKey } from '@/lib/exam-core/catalog/ib-dp';
import { IB_MATH_AA_HL_V2, IB_VISUAL_ARTS_HL_V2, PAA_V2, PISA_2022_V2, AICE_9709_AS, AICE_9709_A } from '@/lib/exam-core/verticals/v2';
import type { ExamVerticalConfigInput } from '@/lib/exam-core/vertical-config';

const TEST = provenance('INSTITUTION_SUPPLIED', ['test-fixture-institution']);
const THIRD = provenance('THIRD_PARTY_REFERENCE', ['prep-website']);
const IB_SPEC = 'ib-dp-math-aa@2021';
const codes = (r: { issues: Array<{ code: string }> }) => r.issues.map((i) => i.code);
const variantsOf = (cfg: unknown, declared?: DeclaredVariantInput[], deriveFromConfig = true) => {
  const r = compileBlueprintVariants(cfg, { declared, deriveFromConfig });
  return r;
};
const examEntry = (cfg: unknown): [string, CatalogExam] => {
  const e = compileExam(cfg);
  return [e.examDefinition!.identity.definitionKey, { definition: e.examDefinition!, blueprint: e.blueprint! }];
};
function sessionOf(key: string, defKey: string, spec: string, year: number, label: string): ExamSessionV2 {
  return ExamSessionSchema.parse({
    sessionKey: key,
    examDefinitionKey: defKey,
    specificationKey: spec,
    administration: { type: 'NAMED_SERIES', label, year: { status: 'STATED', value: year, provenance: TEST }, startDate: { status: 'UNKNOWN', reason: 'not loaded' }, endDate: { status: 'UNKNOWN', reason: 'not loaded' }, region: { status: 'UNKNOWN', reason: 'none' } },
    status: 'PLANNED',
    provenance: TEST,
    rules: [{ rule: 'GRADE_BOUNDARIES', status: 'NOT_LOADED', provenance: UNKNOWN_PROVENANCE, ref: null }],
  });
}

/** A test assessment whose single timed component is delivered at official length (registered test source). */
const TEST_REGISTRY = new Map(defaultSourceRegistry());
TEST_REGISTRY.set('test-official-source', { key: 'test-official-source', framework: 'TEST', title: 'test', publisher: 'test', url: null, publicationYear: null, confidence: 'HIGH', license: 'PUBLIC' });
const FULL_LENGTH: ExamVerticalConfigInput = {
  key: 'test.full-length',
  family: 'PAA',
  // ORIGINAL (not DEV_CERT_FIXTURE): a fixture configuration must carry bank items; this one is structure + blueprint only.
  contentStatus: 'ORIGINAL',
  organization: { name: 'Test body' },
  programme: { name: 'Test programme', type: 'ADMISSION_EXAM' },
  definition: { name: 'Full-length test assessment', purpose: 'unit test', domains: ['Test domain'] },
  version: { label: 'T1', delivery: { navigation: 'LINEAR', breaks: [], itemFeedback: 'NEVER', resultReview: 'FULL', permittedResources: [] } },
  framework: { frameworkKey: 'test-framework', curriculumVersion: 'v1', firstAssessment: 2024, lastAssessment: null, syllabusCode: null, frameworkVersion: '1', sourceKeys: ['test-official-source'] },
  scoring: { name: 'raw', scoringType: 'BINARY', policy: { engine: 'exam-scoring-v1', strategy: 'RAW', transform: { type: 'NONE' }, unit: '%', provenance: { official: false, source: 'unit test fixture' } } },
  structureLabel: 'T1',
  sections: [
    {
      key: 'only',
      name: 'Only section',
      componentType: 'SECTION',
      definition: { officialName: 'Only section', kind: 'MULTIPLE_CHOICE_TEST', assessment: 'EXTERNAL', officialDurationMinutes: 30, maxMarks: null, weightingPercent: null, officialItemCount: 3, calculatorPolicy: 'NONE', responseFormats: ['SELECTED_RESPONSE'], sourceKeys: ['test-official-source'] },
      objectives: [{ code: 'test.obj', description: 'objective', targets: [{ count: 3 }] }],
    },
  ],
  items: [],
  structureOnly: false,
};

// ---------------------------------------------------------------------------
describe('T1 -- one specification, many blueprints: full assessment and Paper 1 practice coexist', () => {
  const r = variantsOf(IB_MATH_AA_HL_V2);
  const catalog = { variants: r.variants };
  it('derives several variants for the same exam + specification', () => {
    expect(new Set(r.variants.map((v) => v.identity.specificationKey))).toEqual(new Set([IB_SPEC]));
    expect(r.variants.map((v) => `${v.identity.purpose}:${v.identity.scope.type}${'componentKey' in v.identity.scope ? `(${v.identity.scope.componentKey})` : ''}`)).toEqual(
      expect.arrayContaining(['PRACTICE:ENTIRE_ASSESSMENT', 'DIAGNOSTIC:ENTIRE_ASSESSMENT', 'REDUCED_MOCK:ENTIRE_ASSESSMENT', 'COMPONENT_TRAINING:COMPONENT(p1)', 'COMPONENT_TRAINING:COMPONENT(p2)', 'COMPONENT_TRAINING:COMPONENT(p3)', 'OFFICIAL_STRUCTURE_REFERENCE:ENTIRE_ASSESSMENT'])
    );
    expect(validateBlueprintCatalog(r.variants, { exams: new Map([examEntry(IB_MATH_AA_HL_V2)]) }).ok).toBe(true);
  });
  it('resolves each exactly', () => {
    const full = resolveBlueprint(catalog, { examDefinitionKey: IB_MATH_AA_HL_V2.key, specificationKey: IB_SPEC, purpose: 'PRACTICE', scope: { type: 'ENTIRE_ASSESSMENT' }, variantKey: 'standard' });
    const p1 = resolveBlueprint(catalog, { examDefinitionKey: IB_MATH_AA_HL_V2.key, specificationKey: IB_SPEC, purpose: 'COMPONENT_TRAINING', scope: { type: 'COMPONENT', componentKey: 'p1' }, variantKey: 'standard' });
    expect(full.status).toBe('EXACT_MATCH');
    expect(p1.status).toBe('EXACT_MATCH');
    expect(full.selected!.componentKeys).toEqual(['p1', 'p2', 'p3']);
    expect(p1.selected!.componentKeys).toEqual(['p1']);
    expect(p1.selected!.identityKey).not.toBe(full.selected!.identityKey);
  });
  it('COMPONENT_TRAINING without a scope asks for it instead of picking a paper', () => {
    const r2 = resolveBlueprint(catalog, { examDefinitionKey: IB_MATH_AA_HL_V2.key, specificationKey: IB_SPEC, purpose: 'COMPONENT_TRAINING' });
    expect(r2).toMatchObject({ status: 'MISSING_CONTEXT', selected: null, missingInformation: ['scope'] });
  });
});

// ---------------------------------------------------------------------------
describe('T2 -- Mock 1 and Mock 2 resolve to the same blueprint', () => {
  it('full-length structure: FULL_MOCK derived; two instances, one variant', () => {
    const r = compileBlueprintVariants(FULL_LENGTH, { registry: TEST_REGISTRY });
    const full = r.variants.find((v) => v.identity.purpose === 'FULL_MOCK')!;
    expect(full.structure.lengthClass).toBe('FULL_LENGTH');
    const req: ResolveBlueprintRequest = { examDefinitionKey: 'test.full-length', specificationKey: 'test-framework@1', purpose: 'FULL_MOCK' };
    const mock1 = resolveBlueprint({ variants: r.variants }, req);
    const mock2 = resolveBlueprint({ variants: r.variants }, req);
    expect(mock1.selected!.identityKey).toBe(mock2.selected!.identityKey);
    expect(mock1.selected!.structureFingerprint).toBe(mock2.selected!.structureFingerprint);
    const k1 = assessmentInstanceKey({ variantIdentityKey: mock1.selected!.identityKey, seriesKey: 'student-123', ordinal: 1, seed: 'inst-a' });
    const k2 = assessmentInstanceKey({ variantIdentityKey: mock2.selected!.identityKey, seriesKey: 'student-123', ordinal: 2, seed: 'inst-b' });
    expect(k1).not.toBe(k2);
    // the series and ordinal live only in the instance key, never in the blueprint identity
    expect(mock1.selected!.identityKey).toBe('test.full-length|test-framework@1|FULL_MOCK|ENTIRE_ASSESSMENT|standard');
    expect(MOCK_ORDINAL_PATTERN.test(mock1.selected!.identityKey)).toBe(false);
    expect(k1.startsWith(`${mock1.selected!.identityKey}#student-123:1@`)).toBe(true);
    expect(mock1.contentReadiness).toEqual({ status: 'NOT_EVALUATED', owner: 'QUESTION_BANK' });
  });
  it('IB reduced mock: the same REDUCED_MOCK variant for every attempt; FULL_MOCK is not offered', () => {
    const vs = variantsOf(IB_MATH_AA_HL_V2).variants;
    const a = resolveBlueprint({ variants: vs }, { examDefinitionKey: IB_MATH_AA_HL_V2.key, specificationKey: IB_SPEC, purpose: 'REDUCED_MOCK' });
    const b = resolveBlueprint({ variants: [...vs].reverse() }, { examDefinitionKey: IB_MATH_AA_HL_V2.key, specificationKey: IB_SPEC, purpose: 'REDUCED_MOCK' });
    expect(a.selected!.identityKey).toBe(b.selected!.identityKey);
    expect(resolveBlueprint({ variants: vs }, { examDefinitionKey: IB_MATH_AA_HL_V2.key, specificationKey: IB_SPEC, purpose: 'FULL_MOCK' }).status).toBe('NO_MATCH');
  });
});

// ---------------------------------------------------------------------------
describe('T3 -- Cambridge / AICE routes are never chosen for the student', () => {
  const spec = 'cie-aice-9709@2026-2027';
  const as = variantsOf(AICE_9709_AS).variants;
  it('AS: a mock needs one of the official component sets', () => {
    const r = resolveBlueprint({ variants: as }, { examDefinitionKey: AICE_9709_AS.key, specificationKey: spec, purpose: 'REDUCED_MOCK' });
    expect(r).toMatchObject({ status: 'MISSING_CONTEXT', selected: null, missingInformation: ['route'] });
    expect(r.candidates.filter((c) => c.compatible)).toHaveLength(3);
    const routeOnly = resolveBlueprint({ variants: as }, { examDefinitionKey: AICE_9709_AS.key, specificationKey: spec, purpose: 'REDUCED_MOCK', route: { routeKey: 'AS_ONLY' } });
    expect(routeOnly).toMatchObject({ status: 'MISSING_CONTEXT', missingInformation: ['route'] });
    const chosen = resolveBlueprint({ variants: as }, { examDefinitionKey: AICE_9709_AS.key, specificationKey: spec, purpose: 'REDUCED_MOCK', route: { routeKey: 'AS_ONLY', componentSet: ['p4', 'p1'] } });
    expect(chosen.status).toBe('SINGLE_COMPATIBLE_MATCH');
    expect(chosen.selected!.componentKeys).toEqual(['p1', 'p4']);
  });
  it('A Level: staged and linear routes over the same papers stay distinct; equivalent staged sets collapse', () => {
    const r = compileBlueprintVariants(AICE_9709_A);
    expect(codes(r)).toContain('EQUIVALENT_ROUTE_SETS_COLLAPSED');
    const res = resolveBlueprint({ variants: r.variants }, { examDefinitionKey: AICE_9709_A.key, specificationKey: spec, purpose: 'REDUCED_MOCK' });
    expect(res).toMatchObject({ status: 'MISSING_CONTEXT', missingInformation: ['route'] });
    const staged = resolveBlueprint({ variants: r.variants }, { examDefinitionKey: AICE_9709_A.key, specificationKey: spec, purpose: 'REDUCED_MOCK', route: { routeKey: 'A_LEVEL_STAGED', componentSet: ['p1', 'p3', 'p4', 'p5'] } });
    const linear = resolveBlueprint({ variants: r.variants }, { examDefinitionKey: AICE_9709_A.key, specificationKey: spec, purpose: 'REDUCED_MOCK', route: { routeKey: 'A_LEVEL_LINEAR', componentSet: ['p1', 'p3', 'p4', 'p5'] } });
    expect(staged.status).toBe('SINGLE_COMPATIBLE_MATCH');
    expect(linear.status).toBe('SINGLE_COMPATIBLE_MATCH');
    expect(staged.selected!.identityKey).not.toBe(linear.selected!.identityKey);
  });
  it('a route that does not exist is rejected, not approximated', () => {
    const r = compileBlueprintVariants(AICE_9709_AS, { deriveFromConfig: false, declared: [{ purpose: 'REDUCED_MOCK', scope: { type: 'ROUTE', routeKey: 'AS_ONLY', componentSet: ['p2', 'p4'] }, variant: { key: 'standard', dimension: 'STANDARD', reason: null }, provenance: TEST }] });
    expect(codes(r)).toContain('ROUTE_NOT_APPLICABLE');
    expect(r.variants).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe('T4 -- two equally valid candidates are AMBIGUOUS', () => {
  const p1Gdc = { ...IB_MATH_AA_HL_V2, sections: IB_MATH_AA_HL_V2.sections.map((s) => (s.key === 'p1' ? { ...s, definition: { ...s.definition!, calculatorPolicy: 'GDC_REQUIRED' as const } } : s)) };
  const declared: DeclaredVariantInput[] = [
    { purpose: 'PRACTICE', scope: { type: 'COMPONENT', componentKey: 'p1' }, variant: { key: 'no-calculator', dimension: 'CALCULATOR', reason: 'practice without technology' }, provenance: TEST },
    { purpose: 'PRACTICE', scope: { type: 'COMPONENT', componentKey: 'p1' }, variant: { key: 'with-gdc', dimension: 'CALCULATOR', reason: 'practice the same content with a GDC' }, provenance: TEST, config: p1Gdc },
  ];
  const r = variantsOf(IB_MATH_AA_HL_V2, declared);
  const req: ResolveBlueprintRequest = { examDefinitionKey: IB_MATH_AA_HL_V2.key, specificationKey: IB_SPEC, purpose: 'PRACTICE', scope: { type: 'COMPONENT', componentKey: 'p1' } };
  it('never picks one', () => {
    const res = resolveBlueprint({ variants: r.variants }, req);
    expect(res).toMatchObject({ status: 'AMBIGUOUS', selected: null, missingInformation: ['variant'] });
    expect(res.conflicts).toEqual([{ identityKeys: expect.arrayContaining([expect.stringMatching(/no-calculator$/), expect.stringMatching(/with-gdc$/)]), reason: 'EQUALLY_VALID_VARIANTS' }]);
    expect(codes(validateBlueprintCatalog(r.variants))).toContain('AMBIGUOUS_CANDIDATE_SET');
  });
  it('a variant key makes it exact', () => {
    expect(resolveBlueprint({ variants: r.variants }, { ...req, variantKey: 'with-gdc' }).status).toBe('EXACT_MATCH');
  });
  it('duplicated identities are ambiguous and invalid', () => {
    const v = r.variants.find((x) => x.identity.purpose === 'PRACTICE' && x.identity.scope.type === 'ENTIRE_ASSESSMENT')!;
    const dup = resolveBlueprint({ variants: [v, v] }, { examDefinitionKey: IB_MATH_AA_HL_V2.key, specificationKey: IB_SPEC, purpose: 'PRACTICE' });
    expect(dup).toMatchObject({ status: 'AMBIGUOUS', conflicts: [{ reason: 'DUPLICATE_IDENTITY' }] });
    expect(codes(validateBlueprintCatalog([v, v]))).toContain('DUPLICATE_BLUEPRINT_IDENTITY');
  });
});

// ---------------------------------------------------------------------------
describe('T5 -- a reduced form never satisfies FULL_MOCK', () => {
  const paa = variantsOf(PAA_V2).variants;
  const req: ResolveBlueprintRequest = { examDefinitionKey: PAA_V2.key, specificationKey: 'paa-revisada@2021', purpose: 'FULL_MOCK' };
  it('request: the reduced mock is excluded with the reason', () => {
    const r = resolveBlueprint({ variants: paa }, req);
    expect(r.status).toBe('NO_MATCH');
    expect(r.reasons).toContain('REDUCED_FORM_CANNOT_SATISFY_FULL_MOCK');
    expect(r.candidates.find((c) => c.identityKey.includes('|REDUCED_MOCK|'))!.reasons).toEqual(['REDUCED_FORM_CANNOT_SATISFY_FULL_MOCK']);
  });
  it('declaration: a FULL_MOCK label on a reduced form is refused (also with third-party evidence)', () => {
    const base = { purpose: 'FULL_MOCK' as const, scope: { type: 'ENTIRE_ASSESSMENT' as const }, variant: { key: 'full', dimension: 'OTHER' as const, reason: 'claims to be full' }, provenance: TEST };
    expect(codes(compileBlueprintVariants(PAA_V2, { deriveFromConfig: false, declared: [base] }))).toContain('FULL_MOCK_NOT_OFFICIAL_LENGTH');
    expect(codes(compileBlueprintVariants(PAA_V2, { deriveFromConfig: false, declared: [{ ...base, lengthEvidence: THIRD }] }))).toContain('FULL_MOCK_NOT_OFFICIAL_LENGTH');
  });
  it('a forged catalog entry is caught by the validator', () => {
    const reduced = paa.find((v) => v.identity.purpose === 'REDUCED_MOCK')!;
    const forged: BlueprintVariantV2 = { ...reduced, identity: { ...reduced.identity, purpose: 'FULL_MOCK' } };
    forged.identityKey = forged.identityKey.replace('|REDUCED_MOCK|', '|FULL_MOCK|');
    expect(codes(validateBlueprintCatalog([forged]))).toContain('FULL_MOCK_ON_REDUCED_FORM');
    expect(resolveBlueprint({ variants: [forged] }, req).status).toBe('NO_MATCH');
  });
  it('only explicit authoritative evidence lets a structure stand for the full assessment', () => {
    const r = compileBlueprintVariants(PAA_V2, { deriveFromConfig: false, declared: [{ purpose: 'FULL_MOCK', scope: { type: 'ENTIRE_ASSESSMENT' }, variant: { key: 'standard', dimension: 'STANDARD', reason: null }, provenance: TEST, lengthEvidence: TEST }] });
    expect(r.variants[0].structure.lengthClass).toBe('FULL_LENGTH_BY_EVIDENCE');
    expect(resolveBlueprint({ variants: r.variants }, req).status).toBe('SINGLE_COMPATIBLE_MATCH');
  });
});

// ---------------------------------------------------------------------------
describe('T6 -- two specifications of the same exam never cross-resolve', () => {
  const next: ExamVerticalConfigInput = { ...IB_MATH_AA_HL_V2, version: { ...IB_MATH_AA_HL_V2.version, label: 'V2 next' }, framework: { ...IB_MATH_AA_HL_V2.framework!, frameworkVersion: '2028', firstAssessment: 2028, lastAssessment: null } };
  const vs = [...variantsOf(IB_MATH_AA_HL_V2).variants, ...variantsOf(next).variants];
  const base = { examDefinitionKey: IB_MATH_AA_HL_V2.key, purpose: 'PRACTICE' as const, scope: { type: 'ENTIRE_ASSESSMENT' as const } };
  it('each specification gets its own blueprint', () => {
    expect(resolveBlueprint({ variants: vs }, { ...base, specificationKey: IB_SPEC }).selected!.identity.specificationKey).toBe(IB_SPEC);
    expect(resolveBlueprint({ variants: vs }, { ...base, specificationKey: 'ib-dp-math-aa@2028' }).selected!.identity.specificationKey).toBe('ib-dp-math-aa@2028');
  });
  it('an unknown or missing specification never borrows another one', () => {
    expect(resolveBlueprint({ variants: vs }, { ...base, specificationKey: 'ib-dp-math-aa@2035' })).toMatchObject({ status: 'NO_MATCH', reasons: ['NO_BLUEPRINT_FOR_SPECIFICATION: ib-dp-math-aa@2035'] });
    expect(resolveBlueprint({ variants: vs }, base)).toMatchObject({ status: 'MISSING_CONTEXT', missingInformation: ['specification'] });
  });
});

// ---------------------------------------------------------------------------
describe('T7 -- a session-specific structural variant resolves only for its session', () => {
  const noP3 = { ...IB_MATH_AA_HL_V2, sections: IB_MATH_AA_HL_V2.sections.filter((s) => s.key !== 'p3'), items: IB_MATH_AA_HL_V2.items.filter((i) => !i.objectiveCode.startsWith('aahl.p3')) };
  const sessions = [sessionOf('may-2027', IB_MATH_AA_HL_V2.key, IB_SPEC, 2027, 'May 2027'), sessionOf('nov-2027', IB_MATH_AA_HL_V2.key, IB_SPEC, 2027, 'November 2027')];
  const declared: DeclaredVariantInput[] = [
    { purpose: 'REDUCED_MOCK', scope: { type: 'ENTIRE_ASSESSMENT' }, variant: { key: 'standard', dimension: 'STANDARD', reason: null }, sessionApplicability: { type: 'SESSIONS', sessionKeys: ['may-2027'] }, provenance: TEST },
    { purpose: 'REDUCED_MOCK', scope: { type: 'ENTIRE_ASSESSMENT' }, variant: { key: 'nov-2027-structure', dimension: 'SESSION_STRUCTURE', reason: 'test: a sitting with a different paper structure' }, sessionApplicability: { type: 'SESSIONS', sessionKeys: ['nov-2027'] }, provenance: TEST, config: noP3 },
  ];
  const vs = variantsOf(IB_MATH_AA_HL_V2, declared, false).variants;
  const req: ResolveBlueprintRequest = { examDefinitionKey: IB_MATH_AA_HL_V2.key, specificationKey: IB_SPEC, purpose: 'REDUCED_MOCK' };
  it('picks by session, asks for it when missing, refuses a session it does not cover', () => {
    expect(resolveBlueprint({ variants: vs, sessions }, { ...req, sessionKey: 'nov-2027' }).selected!.identity.variant.key).toBe('nov-2027-structure');
    expect(resolveBlueprint({ variants: vs, sessions }, { ...req, sessionKey: 'may-2027' }).selected!.identity.variant.key).toBe('standard');
    expect(resolveBlueprint({ variants: vs, sessions }, req)).toMatchObject({ status: 'MISSING_CONTEXT', missingInformation: ['session'] });
    expect(resolveBlueprint({ variants: vs }, { ...req, sessionKey: 'may-2028' }).status).toBe('NO_MATCH');
    expect(validateBlueprintCatalog(vs, { sessions }).ok).toBe(true);
  });
  it('a session of another specification is inconsistent', () => {
    const other = [sessionOf('may-2027', IB_MATH_AA_HL_V2.key, 'ib-dp-math-aa@2028', 2027, 'May 2027'), sessions[1]];
    expect(codes(validateBlueprintCatalog(vs, { sessions: other }))).toContain('SESSION_RESTRICTION_INCONSISTENT');
    expect(resolveBlueprint({ variants: vs, sessions: other }, { ...req, sessionKey: 'may-2027' }).reasons[0]).toMatch(/^SESSION_SPECIFICATION_MISMATCH/);
  });
});

// ---------------------------------------------------------------------------
describe('T8 -- a boundary-only session difference does not create a blueprint', () => {
  const vs = variantsOf(IB_MATH_AA_HL_V2).variants;
  it('both sittings resolve to the same variant (boundaries live in the session layer)', () => {
    const req: ResolveBlueprintRequest = { examDefinitionKey: IB_MATH_AA_HL_V2.key, specificationKey: IB_SPEC, purpose: 'REDUCED_MOCK' };
    const may = resolveBlueprint({ variants: vs }, { ...req, sessionKey: 'may-2027' });
    const nov = resolveBlueprint({ variants: vs }, { ...req, sessionKey: 'nov-2027' });
    expect(may.selected!.identityKey).toBe(nov.selected!.identityKey);
  });
  it('a session variant with an unchanged structure is rejected', () => {
    const dup = variantsOf(IB_MATH_AA_HL_V2, [{ purpose: 'REDUCED_MOCK', scope: { type: 'ENTIRE_ASSESSMENT' }, variant: { key: 'nov-boundaries', dimension: 'SESSION_STRUCTURE', reason: 'different grade boundaries in November' }, sessionApplicability: { type: 'SESSIONS', sessionKeys: ['nov-2027'] }, provenance: TEST }]);
    expect(codes(validateBlueprintCatalog(dup.variants))).toContain('STRUCTURE_UNCHANGED_SESSION_VARIANT');
  });
});

// ---------------------------------------------------------------------------
describe('T9 -- coursework has a blueprint but is never a mock', () => {
  const IB_AA_HL = structureConfig(subjectByKey('math-aa')!, 'HL')!;
  it('the IA has a structural reference, mockable = NO', () => {
    const r = variantsOf(IB_AA_HL);
    const ia = r.variants.find((v) => v.identity.scope.type === 'COMPONENT' && v.identity.scope.componentKey === 'ia')!;
    expect(ia.identity.purpose).toBe('OFFICIAL_STRUCTURE_REFERENCE');
    expect(ia.structuralCapability).toMatchObject({ mockable: 'NO', assemblable: 'NO' });
    expect(r.variants.some((v) => v.identity.purpose === 'FULL_MOCK' || v.identity.purpose === 'REDUCED_MOCK')).toBe(false);
  });
  it('declaring a mock over the IA is refused', () => {
    const r = compileBlueprintVariants(IB_AA_HL, { deriveFromConfig: false, declared: [{ purpose: 'REDUCED_MOCK', scope: { type: 'COMPONENT', componentKey: 'ia' }, variant: { key: 'standard', dimension: 'STANDARD', reason: null }, provenance: TEST }] });
    expect(codes(r)).toContain('MOCK_SCOPE_INCLUDES_NON_MOCKABLE');
  });
  it('Visual Arts: component training exists, no mock variant', () => {
    const vs = variantsOf(IB_VISUAL_ARTS_HL_V2).variants;
    expect(vs.filter((v) => v.identity.purpose === 'COMPONENT_TRAINING').map((v) => v.componentKeys[0])).toEqual(['aip', 'project', 'resolved']);
    expect(vs.every((v) => v.identity.purpose !== 'REDUCED_MOCK' && v.identity.purpose !== 'FULL_MOCK')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('T10 -- PAA domain practice coexists with the whole-assessment structure', () => {
  const declared: DeclaredVariantInput[] = [{ purpose: 'PRACTICE', scope: { type: 'DOMAIN', domainKey: 'lectura-redaccion' }, variant: { key: 'standard', dimension: 'STANDARD', reason: null }, provenance: TEST }];
  const vs = variantsOf(PAA_V2, declared).variants;
  const base = { examDefinitionKey: PAA_V2.key, specificationKey: 'paa-revisada@2021', purpose: 'PRACTICE' as const };
  it('both resolve; without a scope the request asks for one', () => {
    expect(resolveBlueprint({ variants: vs }, { ...base, scope: { type: 'DOMAIN', domainKey: 'lectura-redaccion' } }).selected!.componentKeys).toEqual(['lectura', 'redaccion']);
    expect(resolveBlueprint({ variants: vs }, { ...base, scope: { type: 'ENTIRE_ASSESSMENT' } }).selected!.componentKeys).toEqual(['lectura', 'redaccion', 'matematicas', 'ingles']);
    expect(resolveBlueprint({ variants: vs }, base)).toMatchObject({ status: 'MISSING_CONTEXT', missingInformation: ['scope'] });
    expect(validateBlueprintCatalog(vs, { exams: new Map([examEntry(PAA_V2)]) }).ok).toBe(true);
  });
  it('a domain that does not exist is impossible', () => {
    const r = compileBlueprintVariants(PAA_V2, { deriveFromConfig: false, declared: [{ ...declared[0], scope: { type: 'DOMAIN', domainKey: 'ciencias' } }] });
    expect(codes(r)).toContain('IMPOSSIBLE_SCOPE');
  });
});

// ---------------------------------------------------------------------------
describe('T11 -- a PISA-style benchmark never becomes a FULL_MOCK', () => {
  const declared: DeclaredVariantInput[] = [{ purpose: 'BENCHMARK', scope: { type: 'ENTIRE_ASSESSMENT' }, variant: { key: 'standard', dimension: 'STANDARD', reason: null }, provenance: TEST }];
  const vs = variantsOf(PISA_2022_V2, declared).variants;
  const base = { examDefinitionKey: PISA_2022_V2.key, specificationKey: 'pisa-2022@2022' };
  it('BENCHMARK resolves as BENCHMARK; FULL_MOCK finds nothing', () => {
    const spec = compileExam(PISA_2022_V2).examDefinition!.specification.key;
    const key = spec.status === 'STATED' ? spec.value : null;
    expect(resolveBlueprint({ variants: vs }, { ...base, specificationKey: key, purpose: 'BENCHMARK' }).selected!.identity.purpose).toBe('BENCHMARK');
    const full = resolveBlueprint({ variants: vs }, { ...base, specificationKey: key, purpose: 'FULL_MOCK' });
    expect(full.status).toBe('NO_MATCH');
    expect(full.candidates.find((c) => c.identityKey.includes('|BENCHMARK|'))!.reasons).toEqual(['PURPOSE_MISMATCH: BENCHMARK']);
  });
});

// ---------------------------------------------------------------------------
describe('T12 -- resolution does not depend on catalog order', () => {
  const vs = [
    ...variantsOf(IB_MATH_AA_HL_V2).variants,
    ...variantsOf(AICE_9709_AS).variants,
    ...variantsOf(PAA_V2, [{ purpose: 'PRACTICE', scope: { type: 'DOMAIN', domainKey: 'matematicas' }, variant: { key: 'standard', dimension: 'STANDARD', reason: null }, provenance: TEST }]).variants,
  ];
  const requests: ResolveBlueprintRequest[] = [
    { examDefinitionKey: IB_MATH_AA_HL_V2.key, specificationKey: IB_SPEC, purpose: 'COMPONENT_TRAINING', scope: { type: 'COMPONENT', componentKey: 'p2' } },
    { examDefinitionKey: AICE_9709_AS.key, specificationKey: 'cie-aice-9709@2026-2027', purpose: 'REDUCED_MOCK' },
    { examDefinitionKey: PAA_V2.key, specificationKey: 'paa-revisada@2021', purpose: 'PRACTICE' },
    { examDefinitionKey: PAA_V2.key, specificationKey: 'paa-revisada@2021', purpose: 'FULL_MOCK' },
  ];
  const shuffle = (xs: BlueprintVariantV2[], seed: number) => xs.map((x, i) => ({ x, k: (i * 7919 + seed * 104729) % 1009 })).sort((a, b) => a.k - b.k).map((e) => e.x);
  it.each(requests.map((r, i) => [i, r] as const))('request %i', (_i, req) => {
    const reference = resolveBlueprint({ variants: vs }, req);
    for (const order of [[...vs].reverse(), shuffle(vs, 1), shuffle(vs, 2), shuffle(vs, 3)]) expect(resolveBlueprint({ variants: order }, req)).toEqual(reference);
  });
});

// ---------------------------------------------------------------------------
describe('catalog validator matrix', () => {
  const ib = variantsOf(IB_MATH_AA_HL_V2);
  const exams = new Map([examEntry(IB_MATH_AA_HL_V2)]);
  const practice = ib.variants.find((v) => v.identity.purpose === 'PRACTICE')!;
  const declare = (d: Partial<DeclaredVariantInput>) => compileBlueprintVariants(IB_MATH_AA_HL_V2, { deriveFromConfig: false, declared: [{ purpose: 'PRACTICE', scope: { type: 'ENTIRE_ASSESSMENT' }, variant: { key: 'standard', dimension: 'STANDARD', reason: null }, provenance: TEST, ...d }] });

  it('impossible scope / component / route', () => {
    expect(codes(declare({ scope: { type: 'COMPONENT', componentKey: 'p9' } }))).toContain('COMPONENT_NOT_IN_DEFINITION');
    expect(codes(declare({ scope: { type: 'SECTION', componentKey: 'p1', sectionKey: 'Z' } }))).toContain('IMPOSSIBLE_SCOPE');
    expect(codes(declare({ scope: { type: 'ROUTE', routeKey: 'AS_ONLY', componentSet: ['p1'] } }))).toContain('ROUTE_NOT_APPLICABLE');
    expect(codes(declare({ scope: { type: 'CUSTOM_SUBSET', componentKeys: ['p1', 'ia'], rationale: 'papers plus internal assessment' } }))).toContain('COMPONENT_NOT_IN_DEFINITION');
    const forgedScope: BlueprintVariantV2 = { ...practice, componentKeys: ['p1'] };
    expect(codes(validateBlueprintCatalog([forgedScope], { exams }))).toContain('IMPOSSIBLE_SCOPE');
  });
  it('variant keys: no display labels, no Mock ordinals, reasons for non-standard variants, one STANDARD', () => {
    const labelled = { ...practice, identity: { ...practice.identity, variant: { key: 'Paper 1', dimension: 'OTHER' as const, reason: 'x' } } };
    expect(codes(validateBlueprintCatalog([labelled]))).toContain('VARIANT_KEY_IS_DISPLAY_LABEL');
    const slugLabel = declare({ scope: { type: 'COMPONENT', componentKey: 'p1' }, variant: { key: 'paper-1-no-calculator', dimension: 'OTHER', reason: 'named after the paper' } }).variants;
    expect(codes(validateBlueprintCatalog(slugLabel, { exams }))).toContain('VARIANT_KEY_IS_DISPLAY_LABEL');
    const ordinal = declare({ variant: { key: 'mock-2', dimension: 'OTHER', reason: 'second mock' } }).variants;
    expect(codes(validateBlueprintCatalog(ordinal))).toContain('MOCK_ORDINAL_IN_IDENTITY');
    const noReason = declare({ variant: { key: 'regional', dimension: 'REGIONAL', reason: null } }).variants;
    expect(codes(validateBlueprintCatalog(noReason))).toContain('OVERLAPPING_VARIANTS_WITHOUT_DISAMBIGUATOR');
    const twoStandards = [...declare({}).variants, ...declare({ variant: { key: 'base', dimension: 'STANDARD', reason: null } }).variants];
    expect(codes(validateBlueprintCatalog(twoStandards))).toContain('OVERLAPPING_VARIANTS_WITHOUT_DISAMBIGUATOR');
  });
  it('integrity of identity key and structure fingerprint', () => {
    expect(codes(validateBlueprintCatalog([{ ...practice, identityKey: 'x' }]))).toContain('IDENTITY_KEY_MISMATCH');
    expect(codes(validateBlueprintCatalog([{ ...practice, structureFingerprint: 'f'.repeat(64) }]))).toContain('STRUCTURE_FINGERPRINT_MISMATCH');
  });
});
