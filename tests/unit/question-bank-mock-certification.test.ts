/**
 * Exam Assembly Validator + Mock Certification gate (pure): matching proof,
 * the 10 certification gates, coverage status and the item-facts mapper.
 */
import { describe, it, expect } from 'vitest';
import { certifyBlueprint, matchPositions, disjointForms, itemBlockers, type BankItemFacts, type CertificationInput, type PositionSpec } from '@/lib/exam-core/question-bank/mock-certification';
import { bankItemFacts, type BankVersionRow } from '@/lib/exam-core/question-bank/mock-certification-facts';

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
const pos = (over: Partial<PositionSpec> = {}): PositionSpec => ({ componentKey: 'p1', objectiveId: 'o1', objectiveCode: 'obj.1', questionType: null, difficultyMin: null, difficultyMax: null, ...over });

function exam(positions: PositionSpec[], items: BankItemFacts[], over: Partial<CertificationInput> = {}): CertificationInput {
  return {
    examKey: 'x', examName: 'X', family: 'TEST', versionLabel: 'v1', blueprintPublished: true,
    components: [{ key: 'p1', name: 'Paper 1', officialItemCount: positions.length, officialMarks: null, simulationCapable: true }],
    positions, items, scoring: { policyConfigured: true, official: false, projectionCalibrated: false }, ...over,
  };
}

describe('matchPositions', () => {
  it('finds a complete matching that greedy-in-order would miss (augmenting path)', () => {
    // a fits both positions, b fits only the first: in-order greedy gives p0<-a and leaves p1 empty.
    const a = item({ id: 'a', objectiveId: 'o1' });
    const b = item({ id: 'b', objectiveId: 'o1', questionType: 'numeric_problem' });
    const positions = [pos({ questionType: null }), pos({ questionType: 'multiple_choice' })];
    const m = matchPositions(positions, [a, b]);
    expect(m.every(Boolean)).toBe(true);
    expect(m[1]!.id).toBe('a');
  });

  it('never uses two items of the same template in one form', () => {
    const items = [item({ templateFingerprint: 't1' }), item({ templateFingerprint: 't1' })];
    expect(matchPositions([pos(), pos()], items).filter(Boolean)).toHaveLength(1);
  });

  it('respects question type and difficulty band', () => {
    const m = matchPositions([pos({ questionType: 'multiple_choice', difficultyMin: 4, difficultyMax: 5 })], [item({ difficulty: 2 }), item({ questionType: 'short_answer', difficulty: 4 })]);
    expect(m[0]).toBeNull();
  });

  it('counts item-disjoint forms', () => {
    const items = Array.from({ length: 5 }, () => item());
    expect(disjointForms([pos(), pos()], items, 10)).toBe(2);
  });
});

describe('itemBlockers', () => {
  it('STRUCTURAL accepts a mock-eligible fixture; CERTIFIED rejects it', () => {
    const f = item({ provenance: 'FIXTURE', contentStatus: 'DEV_CERT_FIXTURE' });
    expect(itemBlockers(f, 'STRUCTURAL')).toEqual([]);
    expect(itemBlockers(f, 'CERTIFIED')).toContain('DEV_FIXTURE');
  });
  it('a PILOT or practice-only item never enters a mock', () => {
    expect(itemBlockers(item({ lifecycle: 'PILOT' }), 'STRUCTURAL')).toContain('NOT_MOCK_ELIGIBLE');
    expect(itemBlockers(item({ usage: ['PRACTICE'], alignment: 'EXAM_STYLE' }), 'CERTIFIED')).toContain('NOT_MOCK_ELIGIBLE');
  });
  it('unkeyed free text, placeholders and missing figures block certification', () => {
    const r = itemBlockers(item({ grading: 'UNKEYED', placeholderSignals: ['PLACEHOLDER_TEXT'], unresolvedDependencies: ['REFERENCES_ABSENT_FIGURE'] }), 'CERTIFIED');
    expect(r).toEqual(expect.arrayContaining(['NOT_REPRODUCIBLY_GRADABLE', 'PLACEHOLDER', 'MISSING_DEPENDENCY']));
  });
});

describe('certifyBlueprint', () => {
  it('PASS with the coverage status derived from disjoint forms', () => {
    const items = Array.from({ length: 4 }, () => item());
    const r = certifyBlueprint(exam([pos(), pos()], items), 'CERTIFIED');
    expect(r.verdict).toBe('PASS');
    expect(r.disjointForms).toBe(2);
    expect(r.status).toBe('TWO_MOCKS_READY');
    expect(certifyBlueprint(exam([pos(), pos()], items.slice(0, 2)), 'CERTIFIED').status).toBe('ONE_MOCK_READY');
    expect(certifyBlueprint(exam([pos()], Array.from({ length: 6 }, () => item())), 'CERTIFIED').status).toBe('PRODUCTION_DEPTH');
  });

  it('FAIL lists exactly what is missing, with the blocked candidates', () => {
    const positions = [pos(), pos(), pos({ objectiveId: 'o2', objectiveCode: 'obj.2', questionType: 'short_answer' })];
    const items = [item(), item({ provenance: 'FIXTURE', contentStatus: 'DEV_CERT_FIXTURE' })];
    const r = certifyBlueprint(exam(positions, items), 'CERTIFIED');
    expect(r.verdict).toBe('FAIL');
    expect(r.status).toBe('PARTIAL');
    const missing = r.components[0].missing;
    expect(missing).toEqual(expect.arrayContaining([
      expect.objectContaining({ objectiveCode: 'obj.1', count: 1, blockedCandidates: { DEV_FIXTURE: 1 } }),
      expect.objectContaining({ objectiveCode: 'obj.2', questionType: 'short_answer', count: 1 }),
    ]));
    expect(r.gates.find((g) => g.gate === 2)!.pass).toBe(false);
  });

  it('a reduced blueprint is never certified (gate 1), even when fully filled', () => {
    const input = exam([pos()], [item()]);
    input.components[0].officialItemCount = 40;
    const r = certifyBlueprint(input, 'CERTIFIED');
    expect(r.gates.find((g) => g.gate === 1)!.detail[0]).toMatch(/BLUEPRINT_BELOW_OFFICIAL_LENGTH \(1\/40/);
    expect(r.verdict).toBe('FAIL');
    // ... while the runtime (STRUCTURAL) view builds it.
    expect(certifyBlueprint(input, 'STRUCTURAL').verdict).toBe('PASS');
  });

  it('marks must reconcile with the official paper (gate 4); MCQ marks come from the item, never assumed', () => {
    const input = exam([pos(), pos()], [item({ marks: 1 }), item({ marks: 2 })]);
    input.components[0] = { ...input.components[0], officialItemCount: null, officialMarks: 4 };
    const r = certifyBlueprint(input, 'CERTIFIED');
    expect(r.components[0].plannedMarks).toBe(3);
    expect(r.gates.find((g) => g.gate === 4)!.detail).toEqual(['p1: planned 3 marks vs official 4']);
  });

  it('unknown official size and missing scoring policy fail certification', () => {
    const input = exam([pos()], [item()], { scoring: { policyConfigured: false, official: false, projectionCalibrated: false } });
    input.components[0].officialItemCount = null;
    const r = certifyBlueprint(input, 'CERTIFIED');
    expect(r.gates.find((g) => g.gate === 1)!.detail).toContain('p1: OFFICIAL_SIZE_UNKNOWN');
    expect(r.gates.find((g) => g.gate === 10)!.pass).toBe(false);
  });

  it('an empty bank is NONE', () => {
    expect(certifyBlueprint(exam([pos()], []), 'CERTIFIED').status).toBe('NONE');
  });
});

describe('bankItemFacts', () => {
  const row = (content: Record<string, unknown>): BankVersionRow => ({
    id: 'v1', learning_objective_id: 'o1', question_type: 'multiple_choice', status: 'PUBLISHED', bank_lifecycle_status: 'ACTIVE', usage_eligibility: null, exam_alignment: 'MOCK_READY',
    provenance: 'FIXTURE', template_fingerprint: null, calibration_confidence: null, is_current_version: true, retired: false,
    content: { key: 'k', contentStatus: 'DEV_CERT_FIXTURE', language: 'es', type: 'multiple_choice', answerFormat: 'single_choice', question: '¿Cuál es todo el conjunto?', options: [{ id: 'A', text: 'uno' }, { id: 'B', text: 'dos' }], correctAnswer: 'B', explanation: 'Porque sí.', difficulty: 2, marks: 1, ...content },
  });

  it('reads marks, grading mode and content status from the stored item', () => {
    const f = bankItemFacts(row({}));
    expect(f).toMatchObject({ marks: 1, grading: 'DETERMINISTIC', contentStatus: 'DEV_CERT_FIXTURE', structureProblems: [], placeholderSignals: [] });
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
