/**
 * QF V5.2 -- four further parametric constructs of the Exam Bank library (pure, no IO).
 *
 *   PERCENT_OF_A_QUANTITY          arithmetic  (concept math.num.percent)
 *   LINEAR_EQUATION_ONE_UNKNOWN    algebra     (concept math.alg.linear-equations)
 *   LINEAR_SYSTEM_TWO_UNKNOWNS     algebra     (concept math.alg.linear-systems)
 *   RECTANGLE_AREA_AND_PERIMETER   geometry    (concept math.geo.plane-figures-area-perimeter)
 * Each concept is a certified concept of the PAA hierarchy, named by an official topic. Each construct is bounded
 * and enumerable, keys a positive value, and checks its key by a route that does not reuse how the key was made.
 */
import { rational, sameRational, writeRational, type ParametricConstruct, type PlanningBand, type Rational } from './parametric';

const gcd = (a: number, b: number): number => (b === 0 ? Math.abs(a) : gcd(b, a % b));
const need = (issues: string[]) => (ok: boolean, miss: string) => { if (!ok) issues.push(miss); };
const orNull = (n: number, d = 1): Rational | null => (Number.isInteger(n) && Number.isInteger(d) && d !== 0 ? rational(n, d) : null);
/** Drops the parameter sets whose key a modelled misconception would also give. */
const withoutCollisions = <P extends Record<string, number | string>>(c: Pick<ParametricConstruct<P>, 'answer' | 'misconceptionAnswers'>, sets: P[]): P[] => sets.filter((p) => { const key = rational(...(c.answer(p).split('/').map(Number) as [number, number?])); return !c.misconceptionAnswers(p).some((m) => m.value !== null && sameRational(m.value, key)); });
const signed = (n: number): string => (n < 0 ? `− ${Math.abs(n)}` : `+ ${n}`);
const coef = (n: number, v: string): string => (n === 1 ? v : `${n}${v}`);

// ------------------------------------------------------------------------------------------------- percent
export interface PercentParameters extends Record<string, number | string> { p: number; base: number; final: number; task: 'PART' | 'INCREASED' | 'ORIGINAL' }
const percentBand = (band: PlanningBand, x: PercentParameters): string[] => {
  const issues: string[] = []; const n = need(issues);
  n((band === 'FOUNDATIONAL' ? 'PART' : band === 'STANDARD' ? 'INCREASED' : 'ORIGINAL') === x.task, 'TASK_IS_NOT_THE_BANDS');
  n(x.base >= 40 && x.base <= 480 && x.base % 40 === 0 && x.p >= 5 && x.p <= 75, 'VALUES_OUTSIDE_THE_ENVELOPE');
  n(x.final * 100 === (x.task === 'PART' ? x.p * x.base : x.base * (100 + x.p)), 'RELATIONSHIP_BROKEN');
  return issues;
};
const percentMisconceptions = (x: PercentParameters) => x.task === 'PART' ? [{ id: 'divides-by-the-percent', value: orNull(x.base, x.p) }, { id: 'does-not-divide-by-100', value: rational(x.p * x.base) }]
  : x.task === 'INCREASED' ? [{ id: 'gives-only-the-increase', value: orNull(x.p * x.base, 100) }, { id: 'adds-the-percent-as-a-number', value: rational(x.base + x.p) }]
  : [{ id: 'takes-the-percent-off-the-final', value: orNull(x.final * (100 - x.p), 100) }, { id: 'subtracts-the-percent-as-a-number', value: rational(x.final - x.p) }];
export const PERCENT: ParametricConstruct<PercentParameters> = {
  construct: 'PERCENT_OF_A_QUANTITY', rendererVersion: 'parametric.percent-of-a-quantity@1.0.0', languages: ['es'],
  enumerate(band) {
    const out: PercentParameters[] = [];
    const task = band === 'FOUNDATIONAL' ? 'PART' : band === 'STANDARD' ? 'INCREASED' : 'ORIGINAL';
    for (const p of task === 'PART' ? [20, 25, 50, 75] : [5, 10, 15, 20, 25, 30, 40]) for (let base = 40; base <= 480; base += 40) {
      const final = task === 'PART' ? (p * base) / 100 : (base * (100 + p)) / 100;
      const x: PercentParameters = { p, base, final, task };
      if (Number.isInteger(final) && percentBand(band, x).length === 0) out.push(x);
    }
    return withoutCollisions(this, out);
  },
  bandIssues: percentBand,
  present: (x) => x.task === 'PART' ? `¿Cuánto es el ${x.p} % de ${x.base}?`
    : x.task === 'INCREASED' ? `Un artículo cuesta ${x.base} pesos y su precio aumenta un ${x.p} %. ¿Cuántos pesos cuesta después del aumento?`
    : `Después de un aumento del ${x.p} %, un artículo cuesta ${x.final} pesos. ¿Cuántos pesos costaba antes del aumento?`,
  answer: (x) => String(x.task === 'ORIGINAL' ? x.base : x.final),
  // back from the key to the shown numbers: a part is p hundredths of the base; an increased price is the price plus p hundredths of it
  keyHolds: (x, key) => key.d === 1 && key.n > 0 && (x.task === 'PART' ? key.n * 100 === x.p * x.base : x.task === 'INCREASED' ? key.n * 100 === x.base * 100 + x.base * x.p : key.n * 100 + key.n * x.p === x.final * 100),
  misconceptionAnswers: percentMisconceptions,
  recognitionKey: (x) => `${x.task}|${x.p}|${x.base}`,
};

// --------------------------------------------------------------------------------------- linear equation
export interface EquationParameters extends Record<string, number | string> { a: number; b: number; c: number; d: number; xNum: number; xDen: number; form: 'AX_PLUS_B' | 'X_ON_BOTH_SIDES' | 'BRACKETS_ON_BOTH_SIDES' }
const equationBand = (band: PlanningBand, p: EquationParameters): string[] => {
  const issues: string[] = []; const n = need(issues);
  n((band === 'FOUNDATIONAL' ? 'AX_PLUS_B' : band === 'STANDARD' ? 'X_ON_BOTH_SIDES' : 'BRACKETS_ON_BOTH_SIDES') === p.form, 'FORM_IS_NOT_THE_BANDS');
  n(p.xNum > 0 && (p.xDen === 1 || (band === 'CHALLENGE' && p.xDen === 2)), 'SOLUTION_NOT_POSITIVE_OR_NOT_IN_THE_ENVELOPE');
  n(p.a >= 2 && p.a <= 9, 'COEFFICIENT_OUTSIDE_THE_ENVELOPE');
  return issues;
};
const equationMisconceptions = (p: EquationParameters) => p.form === 'AX_PLUS_B' ? [{ id: 'adds-instead-of-subtracting', value: orNull(p.c + p.b, p.a) }, { id: 'does-not-divide', value: rational(p.c - p.b) }]
  : p.form === 'X_ON_BOTH_SIDES' ? [{ id: 'adds-the-unknown-terms', value: orNull(p.d - p.b, p.a + p.c) }, { id: 'does-not-divide', value: rational(p.d - p.b) }]
  : [{ id: 'multiplies-only-the-first-term', value: orNull(p.d - p.b, p.a - p.c) }];
export const LINEAR_EQUATION: ParametricConstruct<EquationParameters> = {
  construct: 'LINEAR_EQUATION_ONE_UNKNOWN', rendererVersion: 'parametric.linear-equation@1.0.0', languages: ['es'],
  enumerate(band) {
    const out: EquationParameters[] = [];
    const push = (p: EquationParameters) => { if (equationBand(band, p).length === 0) out.push(p); };
    if (band === 'FOUNDATIONAL') for (let a = 2; a <= 9; a += 1) for (let x = 1; x <= 12; x += 1) for (let b = 1; b <= 20; b += 1) push({ a, b, c: a * x + b, d: 0, xNum: x, xDen: 1, form: 'AX_PLUS_B' });
    else if (band === 'STANDARD') for (let a = 3; a <= 9; a += 1) for (let c = 2; c < a; c += 1) for (let x = 1; x <= 12; x += 1) for (let b = 1; b <= 12; b += 1) push({ a, b, c, d: (a - c) * x + b, xNum: x, xDen: 1, form: 'X_ON_BOTH_SIDES' });
    else for (let a = 3; a <= 8; a += 1) for (let c = 2; c < a; c += 1) for (let b = 1; b <= 6; b += 1) for (let d = 2; d <= 12; d += 1) {
      const num = c * d - a * b; const den = a - c;
      if (num <= 0) continue;
      const g = gcd(num, den);
      if (num / g <= 30) push({ a, b, c, d, xNum: num / g, xDen: den / g, form: 'BRACKETS_ON_BOTH_SIDES' });
    }
    return withoutCollisions(this, out);
  },
  bandIssues: equationBand,
  present: (p) => `Si ${p.form === 'AX_PLUS_B' ? `${p.a}x + ${p.b} = ${p.c}` : p.form === 'X_ON_BOTH_SIDES' ? `${p.a}x + ${p.b} = ${p.c}x + ${p.d}` : `${p.a}(x + ${p.b}) = ${p.c}(x + ${p.d})`}, ¿cuál es el valor de x?`,
  answer: (p) => writeRational(rational(p.xNum, p.xDen)),
  // substitute the key into both sides of the shown equation
  keyHolds: (p, key) => key.n > 0 && (p.form === 'AX_PLUS_B' ? p.a * key.n + p.b * key.d === p.c * key.d : p.form === 'X_ON_BOTH_SIDES' ? p.a * key.n + p.b * key.d === p.c * key.n + p.d * key.d : p.a * (key.n + p.b * key.d) === p.c * (key.n + p.d * key.d)),
  misconceptionAnswers: equationMisconceptions,
  // the constant only shifts the right-hand side: the coefficients and the solution are what make the exercise
  recognitionKey: (p) => (p.form === 'AX_PLUS_B' ? `A|${p.a}|${p.xNum}` : p.form === 'X_ON_BOTH_SIDES' ? `B|${p.a}|${p.c}|${p.xNum}` : `C|${p.a}|${p.c}|${p.b}|${p.d}`),
};

// ---------------------------------------------------------------------------------------- linear system
export interface SystemParameters extends Record<string, number | string> { a1: number; b1: number; c1: number; a2: number; b2: number; c2: number; x: number; y: number }
const systemBand = (band: PlanningBand, p: SystemParameters): string[] => {
  const issues: string[] = []; const n = need(issues);
  n(p.a1 * p.x + p.b1 * p.y === p.c1 && p.a2 * p.x + p.b2 * p.y === p.c2 && p.a1 * p.b2 - p.a2 * p.b1 !== 0, 'NOT_A_SYSTEM_WITH_THIS_ONE_SOLUTION');
  n(p.x >= 1 && p.x <= 15 && p.y >= 1 && p.y <= 15 && p.x !== p.y, 'SOLUTION_OUTSIDE_THE_ENVELOPE');
  if (band === 'FOUNDATIONAL') n(p.a1 === 1 && p.b1 === 1 && p.a2 === 1 && p.b2 === -1, 'NOT_A_SUM_AND_A_DIFFERENCE');
  else if (band === 'STANDARD') n(p.a1 >= 2 && p.b1 === 1 && p.a2 === 1 && p.b2 === -1, 'NOT_ONE_STEP_OF_ELIMINATION');
  else n(p.a1 >= 2 && p.b1 >= 2 && p.a2 >= 2 && p.b2 <= -2 && p.b1 !== -p.b2 && p.a1 !== p.a2, 'ELIMINATION_NEEDS_NO_MULTIPLICATION');
  return issues;
};
const line = (a: number, b: number, c: number): string => `${coef(a, 'x')} ${signed(b).replace(/(\d+)$/, (m) => coef(Number(m), 'y'))} = ${c < 0 ? `−${Math.abs(c)}` : c}`;
export const LINEAR_SYSTEM: ParametricConstruct<SystemParameters> = {
  construct: 'LINEAR_SYSTEM_TWO_UNKNOWNS', rendererVersion: 'parametric.linear-system@1.0.0', languages: ['es'],
  enumerate(band) {
    const out: SystemParameters[] = [];
    const push = (a1: number, b1: number, a2: number, b2: number, x: number, y: number) => { const p: SystemParameters = { a1, b1, c1: a1 * x + b1 * y, a2, b2, c2: a2 * x + b2 * y, x, y }; if (systemBand(band, p).length === 0) out.push(p); };
    if (band === 'FOUNDATIONAL') for (let x = 2; x <= 15; x += 1) for (let y = 1; y < x; y += 1) push(1, 1, 1, -1, x, y);
    else if (band === 'STANDARD') for (let a1 = 2; a1 <= 5; a1 += 1) for (let x = 1; x <= 12; x += 1) for (let y = 1; y <= 12; y += 1) push(a1, 1, 1, -1, x, y);
    else for (let a1 = 2; a1 <= 5; a1 += 1) for (let b1 = 2; b1 <= 5; b1 += 1) for (let a2 = 2; a2 <= 5; a2 += 1) for (let b2 = 2; b2 <= 5; b2 += 1) for (let x = 1; x <= 9; x += 1) for (let y = 1; y <= 9; y += 1) if (gcd(a1, b1) === 1 && gcd(a2, b2) === 1) push(a1, b1, a2, -b2, x, y);
    return withoutCollisions(this, out);
  },
  bandIssues: systemBand,
  present: (p) => `Si ${line(p.a1, p.b1, p.c1)} y ${line(p.a2, p.b2, p.c2)}, ¿cuál es el valor de x?`,
  answer: (p) => String(p.x),
  // with the key for x, the first equation gives y, and that pair must satisfy the second equation
  keyHolds: (p, key) => key.d === 1 && key.n > 0 && (p.c1 - p.a1 * key.n) % p.b1 === 0 && p.a2 * key.n + p.b2 * ((p.c1 - p.a1 * key.n) / p.b1) === p.c2,
  misconceptionAnswers: (p) => [{ id: 'gives-the-other-unknown', value: rational(p.y) }, { id: 'adds-the-equations-and-stops', value: orNull(p.c1 + p.c2) }],
  recognitionKey: (p) => `${p.a1}|${p.b1}|${p.a2}|${p.b2}|${p.x}|${p.y}`,
};

// ------------------------------------------------------------------------------------- rectangle measures
export interface RectangleParameters extends Record<string, number | string> { w: number; h: number; area: number; perimeter: number; task: 'AREA_FROM_SIDES' | 'AREA_FROM_PERIMETER' | 'PERIMETER_FROM_AREA' }
const rectangleBand = (band: PlanningBand, p: RectangleParameters): string[] => {
  const issues: string[] = []; const n = need(issues);
  n((band === 'FOUNDATIONAL' ? 'AREA_FROM_SIDES' : band === 'STANDARD' ? 'AREA_FROM_PERIMETER' : 'PERIMETER_FROM_AREA') === p.task, 'TASK_IS_NOT_THE_BANDS');
  n(p.w >= 2 && p.w < p.h && p.h <= 20 && p.area === p.w * p.h && p.perimeter === 2 * (p.w + p.h), 'NOT_A_RECTANGLE_OF_THE_ENVELOPE');
  return issues;
};
export const RECTANGLE: ParametricConstruct<RectangleParameters> = {
  construct: 'RECTANGLE_AREA_AND_PERIMETER', rendererVersion: 'parametric.rectangle-measures@1.0.0', languages: ['es'],
  enumerate(band) {
    const out: RectangleParameters[] = [];
    const task = band === 'FOUNDATIONAL' ? 'AREA_FROM_SIDES' : band === 'STANDARD' ? 'AREA_FROM_PERIMETER' : 'PERIMETER_FROM_AREA';
    for (let w = 2; w <= 12; w += 1) for (let h = w + 1; h <= 20; h += 1) { const p: RectangleParameters = { w, h, area: w * h, perimeter: 2 * (w + h), task }; if (rectangleBand(band, p).length === 0) out.push(p); }
    return withoutCollisions(this, out);
  },
  bandIssues: rectangleBand,
  present: (p) => p.task === 'AREA_FROM_SIDES' ? `Un rectángulo mide ${p.w} cm de ancho y ${p.h} cm de largo. ¿Cuántos centímetros cuadrados mide su área?`
    : p.task === 'AREA_FROM_PERIMETER' ? `El perímetro de un rectángulo es ${p.perimeter} cm y su ancho mide ${p.w} cm. ¿Cuántos centímetros cuadrados mide su área?`
    : `El área de un rectángulo es ${p.area} cm² y su ancho mide ${p.w} cm. ¿Cuántos centímetros mide su perímetro?`,
  answer: (p) => String(p.task === 'PERIMETER_FROM_AREA' ? p.perimeter : p.area),
  // from the shown measures only: the other side is recovered from the perimeter or from the area, then the asked measure is rebuilt
  keyHolds: (p, key) => key.d === 1 && key.n > 0 && (p.task === 'AREA_FROM_SIDES' ? key.n === p.w * p.h : p.task === 'AREA_FROM_PERIMETER' ? p.perimeter % 2 === 0 && key.n === p.w * (p.perimeter / 2 - p.w) : p.area % p.w === 0 && key.n === 2 * (p.w + p.area / p.w)),
  misconceptionAnswers: (p) => p.task === 'AREA_FROM_SIDES' ? [{ id: 'perimeter-for-area', value: rational(p.perimeter) }, { id: 'adds-the-sides', value: rational(p.w + p.h) }]
    : p.task === 'AREA_FROM_PERIMETER' ? [{ id: 'does-not-halve-the-perimeter', value: rational(p.w * (p.perimeter - p.w)) }, { id: 'multiplies-perimeter-by-width', value: rational(p.perimeter * p.w) }]
    : [{ id: 'gives-the-other-side', value: rational(p.h) }, { id: 'gives-half-the-perimeter', value: rational(p.w + p.h) }],
  recognitionKey: (p) => `${p.task}|${p.w}|${p.h}`,
};
