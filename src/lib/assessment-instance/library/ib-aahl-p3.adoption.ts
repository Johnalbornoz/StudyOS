/**
 * IB Mathematics: analysis and approaches HL Paper 3 -- the StudyUs-original investigation construct
 * (ib-aahl-p3.constructs.ts) as a governed library entry for the one Paper 3 objective:
 *
 *   aahl.p3.investigation  IB.MATH_AA_HL.P3  'show that'  math.alg.sequences-series  (GOVERNED_PILOT identity)
 *
 * Paper 3's governed written formats are MATH_EXPRESSION / EXTENDED_RESPONSE (registered-systems.ts). MATH_EXPRESSION is a
 * closed format and cannot carry IB's marked parts (adapt.ts), so the item is EXTENDED_RESPONSE: ONE exact value, the
 * "hence" result, judged by the canonical numeric contract, answer marks only (the shown working is not assessed).
 * Written by the model, reviewed by nobody.
 */
import type { ParametricConstruct } from './parametric';
import type { LibraryEntry } from './catalogue';
import { adoptParametricConstruct, type AdoptionOptions, type AdoptionSpec } from './cf-ib-aahl-01.adoption';
import { IB_P3_ARITHMETIC_SUM_INVESTIGATION } from './ib-aahl-p3.constructs';

const OPTIONS: AdoptionOptions = { system: 'IB', provenanceNote: 'Track B: StudyUs-original deterministic investigation construct for IB Mathematics: analysis and approaches HL Paper 3, written in-session by the model; reviewed by nobody. No IB question, markscheme or wording is copied.', referenceSourceKeys: ['ibo-math-aa-guide-2021'], origin: 'TRACK_B_DETERMINISTIC', responseFormat: 'EXTENDED_RESPONSE' };
const c = (x: unknown) => x as ParametricConstruct<never>;

export const IB_AAHL_P3_ADOPTION_SPECS: readonly AdoptionSpec[] = [
  {
    construct: c(IB_P3_ARITHMETIC_SUM_INVESTIGATION), familyId: 'tf.ib.investigation.arithmetic-sum-pattern', adapterId: 'IB.MATH_AA_HL.P3', commandTerm: 'show that', objectiveCode: 'aahl.p3.investigation',
    concept: { stableId: 'math.alg.sequences-series', canonicalName: 'Sequences and series' }, skill: 'Generalisation and proof', action: 'COMPUTE', alsoActions: ['INTERPRET'],
    object: 'A pattern of rows whose sizes form an arithmetic sequence with integer first term and common difference.', observable: 'Shows the general sum of the first n rows and uses it to give a total, or the number of rows for a given total.',
    structure: 'u_k = a + (k − 1)d; S_n = (n/2)(2a + (n − 1)d); the hence part asks S_n, the n with S_n = N, or the least n with S_n > N.',
    variables: [{ symbol: 'a', meaning: 'Tiles in the first row', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'd', meaning: 'Common difference', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'n', meaning: 'Number of rows', role: 'PARAMETER', domain: 'INTEGER' }, { symbol: 'r', meaning: 'Excess of N over a sum of the pattern', role: 'PARAMETER', domain: 'INTEGER' }, { symbol: 'ask', meaning: 'Total, exact rows or least rows asked', role: 'PARAMETER', domain: 'CATEGORY' }, { symbol: 'q', meaning: 'The total or the number of rows', role: 'UNKNOWN', domain: 'INTEGER' }],
    relationships: ['u_k = a + (k - 1) d', 'S_n = n/2 (2a + (n - 1) d)', 'S_n - S_(n-1) = u_n'], constraints: ['The first row and the common difference differ.', 'The answer is a positive integer.'],
    misconceptions: [{ id: 'gives-the-last-row', description: 'Gives the size of the last row instead of the total.', producesError: 'u_n' }, { id: 'ignores-the-common-difference', description: 'Treats every row as the first row.', producesError: 'n a' }, { id: 'one-row-short', description: 'Counts one row fewer.', producesError: 'S_(n-1) or n - 1' }, { id: 'uses-n-for-n-minus-one', description: 'Uses n d instead of (n − 1) d in the general sum.', producesError: 'n/2 (2a + n d)' }, { id: 'divides-by-the-first-row', description: 'Divides the total by the first row.', producesError: 'N / a' }, { id: 'one-row-too-many', description: 'Counts one row more.', producesError: 'n + 1' }],
    levers: { FOUNDATIONAL: ['The total of the first n rows is asked.'], STANDARD: ['The number of rows for an exact total is asked: a quadratic in n.'], CHALLENGE: ['The least number of rows exceeding a total that is not a sum of the pattern: an inequality in n.'] },
    exclusions: ['Arithmetic patterns only; geometric patterns, proof by induction and sums to infinity are not asked.'], challenge: 'MULTI_STAGE_DEPENDENCY',
    path: ['Write the k-th row as a + (k − 1)d.', 'Add the first n rows (pair the first and last rows) to show the general sum.', 'Use the general sum for the asked total, or solve for n (an equation or an inequality).'], strategies: ['PAIRING_FIRST_AND_LAST', 'ARITHMETIC_SERIES_FORMULA', 'QUADRATIC_IN_N'], shortcut: { id: 'answer-equals-a-misconception', bypass: 'A learner who counts one row fewer would be marked right if the key equalled that value.', instanceRule: 'Parameter sets whose key a modelled misconception also gives are dropped.' },
  },
];

export const IB_AAHL_P3_ENTRIES: readonly LibraryEntry[] = IB_AAHL_P3_ADOPTION_SPECS.map((s) => adoptParametricConstruct(s, OPTIONS));
