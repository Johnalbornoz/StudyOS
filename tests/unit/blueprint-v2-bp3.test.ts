/**
 * Blueprint Engine V2 / BP-3 -- runtime resolution SHADOW, canonical exam
 * identity, aliases, structural diagnostics, frozen assessment context.
 * T1-T15 from the BP-3 brief plus flow-specific contexts.
 *
 * Legacy is simulated from exactly what the apply service writes (one
 * blueprint per version); nothing touches a database. Declared variants use
 * an explicit TEST authority.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  compileBlueprintVariants,
  compileExam,
  compareLegacyAndV2BlueprintResolution,
  contextForStudentInstance,
  contextForFullMockRequest,
  contextForOperations,
  contextForQbCertification,
  legacySnapshotFromConfig,
  observeBlueprintSelection,
  toShadowRecord,
  SHADOW_RECORD_KEYS,
  blueprintV2Mode,
  freezeBlueprintResolution,
  checkFrozenContext,
  resolveBlueprint,
  runShadowParity,
  identityRecord,
  detectIdentityCollisions,
  ibFullConfigAliasEvidence,
  replacedIbStructureConfigs,
  routeStructures,
  structuralFullMockDiagnostic,
  provenance,
  defaultSourceRegistry,
  type BlueprintVariantV2,
  type DeclaredVariantInput,
  type RuntimeBlueprintContext,
  type ShadowRecord,
} from '@/lib/exam-core/blueprint-v2';
import { structureConfig, subjectByKey } from '@/lib/exam-core/catalog/ib-dp';
import { allV2Configs } from '@/lib/exam-core/verticals/v2/all';
import { DEV_CERT_VERTICALS } from '@/lib/exam-core/verticals';
import { IB_MATH_AA_HL_V2, IB_VISUAL_ARTS_HL_V2, PAA_V2, AICE_9709_AS, AICE_9709_A, AICE_9700_AS } from '@/lib/exam-core/verticals/v2';
import type { ExamVerticalConfigInput } from '@/lib/exam-core/vertical-config';

const TEST = provenance('INSTITUTION_SUPPLIED', ['test-fixture-institution']);
const IB_SPEC = 'ib-dp-math-aa@2021';
const IB_ALL = ['p1', 'p2', 'p3'];
const catalogOf = (...cfgs: unknown[]) => ({ variants: cfgs.flatMap((c) => compileBlueprintVariants(c).variants) });
const legacyOf = (cfg: unknown, componentKeys?: string[]) => legacySnapshotFromConfig(cfg, { examVersionId: 'ev-1', blueprintId: 'bp-legacy-1', componentKeys });
const ibBase = { examVersionId: 'ev-1', examDefinitionKey: IB_MATH_AA_HL_V2.key, specificationKey: IB_SPEC, allComponentKeys: IB_ALL };
const CALC: DeclaredVariantInput[] = [
  { purpose: 'PRACTICE', scope: { type: 'COMPONENT', componentKey: 'p1' }, variant: { key: 'no-calculator', dimension: 'CALCULATOR', reason: 'practice without technology' }, provenance: TEST },
  { purpose: 'PRACTICE', scope: { type: 'COMPONENT', componentKey: 'p1' }, variant: { key: 'with-gdc', dimension: 'CALCULATOR', reason: 'same content with a GDC' }, provenance: TEST, config: { ...IB_MATH_AA_HL_V2, sections: IB_MATH_AA_HL_V2.sections.map((s) => (s.key === 'p1' ? { ...s, definition: { ...s.definition!, calculatorPolicy: 'GDC_REQUIRED' as const } } : s)) } },
];

// ---------------------------------------------------------------------------
describe('T1 -- legacy single blueprint == V2 single compatible candidate', () => {
  it('IB Math AA HL practice: MATCH on the same structure and identity source', () => {
    const ctx = contextForStudentInstance({ ...ibBase, mode: 'PRACTICE', instancePurpose: null, componentKeys: IB_ALL });
    expect(ctx).toMatchObject({ purpose: 'PRACTICE', scope: { type: 'ENTIRE_ASSESSMENT' }, sourceFlow: 'STUDENT_EXAM_INSTANCE' });
    const cmp = compareLegacyAndV2BlueprintResolution(ctx, legacyOf(IB_MATH_AA_HL_V2), catalogOf(IB_MATH_AA_HL_V2));
    expect(cmp.parityStatus).toBe('MATCH');
    expect(cmp.v2Resolution.status).toBe('SINGLE_COMPATIBLE_MATCH');
    expect(cmp.v2Selected!.cellStructureFingerprint).toBe(cmp.legacyBlueprint!.cellStructureFingerprint);
  });
  it('every V2 bank configuration matches for practice and diagnostic', () => {
    const r = runShadowParity(allV2Configs());
    const practice = r.records.filter((x) => x.purpose === 'PRACTICE' || x.purpose === 'DIAGNOSTIC');
    expect(practice).toHaveLength(60);
    expect(practice.every((x) => x.parity_status === 'MATCH')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('T2 -- two V2 candidates: AMBIGUOUS, legacy untouched', () => {
  const catalog = { variants: compileBlueprintVariants(IB_MATH_AA_HL_V2, { declared: CALC }).variants };
  const ctx: RuntimeBlueprintContext = { examVersionId: 'ev-1', examDefinitionKey: IB_MATH_AA_HL_V2.key, specificationKey: IB_SPEC, purpose: 'PRACTICE', scope: { type: 'COMPONENT', componentKey: 'p1' }, sourceFlow: 'STUDENT_EXAM_INSTANCE' };
  it('records AMBIGUOUS_V2 with both identities and selects nothing', () => {
    const legacy = Object.freeze(legacyOf(IB_MATH_AA_HL_V2, ['p1']));
    const before = JSON.stringify(legacy);
    const cmp = compareLegacyAndV2BlueprintResolution(ctx, legacy, catalog);
    expect(cmp).toMatchObject({ parityStatus: 'AMBIGUOUS_V2', v2Selected: null });
    expect(cmp.ambiguity!.identityKeys).toHaveLength(2);
    expect(cmp.legacyBlueprint).toBe(legacy);
    expect(JSON.stringify(legacy)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
describe('T3 -- component training never resolves to a mock', () => {
  it('Paper 1 practice resolves COMPONENT_TRAINING(p1)', () => {
    const ctx = contextForStudentInstance({ ...ibBase, mode: 'PRACTICE', instancePurpose: null, componentKeys: ['p1'] });
    expect(ctx).toMatchObject({ purpose: 'COMPONENT_TRAINING', scope: { type: 'COMPONENT', componentKey: 'p1' } });
    const cmp = compareLegacyAndV2BlueprintResolution(ctx, legacyOf(IB_MATH_AA_HL_V2, ['p1']), catalogOf(IB_MATH_AA_HL_V2));
    expect(cmp.parityStatus).toBe('MATCH');
    expect(cmp.v2Resolution.selected!.identity.purpose).toBe('COMPONENT_TRAINING');
  });
  it('a catalog with only mocks gives NO_MATCH, not the mock', () => {
    const mocksOnly = { variants: catalogOf(IB_MATH_AA_HL_V2).variants.filter((v) => v.identity.purpose === 'REDUCED_MOCK') };
    const ctx = contextForStudentInstance({ ...ibBase, mode: 'PRACTICE', instancePurpose: null, componentKeys: ['p1'] });
    expect(resolveBlueprint(mocksOnly, { ...ctx }).status).toBe('NO_MATCH');
  });
});

// ---------------------------------------------------------------------------
const IB_AA_HL_STRUCTURE = structureConfig(subjectByKey('math-aa')!, 'HL')!;
const identityCorpus = () => [
  ...[...allV2Configs(), ...DEV_CERT_VERTICALS].map((c) => identityRecord(c, true)!),
  ...replacedIbStructureConfigs().map((c) => identityRecord(c, false)!),
];

describe('T4 -- the same canonical exam under two config IDs is detected', () => {
  it('IB Math AA HL: hand-written config + the generated structure it replaces', () => {
    const report = detectIdentityCollisions([identityRecord(IB_MATH_AA_HL_V2, true)!, identityRecord(IB_AA_HL_STRUCTURE, false)!], ibFullConfigAliasEvidence());
    expect(report.groups).toHaveLength(1);
    expect(report.groups[0]).toMatchObject({ canonicalKey: 'IB|ib-dp-math-aa|hl', specificationKey: IB_SPEC, configKeys: ['v2.ib.math-aa-hl', 'v2.ib.s.math-aa-hl'], classification: 'EXPECTED_ALIAS', appliedConfigKeys: ['v2.ib.math-aa-hl'], evidence: { kind: 'CODEBASE_MAPPING' } });
  });
  it('without evidence the same pair is an UNEXPECTED_COLLISION (no automatic aliasing)', () => {
    const report = detectIdentityCollisions([identityRecord(IB_MATH_AA_HL_V2, true)!, identityRecord(IB_AA_HL_STRUCTURE, false)!]);
    expect(report.groups[0].classification).toBe('UNEXPECTED_COLLISION');
  });
  it('a stray copy under another key is an unexpected collision even when other aliases have evidence', () => {
    const copy = { ...PAA_V2, key: 'v2.paa-copy' };
    const report = detectIdentityCollisions([identityRecord(PAA_V2, true)!, identityRecord(copy, true)!], ibFullConfigAliasEvidence());
    expect(report.groups[0]).toMatchObject({ canonicalKey: 'PAA|paa-revisada|no-level', classification: 'UNEXPECTED_COLLISION', structure: { status: 'IDENTICAL_STRUCTURE' } });
  });
  it('the applied catalogue: 12 expected IB aliases, no unexpected collision; V1 configs stay unresolved', () => {
    const report = detectIdentityCollisions(identityCorpus(), ibFullConfigAliasEvidence());
    expect(report.groups.filter((g) => g.classification === 'EXPECTED_ALIAS')).toHaveLength(12);
    expect(report.groups.filter((g) => g.classification === 'UNEXPECTED_COLLISION')).toEqual([]);
    expect(report.unresolved.map((u) => u.configKey).sort()).toEqual(DEV_CERT_VERTICALS.map((c) => c.key).sort());
    expect(report.groups.every((g) => g.appliedConfigKeys.length === 1)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('T5 -- alias + structural divergence is reported, never merged', () => {
  const a = identityRecord(IB_MATH_AA_HL_V2, true)!;
  const b = identityRecord(IB_AA_HL_STRUCTURE, false)!;
  const beforeA = a.definition.fingerprint;
  const report = detectIdentityCollisions([a, b], ibFullConfigAliasEvidence());
  it('CANONICAL_IDENTITY_MATCH / STRUCTURE_DIVERGENCE: the IA exists only in the generated structure', () => {
    expect(report.groups[0].structure.status).toBe('STRUCTURE_DIVERGENCE');
    expect(report.groups[0].structure.componentsOnlyIn).toEqual({ 'v2.ib.s.math-aa-hl': ['ia'] });
  });
  it('nothing is merged: definitions unchanged, no union of components produced', () => {
    expect(a.definition.fingerprint).toBe(beforeA);
    expect(a.definition.components.map((c) => c.key)).toEqual(['p1', 'p2', 'p3']);
    expect(JSON.stringify(report)).not.toContain('mergedComponents');
  });
});

// ---------------------------------------------------------------------------
describe('T6 -- specification versions of the same exam stay distinct', () => {
  it('same canonical exam, two specifications: listed, never a collision', () => {
    const next: ExamVerticalConfigInput = { ...IB_MATH_AA_HL_V2, version: { ...IB_MATH_AA_HL_V2.version, label: 'V2 next' }, framework: { ...IB_MATH_AA_HL_V2.framework!, frameworkVersion: '2028', firstAssessment: 2028, lastAssessment: null } };
    const report = detectIdentityCollisions([identityRecord(IB_MATH_AA_HL_V2, true)!, identityRecord(next, false)!]);
    expect(report.groups).toEqual([]);
    expect(report.specificationsOfSameExam).toEqual([{ canonicalKey: 'IB|ib-dp-math-aa|hl', specifications: [{ specificationKey: 'ib-dp-math-aa@2021', configKeys: ['v2.ib.math-aa-hl'] }, { specificationKey: 'ib-dp-math-aa@2028', configKeys: ['v2.ib.math-aa-hl'] }] }]);
  });
});

// ---------------------------------------------------------------------------
describe('T7 -- AICE 9709 staged route: one structure, two session sequencings', () => {
  const bp = compileExam(AICE_9709_A).blueprint!;
  it('the duplicated staged set is one structure with both stagings', () => {
    const staged = routeStructures(bp).filter((r) => r.routeKey === 'A_LEVEL_STAGED');
    const p1345 = staged.find((r) => r.componentSet.join('+') === 'p1+p3+p4+p5')!;
    expect(p1345.listedTimes).toBe(2);
    expect(p1345.sessionSequencings).toEqual([[['p1', 'p4'], ['p3', 'p5']], [['p1', 'p5'], ['p3', 'p4']]]);
  });
  it('one blueprint identity for that set', () => {
    const ids = compileBlueprintVariants(AICE_9709_A).variants.filter((v) => v.identityKey.includes('ROUTE(A_LEVEL_STAGED:p1+p3+p4+p5)'));
    expect(ids).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
describe('T8 -- coursework exams expose no structural FULL_MOCK capability', () => {
  const diag = (cfg: unknown) => {
    const e = compileExam(cfg);
    return structuralFullMockDiagnostic(e.examDefinition!, e.blueprint!, compileBlueprintVariants(cfg).variants);
  };
  it('Visual Arts HL: UNSUPPORTED, every component non-mockable coursework', () => {
    const d = diag(IB_VISUAL_ARTS_HL_V2);
    expect(d.status).toBe('STRUCTURAL_FULL_MOCK_UNSUPPORTED');
    expect(d.reasons).toEqual([{ code: 'NON_MOCKABLE_COMPONENT', componentKey: 'aip', componentClass: 'COURSEWORK' }, { code: 'NON_MOCKABLE_COMPONENT', componentKey: 'project', componentClass: 'COURSEWORK' }, { code: 'NON_MOCKABLE_COMPONENT', componentKey: 'resolved', componentClass: 'COURSEWORK' }]);
    expect(d.structuralCapabilities).toEqual({ supportsMock: 'NO', supportsCoursework: 'YES', fullLengthStructure: 'UNKNOWN' });
    expect(Object.keys(d)).not.toContain('contentReadiness');
  });
  it('AICE 9700 AS: every route set includes the practical', () => {
    const d = diag(AICE_9700_AS);
    expect(d.status).toBe('STRUCTURAL_FULL_MOCK_UNSUPPORTED');
    expect(d.reasons.map((r) => r.code)).toEqual(expect.arrayContaining(['NON_MOCKABLE_COMPONENT', 'ALL_ROUTE_SETS_INCLUDE_NON_MOCKABLE']));
    expect(d.reasons.find((r) => r.code === 'NON_MOCKABLE_COMPONENT')!.componentClass).toBe('PRACTICAL');
  });
  it('the 10 bank configurations without a structural mock, as consumed by the QB track', () => {
    const unsupported = allV2Configs()
      .map((c) => ({ key: (c as { key: string }).key, d: diag(c) }))
      .filter((x) => x.d.status === 'STRUCTURAL_FULL_MOCK_UNSUPPORTED')
      .map((x) => x.key)
      .sort();
    expect(unsupported).toEqual(['v2.aice.9239-a', 'v2.aice.9239-as', 'v2.aice.9700-a', 'v2.aice.9700-as', 'v2.aice.9701-a', 'v2.aice.9701-as', 'v2.aice.9702-a', 'v2.aice.9702-as', 'v2.ib.visual-arts-hl', 'v2.ib.visual-arts-sl']);
    expect(diag(IB_MATH_AA_HL_V2).status).toBe('STRUCTURAL_FULL_MOCK_NOT_AT_OFFICIAL_LENGTH');
    expect(diag(IB_AA_HL_STRUCTURE).status).toBe('NOT_ASSEMBLABLE');
  });
});

// ---------------------------------------------------------------------------
describe('T9 -- a reduced blueprint never satisfies a Student Full Mock request', () => {
  it('PAA: legacy would answer with its reduced form; V2 says NO_MATCH with the reason', () => {
    const ctx = contextForFullMockRequest({ examVersionId: 'ev-paa', examDefinitionKey: PAA_V2.key, specificationKey: 'paa-revisada@2021' });
    const cmp = compareLegacyAndV2BlueprintResolution(ctx, legacyOf(PAA_V2), catalogOf(PAA_V2));
    expect(cmp.parityStatus).toBe('LEGACY_ONLY');
    expect(cmp.v2Resolution.status).toBe('NO_MATCH');
    expect(cmp.v2Resolution.reasons).toContain('REDUCED_FORM_CANNOT_SATISFY_FULL_MOCK');
  });
});

// ---------------------------------------------------------------------------
describe('T10 -- independent of configuration and catalog order', () => {
  it('same records whatever the order', () => {
    const cfgs = [IB_MATH_AA_HL_V2, PAA_V2, AICE_9709_AS, AICE_9709_A, IB_VISUAL_ARTS_HL_V2];
    const sortRecords = (rs: ShadowRecord[]) => [...rs].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    const a = runShadowParity(cfgs);
    const b = runShadowParity([...cfgs].reverse());
    expect(sortRecords(b.records)).toEqual(sortRecords(a.records));
    expect(b.totals).toEqual(a.totals);
  });
});

// ---------------------------------------------------------------------------
describe('T11 -- a missing route is MISSING_CONTEXT, never chosen', () => {
  const ctx = (cfg: ExamVerticalConfigInput, spec: string, set: string[]) => contextForStudentInstance({ examVersionId: 'ev-a', examDefinitionKey: cfg.key, specificationKey: spec, allComponentKeys: cfg.sections.map((s) => s.key), mode: 'MOCK', instancePurpose: null, componentKeys: set, runtimeUse: 'REDUCED_MOCK', examHasRoutes: true });
  it('9709 A: the same four papers belong to the staged and the linear route', () => {
    const cmp = compareLegacyAndV2BlueprintResolution(ctx(AICE_9709_A, 'cie-aice-9709@2026-2027', ['p1', 'p3', 'p4', 'p5']), legacyOf(AICE_9709_A, ['p1', 'p3', 'p4', 'p5']), catalogOf(AICE_9709_A));
    expect(cmp).toMatchObject({ parityStatus: 'MISSING_CONTEXT', missingContext: ['route'], v2Selected: null });
  });
  it('9709 AS: {p1,p4} belongs to one route set only, so it matches without choosing anything', () => {
    const cmp = compareLegacyAndV2BlueprintResolution(ctx(AICE_9709_AS, 'cie-aice-9709@2026-2027', ['p1', 'p4']), legacyOf(AICE_9709_AS, ['p1', 'p4']), catalogOf(AICE_9709_AS));
    expect(cmp.parityStatus).toBe('MATCH');
  });
});

// ---------------------------------------------------------------------------
const NO_P3 = { ...IB_MATH_AA_HL_V2, sections: IB_MATH_AA_HL_V2.sections.filter((s) => s.key !== 'p3'), items: IB_MATH_AA_HL_V2.items.filter((i) => !i.objectiveCode.startsWith('aahl.p3')) };
const SESSION_VARIANTS: DeclaredVariantInput[] = [
  { purpose: 'REDUCED_MOCK', scope: { type: 'ENTIRE_ASSESSMENT' }, variant: { key: 'standard', dimension: 'STANDARD', reason: null }, sessionApplicability: { type: 'SESSIONS', sessionKeys: ['may-2027'] }, provenance: TEST },
  { purpose: 'REDUCED_MOCK', scope: { type: 'ENTIRE_ASSESSMENT' }, variant: { key: 'nov-2027-structure', dimension: 'SESSION_STRUCTURE', reason: 'test: a sitting with a different paper structure' }, sessionApplicability: { type: 'SESSIONS', sessionKeys: ['nov-2027'] }, provenance: TEST, config: NO_P3 },
];

describe('T12 -- a session-structural variant needs the session', () => {
  const catalog = { variants: compileBlueprintVariants(IB_MATH_AA_HL_V2, { declared: SESSION_VARIANTS, deriveFromConfig: false }).variants };
  const ctx: RuntimeBlueprintContext = { examVersionId: 'ev-1', examDefinitionKey: IB_MATH_AA_HL_V2.key, specificationKey: IB_SPEC, purpose: 'REDUCED_MOCK', scope: { type: 'ENTIRE_ASSESSMENT' }, sourceFlow: 'STUDENT_EXAM_INSTANCE' };
  it('without a session: MISSING_CONTEXT session', () => {
    expect(compareLegacyAndV2BlueprintResolution(ctx, legacyOf(IB_MATH_AA_HL_V2), catalog)).toMatchObject({ parityStatus: 'MISSING_CONTEXT', missingContext: ['session'] });
  });
  it('with the November session: the November structure, which differs from legacy (STRUCTURAL_MISMATCH reported)', () => {
    const cmp = compareLegacyAndV2BlueprintResolution({ ...ctx, sessionKey: 'nov-2027' }, legacyOf(IB_MATH_AA_HL_V2), catalog);
    expect(cmp.v2Selected!.identityKey).toMatch(/nov-2027-structure$/);
    expect(cmp.parityStatus).toBe('STRUCTURAL_MISMATCH');
  });
});

// ---------------------------------------------------------------------------
describe('T13 -- a boundary-only session difference keeps the blueprint identity', () => {
  it('May and November resolve the same variant', () => {
    const catalog = catalogOf(IB_MATH_AA_HL_V2);
    const ctx = contextForStudentInstance({ ...ibBase, mode: 'MOCK', instancePurpose: null, componentKeys: IB_ALL, runtimeUse: 'REDUCED_MOCK' });
    const may = compareLegacyAndV2BlueprintResolution({ ...ctx, sessionKey: 'may-2027' }, legacyOf(IB_MATH_AA_HL_V2), catalog);
    const nov = compareLegacyAndV2BlueprintResolution({ ...ctx, sessionKey: 'nov-2027' }, legacyOf(IB_MATH_AA_HL_V2), catalog);
    expect(may.v2Selected!.identityKey).toBe(nov.v2Selected!.identityKey);
    expect(may.parityStatus).toBe('MATCH');
  });
});

// ---------------------------------------------------------------------------
describe('T14 -- a frozen assessment context survives catalog changes', () => {
  const ctx = contextForStudentInstance({ ...ibBase, mode: 'PRACTICE', instancePurpose: null, componentKeys: ['p1'] });
  const before = catalogOf(IB_MATH_AA_HL_V2);
  const res = resolveBlueprint(before, ctx);
  const out = freezeBlueprintResolution(ctx, res);
  const frozen = 'frozen' in out ? out.frozen : null;
  it('freezes identity, structure, specification, purpose and scope', () => {
    expect(frozen).toMatchObject({ examDefinitionKey: IB_MATH_AA_HL_V2.key, specificationKey: IB_SPEC, purpose: 'COMPONENT_TRAINING', scope: 'COMPONENT(p1)', route: null, sessionKey: null });
  });
  it('later catalog changes are reported, the frozen context stays authoritative and intact', () => {
    const after = { variants: before.variants.filter((v) => v.identityKey !== frozen!.variantIdentityKey) };
    expect(checkFrozenContext(frozen!, before)).toEqual({ frozenRemainsAuthoritative: true, intact: true, catalogStatus: 'UNCHANGED' });
    expect(checkFrozenContext(frozen!, after)).toEqual({ frozenRemainsAuthoritative: true, intact: true, catalogStatus: 'VARIANT_REMOVED' });
    const changed = { variants: before.variants.map((v) => (v.identityKey === frozen!.variantIdentityKey ? ({ ...v, structureFingerprint: 'f'.repeat(64) } as BlueprintVariantV2) : v)) };
    expect(checkFrozenContext(frozen!, changed).catalogStatus).toBe('VARIANT_STRUCTURE_CHANGED');
    expect(checkFrozenContext({ ...frozen!, purpose: 'FULL_MOCK' }, before).intact).toBe(false);
  });
  it('only a single selected resolution can be frozen', () => {
    const ambiguous = resolveBlueprint({ variants: compileBlueprintVariants(IB_MATH_AA_HL_V2, { declared: CALC }).variants }, { examDefinitionKey: IB_MATH_AA_HL_V2.key, specificationKey: IB_SPEC, purpose: 'PRACTICE', scope: { type: 'COMPONENT', componentKey: 'p1' } });
    expect(freezeBlueprintResolution(ctx, ambiguous)).toEqual({ error: 'cannot freeze a AMBIGUOUS resolution' });
  });
});

// ---------------------------------------------------------------------------
describe('T15 -- the shadow record carries no student data', () => {
  const ctx = { ...contextForStudentInstance({ ...ibBase, mode: 'PRACTICE', instancePurpose: null, componentKeys: IB_ALL }), studentId: 'student-123', email: 'x@example.com' } as RuntimeBlueprintContext;
  it('only the whitelisted fields', () => {
    const r = toShadowRecord(ctx, compareLegacyAndV2BlueprintResolution(ctx, legacyOf(IB_MATH_AA_HL_V2), catalogOf(IB_MATH_AA_HL_V2)), 'IB|ib-dp-math-aa|hl');
    expect(Object.keys(r).sort()).toEqual([...SHADOW_RECORD_KEYS].sort());
    expect(JSON.stringify(r)).not.toMatch(/student-123|example\.com|studentId|email/);
  });
  it('OFF computes nothing; SHADOW emits once; failures never reach the flow', () => {
    const sink = vi.fn();
    const catalog = vi.fn(() => catalogOf(IB_MATH_AA_HL_V2));
    observeBlueprintSelection(ctx, legacyOf(IB_MATH_AA_HL_V2), { catalog, sink, env: {} });
    observeBlueprintSelection(ctx, legacyOf(IB_MATH_AA_HL_V2), { catalog, sink, env: { EXAM_BLUEPRINT_V2: 'ON' } });
    expect(catalog).not.toHaveBeenCalled();
    expect(sink).not.toHaveBeenCalled();
    observeBlueprintSelection(ctx, legacyOf(IB_MATH_AA_HL_V2), { catalog, sink, env: { EXAM_BLUEPRINT_V2: 'SHADOW' } });
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0][0].parity_status).toBe('MATCH');
    expect(() => observeBlueprintSelection(ctx, null, { catalog: () => { throw new Error('boom'); }, sink, env: { EXAM_BLUEPRINT_V2: 'SHADOW' } })).not.toThrow();
    expect(blueprintV2Mode({})).toBe('OFF');
    expect(blueprintV2Mode({ EXAM_BLUEPRINT_V2: 'CUTOVER' })).toBe('OFF');
  });
});

// ---------------------------------------------------------------------------
describe('flow-specific contexts', () => {
  it('diagnostic resolves the diagnostic variant', () => {
    const ctx = contextForStudentInstance({ ...ibBase, mode: 'PRACTICE', instancePurpose: 'DIAGNOSTIC', componentKeys: IB_ALL });
    expect(ctx.sourceFlow).toBe('STUDENT_DIAGNOSTIC');
    expect(resolveBlueprint(catalogOf(IB_MATH_AA_HL_V2), ctx).selected!.identity.purpose).toBe('DIAGNOSTIC');
  });
  it('admin / factory must name the purpose and scope', () => {
    const ok = contextForOperations({ sourceFlow: 'FACTORY', examVersionId: 'ev-1', examDefinitionKey: IB_MATH_AA_HL_V2.key, specificationKey: IB_SPEC, purpose: 'PRACTICE', scope: { type: 'ENTIRE_ASSESSMENT' } });
    expect(resolveBlueprint(catalogOf(IB_MATH_AA_HL_V2), ok).status).toBe('SINGLE_COMPATIBLE_MATCH');
    // @ts-expect-error -- no implicit "first blueprint of the version": purpose and scope are required
    const missing = () => contextForOperations({ sourceFlow: 'ADMIN_QB_HEALTH', examVersionId: 'ev-1', examDefinitionKey: IB_MATH_AA_HL_V2.key, specificationKey: IB_SPEC });
    expect(typeof missing).toBe('function');
  });
  it('Question Bank certification targets one exact identity', () => {
    const ctx = contextForQbCertification({ examVersionId: 'ev-1', examDefinitionKey: IB_MATH_AA_HL_V2.key, specificationKey: IB_SPEC, purpose: 'COMPONENT_TRAINING', scope: { type: 'COMPONENT', componentKey: 'p2' }, variantKey: 'standard' });
    expect(resolveBlueprint(catalogOf(IB_MATH_AA_HL_V2), ctx)).toMatchObject({ status: 'EXACT_MATCH', selected: { identityKey: 'v2.ib.math-aa-hl|ib-dp-math-aa@2021|COMPONENT_TRAINING|COMPONENT(p2)|standard' } });
  });
  it('a full-length structure: Student Full Mock request resolves FULL_MOCK and can be frozen (test registry)', () => {
    const registry = new Map(defaultSourceRegistry());
    registry.set('test-official-source', { key: 'test-official-source', framework: 'TEST', title: 't', publisher: 't', url: null, publicationYear: null, confidence: 'HIGH', license: 'PUBLIC' });
    const full: ExamVerticalConfigInput = {
      key: 'test.full-length', family: 'PAA', contentStatus: 'ORIGINAL', organization: { name: 'Test body' }, programme: { name: 'Test', type: 'ADMISSION_EXAM' },
      definition: { name: 'Full-length test', purpose: 'unit test', domains: ['D'] },
      version: { label: 'T1', delivery: { navigation: 'LINEAR', breaks: [], itemFeedback: 'NEVER', resultReview: 'FULL', permittedResources: [] } },
      framework: { frameworkKey: 'test-framework', curriculumVersion: 'v1', firstAssessment: 2024, lastAssessment: null, syllabusCode: null, frameworkVersion: '1', sourceKeys: ['test-official-source'] },
      scoring: { name: 'raw', scoringType: 'BINARY', policy: { engine: 'exam-scoring-v1', strategy: 'RAW', transform: { type: 'NONE' }, unit: '%', provenance: { official: false, source: 'unit test fixture' } } },
      structureLabel: 'T1',
      sections: [{ key: 'only', name: 'Only', componentType: 'SECTION', definition: { officialName: 'Only', kind: 'MULTIPLE_CHOICE_TEST', assessment: 'EXTERNAL', officialDurationMinutes: 30, maxMarks: null, weightingPercent: null, officialItemCount: 3, calculatorPolicy: 'NONE', responseFormats: ['SELECTED_RESPONSE'], sourceKeys: ['test-official-source'] }, objectives: [{ code: 'test.obj', description: 'o', targets: [{ count: 3 }] }] }],
      items: [],
    };
    const catalog = { variants: compileBlueprintVariants(full, { registry }).variants };
    const ctx = contextForFullMockRequest({ examVersionId: 'ev-full', examDefinitionKey: 'test.full-length', specificationKey: 'test-framework@1' });
    const res = resolveBlueprint(catalog, ctx);
    expect(res.selected!.identity.purpose).toBe('FULL_MOCK');
    const out = freezeBlueprintResolution(ctx, res);
    expect('frozen' in out && out.frozen.purpose).toBe('FULL_MOCK');
    // Mock 1 and Mock 2 freeze the same blueprint identity and structure.
    const again = freezeBlueprintResolution(ctx, resolveBlueprint(catalog, ctx));
    expect('frozen' in again && 'frozen' in out && again.frozen.frozenFingerprint).toBe('frozen' in out ? out.frozen.frozenFingerprint : null);
  });
});

// ---------------------------------------------------------------------------
describe('parity across the applied catalogue (truth over green)', () => {
  const r = runShadowParity([...allV2Configs(), ...DEV_CERT_VERTICALS]);
  it('BP-2 catalog unchanged: 562 variants; structure-only exams are not replayed', () => {
    expect(r.variants).toBe(562);
    expect(r.notOfferedByRuntime).toHaveLength(50);
  });
  it('no MATCH is claimed where the runtime is ambiguous or unsupported', () => {
    // Saber 11 V2.1 (QB 802d9be) is full length: its Student Full Mock request now MATCHes (174 -> 175).
    expect(r.totals).toEqual({ MATCH: 175, LEGACY_ONLY: 43, MISSING_CONTEXT: 56 });
    for (const x of r.records) {
      if (x.parity_status === 'MATCH') expect(x.v2_structure_fingerprint).toBe(x.legacy_structure_fingerprint);
      if (x.parity_status !== 'MATCH') expect(x.v2_blueprint_identity === null || x.parity_status === 'STRUCTURAL_MISMATCH').toBe(true);
    }
  });
});
