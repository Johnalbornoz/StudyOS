/**
 * FORM_AWARE_METHOD_MARK: a method mark for the governed method in the governed form -- never for copying the question.
 */
import { describe, expect, it } from 'vitest';
import { ACCEPTED_FORMS, criterionDigestOf, evaluateMethodRule, REJECTED_TRIVIAL_FORMS, REQUIRED_FORM, toAscii, type MethodRule } from '@/lib/assessment-scoring/method-rules';

const solve = (given: string, standardForm: MethodRule['standardForm'], roots: number[]): MethodRule => ({
  ruleType: 'QUADRATIC_SOLUTION_METHOD', version: 1, givenEquation: given, standardForm, roots, marks: 1,
  provenance: { rubricIndex: 0, rubricCode: 'M1', criterionDigest: criterionDigestOf('Applies a valid method to the equation in standard form') },
});
const ruleA = solve('x^2 - 3x + 2 = 0', { a: 1, b: -3, c: 2 }, [1, 2]);
const m = (rule: MethodRule, working: string) => evaluateMethodRule(rule, working);

describe('QUADRATIC_SOLUTION_METHOD (x^2 - 3x + 2 = 0, roots 1 and 2)', () => {
  it('the rule states its type, version, required form, accepted equivalences, rejected trivial forms, mark and provenance', () => {
    expect(REQUIRED_FORM.QUADRATIC_SOLUTION_METHOD).toMatch(/substituted quadratic formula/);
    expect(ACCEPTED_FORMS.QUADRATIC_SOLUTION_METHOD).toEqual(['QUADRATIC_FORMULA_SUBSTITUTION', 'FACTORED_LINEAR_FACTORS', 'COMPLETED_SQUARE']);
    expect(REJECTED_TRIVIAL_FORMS.QUADRATIC_SOLUTION_METHOD).toContain('RESTATES_THE_GIVEN_EQUATION');
    const r = m(ruleA, '(x-1)(x-2)=0');
    expect(r).toMatchObject({ ruleType: 'QUADRATIC_SOLUTION_METHOD', version: 1, marks: 1 });
    expect(r.ruleDigest).toMatch(/^[a-f0-9]{64}$/);
  });
  it('copied original equation -> M1 = 0', () => {
    for (const w of ['x^2 - 3x + 2 = 0', 'x² − 3x + 2 = 0', 'x^{2}-3x+2=0']) expect(m(ruleA, w)).toMatchObject({ awarded: 0, lines: [{ rejected: 'RESTATES_THE_GIVEN_EQUATION' }] });
  });
  it('valid quadratic-formula line -> M1 = 1 (plain, LaTeX, unsimplified, simplified)', () => {
    for (const w of ['x = (3 ± sqrt(9 - 8))/2', 'x=\\frac{3\\pm\\sqrt{9-8}}{2}', 'x = (-(-3) ± √((-3)^2 - 4·1·2))/(2·1)', 'x = (3 ± 1)/2', 'x=\\frac{-\\left(-3\\right)\\pm\\sqrt{1}}{2\\cdot1}']) {
      expect(m(ruleA, w), w).toMatchObject({ awarded: 1, evidence: { form: 'QUADRATIC_FORMULA_SUBSTITUTION' } });
    }
  });
  it('the other governed methods of the certified criterion -> M1 = 1', () => {
    expect(m(ruleA, '(x-1)(x-2)=0').evidence?.form).toBe('FACTORED_LINEAR_FACTORS');
    expect(m(ruleA, '\\left(x-2\\right)\\left(x-1\\right)=0').evidence?.form).toBe('FACTORED_LINEAR_FACTORS');
    expect(m(ruleA, '(x - 1.5)^2 = 0.25').evidence?.form).toBe('COMPLETED_SQUARE');
  });
  it('algebraically equivalent setup that is not a method form -> 0 (the governed result)', () => {
    for (const w of ['x^2 = 3x - 2', '2x^2 - 6x + 4 = 0', 'x^2 + 2 = 3x']) expect(m(ruleA, w), w).toMatchObject({ awarded: 0, lines: [{ rejected: 'EQUIVALENT_BUT_NOT_A_METHOD_FORM' }] });
  });
  it('wrong substitution / wrong factors / generic formula / final answers only -> 0', () => {
    expect(m(ruleA, 'x = (3 ± sqrt(9 + 8))/2').lines[0].rejected).toBe('WRONG_SUBSTITUTION');
    expect(m(ruleA, 'x = (-3 ± sqrt(1))/2').lines[0].rejected).toBe('WRONG_SUBSTITUTION');
    expect(m(ruleA, '(x-1)(x-3)=0').lines[0].rejected).toBe('WRONG_FACTORS');
    expect(m(ruleA, 'x = (-b ± sqrt(b^2-4ac))/(2a)').lines[0].rejected).toBe('GENERIC_FORMULA_NOT_SUBSTITUTED');
    expect(m(ruleA, 'x = 1; x = 2')).toMatchObject({ awarded: 0, lines: [{ rejected: 'FINAL_ANSWER_ONLY' }, { rejected: 'FINAL_ANSWER_ONLY' }] });
  });
  it('nonsense -> 0', () => {
    for (const w of ['hello', 'x = = 2', '(((', 'y = 3x', '']) expect(m(ruleA, w).awarded, w).toBe(0);
  });
  it('one valid line among others is enough; the evidence line is recorded', () => {
    const r = m(ruleA, 'x^2 - 3x + 2 = 0\n(x-1)(x-2) = 0\nx = 1 or 2');
    expect(r.awarded).toBe(1);
    expect(r.evidence).toEqual({ line: '(x-1)(x-2) = 0', form: 'FACTORED_LINEAR_FACTORS', rejected: null });
  });
  it('a negative leading coefficient and a repeated root', () => {
    const r2 = solve('-x^2 + 5x - 6 = 0', { a: -1, b: 5, c: -6 }, [2, 3]);
    expect(m(r2, 'x = (-5 ± sqrt(25 - 24))/(-2)').awarded).toBe(1);
    expect(m(r2, '-(x-2)(x-3)=0').awarded).toBe(1);
    const r3 = solve('x^2 - 4x + 4 = 0', { a: 1, b: -4, c: 4 }, [2]);
    expect(m(r3, '(x-2)(x-2)=0').awarded).toBe(1);
    expect(m(r3, '(x-2)^2=0').awarded).toBe(1);
  });
});

describe('REARRANGE_TO_STANDARD_FORM (x^2 = 5x + 6  ->  x^2 - 5x - 6 = 0)', () => {
  const rule: MethodRule = { ...solve('x^2 = 5x + 6', { a: 1, b: -5, c: -6 }, [-1, 6]), ruleType: 'REARRANGE_TO_STANDARD_FORM' };
  it('accepts the expanded standard form, rejects the restatement and non-standard forms', () => {
    expect(m(rule, 'x^2 - 5x - 6 = 0')).toMatchObject({ awarded: 1, evidence: { form: 'EXPANDED_STANDARD_FORM' } });
    expect(m(rule, '-x^2 + 5x + 6 = 0').awarded).toBe(1);
    expect(m(rule, 'x^2 = 5x + 6').lines[0].rejected).toBe('RESTATES_THE_GIVEN_EQUATION');
    expect(m(rule, 'x^2 - 5x = 6').lines[0].rejected).toBe('NOT_EQUAL_TO_ZERO');
    expect(m(rule, '(x-6)(x+1) = 0').lines[0].rejected).toBe('NOT_EXPANDED');
    expect(m(rule, 'x^2 - 5x + 6 = 0').lines[0].rejected).toBe('NOT_THIS_EQUATION');
  });
});

it('LaTeX normalisation', () => {
  expect(toAscii('x=\\frac{3\\pm\\sqrt{9-8}}{2}')).toBe('x=((3±sqrt(9-8))/(2))');
});
