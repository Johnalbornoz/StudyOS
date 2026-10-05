/**
 * Blueprint Engine V2 / BP-1 -- Exam Definition + Exam Session + Outcome
 * Specification. T1-T10 from the BP-1 brief plus the validator matrix.
 *
 * Outcome declarations and sessions here use an explicit TEST authority
 * (INSTITUTION_SUPPLIED / test-fixture-institution): they exercise the model
 * and never claim an official fact. No dates, boundaries or scales are
 * invented: session dates stay UNKNOWN and no boundary data is loaded, only
 * opaque references in the cases that test a LOADED rule.
 */
import { describe, it, expect } from 'vitest';
import {
  compileExam,
  compileBlueprint,
  checkSession,
  validateExamDefinition,
  validateBlueprint,
  blueprintFingerprint,
  definitionFingerprint,
  outcomeToDeclaration,
  provenance,
  UNKNOWN_PROVENANCE,
  type ExamSessionInput,
  type OutcomeSpecificationInput,
  type ExamDefinitionV2,
  type BlueprintV2,
} from '@/lib/exam-core/blueprint-v2';
import { structureConfig, subjectByKey } from '@/lib/exam-core/catalog/ib-dp';
import { IB_MATH_AA_HL_V2, IB_VISUAL_ARTS_HL_V2, PAA_V2, SABER11_MATH_V2, AICE_9709_AS } from '@/lib/exam-core/verticals/v2';

const TEST = provenance('INSTITUTION_SUPPLIED', ['test-fixture-institution']);
const THIRD = provenance('THIRD_PARTY_REFERENCE', ['prep-website']);
const codes = (r: { issues: Array<{ code: string }> }) => r.issues.map((i) => i.code);
const UNKNOWN_DATE = { status: 'UNKNOWN' as const, reason: 'no authoritative date loaded' };

/** IB DP Mathematics: analysis and approaches HL, full sourced structure (P1, P2, P3, IA). */
const IB_AA_HL = structureConfig(subjectByKey('math-aa')!, 'HL')!;
const IB_SPEC = 'ib-dp-math-aa@2021';

function session(over: Partial<ExamSessionInput> & { sessionKey: string; year: number; label?: string | null; status?: ExamSessionInput['status'] }, defKey = IB_AA_HL.key, spec = IB_SPEC): ExamSessionInput {
  const { year, label, status, ...rest } = over;
  return {
    examDefinitionKey: defKey,
    specificationKey: spec,
    administration: { type: 'NAMED_SERIES', label: label === undefined ? over.sessionKey : label, year: { status: 'STATED', value: year, provenance: TEST }, startDate: UNKNOWN_DATE, endDate: UNKNOWN_DATE, region: { status: 'UNKNOWN', reason: 'no regional variant stated' } },
    status: status ?? 'PLANNED',
    provenance: TEST,
    rules: [{ rule: 'GRADE_BOUNDARIES', status: 'NOT_LOADED', provenance: UNKNOWN_PROVENANCE, ref: null }],
    ...rest,
  };
}
const loaded = (s: ExamSessionInput, rule: 'GRADE_BOUNDARIES' | 'SCALING_TABLE', p = TEST): ExamSessionInput => ({ ...s, rules: [{ rule, status: 'LOADED', provenance: p, ref: `test-${rule.toLowerCase()}-${s.sessionKey}` }] });
const subjectGrade = (p = TEST): OutcomeSpecificationInput => ({ provenance: p, outcomes: [{ layer: 'SUBJECT', kind: 'GRADE', scaleKey: 'test.subject-grade-scale', resolvedPer: 'SESSION', final: true }] });

// ---------------------------------------------------------------------------
describe('T1 -- IB multi-component + session dependency + grade unresolved', () => {
  const r = compileExam(IB_AA_HL, { outcome: subjectGrade(), sessions: [session({ sessionKey: 'may-2027', year: 2027, label: 'May 2027' })], asOf: '2026-10-05' });
  const d = r.examDefinition!;

  it('separates identity, specification and session', () => {
    expect(d.identity).toMatchObject({ definitionKey: 'v2.ib.s.math-aa-hl', family: 'IB', subjectOrDomain: { kind: 'SUBJECT', name: 'Mathematics: analysis and approaches' }, level: 'HL' });
    expect(d.specification.key).toMatchObject({ status: 'STATED', value: IB_SPEC });
    expect(d.specification.firstAssessment).toMatchObject({ value: 2021 });
    expect(d.specification.lastAssessment).toMatchObject({ value: 2028 });
    expect(d.specification.configurationLabel).not.toBe(IB_SPEC);
    expect(r.sessions.map((s) => s.sessionKey)).toEqual(['may-2027']);
    expect(d.sessionPolicy.sessionsKnown).toEqual(['may-2027']);
  });

  it('P1/P2/P3 are timed and mockable; the IA contributes but is not mockable', () => {
    expect(d.components.map((c) => [c.key, c.componentClass, c.contributesToOutcome, c.mockable, c.predictionInput.source])).toEqual([
      ['p1', 'TIMED_TEST', 'YES', 'YES', 'ATTEMPT'],
      ['p2', 'TIMED_TEST', 'YES', 'YES', 'ATTEMPT'],
      ['p3', 'TIMED_TEST', 'YES', 'YES', 'ATTEMPT'],
      ['ia', 'COURSEWORK', 'YES', 'NO', 'TEACHER_ESTIMATE'],
    ]);
    expect(d.components.map((c) => (c.official.weightPercent as { value: number }).value)).toEqual([30, 30, 20, 20]);
    expect(d.assessmentModel).toMatchObject({ structure: 'MULTI_COMPONENT', componentCoverage: { status: 'YES', weightPercent: 100 } });
  });

  it('declares the grade as session-dependent and leaves it unresolved', () => {
    expect(d.outcome.finalOutcome).toMatchObject({ status: 'DECLARED', layer: 'SUBJECT', kind: 'GRADE' });
    expect(d.sessionPolicy.dependencies.find((x) => x.rule === 'GRADE_BOUNDARIES')).toMatchObject({ dependence: 'SESSION_DEPENDENT', basis: 'DECLARED', requiredFor: 'GRADE_BOUNDARIES', loadedInSessions: [] });
    expect(r.completeness).toMatchObject({ level: 'WEIGHTED_AVAILABLE', state: 'PARTIALLY_RESOLVED', finalOutcome: 'GRADE', requiresSession: true, blockedBy: { stage: 'GRADE_BOUNDARIES' } });
    expect(d.capabilities.supportsPrediction.value).toBe('YES');
    expect(d.capabilities.supportsSessionBasedScoring.value).toBe('YES');
    expect(r.status).toBe('INCOMPLETE');
  });

  it('for a session without boundaries the grade stays UNKNOWN; with authoritative boundaries it becomes available', () => {
    const notLoaded = compileExam(IB_AA_HL, { outcome: subjectGrade(), sessions: [session({ sessionKey: 'may-2027', year: 2027 })], forSessionKey: 'may-2027' });
    expect(notLoaded.completeness).toMatchObject({ sessionKey: 'may-2027', level: 'WEIGHTED_AVAILABLE', blockedBy: { reason: 'GRADE_BOUNDARIES_NOT_LOADED_FOR_SESSION: may-2027' } });
    const withBoundaries = compileExam(IB_AA_HL, { outcome: subjectGrade(), sessions: [loaded(session({ sessionKey: 'may-2027', year: 2027 }), 'GRADE_BOUNDARIES')], forSessionKey: 'may-2027' });
    expect(withBoundaries.completeness).toMatchObject({ level: 'GRADE_AVAILABLE', state: 'FULLY_RESOLVED', blockedBy: null });
    expect(withBoundaries.examDefinition!.sessionPolicy.dependencies.find((x) => x.rule === 'GRADE_BOUNDARIES')!.loadedInSessions).toEqual(['may-2027']);
  });

  it('the hand-written V2 config (no IA) states only 80% of the subject -- never completed', () => {
    const partial = compileExam(IB_MATH_AA_HL_V2).examDefinition!;
    expect(partial.assessmentModel.componentCoverage).toMatchObject({ status: 'NO', weightPercent: 80 });
    expect(partial.components.map((c) => c.key)).toEqual(['p1', 'p2', 'p3']);
  });
});

// ---------------------------------------------------------------------------
describe('T2 -- Cambridge: route + session + grade threshold dependency', () => {
  const spec = 'cie-aice-9709@2026-2027';
  const june = session({ sessionKey: 'june-2027', year: 2027, label: 'June 2027' }, AICE_9709_AS.key, spec);
  const march = { ...session({ sessionKey: 'march-2027', year: 2027, label: 'March 2027' }, AICE_9709_AS.key, spec), administration: { ...session({ sessionKey: 'march-2027', year: 2027, label: 'March 2027' }, AICE_9709_AS.key, spec).administration, region: { status: 'STATED' as const, value: 'test-region', provenance: TEST } } };

  it('represents syllabus code, qualification, routes, sessions (incl. a regional series) and the threshold dependency', () => {
    const r = compileExam(AICE_9709_AS, { outcome: subjectGrade(), sessions: [june, march] });
    const d = r.examDefinition!;
    expect(d.specification.syllabusCode).toMatchObject({ value: '9709' });
    expect(d.identity.qualification).toBe('Cambridge International AS Level');
    expect(d.assessmentModel).toMatchObject({ structure: 'ROUTED', routeKeys: ['AS_ONLY'], componentCoverage: { status: 'UNKNOWN' } });
    expect(r.sessions.map((s) => [s.sessionKey, s.administration.region.status])).toEqual([['june-2027', 'UNKNOWN'], ['march-2027', 'STATED']]);
    expect(d.sessionPolicy.dependencies.map((x) => [x.rule, x.dependence])).toEqual(expect.arrayContaining([['GRADE_BOUNDARIES', 'SESSION_DEPENDENT'], ['ROUTE_AVAILABILITY', 'POSSIBLY_SESSION_DEPENDENT'], ['PERMITTED_COMPONENT_COMBINATIONS', 'POSSIBLY_SESSION_DEPENDENT'], ['TIMETABLE', 'SESSION_DEPENDENT']]));
  });

  it('without a route the aggregate stays unresolved (weights are not shared out)', () => {
    const r = compileExam(AICE_9709_AS, { outcome: subjectGrade(), sessions: [june] });
    expect(r.completeness).toMatchObject({ level: 'RAW_ONLY', state: 'PARTIALLY_RESOLVED', blockedBy: { stage: 'COMPONENT_WEIGHTING' } });
    expect(r.completeness!.blockedBy!.reason).toMatch(/^ROUTE_NOT_SELECTED/);
  });

  it('with a route, the candidate reaches weighting and stops at the session thresholds', () => {
    const r = compileExam(AICE_9709_AS, { outcome: subjectGrade(), sessions: [june], blueprint: { route: { routeKey: 'AS_ONLY', setIndex: 1 } }, forSessionKey: 'june-2027' });
    expect(r.blueprint!.identity.route).toEqual({ routeKey: 'AS_ONLY', componentSet: ['p1', 'p4'] });
    expect(r.completeness).toMatchObject({ level: 'WEIGHTED_AVAILABLE', blockedBy: { stage: 'GRADE_BOUNDARIES', reason: 'GRADE_BOUNDARIES_NOT_LOADED_FOR_SESSION: june-2027' } });
    // The exam as a whole (no route) is still unresolved at weighting.
    expect(r.examDefinition!.completeness.blockedBy!.stage).toBe('COMPONENT_WEIGHTING');
  });

  it('qualification points need a subject grade and an aggregation stage', () => {
    const r = compileExam(AICE_9709_AS, { outcome: { provenance: TEST, outcomes: [{ layer: 'SUBJECT', kind: 'GRADE', resolvedPer: 'SESSION' }, { layer: 'QUALIFICATION', kind: 'QUALIFICATION_POINTS', scaleKey: 'test.qualification-rule', final: true }] } });
    expect(r.blueprint!.scoring.pipeline.map((s) => s.kind)).toContain('QUALIFICATION_AGGREGATION');
    expect(r.examDefinition!.capabilities.supportsQualificationAggregation.value).toBe('YES');
    expect(r.examDefinition!.outcome.finalOutcome).toMatchObject({ layer: 'QUALIFICATION', kind: 'QUALIFICATION_POINTS' });
    const noGrade = outcomeToDeclaration({ provenance: TEST, outcomes: [{ layer: 'QUALIFICATION', kind: 'QUALIFICATION_POINTS' }] }, ['p1']);
    expect(noGrade.issues.map((i) => i.code)).toContain('IMPOSSIBLE_OUTCOME_TRANSITION');
  });
});

// ---------------------------------------------------------------------------
describe('T3 -- PAA: non-grade outcome, incomplete distribution', () => {
  const areas = [
    { key: 'lectura-redaccion', label: 'Lectura y Redacción', componentKeys: ['lectura', 'redaccion'] },
    { key: 'matematicas', label: 'Matemáticas', componentKeys: ['matematicas'] },
  ];

  it('is a domain-set test with no subject grade semantics', () => {
    const d = compileExam(PAA_V2).examDefinition!;
    expect(d.identity.subjectOrDomain).toEqual({ kind: 'DOMAIN_SET', name: null, domains: ['Lectura', 'Redacción', 'Matemáticas', 'Inglés'] });
    expect(d.identity.level).toBeNull();
    expect(d.outcome.finalOutcome).toEqual({ status: 'UNKNOWN', reason: 'No authoritative source currently loaded' });
    expect(d.outcome.structural.map((o) => o.kind)).toEqual(['RAW_MARKS', 'COMPONENT_SCORE']);
    expect(d.capabilities.supportsCoursework.value).toBe('NO');
    expect(d.assessmentModel.componentCoverage.status).toBe('UNKNOWN');
  });

  it('unpublished distribution values stay unspecified ("—"), never filled', () => {
    const bp = compileExam(PAA_V2).blueprint!;
    const lectura = bp.components.find((c) => c.key === 'lectura')!;
    expect(Object.values(lectura.distributions[0].values).every((v) => v === '—')).toBe(true);
  });

  it('an uncertified area scale stays UNKNOWN; an authoritative one stops at the session scaling table', () => {
    const uncertified = compileExam(PAA_V2, { outcome: { provenance: THIRD, outcomes: [{ layer: 'SUBJECT', kind: 'SCALED_SCORE', areas, resolvedPer: 'SESSION', final: true }] } });
    expect(uncertified.outcomeSpecification!.reported[0]).toMatchObject({ status: 'UNKNOWN', reason: 'no authoritative source: provenance THIRD_PARTY_REFERENCE' });
    expect(uncertified.completeness!.state).toBe('FINAL_OUTCOME_UNKNOWN');
    const declared = compileExam(PAA_V2, { outcome: { provenance: TEST, outcomes: [{ layer: 'SUBJECT', kind: 'SCALED_SCORE', areas, scaleKey: 'test.area-scale', resolvedPer: 'SESSION', final: true }] } });
    expect(declared.blueprint!.scoring.pipeline.map((s) => s.kind)).toEqual(['ITEM_MARKS', 'COMPONENT_TOTAL', 'AREA_GROUPING', 'SCALE_CONVERSION']);
    expect(declared.completeness).toMatchObject({ level: 'RAW_ONLY', state: 'PARTIALLY_RESOLVED', blockedBy: { stage: 'SCALE_CONVERSION' } });
    expect(declared.blueprint!.scoring.pipeline.some((s) => s.kind === 'GRADE_BOUNDARIES')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('T4 -- ICFES: scaled and composite result capability, historical administrations', () => {
  const spec = 'icfes-saber11-math@2026';
  const outcome: OutcomeSpecificationInput = { provenance: TEST, outcomes: [{ layer: 'SUBJECT', kind: 'SCALED_SCORE', scaleKey: 'test.test-scale', resolvedPer: 'SESSION' }, { layer: 'SUBJECT', kind: 'COMPOSITE_SCORE', scaleKey: 'test.global', final: true }] };
  const sessions = [
    session({ sessionKey: 'calendario-a-2025', year: 2025, label: 'Calendario A 2025', status: 'HISTORICAL' }, SABER11_MATH_V2.key, spec),
    session({ sessionKey: 'calendario-a-2026', year: 2026, label: 'Calendario A 2026', status: 'PLANNED' }, SABER11_MATH_V2.key, spec),
  ];

  it('represents test -> scaled score -> composite, unresolved without the session scaling', () => {
    const r = compileExam(SABER11_MATH_V2, { outcome, sessions, asOf: '2026-01-15' });
    expect(r.status).not.toBe('INVALID');
    expect(r.blueprint!.scoring.pipeline.map((s) => `${s.kind}:${s.output}`)).toEqual(['ITEM_MARKS:RAW_MARKS', 'COMPONENT_TOTAL:COMPONENT_SCORE', 'SCALE_CONVERSION:SCALED_SCORE', 'GLOBAL_COMBINATION:SCALED_SCORE']);
    expect(r.examDefinition!.outcome.finalOutcome).toMatchObject({ kind: 'COMPOSITE_SCORE' });
    expect(r.completeness).toMatchObject({ level: 'RAW_ONLY', state: 'PARTIALLY_RESOLVED', blockedBy: { stage: 'SCALE_CONVERSION' } });
    expect(r.sessions.map((s) => s.status)).toEqual(['HISTORICAL', 'PLANNED']);
  });

  it('even with a loaded scaling table the composite formula (not loaded) stops the pipeline', () => {
    const r = compileExam(SABER11_MATH_V2, { outcome, sessions: [loaded(sessions[1], 'SCALING_TABLE')], forSessionKey: 'calendario-a-2026' });
    expect(r.completeness).toMatchObject({ level: 'SCALED_AVAILABLE', resolvableThrough: 'SCALE_CONVERSION', blockedBy: { stage: 'GLOBAL_COMBINATION', reason: 'GLOBAL_FORMULA_NOT_AVAILABLE' } });
  });

  it('a composite without the scaled results it combines is impossible', () => {
    const r = compileExam(SABER11_MATH_V2, { outcome: { provenance: TEST, outcomes: [{ layer: 'SUBJECT', kind: 'COMPOSITE_SCORE', final: true }] } });
    expect(codes(r)).toContain('IMPOSSIBLE_OUTCOME_TRANSITION');
    expect(r.status).toBe('INVALID');
  });

  it('the unpublished duration keeps mockability UNKNOWN (no assumed timing)', () => {
    expect(compileExam(SABER11_MATH_V2).examDefinition!.components[0].mockable).toBe('UNKNOWN');
  });
});

// ---------------------------------------------------------------------------
describe('T5 -- AICE: a V1 "marks" label on a percentage never becomes RawMarks', () => {
  const r = compileExam(AICE_9709_AS);
  it('documents the conflict and keeps the value out of every V2 unit', () => {
    expect(r.examDefinition!.legacyRuntime).toEqual({ finalScore: { declaredUnit: 'marks', meaning: 'PERCENT_OF_DELIVERED_MARKS', v2Unit: null, status: 'UNIT_LABEL_CONFLICT' }, rawScore: { v2Unit: 'RAW_MARKS' } });
    expect(codes(r)).toEqual(expect.arrayContaining(['LEGACY_UNIT_MISMATCH', 'LEGACY_FINAL_SCORE_NOT_RAW_MARKS']));
    expect(r.unresolvedFields).toContain('legacyRuntime.finalScore.unit');
    // provenance of the V1 policy is kept as it is (not official), not rewritten
    expect(r.blueprint!.scoring.runtimeV1).toMatchObject({ unit: 'marks', official: false });
  });
  it('a consistent "%" label is not flagged', () => {
    const ib = compileExam(IB_MATH_AA_HL_V2);
    expect(ib.examDefinition!.legacyRuntime.finalScore.status).toBe('CONSISTENT');
    expect(ib.unresolvedFields).not.toContain('legacyRuntime.finalScore.unit');
  });
});

// ---------------------------------------------------------------------------
describe('T6 -- coursework contributes to the outcome but is not mockable', () => {
  it('IB Visual Arts: every component is coursework; StudyUs practice configured is a separate fact', () => {
    const d = compileExam(IB_VISUAL_ARTS_HL_V2).examDefinition!;
    for (const c of d.components) {
      expect(c).toMatchObject({ componentClass: 'COURSEWORK', contributesToOutcome: 'YES', mockable: 'NO', predictionInput: { capability: 'YES', source: 'TEACHER_ESTIMATE' }, studyusPracticeConfigured: true });
    }
    expect(d.capabilities.supportsMock.value).toBe('NO');
    expect(d.capabilities.supportsCoursework.value).toBe('YES');
    expect(d.capabilities.supportsPractice.value).toBe('YES');
  });
  it('capability never implies content: supportsMock YES on a structure-only exam with no bank', () => {
    const d = compileExam(IB_AA_HL).examDefinition!;
    expect(d.capabilities.supportsMock.value).toBe('YES');
    expect(d.capabilities.supportsMock.basis).toMatch(/not MOCK_READY/);
    expect(d.capabilities.supportsPractice.value).toBe('UNKNOWN');
    expect(d.lifecycle.configuration).toBe('STRUCTURE_ONLY');
  });
});

// ---------------------------------------------------------------------------
describe('T7 -- unknown session: valid blueprint, scoring stops before the session stage', () => {
  const r = compileExam(IB_AA_HL, { outcome: subjectGrade() });
  it('compiles and validates without any session', () => {
    expect(r.status).toBe('INCOMPLETE');
    expect(validateBlueprint(r.blueprint).ok).toBe(true);
    expect(validateExamDefinition(r.examDefinition, r.blueprint!).ok).toBe(true);
    expect(r.unresolvedFields).toEqual(expect.arrayContaining(['examDefinition.sessions', 'session', 'scoring.pipeline.GRADE_BOUNDARIES']));
  });
  it('stops at the last session-independent stage', () => {
    expect(r.completeness).toMatchObject({ sessionKey: null, resolvableThrough: 'COMPONENT_WEIGHTING', level: 'WEIGHTED_AVAILABLE', blockedBy: { stage: 'GRADE_BOUNDARIES' } });
    expect(r.completeness!.blockedBy!.reason).toMatch(/^SESSION_NOT_RESOLVED/);
    expect(r.examDefinition!.sessionPolicy).toMatchObject({ administration: 'UNKNOWN', configuredHint: null, sessionsKnown: [] });
  });
});

// ---------------------------------------------------------------------------
describe('T8 -- a historical session coexists with a future one', () => {
  it('both are valid against an explicit reference date', () => {
    const r = compileExam(IB_AA_HL, {
      outcome: subjectGrade(),
      sessions: [session({ sessionKey: 'nov-2025', year: 2025, label: 'November 2025', status: 'HISTORICAL' }), session({ sessionKey: 'may-2027', year: 2027, label: 'May 2027', status: 'PLANNED' })],
      asOf: '2026-10-05',
    });
    expect(r.status).toBe('INCOMPLETE');
    expect(r.sessions.map((s) => [s.sessionKey, s.status])).toEqual([['nov-2025', 'HISTORICAL'], ['may-2027', 'PLANNED']]);
  });
  it('status contradicting dates is caught -- only against asOf, never the clock', () => {
    const past = { ...session({ sessionKey: 'nov-2025', year: 2025, status: 'PLANNED' }), administration: { ...session({ sessionKey: 'x', year: 2025 }).administration, startDate: { status: 'STATED' as const, value: '2025-11-01', provenance: TEST }, endDate: { status: 'STATED' as const, value: '2025-11-20', provenance: TEST } } };
    expect(checkSession(past).issues).toEqual([]);
    expect(checkSession(past, { asOf: '2026-10-05' }).issues.map((i) => i.code)).toContain('CONTRADICTORY_STATUS');
  });
});

// ---------------------------------------------------------------------------
describe('T9 -- several administrations of the same specification', () => {
  it('May and November 2027 share exam + specification, stay distinct', () => {
    const r = compileExam(IB_AA_HL, { sessions: [session({ sessionKey: 'may-2027', year: 2027, label: 'May 2027' }), session({ sessionKey: 'nov-2027', year: 2027, label: 'November 2027' })] });
    expect(r.sessions.map((s) => s.specificationKey)).toEqual([IB_SPEC, IB_SPEC]);
    expect(new Set(r.sessions.map((s) => s.sessionKey)).size).toBe(2);
    expect(r.status).toBe('INCOMPLETE');
  });
  it('rejects duplicates, sessions of another exam / specification, and years outside the specification window', () => {
    const r = compileExam(IB_AA_HL, {
      sessions: [
        session({ sessionKey: 'may-2027', year: 2027 }),
        session({ sessionKey: 'may-2027', year: 2027 }),
        session({ sessionKey: 'other', year: 2027 }, 'v2.paa'),
        session({ sessionKey: 'next-spec', year: 2027 }, IB_AA_HL.key, 'ib-dp-math-aa@2030'),
        session({ sessionKey: 'may-2031', year: 2031 }),
      ],
    });
    expect(codes(r)).toEqual(expect.arrayContaining(['DUPLICATE_SESSION', 'SESSION_DEFINITION_MISMATCH', 'SESSION_SPECIFICATION_MISMATCH', 'SESSION_OUTSIDE_SPECIFICATION']));
    expect(r.status).toBe('INVALID');
  });
});

// ---------------------------------------------------------------------------
describe('T10 -- an outcome without authority is never fabricated', () => {
  it('compiles to UNKNOWN', () => {
    const r = compileExam(IB_AA_HL, { outcome: subjectGrade(THIRD) });
    expect(r.outcomeSpecification!.reported[0]).toMatchObject({ kind: 'GRADE', status: 'UNKNOWN' });
    expect(r.outcomeSpecification!.finalOutcome.status).toBe('UNKNOWN');
    expect(r.completeness!.state).toBe('FINAL_OUTCOME_UNKNOWN');
    expect(codes(r)).toContain('OUTCOME_DECLARATION_NOT_AUTHORITATIVE');
    expect(r.examDefinition!.capabilities.supportsPrediction.value).toBe('UNKNOWN');
  });
  it('a definition that claims a DECLARED outcome on a third-party source fails validation', () => {
    const r = compileExam(IB_AA_HL, { outcome: subjectGrade() });
    const forged = reseal(r.examDefinition!, (d) => {
      d.outcome.reported[0].provenance = THIRD;
    });
    expect(codes(validateExamDefinition(forged, r.blueprint!))).toContain('OUTCOME_WITHOUT_AUTHORITY');
  });
});

// ---------------------------------------------------------------------------
function reseal(d: ExamDefinitionV2, fn: (x: ExamDefinitionV2) => void): ExamDefinitionV2 {
  const x = structuredClone(d);
  fn(x);
  return { ...x, fingerprint: definitionFingerprint(x) };
}
function resealBp(bp: BlueprintV2, fn: (x: BlueprintV2) => void): BlueprintV2 {
  const x = structuredClone(bp);
  fn(x);
  return { ...x, fingerprint: blueprintFingerprint(x) };
}

describe('validator matrix (BP-1)', () => {
  const ib = compileExam(IB_AA_HL, { outcome: subjectGrade() });
  const def = ib.examDefinition!;
  const v = (d: ExamDefinitionV2, bp: BlueprintV2 = ib.blueprint!) => codes(validateExamDefinition(d, bp));

  it('accepts what it compiled', () => {
    expect(validateExamDefinition(def, ib.blueprint!).ok).toBe(true);
  });
  it('exam definition: identity, subject/domain, specification, component references', () => {
    expect(v(def, compileBlueprint(PAA_V2).blueprint!)).toContain('IDENTITY_INCONSISTENT');
    expect(v(reseal(def, (d) => { d.identity.subjectOrDomain = { kind: 'SUBJECT', name: null, domains: [] }; }))).toContain('INCOMPATIBLE_SUBJECT_DOMAIN');
    expect(v(reseal(def, (d) => { d.identity.subjectOrDomain = { kind: 'TEST', name: null, domains: [] }; }))).toContain('INCOMPATIBLE_SUBJECT_DOMAIN');
    expect(v(reseal(def, (d) => { d.specification.lastAssessment = { status: 'STATED', value: 2019, provenance: d.specification.firstAssessment.status === 'STATED' ? d.specification.firstAssessment.provenance : TEST }; }))).toContain('INVALID_SPECIFICATION_VERSION');
    expect(v(reseal(def, (d) => { d.specification.key = { status: 'STATED', value: d.specification.configurationLabel, provenance: TEST }; }))).toContain('INVALID_SPECIFICATION_VERSION');
    expect(v(reseal(def, (d) => { d.components = d.components.filter((c) => c.key !== 'ia'); }))).toContain('IMPOSSIBLE_COMPONENT_REFERENCE');
  });
  it('session: malformed administration, contradictory dates, authoritative without provenance, rule without authority', () => {
    const s = session({ sessionKey: 'may-2027', year: 2027 });
    expect(checkSession({ ...s, administration: { ...s.administration, label: null } }).issues.map((i) => i.code)).toContain('MALFORMED_ADMINISTRATION');
    expect(checkSession({ ...s, administration: { ...s.administration, type: 'ROLLING', startDate: { status: 'STATED', value: '2027-05-01', provenance: TEST } } }).issues.map((i) => i.code)).toContain('MALFORMED_ADMINISTRATION');
    expect(checkSession({ ...s, administration: { ...s.administration, startDate: { status: 'STATED', value: '2027-05-20', provenance: TEST }, endDate: { status: 'STATED', value: '2027-05-01', provenance: TEST } } }).issues.map((i) => i.code)).toContain('CONTRADICTORY_DATES');
    expect(checkSession({ ...s, administration: { ...s.administration, startDate: { status: 'STATED', value: '2026-05-01', provenance: TEST } } }).issues.map((i) => i.code)).toContain('CONTRADICTORY_DATES');
    expect(checkSession({ ...s, provenance: { kind: 'OFFICIAL_PUBLIC', authority: 'AWARDING_BODY', sourceKeys: [] } }).issues.map((i) => i.code)).toContain('MISSING_PROVENANCE');
    expect(checkSession(loaded(s, 'GRADE_BOUNDARIES', THIRD)).issues.map((i) => i.code)).toContain('SESSION_RULE_WITHOUT_AUTHORITY');
    expect(checkSession({ ...s, administration: { ...s.administration, year: { status: 'STATED', value: 'May' } } }).issues.map((i) => i.code)).toContain('MALFORMED_SESSION');
  });
  it('outcome: grade without a grade stage, points without aggregation, incompatible unit, final not declared', () => {
    const paa = compileExam(PAA_V2);
    const withGrade = reseal(paa.examDefinition!, (d) => {
      d.outcome.reported.push({ layer: 'SUBJECT', kind: 'GRADE', unit: 'GRADE', producedByStage: 'GRADE_BOUNDARIES', scaleKey: 'x', status: 'DECLARED', reason: null, sessionDependent: 'YES', provenance: TEST, final: false });
      d.outcome.reported.push({ layer: 'QUALIFICATION', kind: 'QUALIFICATION_POINTS', unit: 'QUALIFICATION_POINTS', producedByStage: 'QUALIFICATION_AGGREGATION', scaleKey: 'x', status: 'DECLARED', reason: null, sessionDependent: 'NO', provenance: TEST, final: false });
      d.outcome.reported.push({ layer: 'SUBJECT', kind: 'SCALED_SCORE', unit: 'GRADE', producedByStage: 'SCALE_CONVERSION', scaleKey: 'x', status: 'UNKNOWN', reason: 'x', sessionDependent: 'YES', provenance: TEST, final: false });
      d.outcome.finalOutcome = { status: 'DECLARED', layer: 'SUBJECT', kind: 'PASS_FAIL', provenance: TEST };
    });
    expect(v(withGrade, paa.blueprint!)).toEqual(expect.arrayContaining(['GRADE_WITHOUT_GRADE_STAGE', 'QUALIFICATION_POINTS_WITHOUT_AGGREGATION', 'INCOMPATIBLE_OUTCOME_UNIT', 'IMPOSSIBLE_OUTCOME_TRANSITION']));
    expect(outcomeToDeclaration({ provenance: TEST, outcomes: [{ layer: 'COMPONENT', kind: 'GRADE' }] }, []).issues.map((i) => i.code)).toContain('INCOMPATIBLE_OUTCOME_LAYER');
    expect(outcomeToDeclaration({ provenance: TEST, outcomes: [{ layer: 'SUBJECT', kind: 'GRADE' }, { layer: 'SUBJECT', kind: 'PASS_FAIL' }] }, []).issues.map((i) => i.code)).toContain('DUPLICATE_OUTCOME_STAGE');
    expect(outcomeToDeclaration({ provenance: TEST, outcomes: [{ layer: 'SUBJECT', kind: 'GRADE', final: true }, { layer: 'SUBJECT', kind: 'WEIGHTED_SCORE', final: true }] }, []).issues.map((i) => i.code)).toContain('MULTIPLE_FINAL_OUTCOMES');
  });
  it('session dependency: a resolved session fact without a session; a grade without a boundary source', () => {
    const resolvedInBlueprint = resealBp(ib.blueprint!, (b) => {
      const g = b.scoring.pipeline.find((s) => s.kind === 'GRADE_BOUNDARIES')!;
      g.dependency.status = 'RESOLVED';
      g.dependency.reason = null;
      b.scoring.resolution = { lastResolvableStage: 'GRADE_BOUNDARIES', stoppedAt: null, stopReason: null, outcomeDeclared: true };
    });
    expect(codes(validateBlueprint(resolvedInBlueprint))).toContain('SESSION_FACT_RESOLVED_WITHOUT_SESSION');
    expect(v(reseal(def, (d) => { d.completeness = { ...d.completeness, level: 'GRADE_AVAILABLE', state: 'FULLY_RESOLVED', blockedBy: null, resolvableThrough: 'GRADE_BOUNDARIES' }; }))).toContain('SESSION_FACT_RESOLVED_WITHOUT_SESSION');
    expect(v(reseal(def, (d) => { d.completeness = { ...d.completeness, sessionKey: 'may-2027', level: 'GRADE_AVAILABLE', state: 'FULLY_RESOLVED', blockedBy: null, resolvableThrough: 'GRADE_BOUNDARIES' }; }))).toContain('BOUNDARY_OUTCOME_WITHOUT_SOURCE');
  });
  it('tampering is detected', () => {
    const t = structuredClone(def);
    t.components[3].mockable = 'YES';
    expect(v(t)).toContain('FINGERPRINT_MISMATCH');
  });
});
