/**
 * Saber 11.° Matemáticas -- the nine StudyUs-original constructs (saber11-math.constructs.ts) as governed library
 * entries: adapter ICFES.SABER11_MATEMATICAS, Spanish, SELECTED_RESPONSE (the only format the component records),
 * one mark. Each entry is written for ONE official competency (the objective it is placed in) and ONE StudyUs concept
 * that lies inside ONE official content category by a GOVERNED_PILOT correspondence
 * (src/lib/curriculum/icfes/saber11-content-correspondence.ts). Written by the model, reviewed by nobody.
 */
import type { ParametricConstruct } from './parametric';
import type { LibraryEntry } from './catalogue';
import { adoptParametricConstruct, type AdoptionOptions, type AdoptionSpec } from './cf-ib-aahl-01.adoption';
import { SABER_CHECK_THE_MEAN, SABER_CHECK_THE_SYSTEM, SABER_LADDER_HEIGHT, SABER_MEAN_OF_DATA, SABER_PLAN_EQUATION, SABER_RATE_FROM_TABLE, SABER_SCALED_AREA_CLAIM, SABER_SCALE_PLAN_AREA, SABER_TABLE_DIFFERENCE, SABER_MATH_CONSTRUCTS_IN_CONTEXT } from './saber11-math.constructs';
import { saberCorrespondenceOf } from '@/lib/curriculum/icfes/saber11-content-correspondence';

const A = 'ICFES.SABER11_MATEMATICAS';
const OPTIONS: AdoptionOptions = { system: 'ICFES', provenanceNote: 'Track B: StudyUs-original deterministic construct for Saber 11.° Matemáticas practice, written in-session by the model; reviewed by nobody. No ICFES item, released question or wording is copied.', referenceSourceKeys: ['icfes-marco-matematicas-saber11', 'icfes-guia-saber11-2026'], origin: 'TRACK_B_DETERMINISTIC', language: 'es', responseFormat: 'SELECTED_RESPONSE', marksByBand: { FOUNDATIONAL: 1, STANDARD: 1, CHALLENGE: 1 } };
const ANSWER = (what: string) => ({ id: 'answer-equals-a-misconception', bypass: `A learner who ${what} would find the key among the options if it equalled that value.`, instanceRule: 'Parameter sets whose key a modelled misconception also gives are dropped; every distractor is a modelled misconception value.' });
const c = (x: unknown) => x as ParametricConstruct<never>;
/** The concept of an entry: only through a GOVERNED_PILOT correspondence (an item with no canonical concept is never built). */
const concept = (stableId: string) => { const r = saberCorrespondenceOf(stableId); if (!r) throw new Error(`SABER_CONCEPT_NOT_GOVERNED ${stableId}`); return { stableId, canonicalName: r.studyusConceptName, canonicalSubject: 'Matemáticas' }; };
const INT = 'saber.interpretacion'; const FOR = 'saber.formulacion'; const ARG = 'saber.argumentacion';

export const SABER_MATH_ADOPTION_SPECS: readonly AdoptionSpec[] = [
  // ---------------------------------------------------------------- Interpretación y representación
  {
    construct: c(SABER_TABLE_DIFFERENCE), familyId: 'tf.saber.interpretacion.table-difference', adapterId: A, objectiveCode: INT, contexts: [{ kind: 'SOCIETAL', note: 'A school survey of favourite sports.' }], alsoActions: ['INTERPRET'],
    concept: concept('math.stat.data-representation'), skill: 'Interpretación de información', action: 'COMPUTE',
    object: 'A frequency table of four categories.', observable: 'Reads the frequencies the question compares and gives their difference.',
    structure: 'difference = f(A) − f(B) or f(A) − (f(C) + f(D)).',
    variables: [{ symbol: 'a', meaning: 'Frequency A', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'b', meaning: 'Frequency B', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'c', meaning: 'Frequency C', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'd', meaning: 'Frequency D', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'ask', meaning: 'Which comparison', role: 'PARAMETER', domain: 'CATEGORY' }, { symbol: 'k', meaning: 'The difference', role: 'UNKNOWN', domain: 'INTEGER' }],
    relationships: ['k = a - b', 'k = a - (c + d)'], constraints: ['The difference is positive.'],
    misconceptions: [{ id: 'adds-instead-of-subtracting', description: 'Adds the frequencies compared.', producesError: 'a + b' }, { id: 'gives-the-largest-frequency', description: 'Gives the largest frequency.', producesError: 'the value a' }, { id: 'gives-the-total-surveyed', description: 'Gives the total surveyed.', producesError: 'a + b + c + d' }, { id: 'compares-with-one-category-only', description: 'Compares with one category only.', producesError: 'a - c' }],
    levers: { FOUNDATIONAL: ['Two categories, multiples of five.'], STANDARD: ['Two categories, not both multiples of five.'], CHALLENGE: ['One category against the sum of two.'] },
    exclusions: ['Reading a table of counts only.'], challenge: 'MULTI_STAGE_DEPENDENCY',
    path: ['Locate the frequencies the question names.', 'Subtract.'], strategies: ['DIRECT_READING'], shortcut: ANSWER('adds instead of subtracting'),
  },
  {
    construct: c(SABER_RATE_FROM_TABLE), familyId: 'tf.saber.interpretacion.rate-from-table', adapterId: A, objectiveCode: INT, contexts: [{ kind: 'PERSONAL', note: 'The cost of renting a bicycle by the hour.' }], alsoActions: ['INTERPRET'],
    concept: concept('math.fun.linear-functions-lines'), skill: 'Interpretación de información', action: 'COMPUTE',
    object: 'A table of three rows of a linear relation (hours -> cost).', observable: 'Reads the constant rate of change of the linear relation from the table.',
    structure: 'cost = b + m · hours; m = Δcost / Δhours.',
    variables: [{ symbol: 'b', meaning: 'Fixed charge', role: 'PARAMETER', domain: 'INTEGER' }, { symbol: 'm', meaning: 'Rate per hour', role: 'UNKNOWN', domain: 'INTEGER' }, { symbol: 'x0', meaning: 'First hour shown', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'step', meaning: 'Step between rows', role: 'GIVEN', domain: 'INTEGER' }],
    relationships: ['m = (c3 - c1) / (h3 - h1)'], constraints: ['The rate is a positive integer.'],
    misconceptions: [{ id: 'reads-the-cost-difference-between-rows', description: 'Takes the cost difference between rows as the rate when rows are more than one hour apart.', producesError: 'c2 - c1' }, { id: 'divides-cost-by-hours', description: 'Divides a cost by its hours.', producesError: 'c1 / h1' }, { id: 'gives-the-fixed-charge', description: 'Gives the fixed charge.', producesError: 'the value b' }, { id: 'gives-the-first-cost', description: 'Gives the first cost of the table.', producesError: 'the value c1' }, { id: 'reads-the-last-cost', description: 'Gives the last cost of the table.', producesError: 'the value c3' }],
    levers: { FOUNDATIONAL: ['Rows one hour apart, from 1 hour.'], STANDARD: ['Rows two hours apart.'], CHALLENGE: ['Rows three hours apart, not from 1 hour.'] },
    exclusions: ['Linear relations given by a table only.'], challenge: 'MISCONCEPTION_RESISTANCE',
    path: ['Take two rows.', 'Divide the change in cost by the change in hours.'], strategies: ['RATE_OF_CHANGE', 'SUCCESSIVE_DIFFERENCES'], shortcut: ANSWER('takes the cost difference between rows'),
  },
  {
    construct: c(SABER_SCALE_PLAN_AREA), familyId: 'tf.saber.interpretacion.scale-plan-area', adapterId: A, objectiveCode: INT, contexts: [{ kind: 'OCCUPATIONAL', note: 'Reading a house plan drawn to scale.' }], alsoActions: ['INTERPRET'],
    concept: concept('math.geo.plane-figures-area-perimeter'), skill: 'Interpretación de información', action: 'COMPUTE',
    object: 'A rectangle on a plan drawn at scale 1 : 100 or 1 : 200.', observable: 'Converts the plan lengths to real lengths and gives the real area.',
    structure: 'real area = (a · s/100) · (b · s/100) m².',
    variables: [{ symbol: 'a', meaning: 'Plan length (cm)', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'b', meaning: 'Plan width (cm)', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'scale', meaning: 'Scale denominator', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'A', meaning: 'Real area (m²)', role: 'UNKNOWN', domain: 'INTEGER' }],
    relationships: ['A = (a s / 100)(b s / 100)'], constraints: ['The room is longer than it is wide.'],
    misconceptions: [{ id: 'scales-the-area-linearly', description: 'Applies the scale factor to the area once (1 : 200).', producesError: '2 a b' }, { id: 'squares-the-longer-side', description: 'Squares the longer real side as if the room were square.', producesError: '(a s / 100)^2' }, { id: 'gives-the-perimeter', description: 'Gives the real perimeter.', producesError: '2 (a + b) s / 100' }, { id: 'gives-the-plan-area', description: 'Gives the area on the plan.', producesError: 'a b' }, { id: 'adds-the-sides', description: 'Adds the real sides.', producesError: '(a + b) s / 100' }],
    levers: { FOUNDATIONAL: ['Scale 1 : 100, a small room.'], STANDARD: ['Scale 1 : 100, a larger room.'], CHALLENGE: ['Scale 1 : 200.'] },
    exclusions: ['Rectangles on a plan only.'], challenge: 'MISCONCEPTION_RESISTANCE',
    path: ['Convert each plan length to metres.', 'Multiply.'], strategies: ['CONVERT_THEN_MULTIPLY', 'AREA_SCALE_FACTOR'], shortcut: ANSWER('scales the area linearly'),
  },
  // ---------------------------------------------------------------- Formulación y ejecución
  {
    construct: c(SABER_MEAN_OF_DATA), familyId: 'tf.saber.formulacion.mean-of-data', adapterId: A, objectiveCode: FOR, contexts: [{ kind: 'OCCUPATIONAL', note: 'Daily sales of a shop.' }], alsoActions: ['FORMULATE'],
    concept: concept('math.stat.central-tendency'), skill: 'Planteamiento y ejecución', action: 'COMPUTE',
    object: 'Four or five data values.', observable: 'Computes the arithmetic mean of the data.',
    structure: 'mean = (sum of the values) / (number of values).',
    variables: [{ symbol: 'v1', meaning: 'Value 1', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'v2', meaning: 'Value 2', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'v3', meaning: 'Value 3', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'v4', meaning: 'Value 4', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'v5', meaning: 'Value 5 (0 = absent)', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'm', meaning: 'The mean', role: 'UNKNOWN', domain: 'INTEGER' }],
    relationships: ['m = sum / n'], constraints: ['The mean is an integer and differs from the median.'],
    misconceptions: [{ id: 'gives-the-median', description: 'Gives the median.', producesError: 'median' }, { id: 'divides-by-one-less', description: 'Divides by n − 1.', producesError: 'sum / (n - 1)' }, { id: 'gives-the-sum', description: 'Gives the sum.', producesError: 'sum' }, { id: 'averages-the-extremes', description: 'Averages the smallest and the largest value.', producesError: '(min + max) / 2' }, { id: 'gives-the-range', description: 'Gives the range.', producesError: 'max - min' }],
    levers: { FOUNDATIONAL: ['Four values; the mean is a multiple of 5.'], STANDARD: ['Four values; the mean is not a multiple of 5.'], CHALLENGE: ['Five values.'] },
    exclusions: ['The mean only.'], challenge: 'MISCONCEPTION_RESISTANCE',
    path: ['Add the values.', 'Divide by how many there are.'], strategies: ['SUM_AND_DIVIDE', 'DEVIATIONS_FROM_A_REFERENCE'], shortcut: ANSWER('gives the median'),
  },
  {
    construct: c(SABER_PLAN_EQUATION), familyId: 'tf.saber.formulacion.plan-equation', adapterId: A, objectiveCode: FOR, contexts: [{ kind: 'PERSONAL', note: 'A mobile data plan bill.' }], alsoActions: ['FORMULATE'],
    concept: concept('math.alg.linear-equations'), skill: 'Planteamiento y ejecución', action: 'SOLVE',
    object: 'A bill with a fixed charge and a price per unit.', observable: 'Formulates the bill as a linear equation and solves it for the number of units.',
    structure: 'f + p g = T ⇒ g = (T − f) / p.',
    variables: [{ symbol: 'f', meaning: 'Fixed charge', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'p', meaning: 'Price per GB', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'g', meaning: 'Gigabytes', role: 'UNKNOWN', domain: 'INTEGER' }],
    relationships: ['f + p g = T'], constraints: ['The number of gigabytes is a positive integer.'],
    misconceptions: [{ id: 'divides-the-bill-by-the-price', description: 'Divides the bill by the price, ignoring the fixed charge.', producesError: 'T / p' }, { id: 'adds-the-fixed-charge', description: 'Adds the fixed charge instead of subtracting it.', producesError: '(T + f) / p' }, { id: 'subtracts-the-price-from-the-bill', description: 'Subtracts the price from the bill.', producesError: 'T - p' }, { id: 'gives-the-variable-part', description: 'Gives the variable part of the bill.', producesError: 'p g' }],
    levers: { FOUNDATIONAL: ['Price per GB up to 5; fixed charge a multiple of 10.'], STANDARD: ['Price per GB above 5; fixed charge a multiple of 10.'], CHALLENGE: ['Fixed charge not a multiple of 10.'] },
    exclusions: ['One linear equation in context.'], challenge: 'MISCONCEPTION_RESISTANCE',
    path: ['Subtract the fixed charge from the bill.', 'Divide by the price per unit.'], strategies: ['INVERSE_OPERATIONS', 'LINEAR_EQUATION'], shortcut: ANSWER('ignores the fixed charge'),
  },
  {
    construct: c(SABER_LADDER_HEIGHT), familyId: 'tf.saber.formulacion.ladder-height', adapterId: A, objectiveCode: FOR, contexts: [{ kind: 'OCCUPATIONAL', note: 'A ladder leaning on a wall.' }], alsoActions: ['FORMULATE'],
    concept: concept('math.geo.pythagorean-theorem'), skill: 'Planteamiento y ejecución', action: 'COMPUTE',
    object: 'A right triangle formed by a ladder, a wall and the ground (Pythagorean triple).', observable: 'Formulates the situation as a right triangle and gives the missing leg.',
    structure: 'h² + a² = c² ⇒ h = √(c² − a²).',
    variables: [{ symbol: 'a', meaning: 'Distance of the foot (m)', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'h', meaning: 'Height reached (m)', role: 'UNKNOWN', domain: 'INTEGER' }, { symbol: 'k', meaning: 'Scale of the triple', role: 'PARAMETER', domain: 'INTEGER' }],
    relationships: ['h^2 + a^2 = c^2'], constraints: ['All three lengths are whole metres.'],
    misconceptions: [{ id: 'subtracts-the-lengths', description: 'Subtracts the lengths.', producesError: 'c - a' }, { id: 'adds-the-squares', description: 'Adds the squares (the hypotenuse rule for a leg).', producesError: 'sqrt(c^2 + a^2)' }, { id: 'forgets-the-square-root', description: 'Forgets the square root.', producesError: 'c^2 - a^2' }, { id: 'gives-the-ladder-length', description: 'Gives the ladder length.', producesError: 'the value c' }, { id: 'gives-the-foot-distance', description: 'Gives the distance of the foot from the wall.', producesError: 'the value a' }],
    levers: { FOUNDATIONAL: ['Basic triple, the foot is the shorter leg.'], STANDARD: ['Basic triple, the foot is the longer leg.'], CHALLENGE: ['A doubled triple.'] },
    exclusions: ['Right triangles with whole sides only.'], challenge: 'MISCONCEPTION_RESISTANCE',
    path: ['Identify the hypotenuse (the ladder).', 'Subtract the squares.', 'Take the square root.'], strategies: ['PYTHAGOREAN_RELATION', 'RECOGNISED_TRIPLE'], shortcut: ANSWER('subtracts the lengths'),
  },
  // ---------------------------------------------------------------- Argumentación
  {
    construct: c(SABER_CHECK_THE_MEAN), familyId: 'tf.saber.argumentacion.check-the-mean', adapterId: A, objectiveCode: ARG, contexts: [{ kind: 'SOCIETAL', note: 'A student checks a classmate\'s average.' }], alsoActions: ['EVALUATE'],
    concept: concept('math.stat.central-tendency'), skill: 'Validación de procedimientos', action: 'COMPUTE',
    object: 'A mean computed with a flawed procedure (divided by n − 1).', observable: 'Validates the procedure, rejects the flawed result and gives the correct mean.',
    structure: 'correct mean = sum / 4; the flawed one is sum / 3.',
    variables: [{ symbol: 'v1', meaning: 'Score 1', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'v2', meaning: 'Score 2', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'v3', meaning: 'Score 3', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'v4', meaning: 'Score 4', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'm', meaning: 'The correct mean', role: 'UNKNOWN', domain: 'INTEGER' }],
    relationships: ['m = (v1 + v2 + v3 + v4) / 4'], constraints: ['Both quotients are integers.'],
    misconceptions: [{ id: 'accepts-the-flawed-procedure', description: 'Accepts the classmate\'s result.', producesError: 'sum / 3' }, { id: 'gives-the-sum', description: 'Gives the sum.', producesError: 'sum' }, { id: 'averages-the-extremes', description: 'Averages the smallest and largest scores.', producesError: '(min + max) / 2' }, { id: 'divides-by-five', description: 'Divides by five.', producesError: 'sum / 5' }, { id: 'gives-the-range', description: 'Gives the range.', producesError: 'max - min' }],
    levers: { FOUNDATIONAL: ['Sum up to 120.'], STANDARD: ['Sum from 121 to 180.'], CHALLENGE: ['Sum above 180.'] },
    exclusions: ['Validating a mean only.'], challenge: 'MISCONCEPTION_RESISTANCE',
    path: ['Check the divisor against the number of data.', 'Recompute the mean.'], strategies: ['PROCEDURE_CHECK', 'RECOMPUTE'], shortcut: ANSWER('accepts the flawed result'),
  },
  {
    construct: c(SABER_CHECK_THE_SYSTEM), familyId: 'tf.saber.argumentacion.check-the-system', adapterId: A, objectiveCode: ARG, contexts: [{ kind: 'SOCIETAL', note: 'A student checks a classmate\'s solution of a system.' }], alsoActions: ['EVALUATE'],
    concept: concept('math.alg.linear-systems'), skill: 'Validación de procedimientos', action: 'SOLVE',
    object: 'A 2×2 linear system solved by elimination with a step left out (the sum not halved).', observable: 'Validates the elimination, rejects the flawed conclusion and gives the correct value of x.',
    structure: 'x + y = s and x − y = d ⇒ 2x = s + d ⇒ x = (s + d)/2.',
    variables: [{ symbol: 'x', meaning: 'Value of x', role: 'UNKNOWN', domain: 'INTEGER' }, { symbol: 'y', meaning: 'Value of y', role: 'PARAMETER', domain: 'INTEGER' }, { symbol: 'k', meaning: 'Common factor of the first equation', role: 'GIVEN', domain: 'INTEGER' }],
    relationships: ['2x = s + d'], constraints: ['x > y > 0.'],
    misconceptions: [{ id: 'accepts-the-flawed-conclusion', description: 'Accepts the classmate\'s x (the sum not halved).', producesError: 's + d' }, { id: 'gives-the-value-of-y', description: 'Gives y.', producesError: 'the value y' }, { id: 'gives-the-sum-of-the-unknowns', description: 'Gives x + y.', producesError: 'x + y' }, { id: 'subtracts-the-equations', description: 'Gives x − y.', producesError: 'x - y' }],
    levers: { FOUNDATIONAL: ['Coefficients 1.'], STANDARD: ['The first equation multiplied by 2.'], CHALLENGE: ['The first equation multiplied by 3.'] },
    exclusions: ['Two linear equations in two unknowns.'], challenge: 'MISCONCEPTION_RESISTANCE',
    path: ['Find the omitted step.', 'Halve the sum.'], strategies: ['ELIMINATION', 'SUBSTITUTION_CHECK'], shortcut: ANSWER('accepts the flawed conclusion'),
  },
  {
    construct: c(SABER_SCALED_AREA_CLAIM), familyId: 'tf.saber.argumentacion.scaled-area-claim', adapterId: A, objectiveCode: ARG, contexts: [{ kind: 'SOCIETAL', note: 'A student\'s claim about enlarging a rectangle.' }], alsoActions: ['EVALUATE'],
    concept: concept('math.geo.plane-figures-area-perimeter'), skill: 'Validación de procedimientos', action: 'COMPUTE',
    object: 'A rectangle whose sides are multiplied by k, with a false claim that its area is multiplied by k.', observable: 'Refutes the claim and gives the correct new area (k² times the original).',
    structure: 'new area = (k a)(k b) = k² a b.',
    variables: [{ symbol: 'a', meaning: 'Length (cm)', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'b', meaning: 'Width (cm)', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'k', meaning: 'Scale factor', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'A', meaning: 'New area', role: 'UNKNOWN', domain: 'INTEGER' }],
    relationships: ['A = k^2 a b'], constraints: ['The rectangle is longer than it is wide.'],
    misconceptions: [{ id: 'accepts-the-linear-claim', description: 'Accepts that the area is multiplied by k.', producesError: 'k a b' }, { id: 'adds-the-factor-to-each-side', description: 'Adds k to each side instead of multiplying.', producesError: '(a + k)(b + k)' }, { id: 'gives-the-new-perimeter', description: 'Gives the new perimeter.', producesError: '2k(a + b)' }, { id: 'cubes-the-factor', description: 'Multiplies the area by k cubed.', producesError: 'k^3 a b' }],
    levers: { FOUNDATIONAL: ['Factor 2.'], STANDARD: ['Factor 3.'], CHALLENGE: ['Factor 4.'] },
    exclusions: ['Rectangles only.'], challenge: 'MISCONCEPTION_RESISTANCE',
    path: ['Compute the new sides.', 'Multiply them (or square the factor).'], strategies: ['RECOMPUTE', 'AREA_SCALE_FACTOR'], shortcut: ANSWER('accepts the linear claim'),
  },
];

export const SABER_MATH_ENTRIES: readonly LibraryEntry[] = SABER_MATH_ADOPTION_SPECS.map((s) => adoptParametricConstruct(s, OPTIONS));

/**
 * TB-SABER-MATH-A2 (2026-10-15): the same nine entries presented in several situations each, so that one form can place
 * as many DISTINCT templates as its cell has positions (a form never repeats a template). Own family and construct
 * (`-in-context`); same concept, competency, category, key, misconceptions and certification route as A1.
 */
const IN_CONTEXT: Record<string, ParametricConstruct<never>> = Object.fromEntries(SABER_MATH_CONSTRUCTS_IN_CONTEXT.map((x) => [x.construct.replace(/_IN_CONTEXT$/, ''), x as unknown as ParametricConstruct<never>]));
export const SABER_MATH_IN_CONTEXT_ENTRIES: readonly LibraryEntry[] = SABER_MATH_ADOPTION_SPECS.map((s) => adoptParametricConstruct({
  ...s, construct: IN_CONTEXT[(s.construct as unknown as { construct: string }).construct], familyId: `${s.familyId}-in-context`,
  variables: [...s.variables, { symbol: 'ctx', meaning: 'The situation the task is set in', role: 'PARAMETER', domain: 'CATEGORY' }],
}, OPTIONS));
