/**
 * Saber 11.° Matemáticas -- nine StudyUs-original PARAMETRIC_DETERMINISTIC constructs, one per cell competency x
 * official content category (pure data + pure functions, no IO, no provider). Spanish (es-CO). Rendered as
 * SELECTED_RESPONSE: the key and three distractors, each the value a MODELLED misconception gives (parametric.ts).
 *
 *                       Estadística                      Álgebra y cálculo               Geometría
 *   Interpretación      SABER_TABLE_DIFFERENCE           SABER_RATE_FROM_TABLE           SABER_SCALE_PLAN_AREA
 *   Formulación         SABER_MEAN_OF_DATA               SABER_PLAN_EQUATION             SABER_LADDER_HEIGHT
 *   Argumentación       SABER_CHECK_THE_MEAN             SABER_CHECK_THE_SYSTEM          SABER_SCALED_AREA_CLAIM
 *
 * Every key is a positive integer recomputed by `keyHolds` by another route. Nothing claims to be an ICFES item.
 */
import { rational, sameRational, type ParametricConstruct, type PlanningBand, type Rational } from './parametric';

const R = (n: number, d = 1): Rational => rational(n, d);
const need = (issues: string[]) => (ok: boolean, miss: string) => { if (!ok) issues.push(miss); };
/** Positive integer key, at least three DISTINCT positive misconception values, none equal to the key. */
const clean = <P extends Record<string, number | string>>(c: Pick<ParametricConstruct<P>, 'answer' | 'misconceptionAnswers'>, sets: P[]): P[] =>
  sets.filter((p) => {
    const k = R(Number(c.answer(p)));
    if (k.n <= 0) return false;
    const vals = c.misconceptionAnswers(p).map((m) => m.value).filter((v): v is Rational => v !== null && v.n > 0);
    if (vals.some((v) => sameRational(v, k))) return false;
    return new Set(vals.map((v) => `${v.n}/${v.d}`)).size >= 3;
  });
const thin = <T>(xs: T[], step: number): T[] => xs.filter((_, i) => i % step === 0);

// ====================================================================== Interpretación · Estadística
/** A frequency table of four categories; how many MORE chose A than B. */
export interface TableDiffParameters extends Record<string, number | string> { a: number; b: number; c: number; d: number; ask: 'A_MINUS_B' | 'A_MINUS_C_PLUS_D' }
const tdKey = (x: TableDiffParameters) => (x.ask === 'A_MINUS_B' ? x.a - x.b : x.a - (x.c + x.d));
const tdBand = (band: PlanningBand, x: TableDiffParameters): string[] => {
  const i: string[] = []; const n = need(i);
  n(tdKey(x) > 0, 'NOT_POSITIVE');
  n(band === 'CHALLENGE' ? x.ask === 'A_MINUS_C_PLUS_D' : x.ask === 'A_MINUS_B', 'ASK_IS_NOT_THE_BANDS');
  const fives = x.a % 5 === 0 && x.b % 5 === 0;
  n(band === 'FOUNDATIONAL' ? fives : band === 'STANDARD' ? !fives : true, 'FIVES_ARE_NOT_THE_BANDS');
  return i;
};
export const SABER_TABLE_DIFFERENCE: ParametricConstruct<TableDiffParameters> = {
  construct: 'SABER_TABLE_DIFFERENCE', rendererVersion: 'tb.saber.table-difference@0.1.0', languages: ['es'],
  enumerate(band) {
    const out: TableDiffParameters[] = [];
    for (const a of [35, 42, 48, 55, 60, 64, 72]) for (const b of [12, 15, 20, 25, 28, 33]) for (const c of [8, 11, 14, 18]) for (const d of [6, 9, 13, 17]) for (const ask of ['A_MINUS_B', 'A_MINUS_C_PLUS_D'] as const) {
      const x: TableDiffParameters = { a, b, c, d, ask }; if (tdBand(band, x).length === 0) out.push(x);
    }
    return thin(clean(this, out), 3);
  },
  bandIssues: tdBand,
  present: (x) => `En una encuesta, los estudiantes de un colegio eligieron su deporte favorito: fútbol ${x.a}, baloncesto ${x.b}, voleibol ${x.c} y natación ${x.d}. ${x.ask === 'A_MINUS_B' ? '¿Cuántos estudiantes más eligieron fútbol que baloncesto?' : '¿Cuántos estudiantes más eligieron fútbol que voleibol y natación juntos?'}`,
  answer: (x) => String(tdKey(x)),
  keyHolds: (x, key) => key.d === 1 && key.n + (x.ask === 'A_MINUS_B' ? x.b : x.c + x.d) === x.a,
  misconceptionAnswers: (x) => [
    { id: 'adds-instead-of-subtracting', value: R(x.ask === 'A_MINUS_B' ? x.a + x.b : x.a + x.c + x.d) },
    { id: 'gives-the-largest-frequency', value: R(x.a) },
    { id: 'gives-the-total-surveyed', value: R(x.a + x.b + x.c + x.d) },
    { id: 'compares-with-one-category-only', value: x.ask === 'A_MINUS_C_PLUS_D' ? R(x.a - x.c) : R(x.a - x.c) },
  ],
  recognitionKey: (x) => `${x.ask}|${x.a}|${x.b}|${x.c}|${x.d}`,
};

// ====================================================================== Formulación · Estadística
/** n data values (4 or 5); the mean is an integer. */
export interface MeanParameters extends Record<string, number | string> { v1: number; v2: number; v3: number; v4: number; v5: number }
const vals = (x: MeanParameters) => [x.v1, x.v2, x.v3, x.v4, x.v5].filter((v) => v > 0);
const meanOf = (x: MeanParameters) => vals(x).reduce((s, v) => s + v, 0) / vals(x).length;
const medianOf = (x: MeanParameters) => { const s = [...vals(x)].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const meanBand = (band: PlanningBand, x: MeanParameters): string[] => {
  const i: string[] = []; const n = need(i);
  n(Number.isInteger(meanOf(x)), 'MEAN_NOT_INTEGER');
  n(band === 'FOUNDATIONAL' ? x.v5 === 0 && meanOf(x) % 5 === 0 : band === 'STANDARD' ? x.v5 === 0 && meanOf(x) % 5 !== 0 : x.v5 > 0, 'LEVERS_ARE_NOT_THE_BANDS');
  n(Number.isInteger(medianOf(x)) && medianOf(x) !== meanOf(x), 'MEDIAN_NOT_A_DISTINCT_INTEGER');
  return i;
};
export const SABER_MEAN_OF_DATA: ParametricConstruct<MeanParameters> = {
  construct: 'SABER_MEAN_OF_DATA', rendererVersion: 'tb.saber.mean-of-data@0.1.0', languages: ['es'],
  enumerate(band) {
    const out: MeanParameters[] = [];
    for (const v1 of [10, 12, 14, 15, 16, 18, 20]) for (const v2 of [21, 22, 24, 25, 27]) for (const v3 of [28, 30, 31, 33, 34]) for (const v4 of [35, 36, 38, 40, 44, 45, 48]) for (const v5 of [0, 23, 41, 50]) {
      const x: MeanParameters = { v1, v2, v3, v4, v5 }; if (meanBand(band, x).length === 0) out.push(x);
    }
    return clean(this, out);
  },
  bandIssues: meanBand,
  present: (x) => `Una tienda registró las ventas diarias de un producto (en unidades): ${vals(x).join(', ')}. ¿Cuál es el promedio (media aritmética) de las ventas diarias?`,
  answer: (x) => String(meanOf(x)),
  keyHolds: (x, key) => key.d === 1 && key.n * vals(x).length === vals(x).reduce((s, v) => s + v, 0),
  misconceptionAnswers: (x) => { const sum = vals(x).reduce((s, v) => s + v, 0); return [
    { id: 'gives-the-median', value: R(medianOf(x)) },
    { id: 'divides-by-one-less', value: Number.isInteger(sum / (vals(x).length - 1)) ? R(sum / (vals(x).length - 1)) : null },
    { id: 'gives-the-sum', value: R(sum) },
    { id: 'averages-the-extremes', value: Number.isInteger((Math.min(...vals(x)) + Math.max(...vals(x))) / 2) ? R((Math.min(...vals(x)) + Math.max(...vals(x))) / 2) : null },
    { id: 'gives-the-range', value: R(Math.max(...vals(x)) - Math.min(...vals(x))) },
  ]; },
  recognitionKey: (x) => `${x.v1}|${x.v2}|${x.v3}|${x.v4}|${x.v5}`,
};

// ====================================================================== Argumentación · Estadística
/** A student averaged n values but divided by n - 1. Which is the correct mean? */
export interface CheckMeanParameters extends Record<string, number | string> { v1: number; v2: number; v3: number; v4: number }
const cmSum = (x: CheckMeanParameters) => x.v1 + x.v2 + x.v3 + x.v4;
const cmBand = (band: PlanningBand, x: CheckMeanParameters): string[] => {
  const i: string[] = []; const n = need(i);
  n(cmSum(x) % 4 === 0 && cmSum(x) % 3 === 0, 'BOTH_QUOTIENTS_NOT_INTEGERS');
  n(band === 'FOUNDATIONAL' ? cmSum(x) <= 120 : band === 'STANDARD' ? cmSum(x) > 120 && cmSum(x) <= 180 : cmSum(x) > 180, 'LEVERS_ARE_NOT_THE_BANDS');
  return i;
};
export const SABER_CHECK_THE_MEAN: ParametricConstruct<CheckMeanParameters> = {
  construct: 'SABER_CHECK_THE_MEAN', rendererVersion: 'tb.saber.check-the-mean@0.1.0', languages: ['es'],
  enumerate(band) {
    const out: CheckMeanParameters[] = [];
    for (let v1 = 10; v1 <= 70; v1 += 6) for (let v2 = 14; v2 <= 66; v2 += 8) for (const v3 of [21, 33, 45, 57]) for (const v4 of [9, 27, 39, 51]) {
      const x: CheckMeanParameters = { v1, v2, v3, v4 }; if (cmBand(band, x).length === 0) out.push(x);
    }
    return thin(clean(this, out), 2);
  },
  bandIssues: cmBand,
  present: (x) => `Para hallar el promedio de los puntajes ${x.v1}, ${x.v2}, ${x.v3} y ${x.v4}, Camilo sumó los cuatro valores y dividió el resultado entre 3, y afirma que el promedio es ${cmSum(x) / 3}. Su procedimiento no es correcto. ¿Cuál es el promedio correcto?`,
  answer: (x) => String(cmSum(x) / 4),
  keyHolds: (x, key) => key.d === 1 && 4 * key.n === x.v1 + x.v2 + x.v3 + x.v4,
  misconceptionAnswers: (x) => [
    { id: 'accepts-the-flawed-procedure', value: R(cmSum(x) / 3) },
    { id: 'gives-the-sum', value: R(cmSum(x)) },
    { id: 'averages-the-extremes', value: Number.isInteger((Math.min(x.v1, x.v2, x.v3, x.v4) + Math.max(x.v1, x.v2, x.v3, x.v4)) / 2) ? R((Math.min(x.v1, x.v2, x.v3, x.v4) + Math.max(x.v1, x.v2, x.v3, x.v4)) / 2) : null },
    { id: 'divides-by-five', value: cmSum(x) % 5 === 0 ? R(cmSum(x) / 5) : null },
    { id: 'gives-the-range', value: R(Math.max(x.v1, x.v2, x.v3, x.v4) - Math.min(x.v1, x.v2, x.v3, x.v4)) },
  ],
  recognitionKey: (x) => `${x.v1}|${x.v2}|${x.v3}|${x.v4}`,
};

// ====================================================================== Interpretación · Álgebra y cálculo
/** A table of a linear relation (hours -> cost); the learner gives the increase per hour (the slope). */
export interface RateParameters extends Record<string, number | string> { b: number; m: number; x0: number; step: number }
const rateBand = (band: PlanningBand, x: RateParameters): string[] => {
  const i: string[] = []; const n = need(i);
  n(band === 'FOUNDATIONAL' ? x.step === 1 && x.x0 === 1 : band === 'STANDARD' ? x.step === 2 : x.step === 3 && x.x0 > 1, 'LEVERS_ARE_NOT_THE_BANDS');
  n(x.b !== x.m && x.b > 0, 'DEGENERATE');
  return i;
};
const rateRows = (x: RateParameters) => [0, 1, 2].map((k) => x.x0 + k * x.step).map((h) => [h, x.b + x.m * h]);
export const SABER_RATE_FROM_TABLE: ParametricConstruct<RateParameters> = {
  construct: 'SABER_RATE_FROM_TABLE', rendererVersion: 'tb.saber.rate-from-table@0.1.0', languages: ['es'],
  enumerate(band) {
    const out: RateParameters[] = [];
    for (const b of [5, 8, 10, 12, 15, 20]) for (const m of [3, 4, 6, 7, 9, 11, 14]) for (const x0 of [1, 2, 3]) for (const step of [1, 2, 3]) {
      const x: RateParameters = { b, m, x0, step }; if (rateBand(band, x).length === 0) out.push(x);
    }
    return clean(this, out);
  },
  bandIssues: rateBand,
  present: (x) => `El costo de alquilar una bicicleta depende de las horas de uso, según la tabla: ${rateRows(x).map(([h, c]) => `${h} h → ${c} mil pesos`).join('; ')}. Si la relación es lineal, ¿cuántos miles de pesos aumenta el costo por cada hora adicional?`,
  answer: (x) => String(x.m),
  // from two rows of the shown table: (difference of costs) / (difference of hours)
  keyHolds: (x, key) => { const [[h1, c1], , [h3, c3]] = rateRows(x); return key.d === 1 && key.n * (h3 - h1) === c3 - c1; },
  misconceptionAnswers: (x) => { const [[h1, c1], [, c2]] = rateRows(x); return [
    { id: 'reads-the-cost-difference-between-rows', value: x.step !== 1 ? R(c2 - c1) : null },
    { id: 'divides-cost-by-hours', value: Number.isInteger(c1 / h1) ? R(c1 / h1) : null },
    { id: 'gives-the-fixed-charge', value: R(x.b) },
    { id: 'gives-the-first-cost', value: R(c1) },
    { id: 'reads-the-last-cost', value: R(rateRows(x)[2][1]) },
  ]; },
  recognitionKey: (x) => `${x.b}|${x.m}|${x.x0}|${x.step}`,
};

// ====================================================================== Formulación · Álgebra y cálculo
/** A phone plan: fixed f + p per GB; the bill was T. How many GB? */
export interface PlanParameters extends Record<string, number | string> { f: number; p: number; g: number }
const planBand = (band: PlanningBand, x: PlanParameters): string[] => {
  const i: string[] = []; const n = need(i);
  n(band === 'FOUNDATIONAL' ? x.p <= 5 && x.f % 10 === 0 : band === 'STANDARD' ? x.p > 5 && x.f % 10 === 0 : x.f % 10 !== 0, 'LEVERS_ARE_NOT_THE_BANDS');
  return i;
};
export const SABER_PLAN_EQUATION: ParametricConstruct<PlanParameters> = {
  construct: 'SABER_PLAN_EQUATION', rendererVersion: 'tb.saber.plan-equation@0.1.0', languages: ['es'],
  enumerate(band) {
    const out: PlanParameters[] = [];
    for (const f of [20, 25, 30, 35, 40, 45, 50]) for (const p of [3, 4, 5, 6, 7, 8, 9]) for (const g of [3, 4, 6, 7, 8, 9, 11, 12]) { const x: PlanParameters = { f, p, g }; if (planBand(band, x).length === 0) out.push(x); }
    return clean(this, out);
  },
  bandIssues: planBand,
  present: (x) => `Un plan de datos móviles cobra un cargo fijo de ${x.f} mil pesos al mes más ${x.p} mil pesos por cada gigabyte consumido. Si la factura de un mes fue de ${x.f + x.p * x.g} mil pesos, ¿cuántos gigabytes se consumieron?`,
  answer: (x) => String(x.g),
  keyHolds: (x, key) => key.d === 1 && x.f + x.p * key.n === x.f + x.p * x.g && key.n > 0,
  misconceptionAnswers: (x) => { const T = x.f + x.p * x.g; return [
    { id: 'divides-the-bill-by-the-price', value: Number.isInteger(T / x.p) ? R(T / x.p) : null },
    { id: 'adds-the-fixed-charge', value: Number.isInteger((T + x.f) / x.p) ? R((T + x.f) / x.p) : null },
    { id: 'subtracts-the-price-from-the-bill', value: R(T - x.p) },
    { id: 'gives-the-variable-part', value: R(x.p * x.g) },
  ]; },
  recognitionKey: (x) => `${x.f}|${x.p}|${x.g}`,
};

// ====================================================================== Argumentación · Álgebra y cálculo
/** x + y = s, x − y = d. A student added the equations but forgot to halve: x = s + d. Which is the correct x? */
export interface SystemParameters extends Record<string, number | string> { x: number; y: number; k: number }
const sysBand = (band: PlanningBand, p: SystemParameters): string[] => {
  const i: string[] = []; const n = need(i);
  n(p.x > p.y, 'X_NOT_GREATER');
  n(band === 'FOUNDATIONAL' ? p.k === 1 : band === 'STANDARD' ? p.k === 2 : p.k === 3, 'LEVERS_ARE_NOT_THE_BANDS');
  return i;
};
export const SABER_CHECK_THE_SYSTEM: ParametricConstruct<SystemParameters> = {
  construct: 'SABER_CHECK_THE_SYSTEM', rendererVersion: 'tb.saber.check-the-system@0.1.0', languages: ['es'],
  enumerate(band) {
    const out: SystemParameters[] = [];
    for (let x = 4; x <= 30; x++) for (let y = 1; y <= 20; y++) for (const k of [1, 2, 3]) { const p: SystemParameters = { x, y, k }; if (sysBand(band, p).length === 0) out.push(p); }
    return thin(clean(this, out), 3);
  },
  bandIssues: sysBand,
  // equations: k x + k y = k s and x − y = d
  present: (p) => `Para resolver el sistema ${p.k === 1 ? '' : p.k}x + ${p.k === 1 ? '' : p.k}y = ${p.k * (p.x + p.y)} y x − y = ${p.x - p.y}, Sofía ${p.k === 1 ? 'sumó las dos ecuaciones' : `dividió la primera ecuación entre ${p.k} y luego sumó las dos ecuaciones`} y afirma que x = ${p.x + p.y + (p.x - p.y)}. Su conclusión no es correcta. ¿Cuál es el valor correcto de x?`,
  answer: (p) => String(p.x),
  keyHolds: (p, key) => { if (key.d !== 1) return false; const s = p.x + p.y; const d = p.x - p.y; const y = key.n - d; return p.k * key.n + p.k * y === p.k * s; },
  misconceptionAnswers: (p) => [
    { id: 'accepts-the-flawed-conclusion', value: R(2 * p.x) },
    { id: 'gives-the-value-of-y', value: R(p.y) },
    { id: 'gives-the-sum-of-the-unknowns', value: R(p.x + p.y) },
    { id: 'subtracts-the-equations', value: R(p.x - p.y) },
  ],
  recognitionKey: (p) => `${p.x}|${p.y}|${p.k}`,
};

// ====================================================================== Interpretación · Geometría
/** A plan at scale 1 : 100 (1 cm = 1 m): a room of a cm by b cm. Real area in m². */
export interface ScaleParameters extends Record<string, number | string> { a: number; b: number; scale: 100 | 200 }
const scaleArea = (x: ScaleParameters) => (x.a * x.scale / 100) * (x.b * x.scale / 100);
const scaleBand = (band: PlanningBand, x: ScaleParameters): string[] => {
  const i: string[] = []; const n = need(i);
  n(x.a > x.b, 'NOT_LONGER');
  n(band === 'CHALLENGE' ? x.scale === 200 : x.scale === 100, 'SCALE_IS_NOT_THE_BANDS');
  n(band !== 'FOUNDATIONAL' || x.a <= 8, 'FOUNDATIONAL_SMALL');
  n(band !== 'STANDARD' || x.a > 8, 'STANDARD_LARGER');
  return i;
};
export const SABER_SCALE_PLAN_AREA: ParametricConstruct<ScaleParameters> = {
  construct: 'SABER_SCALE_PLAN_AREA', rendererVersion: 'tb.saber.scale-plan-area@0.1.0', languages: ['es'],
  enumerate(band) {
    const out: ScaleParameters[] = [];
    for (let a = 4; a <= 15; a++) for (let b = 3; b <= 12; b++) for (const scale of [100, 200] as const) { const x: ScaleParameters = { a, b, scale }; if (scaleBand(band, x).length === 0) out.push(x); }
    return clean(this, out);
  },
  bandIssues: scaleBand,
  present: (x) => `En el plano de una casa, dibujado a escala 1 : ${x.scale}, una habitación rectangular mide ${x.a} cm de largo y ${x.b} cm de ancho. ¿Cuál es el área real de la habitación, en metros cuadrados?`,
  answer: (x) => String(scaleArea(x)),
  keyHolds: (x, key) => key.d === 1 && key.n === (x.a * x.scale / 100) * (x.b * x.scale / 100),
  misconceptionAnswers: (x) => [
    { id: 'scales-the-area-linearly', value: x.scale === 200 ? R(x.a * x.b * 2) : null },
    { id: 'squares-the-longer-side', value: R((x.a * x.scale / 100) ** 2) },
    { id: 'gives-the-perimeter', value: R(2 * (x.a + x.b) * x.scale / 100) },
    { id: 'gives-the-plan-area', value: x.scale === 200 ? R(x.a * x.b) : null },
    { id: 'adds-the-sides', value: R((x.a + x.b) * x.scale / 100) },
  ],
  recognitionKey: (x) => `${x.a}|${x.b}|${x.scale}`,
};

// ====================================================================== Formulación · Geometría
/** A ladder of length c leans on a wall with its foot a from the wall; how high does it reach? (Pythagorean triple) */
export interface LadderParameters extends Record<string, number | string> { a: number; h: number; k: number }
const TRIPLES: [number, number, number][] = [[3, 4, 5], [6, 8, 10], [5, 12, 13], [8, 15, 17], [9, 12, 15], [7, 24, 25], [12, 16, 20], [20, 21, 29], [15, 20, 25], [10, 24, 26], [18, 24, 30], [16, 30, 34], [21, 28, 35], [12, 35, 37], [15, 36, 39], [24, 32, 40], [9, 40, 41], [27, 36, 45]];
const ladderBand = (band: PlanningBand, x: LadderParameters): string[] => {
  const i: string[] = []; const n = need(i);
  n(band === 'FOUNDATIONAL' ? x.k === 1 && x.a < x.h : band === 'STANDARD' ? x.k === 1 && x.a > x.h : x.k === 2, 'LEVERS_ARE_NOT_THE_BANDS');
  return i;
};
export const SABER_LADDER_HEIGHT: ParametricConstruct<LadderParameters> = {
  construct: 'SABER_LADDER_HEIGHT', rendererVersion: 'tb.saber.ladder-height@0.1.0', languages: ['es'],
  enumerate(band) {
    const out: LadderParameters[] = [];
    for (const [p, q] of TRIPLES) for (const [a, h] of [[p, q], [q, p]]) for (const k of [1, 2]) { const x: LadderParameters = { a: a * k, h: h * k, k }; if (ladderBand(band, x).length === 0) out.push(x); }
    return clean(this, out);
  },
  bandIssues: ladderBand,
  present: (x) => `Una escalera de ${Math.round(Math.sqrt(x.a * x.a + x.h * x.h))} m de largo está apoyada en una pared vertical. Su base está a ${x.a} m de la pared. ¿A qué altura, en metros, llega la escalera sobre la pared?`,
  answer: (x) => String(x.h),
  keyHolds: (x, key) => { const c = Math.round(Math.sqrt(x.a * x.a + x.h * x.h)); return key.d === 1 && key.n * key.n + x.a * x.a === c * c; },
  misconceptionAnswers: (x) => { const c = Math.round(Math.sqrt(x.a * x.a + x.h * x.h)); return [
    { id: 'subtracts-the-lengths', value: R(c - x.a) },
    { id: 'adds-the-squares', value: Number.isInteger(Math.sqrt(c * c + x.a * x.a)) ? R(Math.sqrt(c * c + x.a * x.a)) : null },
    { id: 'forgets-the-square-root', value: R(c * c - x.a * x.a) },
    { id: 'gives-the-ladder-length', value: R(c) },
    { id: 'gives-the-foot-distance', value: R(x.a) },
  ]; },
  recognitionKey: (x) => `${x.a}|${x.h}|${x.k}`,
};

// ====================================================================== Argumentación · Geometría
/** A rectangle a x b; each side multiplied by k. A student claims the area is multiplied by k. The correct new area? */
export interface ScaledAreaParameters extends Record<string, number | string> { a: number; b: number; k: number }
const saBand = (band: PlanningBand, x: ScaledAreaParameters): string[] => {
  const i: string[] = []; const n = need(i);
  n(x.a > x.b, 'NOT_LONGER');
  n(band === 'FOUNDATIONAL' ? x.k === 2 : band === 'STANDARD' ? x.k === 3 : x.k === 4, 'LEVERS_ARE_NOT_THE_BANDS');
  return i;
};
export const SABER_SCALED_AREA_CLAIM: ParametricConstruct<ScaledAreaParameters> = {
  construct: 'SABER_SCALED_AREA_CLAIM', rendererVersion: 'tb.saber.scaled-area-claim@0.1.0', languages: ['es'],
  enumerate(band) {
    const out: ScaledAreaParameters[] = [];
    for (let a = 3; a <= 14; a++) for (let b = 2; b <= 11; b++) for (const k of [2, 3, 4]) { const x: ScaledAreaParameters = { a, b, k }; if (saBand(band, x).length === 0) out.push(x); }
    return clean(this, out);
  },
  bandIssues: saBand,
  present: (x) => `Un rectángulo mide ${x.a} cm por ${x.b} cm. Si se multiplica cada uno de sus lados por ${x.k}, Valentina afirma que el área del nuevo rectángulo es ${x.k * x.a * x.b} cm². Su afirmación no es correcta. ¿Cuál es el área del nuevo rectángulo, en cm²?`,
  answer: (x) => String(x.k * x.k * x.a * x.b),
  keyHolds: (x, key) => key.d === 1 && key.n === (x.k * x.a) * (x.k * x.b),
  misconceptionAnswers: (x) => [
    { id: 'accepts-the-linear-claim', value: R(x.k * x.a * x.b) },
    { id: 'adds-the-factor-to-each-side', value: R((x.a + x.k) * (x.b + x.k)) },
    { id: 'gives-the-new-perimeter', value: R(2 * x.k * (x.a + x.b)) },
    { id: 'cubes-the-factor', value: R(x.k ** 3 * x.a * x.b) },
  ],
  recognitionKey: (x) => `${x.a}|${x.b}|${x.k}`,
};

export const SABER_MATH_CONSTRUCTS = [SABER_TABLE_DIFFERENCE, SABER_MEAN_OF_DATA, SABER_CHECK_THE_MEAN, SABER_RATE_FROM_TABLE, SABER_PLAN_EQUATION, SABER_CHECK_THE_SYSTEM, SABER_SCALE_PLAN_AREA, SABER_LADDER_HEIGHT, SABER_SCALED_AREA_CLAIM] as const;
