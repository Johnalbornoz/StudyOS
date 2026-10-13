/**
 * The math editor (MathLive) emits TeX shorthand for single-token arguments: `\frac83`, `\frac1{12}`, `\sqrt2`.
 * A correct answer typed as a fraction must be read, not sent to review. (Found in the Track B Preview E2E: a
 * correct `8/3` entered in the editor scored 0 as STUDENT_EXPRESSION_NOT_PARSED.)
 */
import { describe, it, expect } from 'vitest';
import { gradeMath, latexToInfix, normalizeInfix, parseSafe } from '@/lib/exam-core/math/math-engine';

const key = (answer: string) => ({ kind: 'NUMBER' as const, answers: [answer], requiredForm: 'ANY' as const, partialCredit: { formNotMet: 0, unitMissing: 0, unitWrong: 0, significantFigures: 0 } });

describe('TeX shorthand without braces', () => {
  it('a fraction with single-token arguments is the same fraction', () => {
    for (const [latex, value] of [['\\frac83', 8 / 3], ['\\frac{8}{3}', 8 / 3], ['\\frac1{12}', 1 / 12], ['\\frac{11}2', 5.5], ['\\dfrac34', 0.75], ['\\tfrac 1 2', 0.5], ['2\\frac12', 2.5]] as const) {
      const parsed = parseSafe(normalizeInfix(latexToInfix(latex)));
      expect(parsed, latex).not.toBeNull();
      expect(gradeMath(latex, key(String(value))).judgment, latex).toBe('CORRECT');
    }
  });

  it('the exact case of the E2E: the key 8/3 against what the editor sent', () => {
    expect(gradeMath('\\frac83', key('8/3')).judgment).toBe('CORRECT');
    expect(gradeMath('\\frac38', key('8/3')).judgment).toBe('INCORRECT');
    expect(gradeMath('\\frac35', key('3/5')).judgment).toBe('CORRECT');
    expect(gradeMath('0.6', key('3/5')).judgment).toBe('CORRECT');
  });

  it('braced and nested forms are read exactly as before', () => {
    expect(gradeMath('\\frac{\\sqrt{2}}{2}', key('sqrt(2)/2')).judgment).toBe('CORRECT');
    expect(gradeMath('\\sqrt2', key('sqrt(2)')).judgment).toBe('CORRECT');
    expect(gradeMath('\\sqrt[3]{8}', key('2')).judgment).toBe('CORRECT');
    expect(gradeMath('\\frac{10}{4}', key('5/2')).judgment).toBe('CORRECT');
  });
});
