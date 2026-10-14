/**
 * QF V5.1 -- the response evaluation policy of a RENDERED ITEM (pure, no IO).
 *
 * How a response is judged belongs to the instance and its rubric, never to the construct core: the same construct
 * is answered with one stated root in one system and with full working in another. A rendered instance carries its
 * policy, and `evaluateResponse` applies it deterministically.
 *
 * What a policy can say:
 *   exact answer                 the response must be the keyed text after trivial normalisation
 *   equivalent forms             3/4, 0.75 and 0,75 are one value; an expression equal at every sample point is equal
 *   decimal comma / point        both accepted, or only one
 *   units                        accepted unit strings; whether a unit is required
 *   rounding                     decimal places or significant figures the response must be given to
 *   tolerance                    absolute or relative window around the keyed value
 *   symbolic equivalence         algebraic expressions compared by value, not by spelling
 *   accepted representations     which written forms count (integer, decimal, fraction, expression)
 *   partial credit               marks per rubric point; awarding them from free working is a marker's act
 *
 * Nothing here calls a model. A constructed response with working is NOT auto-marked: the policy carries its rubric
 * and `evaluateResponse` scores only what is deterministic (the final answers), saying so.
 */

import { canonicalKeyValue, evaluateCanonicalNumeric, parseCanonicalNumber, type CanonicalVerdictCode } from '@/lib/assessment-scoring/canonical-response';

export const RESPONSE_POLICY_KINDS = ['OPTION', 'EXACT_TEXT', 'NUMERIC', 'SYMBOLIC', 'RUBRIC'] as const;
export type ResponsePolicyKind = (typeof RESPONSE_POLICY_KINDS)[number];
export const RESPONSE_REPRESENTATIONS = ['INTEGER', 'DECIMAL', 'FRACTION', 'EXPRESSION'] as const;
export type ResponseRepresentation = (typeof RESPONSE_REPRESENTATIONS)[number];

export interface ResponseEvaluationPolicy {
  kind: ResponsePolicyKind;
  /** Written forms that count. A correct value in a form that is not listed is NOT_IN_AN_ACCEPTED_FORM, not wrong. */
  acceptedRepresentations: readonly ResponseRepresentation[];
  decimalSeparators: readonly ('.' | ',')[];
  /** Characters that may group thousands. Absent = none: nothing is ever read as a thousands separator by guess. */
  groupingSeparators?: readonly ('.' | ',' | ' ' | "'")[];
  units: { accepted: readonly string[]; required: boolean };
  /** The precision the response must be written to; null = any. */
  rounding: { kind: 'DECIMAL_PLACES' | 'SIGNIFICANT_FIGURES'; digits: number } | null;
  /** Window around the keyed value; null = exact. */
  tolerance: { kind: 'ABSOLUTE' | 'RELATIVE'; value: number } | null;
  symbolicEquivalence: boolean;
  /** For RUBRIC: the marks each point carries. Final-answer points are checked here; method points need a marker. */
  partialCredit: readonly { code: string; kind: string; marks: number; answer: string | null }[];
}

export const EXACT_NUMERIC_POLICY: ResponseEvaluationPolicy = { kind: 'NUMERIC', acceptedRepresentations: ['INTEGER', 'DECIMAL', 'FRACTION'], decimalSeparators: ['.', ','], units: { accepted: [], required: false }, rounding: null, tolerance: null, symbolicEquivalence: false, partialCredit: [] };
export const OPTION_POLICY: ResponseEvaluationPolicy = { kind: 'OPTION', acceptedRepresentations: [], decimalSeparators: [], units: { accepted: [], required: false }, rounding: null, tolerance: null, symbolicEquivalence: false, partialCredit: [] };

export type ResponseVerdictCode = CanonicalVerdictCode | 'NOT_COMPARABLE' | 'NEEDS_A_MARKER';
export interface ResponseVerdict { code: ResponseVerdictCode; correct: boolean; marks: number | null; detail: string }
const verdict = (code: ResponseVerdictCode, detail = '', marks: number | null = null): ResponseVerdict => ({ code, correct: code === 'CORRECT', marks, detail });

// ------------------------------------------------------------------------------------------------ numbers
interface ParsedNumber { value: number; representation: ResponseRepresentation; separator: '.' | ',' | null; decimals: number; significant: number; unit: string | null }
type ParseOutcome = { ok: true; n: ParsedNumber } | { ok: false; code: ResponseVerdictCode; detail: string };

/**
 * One written number, optionally followed by a unit, read by THE canonical contract
 * (assessment-scoring/canonical-response.ts) with both decimal separators and NO grouping: nothing is guessed.
 */
export function parseWrittenNumber(raw: string): ParseOutcome {
  const r = parseCanonicalNumber(raw, { acceptedRepresentations: ['INTEGER', 'DECIMAL', 'FRACTION'], decimalSeparators: ['.', ','], units: { accepted: [], required: false }, rounding: null, tolerance: null });
  if (!r.ok) return r;
  return { ok: true, n: { value: r.n.value, representation: r.n.representation, separator: r.n.decimalSeparator, decimals: r.n.decimals, significant: r.n.significant, unit: r.n.unit } };
}

// ----------------------------------------------------------------------------------------------- expressions
/** Value of a school-algebra expression at one point. null when it is not an expression this evaluator reads. */
export function valueAt(expression: string, point: Readonly<Record<string, number>>): number | null {
  let s = expression.replace(/\s+/g, '').replace(/[−–]/g, '-').replace(/[×·]/g, '*').replace(/÷/g, '/').replace(/²/g, '^2').replace(/³/g, '^3').replace(/,/g, '.').replace(/sqrt/g, '√');
  if (!s || /[=<>]/.test(s)) return null;
  s = s.replace(/[a-zA-Z]/g, (v) => (v in point ? `(${point[v]})` : '?'));
  if (s.includes('?')) return null;
  s = s.replace(/(\d|\))(?=\(|√)/g, '$1*');
  let i = 0;
  const peek = () => s[i];
  const atom = (): number => {
    if (peek() === '(') { i += 1; const v = sum(); if (peek() !== ')') throw new Error('paren'); i += 1; return v; }
    if (peek() === '√') { i += 1; return Math.sqrt(atom()); }
    const m = /^\d+(?:\.\d+)?/.exec(s.slice(i));
    if (!m) throw new Error('token');
    i += m[0].length;
    return Number(m[0]);
  };
  const power = (): number => { const base = atom(); if (peek() === '^') { i += 1; return base ** unary(); } return base; };
  const unary = (): number => { if (peek() === '-') { i += 1; return -unary(); } if (peek() === '+') { i += 1; return unary(); } return power(); };
  const product = (): number => { let v = unary(); while (peek() === '*' || peek() === '/') { const op = s[i]; i += 1; const r = unary(); v = op === '*' ? v * r : v / r; } return v; };
  const sum = (): number => { let v = product(); while (peek() === '+' || peek() === '-') { const op = s[i]; i += 1; const r = product(); v = op === '+' ? v + r : v - r; } return v; };
  try { const v = sum(); return i === s.length && Number.isFinite(v) ? v : null; } catch { return null; }
}
const SAMPLES = [0.37, 1.91, -1.13, 2.53, -2.71];
const close = (a: number, b: number, eps = 1e-9): boolean => Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));
/** true / false when both sides are readable at three sample points or more; null when they are not comparable here. */
export function symbolicallyEqual(a: string, b: string): boolean | null {
  const variables = [...new Set(`${a}${b}`.replace(/sqrt/g, '').split('').filter((c) => /[a-zA-Z]/.test(c)))];
  if (variables.length > 3) return null;
  let compared = 0;
  for (let k = 0; k < SAMPLES.length; k += 1) {
    const point = Object.fromEntries(variables.map((v, j) => [v, SAMPLES[(k + 2 * j) % SAMPLES.length] + j * 0.11]));
    const x = valueAt(a, point); const y = valueAt(b, point);
    if (x === null || y === null) continue;
    compared += 1;
    if (!close(x, y, 1e-7)) return false;
  }
  return compared >= (variables.length ? 3 : 1) ? true : null;
}

// ------------------------------------------------------------------------------------------------ evaluation
function evaluateNumeric(policy: ResponseEvaluationPolicy, key: string, response: string): ResponseVerdict {
  // THE canonical contract judges every number. Only an expression response (when the policy accepts expressions)
  // or an expression key are read by the expression evaluator first.
  const parsed = parseCanonicalNumber(response, policy);
  if (!parsed.ok && parsed.code === 'NOT_A_NUMBER' && policy.acceptedRepresentations.includes('EXPRESSION')) { const eq = symbolicallyEqual(key, response); return eq === null ? verdict('NOT_COMPARABLE', response) : eq ? verdict('CORRECT') : verdict('INCORRECT'); }
  const keyValue = canonicalKeyValue(key) ?? valueAt(key, {});
  if (keyValue === null) return verdict('NOT_COMPARABLE', `the key "${key}" is not a number`);
  const r = evaluateCanonicalNumeric(policy, String(keyValue), response);
  return verdict(r.code, r.detail);
}

const fold = (s: string): string => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * One response against one key under the instance's policy. `key` is the option label, the value, the expression or
 * the text. For RUBRIC, `response` is the list of final answers the learner gave: each final-answer point that is
 * matched earns its marks, and the result says a marker is needed for the method points.
 */
export function evaluateResponse(policy: ResponseEvaluationPolicy, key: string | readonly string[], response: string | readonly string[]): ResponseVerdict {
  const keys = typeof key === 'string' ? [key] : [...key];
  const responses = typeof response === 'string' ? [response] : [...response];
  if (responses.every((r) => !r.trim())) return verdict('EMPTY');
  if (policy.kind === 'OPTION') return (/^\(?([A-Fa-f])[).:]?$/.exec(responses[0].trim())?.[1] ?? '').toUpperCase() === keys[0].toUpperCase() ? verdict('CORRECT') : verdict('INCORRECT');
  if (policy.kind === 'EXACT_TEXT') return fold(responses[0]) === fold(keys[0]) ? verdict('CORRECT') : verdict('INCORRECT');
  if (policy.kind === 'NUMERIC') return evaluateNumeric(policy, keys[0], responses[0]);
  if (policy.kind === 'SYMBOLIC') {
    if (!policy.symbolicEquivalence) return fold(responses[0]) === fold(keys[0]) ? verdict('CORRECT') : verdict('INCORRECT');
    const eq = symbolicallyEqual(keys[0], responses[0]);
    return eq === null ? verdict('NOT_COMPARABLE', responses[0]) : eq ? verdict('CORRECT') : verdict('INCORRECT');
  }
  // RUBRIC: final-answer points only; each given answer may satisfy one point
  const numeric: ResponseEvaluationPolicy = { ...policy, kind: 'NUMERIC' };
  const remaining = [...responses];
  let earned = 0;
  for (const point of policy.partialCredit.filter((p) => p.answer !== null)) {
    const hit = remaining.findIndex((r) => evaluateNumeric(numeric, point.answer!, r).correct);
    if (hit >= 0) { earned += point.marks; remaining.splice(hit, 1); }
  }
  const methodMarks = policy.partialCredit.filter((p) => p.answer === null).reduce((n, p) => n + p.marks, 0);
  return { code: 'NEEDS_A_MARKER', correct: false, marks: earned, detail: `${earned} mark(s) for final answers; ${methodMarks} method mark(s) are awarded by a marker from the working` };
}
