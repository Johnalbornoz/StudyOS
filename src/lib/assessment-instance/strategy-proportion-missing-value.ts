/**
 * QF V5.1 -- PARAMETRIC_DETERMINISTIC strategy of the construct DIRECT_PROPORTION_MISSING_VALUE
 * (family tf.math.proportion.missing-value). Pure, deterministic, no IO.
 *
 * The construct is the family's: a / b = c / x, so x = b * c / a. The strategy draws (a, b, c) inside the
 * specification's parameter ranges, applies the band's lever settings, checks the family's constraints and
 * solution rules, and writes the situation and its key. A parametric strategy is natural here: the family's
 * contexts "only name" the two quantities, so nothing an instance says goes beyond the parameter set.
 *
 * BANDS, as the family's two levers set them:
 *   FOUNDATIONAL  c is a whole-number multiple of a; one proportion.
 *   STANDARD      c / a is a simple fraction (denominator 2 to 5); one proportion after a unit conversion.
 *   CHALLENGE     c / a is not a simple fraction and x is a decimal; one proportion after a unit conversion.
 *
 * ONE PROPORTION PER INSTANCE. The core (rc.2) declares no second proportion and this strategy renders none: the
 * steps lever is a unit conversion before the proportion, at STANDARD and at CHALLENGE alike.
 *
 * It writes no option list: the envelope of this version is NUMERIC_ENTRY (a produced value).
 */
import type { RenderingStrategy, StrategyContext, StrategyResult } from './renderer';
import { EXACT_NUMERIC_POLICY } from './response-evaluation';

export const PROPORTION_MISSING_VALUE_CONSTRUCT = 'DIRECT_PROPORTION_MISSING_VALUE' as const;
export const PROPORTION_MISSING_VALUE_RENDERER_VERSION = 'parametric.proportion-missing-value@1.0.0' as const;

interface Range { symbol: string; min: number; max: number; step: number | null }
type Band = 'FOUNDATIONAL' | 'STANDARD' | 'CHALLENGE';
/** How c is stated to the learner: in the unit of a, or in a larger unit the learner converts first. */
export const PROPORTION_SITUATIONS = ['COST', 'FLOW_MINUTES', 'FLOW_HOURS', 'USE_WEEKS'] as const;
export type ProportionSituation = (typeof PROPORTION_SITUATIONS)[number];
/** Units of a per stated unit of c. 1 = no conversion. */
export const SITUATION_FACTOR: Readonly<Record<ProportionSituation, number>> = { COST: 1, FLOW_MINUTES: 1, FLOW_HOURS: 60, USE_WEEKS: 7 };
export interface ProportionParameters { a: number; b: number; c: number; x: number; situation: ProportionSituation; statedC: number }

const gcd = (m: number, n: number): number => (n === 0 ? Math.abs(m) : gcd(n, m % n));
/** c / a in lowest terms. */
export const scaleFactorOf = (a: number, c: number): { p: number; q: number } => { const g = gcd(c, a); return { p: c / g, q: a / g }; };
/** x = b c / a as an exact count of hundredths, or null when x has more than two decimal places. */
const hundredthsOf = (a: number, b: number, c: number): number | null => ((100 * b * c) % a === 0 ? (100 * b * c) / a : null);
const decimal = (hundredths: number): string => (hundredths % 100 === 0 ? String(hundredths / 100) : (hundredths / 100).toFixed(hundredths % 10 === 0 ? 1 : 2));

/** What each misconception model of the core gives for a parameter set (the family's `producesError`, computed). */
export const proportionMisconceptionAnswers = (p: Pick<ProportionParameters, 'a' | 'b' | 'c'>): { id: string; value: number }[] => [
  { id: 'additive', value: p.b + (p.c - p.a) }, { id: 'inverted', value: (p.a * p.b) / p.c }, { id: 'wrong-pair', value: (p.a * p.c) / p.b },
];

/** The family's own constraints and solution rules, as predicates. A parameter set that fails one is never rendered. */
export function proportionParameterIssues(p: ProportionParameters, ranges: readonly Range[]): string[] {
  const issues: string[] = [];
  for (const [symbol, value] of [['a', p.a], ['b', p.b], ['c', p.c]] as const) {
    const r = ranges.find((x) => x.symbol === symbol);
    if (!r) { issues.push(`NO_RANGE_FOR_${symbol}`); continue; }
    if (value < r.min || value > r.max) issues.push(`${symbol}_OUT_OF_RANGE`);
    if (!Number.isInteger(value)) issues.push(`${symbol}_OFF_STEP`);
  }
  if (p.c === p.a) issues.push('C_EQUALS_A');
  const h = hundredthsOf(p.a, p.b, p.c);
  if (h === null) issues.push('X_HAS_MORE_THAN_TWO_DECIMALS');
  else if (h / 100 !== p.x) issues.push('RELATIONSHIP_BROKEN');
  if (p.statedC * SITUATION_FACTOR[p.situation] !== p.c) issues.push('STATED_VALUE_DOES_NOT_CONVERT_TO_C');
  // the key is never the answer of a modelled misconception: a learner reasoning wrongly is never marked right
  if (proportionMisconceptionAnswers(p).some((m) => m.value === p.x)) issues.push('ANSWER_COINCIDES_WITH_A_MISCONCEPTION');
  return issues;
}

/**
 * What keeps a band's arithmetic workable without a calculator, inside the family's ranges. Part of the envelope a
 * reviewer certifies: the draw and the conformance check both read these, so neither can drift from the other.
 */
export const PROPORTION_BAND_LIMITS = {
  FOUNDATIONAL: { aMax: 12, bMax: 60, multipleMin: 2, multipleMax: 6 },
  STANDARD: { bMax: 120, denominatorMin: 2, denominatorMax: 5, numeratorMax: 9 },
  CHALLENGE: { bMax: 120, denominatorMin: 6, factorMax: 6 },
} as const;

/** Does a parameter set carry the lever settings of its band? Each setting that it misses is named. */
export function proportionBandIssues(band: Band, p: ProportionParameters): string[] {
  const { p: numerator, q } = scaleFactorOf(p.a, p.c);
  const converts = SITUATION_FACTOR[p.situation] !== 1;
  const issues: string[] = [];
  const need = (ok: boolean, miss: string) => { if (!ok) issues.push(miss); };
  if (band === 'FOUNDATIONAL') {
    const L = PROPORTION_BAND_LIMITS.FOUNDATIONAL;
    need(q === 1 && numerator >= L.multipleMin && numerator <= L.multipleMax, 'C_IS_NOT_A_SMALL_WHOLE_MULTIPLE_OF_A');
    need(!converts, 'FOUNDATIONAL_HAS_NO_UNIT_CONVERSION');
    need(p.a <= L.aMax && p.b <= L.bMax, 'GIVEN_VALUES_TOO_LARGE_FOR_THE_BAND');
  } else if (band === 'STANDARD') {
    const L = PROPORTION_BAND_LIMITS.STANDARD;
    need(converts, 'UNIT_CONVERSION_REQUIRED');
    need(q >= L.denominatorMin && q <= L.denominatorMax && numerator <= L.numeratorMax, 'SCALE_FACTOR_IS_NOT_A_SIMPLE_FRACTION');
    need(Number.isInteger(p.x), 'STANDARD_ANSWER_IS_A_WHOLE_NUMBER');
    need(p.b <= L.bMax, 'GIVEN_VALUES_TOO_LARGE_FOR_THE_BAND');
  } else {
    const L = PROPORTION_BAND_LIMITS.CHALLENGE;
    need(converts, 'UNIT_CONVERSION_REQUIRED');
    need(q >= L.denominatorMin, 'SCALE_FACTOR_IS_A_SIMPLE_FRACTION');
    need(p.c <= L.factorMax * p.a, 'SCALE_FACTOR_TOO_LARGE_FOR_THE_BAND');
    need(!Number.isInteger(p.x), 'CHALLENGE_ANSWER_IS_A_DECIMAL');
    need(p.b <= L.bMax, 'GIVEN_VALUES_TOO_LARGE_FOR_THE_BAND');
  }
  return issues;
}

const BAND_SITUATIONS: Readonly<Record<Band, readonly ProportionSituation[]>> = { FOUNDATIONAL: ['COST', 'FLOW_MINUTES'], STANDARD: ['FLOW_HOURS', 'USE_WEEKS'], CHALLENGE: ['FLOW_HOURS', 'USE_WEEKS'] };

function candidate(band: Band, situation: ProportionSituation, a: number, b: number, statedC: number, ranges: readonly Range[]): ProportionParameters | null {
  const c = statedC * SITUATION_FACTOR[situation];
  const h = hundredthsOf(a, b, c);
  if (h === null) return null;
  const p: ProportionParameters = { a, b, c, x: h / 100, situation, statedC };
  return proportionParameterIssues(p, ranges).length === 0 && proportionBandIssues(band, p).length === 0 ? p : null;
}
const rangeOf = (ranges: readonly Range[], symbol: string): Range | null => ranges.find((r) => r.symbol === symbol) ?? null;

function draw(band: Band, ranges: readonly Range[], src: StrategyContext['source']): ProportionParameters | null {
  const ra = rangeOf(ranges, 'a'); const rb = rangeOf(ranges, 'b'); const rc = rangeOf(ranges, 'c');
  if (!ra || !rb || !rc) return null;
  for (let attempt = 0; attempt < 4096; attempt += 1) {
    const situation = src.pick(BAND_SITUATIONS[band]);
    const factor = SITUATION_FACTOR[situation];
    let p: ProportionParameters | null;
    if (band === 'FOUNDATIONAL') {
      const L = PROPORTION_BAND_LIMITS.FOUNDATIONAL;
      const a = src.int(ra.min, Math.min(ra.max, L.aMax));
      p = candidate(band, situation, a, src.int(rb.min, Math.min(rb.max, L.bMax)), a * src.int(L.multipleMin, L.multipleMax), ranges);
    } else {
      const statedMax = Math.floor(rc.max / factor);
      if (statedMax < 1) continue;
      p = candidate(band, situation, src.int(ra.min, ra.max), src.int(rb.min, Math.min(rb.max, PROPORTION_BAND_LIMITS[band].bMax)), src.int(1, statedMax), ranges);
    }
    if (p) return p;
  }
  return null;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
const TEXT = {
  es: {
    COST: (p: ProportionParameters) => `Si ${p.a} cuadernos iguales cuestan ${p.b} pesos, ¿cuántos pesos cuestan ${p.statedC} de esos cuadernos?`,
    FLOW_MINUTES: (p: ProportionParameters) => `Una llave vierte agua a ritmo constante: ${p.b} litros en ${p.a} minutos. ¿Cuántos litros vierte en ${p.statedC} minutos?`,
    FLOW_HOURS: (p: ProportionParameters) => `Una llave vierte agua a ritmo constante: ${p.b} litros en ${p.a} minutos. ¿Cuántos litros vierte en ${plural(p.statedC, 'hora', 'horas')}?`,
    USE_WEEKS: (p: ProportionParameters) => `Un sistema de riego consume agua a ritmo constante: ${p.b} litros en ${p.a} días. ¿Cuántos litros consume en ${plural(p.statedC, 'semana', 'semanas')}?`,
  },
  en: {
    COST: (p: ProportionParameters) => `If ${p.a} identical notebooks cost ${p.b} pesos, how many pesos do ${p.statedC} of those notebooks cost?`,
    FLOW_MINUTES: (p: ProportionParameters) => `A tap delivers water at a constant rate: ${p.b} litres in ${p.a} minutes. How many litres does it deliver in ${p.statedC} minutes?`,
    FLOW_HOURS: (p: ProportionParameters) => `A tap delivers water at a constant rate: ${p.b} litres in ${p.a} minutes. How many litres does it deliver in ${plural(p.statedC, 'hour', 'hours')}?`,
    USE_WEEKS: (p: ProportionParameters) => `An irrigation system uses water at a constant rate: ${p.b} litres in ${p.a} days. How many litres does it use in ${plural(p.statedC, 'week', 'weeks')}?`,
  },
} as const;

/** The situation as the learner reads it. */
export const presentProportion = (p: ProportionParameters, language: 'es' | 'en'): string => TEXT[language][p.situation](p);

export function renderProportionMissingValue(ctx: StrategyContext): StrategyResult {
  const v = ctx.specification.variable;
  const language = v.language === 'es' ? 'es' : v.language === 'en' ? 'en' : null;
  if (!language) return { ok: false, code: 'LANGUAGE_NOT_CERTIFIED_FOR_THE_STRATEGY', detail: v.language };
  if (v.responseFormat.format !== 'NUMERIC_ENTRY') return { ok: false, code: 'FORMAT_NOT_RENDERABLE', detail: v.responseFormat.format };
  const marks = v.marks;
  if (!marks) return { ok: false, code: 'SPECIFICATION_HAS_NO_MARKS', detail: ctx.specification.specificationId };
  const ranges = ((ctx.specification.parameterization as { parameterRanges?: Range[] } | null)?.parameterRanges ?? []) as Range[];
  const p = draw(v.difficulty.band as Band, ranges, ctx.source);
  if (!p) return { ok: false, code: 'NO_VALID_PARAMETER_SET', detail: v.difficulty.band };
  const answer = decimal(Math.round(p.x * 100));
  return {
    ok: true,
    output: {
      learner: { language, itemType: 'NUMERIC_ENTRY', stimulus: null, prompt: presentProportion(p, language), parts: [], options: [], marks: marks.total.max, conditions: { calculator: v.toolPolicy.calculator, workingShown: false } },
      key: { answers: [answer], correctOption: null, distractorRationales: {}, distractorLineage: {} },
      rubric: [{ code: 'KEY', kind: 'ANSWER', marks: marks.total.max, criterion: answer }],
      // one exact value: an integer, or the same value as a decimal with either separator or as a fraction
      responsePolicy: EXACT_NUMERIC_POLICY,
      parameterSet: { ...p },
    },
  };
}

/** PROVISIONAL: no human has certified this renderer. It renders dev-test instances; Student delivery refuses it. */
export const PROPORTION_MISSING_VALUE_STRATEGY: RenderingStrategy = {
  construct: PROPORTION_MISSING_VALUE_CONSTRUCT, kind: 'PARAMETRIC_DETERMINISTIC', rendererVersion: PROPORTION_MISSING_VALUE_RENDERER_VERSION, status: 'PROVISIONAL', render: renderProportionMissingValue,
};

/** How many distinct valid parameter sets a band has: the instance capacity of the core under this strategy. */
export function proportionInstanceCapacity(band: Band, ranges: readonly Range[]): number {
  const ra = rangeOf(ranges, 'a'); const rb = rangeOf(ranges, 'b'); const rc = rangeOf(ranges, 'c');
  if (!ra || !rb || !rc) return 0;
  let n = 0;
  for (const situation of BAND_SITUATIONS[band]) {
    const factor = SITUATION_FACTOR[situation];
    const aMax = band === 'FOUNDATIONAL' ? Math.min(ra.max, PROPORTION_BAND_LIMITS.FOUNDATIONAL.aMax) : ra.max;
    const bMax = Math.min(rb.max, PROPORTION_BAND_LIMITS[band].bMax);
    for (let a = ra.min; a <= aMax; a += 1) for (let b = rb.min; b <= bMax; b += 1) {
      if (band === 'FOUNDATIONAL') { for (let k = PROPORTION_BAND_LIMITS.FOUNDATIONAL.multipleMin; k <= PROPORTION_BAND_LIMITS.FOUNDATIONAL.multipleMax; k += 1) if (candidate(band, situation, a, b, a * k, ranges)) n += 1; }
      else for (let stated = 1; stated * factor <= rc.max; stated += 1) if (candidate(band, situation, a, b, stated, ranges)) n += 1;
    }
  }
  return n;
}
