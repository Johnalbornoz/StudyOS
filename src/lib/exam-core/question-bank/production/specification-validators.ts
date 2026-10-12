/**
 * QB-R2D -- the INDEPENDENT validators of a specification-driven candidate (pure, no IO).
 *
 * They read the candidate, its stimulus and the adaptation specification it was generated from. They import nothing
 * of the generator and trust nothing the generator or the provider SAYS about an item: a declaration (the construct,
 * the parameters, the target of an answer) is only what gets checked.
 *
 *   1 STRUCTURAL               the item is well-formed
 *   2 PROFILE_COMPLIANCE       it is asked the way the specification decided
 *   3 CONSTRUCT_PRESERVATION   it is an instance of the family's construct and evidence target
 *   4 ANSWER_KEY               every keyed answer, classified
 *   5 MACHINE_RECOMPUTATION    the keyed numbers recomputed from the parameters and the item's own text / stimulus
 *   6 STIMULUS_INTEGRITY       the stimulus is consistent and the item needs it
 *   7 ORIGINALITY              textual similarity to siblings and to earlier pilot material
 *   8 LINEAGE_COMPLETENESS     the lineage is complete and is the specification's
 *
 * ANSWER CLASSES. Every keyed answer is given exactly one:
 *   MACHINE_VERIFIED              the key equals a value recomputed here from parameters that are readable in the item
 *   DETERMINISTIC_RULE_VERIFIED   a rule decided it, but less than that: a verdict derived from the parameters whose
 *                                 wording in the key is not machine-linked, a comparison of stimulus numbers the item
 *                                 formalised itself, the item's own arithmetic, or parameters not readable in the item
 *   HUMAN_REVIEW_REQUIRED         no rule here decides it. This is NOT a verification and is never counted as one.
 *   FAILED                        a rule decided it and the key is wrong, or the declaration is unusable
 *
 * HEURISTICS are named as such, carry an id and a version, and never produce more than WEAK on their own.
 *
 * CONTRACT vs CORRECTNESS. An item that does not follow the response contract (a QUANTITY target with no numeric
 * key, an answer-check expression that does not evaluate, specification vocabulary left in the text, the fixed
 * instruction repeated, two options stating one number) fails STRUCTURAL. Whether its key is RIGHT is a separate
 * question, answered by ANSWER_KEY from whatever the item does state. A FAILED answer says which it is:
 * KEY_CONTRADICTED (a rule recomputed something else) or DECLARATION_UNUSABLE.
 *
 * ABSENCE IS NOT CONTRADICTION. CONSTRUCT_PRESERVATION fails only on positive evidence that the construct was left
 * (another construct, an equation without the declared roots, an equation handed over already factorised, a table
 * off the declared line). Evidence that is merely missing is WEAK.
 *
 * REVISION 2 (after the first replay of the live recording; see QB_R2D_LIVE_MULTI_PROFILE_GENERATION.md, where every
 * change is listed with the item that showed it). No threshold was lowered. False positives were corrected, and
 * defects found only by reading the items became checks.
 *
 * Every result is an AUTOMATED_VALIDATION. None is a review: a person with the qualification still reviews every item.
 */
import type { AdaptationSpecification } from '@/lib/assessment-adaptation/adaptation-specification';
import { isResponseCorrect, normalizeStudentResponse, numericKeyValue, rationalToNumber, type NumericAnswerKey } from './answer-normalization';
import { evaluateExpression, nearlyEqual } from './expression-evaluator';
import type { CandidateStimulus } from './generation-contract';
import { constructVocabularyOf } from './math-construct-registry';
import { DEFAULT_ORIGINALITY_THRESHOLDS, evaluateOriginality, type ComparisonEntry, type OriginalityGateResult, type OriginalityThresholds } from './originality-gate';
import { comparableTextOfSpecificationCandidate, SpecificationCandidateSchema, SpecificationLineageSchema, type AnswerTarget, type SpecificationCandidate } from './specification-candidate';
import { renderStructuredAssets, structuredNumbers, structuredStimulusViolations, type StructuredStimulus } from './stimulus-spec';

export const SPECIFICATION_AUTOMATED_VALIDATION = 'AUTOMATED_VALIDATION' as const;
export const SPECIFICATION_VALIDATORS = ['STRUCTURAL', 'PROFILE_COMPLIANCE', 'CONSTRUCT_PRESERVATION', 'ANSWER_KEY', 'MACHINE_RECOMPUTATION', 'STIMULUS_INTEGRITY', 'ORIGINALITY', 'LINEAGE_COMPLETENESS'] as const;
export type SpecificationValidator = (typeof SPECIFICATION_VALIDATORS)[number];
export const ANSWER_CLASSES = ['MACHINE_VERIFIED', 'DETERMINISTIC_RULE_VERIFIED', 'HUMAN_REVIEW_REQUIRED', 'FAILED'] as const;
export type AnswerClass = (typeof ANSWER_CLASSES)[number];
export const SPECIFICATION_REVIEW_STATUS = 'BLOCKED_NO_QUALIFIED_REVIEWER' as const;
export const SPECIFICATION_VALIDATORS_REVISION = 2 as const;

export interface SpecValidationResult<O extends string = string> {
  validator: SpecificationValidator;
  kind: typeof SPECIFICATION_AUTOMATED_VALIDATION;
  isHumanReview: false;
  outcome: O;
  issues: string[];
  /** Findings that do not decide the outcome: heuristic readings, what was not checked, how a check was made. */
  notes: string[];
}
const result = <O extends string>(validator: SpecificationValidator, outcome: O, issues: string[], notes: string[] = []): SpecValidationResult<O> => ({ validator, kind: SPECIFICATION_AUTOMATED_VALIDATION, isHumanReview: false, outcome, issues: [...issues], notes: [...notes] });

// ---------------------------------------------------------------------------------------------------------------
// reading numbers and text
// ---------------------------------------------------------------------------------------------------------------
/**
 * Every number a text states, by every reading its separators allow. Digits glued to a letter (x2, P1) are not
 * numbers. A fraction a/b contributes a, b and -- unless `fractions` is PARTS_ONLY -- its value.
 */
export function numbersInText(text: string, fractions: 'VALUE_AND_PARTS' | 'PARTS_ONLY' = 'VALUE_AND_PARTS'): number[] {
  const t = text.replace(/[−–]/g, '-').replace(/[²³]/g, ' ').replace(/\^\{?\d+\}?/g, ' ');
  const out: number[] = [];
  const read = (token: string) => { const r = normalizeStudentResponse(token.replace(/\s+/g, '')); if (r.ok) r.readings.forEach((x) => out.push(rationalToNumber(x.value))); };
  for (const m of t.matchAll(/(?<![A-Za-z_\d.,])\d+(?:[.,]\d+)*(?:\s*\/\s*\d+)?/g)) {
    if (!m[0].includes('/')) read(m[0]);
    else { if (fractions === 'VALUE_AND_PARTS') read(m[0]); m[0].split('/').forEach((part) => read(part)); }
  }
  return out;
}
const hasNumber = (pool: readonly number[], v: number): boolean => pool.some((n) => nearlyEqual(n, v) || nearlyEqual(n, Math.abs(v)));
const decimalsOf = (n: number): number => { const s = String(Math.round(n * 1e9) / 1e9); const i = s.indexOf('.'); return i < 0 ? 0 : s.length - i - 1; };
const isTerminatingWithin = (n: number, places: number): boolean => nearlyEqual(n, Math.round(n * 10 ** places) / 10 ** places);
const roundTo = (n: number, places: number): number => Math.round((n + Number.EPSILON * Math.sign(n)) * 10 ** places) / 10 ** places;
/** The one number a short text states ("45 %", "x = 3", "3/4"), or null when it states none or several. */
export function singleNumberOf(text: string): { value: number; decimals: number } | null {
  const t = text.replace(/[−–]/g, '-').replace(/[²³]/g, '');
  const tokens = t.match(/(?<![A-Za-z_\d])-?\d+(?:[.,]\d+)*(?:\s*\/\s*\d+)?/g) ?? [];
  if (tokens.length !== 1) return null;
  const parsed = normalizeStudentResponse(tokens[0].replace(/\s+/g, ''));
  if (!parsed.ok || parsed.readings.length !== 1) return null;
  return { value: rationalToNumber(parsed.readings[0].value), decimals: parsed.readings[0].decimals };
}
const itemText = (c: SpecificationCandidate): string => [c.content.stem, ...(c.content.constructed?.parts.map((p) => p.prompt) ?? [])].join(' \n ');
const stimulusText = (s: CandidateStimulus | null): string => (s ? s.parts.map((p) => p.text).join(' \n ') : '');
const constructIdOf = (s: AdaptationSpecification): string => String((s.invariants.construct as { construct?: unknown } | null)?.construct ?? '');

// ---------------------------------------------------------------------------------------------------------------
// the constructs, recomputed here
// ---------------------------------------------------------------------------------------------------------------
export interface Derived { quantities: Record<string, number | null>; verdicts: Record<string, string | null>; parameterIssues: string[] }

/** A quadratic `A x^2 + B x + C = 0` read from the item's own text. null when the text holds no equation of that written form. */
export function parseQuadraticFromText(text: string): { A: number; B: number; C: number } | null {
  const t = text.replace(/[−–]/g, '-').replace(/x\s*²/g, 'x^2').replace(/x\s*\^\s*\{\s*2\s*\}/g, 'x^2').replace(/[$\\]/g, ' ').replace(/(\d),(\d)/g, '$1.$2');
  const m = /(?<![\p{L}\d.^])([+-]?\s*\d*(?:\.\d+)?)\s*x\^2\s*(?:([+-]\s*\d*(?:\.\d+)?)\s*x(?!\s*\^))?\s*(?:([+-]\s*\d+(?:\.\d+)?))?\s*=\s*0(?!\d|[.,]\d)/u.exec(t);
  if (!m) return null;
  const coefficient = (captured: string | undefined, absent: number): number => { if (captured === undefined) return absent; const raw = captured.replace(/\s+/g, ''); return raw === '' || raw === '+' ? 1 : raw === '-' ? -1 : Number(raw); };
  return { A: coefficient(m[1], 1), B: coefficient(m[2], 0), C: m[3] === undefined ? 0 : Number(m[3].replace(/\s+/g, '')) };
}

const algebraText = (text: string): string => text.replace(/[−–]/g, '-').replace(/[$\\]/g, ' ').replace(/(\d),(\d)/g, '$1.$2');
const signed = (sign: string | undefined, digits: string): number => (sign === '-' ? -1 : 1) * (digits === '' ? 1 : Number(digits));

/** A line `y = m x + b` or `y = b + m x` (any one-letter variables) read from a text. null when the text states none. */
export function parseLinearFromText(text: string): { m: number; b: number } | null {
  const t = algebraText(text);
  const slopeFirst = /(?<![\p{L}\d])\p{L}\s*=\s*([+-])?\s*(\d*(?:\.\d+)?)\s*\p{L}(?![\p{L}\d^])(?:\s*([+-])\s*(\d+(?:\.\d+)?)(?![\d.]*\s*\p{L}))?/u.exec(t);
  if (slopeFirst) return { m: signed(slopeFirst[1], slopeFirst[2]), b: slopeFirst[4] === undefined ? 0 : signed(slopeFirst[3], slopeFirst[4]) };
  const startFirst = /(?<![\p{L}\d])\p{L}\s*=\s*([+-])?\s*(\d+(?:\.\d+)?)\s*([+-])\s*(\d*(?:\.\d+)?)\s*\p{L}(?![\p{L}\d^])/u.exec(t);
  if (startFirst) return { m: signed(startFirst[3], startFirst[4]), b: signed(startFirst[1], startFirst[2]) };
  return null;
}

/** The roots a text states for x: from factors `(a x + b)` set to zero, else from `x = value` statements. Empty when it states none. */
export function rootsStatedInText(text: string): number[] {
  const t = algebraText(text);
  const factors = [...t.matchAll(/\(\s*(\d*(?:\.\d+)?)\s*x\s*([+-])\s*(\d+(?:\.\d+)?)\s*\)/g)].map((m) => -signed(m[2], m[3]) / (m[1] === '' ? 1 : Number(m[1])));
  if (factors.length >= 2) return factors;
  return [...t.matchAll(/(?<![\p{L}\d])x\s*=\s*(-?\s*\d+(?:\.\d+)?(?:\s*\/\s*\d+)?)/gu)].flatMap((m) => { const r = normalizeStudentResponse(m[1].replace(/\s+/g, '')); return r.ok && r.readings.length === 1 ? [rationalToNumber(r.readings[0].value)] : []; });
}

/** Is the equation of a text handed over ALREADY FACTORISED -- a product of linear factors in x set to zero? */
export const statesAFactorisedEquation = (text: string): boolean => /\)\s*\(?[^=]*=\s*0/.test(algebraText(text)) && rootsStatedInText(text.replace(/x\s*=/g, ' ')).length >= 2 && parseQuadraticFromText(text) === null;

/** Parameters that are a point of evaluation, not part of what defines the instance: an item that asks nothing at that point need not state it. */
const EVALUATION_POINT_PARAMETERS: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = { LINEAR_MODEL_FIXED_START_CONSTANT_RATE: { x: ['VALUE_AT_X'], y: ['X_AT_Y'] } };

/** The series or columns of the stimulus that hold a value, as arrays of numbers. */
function seriesHolding(s: StructuredStimulus | null | undefined, v: number): number[][] {
  if (!s) return [];
  const columns = s.tables.flatMap((t) => t.columns.map((_, i) => t.rows.map((r) => r[i]).filter((c): c is number => typeof c === 'number')).filter((col) => col.length > 0));
  return [...columns, ...s.dataSets.flatMap((d) => d.series.map((q) => q.values))].filter((col) => col.some((n) => nearlyEqual(n, v)));
}

/** Everything a construct determines from the declared parameters (and, where the construct reads one, the stimulus). Written independently of the generator. */
export function deriveConstruct(construct: string, P: Readonly<Record<string, number>>, structured: StructuredStimulus | null | undefined): Derived {
  const issues: string[] = [];
  const quantities: Record<string, number | null> = {};
  const verdicts: Record<string, string | null> = {};
  const need = (cond: boolean, issue: string) => { if (!cond) issues.push(issue); };
  switch (construct) {
    case 'DIRECT_PROPORTION_MISSING_VALUE': {
      const x = (P.b * P.c) / P.a;
      need(P.a > 0 && P.b > 0 && P.c > 0, 'PARAMETERS_NOT_POSITIVE');
      need(P.c !== P.a, 'C_EQUALS_A');
      need(isTerminatingWithin(x, 2), 'MISSING_VALUE_NOT_TERMINATING_WITHIN_TWO_PLACES');
      quantities.MISSING_VALUE = x;
      break;
    }
    case 'UNIT_RATE_COMPARISON_OF_TWO_OPTIONS': {
      const r1 = P.q1 / P.p1, r2 = P.q2 / P.p2;
      need(!nearlyEqual(r1, r2), 'UNIT_RATES_EQUAL');
      need(isTerminatingWithin(r1, 3) && isTerminatingWithin(r2, 3), 'UNIT_RATE_NOT_TERMINATING_WITHIN_THREE_PLACES');
      Object.assign(quantities, { UNIT_RATE_1: r1, UNIT_RATE_2: r2, UNIT_RATE_DIFFERENCE: Math.abs(r1 - r2) });
      verdicts.OPTION_WITH_HIGHER_UNIT_RATE = nearlyEqual(r1, r2) ? null : r1 > r2 ? 'OPTION_1' : 'OPTION_2';
      verdicts.OPTION_WITH_LOWER_UNIT_RATE = nearlyEqual(r1, r2) ? null : r1 < r2 ? 'OPTION_1' : 'OPTION_2';
      break;
    }
    case 'LINE_THROUGH_TWO_POINTS': {
      need(P.x1 !== P.x2, 'X1_EQUALS_X2');
      const m = (P.y2 - P.y1) / (P.x2 - P.x1), b = P.y1 - m * P.x1;
      const smallDenominator = (v: number) => [1, 2, 3, 4, 5, 6].some((d) => nearlyEqual(v * d, Math.round(v * d)));
      need(smallDenominator(m) && smallDenominator(b), 'SLOPE_OR_INTERCEPT_DENOMINATOR_ABOVE_SIX');
      Object.assign(quantities, { SLOPE: m, Y_INTERCEPT: b, X_INTERCEPT: nearlyEqual(m, 0) ? null : -b / m });
      break;
    }
    case 'LINEAR_MODEL_FIXED_START_CONSTANT_RATE': {
      need(P.m !== 0, 'RATE_IS_ZERO');
      const y = P.m * P.x + P.b;
      Object.assign(quantities, { VALUE_AT_X: y, RATE: P.m, START_VALUE: P.b, X_AT_Y: P.y === undefined || P.m === 0 ? null : (P.y - P.b) / P.m });
      break;
    }
    case 'QUADRATIC_EQUATION_RATIONAL_ROOTS_BY_FACTORISING': {
      const b = -P.a * (P.r1 + P.r2), c = P.a * P.r1 * P.r2;
      need(nearlyEqual(b, Math.round(b)) && nearlyEqual(c, Math.round(c)), 'COEFFICIENTS_NOT_INTEGERS');
      Object.assign(quantities, { GREATER_ROOT: Math.max(P.r1, P.r2), LESSER_ROOT: Math.min(P.r1, P.r2), SUM_OF_ROOTS: P.r1 + P.r2, PRODUCT_OF_ROOTS: P.r1 * P.r2, COEFFICIENT_B: b, COEFFICIENT_C: c });
      break;
    }
    case 'QUADRATIC_MODEL_VERTEX_OPTIMUM': {
      const xv = (P.q * P.r - P.p * P.s) / (2 * P.q * P.s);
      const f1 = P.p + P.q * xv, f2 = P.r - P.s * xv;
      need(isTerminatingWithin(xv, 1), 'OPTIMUM_MEASURE_NOT_TERMINATING_WITHIN_ONE_PLACE');
      need(f1 > 0 && f2 > 0, 'A_LINEAR_FACTOR_IS_NOT_POSITIVE_AT_THE_OPTIMUM');
      Object.assign(quantities, { MEASURE_AT_OPTIMUM: xv, OPTIMAL_VALUE: f1 * f2, FIRST_FACTOR_AT_OPTIMUM: f1, SECOND_FACTOR_AT_OPTIMUM: f2 });
      break;
    }
    case 'CLASSICAL_PROBABILITY_SINGLE_DRAW': {
      need(P.k > 0 && P.k < P.n, 'K_NOT_STRICTLY_BETWEEN_ZERO_AND_N');
      Object.assign(quantities, { PROBABILITY: P.k / P.n, COMPLEMENT_PROBABILITY: 1 - P.k / P.n });
      break;
    }
    case 'COMPARISON_OF_TWO_CLASSICAL_PROBABILITIES': {
      const p1 = P.k1 / P.n1, p2 = P.k2 / P.n2;
      need(P.k1 < P.n1 && P.k2 < P.n2, 'K_NOT_BELOW_N');
      need(P.n1 !== P.n2, 'N1_EQUALS_N2');
      need(Math.abs(p1 - p2) >= 0.02 - 1e-12, 'PROBABILITIES_DIFFER_BY_LESS_THAN_0_02');
      Object.assign(quantities, { PROBABILITY_1: p1, PROBABILITY_2: p2, PROBABILITY_DIFFERENCE: Math.abs(p1 - p2) });
      verdicts.OPTION_WITH_HIGHER_PROBABILITY = nearlyEqual(p1, p2) ? null : p1 > p2 ? 'OPTION_1' : 'OPTION_2';
      break;
    }
    case 'RELATIVE_CHANGE_OR_SHARE_FROM_TABULATED_VALUES': {
      need(P.vi !== 0 && P.vi !== P.vj, 'VI_IS_ZERO_OR_EQUALS_VJ');
      const holders = seriesHolding(structured, P.vi);
      Object.assign(quantities, { RELATIVE_CHANGE_PERCENT: (100 * (P.vj - P.vi)) / P.vi, ABSOLUTE_CHANGE: P.vj - P.vi, SHARE_PERCENT: holders.length === 1 ? (100 * P.vi) / holders[0].reduce((a, n) => a + n, 0) : null });
      break;
    }
    case 'CLAIM_EVALUATION_AGAINST_A_DATA_DISPLAY':
      // the verdict depends on the statement, which no rule here reads
      verdicts.CLAIM_VERDICT = null;
      break;
    default:
      issues.push('CONSTRUCT_NOT_IN_VOCABULARY');
  }
  return { quantities, verdicts, parameterIssues: issues };
}

interface Range { symbol: string; min: number; max: number; step: number | null }
const rangesOf = (s: AdaptationSpecification): Range[] => (((s.parameterization as { parameterRanges?: Range[] } | null)?.parameterRanges) ?? []).map((r) => ({ symbol: r.symbol, min: r.min, max: r.max, step: r.step ?? null }));

/** Are the declared parameters the construct's, inside the specification's ranges and steps? */
export function parameterIssues(c: SpecificationCandidate, s: AdaptationSpecification): string[] {
  const vocabulary = constructVocabularyOf(constructIdOf(s));
  if (!vocabulary) return ['CONSTRUCT_NOT_IN_VOCABULARY'];
  const P = c.content.declaredModel.parameters;
  const out: string[] = [];
  for (const symbol of vocabulary.parameters) if (P[symbol] === undefined) out.push(`PARAMETER_MISSING:${symbol}`);
  for (const symbol of Object.keys(P)) if (!vocabulary.parameters.includes(symbol) && !vocabulary.optionalParameters.includes(symbol)) out.push(`PARAMETER_NOT_OF_THE_CONSTRUCT:${symbol}`);
  for (const r of rangesOf(s)) {
    const v = P[r.symbol];
    if (v === undefined) continue;
    if (v < r.min || v > r.max) out.push(`PARAMETER_OUT_OF_RANGE:${r.symbol}=${v} not in [${r.min}, ${r.max}]`);
    else if (r.step !== null && !nearlyEqual((v - r.min) / r.step, Math.round((v - r.min) / r.step))) out.push(`PARAMETER_OFF_STEP:${r.symbol}=${v} step ${r.step}`);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// 1 STRUCTURAL
// ---------------------------------------------------------------------------------------------------------------
/** A heuristic of item writing: a key that is visibly unlike the other options gives itself away. A note, never a failure. */
export const KEY_STANDS_OUT_HEURISTIC = { id: 'studyus-key-stands-out-heuristic', version: '1', rule: 'The keyed option is at least 40% longer than every other option, or is the only option that shows a calculation (contains "=") while at least two others do not.' } as const;
const SPECIFICATION_CODE_WORDS = ['FORMULATE', 'SOLVE', 'INTERPRET', 'COMPUTE', 'EVALUATE', 'REPRESENT', 'SUPPORTED', 'CONTRADICTED', 'NOT_DECIDABLE', 'OPTION_1', 'OPTION_2'] as const;
const normalizedSentence = (t: string): string => t.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
/** Everything a learner would read: stem, part prompts, options. Not the mark scheme, not the rationale. */
const learnerText = (c: SpecificationCandidate): string => [c.content.stem, ...(c.content.constructed?.parts.map((p) => p.prompt) ?? []), ...(c.content.selected?.options.map((o) => o.text) ?? [])].join(' \n ');

export function validateStructure(c: SpecificationCandidate, stimulus: CandidateStimulus | null, s: AdaptationSpecification | null = null): SpecValidationResult<'PASS' | 'FAIL'> {
  const issues: string[] = [];
  const notes: string[] = [];
  const parsed = SpecificationCandidateSchema.safeParse(c);
  if (!parsed.success) issues.push(...parsed.error.issues.slice(0, 5).map((i) => `SCHEMA:${i.path.join('.')}:${i.message}`));
  const x = c.content;
  if (x.stem.trim().length < 20) issues.push('STEM_TOO_SHORT');
  // the fixed instruction is kept apart from the item: compared without case and punctuation, in the stem and in every part
  if (c.instruction && normalizedSentence(itemText(c)).includes(normalizedSentence(c.instruction))) issues.push('ITEM_REPEATS_FIXED_INSTRUCTION');
  if (x.selected) {
    const texts = x.selected.options.map((o) => o.text.trim().toLowerCase());
    if (new Set(texts).size !== texts.length) issues.push('OPTION_TEXTS_NOT_DISTINCT');
    if (new Set(x.selected.options.map((o) => o.id)).size !== x.selected.options.length) issues.push('OPTION_IDS_NOT_DISTINCT');
    if (!x.selected.options.some((o) => o.id === x.selected!.answerKey)) issues.push('KEY_IS_NOT_AN_OPTION');
    if (x.selected.options.length < 3) issues.push('TOO_FEW_OPTIONS');
    if (c.marks !== 1) issues.push('CLOSED_ITEM_MARKS_NOT_ONE');
    // two options that state the same single number are one option written twice
    const numeric = x.selected.options.map((o) => ({ id: o.id, n: singleNumberOf(o.text) })).filter((o): o is { id: string; n: { value: number; decimals: number } } => o.n !== null);
    for (let a = 0; a < numeric.length; a += 1) for (let b = a + 1; b < numeric.length; b += 1) if (nearlyEqual(numeric[a].n.value, numeric[b].n.value)) issues.push(`OPTIONS_STATE_THE_SAME_NUMBER:${numeric[a].id},${numeric[b].id}`);
    const key = x.selected.options.find((o) => o.id === x.selected!.answerKey);
    const others = x.selected.options.filter((o) => o.id !== x.selected!.answerKey);
    if (key && others.length > 0) {
      const longer = others.every((o) => key.text.length >= 1.4 * o.text.length);
      const onlyCalculation = key.text.includes('=') && others.filter((o) => !o.text.includes('=')).length >= 2;
      notes.push(`HEURISTIC ${KEY_STANDS_OUT_HEURISTIC.id}@${KEY_STANDS_OUT_HEURISTIC.version}: ${longer || onlyCalculation ? 'KEY_STANDS_OUT' : 'KEY_DOES_NOT_STAND_OUT'}`);
    }
  }
  if (x.numeric && c.marks !== 1) issues.push('CLOSED_ITEM_MARKS_NOT_ONE');
  if (x.constructed) {
    if (c.marks !== x.constructed.totalMarks) issues.push('MARKS_ARE_NOT_THE_PARTS_TOTAL');
    if (x.constructed.parts.some((p) => p.finalAnswer.trim().length === 0)) issues.push('PART_WITHOUT_FINAL_ANSWER');
    // the response contract: an answer declared to be a quantity carries its numeric key
    for (const part of x.constructed.parts) if (part.target.kind === 'QUANTITY' && part.numericKey === null) issues.push(`PART_WITH_A_QUANTITY_TARGET_HAS_NO_NUMERIC_KEY:${part.label}`);
  }
  // the response contract: a declared arithmetic expression is one the evaluator can evaluate
  const checks = x.selected ? [['item', x.selected.answerCheck] as const] : x.numeric ? [['item', x.numeric.answerCheck] as const] : x.constructed!.parts.map((part) => [part.label, part.answerCheck] as const);
  for (const [label, check] of checks) if (check.kind === 'ARITHMETIC_EXPRESSION' && tryEvaluate(check.expression) === null) issues.push(`ANSWER_CHECK_EXPRESSION_DOES_NOT_EVALUATE:${label}`);
  // the specification's own vocabulary does not belong in what a learner reads
  const shown = learnerText(c);
  const symbols = s ? (constructVocabularyOf(constructIdOf(s))?.parameters ?? []).filter((symbol) => symbol.length >= 2) : [];
  const leaked = [...SPECIFICATION_CODE_WORDS.filter((w) => new RegExp(`(?<![\\p{L}_])${w}(?![\\p{L}_])`, 'u').test(shown)), ...symbols.filter((symbol) => new RegExp(`(?<![\\p{L}\\d_])${symbol}(?![\\p{L}\\d_])`, 'u').test(shown))];
  if (leaked.length > 0) issues.push(`SPECIFICATION_VOCABULARY_IN_ITEM_TEXT:${leaked.join(',')}`);
  if ((c.stimulusKey === null) !== (stimulus === null)) issues.push('STIMULUS_KEY_AND_STIMULUS_DISAGREE');
  if (x.usesStimulusValues !== null && stimulus === null) issues.push('USES_STIMULUS_VALUES_WITHOUT_A_STIMULUS');
  return result('STRUCTURAL', issues.length === 0 ? 'PASS' : 'FAIL', issues, notes);
}

// ---------------------------------------------------------------------------------------------------------------
// 2 PROFILE_COMPLIANCE
// ---------------------------------------------------------------------------------------------------------------
/** The deterministic rule read for "no calculator". It bounds the SIZE and FORM of numbers; it is not a judgement of the arithmetic's effort. */
export const NO_CALCULATOR_NUMBER_RULE = {
  id: 'studyus-no-calculator-number-rule', version: '2', authority: 'QB_R2D_LANE_RULE',
  rule: 'Applies when the specification\'s calculator policy is NONE. Every number stated in the stem, options, part prompts and stimulus is an integer of magnitude at most 10000 or a decimal of at most two places and magnitude at most 1000; a fraction a/b is read as the two integers it is written with, never as its decimal expansion. Every keyed number is an integer, a decimal that terminates within three places, or a fraction with a denominator of at most 100.',
  revision: 'Version 1 read a written fraction (1/7, or a ratio 12 / 84 in a stem) as its decimal expansion and failed it for having more than two places. That was a false positive of the rule\'s reader, not a relaxation of the rule.',
} as const;
export const LANGUAGE_HEURISTIC = { id: 'studyus-stopword-language-heuristic', version: '1', rule: 'Counts Spanish and English function words in the stem and part prompts; the language is the one with more. A tie is UNKNOWN.' } as const;
const STOPWORDS: Record<string, readonly string[]> = {
  es: ['el', 'la', 'los', 'las', 'de', 'del', 'que', 'en', 'un', 'una', 'por', 'para', 'con', 'se', 'es', 'cuál', 'cuánto', 'cuántos', 'qué', 'su', 'cada', 'si', 'más', 'y'],
  en: ['the', 'of', 'and', 'is', 'a', 'in', 'to', 'for', 'that', 'what', 'which', 'how', 'each', 'its', 'are', 'at', 'find', 'with', 'if', 'when'],
};
export function detectLanguage(text: string): 'es' | 'en' | 'UNKNOWN' {
  const words = text.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean);
  const count = (l: string) => words.filter((w) => STOPWORDS[l].includes(w)).length;
  const es = count('es'), en = count('en');
  return es === en ? 'UNKNOWN' : es > en ? 'es' : 'en';
}
const JUSTIFICATION_CUES = /justif|explain|explica|argument|show that|demuestra|give a reason|da una razón|razona|why|por qué/i;

function keyedNumbers(c: SpecificationCandidate): Array<{ label: string; key: NumericAnswerKey | null; value: number | null; writtenDenominator: number | null }> {
  const x = c.content;
  if (x.numeric) return [{ label: 'item', key: x.numeric.numericKey, value: rationalToNumber(numericKeyValue(x.numeric.numericKey).value), writtenDenominator: null }];
  if (x.selected) { const o = x.selected.options.find((q) => q.id === x.selected!.answerKey); const n = o ? singleNumberOf(o.text) : null; const d = o ? /\/\s*(\d+)/.exec(o.text) : null; return [{ label: 'item', key: null, value: n ? n.value : null, writtenDenominator: d ? Number(d[1]) : null }]; }
  return x.constructed!.parts.map((p) => ({ label: p.label, key: p.numericKey, value: p.numericKey ? rationalToNumber(numericKeyValue(p.numericKey).value) : null, writtenDenominator: null }));
}

export function validateProfileCompliance(c: SpecificationCandidate, s: AdaptationSpecification, stimulus: CandidateStimulus | null): SpecValidationResult<'PASS' | 'FAIL'> & { specificationLevelIssues: string[] } {
  const issues: string[] = [];
  const notes: string[] = [];
  const specificationLevelIssues: string[] = [];
  const v = s.variable;
  const x = c.content;
  const closed = x.selected !== null || x.numeric !== null;
  // response format
  const wantedMember = v.responseFormat.format === 'SELECTED_RESPONSE' ? 'selected' : v.responseFormat.format === 'NUMERIC_ENTRY' ? 'numeric' : v.responseFormat.format === 'SHORT_RESPONSE' || v.responseFormat.format === 'EXTENDED_RESPONSE' ? 'constructed' : null;
  if (wantedMember === null || x[wantedMember] === null) issues.push(`RESPONSE_FORMAT_IS_NOT_THE_SPECIFICATIONS:${v.responseFormat.format}`);
  if (c.responseFormat !== v.responseFormat.format) issues.push('RESTATED_FORMAT_IS_NOT_THE_SPECIFICATIONS');
  if (x.selected && x.selected.options.length !== 4) issues.push('OPTION_COUNT_IS_NOT_THE_TEMPLATES_FOUR');
  // marks and rubric
  if (v.markStructure === 'ONE_MARK_PER_ITEM' && (!closed || c.marks !== 1)) issues.push('MARK_STRUCTURE_ONE_MARK_PER_ITEM_NOT_MET');
  if (v.markStructure === 'MULTI_MARK_PARTS') {
    // a closed item cannot carry parts with marks: this is a property of the SPECIFICATION (format and mark structure decided apart), reported as such
    if (closed) specificationLevelIssues.push('MARK_STRUCTURE_MULTI_MARK_PARTS_NOT_REALISABLE_BY_A_CLOSED_FORMAT');
    else if (!x.constructed || x.constructed.totalMarks < 2) issues.push('MARK_STRUCTURE_MULTI_MARK_PARTS_NOT_MET');
  }
  if (v.rubricStyle === 'CODED_CREDIT_LEVELS') {
    if (!x.credit) issues.push('CODED_CREDIT_LEVELS_MISSING');
    else if (!x.credit.some((l) => l.code === 'FULL_CREDIT') || !x.credit.some((l) => l.code === 'NO_CREDIT') || new Set(x.credit.map((l) => l.code)).size !== x.credit.length) issues.push('CODED_CREDIT_LEVELS_INCOMPLETE');
  } else if (x.credit) issues.push('CODED_CREDIT_LEVELS_NOT_ASKED_FOR');
  if (v.rubricStyle === 'METHOD_AND_ACCURACY') {
    if (!x.constructed) issues.push('RUBRIC_METHOD_AND_ACCURACY_NEEDS_A_MARK_SCHEME');
    else {
      const points = x.constructed.parts.flatMap((p) => p.markScheme);
      if (!points.some((m) => m.kind === 'ACCURACY')) issues.push('RUBRIC_HAS_NO_ACCURACY_POINT');
      if (x.constructed.parts.some((p) => p.marks >= 2 && !p.markScheme.some((m) => m.kind === 'METHOD' || m.kind === 'REASONING'))) issues.push('RUBRIC_PART_OF_TWO_MARKS_HAS_NO_METHOD_POINT');
      if (points.some((m) => m.kind === 'CREDIT')) issues.push('RUBRIC_USES_CREDIT_POINTS');
    }
  }
  if (v.rubricStyle === 'KEY_ONLY' && !closed) issues.push('RUBRIC_KEY_ONLY_NEEDS_A_CLOSED_FORMAT');
  // command term
  if (v.commandTerm !== null) {
    const term = v.commandTerm.trim().toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    if (!new RegExp(`(?<![\\p{L}])${term}(?![\\p{L}])`, 'iu').test(itemText(c))) issues.push(`COMMAND_TERM_ABSENT:${v.commandTerm}`);
  }
  // reasoning depth
  if (v.reasoningDepth.depth === 'ANSWER_ONLY' && !closed) issues.push('ANSWER_ONLY_NEEDS_A_CLOSED_FORMAT');
  if (v.reasoningDepth.workingShown && (!x.constructed || !x.constructed.parts.some((p) => p.markScheme.some((m) => m.kind === 'METHOD')))) issues.push('WORKING_SHOWN_BUT_NO_METHOD_POINT');
  if (v.reasoningDepth.justificationRequired) {
    if (!x.constructed || !x.constructed.parts.some((p) => p.markScheme.some((m) => m.kind === 'REASONING'))) issues.push('JUSTIFICATION_REQUIRED_BUT_NO_REASONING_POINT');
    notes.push(`HEURISTIC justification cue in the prompts: ${JUSTIFICATION_CUES.test(itemText(c)) ? 'FOUND' : 'NOT_FOUND'}`);
  }
  // stimulus
  if (v.stimulus.mode === 'NONE' && stimulus !== null) issues.push('STIMULUS_GIVEN_BUT_NOT_IN_SPECIFICATION');
  if (v.stimulus.mode !== 'NONE') {
    if (stimulus === null) issues.push('STIMULUS_REQUIRED_BY_SPECIFICATION_MISSING');
    else if (!v.stimulus.kinds.includes(stimulus.kind)) issues.push(`STIMULUS_KIND_NOT_IN_SPECIFICATION:${stimulus.kind}`);
  }
  // context: the declaration is compared; whether the situation really is of that kind is a reviewer's reading
  if (x.context.kind !== v.context.kind) issues.push(`DECLARED_CONTEXT_IS_NOT_THE_SPECIFICATIONS:${x.context.kind}/${v.context.kind}`);
  const words = itemText(c).split(/[^\p{L}]+/u).filter((w) => w.length >= 4).length;
  notes.push(`HEURISTIC context situation (words of four letters or more: ${words}): ${v.context.kind === 'ABSTRACT' ? (words <= 45 ? 'CONSISTENT_WITH_ABSTRACT' : 'LONG_FOR_ABSTRACT') : words >= 12 ? 'CONSISTENT_WITH_A_SITUATION' : 'SHORT_FOR_A_SITUATION'}`);
  notes.push('NOT_CHECKED_AUTOMATICALLY: authenticity of the context, transfer expectation, the system competency codes, the time budget, the difficulty band');
  // language
  const language = detectLanguage(itemText(c));
  if (c.language !== v.language) issues.push('RESTATED_LANGUAGE_IS_NOT_THE_SPECIFICATIONS');
  if (language !== 'UNKNOWN' && language !== v.language) issues.push(`LANGUAGE_HEURISTIC_READS_ANOTHER_LANGUAGE:${language}`);
  notes.push(`HEURISTIC ${LANGUAGE_HEURISTIC.id}@${LANGUAGE_HEURISTIC.version}: ${language}`);
  // distractors come from the specification's misconception models
  if (x.selected && v.distractors) {
    for (const [id, d] of Object.entries(x.selected.distractors)) if (!v.distractors.misconceptionModelIds.includes(d.misconceptionModelId)) issues.push(`DISTRACTOR_NOT_FROM_A_SPECIFIED_MISCONCEPTION_MODEL:${id}=${d.misconceptionModelId}`);
  }
  // parameters inside the family's ranges, and the construct's own constraints
  issues.push(...parameterIssues(c, s));
  if (!parameterIssues(c, s).some((i) => i.startsWith('PARAMETER_MISSING') || i === 'CONSTRUCT_NOT_IN_VOCABULARY')) issues.push(...deriveConstruct(constructIdOf(s), c.content.declaredModel.parameters, stimulus?.structured).parameterIssues.map((i) => `PARAMETER_CONSTRAINT:${i}`));
  // the display family states its values in the stimulus: read them there
  if (constructIdOf(s) === 'CLAIM_EVALUATION_AGAINST_A_DATA_DISPLAY' && stimulus?.structured) {
    const valueRange = rangesOf(s).find((r) => r.symbol === 'value');
    if (valueRange && structuredNumbers(stimulus.structured).some((n) => n < valueRange.min || n > valueRange.max || (valueRange.step !== null && !Number.isInteger(n)))) issues.push('DISPLAY_VALUE_OUT_OF_RANGE');
  }
  // calculator policy
  if (v.toolPolicy.calculator === 'NONE') {
    const stated = [...numbersInText(itemText(c), 'PARTS_ONLY'), ...(x.selected ? x.selected.options.flatMap((o) => numbersInText(o.text, 'PARTS_ONLY')) : []), ...structuredNumbers(stimulus?.structured)];
    const tooBig = stated.filter((n) => (Number.isInteger(n) ? Math.abs(n) > 10000 : Math.abs(n) > 1000 || decimalsOf(n) > 2));
    if (tooBig.length > 0) issues.push(`NO_CALCULATOR_RULE_STATED_NUMBER:${[...new Set(tooBig)].slice(0, 4).join(',')}`);
    for (const k of keyedNumbers(c)) {
      if (k.value === null) continue;
      const fractionKey = k.key?.value.includes('/') ? Number(k.key.value.split('/')[1]) : k.writtenDenominator;
      if (!(isTerminatingWithin(k.value, 3) || (fractionKey !== null && fractionKey <= 100))) issues.push(`NO_CALCULATOR_RULE_KEYED_NUMBER:${k.label}=${k.value}`);
    }
    notes.push(`RULE ${NO_CALCULATOR_NUMBER_RULE.id}@${NO_CALCULATOR_NUMBER_RULE.version} applied`);
  } else notes.push(`calculator policy ${v.toolPolicy.calculator}: the no-calculator rule does not apply; whether the item NEEDS the tool is not checked`);
  return { ...result('PROFILE_COMPLIANCE', issues.length === 0 && specificationLevelIssues.length === 0 ? 'PASS' : 'FAIL', [...issues, ...specificationLevelIssues.map((i) => `SPECIFICATION_LEVEL:${i}`)], notes), specificationLevelIssues };
}

// ---------------------------------------------------------------------------------------------------------------
// 3 CONSTRUCT_PRESERVATION
// ---------------------------------------------------------------------------------------------------------------
export const EVIDENCE_ACTION_CUE_HEURISTIC = {
  id: 'studyus-evidence-action-cue-heuristic', version: '2',
  rule: 'Per action of the evidence target: SOLVE / COMPUTE are evidenced by a keyed QUANTITY or a keyed VERDICT of the construct\'s vocabulary (a verdict is derived from the solved quantities). FORMULATE needs a situation (a context that is not ABSTRACT) the model must be built from. INTERPRET and EVALUATE need a cue in the stem or a part prompt, or a keyed VERDICT / COMPARISON. REPRESENT needs an equation or expression asked for, or a stimulus. Missing evidence is WEAK, never FAIL: absence is not contradiction, and wording is a reviewer\'s reading.',
} as const;
const CUES: Record<string, RegExp> = {
  INTERPRET: /interpret|meaning|\bmeans?\b|represent|in (this|the) context|what does|significa|representa|interpreta|en (este|el) contexto|qué indica|se concluye|conclu/i,
  EVALUATE: /claim|statement|justif|is (it|this|she|he) (correct|right)|decide|which .*(better|more likely|greater)|afirma|conviene|correct[ao]|decid|cuál .*(mejor|más probable|mayor|conviene)|support|contradic|sustenta/i,
  REPRESENT: /equation|expression|write|graph|sketch|ecuación|expresión|escribe|gráfic/i,
  FORMULATE: /model|express|write (down )?an? (equation|expression)|in terms of|formula|relation|equation|plantea|modelo|expresa|en términos de|relación|ecuación/i,
};
/** A linear model whose stimulus holds a table of at least two rows, every one of them on the declared line: the table states the rate and the start, though neither is written as a number. */
function lineShownByATable(construct: string, P: Readonly<Record<string, number>>, structured: StructuredStimulus | null | undefined): boolean {
  if (construct !== 'LINEAR_MODEL_FIXED_START_CONSTANT_RATE' || !structured) return false;
  return structured.tables.some((t) => {
    const numeric = t.columns.map((col, i) => (col.type === 'NUMBER' ? i : -1)).filter((i) => i >= 0);
    return numeric.length === 2 && t.rows.length >= 2 && new Set(t.rows.map((r) => r[numeric[0]])).size >= 2 && t.rows.every((r) => nearlyEqual(r[numeric[1]] as number, P.b + P.m * (r[numeric[0]] as number)));
  });
}
/** The declared parameters an item must make readable: all of them, except a point of evaluation that no keyed quantity uses. */
function definingParameters(construct: string, P: Readonly<Record<string, number>>, targets: readonly AnswerTarget[], structured: StructuredStimulus | null | undefined = null): Array<[string, number]> {
  const points = EVALUATION_POINT_PARAMETERS[construct] ?? {};
  const shownByTable = lineShownByATable(construct, P, structured);
  return Object.entries(P).filter(([symbol]) => (!(symbol in points) || targets.some((t) => t.kind === 'QUANTITY' && points[symbol].includes(t.quantity))) && !(shownByTable && (symbol === 'm' || symbol === 'b')));
}
const targetsOf = (c: SpecificationCandidate): AnswerTarget[] => (c.content.selected ? [c.content.selected.target] : c.content.numeric ? [c.content.numeric.target] : c.content.constructed!.parts.map((p) => p.target));

export function validateConstructPreservation(c: SpecificationCandidate, s: AdaptationSpecification, stimulus: CandidateStimulus | null): SpecValidationResult<'PASS' | 'WEAK' | 'FAIL'> & { deterministic: string[]; heuristic: string[] } {
  const issues: string[] = [];
  const weak: string[] = [];
  const deterministic: string[] = [];
  const heuristic: string[] = [];
  const construct = constructIdOf(s);
  const vocabulary = constructVocabularyOf(construct);
  const P = c.content.declaredModel.parameters;
  // identity: concept, construct, invariant hash
  if (c.primaryConceptStableId !== s.primaryConcept.stableId || !s.invariants.primaryConceptStableIds.includes(c.primaryConceptStableId)) issues.push('PRIMARY_CONCEPT_IS_NOT_THE_SPECIFICATIONS');
  if (c.content.declaredModel.construct !== construct) issues.push(`DECLARED_CONSTRUCT_IS_NOT_THE_FAMILYS:${c.content.declaredModel.construct}`);
  if (c.lineage.adaptationSpecification.invariantHash !== s.invariantHash) issues.push('INVARIANT_HASH_IS_NOT_THE_SPECIFICATIONS');
  deterministic.push('concept id, construct id and invariant hash compared with the specification');
  // every target is of the construct's vocabulary
  for (const t of targetsOf(c)) {
    if (t.kind === 'QUANTITY' && !vocabulary?.quantities.some((q) => q.code === t.quantity)) issues.push(`TARGET_QUANTITY_NOT_OF_THE_CONSTRUCT:${t.quantity}`);
    if (t.kind === 'VERDICT' && !vocabulary?.verdicts.some((q) => q.code === t.verdict && q.values.includes(t.value))) issues.push(`TARGET_VERDICT_NOT_OF_THE_CONSTRUCT:${t.verdict}=${t.value}`);
  }
  // the declared model is READABLE in the item
  const pool = [...numbersInText(itemText(c)), ...numbersInText(stimulusText(stimulus)), ...structuredNumbers(stimulus?.structured)];
  if (vocabulary && !parameterIssues(c, s).some((i) => i.startsWith('PARAMETER_MISSING'))) {
    if (vocabulary.parametersStatedIn === 'STEM_AS_COEFFICIENTS') {
      const eq = parseQuadraticFromText(itemText(c));
      // the family is "solved THROUGH the factorised form": an equation handed over already factorised leaves nothing to factorise
      if (!eq && statesAFactorisedEquation(itemText(c))) { issues.push('EQUATION_IS_GIVEN_ALREADY_FACTORISED'); deterministic.push('the stem states a product of linear factors set to zero'); }
      else if (!eq) weak.push('EQUATION_NOT_READABLE_IN_THE_WRITTEN_FORM_A_X2_B_X_C_EQUALS_0');
      else {
        const at = (r: number) => eq.A * r * r + eq.B * r + eq.C;
        if (!nearlyEqual(eq.A, P.a) || !nearlyEqual(at(P.r1), 0) || !nearlyEqual(at(P.r2), 0)) issues.push(`STATED_EQUATION_DOES_NOT_HAVE_THE_DECLARED_ROOTS:${eq.A},${eq.B},${eq.C}`);
        deterministic.push(`equation read from the stem (${eq.A}, ${eq.B}, ${eq.C}); declared roots substituted`);
      }
    } else if (vocabulary.parametersStatedIn === 'STIMULUS') {
      const inStimulus = structuredNumbers(stimulus?.structured);
      for (const symbol of vocabulary.parameters) if (!inStimulus.some((n) => nearlyEqual(n, P[symbol]))) issues.push(`PARAMETER_NOT_A_VALUE_OF_THE_STIMULUS:${symbol}=${P[symbol]}`);
      if (inStimulus.length < 4) issues.push('REPRESENTATION_HOLDS_FEWER_THAN_FOUR_VALUES');
      deterministic.push('declared values looked up in the structured stimulus');
    } else if (vocabulary.parametersStatedIn === 'STIMULUS_SHAPE') {
      const st = stimulus?.structured;
      const categories = st ? (st.tables[0]?.rows.length ?? st.dataSets[0]?.categories?.length ?? st.dataSets[0]?.series[0]?.values.length ?? null) : null;
      if (categories === null || categories !== P.categories) issues.push(`DECLARED_CATEGORY_COUNT_IS_NOT_THE_DISPLAYS:${P.categories}/${categories}`);
      deterministic.push('category count read from the structured stimulus');
    } else {
      // a parameter equal to 1 is routinely unwritten ("per unit"), so its absence proves nothing
      const unstated = definingParameters(construct, P, targetsOf(c), stimulus?.structured).filter(([, value]) => !nearlyEqual(Math.abs(value), 1) && !hasNumber(pool, value)).map(([symbol, value]) => `${symbol}=${value}`);
      if (unstated.length > 0) weak.push(`HEURISTIC parameters not readable as numbers in the item: ${unstated.join(', ')}`);
      heuristic.push('parameters-stated: every declared parameter value (except 1, and except a point of evaluation no keyed quantity uses) is looked for among the numbers of the stem, prompts and stimulus');
    }
  }
  // a linear model shown as a table must be the declared line
  if (construct === 'LINEAR_MODEL_FIXED_START_CONSTANT_RATE' && stimulus?.structured) {
    for (const t of stimulus.structured.tables) {
      const numeric = t.columns.map((col, i) => (col.type === 'NUMBER' ? i : -1)).filter((i) => i >= 0);
      if (numeric.length === 2) {
        const off = t.rows.filter((r) => !nearlyEqual(r[numeric[1]] as number, P.b + P.m * (r[numeric[0]] as number)));
        if (off.length > 0) issues.push(`STIMULUS_TABLE_IS_NOT_THE_DECLARED_LINE:${t.tableKey}:${off.length} of ${t.rows.length} rows`);
        deterministic.push(`table ${t.tableKey}: every row checked against y = m x + b`);
      }
    }
  }
  // evidence actions
  const targets = targetsOf(c);
  const text = itemText(c);
  for (const action of s.invariants.evidenceTarget.actions) {
    if (action === 'SOLVE' || action === 'COMPUTE') {
      if (!targets.some((t) => t.kind === 'QUANTITY' || (t.kind === 'VERDICT' && (vocabulary?.verdicts.some((q) => q.code === t.verdict) ?? false)))) weak.push(`HEURISTIC ${action}: no keyed quantity or vocabulary verdict, so that the item was ${action === 'SOLVE' ? 'solved' : 'computed'} is not machine-evidenced`);
    } else if (action === 'FORMULATE') {
      if (c.content.context.kind === 'ABSTRACT') weak.push('HEURISTIC FORMULATE: the declared context is ABSTRACT, so nothing is formulated from a situation');
      else if (c.content.constructed && !CUES.FORMULATE.test(text) && !c.content.constructed.parts.some((p) => p.markScheme.some((m) => /model|equation|expression|relation|set up|forms? |ecuación|expresión|modelo|plantea|relación|formula/i.test(m.criterion)))) weak.push('HEURISTIC FORMULATE: no part or mark point names the model to be built');
    } else if (action === 'INTERPRET' || action === 'EVALUATE') {
      const keyed = targets.some((t) => t.kind === 'VERDICT' || t.kind === 'COMPARISON');
      if (!keyed && !CUES[action].test(text)) weak.push(`HEURISTIC ${action}: no cue in the prompts and no keyed verdict`);
    } else if (action === 'REPRESENT') {
      if (!CUES.REPRESENT.test(text) && stimulus === null) weak.push('HEURISTIC REPRESENT: no equation, expression or representation is asked for');
    }
  }
  heuristic.push(`${EVIDENCE_ACTION_CUE_HEURISTIC.id}@${EVIDENCE_ACTION_CUE_HEURISTIC.version}`);
  return { ...result('CONSTRUCT_PRESERVATION', issues.length > 0 ? 'FAIL' : weak.length > 0 ? 'WEAK' : 'PASS', issues, weak), deterministic, heuristic };
}

// ---------------------------------------------------------------------------------------------------------------
// 4 ANSWER_KEY and 5 MACHINE_RECOMPUTATION
// ---------------------------------------------------------------------------------------------------------------
export type RecomputationBasis = 'ITEM_TEXT_EQUATION' | 'DECLARED_PARAMETERS_READABLE_IN_ITEM' | 'DECLARED_PARAMETERS_NOT_READABLE_IN_ITEM' | 'STIMULUS_NUMBERS' | 'ITEM_NUMBERS' | 'KEYED_TEXT_STRUCTURE' | 'DECLARED_ARITHMETIC_ONLY' | 'NONE';
export type AnswerFailureKind = 'KEY_CONTRADICTED' | 'DECLARATION_UNUSABLE';
export interface AnswerUnitVerdict { label: string; targetKind: AnswerTarget['kind']; class: AnswerClass; failureKind: AnswerFailureKind | null; basis: RecomputationBasis; recomputed: number | string | null; keyed: number | string | null; issues: string[]; notes: string[] }

const COMPARISON_CONSTANTS = [1, 2, 100] as const;
const compare = (a: number, op: string, b: number): boolean => (op === '>' ? a > b : op === '<' ? a < b : op === '>=' ? a >= b || nearlyEqual(a, b) : op === '<=' ? a <= b || nearlyEqual(a, b) : nearlyEqual(a, b));
const tryEvaluate = (expression: string): number | null => { try { return evaluateExpression(expression); } catch { return null; } };
/** Issues that say a rule recomputed something OTHER than the key. Every other issue says the declaration could not be used. */
const CONTRADICTION = /^(KEY_IS_NOT_THE_RECOMPUTED_VALUE|ANOTHER_OPTION_ALSO_STATES_THE_RECOMPUTED_VALUE|KEY_IS_NOT_A_ROOT_OF_THE_STATED_EQUATION|DECLARED_VERDICT_IS_NOT_THE_RECOMPUTED_ONE|COMPARISON_DOES_NOT_GIVE_WHAT_THE_ITEM_SAYS|VERDICT_DISAGREES_WITH_THE_COMPARISON|DECLARED_ARITHMETIC_DOES_NOT_GIVE_THE_KEY|FINAL_ANSWER_DOES_NOT_STATE_THE_RECOMPUTED_VALUE|KEYED_EQUATION_IS_NOT_THE_DECLARED_LINE|KEYED_ROOTS_ARE_NOT_THE_DECLARED_ROOTS)/;

/** Does a keyed number equal a recomputed one, given how the key says it is rounded? */
function keyMatches(recomputed: number, keyed: number, places: number | null): boolean {
  return places === null ? nearlyEqual(recomputed, keyed) : nearlyEqual(roundTo(recomputed, places), keyed);
}

/** Every keyed answer of the item, classified. Nothing the item declares is taken as true. */
export function classifyAnswers(c: SpecificationCandidate, s: AdaptationSpecification, stimulus: CandidateStimulus | null): AnswerUnitVerdict[] {
  const construct = constructIdOf(s);
  const P = c.content.declaredModel.parameters;
  const x = c.content;
  const vocabulary = constructVocabularyOf(construct);
  const usable = vocabulary !== null && !parameterIssues(c, s).some((i) => i.startsWith('PARAMETER_MISSING'));
  const derived = usable ? deriveConstruct(construct, P, stimulus?.structured) : { quantities: {}, verdicts: {}, parameterIssues: ['PARAMETERS_UNUSABLE'] };
  const itemNumbers = numbersInText(itemText(c));
  const pool = [...itemNumbers, ...numbersInText(stimulusText(stimulus)), ...structuredNumbers(stimulus?.structured)];
  const equation = vocabulary?.parametersStatedIn === 'STEM_AS_COEFFICIENTS' ? parseQuadraticFromText(itemText(c)) : null;
  // are the declared parameters readable in the item? Only then does a recomputation from them say something about the item
  let parametersReadable: boolean;
  if (!usable) parametersReadable = false;
  else if (vocabulary!.parametersStatedIn === 'STEM_AS_COEFFICIENTS') {
    const fromEquation = equation !== null && nearlyEqual(equation.A, P.a) && nearlyEqual(equation.A * P.r1 * P.r1 + equation.B * P.r1 + equation.C, 0) && nearlyEqual(equation.A * P.r2 * P.r2 + equation.B * P.r2 + equation.C, 0);
    const stated = rootsStatedInText(itemText(c));
    // an equation given as factors states its roots too: readable, though the construct validator fails it for another reason
    parametersReadable = fromEquation || (equation === null && stated.length === 2 && [P.r1, P.r2].every((r) => stated.some((q) => nearlyEqual(q, r))));
  } else if (vocabulary!.parametersStatedIn === 'STIMULUS') parametersReadable = vocabulary!.parameters.every((sym) => structuredNumbers(stimulus?.structured).some((n) => nearlyEqual(n, P[sym])));
  else parametersReadable = definingParameters(construct, P, targetsOf(c), stimulus?.structured).every(([, value]) => nearlyEqual(Math.abs(value), 1) || hasNumber(pool, value));
  const basisForQuantity: RecomputationBasis = !usable ? 'NONE' : equation !== null && parametersReadable ? 'ITEM_TEXT_EQUATION' : vocabulary!.parametersStatedIn === 'STIMULUS' && parametersReadable ? 'STIMULUS_NUMBERS' : parametersReadable ? 'DECLARED_PARAMETERS_READABLE_IN_ITEM' : 'DECLARED_PARAMETERS_NOT_READABLE_IN_ITEM';

  const unit = (label: string, target: AnswerTarget, numericKey: NumericAnswerKey | null, keyedText: string | null, answerCheck: { kind: string; expression?: string }, otherOptionTexts: string[], constructedPart: boolean): AnswerUnitVerdict => {
    const issues: string[] = [];
    const notes: string[] = [];
    const fromKey = numericKey ? { value: rationalToNumber(numericKeyValue(numericKey).value), places: numericKey.decimalPlaces ?? null } : null;
    // a constructed part without a numeric key has a SENTENCE as its answer: the one number of a sentence is not taken for a key
    const fromText = keyedText !== null && !constructedPart ? singleNumberOf(keyedText) : null;
    const keyed: { value: number; places: number | null } | null = fromKey ?? (fromText ? { value: fromText.value, places: fromText.decimals > 0 ? fromText.decimals : null } : null);
    // the item's own arithmetic, when it evaluates, must give its own key (an expression that does not evaluate is a STRUCTURAL finding)
    const declared = answerCheck.kind === 'ARITHMETIC_EXPRESSION' ? tryEvaluate(answerCheck.expression!) : null;
    if (declared !== null && keyed !== null && !keyMatches(declared, keyed.value, keyed.places) && !(keyed.places === null && nearlyEqual(roundTo(declared, 6), keyed.value))) issues.push(`DECLARED_ARITHMETIC_DOES_NOT_GIVE_THE_KEY:${declared}/${keyed.value}`);
    if (numericKey && !(numericKey.decimalPlaces !== undefined && numericKey.value.includes('/')) && isResponseCorrect(numericKey, numericKey.value).outcome !== 'CORRECT') issues.push('NUMERIC_KEY_DOES_NOT_ACCEPT_ITS_OWN_VALUE');
    const done = (cls: AnswerClass, basis: RecomputationBasis, recomputed: number | string | null): AnswerUnitVerdict => ({ label, targetKind: target.kind, class: issues.length > 0 ? 'FAILED' : cls, failureKind: issues.length === 0 ? null : issues.some((i) => CONTRADICTION.test(i)) ? 'KEY_CONTRADICTED' : 'DECLARATION_UNUSABLE', basis, recomputed, keyed: keyed ? keyed.value : keyedText, issues, notes });

    if (target.kind === 'QUANTITY') {
      if (!usable) { issues.push('PARAMETERS_UNUSABLE_FOR_RECOMPUTATION'); return done('FAILED', 'NONE', null); }
      const known = vocabulary!.quantities.some((q) => q.code === target.quantity);
      const value = derived.quantities[target.quantity];
      if (!known) { issues.push(`QUANTITY_NOT_OF_THE_CONSTRUCT:${target.quantity}`); return done('FAILED', 'NONE', null); }
      if (value === null || value === undefined) { notes.push(`quantity ${target.quantity} is not determined by the declared parameters and the stimulus`); return done('HUMAN_REVIEW_REQUIRED', 'NONE', null); }
      if (keyed === null) {
        if (keyedText === null) { issues.push('QUANTITY_TARGET_WITHOUT_A_NUMERIC_KEY'); return done('FAILED', basisForQuantity, value); }
        if (!constructedPart) { notes.push('the keyed option does not state exactly one number, so it cannot be compared'); return done('HUMAN_REVIEW_REQUIRED', basisForQuantity, value); }
        // no number to compare as a key: is the recomputed value at least STATED in the keyed answer? (a sentence carries a sign in words: magnitudes are compared)
        const stated = numbersInText(keyedText).some((n) => keyMatches(Math.abs(value), Math.abs(n), decimalsOf(n) > 0 ? decimalsOf(n) : null) || nearlyEqual(Math.abs(n), Math.abs(value)));
        if (!stated && numbersInText(keyedText).length === 0) { notes.push('the keyed answer states no number, so the recomputed value cannot be compared with it'); return done('HUMAN_REVIEW_REQUIRED', basisForQuantity, value); }
        if (!stated) { issues.push(`FINAL_ANSWER_DOES_NOT_STATE_THE_RECOMPUTED_VALUE:${value}`); return done('FAILED', basisForQuantity, value); }
        notes.push('no numeric key: the recomputed value (its magnitude) is stated in the keyed answer text; that it is THE answer of that text is not machine-linked');
        return done('DETERMINISTIC_RULE_VERIFIED', basisForQuantity, value);
      }
      if (!keyMatches(value, keyed.value, keyed.places)) issues.push(`KEY_IS_NOT_THE_RECOMPUTED_VALUE:${keyed.value}/${value}`);
      // with options, no other option may also state the recomputed value
      const twin = otherOptionTexts.map((t) => singleNumberOf(t)).filter((n): n is { value: number; decimals: number } => n !== null).some((n) => keyMatches(value, n.value, n.decimals > 0 ? n.decimals : null));
      if (twin) issues.push('ANOTHER_OPTION_ALSO_STATES_THE_RECOMPUTED_VALUE');
      // the equation of the stem, solved here, must give the same roots
      if (basisForQuantity === 'ITEM_TEXT_EQUATION' && equation && (target.quantity === 'GREATER_ROOT' || target.quantity === 'LESSER_ROOT')) {
        const disc = equation.B * equation.B - 4 * equation.A * equation.C;
        const roots = disc < 0 ? [] : [(-equation.B + Math.sqrt(disc)) / (2 * equation.A), (-equation.B - Math.sqrt(disc)) / (2 * equation.A)];
        const fromEquation = target.quantity === 'GREATER_ROOT' ? Math.max(...roots) : Math.min(...roots);
        if (roots.length === 0 || !keyMatches(fromEquation, keyed.value, keyed.places)) issues.push('KEY_IS_NOT_A_ROOT_OF_THE_STATED_EQUATION');
        notes.push('the equation was read from the stem and solved independently of the declared parameters');
      }
      if (basisForQuantity === 'DECLARED_PARAMETERS_NOT_READABLE_IN_ITEM') notes.push('the key equals the value recomputed from the declared parameters, but those parameters are not all readable in the item');
      return done(basisForQuantity === 'DECLARED_PARAMETERS_NOT_READABLE_IN_ITEM' ? 'DETERMINISTIC_RULE_VERIFIED' : 'MACHINE_VERIFIED', basisForQuantity, value);
    }
    if (target.kind === 'VERDICT') {
      const spec = vocabulary?.verdicts.find((q) => q.code === target.verdict);
      if (!spec || !spec.values.includes(target.value)) { issues.push(`VERDICT_NOT_OF_THE_CONSTRUCT:${target.verdict}=${target.value}`); return done('FAILED', 'NONE', null); }
      const value = usable ? derived.verdicts[target.verdict] : null;
      if (value === null || value === undefined) { notes.push(`verdict ${target.verdict} is not decided by a rule here`); return done('HUMAN_REVIEW_REQUIRED', 'NONE', null); }
      if (value !== target.value) issues.push(`DECLARED_VERDICT_IS_NOT_THE_RECOMPUTED_ONE:${target.value}/${value}`);
      notes.push('the verdict was recomputed from the parameters; that the keyed wording says that verdict is not machine-linked');
      return done('DETERMINISTIC_RULE_VERIFIED', parametersReadable ? 'DECLARED_PARAMETERS_READABLE_IN_ITEM' : 'DECLARED_PARAMETERS_NOT_READABLE_IN_ITEM', value);
    }
    if (target.kind === 'COMPARISON') {
      const left = tryEvaluate(target.left), right = tryEvaluate(target.right);
      if (left === null || right === null) { issues.push('COMPARISON_DOES_NOT_EVALUATE'); return done('FAILED', 'NONE', null); }
      // a claim about a display is decided from the display alone; an item without a stimulus is decided from the numbers its own text states
      const allowed = stimulus ? structuredNumbers(stimulus.structured) : itemNumbers;
      const foreign = [...numbersInText(target.left, 'PARTS_ONLY'), ...numbersInText(target.right, 'PARTS_ONLY')].filter((n) => !allowed.some((q) => nearlyEqual(q, n)) && !COMPARISON_CONSTANTS.some((q) => q === n));
      if (foreign.length > 0) issues.push(`COMPARISON_USES_NUMBERS_THAT_ARE_NOT_IN_THE_${stimulus ? 'STIMULUS' : 'ITEM'}:${[...new Set(foreign)].join(',')}`);
      const holds = compare(left, target.operator, right);
      if (holds !== target.holds) issues.push(`COMPARISON_DOES_NOT_GIVE_WHAT_THE_ITEM_SAYS:${left} ${target.operator} ${right} is ${holds}`);
      if (target.verdict !== null && ((target.verdict === 'SUPPORTED' && !holds) || (target.verdict === 'CONTRADICTED' && holds))) issues.push(`VERDICT_DISAGREES_WITH_THE_COMPARISON:${target.verdict}`);
      notes.push(`the comparison was evaluated on numbers of the ${stimulus ? 'stimulus' : 'item'}; that it is the right formalisation of what is asked is a reviewer's reading`);
      return done('DETERMINISTIC_RULE_VERIFIED', stimulus ? 'STIMULUS_NUMBERS' : 'ITEM_NUMBERS', `${left} ${target.operator} ${right} = ${holds}`);
    }
    // NOT_MACHINE_CHECKABLE. Two structures can still be read from the keyed text itself.
    if (usable && keyedText !== null && construct === 'LINEAR_MODEL_FIXED_START_CONSTANT_RATE') {
      const line = parseLinearFromText(keyedText);
      if (line) {
        if (!nearlyEqual(line.m, P.m) || !nearlyEqual(line.b, P.b)) issues.push(`KEYED_EQUATION_IS_NOT_THE_DECLARED_LINE:${line.m},${line.b}/${P.m},${P.b}`);
        notes.push('the equation of the keyed answer was read and has the declared rate and starting value; any interpretation in words beside it is not checked');
        return done('DETERMINISTIC_RULE_VERIFIED', 'KEYED_TEXT_STRUCTURE', `y = ${line.m} x + ${line.b}`);
      }
    }
    if (usable && keyedText !== null && construct === 'QUADRATIC_EQUATION_RATIONAL_ROOTS_BY_FACTORISING') {
      const roots = rootsStatedInText(keyedText);
      if (roots.length > 0) {
        if (!(roots.every((r) => nearlyEqual(r, P.r1) || nearlyEqual(r, P.r2)) && [P.r1, P.r2].every((r) => roots.some((q) => nearlyEqual(q, r))))) issues.push(`KEYED_ROOTS_ARE_NOT_THE_DECLARED_ROOTS:${roots.join(',')}`);
        else if (equation && !roots.every((r) => nearlyEqual(equation.A * r * r + equation.B * r + equation.C, 0))) issues.push('KEY_IS_NOT_A_ROOT_OF_THE_STATED_EQUATION');
        notes.push(`the roots of the keyed answer were read (${roots.join(', ')})${equation ? ' and substituted into the equation of the stem' : ''}`);
        return done('DETERMINISTIC_RULE_VERIFIED', equation ? 'ITEM_TEXT_EQUATION' : 'KEYED_TEXT_STRUCTURE', roots.join(', '));
      }
    }
    if (declared !== null && keyed !== null) { notes.push('only the item\'s own arithmetic was evaluated: this is not an independent recomputation'); return done('DETERMINISTIC_RULE_VERIFIED', 'DECLARED_ARITHMETIC_ONLY', declared); }
    notes.push(`not machine-checkable: ${target.reason}`);
    return done('HUMAN_REVIEW_REQUIRED', 'NONE', null);
  };

  if (x.selected) { const key = x.selected.options.find((o) => o.id === x.selected!.answerKey); return [unit('item', x.selected.target, null, key ? key.text : null, x.selected.answerCheck, x.selected.options.filter((o) => o.id !== x.selected!.answerKey).map((o) => o.text), false)]; }
  if (x.numeric) return [unit('item', x.numeric.target, x.numeric.numericKey, null, x.numeric.answerCheck, [], false)];
  return x.constructed!.parts.map((p) => unit(p.label, p.target, p.numericKey, p.numericKey ? null : p.finalAnswer, p.answerCheck, [], true));
}

const WORST: readonly AnswerClass[] = ['FAILED', 'HUMAN_REVIEW_REQUIRED', 'DETERMINISTIC_RULE_VERIFIED', 'MACHINE_VERIFIED'];
/** The class of an item is the weakest class among its keyed answers. */
export const itemAnswerClass = (units: readonly AnswerUnitVerdict[]): AnswerClass => WORST.find((cls) => units.some((u) => u.class === cls)) ?? 'HUMAN_REVIEW_REQUIRED';

export function validateAnswerKey(units: readonly AnswerUnitVerdict[]): SpecValidationResult<AnswerClass> & { units: AnswerUnitVerdict[] } {
  return { ...result('ANSWER_KEY', itemAnswerClass(units), units.flatMap((u) => u.issues.map((i) => `${u.label}:${i}`)), units.flatMap((u) => u.notes.map((n) => `${u.label}: ${n}`))), units: [...units] };
}

/** Applicable when at least one keyed answer is a number a rule here recomputes from the parameters, the stem's equation or the stimulus. */
export function validateMachineRecomputation(units: readonly AnswerUnitVerdict[]): SpecValidationResult<'PASS' | 'FAIL' | 'NOT_APPLICABLE'> & { recomputedUnits: number; applicableUnits: number } {
  const applicable = units.filter((u) => u.targetKind === 'QUANTITY' && typeof u.recomputed === 'number');
  const failed = applicable.filter((u) => u.class === 'FAILED');
  const ok = applicable.filter((u) => u.class === 'MACHINE_VERIFIED' || u.class === 'DETERMINISTIC_RULE_VERIFIED');
  return { ...result('MACHINE_RECOMPUTATION', applicable.length === 0 ? 'NOT_APPLICABLE' : failed.length > 0 ? 'FAIL' : 'PASS', failed.flatMap((u) => u.issues.map((i) => `${u.label}:${i}`)), applicable.map((u) => `${u.label}: ${u.basis}`)), recomputedUnits: ok.length, applicableUnits: applicable.length };
}

// ---------------------------------------------------------------------------------------------------------------
// 6 STIMULUS_INTEGRITY
// ---------------------------------------------------------------------------------------------------------------
export function validateSpecificationStimulus(c: SpecificationCandidate, s: AdaptationSpecification, stimulus: CandidateStimulus | null): SpecValidationResult<'PASS' | 'FAIL' | 'NOT_APPLICABLE'> {
  if (s.variable.stimulus.mode === 'NONE' && stimulus === null) return result('STIMULUS_INTEGRITY', 'NOT_APPLICABLE', []);
  const issues: string[] = [];
  if (stimulus === null) return result('STIMULUS_INTEGRITY', 'FAIL', ['STIMULUS_MISSING']);
  if (!stimulus.structured) issues.push('STIMULUS_HAS_NO_STRUCTURED_DATA');
  else {
    issues.push(...structuredStimulusViolations(stimulus.kind, stimulus.structured).map((v) => `STRUCTURED:${v}`));
    // the rendered assets are derived: rendering again must reproduce them
    if (JSON.stringify(renderStructuredAssets(stimulus.structured, stimulus.language)) !== JSON.stringify(stimulus.renderedAssets ?? [])) issues.push('RENDERED_ASSETS_ARE_NOT_WHAT_THE_DATA_RENDERS_TO');
    const numbers = structuredNumbers(stimulus.structured);
    const uses = c.content.usesStimulusValues;
    if (uses === null || uses.length === 0) issues.push('ITEM_DOES_NOT_SAY_WHICH_STIMULUS_VALUES_IT_USES');
    else for (const u of uses) if (!numbers.some((n) => nearlyEqual(n, u))) issues.push(`USED_VALUE_NOT_IN_STIMULUS:${u}`);
  }
  if (stimulus.provenance !== 'STUDYUS_GENERATED') issues.push('STIMULUS_PROVENANCE_IS_NOT_GENERATED');
  return result('STIMULUS_INTEGRITY', issues.length === 0 ? 'PASS' : 'FAIL', issues);
}

// ---------------------------------------------------------------------------------------------------------------
// 7 ORIGINALITY
// ---------------------------------------------------------------------------------------------------------------
export function validateSpecificationOriginality(c: SpecificationCandidate, siblings: readonly SpecificationCandidate[], extraCorpus: readonly ComparisonEntry[] = [], thresholds: OriginalityThresholds = DEFAULT_ORIGINALITY_THRESHOLDS): SpecValidationResult<OriginalityGateResult['outcome']> & { maxSimilarity: number; closest: OriginalityGateResult['closest']; comparedAgainst: number; sameParametersAs: string[] } {
  // an earlier attempt at the SAME specification is not a sibling: a regeneration replaces its predecessor
  const others = siblings.filter((x) => x.candidateKey !== c.candidateKey && x.specificationId !== c.specificationId);
  const corpus: ComparisonEntry[] = [...others.map((x) => ({ source: 'GENERATION_BATCH_SIBLING' as const, key: x.candidateKey, comparisonPermitted: true, text: comparableTextOfSpecificationCandidate(x) })), ...extraCorpus];
  const gate = evaluateOriginality({ text: comparableTextOfSpecificationCandidate(c) }, corpus, thresholds);
  // two instances of one construct with the very same parameter values are one instance told twice, whatever the wording
  const signature = (x: SpecificationCandidate) => `${x.content.declaredModel.construct}|${Object.entries(x.content.declaredModel.parameters).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join(',')}`;
  const sameParametersAs = Object.keys(c.content.declaredModel.parameters).length < 2 ? [] : others.filter((x) => signature(x) === signature(c)).map((x) => x.candidateKey);
  const outcome: OriginalityGateResult['outcome'] = gate.outcome === 'PASS_LOW_SIMILARITY' && sameParametersAs.length > 0 ? 'REVIEW_STRUCTURAL_SIMILARITY' : gate.outcome;
  const issues = [...(gate.outcome === 'PASS_LOW_SIMILARITY' ? [] : [`${gate.outcome}:${gate.closest?.key ?? ''}`]), ...sameParametersAs.map((k) => `SAME_PARAMETER_VALUES_AS_A_SIBLING:${k}`)];
  return { ...result('ORIGINALITY', outcome, issues, ['textual shingle similarity and identical parameter sets only: it does not detect a paraphrase of published material it was not given']), maxSimilarity: gate.maxSimilarity, closest: gate.closest, comparedAgainst: gate.comparedAgainst.length, sameParametersAs };
}

// ---------------------------------------------------------------------------------------------------------------
// 8 LINEAGE_COMPLETENESS
// ---------------------------------------------------------------------------------------------------------------
export function validateSpecificationLineage(c: SpecificationCandidate, s: AdaptationSpecification): SpecValidationResult<'PASS' | 'FAIL'> {
  const issues: string[] = [];
  const parsed = SpecificationLineageSchema.safeParse(c.lineage);
  if (!parsed.success) return result('LINEAGE_COMPLETENESS', 'FAIL', parsed.error.issues.slice(0, 6).map((i) => `LINEAGE_FIELD:${i.path.join('.')}`));
  const l = parsed.data;
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  if (!same(l.primaryConcept, s.primaryConcept)) issues.push('PRIMARY_CONCEPT');
  if (l.taskFamily.id !== s.taskFamily.familyId || l.taskFamily.version !== s.taskFamily.version) issues.push('TASK_FAMILY');
  if (l.systemProfile.id !== s.systemProfile.profileId || l.systemProfile.version !== s.systemProfile.version) issues.push('SYSTEM_PROFILE');
  if ((l.componentProfile === null) !== (s.componentProfile === null) || (l.componentProfile && s.componentProfile && (l.componentProfile.id !== s.componentProfile.componentId || l.componentProfile.version !== s.componentProfile.version || !same(l.componentProfile.versionBinding, s.componentProfile.versionBinding)))) issues.push('COMPONENT_PROFILE_OR_ITS_VERSION_BINDING');
  if (!same(l.systemVersionBinding, s.systemProfile.versionBinding ?? null)) issues.push('SYSTEM_VERSION_BINDING');
  if (l.disciplinePolicy.id !== s.disciplinePolicy.policyId || l.disciplinePolicy.version !== s.disciplinePolicy.version) issues.push('DISCIPLINE_POLICY');
  if (l.adaptationSpecification.id !== s.specificationId || l.adaptationSpecification.invariantHash !== s.invariantHash) issues.push('ADAPTATION_SPECIFICATION');
  if (s.learningApproach ? !(l.learningApproach.recordedAs === 'EXPLICIT' && l.learningApproach.id === s.learningApproach.approachId && l.learningApproach.version === s.learningApproach.version) : l.learningApproach.recordedAs !== 'STANDARD_BY_ABSENCE') issues.push('LEARNING_APPROACH');
  if (l.contentUseClass !== s.contentUseClass) issues.push('CONTENT_USE_CLASS');
  if (l.generationRequest.unitKey !== c.unitKey) issues.push('GENERATION_REQUEST_UNIT');
  return result('LINEAGE_COMPLETENESS', issues.length === 0 ? 'PASS' : 'FAIL', issues.map((i) => `LINEAGE_DISAGREES_WITH_SPECIFICATION:${i}`));
}

// ---------------------------------------------------------------------------------------------------------------
// one item, all eight
// ---------------------------------------------------------------------------------------------------------------
export const AUTOMATED_ITEM_STATUSES = ['AUTOMATED_CHECKS_PASSED', 'AUTOMATED_CHECKS_PASSED_HUMAN_REVIEW_REQUIRED', 'AUTOMATED_CHECKS_FAILED'] as const;
export interface SpecificationItemValidation {
  candidateKey: string;
  specificationId: string;
  kind: typeof SPECIFICATION_AUTOMATED_VALIDATION;
  isHumanReview: false;
  reviewStatus: typeof SPECIFICATION_REVIEW_STATUS;
  structural: ReturnType<typeof validateStructure>;
  profileCompliance: ReturnType<typeof validateProfileCompliance>;
  constructPreservation: ReturnType<typeof validateConstructPreservation>;
  answerKey: ReturnType<typeof validateAnswerKey>;
  machineRecomputation: ReturnType<typeof validateMachineRecomputation>;
  stimulusIntegrity: ReturnType<typeof validateSpecificationStimulus>;
  originality: ReturnType<typeof validateSpecificationOriginality>;
  lineage: ReturnType<typeof validateSpecificationLineage>;
  automatedStatus: (typeof AUTOMATED_ITEM_STATUSES)[number];
}

export function validateSpecificationCandidate(p: { candidate: SpecificationCandidate; specification: AdaptationSpecification; stimulus: CandidateStimulus | null; siblings: readonly SpecificationCandidate[]; extraCorpus?: readonly ComparisonEntry[] }): SpecificationItemValidation {
  const { candidate: c, specification: s, stimulus } = p;
  const units = classifyAnswers(c, s, stimulus);
  const v = {
    structural: validateStructure(c, stimulus, s), profileCompliance: validateProfileCompliance(c, s, stimulus), constructPreservation: validateConstructPreservation(c, s, stimulus), answerKey: validateAnswerKey(units),
    machineRecomputation: validateMachineRecomputation(units), stimulusIntegrity: validateSpecificationStimulus(c, s, stimulus), originality: validateSpecificationOriginality(c, p.siblings, p.extraCorpus ?? []), lineage: validateSpecificationLineage(c, s),
  };
  const failed = v.structural.outcome === 'FAIL' || v.profileCompliance.outcome === 'FAIL' || v.constructPreservation.outcome === 'FAIL' || v.answerKey.outcome === 'FAILED' || v.machineRecomputation.outcome === 'FAIL' || v.stimulusIntegrity.outcome === 'FAIL' || v.originality.outcome === 'REJECT_TEXTUAL_SIMILARITY' || v.lineage.outcome === 'FAIL';
  const needsPerson = v.answerKey.outcome === 'HUMAN_REVIEW_REQUIRED' || v.constructPreservation.outcome === 'WEAK' || v.originality.outcome === 'REVIEW_STRUCTURAL_SIMILARITY';
  return { candidateKey: c.candidateKey, specificationId: c.specificationId, kind: SPECIFICATION_AUTOMATED_VALIDATION, isHumanReview: false, reviewStatus: SPECIFICATION_REVIEW_STATUS, ...v, automatedStatus: failed ? 'AUTOMATED_CHECKS_FAILED' : needsPerson ? 'AUTOMATED_CHECKS_PASSED_HUMAN_REVIEW_REQUIRED' : 'AUTOMATED_CHECKS_PASSED' };
}
