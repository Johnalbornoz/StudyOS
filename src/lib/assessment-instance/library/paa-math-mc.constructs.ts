/**
 * PAA Matemáticas -- StudyUs-original PARAMETRIC_DETERMINISTIC constructs for the SELECTED_RESPONSE positions of the
 * full-length PAA preparation form (pure data + pure functions, no IO, no provider). The official practice test lays
 * Matemáticas out as 45 multiple-choice + 10 student-produced items (cb-paa-practice-test-2018); the certified PAA
 * constructs of Aritmética and Probabilidad model too few distinct errors to offer four honest options, so:
 *
 *   PAA_PERCENT_CHANGE         aritmética   a price after a percentage increase / discount, or before an increase
 *   PAA_SINGLE_DRAW_IN_CONTEXT probabilidad the certified single-draw construct (same key, same errors) in other situations
 *
 * Each keys ONE exact value, recomputed by `keyHolds` by another route; every distractor is a modelled error.
 */
import { rational, sameRational, writeRational, type ParametricConstruct, type PlanningBand, type Rational } from './parametric';
import { SINGLE_DRAW, type DrawParameters } from './constructs';

const R = (n: number, d = 1): Rational => rational(n, d);
const need = (issues: string[]) => (ok: boolean, miss: string) => { if (!ok) issues.push(miss); };

// =================================================================================== percentage change in context
export interface PercentChangeParameters extends Record<string, number | string> { kind: 'INCREASE' | 'DISCOUNT' | 'BEFORE_INCREASE'; p: number; r: number; ctx: number }
const RATES = [10, 20, 25, 30, 40, 50] as const;
const ITEMS = ['una bicicleta', 'la matrícula de un curso', 'un televisor', 'el pasaje de una excursión', 'una consola de videojuegos', 'un par de zapatos deportivos', 'una tableta', 'la cuota mensual de un gimnasio'] as const;
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const after = (x: PercentChangeParameters): number => (x.p * (100 + x.r)) / 100;
const kindOf = (b: PlanningBand): PercentChangeParameters['kind'] => (b === 'FOUNDATIONAL' ? 'INCREASE' : b === 'STANDARD' ? 'DISCOUNT' : 'BEFORE_INCREASE');
const percentBand = (band: PlanningBand, x: PercentChangeParameters): string[] => {
  const i: string[] = []; const n = need(i);
  n(kindOf(band) === x.kind, 'KIND_IS_NOT_THE_BANDS');
  n((RATES as readonly number[]).includes(x.r), 'RATE_OUTSIDE_THE_ENVELOPE');
  n(x.p >= 40 && x.p <= 1200 && x.p % 20 === 0, 'PRICE_OUTSIDE_THE_ENVELOPE');
  n(Number.isInteger(x.ctx) && x.ctx >= 0 && x.ctx < ITEMS.length, 'CTX_OUTSIDE_THE_ENVELOPE');
  return i;
};
export const PAA_PERCENT_CHANGE: ParametricConstruct<PercentChangeParameters> = {
  construct: 'PAA_PERCENT_CHANGE', rendererVersion: 'tb.paa.percent-change@0.1.0', languages: ['es'],
  enumerate(band) {
    const out: PercentChangeParameters[] = [];
    const kind = kindOf(band);
    for (let ctx = 0; ctx < ITEMS.length; ctx++) for (const r of RATES) for (let p = 40; p <= 1200; p += 20) {
      const x: PercentChangeParameters = { kind, p, r, ctx };
      if (percentBand(band, x).length > 0) continue;
      const k = R(Number(this.answer(x)));
      const values = this.misconceptionAnswers(x).map((m) => m.value).filter((v): v is Rational => v !== null);
      // four honest options: the key and three DIFFERENT, positive modelled errors, none equal to the key
      if (values.length < 3 || values.some((v) => v.n <= 0 || sameRational(v, k)) || new Set(values.map(writeRational)).size !== values.length) continue;
      out.push(x);
    }
    return out;
  },
  bandIssues: percentBand,
  present: (x) => x.kind === 'INCREASE'
    ? `${cap(ITEMS[x.ctx])} cuesta ${x.p} dólares. Si su precio sube un ${x.r} %, ¿cuál es el nuevo precio, en dólares?`
    : x.kind === 'DISCOUNT'
      ? `${cap(ITEMS[x.ctx])} cuesta ${x.p} dólares. Si se ofrece con un descuento del ${x.r} %, ¿cuál es el precio con descuento, en dólares?`
      : `Después de un aumento del ${x.r} %, ${ITEMS[x.ctx]} cuesta ${after(x)} dólares. ¿Cuál era el precio antes del aumento, en dólares?`,
  answer: (x) => writeRational(x.kind === 'INCREASE' ? R(after(x)) : x.kind === 'DISCOUNT' ? R((x.p * (100 - x.r)) / 100) : R(x.p)),
  // from the shown numbers by the multiplier route (never the formula of `answer`)
  keyHolds: (x, key) => {
    if (key.d !== 1 || key.n <= 0) return false;
    if (x.kind === 'INCREASE') return key.n * 100 === x.p * (100 + x.r);
    if (x.kind === 'DISCOUNT') return key.n * 100 === x.p * (100 - x.r);
    return key.n * (100 + x.r) === after(x) * 100;
  },
  misconceptionAnswers: (x) => {
    const change = (x.p * x.r) / 100;
    if (x.kind === 'BEFORE_INCREASE') {
      const shown = after(x);
      return [
        { id: 'subtracts-the-percent-of-the-new-price', value: R(shown * (100 - x.r), 100) },
        { id: 'subtracts-the-rate-as-dollars', value: R(shown - x.r) },
        { id: 'gives-the-increase', value: R((shown * x.r), 100) },
      ];
    }
    const up = x.kind === 'INCREASE';
    return [
      { id: 'gives-only-the-change', value: R(change) },
      { id: 'adds-the-rate-as-dollars', value: R(up ? x.p + x.r : x.p - x.r) },
      { id: 'changes-in-the-wrong-direction', value: R(up ? x.p - change : x.p + change) },
    ];
  },
  recognitionKey: (x) => `${x.kind}|${x.p}|${x.r}|${x.ctx}`,
};

// =================================================================================== single draw, other situations
export interface DrawInContextParameters extends DrawParameters { ctx: number }
const masc = (e: DrawParameters['event']): string => (e === 'RED' ? 'sea rojo' : e === 'RED_OR_GREEN' ? 'sea rojo o verde' : 'no sea rojo');
const fem = (e: DrawParameters['event']): string => (e === 'RED' ? 'sea roja' : e === 'RED_OR_GREEN' ? 'sea roja o verde' : 'no sea roja');
const DRAW_SCENES: readonly ((x: DrawInContextParameters) => string)[] = [
  (x) => `En una rifa escolar hay ${x.red} boletos rojos, ${x.green} verdes y ${x.blue} azules, todos en una misma urna. Se saca un boleto al azar. ¿Cuál es la probabilidad de que el boleto ${masc(x.event)}?`,
  (x) => `Un frasco tiene ${x.red} caramelos rojos, ${x.green} verdes y ${x.blue} azules, todos de la misma forma. Se toma un caramelo sin mirar. ¿Cuál es la probabilidad de que el caramelo ${masc(x.event)}?`,
  (x) => `En un cajón hay ${x.red} calcetines rojos, ${x.green} verdes y ${x.blue} azules. Se saca un calcetín al azar. ¿Cuál es la probabilidad de que el calcetín ${masc(x.event)}?`,
  (x) => `Una caja contiene ${x.red} fichas rojas, ${x.green} verdes y ${x.blue} azules, idénticas salvo por el color. Se extrae una ficha al azar. ¿Cuál es la probabilidad de que la ficha ${fem(x.event)}?`,
  (x) => `En el estuche de una estudiante hay ${x.red} bolígrafos rojos, ${x.green} verdes y ${x.blue} azules. Toma un bolígrafo sin mirar. ¿Cuál es la probabilidad de que el bolígrafo ${masc(x.event)}?`,
];
const baseOf = (x: DrawInContextParameters): DrawParameters => { const { ctx: _c, ...rest } = x; return rest as DrawParameters; };
export const PAA_SINGLE_DRAW_IN_CONTEXT: ParametricConstruct<DrawInContextParameters> = {
  construct: 'PAA_SINGLE_DRAW_IN_CONTEXT', rendererVersion: 'tb.paa.single-draw-in-context@0.1.0', languages: ['es'],
  // only parameter sets whose three modelled errors give three different competitive values: four honest options
  enumerate: (band) => SINGLE_DRAW.enumerate(band).filter((p) => {
    const key = R(p.k, p.n);
    const v = SINGLE_DRAW.misconceptionAnswers(p).map((m) => m.value).filter((x): x is Rational => x !== null && x.n > 0 && !sameRational(x, key) && (x.n * key.d) / (x.d * key.n) <= 20 && (x.n * key.d) / (x.d * key.n) >= 1 / 20);
    return new Set(v.map(writeRational)).size >= 3;
  }).flatMap((p) => DRAW_SCENES.map((_, ctx) => ({ ...p, ctx } as DrawInContextParameters))),
  bandIssues: (band, x) => (Number.isInteger(x.ctx) && x.ctx >= 0 && x.ctx < DRAW_SCENES.length ? SINGLE_DRAW.bandIssues(band, baseOf(x)) : ['CTX_OUTSIDE_THE_ENVELOPE']),
  present: (x) => DRAW_SCENES[x.ctx](x),
  answer: (x) => SINGLE_DRAW.answer(baseOf(x)),
  keyHolds: (x, key) => SINGLE_DRAW.keyHolds(baseOf(x), key),
  misconceptionAnswers: (x) => SINGLE_DRAW.misconceptionAnswers(baseOf(x)),
  recognitionKey: (x) => `${x.ctx}|${SINGLE_DRAW.recognitionKey(baseOf(x))}`,
};

export const PAA_MATH_MC_CONSTRUCTS = [PAA_PERCENT_CHANGE, PAA_SINGLE_DRAW_IN_CONTEXT] as const;
