/**
 * Exam Assembly Validator + Mock Certification gate (pure): matching proof,
 * the 10 certification gates with the QB-2 slot constraints, the two
 * dimensions (engine capability vs content readiness), D2-D5 semantics, and
 * the item-facts / configuration adapters.
 */
import { describe, it, expect } from 'vitest';
import { assessExam, certifyBlueprint, constraintMisses, disjointForms, itemBlockers, matchPositions, type BankItemFacts, type CertificationInput, type ComponentSpec, type PositionSpec } from '@/lib/exam-core/question-bank/mock-certification';
import { bankItemFacts, type BankVersionRow } from '@/lib/exam-core/question-bank/mock-certification-facts';
import { blueprintSpecificationOf, certificationInputFromConfig, componentSpecFrom, parseDefinition } from '@/lib/exam-core/question-bank/certification-input';
import { componentCapabilities, assessmentSemanticsOf } from '@/lib/exam-core/fidelity';
import { examAudienceOf, contentAudienceFor, isFixtureContent } from '@/lib/exam-core/audience';
import { parseExamVerticalConfig } from '@/lib/exam-core/vertical-config';
import { PAA_V2, SABER11_MATH_V2 } from '@/lib/exam-core/verticals/v2';

let seq = 0;
function item(over: Partial<BankItemFacts> = {}): BankItemFacts {
  seq += 1;
  return {
    id: `i${String(seq).padStart(3, '0')}`, objectiveId: 'o1', questionType: 'multiple_choice', difficulty: 3, marks: 1,
    lifecycle: 'ACTIVE', usage: null, alignment: 'MOCK_READY', provenance: 'STUDYUS_GENERATED', status: 'PUBLISHED', isCurrentVersion: true, retired: false, calibrationConfidence: null,
    contentStatus: 'ORIGINAL', templateFingerprint: null, structureProblems: [], grading: 'DETERMINISTIC', placeholderSignals: [], unresolvedDependencies: [],
    ...over,
  };
}
const fixture = (over: Partial<BankItemFacts> = {}) => item({ provenance: 'FIXTURE', contentStatus: 'DEV_CERT_FIXTURE', ...over });
const pos = (over: Partial<PositionSpec> = {}): PositionSpec => ({ componentKey: 'p1', objectiveId: 'o1', objectiveCode: 'obj.1', questionType: null, difficultyMin: null, difficultyMax: null, ...over });
const comp = (over: Partial<ComponentSpec> = {}): ComponentSpec => ({ key: 'p1', name: 'Paper 1', officialItemCount: 2, officialMarks: null, simulationCapable: true, mockable: true, sections: [], blueprintSpecification: 'DOCUMENTED', ...over });

function exam(positions: PositionSpec[], items: BankItemFacts[], over: Partial<CertificationInput> = {}): CertificationInput {
  return {
    examKey: 'v2.test', examName: 'X', family: 'IB', versionLabel: 'v1', audience: 'STUDENT', blueprintPublished: true,
    components: [comp({ officialItemCount: positions.length })],
    positions, items, scoring: { policyConfigured: true, official: false, projectionCalibrated: false }, ...over,
  };
}
const gate = (r: { gates: Array<{ gate: number; pass: boolean; detail: string[] }> }, n: number) => r.gates.find((g) => g.gate === n)!;

describe('matchPositions', () => {
  it('finds a complete matching that greedy-in-order would miss (augmenting path)', () => {
    const a = item({ id: 'a' });
    const b = item({ id: 'b', questionType: 'numeric_problem' });
    const m = matchPositions([pos({ questionType: null }), pos({ questionType: 'multiple_choice' })], [a, b]);
    expect(m.every(Boolean)).toBe(true);
    expect(m[1]!.id).toBe('a');
  });
  it('never uses two items of the same template in one form', () => {
    expect(matchPositions([pos(), pos()], [item({ templateFingerprint: 't1' }), item({ templateFingerprint: 't1' })]).filter(Boolean)).toHaveLength(1);
  });
  it('counts item-disjoint forms', () => {
    expect(disjointForms([pos(), pos()], Array.from({ length: 5 }, () => item()), 10)).toBe(2);
  });
});

describe('QB-2: slot constraints are enforced whenever the blueprint states them', () => {
  it('question type, difficulty, section, skill, command term and marks', () => {
    const it0 = item({ difficulty: 2, sectionKey: 'A', skillIds: ['sk1'], commandTerm: 'Explain', marks: 4 });
    expect(constraintMisses(it0, pos({ questionType: 'multiple_choice', difficultyMin: 1, difficultyMax: 3, sectionKey: 'A', skillId: 'sk1', commandTerm: 'explain', marks: 4 }))).toEqual([]);
    expect(constraintMisses(it0, pos({ sectionKey: 'B' }))).toEqual(['SECTION']);
    expect(constraintMisses(it0, pos({ skillId: 'sk2' }))).toEqual(['SKILL']);
    expect(constraintMisses(it0, pos({ commandTerm: 'Evaluate' }))).toEqual(['COMMAND_TERM']);
    expect(constraintMisses(it0, pos({ marks: 6 }))).toEqual(['MARKS']);
    expect(constraintMisses(it0, pos({ difficultyMin: 4, difficultyMax: 5 }))).toEqual(['DIFFICULTY']);
  });
  it('an unmet constraint leaves the position empty, and the report says why', () => {
    const r = certifyBlueprint(exam([pos({ commandTerm: 'Evaluate', marks: 6 })], [item({ commandTerm: 'Explain', marks: 2 })]), 'CERTIFIED');
    expect(r.verdict).toBe('FAIL');
    expect(r.components[0].missing[0]).toMatchObject({ constraints: ['command term "Evaluate"', '6 marks'], blockedCandidates: { CONSTRAINT_COMMAND_TERM: 1, CONSTRAINT_MARKS: 1 } });
    expect(gate(r, 2).detail[0]).toMatch(/command term "Evaluate" \/ 6 marks/);
  });
});

describe('itemBlockers (D5: fixtures are never real content)', () => {
  it('ENGINE accepts a mock-eligible fixture; CERTIFIED rejects it as DEV_FIXTURE', () => {
    expect(itemBlockers(fixture(), 'ENGINE')).toEqual([]);
    expect(itemBlockers(fixture(), 'CERTIFIED')).toEqual(['DEV_FIXTURE']);
  });
  it('a PILOT or practice-only item never enters a full mock; missing provenance is not content', () => {
    expect(itemBlockers(item({ lifecycle: 'PILOT' }), 'CERTIFIED')).toContain('NOT_FULL_MOCK_ELIGIBLE');
    expect(itemBlockers(item({ usage: ['PRACTICE'], alignment: 'EXAM_STYLE' }), 'CERTIFIED')).toContain('NOT_FULL_MOCK_ELIGIBLE');
    expect(itemBlockers(item({ provenance: undefined }), 'CERTIFIED')).toContain('MISSING_PROVENANCE');
  });
  it('unkeyed free text, placeholders and missing figures block certification', () => {
    expect(itemBlockers(item({ grading: 'UNKEYED', placeholderSignals: ['PLACEHOLDER_TEXT'], unresolvedDependencies: ['REFERENCES_ABSENT_FIGURE'] }), 'CERTIFIED')).toEqual(expect.arrayContaining(['NOT_REPRODUCIBLY_GRADABLE', 'PLACEHOLDER', 'MISSING_DEPENDENCY']));
  });
});

describe('certifyBlueprint (CERTIFIED gate)', () => {
  it('PASS with disjoint forms counted', () => {
    const r = certifyBlueprint(exam([pos(), pos()], Array.from({ length: 4 }, () => item())), 'CERTIFIED');
    expect(r.verdict).toBe('PASS');
    expect(r.disjointForms).toBe(2);
  });
  it('an empty required position is a FAIL -- never "one slot filled"', () => {
    const r = certifyBlueprint(exam([pos(), pos(), pos()], [item()]), 'CERTIFIED');
    expect(r.verdict).toBe('FAIL');
    expect(gate(r, 5).detail).toEqual(['2/3 positions unfilled']);
    expect(gate(r, 8).pass).toBe(false);
  });
  it('a fixture-filled form fails gate 7 even if every slot is filled', () => {
    const r = certifyBlueprint(exam([pos()], [fixture()]), 'CERTIFIED');
    expect(r.verdict).toBe('FAIL');
    expect(r.components[0].missing[0].blockedCandidates).toEqual({ DEV_FIXTURE: 1 });
    // ... while the ENGINE profile builds it (engine capability only).
    const e = certifyBlueprint(exam([pos()], [fixture()]), 'ENGINE');
    expect(e.verdict).toBe('PASS');
    expect(e.warnings[0]).toMatch(/DEV fixtures \(engine capability only\)/);
  });
  it('gate 1: reduced length, undocumented distribution (D2), missing official sections, non-mockable component (D4)', () => {
    const input = exam([pos()], [item()]);
    input.components[0] = comp({ officialItemCount: 40, blueprintSpecification: 'UNKNOWN', sections: ['A', 'B'], mockable: false });
    const d = gate(certifyBlueprint(input, 'CERTIFIED'), 1).detail;
    expect(d).toEqual(expect.arrayContaining(['p1: COMPONENT_NOT_MOCKABLE', 'p1: BLUEPRINT_BELOW_OFFICIAL_LENGTH (1/40 items)', 'p1: BLUEPRINT_DISTRIBUTION_UNKNOWN', 'p1: REQUIRED_SECTION_MISSING A', 'p1: REQUIRED_SECTION_MISSING B']));
  });
  it('D2: the right number of items is NOT enough without a documented distribution', () => {
    const input = exam([pos(), pos()], [item(), item()]);
    input.components[0] = comp({ officialItemCount: 2, blueprintSpecification: 'UNKNOWN' });
    const r = certifyBlueprint(input, 'CERTIFIED');
    expect(r.verdict).toBe('FAIL');
    expect(gate(r, 1).detail).toEqual(['p1: BLUEPRINT_DISTRIBUTION_UNKNOWN']);
    expect(gate(r, 2).pass && gate(r, 5).pass).toBe(true);
  });
  it('gate 4: marks come from each item\'s mark scheme and must reconcile with the official paper', () => {
    const input = exam([pos(), pos()], [item({ marks: 1 }), item({ marks: 2 })]);
    input.components[0] = comp({ officialItemCount: null, officialMarks: 4 });
    const r = certifyBlueprint(input, 'CERTIFIED');
    expect(r.components[0].plannedMarks).toBe(3);
    expect(gate(r, 4).detail).toEqual(['p1: planned 3 marks vs official 4']);
  });
  it('unknown official size and missing scoring policy fail', () => {
    const input = exam([pos()], [item()], { scoring: { policyConfigured: false, official: false, projectionCalibrated: false } });
    input.components[0] = comp({ officialItemCount: null });
    const r = certifyBlueprint(input, 'CERTIFIED');
    expect(gate(r, 1).detail).toContain('p1: OFFICIAL_SIZE_UNKNOWN');
    expect(gate(r, 10).pass).toBe(false);
  });
});

describe('assessExam: engine capability and content readiness are separate dimensions', () => {
  it('ENGINE_CAPABILITY = TECHNICAL_DEMO with CONTENT_READINESS = NONE is valid and never MOCK_READY', () => {
    const a = assessExam(exam([pos(), pos()], [fixture(), fixture(), fixture()]));
    expect(a).toMatchObject({ engineCapability: 'TECHNICAL_DEMO', contentReadiness: 'NONE', mockReady: false, mockApplicability: 'APPLICABLE' });
  });
  it('the ladder: PRACTICE_READY -> SECTION_FIDELITY -> ONE_MOCK_READY -> MULTI_MOCK_READY -> PRODUCTION_DEPTH', () => {
    const two = (n: number) => Array.from({ length: n }, () => item());
    const practiceOnly = assessExam(exam([pos(), pos()], [item({ lifecycle: 'PILOT' })]));
    expect(practiceOnly.contentReadiness).toBe('PRACTICE_READY');
    expect(assessExam(exam([pos(), pos()], two(2))).contentReadiness).toBe('ONE_MOCK_READY');
    expect(assessExam(exam([pos(), pos()], two(4))).contentReadiness).toBe('MULTI_MOCK_READY');
    expect(assessExam(exam([pos(), pos()], two(10))).contentReadiness).toBe('PRODUCTION_DEPTH');
    // Two mockable papers, one certifiable alone: SECTION_FIDELITY, the exam is not ONE_MOCK_READY.
    const input = exam([pos(), pos({ componentKey: 'p2', objectiveId: 'o2' })], [item()]);
    input.components = [comp({ key: 'p1', officialItemCount: 1 }), comp({ key: 'p2', officialItemCount: 1 })];
    const sec = assessExam(input);
    expect(sec).toMatchObject({ contentReadiness: 'SECTION_FIDELITY', certifiedSections: ['p1'], mockReady: false });
  });
  it('D4: a non-mockable component stays in the blueprint and never blocks or fakes the mock', () => {
    const input = exam([pos(), pos({ componentKey: 'ia', objectiveId: 'o9' })], [item()]);
    input.components = [comp({ key: 'p1', officialItemCount: 1 }), comp({ key: 'ia', name: 'Internal assessment', mockable: false, officialItemCount: null, officialMarks: 24 })];
    const a = assessExam(input);
    expect(a.nonMockableComponents).toEqual(['ia']);
    expect(a.certified!.components.map((c) => c.key)).toEqual(['p1']);
    expect(a.mockReady).toBe(true);
  });
  it('D3: a competency benchmark (PISA) is never mock-applicable', () => {
    const a = assessExam(exam([pos()], [item(), item()], { family: 'PISA' }));
    expect(a).toMatchObject({ semantics: 'COMPETENCY_BENCHMARK', mockApplicability: 'NOT_APPLICABLE_COMPETENCY_BENCHMARK', mockReady: false, certified: null, contentReadiness: 'PRACTICE_READY' });
  });
  it('D1: a technical certification exam is an engine demo, never content-ready', () => {
    const a = assessExam(exam([pos()], [item(), item()], { examKey: 'dev-cert.paa', audience: 'TECHNICAL_CERTIFICATION' }));
    expect(a).toMatchObject({ engineCapability: 'TECHNICAL_DEMO', contentReadiness: 'NONE', mockApplicability: 'NOT_APPLICABLE_TECHNICAL_EXAM', mockReady: false });
  });
});

describe('audience and capability rules (pure)', () => {
  it('D1: dev-cert.* is TECHNICAL_CERTIFICATION, no config key is INTERNAL; both run only as technical demos', () => {
    expect(examAudienceOf('dev-cert.paa')).toBe('TECHNICAL_CERTIFICATION');
    expect(examAudienceOf(null)).toBe('INTERNAL');
    expect(examAudienceOf('v2.paa')).toBe('STUDENT');
    expect(contentAudienceFor('INTERNAL', 'STUDENT')).toBe('TECHNICAL_DEMO');
    expect(contentAudienceFor('STUDENT')).toBe('STUDENT');
  });
  it('D5: any of the three provenance markers makes content a fixture', () => {
    expect(isFixtureContent({ provenance: 'FIXTURE' })).toBe(true);
    expect(isFixtureContent({ contentOrigin: 'FIXTURE' })).toBe(true);
    expect(isFixtureContent({ contentStatus: 'DEV_CERT_FIXTURE' })).toBe(true);
    expect(isFixtureContent({ provenance: 'STUDYUS_GENERATED', contentStatus: 'ORIGINAL' })).toBe(false);
  });
  it('D4: written papers and MC tests are mockable; coursework, portfolio, IA, orals, practicals are not', () => {
    const cap = (kind: string, family = 'IB') => componentCapabilities({ definition: { kind: kind as never, assessment: 'EXTERNAL' }, simulationCapable: true, family }).mockable;
    expect(cap('WRITTEN_PAPER')).toBe(true);
    expect(cap('MULTIPLE_CHOICE_TEST')).toBe(true);
    for (const k of ['COURSEWORK', 'PORTFOLIO', 'INTERNAL_ASSESSMENT', 'PROJECT', 'ORAL', 'PRACTICAL', 'PERFORMANCE', 'PRESENTATION', 'RESEARCH_REPORT']) expect(cap(k), k).toBe(false);
    expect(componentCapabilities({ definition: { kind: 'INTERNAL_ASSESSMENT', assessment: 'INTERNAL' }, simulationCapable: false })).toMatchObject({ assessmentComponent: true, predictionInput: true, mockable: false });
    expect(cap('WRITTEN_PAPER', 'PISA')).toBe(false);
    expect(assessmentSemanticsOf('PISA')).toBe('COMPETENCY_BENCHMARK');
  });
  it('D2: blueprint specification is UNKNOWN unless documented with a source', () => {
    expect(blueprintSpecificationOf(null)).toBe('UNKNOWN');
    const def = (spec?: unknown) => parseDefinition({ officialName: 'P', kind: 'WRITTEN_PAPER', officialDurationMinutes: 60, maxMarks: 50, weightingPercent: null, calculatorPolicy: null, responseFormats: ['SHORT_RESPONSE'], sourceKeys: ['s'], ...(spec ? { blueprintSpecification: spec } : {}) });
    expect(blueprintSpecificationOf(def())).toBe('UNKNOWN');
    expect(blueprintSpecificationOf(def({ status: 'DOCUMENTED', sourceKeys: [] }))).toBe('PARTIAL');
    expect(blueprintSpecificationOf(def({ status: 'DOCUMENTED', sourceKeys: ['official-spec'] }))).toBe('DOCUMENTED');
    expect(componentSpecFrom({ key: 'p', name: 'P', definition: def(), simulationCapable: true, maxMarks: null, family: 'IB' })).toMatchObject({ officialMarks: 50, mockable: true, blueprintSpecification: 'UNKNOWN' });
  });
});

describe('configuration adapter (catalogue): today\'s configs are engine demos, not content', () => {
  for (const [name, input] of [['PAA', PAA_V2], ['Saber 11 Matemáticas', SABER11_MATH_V2]] as const) {
    it(`${name}: TECHNICAL_DEMO engine, NONE content, no mock`, () => {
      const parsed = parseExamVerticalConfig(input);
      if (!parsed.ok) throw new Error('config');
      const a = assessExam(certificationInputFromConfig(parsed.config));
      expect(a).toMatchObject({ engineCapability: 'TECHNICAL_DEMO', contentReadiness: 'NONE', mockReady: false });
      expect(a.certified!.ineligibleReasons.DEV_FIXTURE).toBe(parsed.config.items.length);
      // D2: no PAA / Saber component documents its full-form distribution yet.
      expect(gate(a.certified!, 1).detail.some((d) => d.includes('BLUEPRINT_DISTRIBUTION_UNKNOWN'))).toBe(true);
    });
  }
});

describe('bankItemFacts', () => {
  const row = (content: Record<string, unknown>): BankVersionRow => ({
    id: 'v1', learning_objective_id: 'o1', question_type: 'multiple_choice', status: 'PUBLISHED', bank_lifecycle_status: 'ACTIVE', usage_eligibility: null, exam_alignment: 'MOCK_READY',
    provenance: 'FIXTURE', template_fingerprint: null, calibration_confidence: null, is_current_version: true, retired: false,
    content: { key: 'k', contentStatus: 'DEV_CERT_FIXTURE', language: 'es', type: 'multiple_choice', answerFormat: 'single_choice', question: '¿Cuál es todo el conjunto?', options: [{ id: 'A', text: 'uno' }, { id: 'B', text: 'dos' }], correctAnswer: 'B', explanation: 'Porque sí.', difficulty: 2, marks: 1, commandTerm: 'identify', ...content },
  });
  it('reads marks, grading mode, content status and command term from the stored item', () => {
    expect(bankItemFacts(row({}))).toMatchObject({ marks: 1, grading: 'DETERMINISTIC', contentStatus: 'DEV_CERT_FIXTURE', structureProblems: [], placeholderSignals: [], commandTerm: 'identify' });
  });
  it('Spanish "todo" is not a TODO marker; a real marker is', () => {
    expect(bankItemFacts(row({})).placeholderSignals).toEqual([]);
    expect(bankItemFacts(row({ question: 'TODO: write the stem' })).placeholderSignals).toContain('PLACEHOLDER_TEXT');
  });
  it('an answer key that is not an option is a structure problem; unparseable content is reported', () => {
    expect(bankItemFacts(row({ correctAnswer: 'Z' })).structureProblems).toContain('ANSWER_KEY_NOT_AN_OPTION');
    expect(bankItemFacts({ ...row({}), content: { nope: true } }).structureProblems).toEqual(['UNPARSEABLE_CONTENT']);
  });
  it('flags a stem that points at a figure the item does not carry', () => {
    expect(bankItemFacts(row({ question: 'Using the diagram below, find x.' })).unresolvedDependencies).toEqual(['REFERENCES_ABSENT_FIGURE']);
  });
  it('free text without a key or rubric is UNKEYED', () => {
    expect(bankItemFacts(row({ answerFormat: 'text', options: undefined, correctAnswer: 'algo' })).grading).toBe('UNKEYED');
  });
});
