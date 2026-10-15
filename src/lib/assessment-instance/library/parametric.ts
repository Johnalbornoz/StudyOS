/**
 * QF V5.2 -- a PARAMETRIC_DETERMINISTIC construct as DATA: a bounded, enumerable set of parameter sets per band,
 * how one is worded, what its key is, and an INDEPENDENT check of that key (pure, no IO).
 *
 * Everything a certification of a renderer envelope needs to be decided by a machine follows from the four
 * things a construct states here:
 *   enumerate    every valid parameter set of a band. Finite and bounded: there is no branch of the renderer that
 *                is not in this list, so "every parameter branch is bounded" is a property that can be checked.
 *   present      the learner-facing wording of one parameter set.
 *   answer       the keyed value.
 *   keyHolds     a second route to the key, from the numbers the learner is shown, that does not reuse `answer`.
 *                A key that does not hold is a defect of the renderer, found without any person or model.
 *   recognition  what makes two instances feel like the same question to a learner who has seen one. Capacity is
 *                counted in recognition classes, never in raw parameter sets.
 * A seed picks one parameter set by index. There is no provider, no clock, no random source but the seed.
 */
import type { RenderingStrategy, StrategyContext, StrategyResult } from '../renderer';
import { EXACT_NUMERIC_POLICY, OPTION_POLICY } from '../response-evaluation';

export const PLANNING_BANDS = ['FOUNDATIONAL', 'STANDARD', 'CHALLENGE'] as const;
export type PlanningBand = (typeof PLANNING_BANDS)[number];
export type ParameterSet = Readonly<Record<string, number | string>>;
export interface ParameterRange { symbol: string; min: number; max: number; step: number | null }

export interface ParametricConstruct<P extends ParameterSet = ParameterSet> {
  construct: string;
  rendererVersion: string;
  languages: readonly ('es' | 'en')[];
  /** Every valid parameter set of a band, in a stable order. */
  enumerate(band: PlanningBand): readonly P[];
  /** The lever settings of the band a parameter set misses. Empty = it is of that band. */
  bandIssues(band: PlanningBand, p: P): string[];
  present(p: P, language: 'es' | 'en'): string;
  answer(p: P): string;
  /** Does `key` solve what the learner is shown? Recomputed from the shown numbers, by another route than `answer`. */
  keyHolds(p: P, key: Rational): boolean;
  /** For an instance that keys several values (every root): does each of them hold? Absent = the construct keys one value. */
  everyKeyHolds?(p: P, keys: readonly Rational[]): boolean;
  /** What the modelled misconceptions of the core give for this parameter set. The key is never one of them. */
  misconceptionAnswers(p: P): { id: string; value: Rational | null }[];
  recognitionKey(p: P): string;
}

// ---------------------------------------------------------------------------------------------- exact numbers
/** An exact rational, always in lowest terms with a positive denominator. */
export interface Rational { n: number; d: number }
const gcd = (a: number, b: number): number => (b === 0 ? Math.abs(a) : gcd(b, a % b));
export const rational = (n: number, d = 1): Rational => { if (d === 0 || !Number.isInteger(n) || !Number.isInteger(d)) throw new Error(`NOT_A_RATIONAL: ${n}/${d}`); const g = gcd(n, d) || 1; const s = d < 0 ? -1 : 1; return { n: (s * n) / g, d: (s * d) / g }; };
export const sameRational = (x: Rational, y: Rational): boolean => x.n * y.d === y.n * x.d;
/** Canonical written form: an integer, or a fraction in lowest terms. */
export const writeRational = (x: Rational): string => (x.d === 1 ? String(x.n) : `${x.n}/${x.d}`);
/** Reads a key as it is written: "7", "-3", "7/2", "131.25". null when it is not a number. */
export function readRational(text: string): Rational | null {
  const t = text.trim().replace('−', '-');
  const frac = /^(-?\d+)\/(\d+)$/.exec(t);
  if (frac) return Number(frac[2]) === 0 ? null : rational(Number(frac[1]), Number(frac[2]));
  const dec = /^(-?)(\d+)(?:\.(\d+))?$/.exec(t);
  if (!dec) return null;
  const scale = 10 ** (dec[3]?.length ?? 0);
  return rational((dec[1] ? -1 : 1) * (Number(dec[2]) * scale + Number(dec[3] ?? 0)), scale);
}

// ------------------------------------------------------------------------------------------------- strategy
const cache = new WeakMap<object, Map<string, readonly ParameterSet[]>>();
/** The band's parameter sets, enumerated once. */
export function parameterSetsOf<P extends ParameterSet>(c: ParametricConstruct<P>, band: PlanningBand): readonly P[] {
  let byBand = cache.get(c);
  if (!byBand) { byBand = new Map(); cache.set(c, byBand); }
  if (!byBand.has(band)) byBand.set(band, c.enumerate(band));
  return byBand.get(band) as readonly P[];
}

/**
 * The rendering strategy of a parametric construct: one exact value, no stimulus. PROVISIONAL until certified.
 *
 *   NUMERIC_ENTRY   (default; every existing entry)   the value only.
 *   SHORT_RESPONSE  (`{ format: 'SHORT_RESPONSE' }`)  the governed constructed-response format of a system that has no
 *                   numeric-entry format (IB): the Student writes the answer, which is ONE exact value judged by the
 *                   canonical numeric contract; the marks are ANSWER marks (no method mark, working not assessed), so
 *                   the item is not marked on working. The format classification is the system's; the scoring is the
 *                   same deterministic contract.
 */
export function parametricStrategy<P extends ParameterSet>(c: ParametricConstruct<P>, opts: { format?: 'NUMERIC_ENTRY' | 'SHORT_RESPONSE' | 'SELECTED_RESPONSE'; marksByBand?: Readonly<Record<PlanningBand, number>> } = {}): RenderingStrategy {
  const format = opts.format ?? 'NUMERIC_ENTRY';
  const render = (ctx: StrategyContext): StrategyResult => {
    const v = ctx.specification.variable;
    const language = c.languages.find((l) => l === v.language);
    if (!language) return { ok: false, code: 'LANGUAGE_NOT_CERTIFIED_FOR_THE_STRATEGY', detail: v.language };
    if (v.responseFormat.format !== format) return { ok: false, code: 'FORMAT_NOT_RENDERABLE', detail: v.responseFormat.format };
    if (!v.marks) return { ok: false, code: 'SPECIFICATION_HAS_NO_MARKS', detail: ctx.specification.specificationId };
    const band = v.difficulty.band as PlanningBand;
    // marks: the construct's own per-band marks when it states them (within the specification's governed range), else the range's maximum (as before)
    const stated = opts.marksByBand?.[band];
    if (stated !== undefined && (stated < v.marks.total.min || stated > v.marks.total.max)) return { ok: false, code: 'MARKS_OUTSIDE_THE_SPECIFICATION', detail: `${stated} not in ${v.marks.total.min}..${v.marks.total.max}` };
    const marks = stated ?? v.marks.total.max;
    const sets = PLANNING_BANDS.includes(band) ? parameterSetsOf(c, band) : [];
    if (sets.length === 0) return { ok: false, code: 'NO_VALID_PARAMETER_SET', detail: v.difficulty.band };
    // An explicit selection (`<seed>@rk=<recognitionKey>`, used to re-render a delivered package candidate) names the
    // parameter set; any other seed draws one from the seeded source, as before.
    const named = /@rk=(.+)$/.exec(ctx.seed ?? '')?.[1];
    const p = named !== undefined ? sets.find((x) => c.recognitionKey(x) === named) : sets[ctx.source.int(0, sets.length - 1)];
    if (!p) return { ok: false, code: 'NO_SUCH_PARAMETER_SET', detail: `${named} is not a parameter set of ${v.difficulty.band}` };
    const answer = c.answer(p);
    const key = readRational(answer);
    // the renderer never emits a key its own independent check does not confirm
    if (!key || !c.keyHolds(p, key)) return { ok: false, code: 'KEY_DOES_NOT_HOLD', detail: answer };
    if (format === 'SELECTED_RESPONSE') {
      // the key and three distractors, each the value a MODELLED misconception gives for this parameter set (never an
      // invented number); the order is drawn from the seeded source, so no position carries the key
      const keyText = writeRational(key);
      const seen = new Set([keyText]);
      // a distractor must be competitive: within the selected-response engine's spread (x20) of the key, never a value nobody would choose
      const near = (v: Rational) => { const r = (v.n * key.d) / (v.d * key.n); return r <= 20 && r >= 1 / 20; };
      const wrong = c.misconceptionAnswers(p).flatMap((m) => { if (!m.value || m.value.n <= 0 || !near(m.value)) return []; const t = writeRational(m.value); if (seen.has(t)) return []; seen.add(t); return [{ id: m.id, text: t }]; }).slice(0, 3);
      if (wrong.length < 3) return { ok: false, code: 'TOO_FEW_MODELLED_DISTRACTORS', detail: `${wrong.length} distinct misconception values` };
      const order = [{ id: null as string | null, text: keyText }, ...wrong];
      for (let i = order.length - 1; i > 0; i -= 1) { const j = ctx.source.int(0, i); [order[i], order[j]] = [order[j], order[i]]; }
      const labels = ['A', 'B', 'C', 'D'];
      const options = order.map((o, i) => ({ label: labels[i], text: o.text }));
      const correct = labels[order.findIndex((o) => o.id === null)];
      const human = (id: string) => id.replace(/-/g, ' ');
      return {
        ok: true,
        output: {
          learner: { language, itemType: 'SELECTED_RESPONSE', stimulus: null, prompt: c.present(p, language), parts: [], options, marks, conditions: { calculator: v.toolPolicy.calculator, workingShown: false } },
          key: { answers: [keyText], correctOption: correct, distractorRationales: Object.fromEntries(order.flatMap((o, i) => (o.id ? [[labels[i], `A learner who ${human(o.id)} chooses this value.`]] : []))), distractorLineage: Object.fromEntries(order.flatMap((o, i) => (o.id ? [[labels[i], { misconceptionId: o.id, reasoningError: human(o.id), derivedAnswer: o.text }]] : []))) },
          rubric: [{ code: 'KEY', kind: 'ANSWER', marks, criterion: correct }],
          responsePolicy: OPTION_POLICY,
          parameterSet: { ...p },
        },
      };
    }
    return {
      ok: true,
      output: {
        learner: { language, itemType: format, stimulus: null, prompt: c.present(p, language), parts: [], options: [], marks, conditions: { calculator: v.toolPolicy.calculator, workingShown: false } },
        key: { answers: [answer], correctOption: null, distractorRationales: {}, distractorLineage: {} },
        // NUMERIC_ENTRY keeps its rubric exactly; a SHORT_RESPONSE states its answer marks as A marks
        rubric: [{ code: format === 'SHORT_RESPONSE' ? `A${marks}` : 'KEY', kind: 'ANSWER', marks, criterion: answer }],
        responsePolicy: EXACT_NUMERIC_POLICY,
        parameterSet: { ...p },
      },
    };
  };
  return { construct: c.construct, kind: 'PARAMETRIC_DETERMINISTIC', rendererVersion: c.rendererVersion, status: 'PROVISIONAL', render };
}

// ------------------------------------------------------------------------------------------------- capacity
export interface BandCapacity { band: PlanningBand; rawVariants: number; distinctDeliverable: number; recognitionClasses: number }
/**
 * What a band can really supply. RAW = parameter sets. DISTINCT = different learner-facing wordings (two parameter
 * sets that read the same count once). RECOGNITION CLASSES = instances a learner would not take for one another.
 */
export function bandCapacity<P extends ParameterSet>(c: ParametricConstruct<P>, band: PlanningBand, language: 'es' | 'en'): BandCapacity {
  const sets = parameterSetsOf(c, band);
  return { band, rawVariants: sets.length, distinctDeliverable: new Set(sets.map((p) => c.present(p, language))).size, recognitionClasses: new Set(sets.map((p) => c.recognitionKey(p))).size };
}

export interface EnvelopeSweep { band: PlanningBand; checked: number; keyFailures: number; bandFailures: number; misconceptionCollisions: number; nonPositiveKeys: number; duplicateWordingsWithDifferentKeys: number }
/**
 * The property test of a whole envelope, exhaustively: every parameter set of every band -- not a sample. A
 * renderer with one failure anywhere is not certifiable by a machine.
 */
export function sweepEnvelope<P extends ParameterSet>(c: ParametricConstruct<P>, language: 'es' | 'en'): EnvelopeSweep[] {
  return PLANNING_BANDS.map((band) => {
    const sets = parameterSetsOf(c, band);
    const keyOfWording = new Map<string, string>();
    let keyFailures = 0; let bandFailures = 0; let misconceptionCollisions = 0; let nonPositiveKeys = 0; let duplicateWordingsWithDifferentKeys = 0;
    for (const p of sets) {
      const answer = c.answer(p);
      const key = readRational(answer);
      if (!key || !c.keyHolds(p, key)) { keyFailures += 1; continue; }
      if (key.n <= 0) nonPositiveKeys += 1;
      if (c.bandIssues(band, p).length > 0) bandFailures += 1;
      if (c.misconceptionAnswers(p).some((m) => m.value !== null && sameRational(m.value, key))) misconceptionCollisions += 1;
      const wording = c.present(p, language);
      const seen = keyOfWording.get(wording);
      if (seen !== undefined && seen !== answer) duplicateWordingsWithDifferentKeys += 1;
      keyOfWording.set(wording, answer);
    }
    return { band, checked: sets.length, keyFailures, bandFailures, misconceptionCollisions, nonPositiveKeys, duplicateWordingsWithDifferentKeys };
  });
}
export const sweepIsClean = (sweep: readonly EnvelopeSweep[]): boolean => sweep.every((s) => s.checked > 0 && s.keyFailures + s.bandFailures + s.misconceptionCollisions + s.nonPositiveKeys + s.duplicateWordingsWithDifferentKeys === 0);
