/**
 * QF V5.1 -- PARAMETRIC_DETERMINISTIC strategy of the construct QUADRATIC_EQUATION_RATIONAL_ROOTS_BY_FACTORISING
 * (family tf.math.quadratic.solve-by-factorising). Pure, deterministic, no IO.
 *
 * The construct is the family's: a (x - r1)(x - r2) = 0, b = -a (r1 + r2), c = a r1 r2, built from its roots.
 * The strategy draws (a, r1, r2) inside the specification's parameter ranges and the band's lever settings,
 * checks the family's constraints, and writes the equation and its key. HOW it is asked comes from the
 * specification alone -- language, response format, command term, marks, working, tool policy -- so one core
 * gives a PAA instance, an IB instance and a Cambridge instance that are the same mathematics, asked three ways.
 *
 * It writes no option list: the core excludes selected response (substitution would replace the method).
 */
import type { RenderingStrategy, RubricPoint, StrategyContext, StrategyResult } from './renderer';
import { EXACT_NUMERIC_POLICY } from './response-evaluation';

export const QUADRATIC_FACTORISING_CONSTRUCT = 'QUADRATIC_EQUATION_RATIONAL_ROOTS_BY_FACTORISING' as const;
export const QUADRATIC_FACTORISING_RENDERER_VERSION = 'parametric.quadratic-factorising@1.0.0' as const;

interface Range { symbol: string; min: number; max: number; step: number | null }
type Band = 'FOUNDATIONAL' | 'STANDARD' | 'CHALLENGE';
export interface QuadraticParameters { a: number; r1: number; r2: number; b: number; c: number; presentation: 'STANDARD_FORM' | 'TERMS_ON_BOTH_SIDES' | 'PRODUCT_TO_EXPAND' }

/** Roots are integers or halves (the family's step is 0.5): an exact value, never a rounded decimal. */
const frac = (x: number): string => (Number.isInteger(x) ? String(x) : `${x * 2}/2`);
const sup2 = '²';
const term = (coef: number, body: string, first: boolean): string => {
  if (coef === 0) return '';
  const mag = Math.abs(coef);
  const text = body === '' ? String(mag) : mag === 1 ? body : `${mag}${body}`;
  return first ? (coef < 0 ? `−${text}` : text) : coef < 0 ? ` − ${text}` : ` + ${text}`;
};
const poly = (a: number, b: number, c: number): string => `${term(a, `x${sup2}`, true)}${term(b, 'x', false)}${term(c, '', false)}`;
const side = (b: number, c: number): string => (b === 0 && c === 0 ? '0' : b === 0 ? term(c, '', true) : `${term(b, 'x', true)}${term(c, '', false)}`);

/** The equation as the learner reads it. Every presentation is the same equation a x² + b x + c = 0. */
export function presentEquation(p: QuadraticParameters): string {
  if (p.presentation === 'TERMS_ON_BOTH_SIDES') return `${term(p.a, `x${sup2}`, true)} = ${side(-p.b, -p.c)}`;
  if (p.presentation === 'PRODUCT_TO_EXPAND') {
    // a x² + b x + c = 0  <=>  x (a x + b) = -c
    return `x(${term(p.a, 'x', true)}${term(p.b, '', false)}) = ${term(-p.c, '', true) || '0'}`;
  }
  return `${poly(p.a, p.b, p.c)} = 0`;
}

/** The family's own constraints, as predicates. A parameter set that fails one is never rendered. */
export function parameterIssues(p: QuadraticParameters, ranges: readonly Range[]): string[] {
  const issues: string[] = [];
  const inRange = (symbol: string, value: number) => {
    const r = ranges.find((x) => x.symbol === symbol);
    if (!r) return issues.push(`NO_RANGE_FOR_${symbol}`);
    if (value < r.min || value > r.max) issues.push(`${symbol}_OUT_OF_RANGE`);
    if (r.step !== null && Math.abs((value - r.min) / r.step - Math.round((value - r.min) / r.step)) > 1e-9) issues.push(`${symbol}_OFF_STEP`);
    return 0;
  };
  inRange('a', p.a); inRange('r1', p.r1); inRange('r2', p.r2);
  if (p.r1 === p.r2) issues.push('REPEATED_ROOT_NOT_INTENDED');
  if (p.b !== -p.a * (p.r1 + p.r2) || p.c !== p.a * p.r1 * p.r2) issues.push('RELATIONSHIP_BROKEN');
  if (!Number.isInteger(p.b) || !Number.isInteger(p.c)) issues.push('COEFFICIENTS_NOT_INTEGERS');
  return issues;
}

function draw(band: Band, ranges: readonly Range[], src: StrategyContext['source']): QuadraticParameters | null {
  const r = ranges.find((x) => x.symbol === 'r1');
  const ra = ranges.find((x) => x.symbol === 'a');
  if (!r || !ra) return null;
  const lo = Math.ceil(Math.max(r.min, -9));
  const hi = Math.floor(Math.min(r.max, 9));
  for (let attempt = 0; attempt < 64; attempt += 1) {
    let a = 1; let r1: number; let r2: number; let presentation: QuadraticParameters['presentation'] = 'STANDARD_FORM';
    if (band === 'FOUNDATIONAL') {
      // a = 1, integer roots, given in standard form
      r1 = src.int(1, hi); r2 = src.int(1, hi);
    } else if (band === 'STANDARD') {
      // a = 1 with roots of opposite signs, terms on both sides
      r1 = src.int(1, hi); r2 = -src.int(1, -lo); presentation = 'TERMS_ON_BOTH_SIDES';
    } else {
      // a greater than 1 with a fractional root, a product to expand
      // a = 2 with one half-integer root: the factorised form (2x - k)(x - r2) has no common factor to take out first
      a = 2;
      if (a < ra.min || a > ra.max) return null;
      r1 = src.int(1, hi - 1) + 0.5; r2 = -src.int(1, -lo); presentation = 'PRODUCT_TO_EXPAND';
    }
    const p: QuadraticParameters = { a, r1, r2, b: -a * (r1 + r2), c: a * r1 * r2, presentation };
    // b = 0 would make it a difference of squares: another, simpler task than factorising a trinomial
    if (p.c !== 0 && p.b !== 0 && parameterIssues(p, ranges).length === 0) return p;
  }
  return null;
}

const TEXT = {
  es: { greater: (eq: string) => `Si ${eq}, ¿cuál es la mayor de las soluciones de la ecuación?`, both: (leadText: string, eq: string) => `${leadText} la ecuación ${eq}.`, working: 'Muestra el procedimiento.' },
  en: { greater: (eq: string) => `Given that ${eq}, find the greater of the two solutions of the equation.`, both: (leadText: string, eq: string) => `${leadText} the equation ${eq}.`, working: 'Show all necessary working.' },
} as const;
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
/** A command term reads naturally before "the equation" only for some terms; the others take an object. */
const lead = (termText: string, language: 'es' | 'en'): string => {
  const t = termText.toLowerCase();
  if (language === 'en') return t === 'solve' ? 'Solve' : `${cap(t)} the solutions of`;
  return t === 'resuelve' || t === 'resolver' ? 'Resuelve' : `${cap(t)} las soluciones de`;
};

export function renderQuadraticFactorising(ctx: StrategyContext): StrategyResult {
  const v = ctx.specification.variable;
  const language = v.language === 'es' ? 'es' : v.language === 'en' ? 'en' : null;
  if (!language) return { ok: false, code: 'LANGUAGE_NOT_CERTIFIED_FOR_THE_STRATEGY', detail: v.language };
  const format = v.responseFormat.format;
  if (format !== 'NUMERIC_ENTRY' && format !== 'SHORT_RESPONSE' && format !== 'MATH_EXPRESSION') return { ok: false, code: 'FORMAT_NOT_RENDERABLE', detail: format };
  if (v.toolPolicy.calculator !== 'NONE' && ctx.core.family.specialization && (ctx.core.family.specialization as { calculatorDependency?: string }).calculatorDependency === 'REQUIRED') return { ok: false, code: 'TOOL_MISMATCH', detail: v.toolPolicy.calculator };
  const ranges = ((ctx.specification.parameterization as { parameterRanges?: Range[] } | null)?.parameterRanges ?? []) as Range[];
  const p = draw(v.difficulty.band as Band, ranges, ctx.source);
  if (!p) return { ok: false, code: 'NO_VALID_PARAMETER_SET', detail: v.difficulty.band };
  const marks = v.marks;
  if (!marks) return { ok: false, code: 'SPECIFICATION_HAS_NO_MARKS', detail: ctx.specification.specificationId };
  const equation = presentEquation(p);
  const roots = [p.r1, p.r2].sort((x, y) => x - y);
  const t = TEXT[language];

  if (format === 'NUMERIC_ENTRY') {
    // one value: the stem says which root (family rule: "the response has one value")
    return {
      ok: true,
      output: {
        learner: { language, itemType: 'NUMERIC_ENTRY', stimulus: null, prompt: t.greater(equation), parts: [], options: [], marks: marks.total.max, conditions: { calculator: v.toolPolicy.calculator, workingShown: false } },
        key: { answers: [frac(roots[1])], correctOption: null, distractorRationales: {}, distractorLineage: {} },
        rubric: [{ code: 'KEY', kind: 'ANSWER', marks: marks.total.max, criterion: `${frac(roots[1])}` }],
        // one exact value: a fraction, or the same value as a decimal with either separator
        responsePolicy: EXACT_NUMERIC_POLICY,
        parameterSet: { ...p },
      },
    };
  }

  // constructed response: both roots, with the working the mark structure pays for
  const steps: RubricPoint[] = [];
  if (p.presentation !== 'STANDARD_FORM') steps.push({ code: 'M1', kind: 'METHOD', marks: 1, criterion: `Rearranges to ${poly(p.a, p.b, p.c)} = 0.` });
  const factor = (root: number): string => (Number.isInteger(root) ? `(x ${root < 0 ? '+' : '−'} ${Math.abs(root)})` : `(2x ${root < 0 ? '+' : '−'} ${Math.abs(root * 2)})`);
  const scale = roots.some((r) => !Number.isInteger(r)) ? p.a / 2 : p.a;
  steps.push({ code: 'M1', kind: 'METHOD', marks: 1, criterion: `Factorises: ${scale === 1 ? '' : scale}${factor(p.r1)}${factor(p.r2)} = 0.` });
  steps.push({ code: 'A1', kind: 'ACCURACY', marks: 1, criterion: `x = ${frac(roots[0])}` }, { code: 'A1', kind: 'ACCURACY', marks: 1, criterion: `x = ${frac(roots[1])}` });
  const total = steps.reduce((n, s) => n + s.marks, 0);
  if (total < marks.total.min || total > marks.total.max) return { ok: false, code: 'MARKS_OUTSIDE_THE_ADAPTER_RANGE', detail: `${total} not in ${marks.total.min}-${marks.total.max}` };
  const command = v.commandTerm ?? (language === 'es' ? 'resuelve' : 'solve');
  const prompt = `${t.both(lead(command, language), equation)}${v.reasoningDepth.workingShown ? ` ${t.working}` : ''} [${total}]`;
  return {
    ok: true,
    output: {
      learner: { language, itemType: format, stimulus: null, prompt, parts: [], options: [], marks: total, conditions: { calculator: v.toolPolicy.calculator, workingShown: v.reasoningDepth.workingShown } },
      key: { answers: roots.map(frac), correctOption: null, distractorRationales: {}, distractorLineage: {} },
      rubric: steps,
      // marked from the working: accuracy points are the two roots, in any exact form; method points need a marker
      responsePolicy: { ...EXACT_NUMERIC_POLICY, kind: 'RUBRIC', partialCredit: steps.map((st) => ({ code: st.code, kind: st.kind, marks: st.marks, answer: st.kind === 'ACCURACY' ? st.criterion.replace(/^x = /, '') : null })) },
      parameterSet: { ...p },
    },
  };
}

/** PROVISIONAL: no human has certified this renderer. It renders dev-test instances; Student delivery refuses it. */
export const QUADRATIC_FACTORISING_STRATEGY: RenderingStrategy = {
  construct: QUADRATIC_FACTORISING_CONSTRUCT, kind: 'PARAMETRIC_DETERMINISTIC', rendererVersion: QUADRATIC_FACTORISING_RENDERER_VERSION, status: 'PROVISIONAL', render: renderQuadraticFactorising,
};

/** How many distinct valid parameter sets a band has: the instance capacity of the core under this strategy. */
export function quadraticInstanceCapacity(band: Band, ranges: readonly Range[]): number {
  const r = ranges.find((x) => x.symbol === 'r1');
  const ra = ranges.find((x) => x.symbol === 'a');
  if (!r || !ra) return 0;
  const lo = Math.ceil(Math.max(r.min, -9));
  const hi = Math.floor(Math.min(r.max, 9));
  const seen = new Set<string>();
  const add = (a: number, r1: number, r2: number, presentation: QuadraticParameters['presentation']) => {
    const p: QuadraticParameters = { a, r1, r2, b: -a * (r1 + r2), c: a * r1 * r2, presentation };
    // (r1, r2) and (r2, r1) are the same equation: one instance
    if (p.c !== 0 && p.b !== 0 && parameterIssues(p, ranges).length === 0) seen.add(`${a}|${Math.min(r1, r2)}|${Math.max(r1, r2)}`);
  };
  if (band === 'FOUNDATIONAL') for (let i = 1; i <= hi; i += 1) for (let j = 1; j <= hi; j += 1) add(1, i, j, 'STANDARD_FORM');
  else if (band === 'STANDARD') for (let i = 1; i <= hi; i += 1) for (let j = 1; j <= -lo; j += 1) add(1, i, -j, 'TERMS_ON_BOTH_SIDES');
  else if (ra.min <= 2 && ra.max >= 2) for (let i = 1; i <= hi - 1; i += 1) for (let j = 1; j <= -lo; j += 1) add(2, i + 0.5, -j, 'PRODUCT_TO_EXPAND');
  return seen.size;
}

/** Does a parameter set carry the lever settings of its band? Each setting that it misses is named. */
export function quadraticBandIssues(band: string, p: Readonly<Record<string, number | string>>): string[] {
  const a = Number(p.a); const r1 = Number(p.r1); const r2 = Number(p.r2);
  const issues: string[] = [];
  const need = (ok: boolean, miss: string) => { if (!ok) issues.push(miss); };
  if (band === 'FOUNDATIONAL') { need(a === 1, 'LEADING_COEFFICIENT_IS_NOT_1'); need(Number.isInteger(r1) && Number.isInteger(r2) && r1 > 0 && r2 > 0, 'ROOTS_ARE_NOT_POSITIVE_INTEGERS'); need(p.presentation === 'STANDARD_FORM', 'NOT_IN_STANDARD_FORM'); }
  else if (band === 'STANDARD') { need(a === 1, 'LEADING_COEFFICIENT_IS_NOT_1'); need(Number.isInteger(r1) && Number.isInteger(r2) && r1 * r2 < 0, 'ROOTS_ARE_NOT_INTEGERS_OF_OPPOSITE_SIGNS'); need(p.presentation === 'TERMS_ON_BOTH_SIDES', 'TERMS_ARE_NOT_ON_BOTH_SIDES'); }
  else if (band === 'CHALLENGE') { need(a === 2, 'LEADING_COEFFICIENT_IS_NOT_2'); need(!Number.isInteger(r1) && Number.isInteger(r1 * 2) && r1 > 0 && Number.isInteger(r2) && r2 < 0, 'ROOTS_ARE_NOT_ONE_POSITIVE_HALF_AND_ONE_NEGATIVE_INTEGER'); need(p.presentation === 'PRODUCT_TO_EXPAND', 'NOT_A_PRODUCT_TO_EXPAND'); }
  else issues.push(`UNKNOWN_BAND_${band}`);
  need(r1 !== r2, 'REPEATED_ROOT'); need(Number(p.b) !== 0 && Number(p.c) !== 0, 'DEGENERATE_TRINOMIAL');
  return issues;
}
