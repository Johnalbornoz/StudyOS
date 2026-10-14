/**
 * The scoring-preserving projection (exam-bank-projection-3): certified instance -> Exam Bank content -> Exam Core.
 * Real certified supply (QF V5.2, 326 instances) + a synthetic IB re-render. Pure: no database, no provider.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { CertifiedInstance } from '@/lib/assessment-instance/v52';
import { evaluateResponse, type ResponseEvaluationPolicy } from '@/lib/assessment-instance/response-evaluation';
import { bankContentOf, projectionRefusal } from '@/lib/exam-bank/bank-projection';
import { intermediateSatisfiedBy, scoringBankContentOf, scoringProjectionRefusal, SCORING_PROJECTION_VERSION, type MachineMarkScheme } from '@/lib/exam-bank/scoring-projection';
import { sha256OfCanonicalJson } from '@/lib/assessment-adaptation/canonical-hash';
import { examItemFromApproved } from '@/lib/exam-core/items';
import { gradeExamItem } from '@/lib/exam-core/item-grading';

const SUPPLY = JSON.parse(readFileSync(join(process.cwd(), 'docs/exams/question-factory/v52/QF52_CERTIFIED_SUPPLY.json'), 'utf8')) as { rows: any[] };
/** A certified instance rebuilt from its materialised row (the fields the projections read). */
function instanceOf(row: any): CertifiedInstance {
  const c = row.content; const l = c.lineage;
  return {
    itemType: 'EXAM_BANK_ITEM', instanceId: row.itemInstanceId, coreId: l.coreId, coreVersion: l.coreVersion, conceptId: row.primaryConceptStableId, canonicalSubject: row.canonicalSubject,
    systemId: l.systemId, systemVersionId: l.systemVersionId, adapterId: l.adapterId, adapterVersion: l.adapterVersion, blueprintId: l.blueprintId, blueprintVersion: l.blueprintVersion, blueprintClass: l.blueprintClass,
    bucketId: l.bucketId, rendererVersion: l.rendererVersion, envelopeHash: l.envelopeHash, seed: l.seed, recognitionId: `rec-${row.itemInstanceId.slice(0, 8)}`, format: c.itemType, language: c.language, marks: c.marks,
    itemDifficulty: c.difficulty, difficultyBand: c.difficultyBand,
    learner: { language: c.language, itemType: c.itemType, stimulus: null, prompt: c.question, parts: [], options: c.options, marks: c.marks, conditions: { calculator: 'NONE', workingShown: row.markedOnWorking } },
    key: { answers: c.response.key, correctOption: null, distractorRationales: {}, distractorLineage: {} }, rubric: c.rubric, responsePolicy: c.response.policy, rightsCategory: c.rights.category,
    certificationState: l.certificationState, certificationMode: l.certificationMode, policyVersion: l.policyVersion, policyHash: l.policyHash, lineage: {} as never, lineageHash: l.digest, eligibilityScopes: row.eligibilityScopes, markedOnWorking: row.markedOnWorking,
  };
}
const ALL = SUPPLY.rows.map(instanceOf);
const IB = ALL.filter((i) => i.systemId === 'IB');
const PAA = ALL.filter((i) => i.systemId !== 'IB');
const grade = async (content: unknown, answer: string) => {
  const item = examItemFromApproved({ id: 'v-1', learning_objective_id: 'lo-1', content });
  if (!item) throw new Error('not an Exam Core item');
  return gradeExamItem(item, answer, 'en');
};

describe('PAA supply: projection 3 keeps projection 2 scoring exactly', () => {
  it('inventory: 296 PAA numeric instances, each with ONE key value; 30 IB working-marked', () => {
    expect(PAA.length).toBe(296);
    expect(IB.length).toBe(30);
    expect(PAA.every((i) => new Set(i.key.answers).size === 1)).toBe(true);
  });
  it('every PAA instance projects under both, with the same math key', () => {
    for (const i of PAA) {
      expect(projectionRefusal(i)).toBeNull();
      expect(scoringProjectionRefusal(i)).toBeNull();
      const v2 = bankContentOf(i); const v3 = scoringBankContentOf(i);
      expect(v3.math).toEqual(v2.math);
      expect([v3.question, v3.marks, v3.correctAnswer, v3.scoringStrategy]).toEqual([v2.question, v2.marks, v2.correctAnswer, v2.scoringStrategy]);
      expect((v3.certified as any).projection).toBe(SCORING_PROJECTION_VERSION);
    }
  });
  it('and grades the same answers the same way (sample of 25)', async () => {
    for (const i of PAA.slice(0, 25)) {
      const key = i.key.answers[0];
      for (const answer of [key, `${key}1`, '0']) {
        const [a, b] = await Promise.all([grade(bankContentOf(i), answer), grade(scoringBankContentOf(i), answer)]);
        expect([b.fraction, b.status]).toEqual([a.fraction, a.status]);
      }
    }
  });
});

describe('the 30 certified IB instances stay CERTIFIED_NOT_DELIVERABLE', () => {
  it('both projections refuse them, each with its reason', () => {
    for (const i of IB) {
      expect(projectionRefusal(i)).toBe('RESPONSE_IS_MARKED_ON_WORKING');
      expect(scoringProjectionRefusal(i)).toBe('WORKING_MARKED_WITHOUT_MACHINE_MARK_SCHEME');
    }
  });
  it('their certified schema is not compatible with any machine scheme without re-certified content', () => {
    const i = IB[0]; // x² − 3x + 2 = 0, rubric M1 (prose) A1 "1" A1 "2", no learner parts
    const withScheme = (scheme: unknown): CertifiedInstance => ({ ...i, responsePolicy: { ...i.responsePolicy, markScheme: scheme } as ResponseEvaluationPolicy });
    const target = (id: string, value: string, answerPoints: number[], method: MachineMarkScheme['targets'][number]['method'] = null) => ({ targetId: id, kind: 'NUMBER', value, equivalents: [], answerPoints, method });
    // the roots as a set: the Exam Core has no set target
    expect(scoringProjectionRefusal(withScheme({ v: 1, structure: 'UNORDERED_SET', targets: [target('r1', '1', [1]), target('r2', '2', [2])] }))).toBe('UNORDERED_SOLUTION_SET_NOT_SCORABLE');
    // ordered parts the certified learner content does not have
    expect(scoringProjectionRefusal(withScheme({ v: 1, structure: 'ORDERED_PARTS', order: 'ASCENDING', targets: [target('a', '1', [1], { points: [0], intermediates: ['(x-1)(x-2)=0'], impliedByCorrectAnswer: true }), target('b', '2', [2])] }))).toBe('PARTS_NOT_IN_CERTIFIED_LEARNER_CONTENT');
    // the prose M1 cannot be dropped: every certified rubric point must be mapped
    expect(scoringProjectionRefusal(withScheme({ v: 1, structure: 'SINGLE', targets: [target('answer', '1', [1, 2])] }))).toBe('RUBRIC_POINT_NOT_MAPPED');
    // a method point with no intermediates is not a machine scheme at all
    expect(scoringProjectionRefusal(withScheme({ v: 1, structure: 'SINGLE', targets: [{ ...target('answer', '1', [1]), method: { points: [0], intermediates: [], impliedByCorrectAnswer: true } }] }))).toBe('MARK_SCHEME_INVALID');
  });
});

// ---------------------------------------------------------------------------------------- synthetic IB re-render
const RUBRIC_POLICY = (answers: [string, string]): ResponseEvaluationPolicy & { markScheme: MachineMarkScheme } => ({
  kind: 'RUBRIC', acceptedRepresentations: ['INTEGER', 'DECIMAL', 'FRACTION'], decimalSeparators: ['.', ','], units: { accepted: [], required: false }, rounding: null, tolerance: null, symbolicEquivalence: false,
  partialCredit: [{ code: 'M1', kind: 'METHOD', marks: 1, answer: null }, { code: 'A1', kind: 'ACCURACY', marks: 1, answer: answers[0] }, { code: 'A1', kind: 'ACCURACY', marks: 1, answer: answers[1] }],
  markScheme: {
    v: 1, structure: 'ORDERED_PARTS', order: 'ASCENDING', targets: [
      { targetId: 'a', kind: 'NUMBER', value: answers[0], equivalents: [], answerPoints: [1], method: { points: [0], intermediates: ['(x-2)(x-3)=0'], impliedByCorrectAnswer: true } },
      { targetId: 'b', kind: 'NUMBER', value: answers[1], equivalents: [], answerPoints: [2], method: null },
    ],
  },
});
const quadratic = (over: Partial<CertifiedInstance> = {}, policy: ResponseEvaluationPolicy = RUBRIC_POLICY(['2', '3'])): CertifiedInstance => ({
  ...IB[0], instanceId: 'f'.repeat(64), marks: 3,
  learner: { ...IB[0].learner, prompt: 'Solve x² − 5x + 6 = 0. Show all necessary working. [3]', parts: [{ label: 'a', prompt: 'Write down the smaller root, showing your working.', marks: 2 }, { label: 'b', prompt: 'Write down the larger root.', marks: 1 }] },
  key: { ...IB[0].key, answers: ['2', '3'] },
  rubric: [{ code: 'M1', kind: 'METHOD', marks: 1, criterion: 'Factorises: (x − 2)(x − 3) = 0' }, { code: 'A1', kind: 'ACCURACY', marks: 1, criterion: 'x = 2' }, { code: 'A1', kind: 'ACCURACY', marks: 1, criterion: 'x = 3' }],
  responsePolicy: policy, ...over,
});

describe('IB_SCORING_PROJECTION: ordered roots, method marks from intermediates, answer marks', () => {
  const content = scoringBankContentOf(quadratic());
  it('projects to a multi-part Exam Core item whose marks are the certified rubric', () => {
    expect(content.parts?.map((p) => [p.id, p.marks, p.method?.marks ?? 0, p.math?.answers])).toEqual([['a', 1, 1, ['2']], ['b', 1, 0, ['3']]]);
    expect(content.scoringStrategy).toBe('MULTI_PART');
    const scoring = (content.certified as any).scoring;
    expect(scoring).toMatchObject({ contractVersion: 'exam-bank-projection-3', structure: 'ORDERED_PARTS', markSchemeDigest: sha256OfCanonicalJson(RUBRIC_POLICY(['2', '3']).markScheme), rubricDigest: sha256OfCanonicalJson(quadratic().rubric) });
    expect(scoring.pointMap.map((p: any) => p.target)).toEqual(['a.method', 'a.answer', 'b.answer']);
    expect(content.lineage.digest).toBe(IB[0].lineageHash);
  });
  it('scores working, answers, order and repeats exactly as the mark scheme says', async () => {
    const cases: Array<[Record<string, unknown>, number]> = [
      [{ a: { latex: '2', working: '(x-2)(x-3)=0' }, b: '3' }, 3], // M1 A1 A1
      [{ a: '2', b: '3' }, 3], // method implied by the correct answer (the certified scheme says so)
      [{ a: { latex: '5', working: '(x-2)(x-3)=0' }, b: '3' }, 2], // M1 from working, A1 for b
      [{ a: '3', b: '2' }, 0], // swapped: ordered parts, no alternative full credit
      [{ a: '2', b: '2' }, 2], // the same root twice earns one root, not two
      [{ a: '', b: '3' }, 1],
    ];
    for (const [answer, marks] of cases) {
      const g = await grade(content, JSON.stringify(answer));
      expect(g.status).toBe('ANSWERED');
      expect(g.evaluation.score).toBe(marks);
      expect(g.maxMarks).toBe(3);
      expect(g.reviewStatus).toBe('NONE');
      expect(g.evaluation.provenance).toMatchObject({ grader: 'exam-core:mark-scheme' });
    }
  });
  it('a scheme that says "no implied method" withholds M1 without working', async () => {
    const p = RUBRIC_POLICY(['2', '3']); p.markScheme.targets[0].method!.impliedByCorrectAnswer = false;
    const g = await grade(scoringBankContentOf(quadratic({}, p)), JSON.stringify({ a: '2', b: '3' }));
    expect(g.evaluation.score).toBe(2);
  });
  it('fails closed on every inconsistency with the certified content', () => {
    const p = () => RUBRIC_POLICY(['2', '3']);
    const bad = (mutate: (s: MachineMarkScheme, i: CertifiedInstance) => void) => { const policy = p(); const i = quadratic({}, policy); mutate(policy.markScheme, i); return scoringProjectionRefusal(i); };
    expect(bad((s) => { s.targets[0].method!.intermediates = ['(x-2)(x-4)=0']; })).toBe('INTERMEDIATE_NOT_SATISFIED_BY_THE_KEY');
    expect(bad((s) => { s.targets[0].method!.intermediates = ['(y-2)(y-3)=0']; })).toBe('INTERMEDIATE_NOT_VERIFIABLE');
    expect(bad((s) => { s.order = 'DESCENDING'; })).toBe('ORDER_NOT_SATISFIED');
    expect(bad((s) => { s.targets[1].value = '4'; })).toBe('TARGET_VALUE_NOT_THE_CERTIFIED_KEY');
    expect(bad((s) => { s.targets[1].answerPoints = [1]; })).toBe('RUBRIC_POINT_MAPPED_TWICE');
    expect(bad((s) => { s.targets[0].method = null; })).toBe('RUBRIC_POINT_NOT_MAPPED');
    expect(bad((s) => { s.targets[1].answerPoints = [0]; s.targets[0].method!.points = [2]; })).toBe('POINT_KIND_MISMATCH');
    expect(bad((_s, i) => { (i.learner.parts as any)[0].marks = 1; })).toBe('MARKS_INCONSISTENT');
    expect(bad((_s, i) => { (i as any).certificationState = 'REVIEW_REQUIRED'; })).toBe('NOT_CERTIFIED');
  });
});

describe('accuracy is carried, never weakened (QF evaluator and Exam Core agree)', () => {
  const numericInstance = (key: string, policy: Partial<ResponseEvaluationPolicy>): CertifiedInstance => ({
    ...PAA[0], key: { ...PAA[0].key, answers: [key] }, rubric: [{ code: 'A1', kind: 'ANSWER', marks: 1, criterion: key }], marks: 1,
    responsePolicy: { ...PAA[0].responsePolicy, ...policy },
  });
  const agree = async (i: CertifiedInstance, responses: string[]) => {
    const content = scoringBankContentOf(i);
    for (const r of responses) {
      const qf = evaluateResponse(i.responsePolicy, i.key.answers, r).correct;
      const core = (await grade(content, r)).fraction === 1;
      expect({ r, core }).toEqual({ r, core: qf });
    }
  };
  it('significant figures', async () => {
    const i = numericInstance('0.0668', { rounding: { kind: 'SIGNIFICANT_FIGURES', digits: 3 } });
    expect(scoringBankContentOf(i).math).toMatchObject({ significantFigures: 3, partialCredit: { significantFigures: 0 } });
    await agree(i, ['0.0668', '0.067', '0.06681', '0.0669']);
  });
  it('absolute tolerance', async () => {
    const i = numericInstance('12.5', { tolerance: { kind: 'ABSOLUTE', value: 0.05 } });
    expect(scoringBankContentOf(i).math).toMatchObject({ tolerance: { absolute: 0.05 } });
    await agree(i, ['12.5', '12.54', '12.6', '12']);
  });
  it('a required unit', async () => {
    const i = numericInstance('57.9', { units: { accepted: ['cm'], required: true } });
    expect(scoringBankContentOf(i).math).toMatchObject({ units: { expected: 'cm', required: true }, partialCredit: { unitMissing: 0, unitWrong: 0 } });
    await agree(i, ['57.9 cm', '57.9', '58 cm']);
  });
  it('rules the Exam Core cannot express are refused, not dropped', () => {
    expect(scoringProjectionRefusal(numericInstance('3', { decimalSeparators: ['.'] }))).toBe('SEPARATOR_RULE_NOT_PROJECTABLE');
    expect(scoringProjectionRefusal(numericInstance('3', { units: { accepted: ['cm', 'centimetres'], required: true } }))).toBe('UNIT_RULE_NOT_PROJECTABLE');
    expect(scoringProjectionRefusal(numericInstance('3', { acceptedRepresentations: ['FRACTION'] }))).toBe('REPRESENTATION_RULE_NOT_PROJECTABLE');
  });
  it('two key VALUES on one target are refused (projection 2 would accept either as full credit)', () => {
    const i = { ...numericInstance('1', {}), key: { ...PAA[0].key, answers: ['1', '2'] } };
    expect(projectionRefusal(i)).toBeNull();
    expect(scoringProjectionRefusal(i)).toBe('MULTIPLE_KEY_VALUES_WITHOUT_PART_STRUCTURE');
    // written forms of ONE value are fine
    expect(scoringProjectionRefusal({ ...i, key: { ...i.key, answers: ['0.5', '1/2'] } })).toBeNull();
  });
  it('intermediates are checked by substitution', () => {
    expect(intermediateSatisfiedBy('(x-1)(x-2)=0', [1, 2])).toBe(true);
    expect(intermediateSatisfiedBy('x^2-3x+2=0', [1, 2])).toBe(true);
    expect(intermediateSatisfiedBy('(x-1)(x-3)=0', [1, 2])).toBe(false);
    expect(intermediateSatisfiedBy('x+y=0', [1])).toBeNull();
  });
});
