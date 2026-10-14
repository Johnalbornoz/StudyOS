/**
 * THE canonical response contract for numeric answers of governed exam content (pure, no IO).
 *
 * One parser, one evaluator, used by every stage that judges a numeric answer:
 *   Question Factory candidate validation   assessment-instance/response-evaluation.ts (`evaluateResponse`, NUMERIC)
 *   certification                           assessment-instance/v52/instance-certification.ts (through `evaluateResponse`)
 *   Exam Bank projection                    exam-bank/scoring-projection.ts (embeds this contract in the bank version)
 *   Exam Core runtime scoring               exam-core/item-grading.ts (any math target that carries `responseContract`)
 *
 * NOTHING IS GUESSED. The meaning of every character comes from the POLICY, never from the Student's language or from
 * the shape of the number:
 *   decimal separators    `decimalSeparators` -- the characters that may mark the decimal point.
 *   grouping separators   `groupingSeparators` -- the characters that may group thousands. DEFAULT NONE. A character
 *                         cannot be both. With no grouping allowed, "2.625" is two point six two five when '.' is a
 *                         decimal separator, and malformed when it is not: never "two thousand six hundred twenty-five".
 *                         Grouping, when allowed, is only in the integer part, in groups of exactly three.
 *   fractions             integer / integer (no separators), only when FRACTION is an accepted representation.
 *   equivalent forms      INTEGER, DECIMAL and FRACTION are written forms of one value; a form that is not accepted is
 *                         NOT_IN_AN_ACCEPTED_FORM (not wrong, not right). Scientific notation is not a form here.
 *   significant figures   `rounding` constrains a DECIMAL response only: it must be written to exactly that precision,
 *   / decimal places      and is then compared within half a unit of its last place. INTEGER / FRACTION responses are
 *                         compared exactly (unless a tolerance is stated).
 *   tolerance             absolute or relative window, when stated.
 *   units                 `units.accepted` (case-insensitive, exact strings); `units.required`.
 *   ordered parts         `evaluateOrderedParts`: part k is judged against key k, each on its own -- never as
 *                         alternatives of each other.
 * Partial credit is not decided here: a verdict is CORRECT or it is not.
 */

export const CANONICAL_RESPONSE_CONTRACT_VERSION = 'canonical-response-1';

export type NumericRepresentation = 'INTEGER' | 'DECIMAL' | 'FRACTION';
export type DecimalSeparator = '.' | ',';
export type GroupingSeparator = '.' | ',' | ' ' | "'";

export interface CanonicalNumericPolicy {
  acceptedRepresentations: readonly string[];
  decimalSeparators: readonly DecimalSeparator[];
  /** Absent or empty = no grouping separator is allowed. */
  groupingSeparators?: readonly GroupingSeparator[];
  units: { accepted: readonly string[]; required: boolean };
  rounding: { kind: 'DECIMAL_PLACES' | 'SIGNIFICANT_FIGURES'; digits: number } | null;
  tolerance: { kind: 'ABSOLUTE' | 'RELATIVE'; value: number } | null;
}

export type CanonicalVerdictCode =
  | 'CORRECT' | 'INCORRECT' | 'EMPTY' | 'NOT_A_NUMBER' | 'MALFORMED_NUMBER' | 'NOT_IN_AN_ACCEPTED_FORM' | 'DECIMAL_SEPARATOR_NOT_ACCEPTED'
  | 'GROUPING_NOT_ACCEPTED' | 'UNIT_REQUIRED' | 'UNIT_NOT_ACCEPTED' | 'WRONG_PRECISION' | 'POLICY_INVALID' | 'KEY_NOT_A_NUMBER';
export interface CanonicalVerdict { code: CanonicalVerdictCode; correct: boolean; detail: string; value: number | null }
const v = (code: CanonicalVerdictCode, detail = '', value: number | null = null): CanonicalVerdict => ({ code, correct: code === 'CORRECT', detail, value });

export interface CanonicalNumber { value: number; representation: NumericRepresentation; decimals: number; significant: number; unit: string | null; decimalSeparator: DecimalSeparator | null; grouped: boolean }
export type CanonicalParse = { ok: true; n: CanonicalNumber } | { ok: false; code: CanonicalVerdictCode; detail: string };

/** A policy whose separators contradict each other cannot judge anything. */
export function policyIssues(p: CanonicalNumericPolicy): string[] {
  const out: string[] = [];
  const grouping = p.groupingSeparators ?? [];
  for (const g of grouping) if ((p.decimalSeparators as readonly string[]).includes(g)) out.push(`'${g}' is both a decimal and a grouping separator`);
  if (p.decimalSeparators.length === 0 && p.acceptedRepresentations.includes('DECIMAL')) out.push('DECIMAL accepted but no decimal separator');
  if (p.rounding && (!Number.isInteger(p.rounding.digits) || p.rounding.digits < 0 || (p.rounding.kind === 'SIGNIFICANT_FIGURES' && p.rounding.digits < 1))) out.push('rounding digits invalid');
  return out;
}

const SEPARATOR_CHARS = ['.', ',', ' ', "'"];

/** One written number (optionally followed by a unit) under the policy. */
export function parseCanonicalNumber(raw: string, p: CanonicalNumericPolicy): CanonicalParse {
  const text = String(raw ?? '').normalize('NFKC').replace(/[−‒–]/g, '-').replace(/ | /g, ' ').trim();
  if (!text) return { ok: false, code: 'EMPTY', detail: '' };
  const m = /^([+-]?)\s*(\d[\d.,' ]*\d|\d|[.,]\d+)(?:\s*\/\s*(\d+))?\s*(.*)$/.exec(text);
  if (!m) return { ok: false, code: 'NOT_A_NUMBER', detail: text };
  const [, sign, rawBody, denominator, rest] = m;
  // a trailing space before the unit belongs to the unit, not to the number
  const body = rawBody.replace(/\s+$/, '');
  const grouping = new Set<string>(p.groupingSeparators ?? []);
  const decimal = new Set<string>(p.decimalSeparators);
  const used = [...body].filter((c) => SEPARATOR_CHARS.includes(c));
  for (const c of used) if (!decimal.has(c) && !grouping.has(c)) return c === '.' || c === ',' ? { ok: false, code: 'DECIMAL_SEPARATOR_NOT_ACCEPTED', detail: c } : { ok: false, code: 'NOT_A_NUMBER', detail: text };
  const decimalsUsed = used.filter((c) => decimal.has(c));
  if (decimalsUsed.length > 1) return { ok: false, code: 'MALFORMED_NUMBER', detail: body };
  const decimalSeparator = (decimalsUsed[0] as DecimalSeparator | undefined) ?? null;
  const at = decimalSeparator ? body.indexOf(decimalSeparator) : -1;
  const intPart = at >= 0 ? body.slice(0, at) : body;
  const fracPart = at >= 0 ? body.slice(at + 1) : '';
  if (/[^\d]/.test(fracPart)) return { ok: false, code: 'MALFORMED_NUMBER', detail: body };
  const groupedChars = [...intPart].filter((c) => grouping.has(c));
  let digitsInt = intPart;
  if (groupedChars.length > 0) {
    if (new Set(groupedChars).size > 1) return { ok: false, code: 'MALFORMED_NUMBER', detail: body };
    const groups = intPart.split(groupedChars[0]);
    if (!/^\d{1,3}$/.test(groups[0]) || groups.slice(1).some((g) => !/^\d{3}$/.test(g))) return { ok: false, code: 'GROUPING_NOT_ACCEPTED', detail: body };
    digitsInt = groups.join('');
  }
  if (/[^\d]/.test(digitsInt)) return { ok: false, code: 'MALFORMED_NUMBER', detail: body };
  let value = Number(`${digitsInt || '0'}${fracPart ? `.${fracPart}` : ''}`);
  if (denominator !== undefined) {
    if (decimalSeparator || groupedChars.length || Number(denominator) === 0) return { ok: false, code: 'MALFORMED_NUMBER', detail: text };
    value /= Number(denominator);
  }
  if (sign === '-') value = -value;
  const digits = `${digitsInt}${fracPart}`.replace(/^0+(?=\d)/, '');
  const significant = decimalSeparator ? digits.replace(/^0+/, '').length || 1 : digits.replace(/0+$/, '').length || 1;
  return { ok: true, n: { value, representation: denominator !== undefined ? 'FRACTION' : decimalSeparator ? 'DECIMAL' : 'INTEGER', decimals: fracPart.length, significant, unit: rest.trim() || null, decimalSeparator, grouped: groupedChars.length > 0 } };
}

/** The keyed value, read with the most permissive unambiguous reading (keys are authored in canonical '.' form). */
export function canonicalKeyValue(key: string): number | null {
  const k = parseCanonicalNumber(key, { acceptedRepresentations: ['INTEGER', 'DECIMAL', 'FRACTION'], decimalSeparators: ['.'], units: { accepted: [], required: false }, rounding: null, tolerance: null });
  return k.ok && k.n.unit === null ? k.n.value : null;
}

/** One response against one keyed value. */
export function evaluateCanonicalNumeric(p: CanonicalNumericPolicy, key: string, response: string): CanonicalVerdict {
  const issues = policyIssues(p);
  if (issues.length) return v('POLICY_INVALID', issues.join('; '));
  const parsed = parseCanonicalNumber(response, p);
  if (!parsed.ok) return v(parsed.code, parsed.detail);
  const n = parsed.n;
  if (n.unit) {
    if (!p.units.accepted.some((u) => u.toLowerCase() === n.unit!.toLowerCase())) return v('UNIT_NOT_ACCEPTED', n.unit, n.value);
  } else if (p.units.required) return v('UNIT_REQUIRED', p.units.accepted.join(' / '), n.value);
  if (!p.acceptedRepresentations.includes(n.representation)) return v('NOT_IN_AN_ACCEPTED_FORM', n.representation, n.value);
  const expected = canonicalKeyValue(key);
  if (expected === null) return v('KEY_NOT_A_NUMBER', key);
  if (p.rounding && n.representation === 'DECIMAL') {
    const given = p.rounding.kind === 'DECIMAL_PLACES' ? n.decimals : n.significant;
    if (given !== p.rounding.digits) return v('WRONG_PRECISION', `${given} given, ${p.rounding.digits} required`, n.value);
  }
  const window = p.tolerance ? (p.tolerance.kind === 'ABSOLUTE' ? p.tolerance.value : Math.abs(expected) * p.tolerance.value)
    : p.rounding && n.representation === 'DECIMAL' && p.rounding.kind === 'DECIMAL_PLACES' ? 0.5 * 10 ** -p.rounding.digits
    : p.rounding && n.representation === 'DECIMAL' ? 0.5 * 10 ** (Math.floor(Math.log10(Math.abs(expected) || 1)) + 1 - p.rounding.digits)
    : 0;
  return Math.abs(n.value - expected) <= window + 1e-12 * Math.max(1, Math.abs(expected)) ? v('CORRECT', '', n.value) : v('INCORRECT', `${n.value} vs ${expected}`, n.value);
}

/** Ordered parts: response k against key k, independently. Never alternatives of each other. */
export function evaluateOrderedParts(p: CanonicalNumericPolicy, keys: readonly string[], responses: readonly string[]): CanonicalVerdict[] {
  return keys.map((k, i) => evaluateCanonicalNumeric(p, k, responses[i] ?? ''));
}

/** The contract a bank version carries: the policy, its version, and nothing else. */
export interface ResponseContract { version: typeof CANONICAL_RESPONSE_CONTRACT_VERSION; policy: CanonicalNumericPolicy }
export const responseContractOf = (p: CanonicalNumericPolicy): ResponseContract => ({
  version: CANONICAL_RESPONSE_CONTRACT_VERSION,
  policy: { acceptedRepresentations: [...p.acceptedRepresentations], decimalSeparators: [...p.decimalSeparators], groupingSeparators: [...(p.groupingSeparators ?? [])], units: { accepted: [...p.units.accepted], required: p.units.required }, rounding: p.rounding ? { ...p.rounding } : null, tolerance: p.tolerance ? { ...p.tolerance } : null },
});
