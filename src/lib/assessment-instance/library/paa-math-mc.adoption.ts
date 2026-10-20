/**
 * PAA Matemáticas SELECTED_RESPONSE supply for the full-length PAA preparation form (2026-10-15, PAA_FULL_LENGTH_MOCK =
 * REQUIRED). The official practice test lays Matemáticas out as 45 multiple-choice + 10 student-produced items; the
 * certified PAA bank is student-produced only. Adapter PAA.MATEMATICAS (its governed formats: SELECTED_RESPONSE,
 * NUMERIC_ENTRY), Spanish, one mark, concepts that are PAA-certified identities placed in their PAA objective:
 *
 *   - the StudyUs-original Saber constructs (saber11-math.constructs.ts) over PAA-certified concepts, adopted as PAA
 *     families of their own (`tf.paa.mc.*`): same construct, key, errors and options; a PAA objective, the PAA adapter.
 *     The data-representation construct is not adopted (that concept has no PAA bucket);
 *   - PAA_PERCENT_CHANGE (aritmética) and PAA_SINGLE_DRAW_IN_CONTEXT (probabilidad), paa-math-mc.constructs.ts.
 *
 * No PAA item, released question or wording is copied. Written by the model, reviewed by nobody.
 */
import type { ParametricConstruct } from './parametric';
import type { LibraryEntry } from './catalogue';
import { adoptParametricConstruct, type AdoptionOptions, type AdoptionSpec } from './cf-ib-aahl-01.adoption';
import { SABER_MATH_ADOPTION_SPECS } from './saber11-math.adoption';
import { SABER_MATH_CONSTRUCTS_IN_CONTEXT } from './saber11-math.constructs';
import { PAA_PERCENT_CHANGE, PAA_SINGLE_DRAW_IN_CONTEXT } from './paa-math-mc.constructs';

const A = 'PAA.MATEMATICAS';
const OPTIONS: AdoptionOptions = { system: 'PAA', provenanceNote: 'Track B: StudyUs-original deterministic construct for PAA Matemáticas multiple-choice practice, written in-session by the model; reviewed by nobody. No PAA item, released question or wording is copied.', referenceSourceKeys: ['cb-paa-guia-2021', 'cb-paa-practice-test-2018'], origin: 'TRACK_B_DETERMINISTIC', language: 'es', responseFormat: 'SELECTED_RESPONSE', marksByBand: { FOUNDATIONAL: 1, STANDARD: 1, CHALLENGE: 1 } };
const ANSWER = (what: string) => ({ id: 'answer-equals-a-misconception', bypass: `A learner who ${what} would find the key among the options if it equalled that value.`, instanceRule: 'Parameter sets whose key a modelled misconception also gives are dropped; every distractor is a modelled misconception value.' });
const c = (x: unknown) => x as ParametricConstruct<never>;

/** The PAA objective of each PAA-certified concept the adopted Saber constructs assess (LIBRARY_BLUEPRINT_PAA buckets). */
export const PAA_OBJECTIVE_OF_CONCEPT: Readonly<Record<string, string>> = {
  'math.alg.linear-equations': 'paa.mat.algebra', 'math.fun.linear-functions-lines': 'paa.mat.algebra', 'math.alg.linear-systems': 'paa.mat.algebra',
  'math.geo.pythagorean-theorem': 'paa.mat.geometria', 'math.geo.plane-figures-area-perimeter': 'paa.mat.geometria',
  'math.stat.central-tendency': 'paa.mat.datos',
};
/**
 * The SAME construct under a PAA identity of its own (construct name and renderer version): a renderer envelope names
 * its adapters, so the PAA envelope is a different object from the Saber one and never replaces it. Same functions.
 */
const asPaaConstruct = (x: ParametricConstruct<never>): ParametricConstruct<never> => ({ ...x, construct: `PAA_MC_${x.construct}`, rendererVersion: x.rendererVersion.replace(/^tb\.saber\./, 'tb.paa.mc.') });
const asPaa = (s: AdoptionSpec, familyId: string, construct?: ParametricConstruct<never>): AdoptionSpec | null => {
  const objectiveCode = PAA_OBJECTIVE_OF_CONCEPT[s.concept.stableId];
  if (!objectiveCode) return null;
  const { commandTerm: _t, ...rest } = s;
  return { ...rest, construct: asPaaConstruct((construct ?? s.construct) as ParametricConstruct<never>), familyId, adapterId: A, objectiveCode };
};
const IN_CONTEXT: Record<string, ParametricConstruct<never>> = Object.fromEntries(SABER_MATH_CONSTRUCTS_IN_CONTEXT.map((x) => [x.construct.replace(/_IN_CONTEXT$/, ''), x as unknown as ParametricConstruct<never>]));
const FROM_SABER: AdoptionSpec[] = SABER_MATH_ADOPTION_SPECS.flatMap((s) => {
  const id = s.familyId.replace(/^tf\.saber\./, 'tf.paa.mc.');
  const base = asPaa(s, id);
  const ctx = asPaa({ ...s, variables: [...s.variables, { symbol: 'ctx', meaning: 'The situation the task is set in', role: 'PARAMETER', domain: 'CATEGORY' }] }, `${id}-in-context`, IN_CONTEXT[(s.construct as unknown as { construct: string }).construct]);
  return [base, ctx].filter((x): x is AdoptionSpec => x !== null);
});

const NEW_SPECS: AdoptionSpec[] = [
  {
    construct: c(PAA_PERCENT_CHANGE), familyId: 'tf.paa.mc.aritmetica.percent-change', adapterId: A, objectiveCode: 'paa.mat.aritmetica',
    contexts: [{ kind: 'PERSONAL', note: 'Prices of everyday purchases and fees.' }],
    concept: { stableId: 'math.num.percent', canonicalName: 'Porcentajes', canonicalSubject: 'Matemáticas' }, skill: 'Razonamiento proporcional', action: 'COMPUTE',
    object: 'A price and a percentage increase or discount, or the price after an increase.', observable: 'Applies the percentage change as a multiplier, or undoes an increase, and gives the price.',
    structure: 'new = p · (100 ± r) / 100; before = shown · 100 / (100 + r).',
    variables: [{ symbol: 'p', meaning: 'Price before the change (dollars)', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'r', meaning: 'Rate of change (%)', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'kind', meaning: 'Increase, discount or price before an increase', role: 'PARAMETER', domain: 'CATEGORY' }, { symbol: 'ctx', meaning: 'The item priced', role: 'PARAMETER', domain: 'CATEGORY' }, { symbol: 'q', meaning: 'The price asked', role: 'UNKNOWN', domain: 'INTEGER' }],
    relationships: ['q = p (100 + r) / 100', 'q = p (100 - r) / 100', 'p = shown * 100 / (100 + r)'], constraints: ['Every price is a whole number of dollars.', 'The three modelled errors give three different positive values.'],
    misconceptions: [{ id: 'gives-only-the-change', description: 'Gives the amount of the change instead of the new price.', producesError: 'p r / 100' }, { id: 'adds-the-rate-as-dollars', description: 'Adds or subtracts the rate as if it were dollars.', producesError: 'p ± r' }, { id: 'changes-in-the-wrong-direction', description: 'Applies the change in the wrong direction.', producesError: 'p ∓ p r / 100' }, { id: 'subtracts-the-percent-of-the-new-price', description: 'Undoes an increase by taking the same percentage off the new price.', producesError: 'shown (100 - r) / 100' }, { id: 'gives-the-increase', description: 'Gives the increase instead of the earlier price.', producesError: 'shown r / 100' }],
    levers: { FOUNDATIONAL: ['A percentage increase.'], STANDARD: ['A percentage discount.'], CHALLENGE: ['The price before a percentage increase (reverse percentage).'] },
    exclusions: ['Single percentage changes of prices only; successive changes and percentage points are not asked.'], challenge: 'MISCONCEPTION_RESISTANCE',
    path: ['Turn the percentage into a multiplier (1 ± r/100).', 'Multiply, or divide to undo an increase.'], strategies: ['MULTIPLIER', 'FIND_THE_CHANGE_THEN_ADJUST', 'UNIT_PERCENT'], shortcut: ANSWER('gives only the change'),
  },
  {
    construct: c(PAA_SINGLE_DRAW_IN_CONTEXT), familyId: 'tf.paa.mc.probabilidad.single-draw-in-context', adapterId: A, objectiveCode: 'paa.mat.probabilidad',
    contexts: [{ kind: 'PERSONAL', note: 'Drawing one object at random from a container.' }],
    concept: { stableId: 'math.prob.probability', canonicalName: 'Probabilidad', canonicalSubject: 'Matemáticas' }, skill: 'Razonamiento probabilístico', action: 'COMPUTE',
    object: 'A container with three colours of equally likely objects; one is drawn at random.', observable: 'Counts the favourable and the possible outcomes of the event as worded and gives their ratio.',
    structure: 'P = favourable / total, total = red + green + blue.',
    variables: [{ symbol: 'red', meaning: 'Red objects', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'green', meaning: 'Green objects', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'blue', meaning: 'Blue objects', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'n', meaning: 'Total', role: 'PARAMETER', domain: 'INTEGER' }, { symbol: 'k', meaning: 'Favourable', role: 'PARAMETER', domain: 'INTEGER' }, { symbol: 'event', meaning: 'Event asked', role: 'PARAMETER', domain: 'CATEGORY' }, { symbol: 'ctx', meaning: 'The situation', role: 'PARAMETER', domain: 'CATEGORY' }, { symbol: 'q', meaning: 'The probability', role: 'UNKNOWN', domain: 'RATIONAL' }],
    relationships: ['P = k / n'], constraints: ['The three counts differ.', 'The key is never a modelled error.'],
    misconceptions: [{ id: 'odds', description: 'Gives the odds (favourable to unfavourable).', producesError: 'k / (n - k)' }, { id: 'categories', description: 'Counts the colours instead of the objects.', producesError: '1 / 3' }, { id: 'complement', description: 'Gives the probability of the complement.', producesError: '(n - k) / n' }],
    levers: { FOUNDATIONAL: ['One colour.'], STANDARD: ['Two colours together.'], CHALLENGE: ['Not a given colour (complement).'] },
    exclusions: ['A single draw of equally likely objects only.'], challenge: 'MULTI_STAGE_DEPENDENCY',
    path: ['Count all the objects.', 'Count the favourable ones as the event is worded.', 'Give favourable over possible.'], strategies: ['DIRECT_COUNT', 'COMPLEMENT'], shortcut: ANSWER('gives the odds'),
  },
];

export const PAA_MATH_MC_ADOPTION_SPECS: readonly AdoptionSpec[] = [...FROM_SABER, ...NEW_SPECS];
export const PAA_MATH_MC_ENTRIES: readonly LibraryEntry[] = PAA_MATH_MC_ADOPTION_SPECS.map((s) => adoptParametricConstruct(s, OPTIONS));
