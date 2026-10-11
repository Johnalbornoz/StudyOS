/**
 * QB-R2C -- normalisation of student-produced numeric responses (STUDYUS_POLICY, never "official"),
 * the stored NUMERIC key, and the small arithmetic evaluator the independent validators recompute keys with.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ANSWER_NORMALIZATION_POLICY, isResponseCorrect, normalizeStudentResponse, NOT_GRADABLE_REASONS, numericKeyValue, rationalToNumber, spanishFormOf, validateNumericAnswerKey, type NumericAnswerKey } from '@/lib/exam-core/question-bank/production/answer-normalization';
import { evaluateExpression, ExpressionError, nearlyEqual } from '@/lib/exam-core/question-bank/production/expression-evaluator';

const key = (value: string, over: Partial<NumericAnswerKey> = {}): NumericAnswerKey => ({ kind: 'NUMERIC', value, equivalentFormsAllowed: true, ...over });
const verdict = (k: NumericAnswerKey, given: string) => { const v = isResponseCorrect(k, given); return v.outcome === 'NOT_GRADABLE_AUTOMATICALLY' ? v.reason : v.outcome; };
const value = (raw: string, units: string[] = []) => { const r = normalizeStudentResponse(raw, units); return r.ok ? r.readings.map((x) => rationalToNumber(x.value)) : r.reason; };

describe('the policy is StudyUs\'s, and says so on every verdict', () => {
  it('is tagged STUDYUS_POLICY and never official', () => {
    expect(ANSWER_NORMALIZATION_POLICY).toEqual({ id: 'studyus-numeric-answer-normalization', version: '1', authority: 'STUDYUS_POLICY' });
    expect(isResponseCorrect(key('7'), '7').policy.authority).toBe('STUDYUS_POLICY');
    expect(isResponseCorrect(key('7'), 'siete').policy.authority).toBe('STUDYUS_POLICY');
    const src = readFileSync(join(__dirname, '..', '..', 'src/lib/exam-core/question-bank/production/answer-normalization.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(src).not.toMatch(/OFFICIAL/);
  });
});

describe('reading what was typed', () => {
  it('integers: leading zeros, a leading plus, an ASCII or unicode minus, surrounding whitespace', () => {
    expect(value('7')).toEqual([7]);
    expect(value('007')).toEqual([7]);
    expect(value('+7')).toEqual([7]);
    expect(value('-7')).toEqual([-7]);
    expect(value('−7')).toEqual([-7]);
    expect(value('  42 \n')).toEqual([42]);
    expect(value('0')).toEqual([0]);
    expect(value('-0')).toEqual([0]);
  });

  it('decimals: comma or point as the decimal separator; trailing zeros; a missing leading zero', () => {
    expect(value('0,5')).toEqual([0.5]);
    expect(value('0.5')).toEqual([0.5]);
    expect(value(',5')).toEqual([0.5]);
    expect(value('.5')).toEqual([0.5]);
    expect(value('2,50')).toEqual([2.5]);
    expect(value('2.500000')).toEqual([2.5]);
    expect(value('-3,25')).toEqual([-3.25]);
    expect(value('0,125')).toEqual([0.125]);
    expect(value('1234.567')).toEqual([1234.567]);
  });

  it('fractions: integers over a non-zero integer, reduced exactly', () => {
    expect(value('3/4')).toEqual([0.75]);
    expect(value('6 / 8')).toEqual([0.75]);
    expect(value('-1/2')).toEqual([-0.5]);
    expect(value('4/2')).toEqual([2]);
    expect(value('1/0')).toBe('ZERO_DENOMINATOR');
    expect(value('1,5/2')).toBe('UNSUPPORTED_FORM');
  });

  it('thousands separators are read only when the form leaves no doubt', () => {
    expect(value('1.234,5')).toEqual([1234.5]);
    expect(value('1,234.5')).toEqual([1234.5]);
    expect(value('1.234.567')).toEqual([1234567]);
    expect(value('1,234,567')).toEqual([1234567]);
    expect(value('12.34.567')).toBe('UNSUPPORTED_FORM');
    expect(value('1.2,3.4')).toBe('UNSUPPORTED_FORM');
    expect(value('1 234')).toBe('UNSUPPORTED_FORM');
    // one separator and exactly three digits: two readings, never a silent choice
    expect(value('1.234')).toEqual([1.234, 1234]);
    expect(value('1,234')).toEqual([1.234, 1234]);
    expect(value('12,345')).toEqual([12.345, 12345]);
  });

  it('what is not supported is named, never guessed', () => {
    expect(value('')).toBe('EMPTY_RESPONSE');
    expect(value('   ')).toBe('EMPTY_RESPONSE');
    expect(value('1 1/2')).toBe('MIXED_NUMBER_UNSUPPORTED');
    expect(value('1e3')).toBe('UNSUPPORTED_FORM');
    expect(value('2x10^3')).toBe('UNSUPPORTED_FORM');
    expect(value('siete')).toBe('UNSUPPORTED_FORM');
    expect(value('5.')).toBe('UNSUPPORTED_FORM');
    expect(value('--5')).toBe('UNSUPPORTED_FORM');
    expect(value('1/2/3')).toBe('UNSUPPORTED_FORM');
    expect(NOT_GRADABLE_REASONS).toContain('MIXED_NUMBER_UNSUPPORTED');
  });

  it('units and the percent sign are accepted only when listed', () => {
    expect(value('45 %')).toBe('UNIT_NOT_ACCEPTED');
    expect(value('45%', ['%'])).toEqual([45]);
    expect(value('12 cm')).toBe('UNIT_NOT_ACCEPTED');
    expect(value('12 cm', ['cm'])).toEqual([12]);
    expect(value('12 CM', ['cm'])).toEqual([12]);
    expect(value('12 m', ['cm'])).toBe('UNIT_NOT_ACCEPTED');
    expect(value('3/4 kg', ['kg'])).toEqual([0.75]);
  });
});

describe('the stored key', () => {
  it('a canonical value: integer, point decimal or fraction; nothing to interpret', () => {
    for (const v of ['15', '-15', '0.5', '1/2', '-3/4', '1234.5', '1.234']) expect(validateNumericAnswerKey(key(v)).ok, v).toBe(true);
    for (const v of ['0,5', '1.234,5', '1 1/2', '+5', '.5', '5.', '1/0', 'x', '', '1e3', '50%']) expect(validateNumericAnswerKey(key(v)).ok, v).toBe(false);
    expect(rationalToNumber(numericKeyValue(key('1.234')).value)).toBe(1.234);
    expect(spanishFormOf(key('2.5'))).toBe('2,5');
  });

  it('refuses a malformed key: unknown field, both precision rules, duplicate or numeric units, a rounded fraction-only key', () => {
    const issues = (k: unknown) => { const r = validateNumericAnswerKey(k); return r.ok ? [] : r.issues; };
    expect(issues({ kind: 'NUMERIC', value: '5' }).length).toBeGreaterThan(0);
    expect(issues({ ...key('5'), official: true }).length).toBeGreaterThan(0);
    expect(issues(key('5', { tolerance: '0.1', decimalPlaces: 1 }))).toEqual(['tolerance: TOLERANCE_AND_DECIMAL_PLACES_ARE_EXCLUSIVE']);
    expect(issues(key('5', { tolerance: '-0.1' })).length).toBeGreaterThan(0);
    expect(issues(key('5', { tolerance: '1e-3' })).length).toBeGreaterThan(0);
    expect(issues(key('5', { decimalPlaces: 9 })).length).toBeGreaterThan(0);
    expect(issues(key('5', { acceptedUnits: ['cm', 'CM'] }))).toEqual(['acceptedUnits: UNIT_LISTED_TWICE']);
    expect(issues(key('5', { acceptedUnits: ['m2'] }))).toEqual(['acceptedUnits: UNIT_CONTAINS_A_DIGIT']);
    expect(issues(key('5', { acceptedUnits: [] })).length).toBeGreaterThan(0);
    expect(issues(key('1/3', { equivalentFormsAllowed: false, decimalPlaces: 2 }))).toEqual(['decimalPlaces: FRACTION_ONLY_KEY_CANNOT_BE_ROUNDED']);
    expect(verdict({ kind: 'NUMERIC', value: 'abc', equivalentFormsAllowed: true }, '5')).toBe('KEY_NOT_WELL_FORMED');
  });
});

describe('is the response the keyed number?', () => {
  it('equivalent forms when the key allows them: 1/2 = 2/4 = 0,5 = 0.50', () => {
    const k = key('1/2');
    for (const g of ['1/2', '2/4', '6/12', '0,5', '0.5', '0.50', ',5', ' 0,500 ']) expect(verdict(k, g), g).toBe('CORRECT');
    for (const g of ['1/3', '0,51', '2', '-1/2', '5']) expect(verdict(k, g), g).toBe('INCORRECT');
  });

  it('when equivalence is not allowed the response must be in the key\'s form', () => {
    const fraction = key('1/2', { equivalentFormsAllowed: false });
    expect(verdict(fraction, '1/2')).toBe('CORRECT');
    expect(verdict(fraction, '2/4')).toBe('INCORRECT');
    expect(verdict(fraction, '0,5')).toBe('INCORRECT');
    const decimal = key('0.5', { equivalentFormsAllowed: false });
    expect(verdict(decimal, '0,50')).toBe('CORRECT');
    expect(verdict(decimal, '1/2')).toBe('INCORRECT');
    const integer = key('15', { equivalentFormsAllowed: false });
    expect(verdict(integer, '015')).toBe('CORRECT');
    expect(verdict(integer, '15,0')).toBe('CORRECT');
    expect(verdict(integer, '30/2')).toBe('INCORRECT');
  });

  it('exact by default; a tolerance or a number of decimal places only when the key declares it', () => {
    expect(verdict(key('3.14'), '3,14')).toBe('CORRECT');
    expect(verdict(key('3.14'), '3,141')).toBe('INCORRECT');
    expect(verdict(key('3.14'), '3,1')).toBe('INCORRECT');
    const tolerant = key('3.14', { tolerance: '0.01' });
    expect(verdict(tolerant, '3,15')).toBe('CORRECT');
    expect(verdict(tolerant, '3,13')).toBe('CORRECT');
    expect(verdict(tolerant, '3,151')).toBe('INCORRECT');
    expect(verdict(tolerant, '22/7')).toBe('CORRECT');
    // "round to two decimal places": 2/3 -> 0.67, and nothing else
    const rounded = key('2/3', { decimalPlaces: 2 });
    expect(verdict(rounded, '0,67')).toBe('CORRECT');
    expect(verdict(rounded, '0.67')).toBe('CORRECT');
    expect(verdict(rounded, '0,66')).toBe('INCORRECT');
    expect(verdict(rounded, '0,667')).toBe('INCORRECT');
    expect(verdict(rounded, '2/3')).toBe('INCORRECT');
    expect(verdict(key('2.5', { decimalPlaces: 0 }), '3')).toBe('CORRECT');
    expect(verdict(key('-2.5', { decimalPlaces: 0 }), '-3')).toBe('CORRECT');
  });

  it('an ambiguous separator is graded both ways: a verdict only when both readings agree', () => {
    // 1,234 is 1.234 or 1234: against 1.234 the readings disagree -> not gradable; against 7 both are wrong -> incorrect
    expect(verdict(key('1.234'), '1,234')).toBe('AMBIGUOUS_SEPARATOR');
    expect(verdict(key('1234'), '1.234')).toBe('AMBIGUOUS_SEPARATOR');
    expect(verdict(key('7'), '1,234')).toBe('INCORRECT');
    expect(verdict(key('1234'), '1234')).toBe('CORRECT');
    expect(verdict(key('1234.5'), '1.234,5')).toBe('CORRECT');
  });

  it('units: not accepted unless the key lists them; an unlisted unit is never marked wrong by guess', () => {
    expect(verdict(key('45'), '45 %')).toBe('UNIT_NOT_ACCEPTED');
    expect(verdict(key('45', { acceptedUnits: ['%'] }), '45 %')).toBe('CORRECT');
    expect(verdict(key('45', { acceptedUnits: ['%'] }), '45')).toBe('CORRECT');
    expect(verdict(key('45', { acceptedUnits: ['%'] }), '46%')).toBe('INCORRECT');
    expect(verdict(key('12', { acceptedUnits: ['cm'] }), '12 m')).toBe('UNIT_NOT_ACCEPTED');
  });

  it('unsupported forms come back as not gradable automatically, with the reason', () => {
    expect(isResponseCorrect(key('1.5'), '1 1/2')).toMatchObject({ outcome: 'NOT_GRADABLE_AUTOMATICALLY', reason: 'MIXED_NUMBER_UNSUPPORTED' });
    expect(isResponseCorrect(key('1000'), '1e3')).toMatchObject({ outcome: 'NOT_GRADABLE_AUTOMATICALLY', reason: 'UNSUPPORTED_FORM' });
    expect(isResponseCorrect(key('5'), '')).toMatchObject({ outcome: 'NOT_GRADABLE_AUTOMATICALLY', reason: 'EMPTY_RESPONSE' });
    expect(isResponseCorrect(key('5'), 'cinco')).toMatchObject({ outcome: 'NOT_GRADABLE_AUTOMATICALLY', reason: 'UNSUPPORTED_FORM' });
  });

  it('exact arithmetic: no floating-point surprise on thirds or on long decimals', () => {
    expect(verdict(key('1/3'), '2/6')).toBe('CORRECT');
    expect(verdict(key('0.1'), '1/10')).toBe('CORRECT');
    expect(verdict(key('0.3'), '0,30000000000000004')).toBe('INCORRECT');
    expect(verdict(key('123456789012345678901234567890'), '123456789012345678901234567890')).toBe('CORRECT');
    expect(verdict(key('123456789012345678901234567890'), '123456789012345678901234567891')).toBe('INCORRECT');
  });
});

describe('the arithmetic evaluator (no eval)', () => {
  it('+ - * / with precedence, parentheses, powers, unary minus, sqrt, fractions', () => {
    expect(evaluateExpression('2 + 3 * 4')).toBe(14);
    expect(evaluateExpression('(2 + 3) * 4')).toBe(20);
    expect(evaluateExpression('80 * (1 - 15 / 100)')).toBe(68);
    expect(evaluateExpression('2^3^2')).toBe(512);
    expect(evaluateExpression('-2^2')).toBe(-4);
    expect(evaluateExpression('(-2)^2')).toBe(4);
    expect(evaluateExpression('2^-1')).toBe(0.5);
    expect(evaluateExpression('sqrt(25^2 - 24^2) + 24 + 25')).toBe(56);
    expect(evaluateExpression('√(9) × 2 ÷ 3')).toBe(2);
    expect(evaluateExpression('7 − 10')).toBe(-3);
    expect(nearlyEqual(evaluateExpression('1/3 + 1/6'), 0.5)).toBe(true);
    expect(nearlyEqual(evaluateExpression('0.1 + 0.2'), 0.3)).toBe(true);
    expect(evaluateExpression('.5 * 4')).toBe(2);
  });

  it('refuses everything else by name: identifiers, a comma, unbalanced parentheses, division by zero', () => {
    const code = (src: string) => { try { evaluateExpression(src); return 'NO_ERROR'; } catch (e) { return e instanceof ExpressionError ? e.code : 'OTHER'; } };
    expect(code('')).toBe('EMPTY_EXPRESSION');
    expect(code('x + 1')).toBe('UNEXPECTED_CHARACTER');
    expect(code('process.exit(1)')).toBe('UNEXPECTED_CHARACTER');
    expect(code('2,5 + 1')).toBe('UNEXPECTED_CHARACTER');
    expect(code('(2 + 3')).toBe('UNBALANCED_PARENTHESES');
    expect(code('2 + 3)')).toBe('UNBALANCED_PARENTHESES');
    expect(code('2 +')).toBe('UNEXPECTED_TOKEN');
    expect(code('2 3')).toBe('UNEXPECTED_TOKEN');
    expect(code('1 / 0')).toBe('DIVISION_BY_ZERO');
    expect(code('1 / (2 - 2)')).toBe('DIVISION_BY_ZERO');
    expect(code('sqrt(-4)')).toBe('SQRT_OF_NEGATIVE');
    expect(code('sqrt 4')).toBe('UNEXPECTED_TOKEN');
    expect(code('10^400')).toBe('NOT_FINITE');
    expect(code('1+'.repeat(300) + '1')).toBe('EXPRESSION_TOO_LONG');
    const src = readFileSync(join(__dirname, '..', '..', 'src/lib/exam-core/question-bank/production/expression-evaluator.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(src).not.toMatch(/\beval\(|new Function|Function\(/);
  });
});
