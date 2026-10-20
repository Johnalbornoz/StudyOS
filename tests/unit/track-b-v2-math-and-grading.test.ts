/**
 * Exam V2 -- math equivalence engine + deterministic-first grading dispatcher.
 */
import { describe, it, expect } from 'vitest';
import { gradeMath, parseSafe, normalizeInfix } from '@/lib/exam-core/math/math-engine';
import { gradeExamItem, gradeMathTarget, methodEvidenced, parseMathAnswer } from '@/lib/exam-core/item-grading';
import { MathKeySchema, examItemFromApproved, toExamClientItem, findAnswerKeyLeak, validateExamItemStructure, type ExamItem } from '@/lib/exam-core/items';
import { V2_VERTICALS } from '@/lib/exam-core/verticals/v2';
import { parseExamVerticalConfig } from '@/lib/exam-core/vertical-config';
import type { AssessorRunner, RubricAssessment } from '@/lib/exam-core/assessment/double-assessor.service';

const K = (k: unknown) => MathKeySchema.parse(k);
const judge = (answer: string, key: unknown, lang = 'en') => gradeMath(answer, K(key), lang).judgment;

describe('V2 math engine -- equivalence, never string comparison, never eval', () => {
  it('algebraic forms', () => {
    expect(judge('x+x', { kind: 'EXPRESSION', answers: ['2x'] })).toBe('CORRECT');
    expect(judge('x^2e^{2x}(3+2x)', { kind: 'EXPRESSION', answers: ['3x^2 e^{2x}+2x^3 e^{2x}'] })).toBe('CORRECT');
    expect(judge('\\frac{n^2(n+1)^2}{4}', { kind: 'EXPRESSION', answers: ['(n(n+1)/2)^2'] })).toBe('CORRECT');
    expect(judge('3x^2e^{2x}', { kind: 'EXPRESSION', answers: ['3x^2 e^{2x}+2x^3 e^{2x}'] })).toBe('INCORRECT');
  });
  it('required forms are partial, not wrong', () => {
    expect(judge('x^2-6x+5', { kind: 'EXPRESSION', answers: ['(x-1)(x-5)'], requiredForm: 'FACTORED' })).toBe('PARTIALLY_CORRECT');
    expect(judge('\\frac{10}{28}', { kind: 'NUMBER', answers: ['5/14'], requiredForm: 'SIMPLIFIED_FRACTION' })).toBe('PARTIALLY_CORRECT');
    expect(judge('24000', { kind: 'NUMBER', answers: ['2.4*10^4'], requiredForm: 'SCIENTIFIC' })).toBe('PARTIALLY_CORRECT');
    expect(judge('2 2/25', { kind: 'NUMBER', answers: ['2 2/25'], requiredForm: 'EXACT' })).toBe('CORRECT');
  });
  it('equations, inequalities and intervals', () => {
    expect(judge('1=x', { kind: 'EQUATION', answers: ['x=1'] })).toBe('CORRECT');
    expect(judge('2x+y=2', { kind: 'EQUATION', answers: ['y=-2x+2'] })).toBe('CORRECT');
    expect(judge('1<x<5', { kind: 'INTERVAL', answers: ['(1,5)'] })).toBe('CORRECT');
    expect(judge('1 \\le x<5', { kind: 'INTERVAL', answers: ['(1,5)'] })).toBe('INCORRECT');
    expect(judge('x<1 or x>5', { kind: 'INTERVAL', answers: ['(-\\infty,1)\\cup(5,\\infty)'] })).toBe('CORRECT');
    expect(judge('k > 7,5', { kind: 'INTERVAL', answers: ['(7.5,\\infty)'] }, 'es')).toBe('CORRECT');
  });
  it('units, conversion and significant figures', () => {
    const cos = { kind: 'NUMBER', answers: ['5.78601 cm'], significantFigures: 3, tolerance: { absolute: 0.0005 }, units: { expected: 'cm', required: true, allowConversion: true } };
    expect(judge('5.79 cm', cos)).toBe('CORRECT');
    expect(judge('57.9 mm', cos)).toBe('CORRECT');
    expect(judge('5.79', cos)).toBe('PARTIALLY_CORRECT');
    expect(judge('5.786 cm', cos)).toBe('PARTIALLY_CORRECT');
    expect(judge('-0.3 m s^{-1}', { kind: 'NUMBER', answers: ['-0.3 m/s'], units: { expected: 'm/s', required: true } })).toBe('CORRECT');
    expect(judge('54 cm²', { kind: 'NUMBER', answers: ['54 cm^2'], units: { expected: 'cm^2', required: true } })).toBe('CORRECT');
  });
  it('decimal comma follows the Student language', () => {
    expect(judge('212,76', { kind: 'NUMBER', answers: ['212.76'], requiredForm: 'DECIMAL', decimalPlaces: 2 }, 'es')).toBe('CORRECT');
    expect(normalizeInfix('2,5', 'es')).toBe('2.5');
  });
  it('unsafe input is UNDECIDABLE, never evaluated', () => {
    expect(parseSafe('console.log(1)')).toBeNull();
    expect(parseSafe('import("fs")')).toBeNull();
    expect(judge('process.exit(1)', { kind: 'NUMBER', answers: ['4'] })).toBe('UNDECIDABLE');
  });
});

describe('V2 grading -- deterministic first', () => {
  const key = K({ kind: 'NUMBER', answers: ['4'] });
  const method = { marks: 2, criterion: 'M', intermediates: ['x(x-2)=8'], impliedByCorrectAnswer: false };
  it('parses math answers (plain and with working)', () => {
    expect(parseMathAnswer('4')).toEqual({ literal: '4', working: '' });
    expect(parseMathAnswer('{"latex":"4","working":"a"}')).toEqual({ literal: '4', working: 'a' });
    expect(parseMathAnswer(7)).toBeNull();
  });
  it('method marks from equivalent working; strict only for full marks', () => {
    const full = gradeMathTarget(key, method, 3, '{"latex":"4","working":"x^2-2x=8"}', 'en');
    expect('problem' in full).toBe(false);
    if (!('problem' in full)) expect([full.awarded, full.max, full.strictAwarded]).toEqual([5, 5, 5]);
    const methodOnly = gradeMathTarget(key, method, 3, '{"latex":"-2","working":"x(x-2)=8"}', 'en');
    if (!('problem' in methodOnly)) expect([methodOnly.awarded, methodOnly.strictAwarded]).toEqual([2, 0]);
    expect(methodEvidenced('nothing here', method as never, 'en')).toBe(false);
  });
  it('partial credit policy: unit missing keeps half, strict keeps nothing', () => {
    const k = K({ kind: 'NUMBER', answers: ['40 m'], units: { expected: 'm', required: true } });
    const r = gradeMathTarget(k, null, 2, '40', 'en');
    if (!('problem' in r)) expect([r.awarded, r.strictAwarded]).toEqual([1, 0]);
  });
  it('an undecidable answer is REVIEW_REQUIRED (never silently zero)', () => {
    const r = gradeMathTarget(key, null, 1, 'drop table', 'en');
    if (!('problem' in r)) expect(r.review).toBe(true);
  });
});

describe('V2 reference verticals -- every item valid, no answer key ever reaches the client', () => {
  const all = V2_VERTICALS.map((v) => {
    const p = parseExamVerticalConfig(v);
    if (!p.ok) throw new Error(`${v.key}: ${p.issues.join('; ')}`);
    return p.config;
  });
  for (const cfg of all) {
    it(`${cfg.key}: items valid, labelled FIXTURE, client payload clean`, () => {
      for (const it of cfg.items) {
        const item = examItemFromApproved({ id: '00000000-0000-0000-0000-000000000001', learning_objective_id: '00000000-0000-0000-0000-000000000002', content: it.content });
        expect(item, it.content.key).not.toBeNull();
        expect(validateExamItemStructure(item!).valid).toBe(true);
        expect(item!.exam.contentOrigin).toBe('FIXTURE');
        const client = toExamClientItem(item!, 0);
        expect(findAnswerKeyLeak(client), it.content.key).toBeNull();
        expect(JSON.stringify(client)).not.toMatch(/"answers"|"intermediates"|"descriptors"|"modelAnswer"|"distractorRationale"/);
      }
    });
  }
});

describe('V2 rubric grading -- double assessor through an injected runner', () => {
  const content = parseExamVerticalConfig(V2_VERTICALS.find((v) => v.key === 'v2.ib.visual-arts-sl')!);
  it('a portfolio item without a submission grader is INVALID, never guessed', async () => {
    if (!content.ok) throw new Error('config');
    const item = examItemFromApproved({ id: '00000000-0000-0000-0000-000000000001', learning_objective_id: '00000000-0000-0000-0000-000000000002', content: content.config.items[0].content }) as ExamItem;
    const g = await gradeExamItem(item, '{"submissionId":"00000000-0000-0000-0000-000000000003"}', 'en');
    expect(g.status).toBe('INVALID');
  });
  it('a rubric item is scored by A/B (agreement -> mean, strict -> lower)', async () => {
    const item = examItemFromApproved({
      id: '00000000-0000-0000-0000-000000000001',
      learning_objective_id: '00000000-0000-0000-0000-000000000002',
      content: {
        key: 't.rubric', contentStatus: 'DEV_CERT_FIXTURE', contentOrigin: 'FIXTURE', language: 'en', type: 'short_answer', answerFormat: 'text', question: 'Explain.', correctAnswer: 'model', explanation: 'x', difficulty: 3, marks: 8,
        rubric: { kind: 'ANALYTIC', criteria: [{ id: 'A', name: 'a', maxMarks: 4, descriptors: [{ marks: '0-4', descriptor: 'd' }] }, { id: 'B', name: 'b', maxMarks: 4, descriptors: [{ marks: '0-4', descriptor: 'd' }] }] },
      },
    }) as ExamItem;
    const mk = (role: RubricAssessment['role'], a: number, b: number): RubricAssessment => ({ role, criterionScores: [{ id: 'A', marks: a }, { id: 'B', marks: b }], total: a + b, maxTotal: 8, confidence: 0.9, rationale: '', evidence: [], model: 'test', promptId: null, promptVersion: null, executionId: null });
    const runner: AssessorRunner = async (role) => (role === 'ASSESSOR_A' ? mk(role, 4, 2) : mk(role, 3, 2));
    const g = await gradeExamItem(item, 'my answer', 'en', { assessorRunner: runner });
    expect(g.scoringStrategy).toBe('ANALYTIC_RUBRIC');
    expect(g.maxMarks).toBe(8);
    expect(g.evaluation.score).toBe(6); // round((4+3)/2)=4 (half up) + 2
    expect(g.strictFraction * 8).toBe(5); // min per criterion: 3 + 2
    expect(g.reviewStatus).toBe('NONE');
    expect(g.assessments).toHaveLength(2);
  });
});
