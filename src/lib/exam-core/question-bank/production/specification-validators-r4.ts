/**
 * QB-R2F -- validators, REVISION 4 (pure, no IO). Revisions 2 and 3 are NOT edited: they scored QB-R2D and QB-R2E,
 * and those reports must stay reproducible with the code that produced them. Revision 4 runs revision 3 and then
 * corrects two demonstrated bugs and adds checks. It is the revision the next run is frozen with.
 *
 * TWO BUGS OF REVISION 2, CORRECTED HERE (the only places where revision 4 can be MORE lenient than revision 3):
 *   V1  OPTIONS_STATE_THE_SAME_NUMBER read "the one number an option states" and compared it across options. Two
 *       options that say opposite things about "game 1" both "state 1". Corrected rule: two options state the same
 *       number only when, with that number taken out, one option's remaining words are contained in the other's --
 *       i.e. the number is all that could tell them apart, and it does not. (QB-R2E, 18 a1.)
 *   V2  A keyed answer was classed DETERMINISTIC_RULE_VERIFIED because it agreed with the item's DECLARED roots,
 *       when the equation the item actually states was never read. Corrected rule: for an equation construct the
 *       equation is read from the item with BOTH SIDES brought together; a key that does not satisfy it is FAILED;
 *       and when no equation can be read, nothing about the key is "rule-verified" -- it is HUMAN_REVIEW_REQUIRED.
 *       (QB-R2E, 13 a1: a wrong key had been classed as verified.)
 *
 * ADDITIONS (each can only make an outcome worse, except where it finds evidence revision 2 could not see):
 *   construct   the stated equation, read with both sides, does not have the declared roots          -> FAIL
 *               the stimulus TEXT states the model the learner is meant to read from the data        -> FAIL
 *               evidence of an action that IS in the item and that revision 2 could not read: a keyed equation of
 *               a line through two points; derived quantities stated in a keyed option; values read from a
 *               display. Found evidence removes the corresponding WEAK; it never removes a FAIL.
 *   profile     the item demand policy: one mark per mark point, method and accuracy in a multi-mark part, a line
 *               of working per method point, total marks against the actions of the evidence target
 *   originality half or more of the parameter values shared with another item of the batch or of earlier runs;
 *               a near-duplicate scenario within one task family
 *   item writing (heuristic) the QB-R2E misses: "presenta / indica / describe correctamente", "la decisión
 *               correcta", and structure -- the key is the only option with an equation, or the only one of its
 *               length class
 *
 * Nothing here is a review. Every result is an AUTOMATED_VALIDATION.
 */
import type { AdaptationSpecification } from '@/lib/assessment-adaptation/adaptation-specification';
import { ITEM_DEMAND_POLICY, itemDemandIssues } from '@/lib/assessment-adaptation/item-demand-policy';
import { nearlyEqual } from './expression-evaluator';
import type { CandidateStimulus } from './generation-contract';
import type { ComparisonEntry } from './originality-gate';
import type { SpecificationCandidate } from './specification-candidate';
import { deriveConstruct, numbersInText, parseLinearFromText, rootsStatedInText, singleNumberOf, SPECIFICATION_AUTOMATED_VALIDATION, SPECIFICATION_REVIEW_STATUS, type AnswerClass, type AnswerUnitVerdict } from './specification-validators';
import { itemWritingFlags, validateSpecificationCandidateR3, type SpecificationItemValidationR3 } from './specification-validators-r3';
import { structuredNumbers } from './stimulus-spec';

export const SPECIFICATION_VALIDATORS_REVISION_4 = 4 as const;
const constructIdOf = (s: AdaptationSpecification): string => String((s.invariants.construct as { construct?: unknown } | null)?.construct ?? '');
const normal = (t: string): string => t.replace(/[−–]/g, '-').replace(/(\d),(\d)/g, '$1.$2');
const questionText = (c: SpecificationCandidate): string => [c.content.stem, ...(c.content.constructed?.parts.map((p) => p.prompt) ?? [])].join(' \n ');

// ---------------------------------------------------------------------------------------------------------------
// V1 -- options that state the same number
// ---------------------------------------------------------------------------------------------------------------
const wordsWithoutNumbers = (text: string): string => text.toLowerCase().replace(/-?\d+(?:[.,]\d+)*(?:\s*\/\s*\d+)?/g, ' ').replace(/[^\p{L}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
/**
 * Pairs of options that are one answer written twice: each states exactly one number, the numbers are equal, and with
 * the number removed one option's words are contained in the other's (so nothing but the number could tell them apart).
 */
export function optionsStatingTheSameNumber(options: ReadonlyArray<{ id: string; text: string }>): string[] {
  const read = options.map((o) => ({ id: o.id, n: singleNumberOf(o.text), words: wordsWithoutNumbers(o.text) })).filter((o): o is { id: string; n: { value: number; decimals: number }; words: string } => o.n !== null);
  const out: string[] = [];
  for (let a = 0; a < read.length; a += 1) for (let b = a + 1; b < read.length; b += 1) {
    if (nearlyEqual(read[a].n.value, read[b].n.value) && (read[a].words.includes(read[b].words) || read[b].words.includes(read[a].words))) out.push(`OPTIONS_STATE_THE_SAME_NUMBER:${read[a].id},${read[b].id}`);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// V2 -- the equation an item states, read with both sides brought together
// ---------------------------------------------------------------------------------------------------------------
/** One side of an equation as a polynomial of degree at most two in x. null when it is not a plain sum of such terms. */
function polynomialOf(side: string): [number, number, number] | null {
  const s = side.replace(/\s+/g, '');
  if (s === '' || /[()]/.test(s)) return null;
  let rest = s;
  const out: [number, number, number] = [0, 0, 0];
  let first = true;
  while (rest.length > 0) {
    const m = /^([+-])?(\d+(?:\.\d+)?)?(x(?:\^2)?)?/.exec(rest)!;
    if (m[0] === '' || (m[2] === undefined && m[3] === undefined) || (!first && m[1] === undefined)) return null;
    const value = (m[1] === '-' ? -1 : 1) * (m[2] === undefined ? 1 : Number(m[2]));
    out[m[3] === 'x^2' ? 0 : m[3] === 'x' ? 1 : 2] += value;
    rest = rest.slice(m[0].length);
    first = false;
  }
  return out;
}
/**
 * The quadratic equation a text states, as `A x^2 + B x + C = 0`, whichever side its terms are written on
 * (`3x^2 - 6x = 33`, `x^2 = 5x - 6`, `2x^2 - 7x + 3 = 0`). null when the text states no such equation in expanded form.
 */
export function quadraticEquationStatedIn(text: string): { A: number; B: number; C: number } | null {
  const t = normal(text).replace(/x\s*²/g, 'x^2').replace(/x\s*\^\s*\{\s*2\s*\}/g, 'x^2').replace(/[$\\]/g, ' ');
  for (const m of t.matchAll(/([0-9x^+\-.\s]*x\^2[0-9x^+\-.\s]*|[0-9x^+\-.\s]+)=([0-9x^+\-.\s]+)/g)) {
    if (!m[0].includes('x^2')) continue;
    // the left side may have swallowed a word boundary's digits: take the longest tail that is a polynomial
    const left = m[1].trim().split(/\s{2,}/).pop()!;
    const l = polynomialOf(left), r = polynomialOf(m[2].trim().replace(/[.\s]+$/, ''));
    if (l && r && !nearlyEqual(l[0] - r[0], 0)) return { A: l[0] - r[0], B: l[1] - r[1], C: l[2] - r[2] };
  }
  return null;
}
const satisfies = (eq: { A: number; B: number; C: number }, x: number): boolean => Math.abs(eq.A * x * x + eq.B * x + eq.C) <= 1e-9 * Math.max(1, Math.abs(eq.A * x * x), Math.abs(eq.B * x), Math.abs(eq.C));

// ---------------------------------------------------------------------------------------------------------------
// answers, reclassified
// ---------------------------------------------------------------------------------------------------------------
const WORST: readonly AnswerClass[] = ['FAILED', 'HUMAN_REVIEW_REQUIRED', 'DETERMINISTIC_RULE_VERIFIED', 'MACHINE_VERIFIED'];
const keyedTextOf = (c: SpecificationCandidate, label: string): string | null => {
  const x = c.content;
  if (x.selected) return x.selected.options.find((o) => o.id === x.selected!.answerKey)?.text ?? null;
  if (x.numeric) return x.numeric.numericKey.value;
  return x.constructed!.parts.find((p) => p.label === label)?.finalAnswer ?? null;
};
export interface AnswerUnitR4 extends AnswerUnitVerdict { revision4: string | null }

export function reclassifyAnswers(c: SpecificationCandidate, s: AdaptationSpecification, stimulus: CandidateStimulus | null, units: readonly AnswerUnitVerdict[]): AnswerUnitR4[] {
  const construct = constructIdOf(s);
  const P = c.content.declaredModel.parameters;
  const derived = deriveConstruct(construct, P, stimulus?.structured);
  const stated = [...numbersInText(questionText(c)), ...structuredNumbers(stimulus?.structured)];
  const readable = (v: number): boolean => stated.some((n) => nearlyEqual(n, v) || nearlyEqual(n, Math.abs(v)));
  const equation = construct === 'QUADRATIC_EQUATION_RATIONAL_ROOTS_BY_FACTORISING' ? quadraticEquationStatedIn(questionText(c)) : null;
  const targetOf = (label: string) => (c.content.selected ? c.content.selected.target : c.content.numeric ? c.content.numeric.target : c.content.constructed!.parts.find((part) => part.label === label)!.target);
  // a table of at least two rows, every one on the declared line, states the rate and the start although neither is written as a number
  const lineShownByATable = construct === 'LINEAR_MODEL_FIXED_START_CONSTANT_RATE' && (stimulus?.structured?.tables ?? []).some((t) => { const numeric = t.columns.map((col, i) => (col.type === 'NUMBER' ? i : -1)).filter((i) => i >= 0); return numeric.length === 2 && t.rows.length >= 2 && new Set(t.rows.map((r) => r[numeric[0]])).size >= 2 && t.rows.every((r) => nearlyEqual(r[numeric[1]] as number, P.b + P.m * (r[numeric[0]] as number))); });
  return units.map((u): AnswerUnitR4 => {
    const keyedText = keyedTextOf(c, u.label);
    const change = (cls: AnswerClass, why: string, over: Partial<AnswerUnitVerdict> = {}): AnswerUnitR4 => ({ ...u, ...over, class: cls, failureKind: cls === 'FAILED' ? 'KEY_CONTRADICTED' : null, issues: cls === 'FAILED' ? [...u.issues, why] : u.issues, notes: [...u.notes, `revision 4: ${why}`], revision4: why });
    if (u.class === 'FAILED') return { ...u, revision4: null };
    // V2: an equation construct is judged against the equation the item STATES
    if (construct === 'QUADRATIC_EQUATION_RATIONAL_ROOTS_BY_FACTORISING' && (u.class === 'MACHINE_VERIFIED' || u.class === 'DETERMINISTIC_RULE_VERIFIED')) {
      const factorised = rootsStatedInText(questionText(c).replace(/x\s*=/g, ' '));
      if (!equation && factorised.length < 2) return change('HUMAN_REVIEW_REQUIRED', 'STATED_EQUATION_NOT_READ: the key agrees with the declared roots only, which is not a verification');
      if (equation) {
        const t = targetOf(u.label);
        const quantity = t.kind === 'QUANTITY' ? t.quantity : null;
        // a keyed root, or the roots a keyed sentence states, must satisfy the equation the item states
        const keyedRoots = quantity === 'GREATER_ROOT' || quantity === 'LESSER_ROOT' ? (typeof u.keyed === 'number' ? [u.keyed] : []) : quantity === null && keyedText ? rootsStatedInText(keyedText) : [];
        const bad = keyedRoots.filter((r) => !satisfies(equation, r));
        if (bad.length > 0) return change('FAILED', `KEYED_ROOT_DOES_NOT_SATISFY_THE_STATED_EQUATION:${bad.join(',')} in ${equation.A}x^2+${equation.B}x+${equation.C}=0`);
        const check: Record<string, number> = { SUM_OF_ROOTS: -equation.B / equation.A, PRODUCT_OF_ROOTS: equation.C / equation.A, COEFFICIENT_B: equation.B, COEFFICIENT_C: equation.C };
        if (quantity !== null && quantity in check && typeof u.keyed === 'number' && !nearlyEqual(u.keyed, check[quantity])) return change('FAILED', `KEYED_QUANTITY_IS_NOT_THAT_OF_THE_STATED_EQUATION:${quantity}=${check[quantity]}`);
      }
      return { ...u, revision4: null };
    }
    // a keyed line is "rule-verified" only when its rate and start are readable in the item
    if (construct === 'LINEAR_MODEL_FIXED_START_CONSTANT_RATE' && u.basis === 'KEYED_TEXT_STRUCTURE' && u.class === 'DETERMINISTIC_RULE_VERIFIED' && !(readable(P.m) && readable(P.b)) && !lineShownByATable) return change('HUMAN_REVIEW_REQUIRED', 'KEYED_EQUATION_AGREES_WITH_THE_DECLARATION_ONLY: its rate and start are not readable in the item');
    if (u.class !== 'HUMAN_REVIEW_REQUIRED' || keyedText === null) return { ...u, revision4: null };
    // evidence revision 2 could not read
    if (construct === 'LINE_THROUGH_TWO_POINTS') {
      const line = parseLinearFromText(keyedText);
      const m = derived.quantities.SLOPE, b = derived.quantities.Y_INTERCEPT;
      if (line && m !== null && m !== undefined && b !== null && b !== undefined && ['x1', 'y1', 'x2', 'y2'].every((k) => P[k] !== undefined && readable(P[k]))) {
        return nearlyEqual(line.m, m) && nearlyEqual(line.b, b) ? change('DETERMINISTIC_RULE_VERIFIED', 'KEYED_EQUATION_IS_THE_LINE_THROUGH_THE_STATED_POINTS', { basis: 'KEYED_TEXT_STRUCTURE', recomputed: `y = ${m} x + ${b}` }) : change('FAILED', `KEYED_EQUATION_IS_NOT_THE_LINE_THROUGH_THE_STATED_POINTS:${line.m},${line.b}/${m},${b}`);
      }
    }
    // a keyed answer that states derived quantities of the construct, and no number that is neither a parameter nor one of them
    const values = Object.values(derived.quantities).filter((v): v is number => typeof v === 'number');
    const keyedNumbers = numbersInText(keyedText, 'PARTS_ONLY').filter((n) => !(Number.isInteger(n) && n >= 1 && n <= 2));
    const isDerived = (n: number) => values.some((v) => nearlyEqual(v, n) || nearlyEqual(Math.abs(v), n));
    const isParameter = (n: number) => Object.values(P).some((v) => nearlyEqual(v, n));
    if (values.length > 0 && keyedNumbers.some(isDerived) && keyedNumbers.every((n) => isDerived(n) || isParameter(n)) && Object.values(P).every((v) => nearlyEqual(Math.abs(v), 1) || readable(v))) {
      // EVIDENCE ABOUT THE ITEM, NOT A VERIFICATION OF THE KEY: the class stays HUMAN_REVIEW_REQUIRED, because which choice the
      // answer's words make (this option or the other, true or false) is not linked to the numbers by any rule here.
      const why = 'KEYED_ANSWER_STATES_QUANTITIES_RECOMPUTED_HERE: every number of the keyed answer is a parameter or a derived quantity of the construct; which choice the answer words make is not machine-linked, so the class is unchanged';
      return { ...u, notes: [...u.notes, `revision 4: ${why}`], revision4: why };
    }
    return { ...u, revision4: null };
  });
}

// ---------------------------------------------------------------------------------------------------------------
// construct: the stated equation, a model stated in the stimulus text, and evidence revision 2 could not see
// ---------------------------------------------------------------------------------------------------------------
export function constructIssuesR4(c: SpecificationCandidate, s: AdaptationSpecification, stimulus: CandidateStimulus | null): string[] {
  const construct = constructIdOf(s);
  const P = c.content.declaredModel.parameters;
  const out: string[] = [];
  if (construct === 'QUADRATIC_EQUATION_RATIONAL_ROOTS_BY_FACTORISING') {
    const eq = quadraticEquationStatedIn(questionText(c));
    if (eq && [P.r1, P.r2].some((r) => r !== undefined && !satisfies(eq, r))) out.push(`STATED_EQUATION_DOES_NOT_HAVE_THE_DECLARED_ROOTS:${eq.A},${eq.B},${eq.C}`);
  }
  // the stimulus TEXT (not its table) states what the learner is meant to read from the data
  const actions = s.invariants.evidenceTarget.actions as readonly string[];
  if (stimulus?.structured && (actions.includes('FORMULATE') || actions.includes('INTERPRET'))) {
    const text = normal(stimulus.parts.filter((p) => p.partKind === 'TEXT' || p.partKind === 'SOURCE_NOTE').map((p) => p.text).join(' \n '));
    const inText = numbersInText(text);
    const has = (v: number | undefined | null) => v !== undefined && v !== null && inText.some((n) => nearlyEqual(n, v) || nearlyEqual(n, Math.abs(v)));
    if (construct === 'LINEAR_MODEL_FIXED_START_CONSTANT_RATE') {
      const line = parseLinearFromText(text);
      if ((has(P.m) && has(P.b)) || (line && nearlyEqual(line.m, P.m) && nearlyEqual(line.b, P.b))) out.push('STIMULUS_TEXT_STATES_THE_MODEL_TO_BE_READ_FROM_THE_DATA');
    }
    if (construct === 'RELATIVE_CHANGE_OR_SHARE_FROM_TABULATED_VALUES') {
      const d = deriveConstruct(construct, P, stimulus.structured).quantities;
      if ([d.RELATIVE_CHANGE_PERCENT, d.ABSOLUTE_CHANGE, d.SHARE_PERCENT].some((v) => typeof v === 'number' && inText.some((n) => nearlyEqual(n, Math.round(Math.abs(v) * 10) / 10) || nearlyEqual(n, Math.abs(v))))) out.push('STIMULUS_TEXT_STATES_THE_RESULT_TO_BE_COMPUTED_FROM_THE_DATA');
    }
  }
  return out;
}
/** Quantities that exist only once the model has been formed: a verified one is evidence that the item was formulated. */
const FORMULATION_QUANTITIES: Readonly<Record<string, readonly string[]>> = {
  UNIT_RATE_COMPARISON_OF_TWO_OPTIONS: ['UNIT_RATE_1', 'UNIT_RATE_2', 'UNIT_RATE_DIFFERENCE'], COMPARISON_OF_TWO_CLASSICAL_PROBABILITIES: ['PROBABILITY_1', 'PROBABILITY_2', 'PROBABILITY_DIFFERENCE'],
  QUADRATIC_MODEL_VERTEX_OPTIMUM: ['MEASURE_AT_OPTIMUM', 'OPTIMAL_VALUE'], LINEAR_MODEL_FIXED_START_CONSTANT_RATE: ['VALUE_AT_X', 'X_AT_Y'],
};
/** The WEAK notes of revision 2 that revision 4 can answer with evidence found in the item. Each removal says what the evidence is. */
export function weakNotesResolved(c: SpecificationCandidate, s: AdaptationSpecification, stimulus: CandidateStimulus | null, weak: readonly string[], units: readonly AnswerUnitR4[]): Array<{ note: string; evidence: string }> {
  const construct = constructIdOf(s);
  // a unit counts as evidence that the item was WORKED when its key was verified, or when its keyed answer states quantities
  // recomputed here (which says what the item demands, whatever the class of its key)
  const verified = units.filter((u) => u.class === 'MACHINE_VERIFIED' || u.class === 'DETERMINISTIC_RULE_VERIFIED' || (u.revision4 !== null && /^KEYED_ANSWER_STATES_QUANTITIES/.test(u.revision4)));
  const targetOf = (label: string) => (c.content.selected ? c.content.selected.target : c.content.numeric ? c.content.numeric.target : c.content.constructed!.parts.find((p) => p.label === label)!.target);
  const out: Array<{ note: string; evidence: string }> = [];
  for (const note of weak) {
    if (/^HEURISTIC (SOLVE|COMPUTE):/.test(note) && verified.some((u) => u.revision4 !== null && /^KEYED_/.test(u.revision4))) out.push({ note, evidence: 'a keyed answer is an equation verified here, or states quantities recomputed here: the item was worked, though it declared no quantity target' });
    else if (/^HEURISTIC FORMULATE: no part or mark point/.test(note) && c.content.context.kind !== 'ABSTRACT' && verified.some((u) => { const t = targetOf(u.label); return (t.kind === 'QUANTITY' && (FORMULATION_QUANTITIES[construct] ?? []).includes(t.quantity)) || (u.revision4 !== null && /^KEYED_ANSWER_STATES_QUANTITIES/.test(u.revision4)); })) out.push({ note, evidence: 'a keyed answer is, or states, a quantity that exists only once the model is formed from the situation' });
    else if (/^HEURISTIC INTERPRET:/.test(note) && stimulus?.structured && (verified.some((u) => u.basis === 'STIMULUS_NUMBERS') || (c.content.constructed?.parts.some((p) => { const n = numbersInText(p.finalAnswer); const inData = structuredNumbers(stimulus.structured); return n.length > 0 && n.every((v) => inData.some((d) => nearlyEqual(d, v))); }) ?? false))) out.push({ note, evidence: 'an answer is read from, or computed on, values of the display: the representation was interpreted' });
    else if (/^HEURISTIC INTERPRET:/.test(note) && verified.some((u) => u.revision4 !== null && /^KEYED_ANSWER_STATES_QUANTITIES/.test(u.revision4)) && c.content.selected !== null && construct !== 'CLAIM_EVALUATION_AGAINST_A_DATA_DISPLAY') out.push({ note, evidence: 'the keyed option of a decision item states the compared quantities recomputed here: choosing it is reading the result back into the situation' });
    else if (note === 'EQUATION_NOT_READABLE_IN_THE_WRITTEN_FORM_A_X2_B_X_C_EQUALS_0' && quadraticEquationStatedIn(questionText(c)) !== null) out.push({ note, evidence: 'the equation was read with both sides brought together' });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// originality within a batch: shared parameter values and near-duplicate scenarios
// ---------------------------------------------------------------------------------------------------------------
export const BATCH_DIVERSITY_RULE = {
  id: 'studyus-batch-diversity-rule', version: '1',
  rule: 'Compared with every other item of the same construct (fresh batch and earlier runs): SHARES_PARAMETER_VALUES when the whole parameter set is equal, or when one of the construct\'s parameter PAIRS is equal -- a pair being the values that together make one thing of the item (one option\'s amount and return, one point, the start and the rate, both roots), in either position. Compared with every other item of the same task family in the fresh batch: NEAR_DUPLICATE_SCENARIO when the scenario similarity of the two stems is at least the threshold. Scenario similarity is the Jaccard index of the stems\' content words (letters only, five characters or more, lower case). An earlier attempt at the same specification is not compared.',
  scenarioSimilarityThreshold: 0.4,
} as const;
const contentWords = (text: string): Set<string> => new Set(text.toLowerCase().split(/[^\p{L}]+/u).filter((w) => w.length >= 5));
export function scenarioSimilarity(a: string, b: string): number {
  const x = contentWords(a), y = contentWords(b);
  const both = [...x].filter((w) => y.has(w)).length;
  const either = new Set([...x, ...y]).size;
  return either === 0 ? 0 : Math.round((both / either) * 1000) / 1000;
}
/** The values that together make ONE thing of an item, by construct. */
const PARAMETER_PAIRS: Readonly<Record<string, ReadonlyArray<readonly [string, string]>>> = {
  DIRECT_PROPORTION_MISSING_VALUE: [['a', 'b']], UNIT_RATE_COMPARISON_OF_TWO_OPTIONS: [['p1', 'q1'], ['p2', 'q2']], LINE_THROUGH_TWO_POINTS: [['x1', 'y1'], ['x2', 'y2']], LINEAR_MODEL_FIXED_START_CONSTANT_RATE: [['b', 'm']],
  QUADRATIC_EQUATION_RATIONAL_ROOTS_BY_FACTORISING: [['r1', 'r2']], QUADRATIC_MODEL_VERTEX_OPTIMUM: [['p', 'q'], ['r', 's']], CLASSICAL_PROBABILITY_SINGLE_DRAW: [['n', 'k']], COMPARISON_OF_TWO_CLASSICAL_PROBABILITIES: [['n1', 'k1'], ['n2', 'k2']],
  RELATIVE_CHANGE_OR_SHARE_FROM_TABULATED_VALUES: [['vi', 'vj']],
};
export function batchDiversityIssues(c: SpecificationCandidate, peers: ReadonlyArray<{ candidate: SpecificationCandidate; sameRun: boolean }>): string[] {
  const out: string[] = [];
  const P = c.content.declaredModel.parameters;
  for (const { candidate: o, sameRun } of peers) {
    if (o.candidateKey === c.candidateKey || o.specificationId === c.specificationId) continue;
    if (o.content.declaredModel.construct === c.content.declaredModel.construct) {
      const Q = o.content.declaredModel.parameters;
      const symbols = Object.keys(P);
      const whole = symbols.length >= 2 && symbols.every((k) => Q[k] !== undefined && nearlyEqual(Q[k], P[k]));
      const pairs = PARAMETER_PAIRS[c.content.declaredModel.construct] ?? [];
      const same = (x: readonly [string, string], y: readonly [string, string]) => P[x[0]] !== undefined && Q[y[0]] !== undefined && ((nearlyEqual(P[x[0]], Q[y[0]]) && nearlyEqual(P[x[1]], Q[y[1]])) || (c.content.declaredModel.construct === 'QUADRATIC_EQUATION_RATIONAL_ROOTS_BY_FACTORISING' && nearlyEqual(P[x[0]], Q[y[1]]) && nearlyEqual(P[x[1]], Q[y[0]])));
      const shared = pairs.filter((x) => pairs.some((y) => same(x, y))).map((x) => x.join('+'));
      if (whole || shared.length > 0) out.push(`SHARES_PARAMETER_VALUES:${o.candidateKey}:${whole ? 'WHOLE_SET' : shared.join(',')}`);
    }
    if (sameRun && o.lineage.taskFamily.id === c.lineage.taskFamily.id) {
      const sim = scenarioSimilarity(c.content.stem, o.content.stem);
      if (sim >= BATCH_DIVERSITY_RULE.scenarioSimilarityThreshold) out.push(`NEAR_DUPLICATE_SCENARIO:${o.candidateKey}:${sim}`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// item writing: the QB-R2E misses
// ---------------------------------------------------------------------------------------------------------------
export const ITEM_WRITING_HEURISTIC_R4 = {
  id: 'studyus-item-writing-heuristic', version: '2',
  rule: 'Revision 3\'s three flags, plus: STEM_ASKS_WHICH_OPTION_IS_CORRECTLY_FORMED also for "presenta / indica / describe / muestra / expresa ... correctamente", "la decisión / comparación / opción correcta", "correctly presents / indicates / describes / states", and any stem whose question is about "which option" being correct rather than about the situation; KEY_IS_THE_ONLY_OPTION_WITH_AN_EQUATION; KEY_IS_ALONE_IN_ITS_LENGTH_CLASS (the key is at least 40% longer, or at least 40% shorter, than every other option). A flag is a reason for a person to look, not a verdict.',
} as const;
const META_STEM_R4 = /(qué|cuál)\s+(opción|alternativa|de las (siguientes )?opciones)[^?]*\b(correct[ao]s?|correctamente|adecuadamente)\b|\b(presenta|indica|describe|muestra|expresa|califica|formula|representa|compara|interpreta|modela)\w*\s+(correctamente|adecuadamente)|\bla\s+(decisión|comparación|descripción|opción|interpretación)\s+correcta\b|\bwhich\s+(option|choice|statement|of the following)[^?]*\bcorrect(ly)?\b|\bcorrectly\s+(present|indicat|describ|stat|formulat|express|represent|compar|interpret|model)/i;
const hasEquation = (t: string): boolean => /\p{L}\s*=\s*[-\d(]/u.test(t) || /=\s*\d/.test(t);
export function itemWritingFlagsR4(c: SpecificationCandidate): string[] {
  const out = new Set(itemWritingFlags(c));
  const sel = c.content.selected;
  if (!sel) return [...out];
  if (META_STEM_R4.test(c.content.stem)) out.add('STEM_ASKS_WHICH_OPTION_IS_CORRECTLY_FORMED');
  const key = sel.options.find((o) => o.id === sel.answerKey);
  const others = sel.options.filter((o) => o.id !== sel.answerKey);
  if (key && others.length > 0) {
    if (hasEquation(key.text) && others.every((o) => !hasEquation(o.text))) out.add('KEY_IS_THE_ONLY_OPTION_WITH_AN_EQUATION');
    const k = key.text.trim().length;
    if (others.every((o) => k >= 1.4 * o.text.trim().length) || others.every((o) => k * 1.4 <= o.text.trim().length)) out.add('KEY_IS_ALONE_IN_ITS_LENGTH_CLASS');
  }
  return [...out].sort();
}

// ---------------------------------------------------------------------------------------------------------------
// one item, revision 4
// ---------------------------------------------------------------------------------------------------------------
type Gates = SpecificationItemValidationR3['gates'];
export interface SpecificationItemValidationR4 {
  candidateKey: string;
  specificationId: string;
  validatorsRevision: typeof SPECIFICATION_VALIDATORS_REVISION_4;
  kind: typeof SPECIFICATION_AUTOMATED_VALIDATION;
  isHumanReview: false;
  reviewStatus: typeof SPECIFICATION_REVIEW_STATUS;
  /** Revision 3's result (which carries revision 2's), exactly as those revisions give it. */
  revision3: SpecificationItemValidationR3;
  revision4: {
    structuralIssues: string[];
    answerUnits: AnswerUnitR4[];
    constructIssues: string[];
    constructWeak: string[];
    weakResolvedByEvidence: Array<{ note: string; evidence: string }>;
    demandPolicy: { id: string; version: string; issues: string[] };
    batchDiversity: string[];
    itemWritingFlags: string[];
    /** Every gate whose outcome differs from revision 3's, with the reason. Empty when revision 4 changes nothing. */
    changesFromRevision3: Array<{ gate: keyof Gates; from: string; to: string; why: string }>;
  };
  gates: Gates;
}

export function validateSpecificationCandidateR4(p: { candidate: SpecificationCandidate; specification: AdaptationSpecification; stimulus: CandidateStimulus | null; siblings: readonly SpecificationCandidate[]; extraCorpus?: readonly ComparisonEntry[]; /** Other items the batch-diversity rule compares with; `sameRun` marks items of the fresh batch. Defaults to `siblings` as items of the same run. */ peers?: ReadonlyArray<{ candidate: SpecificationCandidate; sameRun: boolean }> }): SpecificationItemValidationR4 {
  const { candidate: c, specification: s, stimulus } = p;
  const r3 = validateSpecificationCandidateR3(p);
  const r2 = r3.revision2;
  // structural: V1
  const structuralIssues = [...r2.structural.issues.filter((i) => !i.startsWith('OPTIONS_STATE_THE_SAME_NUMBER:')), ...(c.content.selected ? optionsStatingTheSameNumber(c.content.selected.options) : [])];
  // answers: V2 and evidence
  const answerUnits = reclassifyAnswers(c, s, stimulus, r2.answerKey.units);
  const answerKey = WORST.find((cls) => answerUnits.some((u) => u.class === cls)) ?? 'HUMAN_REVIEW_REQUIRED';
  // construct
  const constructIssues = [...r2.constructPreservation.issues, ...r3.additions.handedOver, ...constructIssuesR4(c, s, stimulus)];
  const weakResolvedByEvidence = weakNotesResolved(c, s, stimulus, r2.constructPreservation.notes, answerUnits);
  const constructWeak = r2.constructPreservation.notes.filter((n) => !weakResolvedByEvidence.some((x) => x.note === n));
  // profile: the demand policy
  const demandIssues = itemDemandIssues({ parts: (c.content.constructed?.parts ?? []).map((part) => ({ label: part.label, marks: part.marks, markPoints: part.markScheme })), workingOutlineLines: c.content.constructed?.workingOutline.length ?? 0, evidenceActions: s.invariants.evidenceTarget.actions.length });
  // originality: batch diversity
  const batchDiversity = batchDiversityIssues(c, p.peers ?? p.siblings.map((candidate) => ({ candidate, sameRun: true })));
  const flags = itemWritingFlagsR4(c);
  const gates: Gates = {
    structural: structuralIssues.length > 0 ? 'FAIL' : 'PASS',
    profileCompliance: r3.gates.profileCompliance === 'FAIL' || demandIssues.length > 0 ? 'FAIL' : 'PASS',
    constructPreservation: constructIssues.length > 0 ? 'FAIL' : constructWeak.length > 0 ? 'WEAK' : 'PASS',
    answerKey,
    machineRecomputation: answerUnits.some((u) => u.targetKind === 'QUANTITY' && typeof u.recomputed === 'number' && u.class === 'FAILED') ? 'FAIL' : r3.gates.machineRecomputation,
    stimulusIntegrity: r3.gates.stimulusIntegrity,
    originality: r3.gates.originality === 'PASS_LOW_SIMILARITY' && batchDiversity.length > 0 ? 'REVIEW_STRUCTURAL_SIMILARITY' : r3.gates.originality,
    lineage: r3.gates.lineage,
    learnerTextLeakage: r3.gates.learnerTextLeakage,
    itemWriting: flags.length > 0 ? 'FLAGGED' : 'PASS',
  };
  const why: Partial<Record<keyof Gates, string>> = {
    structural: r2.structural.issues.filter((i) => i.startsWith('OPTIONS_STATE_THE_SAME_NUMBER:')).length !== structuralIssues.filter((i) => i.startsWith('OPTIONS_STATE_THE_SAME_NUMBER:')).length ? 'V1: options that share only a label numeral are not the same answer' : 'structural issues',
    profileCompliance: demandIssues.join('; '), constructPreservation: [...constructIssuesR4(c, s, stimulus), ...weakResolvedByEvidence.map((x) => `evidence found: ${x.evidence}`)].join('; '),
    answerKey: answerUnits.filter((u) => u.revision4 !== null).map((u) => `${u.label}: ${u.revision4}`).join('; '), machineRecomputation: 'a keyed quantity is contradicted by the stated equation', originality: batchDiversity.join('; '), itemWriting: flags.join(', '),
  };
  const changesFromRevision3 = (Object.keys(gates) as Array<keyof Gates>).filter((g) => gates[g] !== r3.gates[g]).map((g) => ({ gate: g, from: r3.gates[g], to: gates[g], why: why[g] ?? '' }));
  return {
    candidateKey: c.candidateKey, specificationId: c.specificationId, validatorsRevision: SPECIFICATION_VALIDATORS_REVISION_4, kind: SPECIFICATION_AUTOMATED_VALIDATION, isHumanReview: false, reviewStatus: SPECIFICATION_REVIEW_STATUS, revision3: r3,
    revision4: { structuralIssues, answerUnits, constructIssues, constructWeak, weakResolvedByEvidence, demandPolicy: { id: ITEM_DEMAND_POLICY.policyId, version: ITEM_DEMAND_POLICY.version, issues: demandIssues }, batchDiversity, itemWritingFlags: flags, changesFromRevision3 },
    gates,
  };
}
