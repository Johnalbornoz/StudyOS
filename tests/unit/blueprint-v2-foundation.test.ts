/**
 * Blueprint Engine V2 / BP-0 -- compiler, validator, pipeline and typed units
 * on representative configurations (IB multi-component, Cambridge IGCSE and
 * AS/A routes, PAA, ICFES Saber 11 + V1, a RAW-only assessment, a missing
 * boundary, an incomplete configuration, several blueprint candidates).
 *
 * The recurring assertion: nothing is invented. Unstated values are
 * UNKNOWN, unsourced or third-party values never resolve a stage, weights
 * are never renormalized, reduced forms are never weighted, and the pipeline
 * stops at the last stage it can resolve.
 */
import { describe, it, expect } from 'vitest';
import {
  compileBlueprint,
  validateBlueprint,
  evaluatePipeline,
  blueprintFingerprint,
  checkPipelineStructure,
  gradeFor,
  rawMarks,
  sumRawMarks,
  componentScore,
  weightedScore,
  authoritativeWeight,
  provenance,
  provenanceKindOfSource,
  combineProvenance,
  isAuthoritative,
  UNKNOWN_PROVENANCE,
  ScoreUnitError,
  type BlueprintV2,
  type OutcomeDeclaration,
  type RawMarks,
  type WeightedScore,
  type BoundarySet,
} from '@/lib/exam-core/blueprint-v2';
import { IB_MATH_AA_HL_V2, PAA_V2, SABER11_MATH_V2, CAMBRIDGE_0580_EXTENDED_V2, AICE_9709_AS } from '@/lib/exam-core/verticals/v2';
import { allV2Configs } from '@/lib/exam-core/verticals/v2/all';
import { DEV_CERT_VERTICALS } from '@/lib/exam-core/verticals';
import type { ExamVerticalConfigInput } from '@/lib/exam-core/vertical-config';

const codes = (r: { issues: Array<{ code: string }> }) => r.issues.map((i) => i.code);
const comp = (bp: BlueprintV2, key: string) => bp.components.find((c) => c.key === key)!;
const stage = (bp: BlueprintV2, kind: string) => bp.scoring.pipeline.find((s) => s.kind === kind);
const ok = (input: unknown, options?: Parameters<typeof compileBlueprint>[1]) => {
  const r = compileBlueprint(input, options);
  if (!r.blueprint) throw new Error(`no blueprint: ${JSON.stringify(r.issues)}`);
  return { ...r, blueprint: r.blueprint };
};
/** Re-seal a hand-edited document so a test isolates one finding (not the fingerprint). */
const reseal = (bp: BlueprintV2): BlueprintV2 => ({ ...bp, fingerprint: blueprintFingerprint(bp) });
const edit = (bp: BlueprintV2, fn: (d: BlueprintV2) => void): BlueprintV2 => {
  const d = structuredClone(bp);
  fn(d);
  return reseal(d);
};
/** Clearly test-only authority (an institution-supplied fixture), never an official claim. */
const TEST_AUTHORITY = provenance('INSTITUTION_SUPPLIED', ['test-fixture-institution']);
const marksAt = (bp: BlueprintV2, fraction: number): Record<string, RawMarks> =>
  Object.fromEntries(bp.components.map((c) => {
    const max = (c.official.maxMarks as { value: number }).value;
    return [c.key, rawMarks(Math.round(max * fraction), max)];
  }));

// ---------------------------------------------------------------------------
describe('IB multi-component (Math AA HL)', () => {
  const r = ok(IB_MATH_AA_HL_V2);
  const bp = r.blueprint;

  it('compiles the three configured papers with their official facts and sources', () => {
    expect(bp.components.map((c) => c.key)).toEqual(['p1', 'p2', 'p3']);
    expect(bp.components.map((c) => (c.official.maxMarks as { value: number }).value)).toEqual([110, 110, 55]);
    expect(bp.components.map((c) => (c.official.weightPercent as { value: number }).value)).toEqual([30, 30, 20]);
    const p1 = comp(bp, 'p1');
    expect(p1.official.maxMarks.status === 'STATED' && p1.official.maxMarks.provenance.kind).toBe('OFFICIAL_PUBLIC');
    expect(p1.official.maxMarks.status === 'STATED' && p1.official.maxMarks.provenance.sourceKeys).toEqual(['ibo-math-aa-brief-2021', 'ibo-math-aa-guide-2021', 'ibo-math-dp-page']);
    expect(p1.sections.map((s) => s.key)).toEqual(['A', 'B']);
    expect(bp.context.level).toBe('HL');
  });

  it('never invents the IA: weights cover 80% and are not renormalized', () => {
    expect(bp.components.some((c) => /ia|internal/i.test(c.key))).toBe(false);
    expect(stage(bp, 'COMPONENT_WEIGHTING')?.dependency.status).toBe('RESOLVED');
    expect(codes(r)).toContain('WEIGHTS_PARTIAL_COVERAGE');
  });

  it('reduced forms and StudyUs timing are policy, not facts', () => {
    expect(bp.components.every((c) => c.lengthFidelity === 'DEPENDS_ON_ITEM_MARKS')).toBe(true);
    expect(comp(bp, 'p1').delivery.durationMinutes).toEqual({ origin: 'STUDYUS_POLICY', value: 30, note: expect.any(String) });
    expect((comp(bp, 'p1').official.durationMinutes as { value: number }).value).toBe(120);
  });

  it('ends at the weighted score: no grade stage without a declared outcome', () => {
    expect(bp.scoring.pipeline.map((s) => s.kind)).toEqual(['ITEM_MARKS', 'COMPONENT_TOTAL', 'COMPONENT_WEIGHTING']);
    expect(bp.scoring.resolution).toEqual({ lastResolvableStage: 'COMPONENT_WEIGHTING', stoppedAt: null, stopReason: 'REPORTED_OUTCOME_NOT_DECLARED', outcomeDeclared: false });
    expect(r.unresolvedFields).toContain('scoring.reportedOutcome');
    expect(r.status).toBe('INCOMPLETE');
  });

  it('evaluates full papers to a typed weighted score over 80% of the subject', () => {
    const ev = evaluatePipeline(bp, { p1: rawMarks(88, 110), p2: rawMarks(77, 110), p3: rawMarks(44, 55) });
    const w = ev.outputs.find((o) => o.stage === 'COMPONENT_WEIGHTING')!.value as WeightedScore;
    expect(w.unit).toBe('WEIGHTED_SCORE');
    expect(w.value).toBe(61); // 0.8*30 + 0.7*30 + 0.8*20
    expect(w.coveredWeightPercent).toBe(80);
    expect(ev.stoppedAt).toBeNull();
  });

  it('a reduced practice form stops at component scores (18/25 is not 18/110)', () => {
    const ev = evaluatePipeline(bp, { p1: rawMarks(18, 25), p2: rawMarks(10, 20), p3: rawMarks(5, 10) });
    expect(ev.lastResolvedStage).toBe('COMPONENT_TOTAL');
    expect(ev.stoppedAt).toBe('COMPONENT_WEIGHTING');
    expect(ev.stopReason).toMatch(/^REDUCED_FORM_NOT_WEIGHTABLE/);
    const scores = ev.outputs.find((o) => o.stage === 'COMPONENT_TOTAL')!.value as Array<{ earned: number; max: number; maxBasis: string }>;
    expect(scores[0]).toMatchObject({ earned: 18, max: 25, maxBasis: 'DELIVERED' });
  });
});

// ---------------------------------------------------------------------------
describe('missing boundaries: the pipeline stops at the last resolvable stage', () => {
  // A structure-only IB configuration whose components (incl. internal assessment) carry 100% of the subject.
  const full = allV2Configs()
    .map((c) => ({ c, r: compileBlueprint(c) }))
    .find(({ r }) => stage(r.blueprint!, 'COMPONENT_WEIGHTING')?.dependency.status === 'RESOLVED' && !codes(r).includes('WEIGHTS_PARTIAL_COVERAGE') && r.blueprint!.identity.examFamily === 'IB')!;
  const declaration: OutcomeDeclaration = { provenance: TEST_AUTHORITY, stages: [{ kind: 'GRADE_BOUNDARIES', scope: 'SUBJECT', scaleKey: 'test-grade-scale', resolvedPer: 'SESSION' }] };
  const r = ok(full.c, { outcome: declaration });
  const bp = r.blueprint;

  it('declares the grade stage but leaves it UNRESOLVED: sessions are not modelled', () => {
    expect(bp.scoring.pipeline.map((s) => s.kind)).toEqual(['ITEM_MARKS', 'COMPONENT_TOTAL', 'COMPONENT_WEIGHTING', 'GRADE_BOUNDARIES']);
    expect(bp.scoring.resolution.lastResolvableStage).toBe('COMPONENT_WEIGHTING');
    expect(bp.scoring.resolution.stoppedAt).toBe('GRADE_BOUNDARIES');
    expect(bp.scoring.resolution.stopReason).toMatch(/^SESSION_NOT_RESOLVED/);
    expect(bp.session).toMatchObject({ requiredByPipeline: true, status: 'UNKNOWN' });
    expect(r.unresolvedFields).toEqual(expect.arrayContaining(['session', 'scoring.pipeline.GRADE_BOUNDARIES']));
  });

  it('weighted score available, grade UNKNOWN -- no silent fallback', () => {
    const ev = evaluatePipeline(bp, marksAt(bp, 0.5));
    expect(ev.lastResolvedStage).toBe('COMPONENT_WEIGHTING');
    expect((ev.outputs.at(-1)!.value as WeightedScore).coveredWeightPercent).toBe(100);
    expect(ev.stoppedAt).toBe('GRADE_BOUNDARIES');
    expect(ev.outputs.some((o) => o.stage === 'GRADE_BOUNDARIES')).toBe(false);
  });

  it('third-party boundaries never produce a grade', () => {
    const set: BoundarySet = { scaleKey: 'test-grade-scale', inputUnit: 'WEIGHTED_SCORE', provenance: provenance('THIRD_PARTY_REFERENCE', ['some-blog']), boundaries: [{ label: 'G1', min: 0 }, { label: 'G2', min: 40 }] };
    const ev = evaluatePipeline(bp, marksAt(bp, 0.5), { gradeBoundaries: set });
    expect(ev.stopReason).toMatch(/^NON_AUTHORITATIVE_BOUNDARIES/);
  });

  it('authoritative boundaries (test institution fixture) resolve a typed grade', () => {
    const set: BoundarySet = { scaleKey: 'test-grade-scale', inputUnit: 'WEIGHTED_SCORE', provenance: TEST_AUTHORITY, boundaries: [{ label: 'G1', min: 0 }, { label: 'G2', min: 40 }, { label: 'G3', min: 70 }] };
    const ev = evaluatePipeline(bp, marksAt(bp, 0.5), { gradeBoundaries: set });
    expect(ev.stoppedAt).toBeNull();
    expect(ev.outputs.at(-1)).toEqual({ stage: 'GRADE_BOUNDARIES', value: expect.objectContaining({ unit: 'GRADE', label: 'G2', scaleKey: 'test-grade-scale' }) });
  });

  it('an undeclared or non-authoritative outcome never resolves, even with boundaries supplied', () => {
    const shaky = ok(full.c, { outcome: { ...declaration, provenance: provenance('THIRD_PARTY_REFERENCE', ['forum']) } });
    expect(codes(shaky)).toContain('OUTCOME_DECLARATION_NOT_AUTHORITATIVE');
    const set: BoundarySet = { scaleKey: 'test-grade-scale', inputUnit: 'WEIGHTED_SCORE', provenance: TEST_AUTHORITY, boundaries: [{ label: 'G1', min: 0 }] };
    expect(evaluatePipeline(shaky.blueprint, marksAt(shaky.blueprint, 0.5), { gradeBoundaries: set }).stopReason).toMatch(/^OUTCOME_DECLARATION_NOT_AUTHORITATIVE/);
  });

  it('a partial subject (80%) cannot be graded even with boundaries', () => {
    const ib = ok(IB_MATH_AA_HL_V2, { outcome: declaration }).blueprint;
    const set: BoundarySet = { scaleKey: 'test-grade-scale', inputUnit: 'WEIGHTED_SCORE', provenance: TEST_AUTHORITY, boundaries: [{ label: 'G1', min: 0 }] };
    const ev = evaluatePipeline(ib, { p1: rawMarks(88, 110), p2: rawMarks(77, 110), p3: rawMarks(44, 55) }, { gradeBoundaries: set });
    expect(ev.stopReason).toMatch(/^INCOMPLETE_WEIGHT_COVERAGE: 80%/);
  });
});

// ---------------------------------------------------------------------------
describe('Cambridge', () => {
  it('IGCSE 0580 Extended: two papers at 50% each resolve the full weighting', () => {
    const r = ok(CAMBRIDGE_0580_EXTENDED_V2);
    expect(r.blueprint.components.map((c) => [c.key, (c.official.weightPercent as { value: number }).value])).toEqual([['p2', 50], ['p4', 50]]);
    expect(stage(r.blueprint, 'COMPONENT_WEIGHTING')?.dependency.status).toBe('RESOLVED');
    expect(codes(r)).not.toContain('WEIGHTS_PARTIAL_COVERAGE');
    expect(r.blueprint.framework.syllabusCode).toMatchObject({ status: 'STATED', value: '0580' });
  });

  it('AS/A routes: weights are unresolved until one official component set is chosen', () => {
    const general = ok(AICE_9709_AS);
    expect(stage(general.blueprint, 'COMPONENT_WEIGHTING')?.dependency.reason).toMatch(/^ROUTE_NOT_SELECTED/);
    expect(general.unresolvedFields).toContain('identity.route');
    // All AS components together exceed 100% -- valid only per route set, so no error at document level.
    expect(general.status).toBe('INCOMPLETE');
    const route = AICE_9709_AS.assessmentRoutes![0];
    const chosen = ok(AICE_9709_AS, { route: { routeKey: route.key, setIndex: 0 } });
    expect(chosen.blueprint.identity.componentScope).toBe('ROUTE_SET');
    expect(chosen.blueprint.components.map((c) => c.key)).toEqual(route.componentSets[0]);
    expect(stage(chosen.blueprint, 'COMPONENT_WEIGHTING')?.dependency.status).toBe('RESOLVED');
    expect(chosen.blueprint.components.reduce((n, c) => n + (c.official.weightPercent as { value: number }).value, 0)).toBe(100);
  });

  it('flags the V1 runtime unit label that does not match its percentage result', () => {
    expect(codes(compileBlueprint(AICE_9709_AS))).toContain('LEGACY_UNIT_MISMATCH');
  });

  it('a non-existent route or set is an error, not a fallback', () => {
    expect(compileBlueprint(AICE_9709_AS, { route: { routeKey: 'A_LEVEL_LINEAR', setIndex: 0 } }).status).toBe('INVALID');
    expect(codes(compileBlueprint(AICE_9709_AS, { route: { routeKey: 'AS_ONLY', setIndex: 99 } }))).toContain('ROUTE_SET_UNKNOWN');
  });
});

// ---------------------------------------------------------------------------
describe('PAA', () => {
  const r = ok(PAA_V2);
  const bp = r.blueprint;

  it('has no marks, weights or scale it does not state', () => {
    for (const c of bp.components) {
      expect(c.official.maxMarks.status).toBe('UNKNOWN');
      expect(c.official.weightPercent.status).toBe('UNKNOWN');
    }
    expect(stage(bp, 'COMPONENT_WEIGHTING')).toBeUndefined();
    expect(bp.scoring.pipeline.map((s) => s.output)).toEqual(['RAW_MARKS', 'COMPONENT_SCORE']);
    // The 200-800 scale appears only in the configuration's prose (purpose / limitations), never as a stage or scale key.
    expect(bp.scoring.pipeline.some((s) => s.output === 'SCALED_SCORE' || s.params.scaleKey)).toBe(false);
  });

  it('keeps the official item counts and the declared reduced form', () => {
    expect(bp.components.map((c) => [c.key, (c.official.itemCount as { value: number }).value, c.plannedPositions, c.lengthFidelity])).toEqual([
      ['lectura', 45, 10, 'REDUCED'],
      ['redaccion', 25, 6, 'REDUCED'],
      ['matematicas', 55, 12, 'REDUCED'],
      ['ingles', 50, 8, 'REDUCED'],
    ]);
  });

  it('an unstated calculator rule stays UNKNOWN; the StudyUs tool rule is delivery policy', () => {
    expect(comp(bp, 'lectura').official.calculatorPolicy.status).toBe('UNKNOWN');
    expect(comp(bp, 'matematicas').official.calculatorPolicy).toMatchObject({ status: 'STATED', value: 'NONE' });
    expect(comp(bp, 'lectura').delivery.toolRules).toEqual({ calculator: false });
  });

  it('keeps reporting groups (Inglés institution-defined)', () => {
    expect(bp.reportingGroups.map((g) => [g.key, g.componentKeys, g.institutionDefined])).toEqual([
      ['lectura-redaccion', ['lectura', 'redaccion'], false],
      ['matematicas', ['matematicas'], false],
      ['ingles', ['ingles'], true],
    ]);
  });

  it('a third-party scale declaration cannot resolve a scaled score', () => {
    const decl: OutcomeDeclaration = { provenance: provenance('THIRD_PARTY_REFERENCE', ['prep-site']), stages: [{ kind: 'SCALE_CONVERSION', scope: 'AREA', scaleKey: 'x', resolvedPer: 'SESSION' }] };
    const out = ok(PAA_V2, { outcome: decl });
    expect(stage(out.blueprint, 'SCALE_CONVERSION')?.dependency).toMatchObject({ status: 'UNRESOLVED', reason: 'OUTCOME_DECLARATION_NOT_AUTHORITATIVE' });
    expect(out.blueprint.scoring.resolution.stoppedAt).toBe('SCALE_CONVERSION');
  });
});

// ---------------------------------------------------------------------------
describe('ICFES Saber 11', () => {
  it('V2 Matemáticas: the unpublished duration is UNKNOWN; the StudyUs pace is policy', () => {
    const bp = ok(SABER11_MATH_V2).blueprint;
    const m = comp(bp, 'math');
    expect(m.official.durationMinutes.status).toBe('UNKNOWN');
    expect(m.delivery.durationMinutes?.value).toBe(18);
    expect(m.official.itemCount).toMatchObject({ status: 'STATED', value: 50 });
    expect(m.lengthFidelity).toBe('REDUCED');
    expect(m.distributions.map((d) => d.dimension)).toEqual(['Competencia', 'Contenido']);
    expect(bp.components.map((c) => c.key)).toEqual(['math']); // the other tests are not invented
  });

  it('V1 fixture: its invented 0-100 transform and equal weights stay out of the V2 pipeline', () => {
    const v1 = DEV_CERT_VERTICALS.find((c) => c.family === 'ICFES')!;
    const r = ok(v1);
    expect(codes(r)).toEqual(expect.arrayContaining(['LEGACY_TRANSFORM_NOT_OFFICIAL', 'LEGACY_SECTION_WEIGHTS_NOT_OFFICIAL', 'COMPONENT_DEFINITION_MISSING', 'FRAMEWORK_VERSIONING_MISSING']));
    expect(r.blueprint.scoring.pipeline.map((s) => s.kind)).toEqual(['ITEM_MARKS', 'COMPONENT_TOTAL']);
    expect(r.blueprint.scoring.runtimeV1).toMatchObject({ strategy: 'SECTION_WEIGHTED', transform: 'LINEAR', official: false });
    expect(r.blueprint.components.every((c) => c.official.weightPercent.status === 'UNKNOWN')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
const RAW_ONLY: ExamVerticalConfigInput = {
  key: 'test.raw-only',
  family: 'PAA',
  contentStatus: 'DEV_CERT_FIXTURE',
  organization: { name: 'Test organization' },
  programme: { name: 'Test programme', type: 'ADMISSION_EXAM' },
  definition: { name: 'RAW-only test assessment', purpose: 'unit test' },
  version: { label: 'T1', delivery: { navigation: 'LINEAR', breaks: [], itemFeedback: 'NEVER', resultReview: 'FULL', permittedResources: [] } },
  scoring: { name: 'raw', scoringType: 'BINARY', policy: { engine: 'exam-scoring-v1', strategy: 'RAW', transform: { type: 'NONE' }, provenance: { official: false, source: 'unit test fixture' } } },
  structureLabel: 'T1',
  structureOnly: true,
  sections: [{ key: 'only', name: 'Only section', componentType: 'SECTION', objectives: [{ code: 'test.obj', description: 'objective', targets: [{ questionType: 'multiple_choice', count: 3 }] }] }],
  items: [],
};

describe('simple RAW-only assessment', () => {
  const r = ok(RAW_ONLY);
  it('compiles to marks -> component score, every fact UNKNOWN, no defaults', () => {
    expect(r.blueprint.scoring.pipeline.map((s) => `${s.input}->${s.output}`)).toEqual(['ITEM_RESPONSE->RAW_MARKS', 'RAW_MARKS->COMPONENT_SCORE']);
    const c = comp(r.blueprint, 'only');
    for (const f of Object.values(c.official)) if (f && typeof f === 'object' && 'status' in f) expect(f.status).toBe('UNKNOWN');
    expect(c.cells).toEqual([expect.objectContaining({ positions: 3, marks: { source: 'ITEM_MARKSCHEME' } })]);
  });
  it('evaluates against delivered marks only', () => {
    const ev = evaluatePipeline(r.blueprint, { only: rawMarks(2, 3) });
    expect(ev.stoppedAt).toBeNull();
    expect(ev.outputs[1]).toEqual({ stage: 'COMPONENT_TOTAL', value: [expect.objectContaining({ earned: 2, max: 3, maxBasis: 'DELIVERED' })] });
  });
  it('a missing component input stops at ITEM_MARKS', () => {
    expect(evaluatePipeline(r.blueprint, {}).stopReason).toBe('NO_MARKS_FOR_COMPONENTS: only');
  });
});

// ---------------------------------------------------------------------------
describe('incomplete and invalid configurations', () => {
  const incomplete: ExamVerticalConfigInput = {
    ...RAW_ONLY,
    key: 'test.incomplete',
    framework: { frameworkKey: 'test', curriculumVersion: 'v', firstAssessment: 2025, lastAssessment: null, syllabusCode: null, frameworkVersion: '1', sourceKeys: ['not-a-registered-source'] },
    sections: [
      {
        ...RAW_ONLY.sections[0],
        // assessment omitted on purpose: the zod default (EXTERNAL) must not become a fact.
        definition: { officialName: 'Paper X', kind: 'WRITTEN_PAPER', officialDurationMinutes: null, maxMarks: null, weightingPercent: 40, calculatorPolicy: null, responseFormats: ['SHORT_RESPONSE'], sourceKeys: ['not-a-registered-source'] },
      },
    ],
  };
  const r = ok(incomplete);
  const c = comp(r.blueprint, 'only');

  it('reports every unstated value as UNKNOWN and lists it', () => {
    expect(c.official.assessment.status).toBe('UNKNOWN');
    expect(c.official.maxMarks.status).toBe('UNKNOWN');
    expect(c.official.durationMinutes.status).toBe('UNKNOWN');
    expect(r.unresolvedFields).toEqual(expect.arrayContaining(['components.only.official.assessment', 'components.only.official.maxMarks', 'components.only.official.durationMinutes', 'framework.lastAssessment', 'framework.syllabusCode']));
  });

  it('an unregistered source gives no authority: the 40% weight is shown but cannot resolve weighting', () => {
    expect(codes(r)).toEqual(expect.arrayContaining(['UNREGISTERED_SOURCE', 'NO_AUTHORITATIVE_SOURCE']));
    expect(c.official.weightPercent).toEqual({ status: 'STATED', value: 40, provenance: UNKNOWN_PROVENANCE });
    expect(stage(r.blueprint, 'COMPONENT_WEIGHTING')?.dependency).toMatchObject({ status: 'UNRESOLVED', reason: 'WEIGHT_NOT_AUTHORITATIVE: only' });
  });

  it('a weighted component without official max marks is reported', () => {
    const sourced = ok({ ...incomplete, sections: [{ ...incomplete.sections[0], definition: { ...incomplete.sections[0].definition!, sourceKeys: ['ibo-math-aa-guide-2021'] } }] });
    expect(codes(sourced)).toContain('MISSING_MAX_MARKS');
    expect(stage(sourced.blueprint, 'COMPONENT_WEIGHTING')?.dependency.reason).toMatch(/^MAX_MARKS_REQUIRED_FOR_WEIGHTING/);
  });

  it('a configuration Exam Core rejects is INVALID with no blueprint', () => {
    const bad = compileBlueprint({ ...RAW_ONLY, sections: [] });
    expect(bad).toMatchObject({ blueprint: null, status: 'INVALID' });
    expect(codes(bad)).toContain('CONFIG_INVALID');
  });
});

// ---------------------------------------------------------------------------
describe('several Blueprint candidates from one configuration / version', () => {
  it('GENERAL, COMPONENT_PRACTICE and route sets are distinct candidates', () => {
    const general = ok(IB_MATH_AA_HL_V2).blueprint;
    const p1 = ok(IB_MATH_AA_HL_V2, { blueprintKind: 'COMPONENT_PRACTICE', componentKeys: ['p1'] }).blueprint;
    expect(p1.identity).toMatchObject({ blueprintKind: 'COMPONENT_PRACTICE', componentScope: 'SUBSET' });
    expect(p1.components.map((c) => c.key)).toEqual(['p1']);
    expect(p1.identity.blueprintVersion).toBe(general.identity.blueprintVersion);
    expect(p1.fingerprint).not.toBe(general.fingerprint);
    const sets = AICE_9709_AS.assessmentRoutes![0].componentSets.map((_, i) => ok(AICE_9709_AS, { route: { routeKey: 'AS_ONLY', setIndex: i } }).blueprint.fingerprint);
    expect(new Set(sets).size).toBe(sets.length);
  });

  it('a FULL_MOCK is refused when the configuration is a reduced form', () => {
    const r = compileBlueprint(PAA_V2, { blueprintKind: 'FULL_MOCK' });
    expect(r.status).toBe('INVALID');
    expect(codes(r)).toContain('FULL_MOCK_NOT_OFFICIAL_LENGTH');
  });

  it('a new version label is a new blueprint version', () => {
    const a = ok(SABER11_MATH_V2).blueprint;
    const b = ok({ ...SABER11_MATH_V2, version: { ...SABER11_MATH_V2.version, label: 'V2 Saber 11 2027' } }).blueprint;
    expect(b.identity.blueprintVersion).not.toBe(a.identity.blueprintVersion);
    expect(b.identity.sourceConfigFingerprint).not.toBe(a.identity.sourceConfigFingerprint);
  });

  it('unknown component selections are errors', () => {
    expect(codes(compileBlueprint(IB_MATH_AA_HL_V2, { componentKeys: ['p9'] }))).toEqual(expect.arrayContaining(['UNKNOWN_COMPONENT_SELECTION', 'EMPTY_COMPONENT_SELECTION']));
  });
});

// ---------------------------------------------------------------------------
describe('determinism', () => {
  it('same input -> identical document and fingerprint; key order does not matter', () => {
    const a = ok(IB_MATH_AA_HL_V2);
    const b = ok(structuredClone(IB_MATH_AA_HL_V2));
    expect(b).toEqual(a);
    const reordered = Object.fromEntries(Object.entries(IB_MATH_AA_HL_V2).reverse());
    expect(ok(reordered).blueprint.fingerprint).toBe(a.blueprint.fingerprint);
  });
  it('the validator detects a tampered document', () => {
    const bp = ok(PAA_V2).blueprint;
    const tampered = structuredClone(bp);
    tampered.components[0].plannedPositions = 45;
    tampered.components[0].cells[0].positions += 35;
    expect(codes(validateBlueprint(tampered))).toContain('FINGERPRINT_MISMATCH');
  });
});

// ---------------------------------------------------------------------------
describe('validator', () => {
  const ib = ok(IB_MATH_AA_HL_V2).blueprint;
  const v = (bp: BlueprintV2) => codes(validateBlueprint(bp));

  it('accepts every compiled blueprint', () => {
    for (const cfg of [...allV2Configs(), ...DEV_CERT_VERTICALS]) {
      const r = compileBlueprint(cfg);
      expect(validateBlueprint(r.blueprint).ok, (cfg as { key: string }).key).toBe(true);
    }
  });
  it('duplicate component identifiers', () => {
    expect(v(edit(ib, (d) => d.components.push({ ...d.components[0] })))).toEqual(expect.arrayContaining(['DUPLICATE_COMPONENT', 'DUPLICATE_CELL']));
  });
  it('invalid weights: out of range and sum over 100%', () => {
    const w = (n: number) => ({ status: 'STATED' as const, value: n, provenance: provenance('OFFICIAL_PUBLIC', ['ibo-math-aa-guide-2021']) });
    expect(v(edit(ib, (d) => { d.components[0].official.weightPercent = w(150); }))).toContain('INVALID_WEIGHT');
    expect(v(edit(ib, (d) => { d.components[0].official.weightPercent = w(60); }))).toContain('WEIGHTS_EXCEED_100');
  });
  it('missing max marks where a resolved weighting needs them', () => {
    expect(v(edit(ib, (d) => { d.components[2].official.maxMarks = { status: 'UNKNOWN', reason: 'removed' }; }))).toContain('MISSING_MAX_MARKS');
  });
  it('invalid stages, impossible transitions and wrong order', () => {
    const grade = { kind: 'GRADE_BOUNDARIES' as const, input: 'WEIGHTED_SCORE' as const, output: 'GRADE' as const, dependency: { kind: 'GRADE_BOUNDARIES' as const, resolvedPer: 'SESSION' as const, status: 'UNRESOLVED' as const, provenance: UNKNOWN_PROVENANCE, reason: 'x' }, params: {} };
    const withGradeFirst = edit(ib, (d) => { d.scoring.pipeline.splice(1, 0, grade); });
    expect(v(withGradeFirst)).toEqual(expect.arrayContaining(['INVALID_STAGE_ORDER', 'IMPOSSIBLE_STAGE_TRANSITION']));
    expect(v(edit(ib, (d) => { d.scoring.pipeline[1].output = 'GRADE'; }))).toContain('INVALID_STAGE_UNITS');
    expect(v(edit(ib, (d) => { d.scoring.pipeline.shift(); }))).toContain('PIPELINE_MUST_START_WITH_ITEM_MARKS');
    expect(v(edit(ib, (d) => { d.scoring.pipeline.push({ ...d.scoring.pipeline[2] }); }))).toContain('DUPLICATE_STAGE');
  });
  it('unsupported units', () => {
    const bad = structuredClone(ib) as unknown as { scoring: { pipeline: Array<{ output: string }> } };
    bad.scoring.pipeline[0].output = 'POINTS';
    expect(v(bad as unknown as BlueprintV2)).toContain('UNSUPPORTED_UNIT');
  });
  it('a stage resolved without authority', () => {
    expect(v(edit(ib, (d) => {
      d.scoring.pipeline[2].dependency.provenance = provenance('THIRD_PARTY_REFERENCE', ['x']);
    }))).toContain('STAGE_RESOLVED_WITHOUT_AUTHORITY');
  });
  it('unresolved references', () => {
    expect(v(edit(ok(PAA_V2).blueprint, (d) => { d.reportingGroups[0].componentKeys.push('zz'); }))).toContain('UNRESOLVED_REFERENCE');
    expect(v(edit(ok(AICE_9709_AS).blueprint, (d) => { d.routes[0].componentSets[0].push('p99'); }))).toContain('UNRESOLVED_REFERENCE');
  });
  it('authoritative values without provenance', () => {
    expect(v(edit(ib, (d) => { d.components[0].official.maxMarks = { status: 'STATED', value: 110, provenance: { kind: 'OFFICIAL_PUBLIC', authority: 'AWARDING_BODY', sourceKeys: [] } }; }))).toContain('MISSING_PROVENANCE');
  });
  it('a resolution that does not follow from the pipeline', () => {
    expect(v(edit(ib, (d) => { d.scoring.resolution.stoppedAt = 'COMPONENT_TOTAL'; }))).toContain('RESOLUTION_MISMATCH');
  });
  it('does not require legitimately optional fields (no weights, no marks, no session, no routes)', () => {
    const paa = validateBlueprint(ok(PAA_V2).blueprint);
    expect(paa.ok).toBe(true);
    expect(paa.issues.filter((i) => i.severity === 'ERROR')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe('no invented defaults (all 88 existing configurations)', () => {
  const all = [...allV2Configs(), ...DEV_CERT_VERTICALS];
  const compiled = all.map((cfg) => ({ cfg, r: compileBlueprint(cfg) }));

  it('every configuration compiles; none is COMPLETE, because none declares what it reports', () => {
    expect(compiled.every(({ r }) => r.blueprint !== null && r.status === 'INCOMPLETE')).toBe(true);
  });
  it('marks per position always come from the item mark scheme -- never "MCQ = 2" or a default 1', () => {
    for (const { r } of compiled) for (const c of r.blueprint!.components) for (const cell of c.cells) expect(cell.marks).toEqual({ source: 'ITEM_MARKSCHEME' });
    for (const { r } of compiled) expect(JSON.stringify(r.blueprint)).not.toContain('defaultItemMarks');
  });
  it('a value missing from the configuration is UNKNOWN in the blueprint', () => {
    for (const { cfg, r } of compiled) {
      for (const s of cfg.sections) {
        const c = comp(r.blueprint!, s.key);
        if (s.definition?.maxMarks == null) expect(c.official.maxMarks.status).toBe('UNKNOWN');
        if (s.definition?.weightingPercent == null) expect(c.official.weightPercent.status).toBe('UNKNOWN');
        if (s.definition?.officialDurationMinutes == null) expect(c.official.durationMinutes.status).toBe('UNKNOWN');
        if (s.definition?.assessment === undefined) expect(c.official.assessment.status).toBe('UNKNOWN');
      }
    }
  });
  it('no grade, scale or points stage and no resolved session without a declaration', () => {
    for (const { r } of compiled) {
      expect(r.blueprint!.scoring.pipeline.every((s) => ['ITEM_MARKS', 'COMPONENT_TOTAL', 'COMPONENT_WEIGHTING'].includes(s.kind))).toBe(true);
      expect(r.blueprint!.session.status).toBe('UNKNOWN');
    }
  });
  it('nothing is family-specific: the same rules hold for every family present', () => {
    expect(new Set(compiled.map(({ r }) => r.blueprint!.identity.examFamily))).toEqual(new Set(['IB', 'PISA', 'ICFES', 'PAA', 'CAMBRIDGE', 'AICE']));
  });
});

// ---------------------------------------------------------------------------
describe('typed units', () => {
  it('validates raw marks', () => {
    expect(() => rawMarks(5, 4)).toThrow(ScoreUnitError);
    expect(() => rawMarks(-1, 4)).toThrow(ScoreUnitError);
    expect(sumRawMarks([rawMarks(1, 2), rawMarks(3, 4)])).toMatchObject({ unit: 'RAW_MARKS', earned: 4, available: 6 });
  });
  it('the official maximum basis requires the whole component', () => {
    expect(componentScore('p1', rawMarks(80, 110), 110).maxBasis).toBe('OFFICIAL_MAX');
    expect(componentScore('p1', rawMarks(18, 25), 110)).toMatchObject({ maxBasis: 'DELIVERED', max: 25 });
    expect(() => componentScore('p1', rawMarks(1, 120), 110)).toThrow(ScoreUnitError);
  });
  it('weighting never renormalizes and refuses reduced forms or double weighting', () => {
    const p1 = componentScore('p1', rawMarks(55, 110), 110);
    const w = weightedScore([{ score: p1, weight: authoritativeWeight('p1', 30) }]);
    expect(w).toMatchObject({ unit: 'WEIGHTED_SCORE', value: 15, coveredWeightPercent: 30 });
    expect(() => weightedScore([{ score: componentScore('p1', rawMarks(5, 10), 110), weight: authoritativeWeight('p1', 30) }])).toThrow(/cannot be weighted/);
    expect(() => weightedScore([{ score: p1, weight: authoritativeWeight('p2', 30) }])).toThrow(ScoreUnitError);
    expect(() => weightedScore([{ score: p1, weight: authoritativeWeight('p1', 60) }, { score: p1, weight: authoritativeWeight('p1', 60) }])).toThrow(ScoreUnitError);
  });
  it('units cannot be confused at compile time', () => {
    const raw = rawMarks(1, 2);
    // @ts-expect-error -- RawMarks is not a WeightedScore
    const notWeighted: WeightedScore = raw;
    // @ts-expect-error -- an object literal of the right shape is not a RawMarks (branded)
    const literal: RawMarks = { unit: 'RAW_MARKS', earned: 1, available: 2 };
    // Type-level only (never executed): a component score cannot be weighted with a bare number.
    const misuse = () =>
      // @ts-expect-error -- a weight must be an AuthoritativeWeight, not a number
      weightedScore([{ score: componentScore('p1', raw, null), weight: 30 }]);
    expect([notWeighted, literal, misuse]).toHaveLength(3);
  });
  it('grades need strictly increasing boundaries', () => {
    expect(gradeFor(50, [{ label: 'a', min: 0 }, { label: 'b', min: 50 }])).toBe('b');
    expect(gradeFor(50, [{ label: 'a', min: 0 }, { label: 'b', min: 0 }])).toBeNull();
    expect(gradeFor(-1, [{ label: 'a', min: 0 }])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe('provenance (K-05)', () => {
  it('maps registry entries conservatively', () => {
    const base = { key: 'k', framework: 'X', title: 't', publisher: 'p', url: null, publicationYear: null };
    expect(provenanceKindOfSource({ ...base, confidence: 'HIGH', license: 'PUBLIC' })).toBe('OFFICIAL_PUBLIC');
    expect(provenanceKindOfSource({ ...base, confidence: 'HIGH', license: 'LICENSED' })).toBe('OFFICIAL_LICENSED');
    expect(provenanceKindOfSource({ ...base, confidence: 'LOW', license: 'PUBLIC' })).toBe('THIRD_PARTY_REFERENCE');
    expect(provenanceKindOfSource({ ...base, confidence: 'HIGH', license: 'GENERATED' })).toBe('UNKNOWN');
  });
  it('third-party references and unknowns are never authoritative', () => {
    expect(isAuthoritative(provenance('THIRD_PARTY_REFERENCE', ['x']))).toBe(false);
    expect(isAuthoritative(UNKNOWN_PROVENANCE)).toBe(false);
    expect(isAuthoritative(provenance('OFFICIAL_PUBLIC', []))).toBe(false);
    expect(isAuthoritative(provenance('VERIFIED_HISTORICAL', ['x']))).toBe(true);
  });
  it('a derived value takes the weakest provenance', () => {
    expect(combineProvenance([provenance('OFFICIAL_LICENSED', ['a']), provenance('INSTITUTION_SUPPLIED', ['b'])])).toEqual(provenance('INSTITUTION_SUPPLIED', ['a', 'b']));
    expect(combineProvenance([provenance('OFFICIAL_PUBLIC', ['a']), UNKNOWN_PROVENANCE])).toEqual(UNKNOWN_PROVENANCE);
  });
  it('pipeline structure check on an empty pipeline', () => {
    expect(checkPipelineStructure([])[0].code).toBe('PIPELINE_EMPTY');
  });
});
