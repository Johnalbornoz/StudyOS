/**
 * CF-IB-AAHL-01 -- ten PARAMETRIC_DETERMINISTIC constructs for the governed IB Mathematics: analysis and approaches
 * HL pilot scope (v2.ib.math-aa-hl, Papers 1 and 2). Content Factory candidates: pure data + pure functions, no IO,
 * no provider. They implement the repository's own `ParametricConstruct` contract
 * (src/lib/assessment-instance/library/parametric.ts) so Track B can adopt them unchanged -- or refuse them.
 * Nothing here is wired into the runtime library catalogue; nothing here is certified.
 *
 * Every construct keys ONE exact value (integer, fraction or terminating decimal: EXACT_NUMERIC_POLICY), is bounded
 * and enumerable per planning band, words its prompt in English with an IB command term, and checks its key by a
 * route that does not reuse `answer` (Simpson's rule, Richardson extrapolation, brute-force enumeration, forward
 * evaluation, integer exponentiation). Keys are positive (the library sweep refuses non-positive keys).
 *
 *   P1 algebra   GEOMETRIC_SUM_TO_INFINITY         Sequences and series
 *                LOG_EQUATION_ONE_ADMISSIBLE_ROOT  Logarithms
 *   P1 functions INVERSE_FUNCTION_VALUE            Rational functions and inverses
 *                QUADRATIC_MINIMUM_VALUE           Quadratic functions and inequalities
 *   P1 calculus  DEFINITE_INTEGRAL_POLYNOMIAL      Integration
 *                AREA_BETWEEN_CURVE_AND_AXIS       Integration
 *                TANGENT_GRADIENT_AT_A_POINT       Differentiation
 *                CUBIC_LOCAL_MAXIMUM               Differentiation
 *   P2 statistics BINOMIAL_EXACT_PROBABILITY       Binomial distribution
 *                NORMAL_SYMMETRY                   Normal distribution
 */
import { rational, sameRational, writeRational, type ParametricConstruct, type PlanningBand, type Rational } from '@/lib/assessment-instance/library/parametric';

// ------------------------------------------------------------------------------------------- exact arithmetic
const R = (n: number, d = 1): Rational => rational(n, d);
const add = (a: Rational, b: Rational): Rational => R(a.n * b.d + b.n * a.d, a.d * b.d);
const sub = (a: Rational, b: Rational): Rational => R(a.n * b.d - b.n * a.d, a.d * b.d);
const mul = (a: Rational, b: Rational): Rational => R(a.n * b.n, a.d * b.d);
const div = (a: Rational, b: Rational): Rational => R(a.n * b.d, a.d * b.n);
const fromInt = (n: number): Rational => R(n);
const orNull = (f: () => Rational): Rational | null => { try { return f(); } catch { return null; } };
const need = (issues: string[]) => (ok: boolean, miss: string) => { if (!ok) issues.push(miss); };
const keyOf = (c: { answer(p: never): string }, p: unknown): Rational => { const t = c.answer(p as never); const m = /^(-?\d+)\/(\d+)$/.exec(t); if (m) return R(Number(m[1]), Number(m[2])); const dec = /^(-?)(\d+)(?:\.(\d+))?$/.exec(t)!; const s = 10 ** (dec[3]?.length ?? 0); return R((dec[1] ? -1 : 1) * (Number(dec[2]) * s + Number(dec[3] ?? 0)), s); };
/**
 * A key whose exact decimal has exactly three decimals and a non-zero integer part (21/8 = 2.625) is refused: the
 * certified instance policy (EXACT_NUMERIC_POLICY, separators "." and ",") reads "2.625" as AMBIGUOUS_SEPARATOR
 * while the Exam Core grader accepts it -- the two scorers would disagree on a correct learner answer.
 */
export const decimalIsAmbiguous = (k: Rational): boolean => { let d = k.d; while (d % 2 === 0) d /= 2; while (d % 5 === 0) d /= 5; if (d !== 1 || k.d === 1) return false; const s = (Math.abs(k.n) / k.d).toString(); const [ip, fp] = s.split('.'); return ip !== '0' && fp?.length === 3; };
/** Drops the parameter sets whose key a modelled misconception would also give (library convention), or whose key is a decimal the two scorers read differently. */
const withoutCollisions = <P extends Record<string, number | string>>(c: Pick<ParametricConstruct<P>, 'answer' | 'misconceptionAnswers'>, sets: P[]): P[] => sets.filter((p) => { const key = keyOf(c as never, p); return !decimalIsAmbiguous(key) && !c.misconceptionAnswers(p).some((m) => m.value !== null && sameRational(m.value, key)); });

// ------------------------------------------------------------------------------------------------- writing
const SUP: Record<number, string> = { 2: '²', 3: '³' };
const frac = (x: Rational): string => (x.d === 1 ? String(x.n) : `${x.n}/${x.d}`).replace('-', '−');
/** a polynomial written the way an exam writes it: 2x³ − x² + 4x − 7 */
function poly(coeffs: readonly number[], v = 'x'): string {
  // coeffs[i] = coefficient of v^(deg - i)
  const deg = coeffs.length - 1; const out: string[] = [];
  coeffs.forEach((c, i) => {
    if (c === 0) return;
    const e = deg - i; const abs = Math.abs(c);
    const body = e === 0 ? String(abs) : `${abs === 1 ? '' : abs}${v}${e === 1 ? '' : SUP[e]}`;
    out.push(out.length === 0 ? (c < 0 ? `−${body}` : body) : `${c < 0 ? '−' : '+'} ${body}`);
  });
  return out.length ? out.join(' ') : '0';
}
const lin = (a: number, b: number, v = 'x'): string => poly([a, b], v);
const evalPoly = (coeffs: readonly number[], x: Rational): Rational => coeffs.reduce<Rational>((acc, c) => add(mul(acc, x), fromInt(c)), fromInt(0));
const decimalOf = (x: Rational): string | null => { let d = x.d; let twos = 0; let fives = 0; while (d % 2 === 0) { d /= 2; twos++; } while (d % 5 === 0) { d /= 5; fives++; } if (d !== 1) return null; return (x.n / x.d).toFixed(Math.max(twos, fives)); };

// ===================================================================== 1. GEOMETRIC_SUM_TO_INFINITY (P1 algebra)
export interface GeoParameters extends Record<string, number | string> { t1: number; t2: number; t3: number; p: number; q: number; sign: 1 | -1; shown: 'THREE_TERMS' | 'SECOND_AND_THIRD' }
const geoBand = (band: PlanningBand, x: GeoParameters): string[] => {
  const i: string[] = []; const n = need(i);
  n(band === 'FOUNDATIONAL' ? x.sign === 1 && x.shown === 'THREE_TERMS' : band === 'STANDARD' ? x.sign === -1 && x.shown === 'THREE_TERMS' : x.sign === 1 && x.shown === 'SECOND_AND_THIRD', 'LEVERS_ARE_NOT_THE_BANDS');
  n(x.p >= 1 && x.p < x.q && x.q <= 5, 'RATIO_OUTSIDE_THE_ENVELOPE');
  n(x.t2 * x.q === x.sign * x.t1 * x.p && x.t3 * x.q === x.sign * x.t2 * x.p, 'NOT_GEOMETRIC');
  n(Math.abs(x.t1) <= 400 && x.t1 > 0, 'FIRST_TERM_OUTSIDE_THE_ENVELOPE');
  return i;
};
export const GEOMETRIC_SUM_TO_INFINITY: ParametricConstruct<GeoParameters> = {
  construct: 'GEOMETRIC_SUM_TO_INFINITY', rendererVersion: 'cf.ib.geometric-sum-to-infinity@0.1.0', languages: ['en'],
  enumerate(band) {
    const out: GeoParameters[] = [];
    const sign = band === 'STANDARD' ? -1 : 1; const shown = band === 'CHALLENGE' ? 'SECOND_AND_THIRD' : 'THREE_TERMS';
    for (let q = 2; q <= 5; q++) for (let p = 1; p < q; p++) { if (gcdN(p, q) !== 1) continue; for (let k = 1; k * q * q <= 400; k++) {
      const x: GeoParameters = { t1: k * q * q, t2: sign * k * p * q, t3: k * p * p, p, q, sign: sign as 1 | -1, shown };
      if (x.t1 === 18 && x.t2 === 12) continue; // the vertical's own fixture (18 + 12 + 8 + ...) is never re-issued
      if (geoBand(band, x).length === 0) out.push(x);
    } }
    return withoutCollisions(this, out);
  },
  bandIssues: geoBand,
  present: (x) => x.shown === 'THREE_TERMS'
    ? `Find the sum to infinity of the geometric series ${x.t1} ${x.t2 < 0 ? '−' : '+'} ${Math.abs(x.t2)} + ${x.t3} ${x.t2 < 0 ? '−' : '+'} …`
    : `The second term of a geometric sequence is ${x.t2} and the third term is ${x.t3}. All terms are positive. Find the sum to infinity of the sequence.`,
  answer: (x) => writeRational(div(fromInt(x.t1), sub(fromInt(1), R(x.sign * x.p, x.q)))),
  // S = u1^2 / (u1 - u2) from the shown terms only (u1 recovered from u2, u3 when it is not shown)
  keyHolds: (x, key) => { const u2 = fromInt(x.t2); const u3 = fromInt(x.t3); const u1 = x.shown === 'THREE_TERMS' ? fromInt(x.t1) : div(mul(u2, u2), u3); return sameRational(mul(key, sub(u1, u2)), mul(u1, u1)) && key.n > 0; },
  misconceptionAnswers: (x) => { const r = R(x.sign * x.p, x.q); return [
    { id: 'uses-one-plus-r', value: orNull(() => div(fromInt(x.t1), add(fromInt(1), r))) },
    { id: 'sums-the-shown-terms', value: R(x.t1 + x.t2 + x.t3) },
    { id: 'starts-from-the-second-term', value: orNull(() => div(fromInt(x.t2), sub(fromInt(1), r))) },
  ]; },
  recognitionKey: (x) => `${x.shown}|${x.sign}|${x.p}/${x.q}|${x.t1}`,
};
function gcdN(a: number, b: number): number { return b === 0 ? Math.abs(a) : gcdN(b, a % b); }

// ======================================================== 2. LOG_EQUATION_ONE_ADMISSIBLE_ROOT (P1 algebra)
// SUM: log_b(x) + log_b(x - k) = n with k signed (k < 0 reads x + |k|); the other root of x(x - k) = b^n is negative
export interface LogParameters extends Record<string, number | string> { base: number; n: number; k: number; root: number; form: 'SUM' | 'DIFFERENCE' | 'CHANGE_OF_BASE'; c: number }
const logBand = (band: PlanningBand, x: LogParameters): string[] => {
  const i: string[] = []; const n = need(i);
  n((band === 'FOUNDATIONAL' ? 'SUM' : band === 'STANDARD' ? 'DIFFERENCE' : 'CHANGE_OF_BASE') === x.form, 'FORM_IS_NOT_THE_BANDS');
  n([2, 3, 5, 10].includes(x.base) || (x.form !== 'DIFFERENCE' && [2, 3, 4, 5, 6, 7].includes(x.base)), 'BASE_OUTSIDE_THE_ENVELOPE');
  n(x.root > 0 && x.root <= 1000 && (x.form !== 'SUM' || (x.k !== 0 && Math.abs(x.k) <= 30)), 'ROOT_OUTSIDE_THE_ENVELOPE');
  return i;
};
export const LOG_EQUATION: ParametricConstruct<LogParameters> = {
  construct: 'LOG_EQUATION_ONE_ADMISSIBLE_ROOT', rendererVersion: 'cf.ib.log-equation@0.1.0', languages: ['en'],
  enumerate(band) {
    const out: LogParameters[] = [];
    if (band === 'FOUNDATIONAL') for (const base of [2, 3, 4, 5, 6, 10]) for (let n = 1; base ** n <= 100000; n++) { const N = base ** n; for (let r = 1; r <= N; r++) { if (N % r !== 0) continue; const k = r - N / r; if (k !== 0 && Math.abs(k) <= 30 && r > Math.max(0, k) && !(base === 2 && n === 3 && k === 2)) out.push({ base, n, k, root: r, form: 'SUM', c: 0 }); } } // not the vertical's fixture log₂(x) + log₂(x − 2) = 3
    if (band === 'STANDARD') for (const base of [2, 3, 5, 10]) for (let n = 1; base ** n <= 125; n++) { const N = base ** n; for (let k = 1; k <= 12; k++) for (let c = 1; c <= 12; c++) { const num = k + N * c; if (num % (N - 1) !== 0) continue; const r = num / (N - 1); if (r > c) out.push({ base, n, k, root: r, form: 'DIFFERENCE', c }); } }
    if (band === 'CHALLENGE') for (const base of [2, 3, 4, 5, 6, 7]) for (const [m, n] of [[2, 3], [2, 6], [3, 4], [3, 8]] as const) { const r = m === 2 ? base ** ((2 * n) / 3) : base ** ((3 * n) / 4); if (Number.isInteger(r) && r <= 1000000) out.push({ base, n, k: m, root: r, form: 'CHANGE_OF_BASE', c: 0 }); }
    return withoutCollisions(this, out.filter((x) => logBand(band, x).length === 0));
  },
  bandIssues: logBand,
  present: (x) => x.form === 'SUM' ? `Solve the equation log${sub10(x.base)}(x) + log${sub10(x.base)}(x ${x.k > 0 ? '−' : '+'} ${Math.abs(x.k)}) = ${x.n}.`
    : x.form === 'DIFFERENCE' ? `Solve the equation log${sub10(x.base)}(x + ${x.k}) − log${sub10(x.base)}(x − ${x.c}) = ${x.n}.`
    : `Solve the equation log${sub10(x.base)}(x) + log${sub10(x.base ** x.k)}(x) = ${x.n}.`,
  answer: (x) => String(x.root),
  // exponentiate back with integers; the rejected root of SUM is negative, so exactly one value is admissible
  keyHolds: (x, key) => { if (key.d !== 1 || key.n <= 0) return false; const v = key.n; const N = x.base ** x.n;
    if (x.form === 'SUM') return v > Math.max(0, x.k) && v * (v - x.k) === N;
    if (x.form === 'DIFFERENCE') return v > x.c && v + x.k === N * (v - x.c);
    const B = BigInt(x.base); const V = BigInt(v); return x.k === 2 ? V ** BigInt(3) === B ** BigInt(2 * x.n) : V ** BigInt(4) === B ** BigInt(3 * x.n); },
  misconceptionAnswers: (x) => { const N = x.base ** x.n; return x.form === 'SUM' ? [
    { id: 'adds-the-arguments', value: orNull(() => R(N + x.k, 2)) },
    { id: 'uses-n-times-the-base', value: R(x.base * x.n) },
  ] : x.form === 'DIFFERENCE' ? [
    { id: 'subtracts-the-arguments', value: null },
    { id: 'uses-n-times-the-base', value: orNull(() => R(x.base * x.n + x.c)) },
  ] : [
    { id: 'ignores-the-change-of-base', value: orNull(() => R(x.base ** x.n / 2)) },
    { id: 'treats-both-logs-as-base-b', value: Number.isInteger(Math.sqrt(N)) && N <= 1e9 ? R(Math.sqrt(N)) : null },
  ]; },
  recognitionKey: (x) => `${x.form}|${x.base}|${x.n}|${x.k}|${x.c}`,
};
const SUBS = '₀₁₂₃₄₅₆₇₈₉';
function sub10(n: number): string { return String(n).split('').map((d) => SUBS[Number(d)]).join(''); }

// ================================================================ 3. INVERSE_FUNCTION_VALUE (P1 functions)
export interface InvParameters extends Record<string, number | string> { a: number; b: number; c: number; d: number; k: number; kind: 'LINEAR' | 'RATIONAL' }
// f(x) = (a x + b) / (c x + d); LINEAR when c = 0, d = 1
const invValue = (x: InvParameters): Rational => div(sub(mul(fromInt(x.d), fromInt(x.k)), fromInt(x.b)), sub(fromInt(x.a), mul(fromInt(x.c), fromInt(x.k))));
const invBand = (band: PlanningBand, x: InvParameters): string[] => {
  const i: string[] = []; const n = need(i);
  n(band === 'FOUNDATIONAL' ? x.kind === 'LINEAR' : x.kind === 'RATIONAL', 'KIND_IS_NOT_THE_BANDS');
  n(x.kind === 'LINEAR' || x.a * x.d - x.b * x.c !== 0, 'NOT_INVERTIBLE');
  const v = orNull(() => invValue(x));
  n(!!v && v.n > 0 && (band === 'CHALLENGE' ? v.d > 1 && v.d <= 9 : v.d === 1), 'VALUE_NOT_IN_THE_BANDS_FORM');
  return i;
};
export const INVERSE_FUNCTION_VALUE: ParametricConstruct<InvParameters> = {
  construct: 'INVERSE_FUNCTION_VALUE', rendererVersion: 'cf.ib.inverse-function-value@0.1.0', languages: ['en'],
  enumerate(band) {
    const out: InvParameters[] = [];
    if (band === 'FOUNDATIONAL') for (let a = 2; a <= 9; a++) for (let b = -12; b <= 12; b++) for (let v = 1; v <= 12; v++) { if (b === 0) continue; out.push({ a, b, c: 0, d: 1, k: a * v + b, kind: 'LINEAR' }); }
    else for (let a = 1; a <= 5; a++) for (let b = -6; b <= 6; b++) for (const c of [1]) for (let d = -5; d <= 5; d++) for (let k = -6; k <= 9; k++) { if (d === 0 || k === a || b === 0) continue; out.push({ a, b, c, d, k, kind: 'RATIONAL' }); }
    return withoutCollisions(this, out.filter((x) => invBand(band, x).length === 0)).filter((x) => !(x.kind === 'RATIONAL' && x.a === 2 && x.b === 1 && x.d === -3)); // not the vertical's fixture f(x) = (2x + 1)/(x − 3)
  },
  bandIssues: invBand,
  present: (x) => x.kind === 'LINEAR'
    ? `The function f is defined by f(x) = ${lin(x.a, x.b)}, x ∈ ℝ. Find f⁻¹(${frac(fromInt(x.k))}).`
    : `The function f is defined by f(x) = (${lin(x.a, x.b)})/(${lin(x.c, x.d)}), x ≠ ${frac(R(-x.d, x.c))}. Find f⁻¹(${frac(fromInt(x.k))}).`,
  answer: (x) => writeRational(invValue(x)),
  // forward evaluation: f(key) must be the shown input of f⁻¹
  keyHolds: (x, key) => { const den = add(mul(fromInt(x.c), key), fromInt(x.d)); if (den.n === 0) return false; return key.n > 0 && sameRational(div(add(mul(fromInt(x.a), key), fromInt(x.b)), den), fromInt(x.k)); },
  misconceptionAnswers: (x) => [
    { id: 'evaluates-f-instead-of-its-inverse', value: orNull(() => div(add(mul(fromInt(x.a), fromInt(x.k)), fromInt(x.b)), add(mul(fromInt(x.c), fromInt(x.k)), fromInt(x.d)))) },
    { id: 'takes-the-reciprocal-of-f', value: orNull(() => div(add(mul(fromInt(x.c), fromInt(x.k)), fromInt(x.d)), add(mul(fromInt(x.a), fromInt(x.k)), fromInt(x.b)))) },
  ],
  recognitionKey: (x) => `${x.kind}|${x.a}|${x.b}|${x.c}|${x.d}`,
};

// ================================================================ 4. QUADRATIC_MINIMUM_VALUE (P1 functions)
export interface QminParameters extends Record<string, number | string> { a: number; b: number; c: number }
const qminValue = (x: QminParameters): Rational => sub(fromInt(x.c), R(x.b * x.b, 4 * x.a));
const qminBand = (band: PlanningBand, x: QminParameters): string[] => {
  const i: string[] = []; const n = need(i);
  const h = R(-x.b, 2 * x.a); const m = qminValue(x);
  n(band === 'FOUNDATIONAL' ? x.a === 1 && h.d === 1 : band === 'STANDARD' ? x.a >= 2 && h.d === 1 : x.a >= 2 && h.d > 1, 'VERTEX_NOT_IN_THE_BANDS_FORM');
  n(m.n > 0 && (band === 'CHALLENGE' || m.d === 1), 'MINIMUM_NOT_POSITIVE_OR_NOT_IN_THE_BANDS_FORM');
  n(x.b !== 0, 'NO_LINEAR_TERM');
  return i;
};
export const QUADRATIC_MINIMUM_VALUE: ParametricConstruct<QminParameters> = {
  construct: 'QUADRATIC_MINIMUM_VALUE', rendererVersion: 'cf.ib.quadratic-minimum-value@0.1.0', languages: ['en'],
  enumerate(band) {
    const out: QminParameters[] = [];
    for (const a of band === 'FOUNDATIONAL' ? [1] : [2, 3, 4]) for (let b = -16; b <= 16; b++) for (let c = 1; c <= 40; c++) { const x = { a, b, c }; if (qminBand(band, x).length === 0) out.push(x); }
    return withoutCollisions(this, out);
  },
  bandIssues: qminBand,
  present: (x) => `Let f(x) = ${poly([x.a, x.b, x.c])}, x ∈ ℝ. Find the minimum value of f(x).`,
  answer: (x) => writeRational(qminValue(x)),
  // evaluate f at the vertex abscissa (from the derivative's zero), not the completed-square formula
  keyHolds: (x, key) => sameRational(evalPoly([x.a, x.b, x.c], R(-x.b, 2 * x.a)), key) && key.n > 0,
  misconceptionAnswers: (x) => [
    { id: 'gives-the-x-coordinate-of-the-vertex', value: R(-x.b, 2 * x.a) },
    { id: 'gives-the-y-intercept', value: fromInt(x.c) },
    { id: 'adds-the-square-term', value: add(fromInt(x.c), R(x.b * x.b, 4 * x.a)) },
  ],
  recognitionKey: (x) => `${x.a}|${x.b}|${x.c}`,
};

// ============================================================ 5. DEFINITE_INTEGRAL_POLYNOMIAL (P1 calculus)
export interface IntParameters extends Record<string, number | string> { c3: number; c2: number; c1: number; c0: number; lo: number; hi: number }
const antider = (x: IntParameters, t: Rational): Rational => { const t2 = mul(t, t); const t3 = mul(t2, t); const t4 = mul(t3, t); return add(add(add(mul(R(x.c3, 4), t4), mul(R(x.c2, 3), t3)), mul(R(x.c1, 2), t2)), mul(fromInt(x.c0), t)); };
const intValue = (x: IntParameters): Rational => sub(antider(x, fromInt(x.hi)), antider(x, fromInt(x.lo)));
const intBand = (band: PlanningBand, x: IntParameters): string[] => {
  const i: string[] = []; const n = need(i); const v = intValue(x);
  n(band === 'FOUNDATIONAL' ? x.c3 === 0 && x.c0 === 0 && x.lo >= 1 : band === 'STANDARD' ? x.c3 === 0 && x.lo <= 0 : x.c3 !== 0, 'TERMS_OR_LIMITS_NOT_THE_BANDS');
  n(v.n > 0 && (band === 'CHALLENGE' ? v.d > 1 : v.d === 1), 'VALUE_NOT_POSITIVE_OR_NOT_IN_THE_BANDS_FORM');
  n(x.hi > x.lo && x.hi - x.lo <= 4, 'LIMITS_OUTSIDE_THE_ENVELOPE');
  return i;
};
export const DEFINITE_INTEGRAL_POLYNOMIAL: ParametricConstruct<IntParameters> = {
  construct: 'DEFINITE_INTEGRAL_POLYNOMIAL', rendererVersion: 'cf.ib.definite-integral-polynomial@0.1.0', languages: ['en'],
  enumerate(band) {
    const out: IntParameters[] = [];
    const c3s = band === 'CHALLENGE' ? [1, 2, -1] : [0];
    for (const c3 of c3s) for (let c2 = -3; c2 <= 6; c2 += 3) for (let c1 = -4; c1 <= 6; c1 += 2) for (const c0 of band === 'FOUNDATIONAL' ? [0] : [-2, 0, 1, 3]) for (let lo = band === 'FOUNDATIONAL' ? 1 : -2; lo <= (band === 'FOUNDATIONAL' ? 2 : band === 'STANDARD' ? 0 : 2); lo++) for (let hi = lo + 1; hi <= lo + 4; hi++) {
      if (c2 === 0 && c1 === 0) continue;
      const x = { c3, c2, c1, c0, lo, hi };
      if (c3 === 0 && c2 === 3 && c1 === -2 && c0 === 0 && lo === 0 && hi === 2) continue; // the vertical's fixture
      if (intBand(band, x).length === 0) out.push(x);
    }
    return withoutCollisions(this, out);
  },
  bandIssues: intBand,
  present: (x) => `Find the exact value of ∫${lowerLimit(x.lo)}${upperLimit(x.hi)} (${poly([x.c3, x.c2, x.c1, x.c0].slice(x.c3 === 0 ? 1 : 0))}) dx.`,
  answer: (x) => writeRational(intValue(x)),
  // Simpson's rule is exact for polynomials of degree <= 3: (h/6)(f(lo) + 4 f(mid) + f(hi))
  keyHolds: (x, key) => { const f = (t: Rational) => evalPoly([x.c3, x.c2, x.c1, x.c0], t); const lo = fromInt(x.lo); const hi = fromInt(x.hi); const mid = R(x.lo + x.hi, 2); return key.n > 0 && sameRational(key, mul(R(x.hi - x.lo, 6), add(add(f(lo), mul(fromInt(4), f(mid))), f(hi)))); },
  misconceptionAnswers: (x) => [
    { id: 'evaluates-only-the-upper-limit', value: antider(x, fromInt(x.hi)) },
    { id: 'reverses-the-limits', value: sub(antider(x, fromInt(x.lo)), antider(x, fromInt(x.hi))) },
    { id: 'subtracts-the-integrand-values', value: sub(evalPoly([x.c3, x.c2, x.c1, x.c0], fromInt(x.hi)), evalPoly([x.c3, x.c2, x.c1, x.c0], fromInt(x.lo))) },
  ],
  recognitionKey: (x) => `${x.c3}|${x.c2}|${x.c1}|${x.c0}|${x.lo}|${x.hi}`,
};
const SUPS = '⁰¹²³⁴⁵⁶⁷⁸⁹';
function lowerLimit(n: number): string { return `${n < 0 ? '₋' : ''}${sub10(Math.abs(n))}`; }
function upperLimit(n: number): string { return `${n < 0 ? '⁻' : ''}${String(Math.abs(n)).split('').map((d) => SUPS[Number(d)]).join('')}`; }

// ============================================================ 6. AREA_BETWEEN_CURVE_AND_AXIS (P1 calculus)
export interface AreaParameters extends Record<string, number | string> { k: number; r: number; s: number }
// y = k (x - r)(s - x) = -k x^2 + k (r + s) x - k r s, positive between its roots r < s
const areaCoeffs = (x: AreaParameters): number[] => [-x.k, x.k * (x.r + x.s), -x.k * x.r * x.s];
const areaBand = (band: PlanningBand, x: AreaParameters): string[] => {
  const i: string[] = []; const n = need(i);
  n(band === 'FOUNDATIONAL' ? x.k === 1 && x.r === 0 : band === 'STANDARD' ? x.k === 1 && x.r !== 0 : x.k >= 2, 'CURVE_NOT_THE_BANDS');
  n(x.s > x.r && x.s - x.r <= 12 && x.r >= -4, 'ROOTS_OUTSIDE_THE_ENVELOPE');
  return i;
};
export const AREA_BETWEEN_CURVE_AND_AXIS: ParametricConstruct<AreaParameters> = {
  construct: 'AREA_BETWEEN_CURVE_AND_AXIS', rendererVersion: 'cf.ib.area-between-curve-and-axis@0.1.0', languages: ['en'],
  enumerate(band) {
    const out: AreaParameters[] = [];
    for (const k of band === 'CHALLENGE' ? [2, 3] : [1]) for (let r = band === 'FOUNDATIONAL' ? 0 : -4; r <= (band === 'FOUNDATIONAL' ? 0 : 5); r++) for (let s = r + 1; s <= r + 12; s++) { const x = { k, r, s }; if (areaBand(band, x).length === 0) out.push(x); }
    return withoutCollisions(this, out);
  },
  bandIssues: areaBand,
  present: (x) => `The curve y = ${poly(areaCoeffs(x))} meets the x-axis at two points. Find the exact area of the region enclosed by the curve and the x-axis.`,
  answer: (x) => writeRational(R(x.k * (x.s - x.r) ** 3, 6)),
  // roots recovered from the SHOWN coefficients (integer discriminant), then Simpson on [r, s] (exact for a quadratic)
  keyHolds: (x, key) => { const [A, B, C] = areaCoeffs(x); const disc = B * B - 4 * A * C; const sq = Math.round(Math.sqrt(disc)); if (sq * sq !== disc) return false; const r1 = R(-B + sq, 2 * A); const r2 = R(-B - sq, 2 * A); const lo = r1.n / r1.d < r2.n / r2.d ? r1 : r2; const hi = lo === r1 ? r2 : r1; const f = (t: Rational) => evalPoly([A, B, C], t); const mid = div(add(lo, hi), fromInt(2)); const area = mul(div(sub(hi, lo), fromInt(6)), add(add(f(lo), mul(fromInt(4), f(mid))), f(hi))); return key.n > 0 && sameRational(key, area); },
  misconceptionAnswers: (x) => [
    { id: 'gives-the-maximum-height', value: R(x.k * (x.s - x.r) ** 2, 4) },
    { id: 'divides-by-three-not-six', value: R(x.k * (x.s - x.r) ** 3, 3) },
    { id: 'forgets-the-leading-coefficient', value: x.k === 1 ? null : R((x.s - x.r) ** 3, 6) },
  ],
  recognitionKey: (x) => `${x.k}|${x.r}|${x.s}`,
};

// ============================================================= 7. TANGENT_GRADIENT_AT_A_POINT (P1 calculus)
export interface GradParameters extends Record<string, number | string> { c3: number; c2: number; c1: number; c0: number; t: number; form: 'EXPANDED' | 'PRODUCT'; u: number; w: number }
// PRODUCT form: y = (x^2 + u)(x + w) = x^3 + w x^2 + u x + u w
const gradCoeffs = (x: GradParameters): number[] => x.form === 'PRODUCT' ? [1, x.w, x.u, x.u * x.w] : [x.c3, x.c2, x.c1, x.c0];
const gradValue = (x: GradParameters): Rational => { const [a, b, c] = gradCoeffs(x); return fromInt(3 * a * x.t * x.t + 2 * b * x.t + c); };
const gradBand = (band: PlanningBand, x: GradParameters): string[] => {
  const i: string[] = []; const n = need(i); const v = gradValue(x);
  n(band === 'FOUNDATIONAL' ? x.form === 'EXPANDED' && x.c3 === 0 : band === 'STANDARD' ? x.form === 'EXPANDED' && x.c3 !== 0 : x.form === 'PRODUCT', 'FORM_IS_NOT_THE_BANDS');
  n(v.n > 0 && v.n <= 200, 'GRADIENT_NOT_POSITIVE_OR_OUTSIDE_THE_ENVELOPE');
  return i;
};
export const TANGENT_GRADIENT_AT_A_POINT: ParametricConstruct<GradParameters> = {
  construct: 'TANGENT_GRADIENT_AT_A_POINT', rendererVersion: 'cf.ib.tangent-gradient-at-a-point@0.1.0', languages: ['en'],
  enumerate(band) {
    const out: GradParameters[] = [];
    if (band === 'FOUNDATIONAL') for (let c2 = 1; c2 <= 5; c2++) for (let c1 = -6; c1 <= 6; c1++) for (const c0 of [-3, 2, 5]) for (let t = -3; t <= 4; t++) out.push({ c3: 0, c2, c1, c0, t, form: 'EXPANDED', u: 0, w: 0 });
    if (band === 'STANDARD') for (const c3 of [1, 2, -1]) for (let c2 = -3; c2 <= 3; c2++) for (const c1 of [-5, 1, 4]) for (const c0 of [-2, 3]) for (let t = -2; t <= 3; t++) out.push({ c3, c2, c1, c0, t, form: 'EXPANDED', u: 0, w: 0 });
    if (band === 'CHALLENGE') for (let u = -4; u <= 5; u++) for (let w = -4; w <= 4; w++) for (let t = -2; t <= 3; t++) { if (u === 0 || w === 0) continue; out.push({ c3: 0, c2: 0, c1: 0, c0: 0, t, form: 'PRODUCT', u, w }); }
    return withoutCollisions(this, out.filter((x) => gradBand(band, x).length === 0));
  },
  bandIssues: gradBand,
  present: (x) => x.form === 'PRODUCT'
    ? `A curve has equation y = (${poly([1, 0, x.u])})(${lin(1, x.w)}). Find the gradient of the tangent to the curve at the point where x = ${frac(fromInt(x.t))}.`
    : `A curve has equation y = ${poly([x.c3, x.c2, x.c1, x.c0].slice(x.c3 === 0 ? 1 : 0))}. Find the gradient of the tangent to the curve at the point where x = ${frac(fromInt(x.t))}.`,
  answer: (x) => writeRational(gradValue(x)),
  // Richardson extrapolation of central differences is exact for a cubic: (4 D(h/2) - D(h)) / 3
  keyHolds: (x, key) => { const f = (s: Rational) => evalPoly(gradCoeffs(x), s); const t = fromInt(x.t); const D = (h: Rational) => div(sub(f(add(t, h)), f(sub(t, h))), mul(fromInt(2), h)); return key.n > 0 && sameRational(key, div(sub(mul(fromInt(4), D(R(1, 2))), D(fromInt(1))), fromInt(3))); },
  misconceptionAnswers: (x) => { const [a, b, c, d] = gradCoeffs(x); const t = x.t; return [
    { id: 'gives-the-y-coordinate', value: evalPoly([a, b, c, d], fromInt(t)) },
    { id: 'drops-the-power-without-multiplying', value: fromInt(a * t * t + b * t + c) },
    { id: 'multiplies-the-derivatives-of-the-factors', value: x.form === 'PRODUCT' ? fromInt(2 * t) : null },
  ]; },
  recognitionKey: (x) => `${x.form}|${gradCoeffs(x).join(',')}|${x.t}`,
};

// =================================================================== 8. CUBIC_LOCAL_MAXIMUM (P1 calculus)
export interface CubicParameters extends Record<string, number | string> { lead: 1 | -1; r: number; s: number; d: number; ask: 'X_OF_MAXIMUM' | 'MAXIMUM_VALUE' }
// y' = 3 lead (x - r)(x - s), r < s, r + s even: y = lead (x^3 - 3(r+s)/2 x^2 + 3 r s x) + d
const cubicCoeffs = (x: CubicParameters): number[] => [x.lead, -x.lead * (3 * (x.r + x.s)) / 2, x.lead * 3 * x.r * x.s, x.d];
const cubicMaxX = (x: CubicParameters): number => (x.lead === 1 ? x.r : x.s);
const cubicBand = (band: PlanningBand, x: CubicParameters): string[] => {
  const i: string[] = []; const n = need(i);
  n(band === 'FOUNDATIONAL' ? x.lead === 1 && x.ask === 'X_OF_MAXIMUM' : band === 'STANDARD' ? x.lead === -1 && x.ask === 'X_OF_MAXIMUM' : x.lead === 1 && x.ask === 'MAXIMUM_VALUE', 'LEVERS_ARE_NOT_THE_BANDS');
  n((x.r + x.s) % 2 === 0 && x.s > x.r, 'STATIONARY_POINTS_NOT_IN_THE_ENVELOPE');
  const key = x.ask === 'X_OF_MAXIMUM' ? cubicMaxX(x) : evalPoly(cubicCoeffs(x), fromInt(x.r)).n;
  n(key > 0 && key <= 500, 'KEY_NOT_POSITIVE_OR_OUTSIDE_THE_ENVELOPE');
  return i;
};
export const CUBIC_LOCAL_MAXIMUM: ParametricConstruct<CubicParameters> = {
  construct: 'CUBIC_LOCAL_MAXIMUM', rendererVersion: 'cf.ib.cubic-local-maximum@0.1.0', languages: ['en'],
  enumerate(band) {
    const out: CubicParameters[] = [];
    const lead = band === 'STANDARD' ? -1 : 1; const ask = band === 'CHALLENGE' ? 'MAXIMUM_VALUE' : 'X_OF_MAXIMUM';
    for (let r = -6; r <= 8; r++) for (let s = r + 2; s <= r + 10; s += 2) for (const d of band === 'CHALLENGE' ? [-10, -4, 0, 5, 12, 20] : [-7, 0, 4]) { const x: CubicParameters = { lead: lead as 1 | -1, r, s, d, ask }; if (cubicBand(band, x).length === 0) out.push(x); }
    return withoutCollisions(this, out);
  },
  bandIssues: cubicBand,
  present: (x) => x.ask === 'X_OF_MAXIMUM'
    ? `A curve has equation y = ${poly(cubicCoeffs(x))}. Find the x-coordinate of the local maximum point of the curve.`
    : `A curve has equation y = ${poly(cubicCoeffs(x))}. Find the y-coordinate of the local maximum point of the curve.`,
  answer: (x) => String(x.ask === 'X_OF_MAXIMUM' ? cubicMaxX(x) : evalPoly(cubicCoeffs(x), fromInt(cubicMaxX(x))).n),
  // independent route: scan the integers for the point where the (exact, Richardson) derivative is 0 and the
  // second difference f(t+1) + f(t-1) - 2 f(t) (exactly f''(t) for a cubic) is negative
  keyHolds: (x, key) => { const c = cubicCoeffs(x); const f = (t: Rational) => evalPoly(c, t); const D = (t: Rational, h: Rational) => div(sub(f(add(t, h)), f(sub(t, h))), mul(fromInt(2), h)); const d1 = (t: Rational) => div(sub(mul(fromInt(4), D(t, R(1, 2))), D(t, fromInt(1))), fromInt(3));
    const maxima: number[] = []; for (let t = -20; t <= 20; t++) { const T = fromInt(t); if (d1(T).n === 0 && sub(add(f(add(T, fromInt(1))), f(sub(T, fromInt(1)))), mul(fromInt(2), f(T))).n < 0) maxima.push(t); }
    if (maxima.length !== 1) return false; const want = x.ask === 'X_OF_MAXIMUM' ? fromInt(maxima[0]) : f(fromInt(maxima[0])); return key.n > 0 && sameRational(key, want); },
  misconceptionAnswers: (x) => { const c = cubicCoeffs(x); const minX = x.lead === 1 ? x.s : x.r; return x.ask === 'X_OF_MAXIMUM' ? [
    { id: 'gives-the-local-minimum', value: fromInt(minX) },
    { id: 'gives-the-maximum-value', value: evalPoly(c, fromInt(cubicMaxX(x))) },
  ] : [
    { id: 'gives-the-x-coordinate', value: fromInt(cubicMaxX(x)) },
    { id: 'gives-the-local-minimum-value', value: evalPoly(c, fromInt(minX)) },
  ]; },
  recognitionKey: (x) => `${x.lead}|${x.r}|${x.s}|${x.d}|${x.ask}`,
};

// ============================================================ 9. BINOMIAL_EXACT_PROBABILITY (P2 statistics)
export interface BinParameters extends Record<string, number | string> { n: number; pn: number; pd: number; k: number; event: 'EQUALS' | 'AT_MOST' | 'AT_LEAST' }
const choose = (n: number, k: number): number => { let c = 1; for (let i = 1; i <= k; i++) c = (c * (n - k + i)) / i; return c; };
const pmf = (x: BinParameters, j: number): Rational => mul(fromInt(choose(x.n, j)), mul(R(x.pn ** j, x.pd ** j), R((x.pd - x.pn) ** (x.n - j), x.pd ** (x.n - j))));
const binValue = (x: BinParameters): Rational => { let s = fromInt(0); for (let j = 0; j <= x.n; j++) if (x.event === 'EQUALS' ? j === x.k : x.event === 'AT_MOST' ? j <= x.k : j >= x.k) s = add(s, pmf(x, j)); return s; };
const binBand = (band: PlanningBand, x: BinParameters): string[] => {
  const i: string[] = []; const n = need(i);
  n((band === 'FOUNDATIONAL' ? 'EQUALS' : band === 'STANDARD' ? 'AT_MOST' : 'AT_LEAST') === x.event, 'EVENT_IS_NOT_THE_BANDS');
  n(x.n >= 3 && x.n <= 6 && x.pd <= 6 && x.pn >= 1 && x.pn < x.pd && gcdN(x.pn, x.pd) === 1, 'OUTSIDE_THE_ENVELOPE');
  n(x.event === 'EQUALS' ? x.k >= 1 && x.k < x.n : x.k >= 1 && x.k <= x.n - 1, 'TRIVIAL_EVENT');
  n(binValue(x).d <= 50000, 'DENOMINATOR_TOO_LARGE_TO_ENTER');
  return i;
};
/** Contexts are chosen BY the numbers (never enumerated): the same numbers in another context are the same question. */
const BIN_CONTEXTS: readonly ((n: number, p: string) => string)[] = [
  (n, p) => `The random variable X follows a binomial distribution, X ~ B(${n}, ${p}).`,
  (n, p) => `A spinner lands on red with probability ${p}. It is spun ${n} times and the spins are independent. Let X be the number of times it lands on red.`,
  (n, p) => `Each seed in a packet germinates with probability ${p}, independently of the others. ${n} seeds are planted. Let X be the number of seeds that germinate.`,
  (n, p) => `A basketball player scores each free throw with probability ${p}, independently. The player takes ${n} free throws. Let X be the number of free throws scored.`,
];
export const BINOMIAL_EXACT_PROBABILITY: ParametricConstruct<BinParameters> = {
  construct: 'BINOMIAL_EXACT_PROBABILITY', rendererVersion: 'cf.ib.binomial-exact-probability@0.1.0', languages: ['en'],
  enumerate(band) {
    const out: BinParameters[] = []; const event = band === 'FOUNDATIONAL' ? 'EQUALS' : band === 'STANDARD' ? 'AT_MOST' : 'AT_LEAST';
    for (let n = 3; n <= 6; n++) for (const [pn, pd] of [[1, 2], [1, 3], [2, 3], [1, 4], [3, 4], [1, 5], [2, 5], [1, 6]]) for (let k = 1; k < n; k++) { const x: BinParameters = { n, pn, pd, k, event }; if (binBand(band, x).length === 0) out.push(x); }
    return withoutCollisions(this, out);
  },
  bandIssues: binBand,
  present: (x) => { const ev = x.event === 'EQUALS' ? `P(X = ${x.k})` : x.event === 'AT_MOST' ? `P(X ≤ ${x.k})` : `P(X ≥ ${x.k})`; const p = `${x.pn}/${x.pd}`; const ctx = BIN_CONTEXTS[(x.n * 7 + x.k * 3 + x.pd + x.pn) % BIN_CONTEXTS.length]; return `${ctx(x.n, p)} Find ${ev}. Give your answer as an exact fraction.`; },
  answer: (x) => writeRational(binValue(x)),
  // brute force: every one of the 2^n success/failure sequences, weighted, counted when it is in the event
  keyHolds: (x, key) => { let s = fromInt(0); const p = R(x.pn, x.pd); const q = R(x.pd - x.pn, x.pd); for (let m = 0; m < 2 ** x.n; m++) { let w = fromInt(1); let succ = 0; for (let b = 0; b < x.n; b++) { if ((m >> b) & 1) { w = mul(w, p); succ++; } else w = mul(w, q); } if (x.event === 'EQUALS' ? succ === x.k : x.event === 'AT_MOST' ? succ <= x.k : succ >= x.k) s = add(s, w); } return key.n > 0 && sameRational(s, key); },
  misconceptionAnswers: (x) => [
    { id: 'forgets-the-binomial-coefficient', value: x.event === 'EQUALS' ? mul(R(x.pn ** x.k, x.pd ** x.k), R((x.pd - x.pn) ** (x.n - x.k), x.pd ** (x.n - x.k))) : null },
    { id: 'gives-only-the-point-probability', value: x.event === 'EQUALS' ? null : pmf(x, x.k) },
    { id: 'uses-the-wrong-tail', value: x.event === 'EQUALS' ? null : sub(fromInt(1), binValue(x)) },
    { id: 'swaps-p-and-q', value: x.event === 'EQUALS' ? binValue({ ...x, pn: x.pd - x.pn }) : null },
  ],
  recognitionKey: (x) => `${x.event}|${x.n}|${x.pn}/${x.pd}|${x.k}`,
};

// =================================================================== 10. NORMAL_SYMMETRY (P2 statistics)
export interface NormParameters extends Record<string, number | string> { task: 'MEAN_FROM_EQUAL_TAILS' | 'TAIL_FROM_CENTRAL' | 'LOWER_FROM_UPPER'; a: number; b: number; mu: number; given: number }
// `given` is in hundredths (0.84 -> 84) so every number stays exact. The standard deviation is NEVER stated: with σ
// shown, a central probability is fixed by σ (about 0.683 within one σ), and an arbitrary given value would make
// the item self-contradictory. Without σ every given value in (0.5, 1) is consistent with exactly one σ.
const normValue = (x: NormParameters): Rational => x.task === 'MEAN_FROM_EQUAL_TAILS' ? R(x.a + x.b, 2) : x.task === 'TAIL_FROM_CENTRAL' ? R(100 - x.given, 200) : R(100 - x.given, 100);
const normBand = (band: PlanningBand, x: NormParameters): string[] => {
  const i: string[] = []; const n = need(i); const v = normValue(x);
  n((band === 'FOUNDATIONAL' ? 'MEAN_FROM_EQUAL_TAILS' : band === 'STANDARD' ? 'TAIL_FROM_CENTRAL' : 'LOWER_FROM_UPPER') === x.task, 'TASK_IS_NOT_THE_BANDS');
  n(v.n > 0 && (x.task !== 'MEAN_FROM_EQUAL_TAILS' || v.d === 1), 'KEY_NOT_POSITIVE_OR_NOT_AN_INTEGER_MEAN');
  n(x.task === 'MEAN_FROM_EQUAL_TAILS' ? x.b > x.a : x.given > 50 && x.given < 100 && x.given % 2 === 0, 'GIVEN_OUTSIDE_THE_ENVELOPE');
  return i;
};
const NORM_CONTEXTS: readonly ((mean: string) => string)[] = [
  (m) => `The random variable X is normally distributed with mean ${m}.`,
  (m) => `The mass, X grams, of a bag of rice filled by a machine is normally distributed with mean ${m}.`,
  (m) => `The time, X minutes, that students take to complete a puzzle is normally distributed with mean ${m}.`,
];
export const NORMAL_SYMMETRY: ParametricConstruct<NormParameters> = {
  construct: 'NORMAL_SYMMETRY', rendererVersion: 'cf.ib.normal-symmetry@0.1.0', languages: ['en'],
  enumerate(band) {
    const out: NormParameters[] = [];
    if (band === 'FOUNDATIONAL') for (let a = 10; a <= 80; a += 2) for (let gap = 4; gap <= 30; gap += 2) out.push({ task: 'MEAN_FROM_EQUAL_TAILS', a, b: a + gap, mu: 0, given: 0 });
    else for (const mu of [20, 50, 75, 120]) for (const w of [3, 4, 6, 8, 10, 12]) for (let given = 52; given <= 98; given += 2) out.push({ task: band === 'STANDARD' ? 'TAIL_FROM_CENTRAL' : 'LOWER_FROM_UPPER', a: mu - w, b: mu + w, mu, given });
    return withoutCollisions(this, out.filter((x) => normBand(band, x).length === 0));
  },
  bandIssues: normBand,
  present: (x) => { const ctx = NORM_CONTEXTS[(x.a + 3 * x.b + x.given) % NORM_CONTEXTS.length]; const g = (x.given / 100).toFixed(2); return x.task === 'MEAN_FROM_EQUAL_TAILS'
    ? `${ctx('μ')} It is known that P(X < ${x.a}) = P(X > ${x.b}). Find μ.`
    : x.task === 'TAIL_FROM_CENTRAL'
      ? `${ctx(String(x.mu))} Given that P(${x.a} < X < ${x.b}) = ${g}, find P(X > ${x.b}).`
      : `${ctx(String(x.mu))} Given that P(X < ${x.b}) = ${g}, find P(X < ${x.a}).`; },
  answer: (x) => { const v = normValue(x); return x.task === 'MEAN_FROM_EQUAL_TAILS' ? writeRational(v) : decimalOf(v)!; },
  // symmetry about the mean, checked from the other side: equal distances / the two tails and the centre sum to 1
  keyHolds: (x, key) => key.n > 0 && (x.task === 'MEAN_FROM_EQUAL_TAILS' ? sameRational(sub(key, fromInt(x.a)), sub(fromInt(x.b), key))
    : x.task === 'TAIL_FROM_CENTRAL' ? sameRational(add(mul(fromInt(2), key), R(x.given, 100)), fromInt(1))
    : sameRational(add(key, R(x.given, 100)), fromInt(1))),
  misconceptionAnswers: (x) => x.task === 'MEAN_FROM_EQUAL_TAILS' ? [
    { id: 'adds-the-two-values', value: fromInt(x.a + x.b) },
    { id: 'gives-half-the-gap', value: R(x.b - x.a, 2) },
  ] : x.task === 'TAIL_FROM_CENTRAL' ? [
    { id: 'gives-the-complement-of-the-centre', value: R(100 - x.given, 100) },
    { id: 'halves-the-centre', value: R(x.given, 200) },
  ] : [
    { id: 'gives-the-given-probability', value: R(x.given, 100) },
    { id: 'subtracts-a-half', value: R(x.given - 50, 100) },
  ],
  recognitionKey: (x) => `${x.task}|${x.a}|${x.b}|${x.given}`,
};

export const CF_IB_AAHL_01_CONSTRUCTS = [GEOMETRIC_SUM_TO_INFINITY, LOG_EQUATION, INVERSE_FUNCTION_VALUE, QUADRATIC_MINIMUM_VALUE, DEFINITE_INTEGRAL_POLYNOMIAL, AREA_BETWEEN_CURVE_AND_AXIS, TANGENT_GRADIENT_AT_A_POINT, CUBIC_LOCAL_MAXIMUM, BINOMIAL_EXACT_PROBABILITY, NORMAL_SYMMETRY] as const;
