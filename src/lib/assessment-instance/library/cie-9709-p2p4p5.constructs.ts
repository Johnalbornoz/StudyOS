/**
 * Cambridge 9709 Papers 2, 4 and 5 -- ten StudyUs-original PARAMETRIC_DETERMINISTIC constructs (pure data + pure
 * functions, no IO, no provider). Every prompt uses a command word of the 9709 syllabus's own table (determine /
 * calculate) and asks for ONE exact value; every key is recomputed by `keyHolds` from the shown numbers by another
 * route (substitution, simulation, numerical differentiation / integration, enumeration).
 *
 *   P2 Logarithmic and exponential functions  CIE_LOG_EXP_EQUATION            exponential / logarithmic equation
 *   P2 Differentiation                        CIE_PRODUCT_QUOTIENT_GRADIENT   product / quotient / chain rule gradient
 *   P2 Numerical solution of equations        CIE_NUMERICAL_ROOT              sign change, fixed-point iteration, located root
 *   P4 Kinematics                             CIE_CONSTANT_ACCELERATION       constant acceleration (suvat)
 *   P4 Forces and equilibrium                 CIE_FORCES_ON_A_PLANE           Newton's second law / friction on a plane
 *   P4 Energy, work and power                 CIE_ENERGY_WORK_POWER           power, driving force, work against resistance
 *   P5 Permutations and combinations          CIE_COUNTING_ARRANGEMENTS       selections, committees, restricted arrangements
 *   P5 Probability                            CIE_PROBABILITY_EVENTS          independent events, conditional, without replacement
 *   P5 Discrete random variables              CIE_BINOMIAL_EXACT              binomial variance and probabilities
 *   P5 The normal distribution                CIE_NORMAL_EXACT                standardising, symmetry, mean from two statements
 *
 * The bands of every construct are mutually exclusive: each band has its own form (a CATEGORY parameter), so no
 * parameter set belongs to two bands. Paper 4 prompts that use gravity state g = 10 m s⁻² (the syllabus convention).
 */
import { rational, readRational, sameRational, writeRational, type ParametricConstruct, type PlanningBand, type Rational } from './parametric';
import { decimalIsAmbiguous } from './cf-ib-aahl-01.constructs';

const R = (n: number, d = 1): Rational => rational(n, d);
const igcd = (a: number, b: number): number => (b === 0 ? Math.abs(a) : igcd(b, a % b));
const add = (x: Rational, y: Rational): Rational => { const g = igcd(x.d, y.d); return R(x.n * (y.d / g) + y.n * (x.d / g), (x.d / g) * y.d); };
const sub = (x: Rational, y: Rational): Rational => add(x, R(-y.n, y.d));
const mul = (x: Rational, y: Rational): Rational => { const g1 = igcd(x.n, y.d) || 1; const g2 = igcd(y.n, x.d) || 1; return R((x.n / g1) * (y.n / g2), (x.d / g2) * (y.d / g1)); };
const div = (x: Rational, y: Rational): Rational => mul(x, R(y.d, y.n));
const isZero = (x: Rational): boolean => x.n === 0;
const need = (issues: string[]) => (ok: boolean, miss: string) => { if (!ok) issues.push(miss); };
const minus = (n: number): string => (n < 0 ? `−${-n}` : String(n));
/** "+ 3" / "− 3" for a term after the first. */
const signed = (n: number): string => (n < 0 ? `− ${-n}` : `+ ${n}`);
/** a coefficient in front of x: 1 -> "", 3 -> "3" */
const coef = (n: number): string => (n === 1 ? '' : String(n));
const fracText = (x: Rational): string => writeRational(x).replace('-', '−');
const decimalText = (halves: number): string => minus(halves / 2);
const SUBSCRIPT = '₀₁₂₃₄₅₆₇₈₉';
const subscript = (n: number): string => String(n).split('').map((d) => SUBSCRIPT[Number(d)]).join('');
const ipow = (a: number, e: number): number => { let r = 1; for (let i = 0; i < e; i++) r *= a; return r; };
const factorial = (n: number): number => { let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; };
const choose = (n: number, r: number): number => factorial(n) / (factorial(r) * factorial(n - r));
const perm = (n: number, r: number): number => factorial(n) / factorial(n - r);
/** C(n, r) from Pascal's triangle (additive), an independent route to the factorial formula. */
const pascal = (n: number, r: number): number => { let row = [1]; for (let i = 1; i <= n; i++) { const next = [1]; for (let j = 1; j < i; j++) next.push(row[j - 1] + row[j]); next.push(1); row = next; } return r < 0 || r > n ? 0 : row[r]; };
const bandForm = <F extends string>(forms: Record<PlanningBand, readonly F[]>, band: PlanningBand, form: F): boolean => forms[band].includes(form);
/** Drop parameter sets whose key is not a positive exact value, is a decimal the scorers read differently, or equals a modelled misconception. */
const clean = <P extends Record<string, number | string>>(c: Pick<ParametricConstruct<P>, 'answer' | 'misconceptionAnswers'>, sets: P[]): P[] =>
  sets.filter((p) => { const k = readRational(c.answer(p)); return k !== null && k.n > 0 && !decimalIsAmbiguous(k) && !c.misconceptionAnswers(p).some((m) => m.value !== null && sameRational(m.value, k)); });

// ====================================================================== P2 Logarithmic and exponential functions
/**
 * EXP_LINEAR      a^(kx + m) = N with N = a^q:              x = (q − m) / k
 * LOG_SUM         log_a(x + p) + log_a x = q:               x(x + p) = a^q, the positive root r (p = a^q / r − r)
 * LOG_DIFFERENCE  log_a(x + p) − log_a(x − c) = q:          x + p = a^q (x − c), x = (p + a^q c) / (a^q − 1)
 */
export interface LogExpParameters extends Record<string, number | string> { form: 'EXP_LINEAR' | 'LOG_SUM' | 'LOG_DIFFERENCE'; a: number; q: number; k: number; m: number; p: number; c: number }
const LOG_FORMS = { FOUNDATIONAL: ['EXP_LINEAR'], STANDARD: ['LOG_SUM'], CHALLENGE: ['LOG_DIFFERENCE'] } as const;
const logKey = (x: LogExpParameters): Rational => {
  const A = ipow(x.a, x.q);
  if (x.form === 'EXP_LINEAR') return R(x.q - x.m, x.k);
  if (x.form === 'LOG_SUM') return R((-x.p + Math.round(Math.sqrt(x.p * x.p + 4 * A))) / 2);
  return R(x.p + A * x.c, A - 1);
};
const logBand = (band: PlanningBand, x: LogExpParameters): string[] => {
  const i: string[] = []; const n = need(i); const A = ipow(x.a, x.q);
  n(bandForm(LOG_FORMS, band, x.form as never), 'FORM_IS_NOT_THE_BANDS');
  n(x.a >= 2 && x.q >= 1 && A <= 1000, 'POWER_OUTSIDE_THE_ENVELOPE');
  if (x.form === 'EXP_LINEAR') n(x.k >= 2 && x.m !== 0 && x.q > x.m, 'EXPONENT_OUTSIDE_THE_ENVELOPE');
  if (x.form === 'LOG_SUM') n(x.p >= 1 && Number.isInteger(Math.sqrt(x.p * x.p + 4 * A)), 'NO_INTEGER_ROOT');
  if (x.form === 'LOG_DIFFERENCE') n(x.p >= 1 && x.c >= 1 && A >= 2, 'SHIFTS_OUTSIDE_THE_ENVELOPE');
  return i;
};
export const CIE_LOG_EXP_EQUATION: ParametricConstruct<LogExpParameters> = {
  construct: 'CIE_LOG_EXP_EQUATION', rendererVersion: 'tb.cie.log-exp-equation@0.1.0', languages: ['en'],
  enumerate(band) {
    const out: LogExpParameters[] = [];
    if (band === 'FOUNDATIONAL') {
      for (const a of [2, 3, 5]) for (let q = 1; ipow(a, q) <= 1000; q++) for (let k = 2; k <= 5; k++) for (const m of [-3, -2, -1, 1, 2, 3]) out.push({ form: 'EXP_LINEAR', a, q, k, m, p: 0, c: 0 });
    } else if (band === 'STANDARD') {
      for (const a of [2, 3, 4, 5, 6, 7, 10]) for (let q = 2; ipow(a, q) <= 1000; q++) { const A = ipow(a, q); for (let r = 1; r * r < A; r++) if (A % r === 0) out.push({ form: 'LOG_SUM', a, q, k: 0, m: 0, p: A / r - r, c: 0 }); }
    } else {
      for (const a of [2, 3, 5, 10]) for (let q = 1; ipow(a, q) <= 100; q++) for (let p = 1; p <= 9; p++) for (let c = 1; c <= 5; c++) out.push({ form: 'LOG_DIFFERENCE', a, q, k: 0, m: 0, p, c });
    }
    return clean(this, out.filter((x) => logBand(band, x).length === 0));
  },
  bandIssues: logBand,
  present: (x) => {
    const lg = `log${subscript(x.a)}`;
    if (x.form === 'EXP_LINEAR') return `Determine the exact value of x for which ${x.a}^(${x.k}x ${signed(x.m)}) = ${ipow(x.a, x.q)}.`;
    if (x.form === 'LOG_SUM') return `Determine the value of x for which ${lg}(x + ${x.p}) + ${lg} x = ${x.q}.`;
    return `Determine the exact value of x for which ${lg}(x + ${x.p}) − ${lg}(x − ${x.c}) = ${x.q}. Give your answer as an exact value.`;
  },
  answer: (x) => writeRational(logKey(x)),
  // by substitution into the shown equation, with exact arithmetic (no logarithm is taken)
  keyHolds: (x, key) => {
    if (key.n <= 0) return false;
    const A = ipow(x.a, x.q);
    if (x.form === 'EXP_LINEAR') { const e = add(mul(R(x.k), key), R(x.m)); if (e.d !== 1 || e.n < 0) return false; let v = 1; for (let i = 0; i < e.n; i++) v *= x.a; return v === A; }
    if (x.form === 'LOG_SUM') return sameRational(mul(key, add(key, R(x.p))), R(A));
    const right = sub(key, R(x.c));
    return right.n > 0 && sameRational(add(key, R(x.p)), mul(R(A), right));
  },
  misconceptionAnswers: (x) => {
    const A = ipow(x.a, x.q);
    if (x.form === 'EXP_LINEAR') return [
      { id: 'ignores-the-constant-in-the-exponent', value: R(x.q, x.k) },
      { id: 'adds-the-constant-instead-of-subtracting', value: R(x.q + x.m, x.k) },
      { id: 'forgets-to-divide-by-the-coefficient', value: R(x.q - x.m) },
      { id: 'uses-the-number-not-its-power', value: R(A - x.m, x.k) },
    ];
    if (x.form === 'LOG_SUM') { const r = logKey(x).n; return [
      { id: 'adds-the-arguments', value: R(A - x.p, 2) },
      { id: 'gives-the-rejected-root-without-its-sign', value: R(r + x.p) },
      { id: 'splits-the-power-between-the-logarithms', value: x.q % 2 === 0 ? R(ipow(x.a, x.q / 2)) : null },
    ]; }
    return [
      { id: 'ignores-the-second-shift', value: R(x.p, A - 1) },
      { id: 'gives-the-second-argument', value: R(x.p + x.c, A - 1) },
      { id: 'sign-error-on-the-second-shift', value: R(x.p - A * x.c, A - 1) },
      { id: 'takes-the-power-as-a-product', value: x.q >= 2 ? R(x.p + x.a * x.q * x.c, x.a * x.q - 1) : null },
    ];
  },
  recognitionKey: (x) => `${x.form}|${x.a}|${x.q}|${x.k}|${x.m}|${x.p}|${x.c}`,
};

// ====================================================================== P2 Differentiation
/**
 * PRODUCT      y = (x² + a)(bx + c)              y'(t) = 2t(bt + c) + b(t² + a)
 * QUOTIENT     y = (ax + b)/(x + c)              y'(t) = (ac − b)/(t + c)²
 * LN_PRODUCT   y = (px + q) ln(ax + b), b = 1 − at   y'(t) = a(pt + q)         (ln 1 = 0)
 * EXP_PRODUCT  y = (px + q) e^(ax + b), b = −at      y'(t) = p + a(pt + q)     (e⁰ = 1)
 */
export interface GradientParameters extends Record<string, number | string> { form: 'PRODUCT' | 'QUOTIENT' | 'LN_PRODUCT' | 'EXP_PRODUCT'; a: number; b: number; c: number; p: number; q: number; t: number }
const GRADIENT_FORMS = { FOUNDATIONAL: ['PRODUCT'], STANDARD: ['QUOTIENT'], CHALLENGE: ['LN_PRODUCT', 'EXP_PRODUCT'] } as const;
const gradientKey = (x: GradientParameters): Rational => {
  if (x.form === 'PRODUCT') return R(2 * x.t * (x.b * x.t + x.c) + x.b * (x.t * x.t + x.a));
  if (x.form === 'QUOTIENT') return R(x.a * x.c - x.b, (x.t + x.c) ** 2);
  if (x.form === 'LN_PRODUCT') return R(x.a * (x.p * x.t + x.q));
  return R(x.p + x.a * (x.p * x.t + x.q));
};
const gradientBand = (band: PlanningBand, x: GradientParameters): string[] => {
  const i: string[] = []; const n = need(i);
  n(bandForm(GRADIENT_FORMS, band, x.form as never), 'FORM_IS_NOT_THE_BANDS');
  if (x.form === 'QUOTIENT') n(x.t + x.c >= 1 && x.a * x.c - x.b > 0, 'QUOTIENT_OUTSIDE_THE_ENVELOPE');
  if (x.form === 'LN_PRODUCT') n(x.b === 1 - x.a * x.t, 'LOG_ARGUMENT_IS_NOT_ONE_AT_THE_POINT');
  if (x.form === 'EXP_PRODUCT') n(x.b === -x.a * x.t, 'EXPONENT_IS_NOT_ZERO_AT_THE_POINT');
  return i;
};
const linear = (k: number, c: number): string => `${coef(k)}x ${signed(c)}`;
const curveAt = (x: GradientParameters, s: number): number => {
  if (x.form === 'PRODUCT') return (s * s + x.a) * (x.b * s + x.c);
  if (x.form === 'QUOTIENT') return (x.a * s + x.b) / (s + x.c);
  if (x.form === 'LN_PRODUCT') return (x.p * s + x.q) * Math.log(x.a * s + x.b);
  return (x.p * s + x.q) * Math.exp(x.a * s + x.b);
};
export const CIE_PRODUCT_QUOTIENT_GRADIENT: ParametricConstruct<GradientParameters> = {
  construct: 'CIE_PRODUCT_QUOTIENT_GRADIENT', rendererVersion: 'tb.cie.product-quotient-gradient@0.1.0', languages: ['en'],
  enumerate(band) {
    const out: GradientParameters[] = [];
    if (band === 'FOUNDATIONAL') {
      for (let a = 1; a <= 5; a++) for (let b = 1; b <= 3; b++) for (const c of [-4, -3, -2, -1, 1, 2, 3, 4]) for (let t = 1; t <= 3; t++) out.push({ form: 'PRODUCT', a, b, c, p: 0, q: 0, t });
    } else if (band === 'STANDARD') {
      for (let a = 1; a <= 5; a++) for (const b of [-6, -5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 6]) for (let c = 1; c <= 4; c++) for (let t = 0; t <= 3; t++) out.push({ form: 'QUOTIENT', a, b, c, p: 0, q: 0, t });
    } else {
      for (const form of ['LN_PRODUCT', 'EXP_PRODUCT'] as const) for (let a = 1; a <= 4; a++) for (let p = 1; p <= 4; p++) for (const q of [-3, -2, -1, 1, 2, 3, 4, 5]) for (let t = 1; t <= 3; t++) out.push({ form, a, b: form === 'LN_PRODUCT' ? 1 - a * t : -a * t, c: 0, p, q, t });
    }
    return clean(this, out.filter((x) => gradientBand(band, x).length === 0));
  },
  bandIssues: gradientBand,
  present: (x) => {
    const at = `Calculate the gradient of the curve at the point where x = ${x.t}.`;
    if (x.form === 'PRODUCT') return `A curve has equation y = (x² + ${x.a})(${linear(x.b, x.c)}). ${at}`;
    if (x.form === 'QUOTIENT') return `A curve has equation y = (${linear(x.a, x.b)})/(x + ${x.c}). ${at} Give your answer as an exact value.`;
    if (x.form === 'LN_PRODUCT') return `A curve has equation y = (${linear(x.p, x.q)}) ln(${linear(x.a, x.b)}). ${at}`;
    return `A curve has equation y = (${linear(x.p, x.q)}) e^(${x.b === 0 ? `${coef(x.a)}x` : linear(x.a, x.b)}). ${at}`;
  },
  answer: (x) => writeRational(gradientKey(x)),
  // numerically, from the shown curve only: a fourth-order central difference of y at x = t
  keyHolds: (x, key) => {
    const h = 1e-3; const f = (s: number) => curveAt(x, s);
    const d = (8 * (f(x.t + h) - f(x.t - h)) - (f(x.t + 2 * h) - f(x.t - 2 * h))) / (12 * h);
    return Math.abs(d - key.n / key.d) < 1e-6 * Math.max(1, Math.abs(d));
  },
  misconceptionAnswers: (x) => {
    if (x.form === 'PRODUCT') return [
      { id: 'multiplies-the-derivatives-of-the-factors', value: R(2 * x.t * x.b) },
      { id: 'gives-the-y-coordinate', value: R((x.t * x.t + x.a) * (x.b * x.t + x.c)) },
      { id: 'differentiates-only-the-first-factor', value: R(2 * x.t * (x.b * x.t + x.c)) },
    ];
    if (x.form === 'QUOTIENT') return [
      { id: 'reverses-the-order-in-the-numerator', value: R(x.b - x.a * x.c, (x.t + x.c) ** 2) },
      { id: 'omits-the-square-in-the-denominator', value: R(x.a * x.c - x.b, x.t + x.c) },
      { id: 'divides-the-derivatives', value: R(x.a) },
    ];
    if (x.form === 'LN_PRODUCT') return [
      { id: 'multiplies-the-derivatives-of-the-factors', value: R(x.p * x.a) },
      { id: 'drops-the-chain-rule-factor', value: R(x.p * x.t + x.q) },
      { id: 'takes-ln-1-as-1', value: R(x.p + x.a * (x.p * x.t + x.q)) },
    ];
    return [
      { id: 'multiplies-the-derivatives-of-the-factors', value: R(x.p * x.a) },
      { id: 'drops-the-chain-rule-factor', value: R(x.p + x.p * x.t + x.q) },
      { id: 'differentiates-only-the-exponential', value: R(x.a * (x.p * x.t + x.q)) },
    ];
  },
  recognitionKey: (x) => `${x.form}|${x.a}|${x.b}|${x.c}|${x.p}|${x.q}|${x.t}`,
};

// ====================================================================== P2 Numerical solution of equations
/**
 * SIGN_CHANGE   x³ + bx − N = 0 (increasing, one real root, never an integer): the integer n with n < α < n + 1
 * ITERATION     x₁ = 1, xₙ₊₁ = p/(xₙ + q), p = r(r + q): converges to α = r (|F'(α)| = r/(r + q) < 1)
 * CUBIC_FACTOR  d x³ − u x² + dv x − uv = (dx − u)(x² + v) = 0: the one real root u/d, located between n and n + 1
 */
export interface NumericalParameters extends Record<string, number | string> { form: 'SIGN_CHANGE' | 'ITERATION' | 'CUBIC_FACTOR'; b: number; N: number; p: number; q: number; d: number; u: number; v: number }
const NUMERICAL_FORMS = { FOUNDATIONAL: ['SIGN_CHANGE'], STANDARD: ['ITERATION'], CHALLENGE: ['CUBIC_FACTOR'] } as const;
const signCubic = (x: NumericalParameters, s: number): number => s ** 3 + x.b * s - x.N;
/** The real root of x³ + bx − N by bisection (floating point), then its integer part. */
const signChangeFloor = (x: NumericalParameters): number => { let lo = 0; let hi = x.N; for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (signCubic(x, mid) < 0) lo = mid; else hi = mid; } return Math.floor(lo); };
const numericalKey = (x: NumericalParameters): Rational => {
  if (x.form === 'SIGN_CHANGE') return R(signChangeFloor(x));
  if (x.form === 'ITERATION') return R((-x.q + Math.round(Math.sqrt(x.q * x.q + 4 * x.p))) / 2);
  return R(x.u, x.d);
};
const numericalBand = (band: PlanningBand, x: NumericalParameters): string[] => {
  const i: string[] = []; const n = need(i);
  n(bandForm(NUMERICAL_FORMS, band, x.form as never), 'FORM_IS_NOT_THE_BANDS');
  if (x.form === 'SIGN_CHANGE') { let integerRoot = false; for (let s = 0; s <= x.N; s++) if (signCubic(x, s) === 0) integerRoot = true; n(x.b >= 1 && x.N >= 20 && !integerRoot, 'ROOT_IS_AN_INTEGER_OR_OUTSIDE_THE_ENVELOPE'); }
  if (x.form === 'ITERATION') n(x.q >= 1 && Number.isInteger(Math.sqrt(x.q * x.q + 4 * x.p)), 'LIMIT_IS_NOT_AN_INTEGER');
  if (x.form === 'CUBIC_FACTOR') n(x.d >= 2 && x.u % x.d !== 0 && x.v >= 1, 'ROOT_IS_AN_INTEGER');
  return i;
};
const cubicTerms = (k: readonly number[]): string => {
  const pw = ['', 'x', 'x²', 'x³'];
  return k.map((c, i) => [c, 3 - i] as const).filter(([c]) => c !== 0).map(([c, e], j) => {
    const body = e === 0 ? String(Math.abs(c)) : `${Math.abs(c) === 1 ? '' : Math.abs(c)}${pw[e]}`;
    return j === 0 ? `${c < 0 ? '−' : ''}${body}` : `${c < 0 ? '−' : '+'} ${body}`;
  }).join(' ');
};
export const CIE_NUMERICAL_ROOT: ParametricConstruct<NumericalParameters> = {
  construct: 'CIE_NUMERICAL_ROOT', rendererVersion: 'tb.cie.numerical-root@0.1.0', languages: ['en'],
  enumerate(band) {
    const out: NumericalParameters[] = [];
    const zero = { b: 0, N: 0, p: 0, q: 0, d: 0, u: 0, v: 0 };
    if (band === 'FOUNDATIONAL') {
      for (let b = 1; b <= 6; b++) for (let N = 20; N <= 250; N += 7) out.push({ ...zero, form: 'SIGN_CHANGE', b, N });
    } else if (band === 'STANDARD') {
      for (let r = 1; r <= 10; r++) for (let q = 1; q <= 8; q++) out.push({ ...zero, form: 'ITERATION', p: r * (r + q), q });
    } else {
      for (let d = 2; d <= 5; d++) for (let u = 2; u <= 15; u++) for (let v = 1; v <= 6; v++) out.push({ ...zero, form: 'CUBIC_FACTOR', d, u, v });
    }
    return clean(this, out.filter((x) => numericalBand(band, x).length === 0));
  },
  bandIssues: numericalBand,
  present: (x) => {
    if (x.form === 'SIGN_CHANGE') { const f = cubicTerms([1, 0, x.b, -x.N]); return `The equation ${f} = 0 has exactly one real root, α. By considering the sign of ${f}, determine the integer n for which n < α < n + 1.`; }
    if (x.form === 'ITERATION') return `The sequence defined by x₁ = 1 and xₙ₊₁ = ${x.p}/(xₙ + ${x.q}) converges to the value α. Determine the exact value of α.`;
    const n = Math.floor(x.u / x.d);
    return `The equation ${cubicTerms([x.d, -x.u, x.d * x.v, -x.u * x.v])} = 0 has exactly one real root, and it lies between ${n} and ${n + 1}. Determine the exact value of this root.`;
  },
  answer: (x) => writeRational(numericalKey(x)),
  keyHolds: (x, key) => {
    if (key.n <= 0) return false;
    // the sign change itself: f(n) < 0 < f(n + 1), f increasing
    if (x.form === 'SIGN_CHANGE') return key.d === 1 && signCubic(x, key.n) < 0 && signCubic(x, key.n + 1) > 0;
    // run the shown iteration from x₁ = 1 and compare its limit with the key
    if (x.form === 'ITERATION') { let s = 1; for (let i = 0; i < 5000; i++) s = x.p / (s + x.q); return Math.abs(s - key.n / key.d) < 1e-9; }
    // substitute the key into the shown cubic, exactly; it must also lie in the stated interval
    const lo = Math.floor(x.u / x.d); const k2 = mul(key, key); const k3 = mul(k2, key);
    const f = add(add(mul(R(x.d), k3), mul(R(-x.u), k2)), add(mul(R(x.d * x.v), key), R(-x.u * x.v)));
    return isZero(f) && key.n > lo * key.d && key.n < (lo + 1) * key.d;
  },
  misconceptionAnswers: (x) => {
    if (x.form === 'SIGN_CHANGE') { const n = signChangeFloor(x); let cube = 0; while ((cube + 1) ** 3 <= x.N) cube++; return [
      { id: 'gives-the-upper-integer', value: R(n + 1) },
      { id: 'ignores-the-linear-term', value: R(cube) },
      { id: 'ignores-the-cubic-term', value: R(Math.floor(x.N / x.b)) },
    ]; }
    if (x.form === 'ITERATION') { const r = numericalKey(x).n; return [
      { id: 'gives-the-second-iterate', value: R(x.p, 1 + x.q) },
      { id: 'gives-the-negative-root-without-its-sign', value: R(r + x.q) },
      { id: 'takes-the-limit-as-p-over-q', value: R(x.p, x.q) },
    ]; }
    const n = Math.floor(x.u / x.d); return [
      { id: 'gives-the-lower-bound', value: R(n) },
      { id: 'gives-the-upper-bound', value: R(n + 1) },
      { id: 'gives-the-midpoint-of-the-interval', value: R(2 * n + 1, 2) },
      { id: 'divides-the-constant-by-the-leading-coefficient', value: R(x.u * x.v, x.d) },
    ];
  },
  recognitionKey: (x) => `${x.form}|${x.b}|${x.N}|${x.p}|${x.q}|${x.d}|${x.u}|${x.v}`,
};

// ====================================================================== P4 Kinematics (constant acceleration)
/**
 * FINAL_SPEED  v = u + at
 * DISTANCE     s = ut + ½at²
 * VERTICAL     projected upwards at u, g = 10: speed v at height h (first time), v² = u² − 20h
 */
export interface KinematicsParameters extends Record<string, number | string> { form: 'FINAL_SPEED' | 'DISTANCE' | 'VERTICAL'; u: number; a: number; t: number; h: number }
const KINEMATICS_FORMS = { FOUNDATIONAL: ['FINAL_SPEED'], STANDARD: ['DISTANCE'], CHALLENGE: ['VERTICAL'] } as const;
const kinematicsKey = (x: KinematicsParameters): Rational => {
  if (x.form === 'FINAL_SPEED') return R(x.u + x.a * x.t);
  if (x.form === 'DISTANCE') return R(2 * x.u * x.t + x.a * x.t * x.t, 2);
  return R(Math.round(Math.sqrt(x.u * x.u - 20 * x.h)));
};
const kinematicsBand = (band: PlanningBand, x: KinematicsParameters): string[] => {
  const i: string[] = []; const n = need(i);
  n(bandForm(KINEMATICS_FORMS, band, x.form as never), 'FORM_IS_NOT_THE_BANDS');
  if (x.form === 'VERTICAL') { const v2 = x.u * x.u - 20 * x.h; n(x.h >= 1 && v2 > 0 && Number.isInteger(Math.sqrt(v2)), 'SPEED_IS_NOT_AN_INTEGER'); }
  else n(x.u >= 1 && x.a >= 1 && x.t >= 2, 'MOTION_OUTSIDE_THE_ENVELOPE');
  return i;
};
export const CIE_CONSTANT_ACCELERATION: ParametricConstruct<KinematicsParameters> = {
  construct: 'CIE_CONSTANT_ACCELERATION', rendererVersion: 'tb.cie.constant-acceleration@0.1.0', languages: ['en'],
  enumerate(band) {
    const out: KinematicsParameters[] = [];
    if (band === 'FOUNDATIONAL') { for (let u = 1; u <= 8; u++) for (let a = 1; a <= 5; a++) for (let t = 2; t <= 8; t++) out.push({ form: 'FINAL_SPEED', u, a, t, h: 0 }); }
    else if (band === 'STANDARD') { for (let u = 1; u <= 8; u++) for (let a = 1; a <= 6; a++) for (let t = 2; t <= 6; t++) out.push({ form: 'DISTANCE', u, a, t, h: 0 }); }
    else { for (let u = 10; u <= 30; u++) for (let v = 1; v < u; v++) if ((u * u - v * v) % 20 === 0) out.push({ form: 'VERTICAL', u, a: 0, t: 0, h: (u * u - v * v) / 20 }); }
    return clean(this, out.filter((x) => kinematicsBand(band, x).length === 0));
  },
  bandIssues: kinematicsBand,
  present: (x) => {
    if (x.form === 'FINAL_SPEED') return `A particle moves in a straight line with constant acceleration ${x.a} m s⁻². Its initial speed is ${x.u} m s⁻¹. Calculate the speed of the particle ${x.t} s later, in m s⁻¹.`;
    if (x.form === 'DISTANCE') return `A particle moves in a straight line with constant acceleration ${x.a} m s⁻², starting with speed ${x.u} m s⁻¹. Calculate the distance it travels in the first ${x.t} s, in m. Give your answer as an exact value.`;
    return `A ball is projected vertically upwards from a point O with speed ${x.u} m s⁻¹. Take g = 10 m s⁻² and ignore air resistance. Calculate the speed of the ball, in m s⁻¹, when it is ${x.h} m above O for the first time.`;
  },
  answer: (x) => writeRational(kinematicsKey(x)),
  keyHolds: (x, key) => {
    if (key.n <= 0) return false;
    // FINAL_SPEED: the distance covered gives v² = u² + 2as
    if (x.form === 'FINAL_SPEED') { const s = R(2 * x.u * x.t + x.a * x.t * x.t, 2); return sameRational(mul(key, key), add(R(x.u * x.u), mul(R(2 * x.a), s))); }
    // DISTANCE: s = (u + v) t / 2 with v = u + at
    if (x.form === 'DISTANCE') return sameRational(key, R((x.u + x.u + x.a * x.t) * x.t, 2));
    // VERTICAL: the time to slow from u to the key is (u − v)/g; the height reached then, ut − 5t², must be h
    const t = div(sub(R(x.u), key), R(10));
    return t.n > 0 && sameRational(sub(mul(R(x.u), t), mul(R(5), mul(t, t))), R(x.h));
  },
  misconceptionAnswers: (x) => {
    if (x.form === 'FINAL_SPEED') return [
      { id: 'omits-the-initial-speed', value: R(x.a * x.t) },
      { id: 'adds-the-acceleration-once', value: R(x.u + x.a) },
      { id: 'gives-the-distance-travelled', value: R(2 * x.u * x.t + x.a * x.t * x.t, 2) },
    ];
    if (x.form === 'DISTANCE') return [
      { id: 'omits-the-half', value: R(x.u * x.t + x.a * x.t * x.t) },
      { id: 'multiplies-the-final-speed-by-the-time', value: R((x.u + x.a * x.t) * x.t) },
      { id: 'ignores-the-initial-speed', value: R(x.a * x.t * x.t, 2) },
    ];
    const plus = x.u * x.u + 20 * x.h; const half = x.u * x.u - 10 * x.h;
    return [
      { id: 'forgets-the-square-root', value: R(x.u * x.u - 20 * x.h) },
      { id: 'adds-two-g-h', value: Number.isInteger(Math.sqrt(plus)) ? R(Math.sqrt(plus)) : null },
      { id: 'uses-g-h-not-two-g-h', value: half > 0 && Number.isInteger(Math.sqrt(half)) ? R(Math.sqrt(half)) : null },
    ];
  },
  recognitionKey: (x) => `${x.form}|${x.u}|${x.a}|${x.t}|${x.h}`,
};

// ====================================================================== P4 Forces and equilibrium
/**
 * ROUGH_HORIZONTAL  mass m, horizontal pull P, μ = k/10, g = 10: a = (P − km)/m
 * SMOOTH_INCLINE    sin θ = s/h (3-4-5 or 5-12-13), pull P up the slope: a = P/m − 10 s/h
 * ROUGH_INCLINE     constant speed up the slope, μ = k/10: P = m(10s + kc)/h
 */
export interface ForcesParameters extends Record<string, number | string> { form: 'ROUGH_HORIZONTAL' | 'SMOOTH_INCLINE' | 'ROUGH_INCLINE'; m: number; P: number; k: number; s: number; c: number; h: number }
const FORCES_FORMS = { FOUNDATIONAL: ['ROUGH_HORIZONTAL'], STANDARD: ['SMOOTH_INCLINE'], CHALLENGE: ['ROUGH_INCLINE'] } as const;
const SLOPES: readonly [number, number, number][] = [[3, 4, 5], [4, 3, 5], [5, 12, 13], [12, 5, 13]];
const forcesKey = (x: ForcesParameters): Rational => {
  if (x.form === 'ROUGH_HORIZONTAL') return R(x.P - x.k * x.m, x.m);
  if (x.form === 'SMOOTH_INCLINE') return R(x.P * x.h - 10 * x.s * x.m, x.m * x.h);
  return R(x.m * (10 * x.s + x.k * x.c), x.h);
};
const forcesBand = (band: PlanningBand, x: ForcesParameters): string[] => {
  const i: string[] = []; const n = need(i);
  n(bandForm(FORCES_FORMS, band, x.form as never), 'FORM_IS_NOT_THE_BANDS');
  n(x.form === 'ROUGH_HORIZONTAL' ? x.s === 0 && x.c === 0 && x.h === 0 : SLOPES.some(([s, c, h]) => s === x.s && c === x.c && h === x.h), 'SLOPE_OUTSIDE_THE_ENVELOPE');
  n(x.form === 'SMOOTH_INCLINE' ? x.k === 0 : x.k >= 1 && x.k <= 6, 'FRICTION_OUTSIDE_THE_ENVELOPE');
  return i;
};
const tenths = (k: number): string => `0.${k}`;
export const CIE_FORCES_ON_A_PLANE: ParametricConstruct<ForcesParameters> = {
  construct: 'CIE_FORCES_ON_A_PLANE', rendererVersion: 'tb.cie.forces-on-a-plane@0.1.0', languages: ['en'],
  enumerate(band) {
    const out: ForcesParameters[] = [];
    if (band === 'FOUNDATIONAL') { for (let m = 2; m <= 8; m++) for (let k = 1; k <= 5; k++) for (let P = 10; P <= 60; P += 5) out.push({ form: 'ROUGH_HORIZONTAL', m, P, k, s: 0, c: 0, h: 0 }); }
    else if (band === 'STANDARD') { for (let m = 2; m <= 6; m++) for (const [s, c, h] of SLOPES) for (let P = 10; P <= 80; P += 5) out.push({ form: 'SMOOTH_INCLINE', m, P, k: 0, s, c, h }); }
    else { for (let m = 1; m <= 8; m++) for (let k = 1; k <= 6; k++) for (const [s, c, h] of SLOPES) out.push({ form: 'ROUGH_INCLINE', m, P: 0, k, s, c, h }); }
    return clean(this, out.filter((x) => forcesBand(band, x).length === 0));
  },
  bandIssues: forcesBand,
  present: (x) => {
    const g = 'Take g = 10 m s⁻².';
    if (x.form === 'ROUGH_HORIZONTAL') return `A particle of mass ${x.m} kg lies on a rough horizontal surface. The coefficient of friction between the particle and the surface is ${tenths(x.k)}. A horizontal force of ${x.P} N acts on the particle, which accelerates. ${g} Calculate the acceleration of the particle, in m s⁻². Give your answer as an exact value.`;
    if (x.form === 'SMOOTH_INCLINE') return `A particle of mass ${x.m} kg is on a smooth plane inclined at an angle θ to the horizontal, where sin θ = ${x.s}/${x.h}. A force of ${x.P} N acts on the particle up a line of greatest slope, and the particle accelerates up the plane. ${g} Calculate the acceleration of the particle, in m s⁻². Give your answer as an exact value.`;
    return `A particle of mass ${x.m} kg is pulled up a line of greatest slope of a rough plane inclined at an angle θ to the horizontal, where sin θ = ${x.s}/${x.h}, by a force of P N acting along the slope. The coefficient of friction is ${tenths(x.k)} and the particle moves at constant speed. ${g} Calculate the value of P. Give your answer as an exact value.`;
  },
  answer: (x) => writeRational(forcesKey(x)),
  // resolve every force horizontally and vertically (not along the plane), with exact arithmetic
  keyHolds: (x, key) => {
    if (key.n <= 0) return false;
    const mu = R(x.k, 10); const W = R(10 * x.m);
    if (x.form === 'ROUGH_HORIZONTAL') { const N = W; return sameRational(sub(R(x.P), mul(mu, N)), mul(R(x.m), key)); }
    const cs = R(x.c, x.h); const sn = R(x.s, x.h);
    if (x.form === 'SMOOTH_INCLINE') {
      // P(c, s) + N(−s, c) + (0, −W) = m a (c, s); x gives N, y must then balance
      const N = div(sub(mul(R(x.P), cs), mul(mul(R(x.m), key), cs)), sn);
      return N.n > 0 && sameRational(sub(add(mul(R(x.P), sn), mul(N, cs)), W), mul(mul(R(x.m), key), sn));
    }
    // key (c, s) + N(−s, c) − μN(c, s) + (0, −W) = 0
    const N = div(mul(key, cs), add(sn, mul(mu, cs)));
    return N.n > 0 && isZero(sub(add(mul(sub(key, mul(mu, N)), sn), mul(N, cs)), W));
  },
  misconceptionAnswers: (x) => {
    if (x.form === 'ROUGH_HORIZONTAL') return [
      { id: 'ignores-the-friction', value: R(x.P, x.m) },
      { id: 'omits-g-in-the-normal-reaction', value: R(10 * x.P - x.k * x.m, 10 * x.m) },
      { id: 'adds-the-friction', value: R(x.P + x.k * x.m, x.m) },
    ];
    if (x.form === 'SMOOTH_INCLINE') return [
      { id: 'uses-cos-instead-of-sin', value: R(x.P * x.h - 10 * x.c * x.m, x.m * x.h) },
      { id: 'ignores-the-weight-component', value: R(x.P, x.m) },
      { id: 'omits-g-in-the-weight', value: R(x.P * x.h - x.s * x.m, x.m * x.h) },
    ];
    return [
      { id: 'friction-in-the-wrong-direction', value: R(x.m * (10 * x.s - x.k * x.c), x.h) },
      { id: 'swaps-sin-and-cos', value: R(x.m * (10 * x.c + x.k * x.s), x.h) },
      { id: 'omits-g-in-the-friction', value: R(x.m * (100 * x.s + x.k * x.c), 10 * x.h) },
    ];
  },
  recognitionKey: (x) => `${x.form}|${x.m}|${x.P}|${x.k}|${x.s}|${x.c}|${x.h}`,
};

// ====================================================================== P4 Energy, work and power
/**
 * MAX_SPEED                power w kW against resistance F at maximum speed: v = 1000w / F
 * ACCELERATION             power w kW, mass m, resistance F, speed v: a = (1000w / v − F) / m
 * WORK_AGAINST_RESISTANCE  mass m from rest, drops height h, speed v: W = 10mh − ½mv²
 */
export interface EnergyParameters extends Record<string, number | string> { form: 'MAX_SPEED' | 'ACCELERATION' | 'WORK_AGAINST_RESISTANCE'; w: number; F: number; m: number; v: number; h: number }
const ENERGY_FORMS = { FOUNDATIONAL: ['MAX_SPEED'], STANDARD: ['ACCELERATION'], CHALLENGE: ['WORK_AGAINST_RESISTANCE'] } as const;
const energyKey = (x: EnergyParameters): Rational => {
  if (x.form === 'MAX_SPEED') return R(1000 * x.w, x.F);
  if (x.form === 'ACCELERATION') return R(1000 * x.w - x.F * x.v, x.v * x.m);
  return R(20 * x.m * x.h - x.m * x.v * x.v, 2);
};
const energyBand = (band: PlanningBand, x: EnergyParameters): string[] => {
  const i: string[] = []; const n = need(i);
  n(bandForm(ENERGY_FORMS, band, x.form as never), 'FORM_IS_NOT_THE_BANDS');
  if (x.form === 'MAX_SPEED') n((1000 * x.w) % x.F === 0 && 1000 * x.w / x.F >= 10 && 1000 * x.w / x.F <= 60, 'SPEED_OUTSIDE_THE_ENVELOPE');
  if (x.form === 'ACCELERATION') n(1000 * x.w > x.F * x.v, 'NO_POSITIVE_ACCELERATION');
  if (x.form === 'WORK_AGAINST_RESISTANCE') n(20 * x.h > x.v * x.v, 'NO_WORK_AGAINST_RESISTANCE');
  return i;
};
export const CIE_ENERGY_WORK_POWER: ParametricConstruct<EnergyParameters> = {
  construct: 'CIE_ENERGY_WORK_POWER', rendererVersion: 'tb.cie.energy-work-power@0.1.0', languages: ['en'],
  enumerate(band) {
    const out: EnergyParameters[] = [];
    if (band === 'FOUNDATIONAL') { for (let w = 10; w <= 60; w += 5) for (let F = 500; F <= 3000; F += 250) out.push({ form: 'MAX_SPEED', w, F, m: 0, v: 0, h: 0 }); }
    else if (band === 'STANDARD') { for (const w of [20, 30, 40, 50, 60]) for (const v of [10, 15, 20, 25]) for (const F of [400, 600, 800, 1000, 1200]) for (const m of [800, 1000, 1200, 1500]) out.push({ form: 'ACCELERATION', w, F, m, v, h: 0 }); }
    else { for (let m = 2; m <= 8; m++) for (let h = 2; h <= 8; h++) for (let v = 2; v <= 10; v += 2) out.push({ form: 'WORK_AGAINST_RESISTANCE', w: 0, F: 0, m, v, h }); }
    return clean(this, out.filter((x) => energyBand(band, x).length === 0));
  },
  bandIssues: energyBand,
  present: (x) => {
    if (x.form === 'MAX_SPEED') return `The engine of a car works at a constant rate of ${x.w} kW. The car moves along a straight horizontal road against a constant resistance of ${x.F} N. Calculate the maximum speed of the car, in m s⁻¹.`;
    if (x.form === 'ACCELERATION') return `A car of mass ${x.m} kg moves along a straight horizontal road against a constant resistance of ${x.F} N. Its engine works at a constant rate of ${x.w} kW. Calculate the acceleration of the car at the instant when its speed is ${x.v} m s⁻¹, in m s⁻². Give your answer as an exact value.`;
    return `A particle of mass ${x.m} kg is released from rest at the top of a rough slope and slides down it. When the particle has descended a vertical distance of ${x.h} m, its speed is ${x.v} m s⁻¹. Take g = 10 m s⁻². Calculate the work done against resistance, in J.`;
  },
  answer: (x) => writeRational(energyKey(x)),
  keyHolds: (x, key) => {
    if (key.n <= 0) return false;
    // MAX_SPEED: at the key speed the driving force P / v equals the resistance (zero acceleration)
    if (x.form === 'MAX_SPEED') return sameRational(div(R(1000 * x.w), key), R(x.F));
    // ACCELERATION: driving force P / v, then the resultant force F_drive − F must equal m a
    if (x.form === 'ACCELERATION') return sameRational(sub(R(1000 * x.w, x.v), R(x.F)), mul(R(x.m), key));
    // WORK: with the key lost to resistance, the kinetic energy left gives v² = 2(mgh − W)/m
    return sameRational(div(mul(R(2), sub(R(10 * x.m * x.h), key)), R(x.m)), R(x.v * x.v));
  },
  misconceptionAnswers: (x) => {
    if (x.form === 'MAX_SPEED') return [
      { id: 'forgets-the-kilowatt-conversion', value: R(x.w, x.F) },
      { id: 'inverts-the-power-relation', value: R(x.F, 1000 * x.w) },
      { id: 'uses-power-equals-half-force-times-speed', value: R(2000 * x.w, x.F) },
    ];
    if (x.form === 'ACCELERATION') return [
      { id: 'ignores-the-resistance', value: R(1000 * x.w, x.v * x.m) },
      { id: 'forgets-the-kilowatt-conversion', value: R(x.w - x.F * x.v, x.v * x.m) },
      { id: 'adds-the-resistance', value: R(1000 * x.w + x.F * x.v, x.v * x.m) },
    ];
    return [
      { id: 'ignores-the-kinetic-energy', value: R(10 * x.m * x.h) },
      { id: 'omits-the-half-in-the-kinetic-energy', value: R(10 * x.m * x.h - x.m * x.v * x.v) },
      { id: 'adds-the-kinetic-energy', value: R(20 * x.m * x.h + x.m * x.v * x.v, 2) },
    ];
  },
  recognitionKey: (x) => `${x.form}|${x.w}|${x.F}|${x.m}|${x.v}|${x.h}`,
};

// ====================================================================== P5 Permutations and combinations
/**
 * SELECTION       r from n different objects: C(n, r)
 * COMMITTEE       i of a men and j of b women: C(a, i) C(b, j)
 * BEADS_TOGETHER  red / blue / green beads identical by colour, the reds all together: (B + G + 1)! / (B! G!)
 */
export interface CountingParameters extends Record<string, number | string> { form: 'SELECTION' | 'COMMITTEE' | 'BEADS_TOGETHER'; n: number; r: number; a: number; i: number; b: number; j: number; red: number; blue: number; green: number }
const COUNTING_FORMS = { FOUNDATIONAL: ['SELECTION'], STANDARD: ['COMMITTEE'], CHALLENGE: ['BEADS_TOGETHER'] } as const;
const countingKey = (x: CountingParameters): number => {
  if (x.form === 'SELECTION') return choose(x.n, x.r);
  if (x.form === 'COMMITTEE') return choose(x.a, x.i) * choose(x.b, x.j);
  return factorial(x.blue + x.green + 1) / (factorial(x.blue) * factorial(x.green));
};
const countingBand = (band: PlanningBand, x: CountingParameters): string[] => {
  const i: string[] = []; const n = need(i);
  n(bandForm(COUNTING_FORMS, band, x.form as never), 'FORM_IS_NOT_THE_BANDS');
  if (x.form === 'SELECTION') n(x.r >= 2 && x.r < x.n, 'SELECTION_OUTSIDE_THE_ENVELOPE');
  if (x.form === 'COMMITTEE') n(x.i >= 1 && x.j >= 1 && x.i < x.a && x.j < x.b, 'COMMITTEE_OUTSIDE_THE_ENVELOPE');
  if (x.form === 'BEADS_TOGETHER') n(x.red >= 2 && x.blue >= 1 && x.green >= 1, 'BEADS_OUTSIDE_THE_ENVELOPE');
  return i;
};
/** Arrangements of the beads with every red in one block, counted letter by letter (state: block not yet started / open / closed). */
const beadArrangements = (red: number, blue: number, green: number): number => {
  const memo = new Map<string, number>();
  const go = (r: number, b: number, g: number, state: 0 | 1 | 2): number => {
    if (r + b + g === 0) return 1;
    const id = `${r}|${b}|${g}|${state}`; const seen = memo.get(id); if (seen !== undefined) return seen;
    let total = 0;
    if (r > 0 && state !== 2) total += go(r - 1, b, g, 1);
    const after: 0 | 2 = state === 0 ? 0 : 2;
    if (b > 0) total += go(r, b - 1, g, after);
    if (g > 0) total += go(r, b, g - 1, after);
    memo.set(id, total); return total;
  };
  return go(red, blue, green, 0);
};
export const CIE_COUNTING_ARRANGEMENTS: ParametricConstruct<CountingParameters> = {
  construct: 'CIE_COUNTING_ARRANGEMENTS', rendererVersion: 'tb.cie.counting-arrangements@0.1.0', languages: ['en'],
  enumerate(band) {
    const out: CountingParameters[] = [];
    const zero = { n: 0, r: 0, a: 0, i: 0, b: 0, j: 0, red: 0, blue: 0, green: 0 };
    if (band === 'FOUNDATIONAL') { for (let n = 6; n <= 18; n++) for (let r = 2; r <= 6; r++) out.push({ ...zero, form: 'SELECTION', n, r }); }
    else if (band === 'STANDARD') { for (let a = 4; a <= 8; a++) for (let b = 4; b <= 8; b++) for (let i = 1; i <= 3; i++) for (let j = 1; j <= 3; j++) out.push({ ...zero, form: 'COMMITTEE', a, i, b, j }); }
    else { for (let red = 2; red <= 4; red++) for (let blue = 1; blue <= 4; blue++) for (let green = 1; green <= 4; green++) out.push({ ...zero, form: 'BEADS_TOGETHER', red, blue, green }); }
    return clean(this, out.filter((x) => countingBand(band, x).length === 0));
  },
  bandIssues: countingBand,
  present: (x) => {
    if (x.form === 'SELECTION') return `Calculate the number of different selections of ${x.r} books that can be made from ${x.n} different books.`;
    if (x.form === 'COMMITTEE') return `A committee of ${x.i + x.j} people is to be chosen from ${x.a} men and ${x.b} women. Calculate the number of different committees that contain exactly ${x.i} ${x.i === 1 ? 'man' : 'men'} and ${x.j} ${x.j === 1 ? 'woman' : 'women'}.`;
    return `A set of beads is identical apart from colour: ${x.red} red, ${x.blue} blue and ${x.green} green. Calculate the number of different arrangements of all ${x.red + x.blue + x.green} beads in a straight line in which the red beads are all next to one another.`;
  },
  answer: (x) => String(countingKey(x)),
  // Pascal's triangle for the selections; a letter-by-letter count of the restricted arrangements
  keyHolds: (x, key) => {
    if (key.d !== 1 || key.n <= 0) return false;
    if (x.form === 'SELECTION') return pascal(x.n, x.r) === key.n;
    if (x.form === 'COMMITTEE') return pascal(x.a, x.i) * pascal(x.b, x.j) === key.n;
    return beadArrangements(x.red, x.blue, x.green) === key.n;
  },
  misconceptionAnswers: (x) => {
    if (x.form === 'SELECTION') return [
      { id: 'uses-permutations-instead-of-combinations', value: R(perm(x.n, x.r)) },
      { id: 'allows-repeated-choices', value: R(x.n ** x.r) },
      { id: 'divides-by-r-instead-of-r-factorial', value: R(perm(x.n, x.r), x.r) },
    ];
    if (x.form === 'COMMITTEE') return [
      { id: 'adds-instead-of-multiplying', value: R(choose(x.a, x.i) + choose(x.b, x.j)) },
      { id: 'ignores-the-split-by-gender', value: R(choose(x.a + x.b, x.i + x.j)) },
      { id: 'uses-permutations-instead-of-combinations', value: R(perm(x.a, x.i) * perm(x.b, x.j)) },
    ];
    const total = x.red + x.blue + x.green;
    return [
      { id: 'ignores-the-restriction', value: R(factorial(total) / (factorial(x.red) * factorial(x.blue) * factorial(x.green))) },
      { id: 'treats-the-red-beads-as-distinct', value: R(countingKey(x) * factorial(x.red)) },
      { id: 'forgets-the-repeated-colours', value: R(factorial(x.blue + x.green + 1)) },
    ];
  },
  recognitionKey: (x) => `${x.form}|${x.n}|${x.r}|${x.a}|${x.i}|${x.b}|${x.j}|${x.red}|${x.blue}|${x.green}`,
};

// ====================================================================== P5 Probability
/**
 * AT_LEAST_ONE       independent A, B: P(A ∪ B) = 1 − (1 − P(A))(1 − P(B))
 * CONDITIONAL_TABLE  two-way counts w (A∩B), x (A∩B'), y (A'∩B), z (A'∩B'): P(A | B) = w / (w + y)
 * SAME_COLOUR        r red, b blue, two drawn without replacement: P(same colour)
 */
export interface EventsParameters extends Record<string, number | string> { form: 'AT_LEAST_ONE' | 'CONDITIONAL_TABLE' | 'SAME_COLOUR'; pa: number; qa: number; pb: number; qb: number; w: number; x: number; y: number; z: number; red: number; blue: number }
const EVENTS_FORMS = { FOUNDATIONAL: ['AT_LEAST_ONE'], STANDARD: ['CONDITIONAL_TABLE'], CHALLENGE: ['SAME_COLOUR'] } as const;
const eventsKey = (e: EventsParameters): Rational => {
  if (e.form === 'AT_LEAST_ONE') return R(e.qa * e.qb - (e.qa - e.pa) * (e.qb - e.pb), e.qa * e.qb);
  if (e.form === 'CONDITIONAL_TABLE') return R(e.w, e.w + e.y);
  const n = e.red + e.blue; return R(e.red * (e.red - 1) + e.blue * (e.blue - 1), n * (n - 1));
};
const eventsBand = (band: PlanningBand, e: EventsParameters): string[] => {
  const i: string[] = []; const n = need(i);
  n(bandForm(EVENTS_FORMS, band, e.form as never), 'FORM_IS_NOT_THE_BANDS');
  if (e.form === 'AT_LEAST_ONE') n(e.pa >= 1 && e.pa < e.qa && e.pb >= 1 && e.pb < e.qb && igcd(e.pa, e.qa) === 1 && igcd(e.pb, e.qb) === 1, 'PROBABILITIES_OUTSIDE_THE_ENVELOPE');
  if (e.form === 'CONDITIONAL_TABLE') n(e.w >= 1 && e.x >= 1 && e.y >= 1 && e.z >= 1, 'EMPTY_CELL');
  if (e.form === 'SAME_COLOUR') n(e.red >= 2 && e.blue >= 2, 'TOO_FEW_BALLS');
  return i;
};
export const CIE_PROBABILITY_EVENTS: ParametricConstruct<EventsParameters> = {
  construct: 'CIE_PROBABILITY_EVENTS', rendererVersion: 'tb.cie.probability-events@0.1.0', languages: ['en'],
  enumerate(band) {
    const out: EventsParameters[] = [];
    const zero = { pa: 0, qa: 0, pb: 0, qb: 0, w: 0, x: 0, y: 0, z: 0, red: 0, blue: 0 };
    if (band === 'FOUNDATIONAL') { for (let qa = 2; qa <= 6; qa++) for (let pa = 1; pa < qa; pa++) for (let qb = 2; qb <= 6; qb++) for (let pb = 1; pb < qb; pb++) out.push({ ...zero, form: 'AT_LEAST_ONE', pa, qa, pb, qb }); }
    else if (band === 'STANDARD') { for (let w = 3; w <= 12; w++) for (const x of [2, 5, 8]) for (let y = 4; y <= 14; y += 2) for (const z of [3, 6]) out.push({ ...zero, form: 'CONDITIONAL_TABLE', w, x, y, z }); }
    else { for (let red = 2; red <= 8; red++) for (let blue = 2; blue <= 8; blue++) out.push({ ...zero, form: 'SAME_COLOUR', red, blue }); }
    return clean(this, out.filter((e) => eventsBand(band, e).length === 0));
  },
  bandIssues: eventsBand,
  present: (e) => {
    if (e.form === 'AT_LEAST_ONE') return `The events A and B are independent, with P(A) = ${e.pa}/${e.qa} and P(B) = ${e.pb}/${e.qb}. Calculate P(A ∪ B), giving your answer as an exact fraction.`;
    if (e.form === 'CONDITIONAL_TABLE') return `In a club, ${e.w} members study Physics and play a musical instrument, ${e.x} study Physics but do not play an instrument, ${e.y} play an instrument but do not study Physics, and ${e.z} do neither. A member is chosen at random. Given that the member plays a musical instrument, calculate the probability that the member studies Physics. Give your answer as an exact fraction.`;
    return `A bag contains ${e.red} red balls and ${e.blue} blue balls. Two balls are taken from the bag at random, without replacement. Calculate the probability that the two balls are the same colour. Give your answer as an exact fraction.`;
  },
  answer: (e) => writeRational(eventsKey(e)),
  // enumeration of equally likely outcomes, counted
  keyHolds: (e, key) => {
    if (key.n <= 0) return false;
    if (e.form === 'AT_LEAST_ONE') { let hit = 0; for (let i = 0; i < e.qa; i++) for (let j = 0; j < e.qb; j++) if (i < e.pa || j < e.pb) hit++; return sameRational(key, R(hit, e.qa * e.qb)); }
    if (e.form === 'CONDITIONAL_TABLE') {
      const members: [boolean, boolean][] = [...Array(e.w).fill([true, true]), ...Array(e.x).fill([true, false]), ...Array(e.y).fill([false, true]), ...Array(e.z).fill([false, false])];
      const given = members.filter(([, plays]) => plays); return sameRational(key, R(given.filter(([physics]) => physics).length, given.length));
    }
    const balls = [...Array(e.red).fill('R'), ...Array(e.blue).fill('B')] as string[]; let same = 0; let all = 0;
    for (let i = 0; i < balls.length; i++) for (let j = 0; j < balls.length; j++) if (i !== j) { all++; if (balls[i] === balls[j]) same++; }
    return sameRational(key, R(same, all));
  },
  misconceptionAnswers: (e) => {
    if (e.form === 'AT_LEAST_ONE') return [
      { id: 'adds-the-probabilities', value: R(e.pa * e.qb + e.pb * e.qa, e.qa * e.qb) },
      { id: 'gives-the-probability-of-both', value: R(e.pa * e.pb, e.qa * e.qb) },
      { id: 'subtracts-the-probability-of-both-from-one', value: R(e.qa * e.qb - e.pa * e.pb, e.qa * e.qb) },
    ];
    if (e.form === 'CONDITIONAL_TABLE') { const total = e.w + e.x + e.y + e.z; return [
      { id: 'divides-by-the-whole-club', value: R(e.w, total) },
      { id: 'conditions-on-the-wrong-event', value: R(e.w, e.w + e.x) },
      { id: 'gives-the-probability-of-the-condition', value: R(e.w + e.y, total) },
    ]; }
    const n = e.red + e.blue; return [
      { id: 'replaces-the-first-ball', value: R(e.red * e.red + e.blue * e.blue, n * n) },
      { id: 'counts-only-one-colour', value: R(e.red * (e.red - 1), n * (n - 1)) },
      { id: 'gives-the-probability-of-different-colours', value: R(2 * e.red * e.blue, n * (n - 1)) },
    ];
  },
  recognitionKey: (e) => `${e.form}|${e.pa}|${e.qa}|${e.pb}|${e.qb}|${e.w}|${e.x}|${e.y}|${e.z}|${e.red}|${e.blue}`,
};

// ====================================================================== P5 Binomial distribution
/**
 * VARIANCE     X ~ B(n, p): Var(X) = np(1 − p)
 * EXACT        P(X = r) = C(n, r) p^r (1 − p)^(n − r)
 * AT_MOST_ONE  P(X ≤ 1) = (1 − p)^n + n p (1 − p)^(n − 1)
 */
export interface BinomialParameters extends Record<string, number | string> { form: 'VARIANCE' | 'EXACT' | 'AT_MOST_ONE'; n: number; r: number; pn: number; pd: number }
const BINOMIAL_FORMS = { FOUNDATIONAL: ['VARIANCE'], STANDARD: ['EXACT'], CHALLENGE: ['AT_MOST_ONE'] } as const;
const PROBABILITIES: readonly [number, number][] = [[1, 2], [1, 3], [2, 3], [1, 4], [3, 4], [1, 5], [2, 5], [3, 5], [4, 5], [1, 6], [5, 6]];
const binomialKey = (x: BinomialParameters): Rational => {
  const p = R(x.pn, x.pd); const q = R(x.pd - x.pn, x.pd);
  const pw = (b: Rational, e: number): Rational => { let r = R(1); for (let i = 0; i < e; i++) r = mul(r, b); return r; };
  if (x.form === 'VARIANCE') return mul(R(x.n), mul(p, q));
  if (x.form === 'EXACT') return mul(R(choose(x.n, x.r)), mul(pw(p, x.r), pw(q, x.n - x.r)));
  return add(pw(q, x.n), mul(R(x.n), mul(p, pw(q, x.n - 1))));
};
const binomialBand = (band: PlanningBand, x: BinomialParameters): string[] => {
  const i: string[] = []; const n = need(i);
  n(bandForm(BINOMIAL_FORMS, band, x.form as never), 'FORM_IS_NOT_THE_BANDS');
  n(PROBABILITIES.some(([a, b]) => a === x.pn && b === x.pd), 'PROBABILITY_OUTSIDE_THE_ENVELOPE');
  n(x.form === 'VARIANCE' ? x.n >= 5 && x.n <= 12 : x.n >= 3 && x.n <= 8, 'TRIALS_OUTSIDE_THE_ENVELOPE');
  if (x.form === 'EXACT') n(x.r >= 1 && x.r < x.n, 'SUCCESSES_OUTSIDE_THE_ENVELOPE');
  return i;
};
/** Every sequence of n trials, as BigInt weights out of pd^n: the total weight of the sequences `keep` accepts. */
const sequenceWeight = (x: BinomialParameters, weightOf: (successes: number) => bigint): bigint => {
  let total = BigInt(0);
  for (let mask = 0; mask < 1 << x.n; mask++) { let k = 0; for (let b = 0; b < x.n; b++) if (mask & (1 << b)) k++; total += weightOf(k); }
  return total;
};
export const CIE_BINOMIAL_EXACT: ParametricConstruct<BinomialParameters> = {
  construct: 'CIE_BINOMIAL_EXACT', rendererVersion: 'tb.cie.binomial-exact@0.1.0', languages: ['en'],
  enumerate(band) {
    const out: BinomialParameters[] = [];
    if (band === 'FOUNDATIONAL') { for (let n = 5; n <= 12; n++) for (const [pn, pd] of PROBABILITIES) out.push({ form: 'VARIANCE', n, r: 0, pn, pd }); }
    else if (band === 'STANDARD') { for (let n = 3; n <= 7; n++) for (let r = 1; r < n; r++) for (const [pn, pd] of PROBABILITIES) out.push({ form: 'EXACT', n, r, pn, pd }); }
    else { for (let n = 3; n <= 8; n++) for (const [pn, pd] of PROBABILITIES) out.push({ form: 'AT_MOST_ONE', n, r: 0, pn, pd }); }
    return clean(this, out.filter((x) => binomialBand(band, x).length === 0));
  },
  bandIssues: binomialBand,
  present: (x) => {
    const dist = `The random variable X has the distribution B(${x.n}, ${x.pn}/${x.pd}).`;
    if (x.form === 'VARIANCE') return `${dist} Calculate Var(X). Give your answer as an exact value.`;
    if (x.form === 'EXACT') return `${dist} Calculate P(X = ${x.r}), giving your answer as an exact fraction.`;
    return `${dist} Calculate P(X ≤ 1), giving your answer as an exact fraction.`;
  },
  answer: (x) => writeRational(binomialKey(x)),
  // enumerate all 2^n sequences of trials with exact (BigInt) weights; never the binomial formula
  keyHolds: (x, key) => {
    if (key.n <= 0) return false;
    const pn = BigInt(x.pn); const qn = BigInt(x.pd - x.pn); const T = BigInt(x.pd) ** BigInt(x.n);
    const w = (k: number): bigint => pn ** BigInt(k) * qn ** BigInt(x.n - k);
    const kn = BigInt(key.n); const kd = BigInt(key.d);
    if (x.form === 'VARIANCE') {
      const s1 = sequenceWeight(x, (k) => BigInt(k) * w(k)); const s2 = sequenceWeight(x, (k) => BigInt(k * k) * w(k));
      // Var = s2 / T − (s1 / T)², i.e. key = (s2 T − s1²) / T²
      return kn * T * T === kd * (s2 * T - s1 * s1);
    }
    const hit = sequenceWeight(x, (k) => ((x.form === 'EXACT' ? k === x.r : k <= 1) ? w(k) : BigInt(0)));
    return kn * T === kd * hit;
  },
  misconceptionAnswers: (x) => {
    const p = R(x.pn, x.pd); const q = R(x.pd - x.pn, x.pd);
    const pw = (b: Rational, e: number): Rational => { let r = R(1); for (let i = 0; i < e; i++) r = mul(r, b); return r; };
    if (x.form === 'VARIANCE') return [
      { id: 'gives-the-mean', value: mul(R(x.n), p) },
      { id: 'uses-p-squared', value: mul(R(x.n), mul(p, p)) },
      { id: 'omits-the-number-of-trials', value: mul(p, q) },
    ];
    if (x.form === 'EXACT') return [
      { id: 'omits-the-binomial-coefficient', value: mul(pw(p, x.r), pw(q, x.n - x.r)) },
      { id: 'swaps-p-and-q', value: mul(R(choose(x.n, x.r)), mul(pw(q, x.r), pw(p, x.n - x.r))) },
      { id: 'omits-the-failure-factor', value: mul(R(choose(x.n, x.r)), pw(p, x.r)) },
    ];
    const k = binomialKey(x);
    return [
      { id: 'gives-only-p-of-one', value: mul(R(x.n), mul(p, pw(q, x.n - 1))) },
      { id: 'gives-only-p-of-zero', value: pw(q, x.n) },
      { id: 'gives-the-complement', value: sub(R(1), k) },
      { id: 'omits-the-coefficient-of-p-of-one', value: add(pw(q, x.n), mul(p, pw(q, x.n - 1))) },
    ];
  },
  recognitionKey: (x) => `${x.form}|${x.n}|${x.r}|${x.pn}|${x.pd}`,
};

// ====================================================================== P5 The normal distribution (no tables)
/**
 * Z_VALUE        X ~ N(μ, σ²): the z with P(X < x) = P(Z < z) is (x − μ)/σ
 * SYMMETRY       P(X < a) = P(X > b) with a < μ: b = 2μ − a
 * MEAN_FROM_TWO  P(X < x₁) = P(Z < z₁), P(X > x₂) = P(Z > z₂), z half-integers: μ = (z₂x₁ − z₁x₂)/(z₂ − z₁)
 * Every key is exact because the z-values are stated exactly (never read from a table).
 */
export interface NormalParameters extends Record<string, number | string> { form: 'Z_VALUE' | 'SYMMETRY' | 'MEAN_FROM_TWO'; mu: number; sigma: number; x: number; z1h: number; z2h: number; x2: number }
const NORMAL_FORMS = { FOUNDATIONAL: ['Z_VALUE'], STANDARD: ['SYMMETRY'], CHALLENGE: ['MEAN_FROM_TWO'] } as const;
const normalKey = (v: NormalParameters): Rational => {
  if (v.form === 'Z_VALUE') return R(v.x - v.mu, v.sigma);
  if (v.form === 'SYMMETRY') return R(2 * v.mu - v.x);
  return R(v.mu);
};
const normalBand = (band: PlanningBand, v: NormalParameters): string[] => {
  const i: string[] = []; const n = need(i);
  n(bandForm(NORMAL_FORMS, band, v.form as never), 'FORM_IS_NOT_THE_BANDS');
  if (v.form === 'Z_VALUE') n(v.x > v.mu && v.x - v.mu <= 2 * v.sigma, 'VALUE_OUTSIDE_THE_ENVELOPE');
  if (v.form === 'SYMMETRY') n(v.x < v.mu && v.mu - v.x <= 4 * v.sigma, 'VALUE_OUTSIDE_THE_ENVELOPE');
  if (v.form === 'MEAN_FROM_TWO') n(v.z1h < v.z2h && v.z1h !== 0 && v.z2h !== 0 && v.sigma % 2 === 0 && v.x === v.mu + (v.z1h * v.sigma) / 2 && v.x2 === v.mu + (v.z2h * v.sigma) / 2 && v.x > 0, 'STATEMENTS_OUTSIDE_THE_ENVELOPE');
  return i;
};
/** P(Z < z) by composite Simpson integration of the standard normal density from −12. */
const phi = (z: number): number => {
  const lo = -12; const steps = 2 * Math.ceil((z - lo) / 0.005 / 2); const h = (z - lo) / steps;
  const f = (t: number) => Math.exp(-t * t / 2) / Math.sqrt(2 * Math.PI);
  let s = f(lo) + f(z); for (let k = 1; k < steps; k++) s += (k % 2 === 1 ? 4 : 2) * f(lo + k * h);
  return (s * h) / 3;
};
export const CIE_NORMAL_EXACT: ParametricConstruct<NormalParameters> = {
  construct: 'CIE_NORMAL_EXACT', rendererVersion: 'tb.cie.normal-exact@0.1.0', languages: ['en'],
  enumerate(band) {
    const out: NormalParameters[] = [];
    if (band === 'FOUNDATIONAL') { for (let mu = 20; mu <= 90; mu += 10) for (const sigma of [2, 4, 5, 8, 10]) for (let d = 1; d <= 2 * sigma; d++) out.push({ form: 'Z_VALUE', mu, sigma, x: mu + d, z1h: 0, z2h: 0, x2: 0 }); }
    else if (band === 'STANDARD') { for (let mu = 20; mu <= 90; mu += 10) for (const sigma of [3, 5]) for (let d = 1; d <= 12; d++) out.push({ form: 'SYMMETRY', mu, sigma, x: mu - d, z1h: 0, z2h: 0, x2: 0 }); }
    else {
      const Z = [-4, -3, -2, -1, 1, 2, 3, 4];
      for (let mu = 20; mu <= 80; mu += 10) for (const sigma of [2, 4, 6, 8, 10]) for (const z1h of Z) for (const z2h of Z) if (z1h < z2h) out.push({ form: 'MEAN_FROM_TWO', mu, sigma, x: mu + (z1h * sigma) / 2, z1h, z2h, x2: mu + (z2h * sigma) / 2 });
    }
    return clean(this, out.filter((v) => normalBand(band, v).length === 0));
  },
  bandIssues: normalBand,
  present: (v) => {
    if (v.form === 'Z_VALUE') return `The random variable X has the distribution N(${v.mu}, ${v.sigma * v.sigma}). Calculate the value of z for which P(X < ${v.x}) = P(Z < z), where Z ~ N(0, 1). Give your answer as an exact value.`;
    if (v.form === 'SYMMETRY') return `The random variable X has the distribution N(${v.mu}, ${v.sigma * v.sigma}). Determine the value of b for which P(X > b) = P(X < ${v.x}).`;
    return `The random variable X is normally distributed with mean μ and standard deviation σ. It is given that P(X < ${v.x}) = P(Z < ${decimalText(v.z1h)}) and P(X > ${v.x2}) = P(Z > ${decimalText(v.z2h)}), where Z ~ N(0, 1). Determine the value of μ.`;
  },
  answer: (v) => writeRational(normalKey(v)),
  keyHolds: (v, key) => {
    if (key.n <= 0) return false;
    // Z_VALUE: substituting back, μ + zσ must be the shown value
    if (v.form === 'Z_VALUE') return sameRational(add(R(v.mu), mul(key, R(v.sigma))), R(v.x));
    // SYMMETRY: the two tail areas, by numerical integration of the density, must be equal
    if (v.form === 'SYMMETRY') { const k = key.n / key.d; return Math.abs(phi((v.x - v.mu) / v.sigma) - (1 - phi((k - v.mu) / v.sigma))) < 1e-9; }
    // MEAN_FROM_TWO: the first statement with μ = key gives σ; the second must then hold with that σ
    const sigma = div(sub(R(v.x), key), R(v.z1h, 2));
    return sigma.n > 0 && sameRational(add(key, mul(R(v.z2h, 2), sigma)), R(v.x2));
  },
  misconceptionAnswers: (v) => {
    if (v.form === 'Z_VALUE') return [
      { id: 'divides-by-the-variance', value: R(v.x - v.mu, v.sigma * v.sigma) },
      { id: 'forgets-to-subtract-the-mean', value: R(v.x, v.sigma) },
      { id: 'divides-by-the-mean', value: R(v.x - v.mu, v.mu) },
    ];
    if (v.form === 'SYMMETRY') return [
      { id: 'gives-the-distance-from-the-mean', value: R(v.mu - v.x) },
      { id: 'adds-the-value-to-the-mean', value: R(v.mu + v.x) },
      { id: 'reflects-by-two-standard-deviations', value: R(v.x + 2 * v.sigma) },
    ];
    return [
      { id: 'averages-the-two-values', value: R(v.x + v.x2, 2) },
      { id: 'sign-error-on-the-first-z-value', value: R(2 * v.x + v.z1h * v.sigma, 2) },
      { id: 'gives-the-standard-deviation', value: R(v.sigma) },
      { id: 'gives-the-difference-of-the-values', value: R(v.x2 - v.x) },
    ];
  },
  recognitionKey: (v) => `${v.form}|${v.mu}|${v.sigma}|${v.x}|${v.z1h}|${v.z2h}|${v.x2}`,
};

export const CIE_9709_P2P4P5_CONSTRUCTS = [CIE_LOG_EXP_EQUATION, CIE_PRODUCT_QUOTIENT_GRADIENT, CIE_NUMERICAL_ROOT, CIE_CONSTANT_ACCELERATION, CIE_FORCES_ON_A_PLANE, CIE_ENERGY_WORK_POWER, CIE_COUNTING_ARRANGEMENTS, CIE_PROBABILITY_EVENTS, CIE_BINOMIAL_EXACT, CIE_NORMAL_EXACT] as const;
