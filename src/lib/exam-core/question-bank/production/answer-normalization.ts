/**
 * QB-R2C -- normalisation of a student-produced NUMERIC response (pure, no IO).
 *
 * AUTHORITY: `STUDYUS_POLICY` (`ANSWER_NORMALIZATION_POLICY`). Nothing here is an official marking rule of any
 * exam: it is how StudyUs decides, for its own items, whether what a learner typed is the keyed number. Every
 * result carries the policy so that it can never be read as official.
 *
 * The rule of the module: decide only what is certain. A form the policy does not cover returns
 * NOT_GRADABLE_AUTOMATICALLY with a named reason -- it is never guessed correct or incorrect.
 *
 * WHAT IS ACCEPTED (the items are in Spanish, so both decimal separators are read):
 *   integers                 7, 007 (leading zeros), +7, -7, −7 (unicode minus)
 *   decimals                 0,5  0.5  ,5  .5  2,50 (trailing zeros)        -- comma or point as the decimal separator
 *   fractions                3/4, -3/4, 6/8  (integers over a non-zero integer; a/b with spaces around the bar)
 *   thousands separators     CONSERVATIVE. Read as grouping only when the form leaves no doubt:
 *                              both separators present, the last one decimal (1.234,5 or 1,234.5), or
 *                              the same separator twice or more in groups of three (1.234.567).
 *                            A single separator followed by exactly three digits (1.234 / 1,234) is AMBIGUOUS
 *                            (one-point-two-three-four or one thousand ...): both readings are graded; if they
 *                            agree the verdict stands, if they differ the response is not gradable automatically.
 *                            A space as a thousands separator (1 234) is not supported.
 *   surrounding whitespace   ignored. Whitespace inside a number is not.
 * WHAT IS NOT:
 *   mixed numbers (1 1/2)            UNSUPPORTED -> MIXED_NUMBER_UNSUPPORTED
 *   scientific / power notation      UNSUPPORTED -> UNSUPPORTED_FORM
 *   units and the percent sign       accepted ONLY when the key lists the exact unit string in `acceptedUnits`
 *                                    (the percent sign is a unit like any other: list '%' to accept "45 %").
 *                                    Any other trailing text -> UNIT_NOT_ACCEPTED, not gradable automatically.
 * EQUIVALENCE (declared on the key):
 *   equivalentFormsAllowed = true    any accepted form of the same value is correct (1/2 = 2/4 = 0,5 = 0.50)
 *   equivalentFormsAllowed = false   the response must be in the key's form: a fraction key takes that very
 *                                    fraction (2/4 is not 1/2), a decimal or integer key takes a decimal or
 *                                    integer (0,50 is 0.5; 1/2 is not).
 * PRECISION (declared on the key; exact by default):
 *   tolerance        |response - value| <= tolerance
 *   decimalPlaces    for "round to n places": the response must have at most n decimals and equal the key's
 *                    value rounded half away from zero to n places.
 */
import { z } from 'zod';

export const ANSWER_NORMALIZATION_POLICY = { id: 'studyus-numeric-answer-normalization', version: '1', authority: 'STUDYUS_POLICY' } as const;

/** An exact rational: n / d with d > 0, in lowest terms. */
export interface Rational { n: bigint; d: bigint }
export type NumericForm = 'INTEGER' | 'DECIMAL' | 'FRACTION';
export interface NormalizedNumber { form: NumericForm; value: Rational; /** As typed, before reduction: a fraction's own numerator and denominator. */ written: { n: bigint; d: bigint }; decimals: number; unit: string | null }

export const NOT_GRADABLE_REASONS = ['EMPTY_RESPONSE', 'UNSUPPORTED_FORM', 'MIXED_NUMBER_UNSUPPORTED', 'ZERO_DENOMINATOR', 'AMBIGUOUS_SEPARATOR', 'UNIT_NOT_ACCEPTED', 'KEY_NOT_WELL_FORMED'] as const;
export type NotGradableReason = (typeof NOT_GRADABLE_REASONS)[number];

const abs = (x: bigint): bigint => (x < BigInt(0) ? -x : x);
const gcd = (a: bigint, b: bigint): bigint => (b === BigInt(0) ? abs(a) : gcd(b, a % b));
const reduce = (n: bigint, d: bigint): Rational => {
  const g = gcd(n, d) || BigInt(1);
  return d < BigInt(0) ? { n: -n / g, d: -d / g } : { n: n / g, d: d / g };
};
const sub = (a: Rational, b: Rational): Rational => reduce(a.n * b.d - b.n * a.d, a.d * b.d);
const lessOrEqual = (a: Rational, b: Rational): boolean => a.n * b.d <= b.n * a.d;
const equal = (a: Rational, b: Rational): boolean => a.n === b.n && a.d === b.d;
export const rationalToNumber = (r: Rational): number => Number(r.n) / Number(r.d);

/** value rounded half away from zero to `places` decimals, as an exact rational. */
function roundTo(value: Rational, places: number): Rational {
  const scale = BigInt(10) ** BigInt(places);
  const negative = value.n < BigInt(0);
  const scaled = abs(value.n) * scale * BigInt(2) + value.d;
  const q = scaled / (value.d * BigInt(2));
  return reduce(negative ? -q : q, scale);
}

const INTEGER = /^\d+$/;
function parseUnsigned(body: string): Array<{ form: NumericForm; n: bigint; d: bigint; decimals: number }> | NotGradableReason {
  if (INTEGER.test(body)) return [{ form: 'INTEGER', n: BigInt(body), d: BigInt(1), decimals: 0 }];
  const decimal = (int: string, frac: string) => ({ form: 'DECIMAL' as const, n: BigInt(`${int || '0'}${frac}`), d: BigInt(10) ** BigInt(frac.length), decimals: frac.length });
  const grouped = (s: string, sep: string): string | null => {
    const groups = s.split(sep);
    return groups.length >= 2 && /^\d{1,3}$/.test(groups[0]) && !/^0\d/.test(groups[0]) && groups.slice(1).every((g) => /^\d{3}$/.test(g)) ? groups.join('') : null;
  };
  const seps = body.replace(/\d/g, '');
  if (!/^[.,]+$/.test(seps)) return 'UNSUPPORTED_FORM';
  if (seps.length === 1) {
    const [int, frac] = body.split(seps);
    if (!/^\d*$/.test(int) || !/^\d+$/.test(frac)) return 'UNSUPPORTED_FORM';
    const asDecimal = decimal(int, frac);
    // one separator and exactly three digits after a non-zero integer part: decimal or thousands?
    if (frac.length === 3 && /^[1-9]\d{0,2}$/.test(int)) return [asDecimal, { form: 'INTEGER', n: BigInt(`${int}${frac}`), d: BigInt(1), decimals: 0 }];
    return [asDecimal];
  }
  const kinds = new Set(seps.split(''));
  if (kinds.size === 1) {
    const joined = grouped(body, seps[0]);
    return joined === null ? 'UNSUPPORTED_FORM' : [{ form: 'INTEGER', n: BigInt(joined), d: BigInt(1), decimals: 0 }];
  }
  // both separators: the last one is the decimal separator and must appear once; the other groups thousands
  const dec = seps[seps.length - 1];
  const thousands = dec === ',' ? '.' : ',';
  if (seps.slice(0, -1).includes(dec)) return 'UNSUPPORTED_FORM';
  const [intPart, frac] = body.split(dec);
  const joined = grouped(intPart, thousands);
  return joined === null || !/^\d+$/.test(frac) ? 'UNSUPPORTED_FORM' : [decimal(joined, frac)];
}

export type ParsedResponse = { ok: true; readings: NormalizedNumber[] } | { ok: false; reason: NotGradableReason };

/**
 * Reads what was typed into one or (for an ambiguous separator) two candidate numbers. `acceptedUnits` are the
 * exact unit strings that may follow the number; a trailing text that is not one of them is refused.
 */
export function normalizeStudentResponse(raw: string, acceptedUnits: readonly string[] = []): ParsedResponse {
  let s = raw.normalize('NFKC').replace(/[−‒–]/g, '-').trim();
  if (s.length === 0) return { ok: false, reason: 'EMPTY_RESPONSE' };
  let unit: string | null = null;
  const trailing = /^([+-]?[\d.,/\s]*\d)\s*([^\d.,/\s+-].*)$/.exec(s);
  if (trailing) {
    const found = acceptedUnits.find((u) => u.trim().toLowerCase() === trailing[2].trim().toLowerCase());
    // "1e3" or "2x10^3" carry digits after the text: that is a form, not a unit
    if (!found) return { ok: false, reason: /\d/.test(trailing[2]) ? 'UNSUPPORTED_FORM' : 'UNIT_NOT_ACCEPTED' };
    unit = found;
    s = trailing[1].trim();
  }
  let sign = BigInt(1);
  if (s[0] === '+' || s[0] === '-') {
    if (s[0] === '-') sign = BigInt(-1);
    s = s.slice(1);
  }
  if (/^\d+\s+\d+\s*\/\s*\d+$/.test(s)) return { ok: false, reason: 'MIXED_NUMBER_UNSUPPORTED' };
  const fraction = /^(\d+)\s*\/\s*(\d+)$/.exec(s);
  if (fraction) {
    const n = BigInt(fraction[1]) * sign;
    const d = BigInt(fraction[2]);
    if (d === BigInt(0)) return { ok: false, reason: 'ZERO_DENOMINATOR' };
    return { ok: true, readings: [{ form: 'FRACTION', value: reduce(n, d), written: { n, d }, decimals: 0, unit }] };
  }
  if (/\s/.test(s)) return { ok: false, reason: 'UNSUPPORTED_FORM' };
  const parsed = parseUnsigned(s);
  if (typeof parsed === 'string') return { ok: false, reason: parsed };
  return { ok: true, readings: parsed.map((p) => ({ form: p.form, value: reduce(p.n * sign, p.d), written: { n: p.n * sign, d: p.d }, decimals: p.decimals, unit })) };
}

const CANONICAL_VALUE = /^-?(\d+|\d+\.\d+|\d+\/\d+)$/;
const PLAIN_DECIMAL = /^\d+(\.\d+)?$/;

/**
 * The stored key of a student-produced numeric item. `value` is canonical: an integer, a decimal with a POINT,
 * or a fraction a/b -- no separators to interpret. Exact unless `tolerance` or `decimalPlaces` says otherwise.
 */
export const NumericAnswerKeySchema = z
  .strictObject({
    kind: z.literal('NUMERIC'),
    value: z.string().regex(CANONICAL_VALUE, 'VALUE_NOT_CANONICAL'),
    equivalentFormsAllowed: z.boolean(),
    /** Absolute tolerance, as a plain decimal string (e.g. "0.01"). */
    tolerance: z.string().regex(PLAIN_DECIMAL, 'TOLERANCE_NOT_A_PLAIN_DECIMAL').optional(),
    decimalPlaces: z.number().int().min(0).max(6).optional(),
    /** Exact unit strings a response may carry after the number. Absent = a response with any unit is not gradable. */
    acceptedUnits: z.array(z.string().trim().min(1).max(20)).min(1).optional(),
  })
  .superRefine((k, ctx) => {
    if (/\/0+$/.test(k.value)) ctx.addIssue({ code: 'custom', path: ['value'], message: 'ZERO_DENOMINATOR' });
    if (k.tolerance !== undefined && k.decimalPlaces !== undefined) ctx.addIssue({ code: 'custom', path: ['tolerance'], message: 'TOLERANCE_AND_DECIMAL_PLACES_ARE_EXCLUSIVE' });
    if (k.acceptedUnits && new Set(k.acceptedUnits.map((u) => u.toLowerCase())).size !== k.acceptedUnits.length) ctx.addIssue({ code: 'custom', path: ['acceptedUnits'], message: 'UNIT_LISTED_TWICE' });
    if (k.acceptedUnits?.some((u) => /\d/.test(u))) ctx.addIssue({ code: 'custom', path: ['acceptedUnits'], message: 'UNIT_CONTAINS_A_DIGIT' });
    // "give the fraction" and "round to n places" cannot both be asked of one key
    if (k.decimalPlaces !== undefined && k.value.includes('/') && !k.equivalentFormsAllowed) ctx.addIssue({ code: 'custom', path: ['decimalPlaces'], message: 'FRACTION_ONLY_KEY_CANNOT_BE_ROUNDED' });
  });
export type NumericAnswerKey = z.infer<typeof NumericAnswerKeySchema>;

export function validateNumericAnswerKey(input: unknown): { ok: true; key: NumericAnswerKey } | { ok: false; issues: string[] } {
  const parsed = NumericAnswerKeySchema.safeParse(input);
  return parsed.success ? { ok: true, key: parsed.data } : { ok: false, issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
}

/** A canonical value (integer, point decimal, a/b) as an exact number: no separator is interpreted. */
function parseCanonical(value: string): NormalizedNumber {
  if (!CANONICAL_VALUE.test(value)) throw new Error('KEY_NOT_WELL_FORMED');
  const sign = value.startsWith('-') ? BigInt(-1) : BigInt(1);
  const body = value.replace(/^-/, '');
  if (body.includes('/')) {
    const [a, b] = body.split('/');
    if (BigInt(b) === BigInt(0)) throw new Error('KEY_NOT_WELL_FORMED');
    return { form: 'FRACTION', value: reduce(BigInt(a) * sign, BigInt(b)), written: { n: BigInt(a) * sign, d: BigInt(b) }, decimals: 0, unit: null };
  }
  const [int, frac = ''] = body.split('.');
  const n = BigInt(`${int}${frac}`) * sign;
  const d = BigInt(10) ** BigInt(frac.length);
  return { form: frac ? 'DECIMAL' : 'INTEGER', value: reduce(n, d), written: { n, d }, decimals: frac.length, unit: null };
}

/** The key's own value as an exact number. Throws on a key that the schema would refuse. */
export const numericKeyValue = (key: NumericAnswerKey): NormalizedNumber => parseCanonical(key.value);

export type ResponseVerdict =
  | { outcome: 'CORRECT' | 'INCORRECT'; reason: null; policy: typeof ANSWER_NORMALIZATION_POLICY }
  | { outcome: 'NOT_GRADABLE_AUTOMATICALLY'; reason: NotGradableReason; policy: typeof ANSWER_NORMALIZATION_POLICY };

function matches(key: NumericAnswerKey, expected: NormalizedNumber, given: NormalizedNumber): boolean {
  if (!key.equivalentFormsAllowed) {
    if ((expected.form === 'FRACTION') !== (given.form === 'FRACTION')) return false;
    if (expected.form === 'FRACTION' && (given.written.n !== expected.written.n || given.written.d !== expected.written.d)) return false;
  }
  if (key.decimalPlaces !== undefined) return given.form !== 'FRACTION' && given.decimals <= key.decimalPlaces && equal(given.value, roundTo(expected.value, key.decimalPlaces));
  if (key.tolerance !== undefined) {
    const diff = sub(given.value, expected.value);
    return lessOrEqual({ n: abs(diff.n), d: diff.d }, parseCanonical(key.tolerance).value);
  }
  return equal(given.value, expected.value);
}

/** Is what the learner typed the keyed number? Never a guess: what cannot be decided is said to be undecidable. */
export function isResponseCorrect(expected: unknown, given: string): ResponseVerdict {
  const policy = ANSWER_NORMALIZATION_POLICY;
  const key = validateNumericAnswerKey(expected);
  if (!key.ok) return { outcome: 'NOT_GRADABLE_AUTOMATICALLY', reason: 'KEY_NOT_WELL_FORMED', policy };
  const response = normalizeStudentResponse(given, key.key.acceptedUnits ?? []);
  if (!response.ok) return { outcome: 'NOT_GRADABLE_AUTOMATICALLY', reason: response.reason, policy };
  const target = numericKeyValue(key.key);
  const verdicts = response.readings.map((r) => matches(key.key, target, r));
  if (new Set(verdicts).size > 1) return { outcome: 'NOT_GRADABLE_AUTOMATICALLY', reason: 'AMBIGUOUS_SEPARATOR', policy };
  return { outcome: verdicts[0] ? 'CORRECT' : 'INCORRECT', reason: null, policy };
}

/** The key's value written the way a Spanish-language learner would type it (decimal comma). For round-trip checks. */
export const spanishFormOf = (key: NumericAnswerKey): string => key.value.replace('.', ',');
