/**
 * IB Mathematics: analysis and approaches HL -- three StudyUs-original PARAMETRIC_DETERMINISTIC constructs for the
 * three governed objectives the Content Factory constructs leave uncovered (pure data + pure functions, no IO, no
 * provider). Each keys ONE exact integer, recomputed by `keyHolds` from the shown numbers by another route.
 *
 *   aahl.p1.extended      IB_SHOW_THAT_STATIONARY_MINIMUM  show where a cubic is stationary, hence find its local minimum
 *   aahl.p2.trigonometry  IB_COSINE_RULE_SIDE              a side of a triangle with a 60° or 120° angle (cosine rule)
 *   aahl.p2.extended      IB_EXPONENTIAL_MODEL             an exponential growth / decay model in context
 *
 * "Show that" is IB's own command term (system-profiles.ts IB_TERMS). The learner enters the final value the "hence"
 * part asks for; the shown result of the "show that" part is the route to it (answer marks, no method marks).
 */
import { rational, sameRational, type ParametricConstruct, type PlanningBand, type Rational } from './parametric';

const R = (n: number, d = 1): Rational => rational(n, d);
const need = (issues: string[]) => (ok: boolean, miss: string) => { if (!ok) issues.push(miss); };
const minus = (n: number): string => (n < 0 ? `−${-n}` : String(n));
const intKey = (text: string): Rational => R(Number(text));
/** Drop parameter sets whose key is not a positive integer or equals a modelled misconception. */
const clean = <P extends Record<string, number | string>>(c: Pick<ParametricConstruct<P>, 'answer' | 'misconceptionAnswers'>, sets: P[]): P[] =>
  sets.filter((p) => { const k = intKey(c.answer(p)); return Number.isInteger(k.n) && k.d === 1 && k.n > 0 && !c.misconceptionAnswers(p).some((m) => m.value !== null && sameRational(m.value, k)); });

// ====================================================================== P1 extended: show that ... hence find
/**
 * y = x³ − 3p x² + c          (QUADRATIC_FACTOR): y' = 3x(x − 2p), stationary at x = 0 and x = 2p, minimum c − 4p³
 * y = x³ − 3p x² − 9p² x + c  (DISTINCT_ROOTS):   y' = 3(x + p)(x − 3p), stationary at x = −p and x = 3p, minimum c − 27p³
 */
export interface StationaryParameters extends Record<string, number | string> { form: 'QUADRATIC_FACTOR' | 'DISTINCT_ROOTS'; p: number; c: number }
const coefficients = (x: StationaryParameters): [number, number, number, number] => (x.form === 'QUADRATIC_FACTOR' ? [1, -3 * x.p, 0, x.c] : [1, -3 * x.p, -9 * x.p * x.p, x.c]);
const stationaryXs = (x: StationaryParameters): [number, number] => (x.form === 'QUADRATIC_FACTOR' ? [0, 2 * x.p] : [-x.p, 3 * x.p]);
const cubicAt = (k: [number, number, number, number], t: number): number => k[0] * t ** 3 + k[1] * t ** 2 + k[2] * t + k[3];
const stationaryBand = (band: PlanningBand, x: StationaryParameters): string[] => {
  const i: string[] = []; const n = need(i);
  n(band === 'FOUNDATIONAL' ? x.form === 'QUADRATIC_FACTOR' && x.p <= 2 : band === 'STANDARD' ? x.form === 'QUADRATIC_FACTOR' && x.p >= 3 : x.form === 'DISTINCT_ROOTS', 'LEVERS_ARE_NOT_THE_BANDS');
  n(x.p >= 1 && x.p <= (x.form === 'DISTINCT_ROOTS' ? 2 : 4), 'P_OUTSIDE_THE_ENVELOPE');
  n(x.c >= 1 && x.c <= 800, 'C_OUTSIDE_THE_ENVELOPE');
  return i;
};
const cubicText = (k: [number, number, number, number]): string => {
  const terms: string[] = ['x³'];
  if (k[1] !== 0) terms.push(`${k[1] < 0 ? '−' : '+'} ${Math.abs(k[1]) === 1 ? '' : Math.abs(k[1])}x²`);
  if (k[2] !== 0) terms.push(`${k[2] < 0 ? '−' : '+'} ${Math.abs(k[2]) === 1 ? '' : Math.abs(k[2])}x`);
  if (k[3] !== 0) terms.push(`${k[3] < 0 ? '−' : '+'} ${Math.abs(k[3])}`);
  return terms.join(' ');
};
export const IB_SHOW_THAT_STATIONARY_MINIMUM: ParametricConstruct<StationaryParameters> = {
  construct: 'IB_SHOW_THAT_STATIONARY_MINIMUM', rendererVersion: 'tb.ib.show-that-stationary-minimum@0.1.0', languages: ['en'],
  enumerate(band) {
    const out: StationaryParameters[] = [];
    for (const form of ['QUADRATIC_FACTOR', 'DISTINCT_ROOTS'] as const) for (let p = 1; p <= 4; p++) for (let c = 5; c <= 800; c += 5) {
      const x: StationaryParameters = { form, p, c }; if (stationaryBand(band, x).length === 0) out.push(x);
    }
    return clean(this, out);
  },
  bandIssues: stationaryBand,
  present: (x) => { const [a, b] = stationaryXs(x); return `Consider the curve y = ${cubicText(coefficients(x))}. Show that the curve has stationary points where x = ${minus(a)} and x = ${minus(b)}. Hence find the y-coordinate of the local minimum point of the curve.`; },
  answer: (x) => String(x.form === 'QUADRATIC_FACTOR' ? x.c - 4 * x.p ** 3 : x.c - 27 * x.p ** 3),
  // from the shown cubic only: scan the integers for the zero of y' where y'' > 0, and evaluate y there
  keyHolds: (x, key) => {
    if (key.d !== 1) return false;
    const k = coefficients(x); const d1 = (t: number) => 3 * k[0] * t * t + 2 * k[1] * t + k[2]; const d2 = (t: number) => 6 * k[0] * t + 2 * k[1];
    const minima: number[] = []; for (let t = -50; t <= 50; t++) if (d1(t) === 0 && d2(t) > 0) minima.push(t);
    return minima.length === 1 && cubicAt(k, minima[0]) === key.n;
  },
  misconceptionAnswers: (x) => { const k = coefficients(x); const [a, b] = stationaryXs(x); return [
    { id: 'gives-the-x-coordinate', value: R(b) },
    { id: 'gives-the-local-maximum', value: R(cubicAt(k, a)) },
    { id: 'gives-the-y-intercept', value: x.form === 'DISTINCT_ROOTS' ? R(x.c) : null },
    { id: 'adds-instead-of-subtracting', value: R(x.form === 'QUADRATIC_FACTOR' ? x.c + 4 * x.p ** 3 : x.c + 27 * x.p ** 3) },
  ]; },
  recognitionKey: (x) => `${x.form}|${x.p}|${x.c}`,
};

// ====================================================================== P2 trigonometry: cosine rule
/** A triangle with angle C = 60° or 120° and integer sides: c² = a² + b² ∓ ab. */
export interface CosineParameters extends Record<string, number | string> { angle: 60 | 120; a: number; b: number; ask: 'OPPOSITE' | 'ADJACENT' }
const opposite2 = (x: CosineParameters): number => x.a * x.a + x.b * x.b + (x.angle === 60 ? -1 : 1) * x.a * x.b;
const isSquare = (n: number): boolean => n > 0 && Number.isInteger(Math.sqrt(n));
const cosineBand = (band: PlanningBand, x: CosineParameters): string[] => {
  const i: string[] = []; const n = need(i);
  n(band === 'FOUNDATIONAL' ? x.angle === 60 && x.ask === 'OPPOSITE' : band === 'STANDARD' ? x.angle === 120 && x.ask === 'OPPOSITE' : x.angle === 120 && x.ask === 'ADJACENT', 'LEVERS_ARE_NOT_THE_BANDS');
  n(x.a !== x.b, 'ISOSCELES_IS_TRIVIAL');
  n(isSquare(opposite2(x)), 'THIRD_SIDE_NOT_AN_INTEGER');
  return i;
};
export const IB_COSINE_RULE_SIDE: ParametricConstruct<CosineParameters> = {
  construct: 'IB_COSINE_RULE_SIDE', rendererVersion: 'tb.ib.cosine-rule-side@0.1.0', languages: ['en'],
  enumerate(band) {
    const out: CosineParameters[] = [];
    for (const angle of [60, 120] as const) for (const ask of ['OPPOSITE', 'ADJACENT'] as const) for (let a = 2; a <= 40; a++) for (let b = 2; b <= 40; b++) {
      const x: CosineParameters = { angle, a, b, ask }; if (cosineBand(band, x).length === 0) out.push(x);
    }
    return clean(this, out);
  },
  bandIssues: cosineBand,
  // ADJACENT: BC = a and AB = c are shown, AC = b is asked (with C = 120° the quadratic b² + ab + a² − c² = 0 has one positive root)
  present: (x) => x.ask === 'OPPOSITE'
    ? `In triangle ABC, BC = ${x.a} cm, AC = ${x.b} cm and angle ACB = ${x.angle}°. Find the length of AB, in cm.`
    : `In triangle ABC, BC = ${x.a} cm, AB = ${Math.round(Math.sqrt(opposite2(x)))} cm and angle ACB = ${x.angle}°. Find the length of AC, in cm.`,
  answer: (x) => String(x.ask === 'OPPOSITE' ? Math.round(Math.sqrt(opposite2(x))) : x.b),
  // from the shown sides and angle: c² = a² + b² − 2ab cos C, with cos 60° = 1/2 and cos 120° = −1/2
  keyHolds: (x, key) => {
    if (key.d !== 1 || key.n <= 0) return false;
    const twoCos = x.angle === 60 ? 1 : -1;
    if (x.ask === 'OPPOSITE') return key.n * key.n === x.a * x.a + x.b * x.b - twoCos * x.a * x.b;
    const c = Math.round(Math.sqrt(opposite2(x)));
    const roots: number[] = []; for (let b = 1; b <= 200; b++) if (c * c === x.a * x.a + b * b - twoCos * x.a * b) roots.push(b);
    return roots.length === 1 && roots[0] === key.n;
  },
  misconceptionAnswers: (x) => {
    const pyth = x.a * x.a + x.b * x.b; const flipped = x.a * x.a + x.b * x.b + (x.angle === 60 ? 1 : -1) * x.a * x.b;
    const c = Math.round(Math.sqrt(opposite2(x)));
    return x.ask === 'OPPOSITE' ? [
      { id: 'uses-pythagoras', value: isSquare(pyth) ? R(Math.sqrt(pyth)) : null },
      { id: 'uses-the-wrong-sign-of-the-cosine', value: isSquare(flipped) ? R(Math.sqrt(flipped)) : null },
      { id: 'gives-the-square-of-the-side', value: R(opposite2(x)) },
    ] : [
      { id: 'subtracts-the-shown-sides', value: R(Math.abs(c - x.a)) },
      { id: 'gives-the-shown-side', value: R(c) },
      { id: 'uses-pythagoras', value: isSquare(c * c - x.a * x.a) ? R(Math.sqrt(c * c - x.a * x.a)) : null },
    ];
  },
  recognitionKey: (x) => `${x.angle}|${x.a}|${x.b}|${x.ask}`,
};

// ====================================================================== P2 extended: exponential model in context
/**
 * GROWTH   a population of N0 doubles every d hours; the number after t = k d hours is N0 · 2^k
 * DECAY    a mass of M0 grams halves every d years; the mass after t = k d years is M0 / 2^k (an integer)
 * TIME     a population of N0 triples every d hours; the time until it is M = N0 · 3^k is k d hours
 */
export interface ExponentialParameters extends Record<string, number | string> { model: 'GROWTH' | 'DECAY' | 'TIME'; n0: number; d: number; k: number }
const base = (x: ExponentialParameters): number => (x.model === 'TIME' ? 3 : 2);
const expBand = (band: PlanningBand, x: ExponentialParameters): string[] => {
  const i: string[] = []; const n = need(i);
  n((band === 'FOUNDATIONAL' ? 'GROWTH' : band === 'STANDARD' ? 'DECAY' : 'TIME') === x.model, 'MODEL_IS_NOT_THE_BANDS');
  n(x.k >= 2 && x.k <= 6, 'K_OUTSIDE_THE_ENVELOPE');
  n(x.model !== 'DECAY' || x.n0 % 2 ** x.k === 0, 'DECAYED_MASS_NOT_AN_INTEGER');
  n(x.n0 * base(x) ** x.k <= 200000, 'TOO_LARGE');
  return i;
};
export const IB_EXPONENTIAL_MODEL: ParametricConstruct<ExponentialParameters> = {
  construct: 'IB_EXPONENTIAL_MODEL', rendererVersion: 'tb.ib.exponential-model@0.1.0', languages: ['en'],
  enumerate(band) {
    const out: ExponentialParameters[] = [];
    for (const model of ['GROWTH', 'DECAY', 'TIME'] as const) for (const n0 of [50, 64, 80, 120, 128, 150, 192, 200, 256, 320, 400, 640]) for (const d of [2, 3, 4, 5, 6]) for (let k = 2; k <= 6; k++) {
      const x: ExponentialParameters = { model, n0, d, k }; if (expBand(band, x).length === 0) out.push(x);
    }
    return clean(this, out);
  },
  bandIssues: expBand,
  present: (x) => x.model === 'GROWTH'
    ? `A population of bacteria is modelled by N = ${x.n0} × 2^(t/${x.d}), where t is the time in hours. Find the number of bacteria after ${x.k * x.d} hours.`
    : x.model === 'DECAY'
      ? `The mass of a radioactive substance halves every ${x.d} years. Initially there are ${x.n0} grams. Find the mass, in grams, that remains after ${x.k * x.d} years.`
      : `A population of insects triples every ${x.d} hours. Initially there are ${x.n0} insects. Find the time, in hours, until the population is ${x.n0 * 3 ** x.k}.`,
  answer: (x) => String(x.model === 'GROWTH' ? x.n0 * 2 ** x.k : x.model === 'DECAY' ? x.n0 / 2 ** x.k : x.k * x.d),
  // by simulation of the shown model, one period at a time
  keyHolds: (x, key) => {
    if (key.d !== 1 || key.n <= 0) return false;
    if (x.model === 'TIME') { let pop = x.n0; let t = 0; while (pop < x.n0 * 3 ** x.k) { pop *= 3; t += x.d; } return pop === x.n0 * 3 ** x.k && t === key.n; }
    let q = x.n0; for (let t = 0; t < x.k * x.d; t += x.d) q = x.model === 'GROWTH' ? q * 2 : q / 2; return q === key.n;
  },
  misconceptionAnswers: (x) => x.model === 'TIME' ? [
    { id: 'gives-the-number-of-periods', value: R(x.k) },
    { id: 'divides-by-the-period', value: x.k % x.d === 0 ? R(x.k / x.d) : null },
    { id: 'linear-growth', value: null },
  ] : [
    { id: 'linear-growth', value: R(x.model === 'GROWTH' ? x.n0 + x.n0 * x.k : Math.max(1, x.n0 - (x.n0 / 2) * x.k)) },
    { id: 'one-period-short', value: R(x.model === 'GROWTH' ? x.n0 * 2 ** (x.k - 1) : x.n0 / 2 ** (x.k - 1)) },
    { id: 'uses-the-time-as-the-exponent', value: x.model === 'GROWTH' && x.k * x.d <= 20 ? R(x.n0 * 2 ** (x.k * x.d)) : null },
  ],
  recognitionKey: (x) => `${x.model}|${x.n0}|${x.d}|${x.k}`,
};

export const IB_AAHL_EXT_CONSTRUCTS = [IB_SHOW_THAT_STATIONARY_MINIMUM, IB_COSINE_RULE_SIDE, IB_EXPONENTIAL_MODEL] as const;
