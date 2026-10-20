/**
 * QF V5.2 -- the parametric constructs of the library, each stated as bounded data (pure, no IO).
 *
 * Six constructs. Two are the Step 4B ones, described here so that their envelopes can be swept and counted; their
 * renderers are the existing strategies, untouched. Four are new and are rendered by `parametricStrategy`:
 *   LINE_THROUGH_TWO_POINTS             algebra      (draft family tf.math.linear.line-through-two-points)
 *   CLASSICAL_PROBABILITY_SINGLE_DRAW   probability  (draft family tf.math.probability.single-event-equally-likely)
 *   RIGHT_TRIANGLE_MISSING_SIDE         geometry     (new core, concept math.geo.pythagorean-theorem)
 *   ARITHMETIC_MEAN_OF_A_DATA_SET       data         (new core, concept math.stat.central-tendency)
 * Every key asked of a learner is positive: PAA's produced response is a positive integer, fraction or decimal.
 */
import { PROPORTION_BAND_LIMITS, PROPORTION_MISSING_VALUE_CONSTRUCT, PROPORTION_MISSING_VALUE_RENDERER_VERSION, PROPORTION_SITUATIONS, SITUATION_FACTOR, presentProportion, proportionBandIssues, proportionMisconceptionAnswers, proportionParameterIssues, type ProportionParameters } from '../strategy-proportion-missing-value';
import { presentEquation, quadraticBandIssues, type QuadraticParameters } from '../strategy-quadratic-factorising';
import { QUADRATIC_SOLVE_CONSTRUCT, QUADRATIC_SOLVE_RENDERER_VERSION } from '../strategy-quadratic-solve';
import { rational, sameRational, writeRational, type ParametricConstruct, type PlanningBand, type Rational } from './parametric';

const gcd = (a: number, b: number): number => (b === 0 ? Math.abs(a) : gcd(b, a % b));
const fromNumber = (x: number): Rational => rational(Math.round(x * 100), 100);
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

// ----------------------------------------------------------------------------------- quadratics (Step 4B, swept)
const QUADRATIC_RANGES = [{ symbol: 'a', min: 1, max: 6, step: 1 }, { symbol: 'r1', min: -12, max: 12, step: 0.5 }, { symbol: 'r2', min: -12, max: 12, step: 0.5 }];
type Q = QuadraticParameters & Record<string, number | string>;
const quad = (a: number, r1: number, r2: number, presentation: QuadraticParameters['presentation']): Q => ({ a, r1, r2, b: -a * (r1 + r2), c: a * r1 * r2, presentation });
export const QUADRATIC_SOLVE: ParametricConstruct<Q> = {
  construct: QUADRATIC_SOLVE_CONSTRUCT, rendererVersion: QUADRATIC_SOLVE_RENDERER_VERSION, languages: ['es', 'en'],
  enumerate(band) {
    const out: Q[] = [];
    // the draw of the strategy, written out: unordered root pairs, so that one equation is one parameter set
    if (band === 'FOUNDATIONAL') for (let i = 1; i <= 9; i += 1) for (let j = i + 1; j <= 9; j += 1) out.push(quad(1, j, i, 'STANDARD_FORM'));
    else if (band === 'STANDARD') { for (let i = 1; i <= 9; i += 1) for (let j = 1; j <= 9; j += 1) if (i !== j) out.push(quad(1, i, -j, 'TERMS_ON_BOTH_SIDES')); }
    else for (let i = 1; i <= 8; i += 1) for (let j = 1; j <= 9; j += 1) { const p = quad(2, i + 0.5, -j, 'PRODUCT_TO_EXPAND'); if (p.b !== 0) out.push(p); }
    return out.filter((p) => Number.isInteger(p.b) && Number.isInteger(p.c) && p.b !== 0 && p.c !== 0 && QUADRATIC_RANGES.every((r) => Number(p[r.symbol]) >= r.min && Number(p[r.symbol]) <= r.max));
  },
  bandIssues: (band, p) => quadraticBandIssues(band, p),
  present: (p) => presentEquation(p),
  answer: (p) => writeRational(fromNumber(Math.max(p.r1, p.r2))),
  // substitute the key into the equation the learner is shown, and require it to be the greater of the two roots
  keyHolds: (p, key) => p.a * key.n * key.n + p.b * key.n * key.d + p.c * key.d * key.d === 0 && 2 * p.a * key.n >= -p.b * key.d,
  // every keyed root is substituted into the shown equation, and together they are its two roots (their sum is -b / a)
  everyKeyHolds: (p, keys) => keys.length === 2 && keys.every((k) => p.a * k.n * k.n + p.b * k.n * k.d + p.c * k.d * k.d === 0) && !sameRational(keys[0], keys[1]),
  misconceptionAnswers: (p) => [{ id: 'sign-of-roots', value: fromNumber(-Math.min(p.r1, p.r2)) }, { id: 'lost-root', value: fromNumber(Math.min(p.r1, p.r2)) }],
  recognitionKey: (p) => `${p.presentation}|${p.a}|${Math.min(p.r1, p.r2)}|${Math.max(p.r1, p.r2)}`,
};

// ----------------------------------------------------------------------------------- proportion (Step 4B, swept)
const PROPORTION_RANGES = [{ symbol: 'a', min: 2, max: 60, step: 1 }, { symbol: 'b', min: 2, max: 240, step: 1 }, { symbol: 'c', min: 3, max: 180, step: 1 }];
type Pr = ProportionParameters & Record<string, number | string>;
export const PROPORTION_MISSING_VALUE: ParametricConstruct<Pr> = {
  construct: PROPORTION_MISSING_VALUE_CONSTRUCT, rendererVersion: PROPORTION_MISSING_VALUE_RENDERER_VERSION, languages: ['es'],
  enumerate(band) {
    const out: Pr[] = [];
    const L = PROPORTION_BAND_LIMITS[band];
    for (const situation of PROPORTION_SITUATIONS) {
      const factor = SITUATION_FACTOR[situation];
      if ((band === 'FOUNDATIONAL') !== (factor === 1)) continue;
      const aMax = band === 'FOUNDATIONAL' ? PROPORTION_BAND_LIMITS.FOUNDATIONAL.aMax : 60;
      for (let a = 2; a <= aMax; a += 1) for (let b = 2; b <= L.bMax; b += 1) for (let stated = 1; stated * factor <= 180; stated += 1) {
        const c = stated * factor;
        if ((100 * b * c) % a !== 0) continue;
        const p: Pr = { a, b, c, x: (b * c) / a, situation, statedC: stated };
        if (proportionParameterIssues(p, PROPORTION_RANGES).length === 0 && proportionBandIssues(band, p).length === 0) out.push(p);
      }
    }
    return out;
  },
  bandIssues: (band, p) => proportionBandIssues(band, p),
  present: (p, language) => presentProportion(p, language),
  answer: (p) => writeRational(fromNumber(p.x)),
  // cross-multiplication on the shown numbers: a x = b c, with c the stated value converted
  keyHolds: (p, key) => p.a * key.n === p.b * p.statedC * SITUATION_FACTOR[p.situation] * key.d,
  misconceptionAnswers: (p) => proportionMisconceptionAnswers(p).map((m) => ({ id: m.id, value: Number.isInteger(m.value * 100) ? fromNumber(m.value) : null })),
  // b only scales the answer: two instances that differ in b alone are the same question to a learner
  recognitionKey: (p) => `${p.situation}|${p.a}|${p.statedC}`,
};

// ------------------------------------------------------------------------------------------------- linear: slope
export interface SlopeParameters extends Record<string, number | string> { x1: number; y1: number; x2: number; y2: number; mNum: number; mDen: number }
const negatives = (p: SlopeParameters): number => [p.x1, p.y1, p.x2, p.y2].filter((v) => v < 0).length;
const slopeBand = (band: PlanningBand, p: SlopeParameters): string[] => {
  const issues: string[] = [];
  const need = (ok: boolean, miss: string) => { if (!ok) issues.push(miss); };
  const bothPointsNegative = (p.x1 < 0 || p.y1 < 0) && (p.x2 < 0 || p.y2 < 0);
  if (band === 'FOUNDATIONAL') { need(negatives(p) === 0 && Math.min(p.x1, p.y1, p.x2, p.y2) >= 1, 'COORDINATES_NOT_ALL_POSITIVE'); need(p.mDen === 1 && p.mNum >= 2 && p.mNum <= 5, 'SLOPE_NOT_A_SMALL_WHOLE_NUMBER'); }
  else if (band === 'STANDARD') { need(negatives(p) === 1, 'NOT_EXACTLY_ONE_NEGATIVE_COORDINATE'); need(p.mDen === 2, 'SLOPE_NOT_A_HALF_INTEGER'); }
  else { need(bothPointsNegative, 'NO_NEGATIVE_COORDINATE_IN_BOTH_POINTS'); need(p.mDen >= 3 && p.mDen <= 6, 'SLOPE_DENOMINATOR_NOT_3_TO_6'); }
  need(p.x2 > p.x1 && p.mNum > 0, 'SLOPE_NOT_POSITIVE_OR_POINTS_NOT_ORDERED');
  return issues;
};
export const LINE_SLOPE: ParametricConstruct<SlopeParameters> = {
  construct: 'LINE_THROUGH_TWO_POINTS', rendererVersion: 'parametric.line-slope@1.0.0', languages: ['es'],
  enumerate(band) {
    const out: SlopeParameters[] = [];
    for (let x1 = -10; x1 <= 10; x1 += 1) for (let x2 = x1 + 1; x2 <= Math.min(10, x1 + 12); x2 += 1) for (let y1 = -20; y1 <= 20; y1 += 1) for (let dy = 1; dy <= 20; dy += 1) {
      const y2 = y1 + dy;
      if (y2 > 20 || x1 === 0 || x2 === 0 || y1 === 0 || y2 === 0) continue;
      const g = gcd(dy, x2 - x1);
      const p: SlopeParameters = { x1, y1, x2, y2, mNum: dy / g, mDen: (x2 - x1) / g };
      // keeps the arithmetic in the head: differences of at most 12, as the family's valid-solution rule bounds the slope
      // a slope of 1 is also its own reciprocal: the inverted-slope misconception would be marked right
      if (dy <= 12 && p.mNum !== p.mDen && slopeBand(band, p).length === 0) out.push(p);
    }
    return out;
  },
  bandIssues: slopeBand,
  present: (p) => `¿Cuál es la pendiente de la recta que pasa por los puntos (${p.x1}, ${p.y1}) y (${p.x2}, ${p.y2})?`.replace(/-/g, '−'),
  answer: (p) => writeRational(rational(p.mNum, p.mDen)),
  // the key times the run gives the rise
  keyHolds: (p, key) => key.n * (p.x2 - p.x1) === (p.y2 - p.y1) * key.d,
  misconceptionAnswers: (p) => [{ id: 'run-over-rise', value: rational(p.x2 - p.x1, p.y2 - p.y1) }, { id: 'mixed-order', value: rational(p.y2 - p.y1, p.x1 - p.x2) }],
  // a translation of both points is the same question: the run and the rise are what the learner works with
  recognitionKey: (p) => `${p.x2 - p.x1}|${p.y2 - p.y1}|${negatives(p)}`,
};

// --------------------------------------------------------------------------------------- probability: single draw
export interface DrawParameters extends Record<string, number | string> { red: number; green: number; blue: number; n: number; k: number; event: 'RED' | 'RED_OR_GREEN' | 'NOT_RED' }
const drawBand = (band: PlanningBand, p: DrawParameters): string[] => {
  const issues: string[] = [];
  const need = (ok: boolean, miss: string) => { if (!ok) issues.push(miss); };
  if (band === 'FOUNDATIONAL') { need(p.event === 'RED', 'EVENT_IS_NOT_ONE_CATEGORY'); need(gcd(p.k, p.n) === 1, 'RATIO_NOT_IN_LOWEST_TERMS'); }
  else if (band === 'STANDARD') { need(p.event === 'RED_OR_GREEN', 'EVENT_IS_NOT_TWO_CATEGORIES'); need(gcd(p.k, p.n) > 1, 'RATIO_DOES_NOT_SIMPLIFY'); }
  else { need(p.event === 'NOT_RED', 'EVENT_IS_NOT_A_COMPLEMENT'); need(gcd(p.k, p.n) > 1, 'RATIO_DOES_NOT_SIMPLIFY'); }
  need(p.n === p.red + p.green + p.blue && p.n >= 4 && p.n <= 60 && p.k > 0 && p.k < p.n, 'COUNTS_INCONSISTENT');
  return issues;
};
const favourable = (p: Pick<DrawParameters, 'red' | 'green' | 'blue' | 'event'>): number => (p.event === 'RED' ? p.red : p.event === 'RED_OR_GREEN' ? p.red + p.green : p.green + p.blue);
const EVENT_ES: Record<DrawParameters['event'], string> = { RED: 'sea roja', RED_OR_GREEN: 'sea roja o verde', NOT_RED: 'no sea roja' };
export const SINGLE_DRAW: ParametricConstruct<DrawParameters> = {
  construct: 'CLASSICAL_PROBABILITY_SINGLE_DRAW', rendererVersion: 'parametric.single-draw-probability@1.0.0', languages: ['es'],
  enumerate(band) {
    const out: DrawParameters[] = [];
    const event: DrawParameters['event'] = band === 'FOUNDATIONAL' ? 'RED' : band === 'STANDARD' ? 'RED_OR_GREEN' : 'NOT_RED';
    for (let red = 2; red <= 15; red += 1) for (let green = 2; green <= 15; green += 1) for (let blue = 2; blue <= 15; blue += 1) {
      // three different counts: no two categories can be taken for one another
      if (red === green || green === blue || red === blue) continue;
      const n = red + green + blue;
      const k = favourable({ red, green, blue, event });
      const p: DrawParameters = { red, green, blue, n, k, event };
      const key = rational(k, n);
      // the key is never what a modelled misconception gives (odds, one over the categories, the complement)
      if (drawBand(band, p).length === 0 && !sameRational(key, rational(1, 3)) && 2 * k !== n && !sameRational(key, rational(k, n - k))) out.push(p);
    }
    return out;
  },
  bandIssues: drawBand,
  present: (p) => `Una bolsa contiene ${plural(p.red, 'canica roja', 'canicas rojas')}, ${plural(p.green, 'verde', 'verdes')} y ${plural(p.blue, 'azul', 'azules')}, todas del mismo tamaño. Se saca una canica al azar. ¿Cuál es la probabilidad de que ${EVENT_ES[p.event]}?`,
  answer: (p) => writeRational(rational(p.k, p.n)),
  // count the favourable marbles again from the three shown counts, by the event as worded
  keyHolds: (p, key) => { const total = p.red + p.green + p.blue; const fav = p.event === 'NOT_RED' ? total - p.red : p.event === 'RED' ? p.red : total - p.blue; return key.n * total === fav * key.d && key.n > 0 && key.n < key.d; },
  misconceptionAnswers: (p) => [{ id: 'odds', value: rational(p.k, p.n - p.k) }, { id: 'categories', value: rational(1, 3) }, { id: 'complement', value: rational(p.n - p.k, p.n) }],
  recognitionKey: (p) => `${p.event}|${p.k}|${p.n}`,
};

// ------------------------------------------------------------------------------- geometry: right-triangle side
export interface TriangleParameters extends Record<string, number | string> { legA: number; legB: number; hyp: number; asked: 'HYPOTENUSE' | 'LEG'; given: number; situation: 'ABSTRACT' | 'LADDER' }
const PRIMITIVE_TRIPLES: readonly (readonly [number, number, number])[] = [[3, 4, 5], [5, 12, 13], [8, 15, 17], [7, 24, 25], [20, 21, 29], [9, 40, 41], [12, 35, 37], [11, 60, 61], [28, 45, 53], [33, 56, 65]];
const triangleBand = (band: PlanningBand, p: TriangleParameters): string[] => {
  const issues: string[] = [];
  const need = (ok: boolean, miss: string) => { if (!ok) issues.push(miss); };
  if (band === 'FOUNDATIONAL') { need(p.asked === 'HYPOTENUSE' && p.situation === 'ABSTRACT', 'NOT_THE_HYPOTENUSE_FROM_TWO_LEGS'); need(p.hyp <= 30, 'SIDES_TOO_LARGE_FOR_THE_BAND'); }
  else if (band === 'STANDARD') { need(p.asked === 'LEG' && p.situation === 'ABSTRACT', 'NOT_A_LEG_FROM_THE_HYPOTENUSE'); need(p.hyp <= 41, 'SIDES_TOO_LARGE_FOR_THE_BAND'); }
  else { need(p.asked === 'LEG' && p.situation === 'LADDER', 'NOT_A_LEG_IN_A_SITUATION'); need(p.hyp >= 25 && p.hyp <= 100, 'SIDES_OUTSIDE_THE_BAND'); }
  need(p.legA * p.legA + p.legB * p.legB === p.hyp * p.hyp && p.legA < p.legB, 'NOT_A_RIGHT_TRIANGLE');
  return issues;
};
export const RIGHT_TRIANGLE: ParametricConstruct<TriangleParameters> = {
  construct: 'RIGHT_TRIANGLE_MISSING_SIDE', rendererVersion: 'parametric.right-triangle-side@1.0.0', languages: ['es'],
  enumerate(band) {
    const out: TriangleParameters[] = [];
    for (const [a, b, h] of PRIMITIVE_TRIPLES) for (let k = 1; k * h <= 100; k += 1) {
      const t = { legA: a * k, legB: b * k, hyp: h * k };
      const candidates: TriangleParameters[] = band === 'FOUNDATIONAL' ? [{ ...t, asked: 'HYPOTENUSE', given: t.legA, situation: 'ABSTRACT' }]
        : [{ ...t, asked: 'LEG', given: t.legA, situation: band === 'STANDARD' ? 'ABSTRACT' : 'LADDER' }, { ...t, asked: 'LEG', given: t.legB, situation: band === 'STANDARD' ? 'ABSTRACT' : 'LADDER' }];
      for (const p of candidates) if (triangleBand(band, p).length === 0) out.push(p);
    }
    return out;
  },
  bandIssues: triangleBand,
  present: (p) => p.asked === 'HYPOTENUSE' ? `Los catetos de un triángulo rectángulo miden ${p.legA} cm y ${p.legB} cm. ¿Cuántos centímetros mide la hipotenusa?`
    : p.situation === 'ABSTRACT' ? `En un triángulo rectángulo, la hipotenusa mide ${p.hyp} cm y uno de los catetos mide ${p.given} cm. ¿Cuántos centímetros mide el otro cateto?`
    : `Una escalera de ${p.hyp} dm de largo se apoya en una pared vertical. El pie de la escalera queda a ${p.given} dm de la pared, sobre un suelo horizontal. ¿A cuántos decímetros de altura toca la escalera la pared?`,
  answer: (p) => String(p.asked === 'HYPOTENUSE' ? p.hyp : p.given === p.legA ? p.legB : p.legA),
  // the squares of the three lengths the learner ends up with satisfy the theorem
  keyHolds: (p, key) => key.d === 1 && key.n > 0 && (p.asked === 'HYPOTENUSE' ? p.legA * p.legA + p.legB * p.legB === key.n * key.n : p.given * p.given + key.n * key.n === p.hyp * p.hyp),
  misconceptionAnswers: (p) => (p.asked === 'HYPOTENUSE' ? [{ id: 'adds-the-sides', value: rational(p.legA + p.legB) }, { id: 'forgets-the-root', value: rational(p.hyp * p.hyp) }] : [{ id: 'subtracts-the-sides', value: rational(p.hyp - p.given) }, { id: 'adds-instead-of-subtracting', value: null }]),
  recognitionKey: (p) => `${p.asked}|${p.situation}|${p.hyp}|${p.given}`,
};

// ---------------------------------------------------------------------------------- data: mean of a data set
export interface MeanParameters extends Record<string, number | string> { values: string; n: number; mean: number; task: 'MEAN' | 'MISSING_VALUE' | 'ADDED_VALUE'; hidden: number; newMean: number }
/** Zero-sum deviation patterns: a list is the mean plus one pattern, so its mean is exact by construction. */
const DEVIATIONS: readonly (readonly number[])[] = [[-3, -1, 1, 3], [-4, -1, 2, 3], [-5, 1, 1, 3], [-2, -2, 1, 3], [-4, -2, 0, 2, 4], [-5, -1, 0, 2, 4], [-3, -2, 0, 1, 4], [-6, -1, 1, 2, 4], [-4, -3, 1, 2, 4], [-5, -3, -1, 2, 3, 4]];
const listOf = (p: MeanParameters): number[] => p.values.split(',').map(Number);
const meanBand = (band: PlanningBand, p: MeanParameters): string[] => {
  const issues: string[] = [];
  const need = (ok: boolean, miss: string) => { if (!ok) issues.push(miss); };
  const values = listOf(p);
  need((band === 'FOUNDATIONAL' ? 'MEAN' : band === 'STANDARD' ? 'MISSING_VALUE' : 'ADDED_VALUE') === p.task, 'TASK_IS_NOT_THE_BANDS');
  need(p.n >= 4 && p.n <= 8 && p.mean >= 6 && p.mean <= 40, 'LIST_OUTSIDE_THE_ENVELOPE');
  if (p.task !== 'ADDED_VALUE') need(values.length === p.n && values.reduce((s, v) => s + v, 0) === p.mean * p.n && values.every((v) => v > 0), 'LIST_DOES_NOT_HAVE_ITS_MEAN');
  if (p.task === 'ADDED_VALUE') need(p.newMean !== p.mean && p.newMean * (p.n + 1) - p.mean * p.n > 0, 'ADDED_VALUE_NOT_POSITIVE');
  return issues;
};
const meanMisconceptions = (p: MeanParameters): { id: string; value: Rational | null }[] => {
  if (p.task === 'ADDED_VALUE') return [{ id: 'gives-the-new-mean', value: rational(p.newMean) }, { id: 'adds-the-change-to-the-mean', value: rational(p.newMean + (p.newMean - p.mean)) }];
  const values = [...listOf(p)].sort((x, y) => x - y);
  const median = values.length % 2 ? rational(values[(values.length - 1) / 2]) : rational(values[values.length / 2 - 1] + values[values.length / 2], 2);
  return p.task === 'MEAN' ? [{ id: 'median-for-mean', value: median }, { id: 'sum-not-divided', value: rational(p.mean * p.n) }] : [{ id: 'gives-the-mean', value: rational(p.mean) }];
};
const meanKey = (p: MeanParameters): number => (p.task === 'ADDED_VALUE' ? p.newMean * (p.n + 1) - p.mean * p.n : p.task === 'MEAN' ? p.mean : listOf(p)[p.hidden]);
/** A list whose median is its mean, or a hidden value equal to the mean, would mark a modelled misconception right. */
const meanCollides = (p: MeanParameters): boolean => meanMisconceptions(p).some((m) => m.value !== null && sameRational(m.value, rational(meanKey(p))));
export const DATA_SET_MEAN: ParametricConstruct<MeanParameters> = {
  construct: 'ARITHMETIC_MEAN_OF_A_DATA_SET', rendererVersion: 'parametric.data-set-mean@1.0.0', languages: ['es'],
  enumerate(band) {
    const out: MeanParameters[] = [];
    if (band === 'CHALLENGE') {
      for (let n = 4; n <= 8; n += 1) for (let mean = 6; mean <= 40; mean += 1) for (const delta of [-2, -1, 1, 2, 3]) {
        const p: MeanParameters = { values: '', n, mean, task: 'ADDED_VALUE', hidden: 0, newMean: mean + delta };
        if (meanBand(band, p).length === 0 && !meanCollides(p)) out.push(p);
      }
      return out;
    }
    for (const pattern of DEVIATIONS) for (let mean = 6; mean <= 40; mean += 1) {
      const values = pattern.map((d) => mean + d);
      if (values.some((v) => v <= 0)) continue;
      for (let hidden = 0; hidden < (band === 'STANDARD' ? values.length : 1); hidden += 1) {
        const p: MeanParameters = { values: values.join(','), n: values.length, mean, task: band === 'FOUNDATIONAL' ? 'MEAN' : 'MISSING_VALUE', hidden, newMean: mean };
        if (meanBand(band, p).length === 0 && !meanCollides(p)) out.push(p);
      }
    }
    return out;
  },
  bandIssues: meanBand,
  present(p) {
    if (p.task === 'ADDED_VALUE') return `La media aritmética de ${p.n} números es ${p.mean}. Se agrega un número más y la media de los ${p.n + 1} números pasa a ser ${p.newMean}. ¿Qué número se agregó?`;
    const values = listOf(p);
    if (p.task === 'MEAN') return `¿Cuál es la media aritmética de los siguientes ${p.n} datos? ${values.join(', ')}`;
    return `La media aritmética de ${p.n} datos es ${p.mean}. ${p.n - 1} de ellos son ${values.filter((_, i) => i !== p.hidden).join(', ')}. ¿Cuál es el dato que falta?`;
  },
  answer: (p) => String(meanKey(p)),
  // totals: the key, put back with what is shown, reproduces the stated mean
  keyHolds(p, key) {
    if (key.d !== 1 || key.n <= 0) return false;
    if (p.task === 'ADDED_VALUE') return p.mean * p.n + key.n === p.newMean * (p.n + 1);
    const values = listOf(p);
    if (p.task === 'MEAN') return values.reduce((s, v) => s + v, 0) === key.n * values.length;
    return values.filter((_, i) => i !== p.hidden).reduce((s, v) => s + v, 0) + key.n === p.mean * p.n;
  },
  misconceptionAnswers: meanMisconceptions,
  // the same deviation pattern around another mean is the same exercise shifted
  recognitionKey: (p) => (p.task === 'ADDED_VALUE' ? `ADDED|${p.n}|${p.newMean - p.mean}` : `${p.task}|${listOf(p).map((v) => v - p.mean).join('.')}|${p.hidden}`),
};

/** Every parametric construct of the library, by construct name. A construct that is not here has no machine-checkable envelope. */
export const PARAMETRIC_CONSTRUCTS: readonly ParametricConstruct<never>[] = [QUADRATIC_SOLVE, PROPORTION_MISSING_VALUE, LINE_SLOPE, SINGLE_DRAW, RIGHT_TRIANGLE, DATA_SET_MEAN] as unknown as readonly ParametricConstruct<never>[];
export const parametricConstructOf = (construct: string): ParametricConstruct | null => (PARAMETRIC_CONSTRUCTS as unknown as readonly ParametricConstruct[]).find((c) => c.construct === construct) ?? null;
