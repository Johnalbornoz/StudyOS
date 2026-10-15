/**
 * Cambridge 9709 Paper 1 -- eight PARAMETRIC_DETERMINISTIC constructs, one per official section (StudyUs original;
 * pure data + pure functions, no IO, no provider). Every prompt uses a command word of the 9709 syllabus's own table
 * (determine / calculate / evaluate) -- "find" is not one of them.
 *
 *   1.1 Quadratics           CIE_QUADRATIC_MINIMUM        minimum value of a quadratic
 *   1.2 Functions            CIE_INVERSE_FUNCTION_VALUE   a value of the inverse of a one-one function
 *   1.3 Coordinate geometry  CIE_DISTANCE_BETWEEN_POINTS  length of a line segment (from its ends, or an end and the midpoint)
 *   1.4 Circular measure     CIE_SECTOR_MEASURE           arc length / sector area in radians
 *   1.5 Trigonometry         CIE_TRIG_EQUATION_IN_INTERVAL  the one solution of a simple trigonometric equation in a quadrant
 *   1.6 Series               CIE_GP_SUM_TO_INFINITY       sum to infinity of a convergent geometric progression
 *   1.7 Differentiation      CIE_GRADIENT_AT_A_POINT      gradient of a curve at a point
 *   1.8 Integration          CIE_DEFINITE_INTEGRAL        exact value of a definite integral of a polynomial
 *
 * 1.1, 1.2, 1.6, 1.7 and 1.8 reuse the MATHEMATICS of the Content Factory constructs Track B already verified
 * (cf-ib-aahl-01.constructs.ts: parameter sets, keys, independent key checks, misconception models), re-worded for
 * Cambridge: a re-wording is checked to change the instruction only (the shown numbers are the same).
 * 1.3, 1.4 and 1.5 are new; each has its own independent key check.
 */
import { rational, sameRational, writeRational, type ParametricConstruct, type PlanningBand, type Rational } from './parametric';
import { DEFINITE_INTEGRAL_POLYNOMIAL, GEOMETRIC_SUM_TO_INFINITY, INVERSE_FUNCTION_VALUE, QUADRATIC_MINIMUM_VALUE, TANGENT_GRADIENT_AT_A_POINT, decimalIsAmbiguous } from './cf-ib-aahl-01.constructs';

const R = (n: number, d = 1): Rational => rational(n, d);
const need = (issues: string[]) => (ok: boolean, miss: string) => { if (!ok) issues.push(miss); };
const keyOf = (text: string): Rational => { const m = /^(-?\d+)\/(\d+)$/.exec(text); return m ? R(Number(m[1]), Number(m[2])) : R(Number(text)); };
const clean = <P extends Record<string, number | string>>(c: Pick<ParametricConstruct<P>, 'answer' | 'misconceptionAnswers'>, sets: P[]): P[] => sets.filter((p) => { const k = keyOf(c.answer(p)); return k.n > 0 && !decimalIsAmbiguous(k) && !c.misconceptionAnswers(p).some((m) => m.value !== null && sameRational(m.value, k)); });

/**
 * A Content Factory construct re-worded for Cambridge: the same parameter sets, key, check and misconceptions; only
 * the instruction changes. `reword` must change the wording and keep every number the learner is shown.
 */
function reworded<P extends Record<string, number | string>>(base: ParametricConstruct<P>, construct: string, rendererVersion: string, reword: (text: string) => string): ParametricConstruct<P> {
  const digits = (t: string) => (t.match(/[0-9⁰¹²³⁴⁵⁶⁷⁸⁹₀₁₂₃₄₅₆₇₈₉−-]+/g) ?? []).join(' ');
  return {
    ...base, construct, rendererVersion,
    enumerate: (band) => base.enumerate(band),
    present: (p, language) => {
      const original = base.present(p, language); const text = reword(original);
      if (text === original || digits(text) !== digits(original)) throw new Error(`CIE_REWORDING_INVALID ${construct}: ${original}`);
      return text;
    },
  };
}

// ---------------------------------------------------------------------- 1.1 Quadratics (CF mathematics, re-worded)
export const CIE_QUADRATIC_MINIMUM = reworded(QUADRATIC_MINIMUM_VALUE, 'CIE_QUADRATIC_MINIMUM', 'tb.cie.quadratic-minimum@0.1.0',
  (t) => t.replace(/^Let f\(x\) = (.+), x ∈ ℝ\. Find the minimum value of f\(x\)\.$/, 'The function f is defined by f(x) = $1 for x ∈ ℝ. Determine the minimum value of f(x).'));

// ---------------------------------------------------------------------- 1.2 Functions (CF mathematics, re-worded)
export const CIE_INVERSE_FUNCTION_VALUE = reworded(INVERSE_FUNCTION_VALUE, 'CIE_INVERSE_FUNCTION_VALUE', 'tb.cie.inverse-function-value@0.1.0',
  (t) => t.replace(/^The function f is defined by f\(x\) = (.+), (x [∈≠] [^.]+)\. Find f⁻¹\((.+)\)\.$/, 'The function f is defined by f(x) = $1 for $2. Determine the value of f⁻¹($3).'));

// ---------------------------------------------------------------------- 1.6 Series (CF mathematics, re-worded)
export const CIE_GP_SUM_TO_INFINITY = reworded(GEOMETRIC_SUM_TO_INFINITY, 'CIE_GP_SUM_TO_INFINITY', 'tb.cie.gp-sum-to-infinity@0.1.0',
  (t) => t
    .replace(/^Find the sum to infinity of the geometric series (.+)$/, 'Calculate the sum to infinity of the geometric progression $1')
    .replace(/^The second term of a geometric sequence is (.+) and the third term is (.+)\. All terms are positive\. Find the sum to infinity of the sequence\.$/, 'The second and third terms of a geometric progression are $1 and $2 respectively, and all its terms are positive. Calculate the sum to infinity of the progression.'));

// ---------------------------------------------------------------------- 1.7 Differentiation (CF mathematics, re-worded)
export const CIE_GRADIENT_AT_A_POINT = reworded(TANGENT_GRADIENT_AT_A_POINT, 'CIE_GRADIENT_AT_A_POINT', 'tb.cie.gradient-at-a-point@0.1.0',
  (t) => t.replace(/Find the gradient of the tangent to the curve at the point where x = (.+)\.$/, 'Calculate the gradient of the curve at the point where x = $1.'));

// ---------------------------------------------------------------------- 1.8 Integration (CF mathematics, re-worded)
export const CIE_DEFINITE_INTEGRAL = reworded(DEFINITE_INTEGRAL_POLYNOMIAL, 'CIE_DEFINITE_INTEGRAL', 'tb.cie.definite-integral@0.1.0',
  (t) => t.replace(/^Find the exact value of (.+)\.$/, 'Evaluate $1, giving your answer as an exact value.'));

// ====================================================================== 1.3 Coordinate geometry (new)
export interface DistParameters extends Record<string, number | string> { x1: number; y1: number; dx: number; dy: number; given: 'ENDS' | 'END_AND_MIDPOINT' }
// B = A + (dx, dy); |AB| = sqrt(dx^2 + dy^2) is an integer (a Pythagorean pair); for END_AND_MIDPOINT the midpoint is shown
const TRIPLES: readonly [number, number][] = [[3, 4], [6, 8], [5, 12], [9, 12], [8, 15], [12, 16], [7, 24], [20, 21]];
const distBand = (band: PlanningBand, x: DistParameters): string[] => {
  const i: string[] = []; const n = need(i);
  n(band === 'CHALLENGE' ? x.given === 'END_AND_MIDPOINT' : x.given === 'ENDS', 'GIVEN_IS_NOT_THE_BANDS');
  n(band !== 'FOUNDATIONAL' || (x.x1 >= 0 && x.y1 >= 0 && x.dx > 0 && x.dy > 0), 'FOUNDATIONAL_IS_THE_FIRST_QUADRANT_UPWARDS');
  n(band === 'FOUNDATIONAL' || x.dx < 0 || x.dy < 0 || x.x1 < 0 || x.y1 < 0, 'NO_NEGATIVE_COORDINATE_OR_DIRECTION');
  n(x.given !== 'END_AND_MIDPOINT' || (x.dx % 2 === 0 && x.dy % 2 === 0), 'MIDPOINT_NOT_INTEGER');
  return i;
};
const pt = (x: number, y: number): string => `(${String(x).replace('-', '−')}, ${String(y).replace('-', '−')})`;
export const CIE_DISTANCE_BETWEEN_POINTS: ParametricConstruct<DistParameters> = {
  construct: 'CIE_DISTANCE_BETWEEN_POINTS', rendererVersion: 'tb.cie.distance-between-points@0.1.0', languages: ['en'],
  enumerate(band) {
    const out: DistParameters[] = [];
    const given = band === 'CHALLENGE' ? 'END_AND_MIDPOINT' : 'ENDS';
    for (const [a, b] of TRIPLES) for (const [dx, dy] of [[a, b], [b, a]]) for (const sx of [1, -1]) for (const sy of [1, -1]) for (const x1 of [-5, -2, 0, 1, 3, 6]) for (const y1 of [-4, -1, 0, 2, 5]) {
      const x: DistParameters = { x1, y1, dx: sx * dx, dy: sy * dy, given };
      if (distBand(band, x).length === 0) out.push(x);
    }
    return clean(this, out);
  },
  bandIssues: distBand,
  present: (x) => x.given === 'ENDS'
    ? `The points A and B have coordinates ${pt(x.x1, x.y1)} and ${pt(x.x1 + x.dx, x.y1 + x.dy)} respectively. Calculate the length of AB.`
    : `The point A has coordinates ${pt(x.x1, x.y1)} and the midpoint of the line segment AB has coordinates ${pt(x.x1 + x.dx / 2, x.y1 + x.dy / 2)}. Calculate the length of AB.`,
  answer: (x) => String(Math.round(Math.sqrt(x.dx * x.dx + x.dy * x.dy))),
  // from the SHOWN coordinates only: recover B (doubling the midpoint step when it is the midpoint that is shown), then |AB|^2 = key^2
  keyHolds: (x, key) => { if (key.d !== 1 || key.n <= 0) return false; const bx = x.given === 'ENDS' ? x.x1 + x.dx : 2 * (x.x1 + x.dx / 2) - x.x1; const by = x.given === 'ENDS' ? x.y1 + x.dy : 2 * (x.y1 + x.dy / 2) - x.y1; return (bx - x.x1) ** 2 + (by - x.y1) ** 2 === key.n * key.n; },
  misconceptionAnswers: (x) => [
    { id: 'gives-the-square-of-the-length', value: R(x.dx * x.dx + x.dy * x.dy) },
    { id: 'adds-the-coordinate-differences', value: R(Math.abs(x.dx) + Math.abs(x.dy)) },
    { id: 'gives-the-distance-to-the-midpoint', value: x.given === 'END_AND_MIDPOINT' ? R(Math.round(Math.sqrt(x.dx * x.dx + x.dy * x.dy)), 2) : null },
  ],
  recognitionKey: (x) => `${x.given}|${x.x1}|${x.y1}|${x.dx}|${x.dy}`,
};

// ====================================================================== 1.4 Circular measure (new)
export interface SectorParameters extends Record<string, number | string> { r: number; theta10: number; ask: 'ARC' | 'AREA' | 'AREA_FROM_ARC' }
// angle in radians, theta = theta10 / 10; arc s = r theta; area = r^2 theta / 2 = r s / 2
const sectorKey = (x: SectorParameters): Rational => (x.ask === 'ARC' ? R(x.r * x.theta10, 10) : R(x.r * x.r * x.theta10, 20));
const sectorBand = (band: PlanningBand, x: SectorParameters): string[] => {
  const i: string[] = []; const n = need(i);
  n((band === 'FOUNDATIONAL' ? 'ARC' : band === 'STANDARD' ? 'AREA' : 'AREA_FROM_ARC') === x.ask, 'ASK_IS_NOT_THE_BANDS');
  n(x.theta10 >= 2 && x.theta10 <= 30 && x.theta10 % 10 !== 0, 'ANGLE_OUTSIDE_THE_ENVELOPE');
  n(x.ask !== 'AREA_FROM_ARC' || (x.r * x.theta10) % 10 === 0, 'ARC_NOT_AN_INTEGER');
  return i;
};
const radians = (t10: number): string => (t10 / 10).toFixed(1);
export const CIE_SECTOR_MEASURE: ParametricConstruct<SectorParameters> = {
  construct: 'CIE_SECTOR_MEASURE', rendererVersion: 'tb.cie.sector-measure@0.1.0', languages: ['en'],
  enumerate(band) {
    const out: SectorParameters[] = []; const ask = band === 'FOUNDATIONAL' ? 'ARC' : band === 'STANDARD' ? 'AREA' : 'AREA_FROM_ARC';
    for (let r = 2; r <= 15; r++) for (let t = 2; t <= 30; t++) { const x: SectorParameters = { r, theta10: t, ask }; if (sectorBand(band, x).length === 0) out.push(x); }
    return clean(this, out);
  },
  bandIssues: sectorBand,
  present: (x) => x.ask === 'ARC'
    ? `A sector of a circle has radius ${x.r} cm and angle ${radians(x.theta10)} radians. Calculate the length of the arc of the sector, in cm.`
    : x.ask === 'AREA'
      ? `A sector of a circle has radius ${x.r} cm and angle ${radians(x.theta10)} radians. Calculate the area of the sector, in cm².`
      : `A sector of a circle of radius ${x.r} cm has an arc of length ${(x.r * x.theta10) / 10} cm. Calculate the area of the sector, in cm².`,
  answer: (x) => writeRational(sectorKey(x)),
  // the sector is the fraction theta / (2 pi) of the circle: area / (pi r^2) = theta / (2 pi), so 2 area = r^2 theta; arc s satisfies s = r theta
  keyHolds: (x, key) => { if (key.n <= 0) return false; const theta = R(x.theta10, 10); if (x.ask === 'ARC') return sameRational(key, R(x.r * theta.n, theta.d)); const s = R(x.r * x.theta10, 10); return x.ask === 'AREA' ? sameRational(R(2 * key.n, key.d), R(x.r * x.r * theta.n, theta.d)) : sameRational(R(2 * key.n, key.d), R(x.r * s.n, s.d)); },
  misconceptionAnswers: (x) => x.ask === 'ARC' ? [
    { id: 'gives-the-area', value: R(x.r * x.r * x.theta10, 20) },
    { id: 'uses-the-diameter', value: R(2 * x.r * x.theta10, 10) },
  ] : [
    { id: 'omits-the-half', value: R(x.r * x.r * x.theta10, 10) },
    { id: 'gives-the-arc-length', value: R(x.r * x.theta10, 10) },
    { id: 'uses-r-not-r-squared', value: R(x.r * x.theta10, 20) },
  ],
  recognitionKey: (x) => `${x.ask}|${x.r}|${x.theta10}`,
};

// ====================================================================== 1.5 Trigonometry (new)
type TrigValue = 'HALF' | 'MINUS_HALF' | 'ROOT3_HALF' | 'MINUS_ROOT3_HALF' | 'ONE' | 'MINUS_ONE' | 'ROOT3' | 'MINUS_ROOT3' | 'INV_ROOT3' | 'MINUS_INV_ROOT3';
const TRIG_VALUES: readonly TrigValue[] = ['HALF', 'MINUS_HALF', 'ROOT3_HALF', 'MINUS_ROOT3_HALF', 'ONE', 'MINUS_ONE', 'ROOT3', 'MINUS_ROOT3', 'INV_ROOT3', 'MINUS_INV_ROOT3'];
export interface TrigParameters extends Record<string, number | string> { fn: 'sin' | 'cos' | 'tan'; value: TrigValue; quadrant: number; shift: number }
// equation: c fn(x - shift) = v with c in {1, 2}; exactly one solution x lies in the stated quadrant (90 (q-1) < x < 90 q)
/** The reference angle (degrees) of |value| for each function; null where the value is not an exact value of it. */
const REF_ABS: Record<string, Record<string, number>> = { sin: { HALF: 30, ROOT3_HALF: 60 }, cos: { HALF: 60, ROOT3_HALF: 30 }, tan: { ONE: 45, ROOT3: 60, INV_ROOT3: 30 } };
const absOf = (v: TrigValue): string => v.replace(/^MINUS_/, '');
const isPositive = (v: TrigValue): boolean => !v.startsWith('MINUS_');
const REFERENCE: Record<string, Record<string, number | null>> = Object.fromEntries(['sin', 'cos', 'tan'].map((fn) => [fn, Object.fromEntries(TRIG_VALUES.map((v) => [v, REF_ABS[fn][absOf(v)] ?? null]))]));
const TARGET: Record<string, number> = { HALF: 0.5, ROOT3_HALF: Math.sqrt(3) / 2, ONE: 1, ROOT3: Math.sqrt(3), INV_ROOT3: 1 / Math.sqrt(3) };
const positiveSign = (fn: string, q: number): boolean => (fn === 'sin' ? q <= 2 : fn === 'cos' ? q === 1 || q === 4 : q === 1 || q === 3);
/** The angle (degrees, 0 <= u < 360) of fn(u) = v in quadrant q, or null when fn is not of that sign there. */
const angleIn = (fn: string, value: string, q: number): number | null => {
  const ref = REFERENCE[fn][value]; if (ref === null) return null;
  const positive = isPositive(value as TrigValue);
  if (positiveSign(fn, q) !== positive) return null;
  return q === 1 ? ref : q === 2 ? 180 - ref : q === 3 ? 180 + ref : 360 - ref;
};
const trigKey = (x: TrigParameters): number | null => { const u = angleIn(x.fn, x.value, x.quadrant); return u === null ? null : u + x.shift; };
const trigBand = (band: PlanningBand, x: TrigParameters): string[] => {
  const i: string[] = []; const n = need(i);
  const positive = isPositive(x.value);
  n(band === 'FOUNDATIONAL' ? positive && x.shift === 0 : band === 'STANDARD' ? !positive && x.shift === 0 : x.shift !== 0, 'LEVERS_ARE_NOT_THE_BANDS');
  n(trigKey(x) !== null && trigKey(x)! > 0, 'NO_SOLUTION_IN_THE_QUADRANT');
  return i;
};
const VALUE_TEXT: Record<TrigValue, [string, string]> = { HALF: ['2 ', '1'], MINUS_HALF: ['2 ', '−1'], ROOT3_HALF: ['2 ', '√3'], MINUS_ROOT3_HALF: ['2 ', '−√3'], ONE: ['', '1'], MINUS_ONE: ['', '−1'], ROOT3: ['', '√3'], MINUS_ROOT3: ['', '−√3'], INV_ROOT3: ['√3 ', '1'], MINUS_INV_ROOT3: ['√3 ', '−1'] };
const lowerOf = (x: TrigParameters): number => 90 * (x.quadrant - 1) + x.shift;
export const CIE_TRIG_EQUATION_IN_INTERVAL: ParametricConstruct<TrigParameters> = {
  construct: 'CIE_TRIG_EQUATION_IN_INTERVAL', rendererVersion: 'tb.cie.trig-equation-in-interval@0.1.0', languages: ['en'],
  enumerate(band) {
    const out: TrigParameters[] = [];
    for (const fn of ['sin', 'cos', 'tan'] as const) for (const value of TRIG_VALUES) for (const quadrant of [1, 2, 3, 4]) for (const shift of band === 'CHALLENGE' ? [10, 15, 20, 25, 35, 40] : [0]) {
      const x: TrigParameters = { fn, value, quadrant, shift }; if (trigBand(band, x).length === 0) out.push(x);
    }
    return clean(this, out);
  },
  bandIssues: trigBand,
  present: (x) => { const [c, v] = VALUE_TEXT[x.value]; const arg = x.shift === 0 ? 'x' : `(x − ${x.shift}°)`; return `Determine the value of x, where ${lowerOf(x)}° < x < ${lowerOf(x) + 90}°, for which ${c}${x.fn} ${arg} = ${v}. Give your answer in degrees.`; },
  answer: (x) => String(trigKey(x)),
  // numerically, from the shown equation and interval: the key is in the interval and satisfies it; no other whole degree there does
  keyHolds: (x, key) => {
    if (key.d !== 1) return false;
    const f = (deg: number) => { const r = ((deg - x.shift) * Math.PI) / 180; return x.fn === 'sin' ? Math.sin(r) : x.fn === 'cos' ? Math.cos(r) : Math.tan(r); };
    const target = (isPositive(x.value) ? 1 : -1) * TARGET[absOf(x.value)];
    const lo = lowerOf(x); const hits: number[] = [];
    for (let d = lo + 1; d < lo + 90; d++) if (Math.abs(f(d) - target) < 1e-9) hits.push(d);
    return hits.length === 1 && hits[0] === key.n;
  },
  misconceptionAnswers: (x) => { const ref = REFERENCE[x.fn][x.value] ?? 0; const k = trigKey(x) ?? 0; return [
    { id: 'gives-the-principal-reference-angle', value: R(ref + x.shift) },
    { id: 'uses-the-wrong-quadrant-rule', value: x.quadrant === 2 || x.quadrant === 4 ? R(180 + ref + x.shift) : R(180 - ref + x.shift) },
    { id: 'ignores-the-shift', value: x.shift !== 0 ? R(k - x.shift) : null },
    { id: 'subtracts-the-shift', value: x.shift !== 0 ? R(k - 2 * x.shift) : null },
  ]; },
  recognitionKey: (x) => `${x.fn}|${x.value}|${x.quadrant}|${x.shift}`,
};

export const CIE_9709_P1_CONSTRUCTS = [CIE_QUADRATIC_MINIMUM, CIE_INVERSE_FUNCTION_VALUE, CIE_DISTANCE_BETWEEN_POINTS, CIE_SECTOR_MEASURE, CIE_TRIG_EQUATION_IN_INTERVAL, CIE_GP_SUM_TO_INFINITY, CIE_GRADIENT_AT_A_POINT, CIE_DEFINITE_INTEGRAL] as const;
