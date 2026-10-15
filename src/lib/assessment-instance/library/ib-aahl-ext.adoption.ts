/**
 * IB Mathematics: analysis and approaches HL -- the three StudyUs-original constructs (ib-aahl-ext.constructs.ts) as
 * governed library entries for the objectives the Content Factory constructs leave uncovered:
 *
 *   aahl.p1.extended      IB.MATH_AA_HL.P1  'show that'  math.calc.differentiation  (GOVERNED_PILOT identity)
 *   aahl.p2.trigonometry  IB.MATH_AA_HL.P2  'find'       math.trig.ratios           (GOVERNED: PAA certified record)
 *   aahl.p2.extended      IB.MATH_AA_HL.P2  'find'       math.fun.exponential       (GOVERNED: PAA certified record)
 *
 * Same generic capability as the CF adoption (SHORT_RESPONSE, answer marks, exact numeric policy, canonical scorer).
 * Written by the model, reviewed by nobody.
 */
import type { ParametricConstruct } from './parametric';
import type { LibraryEntry } from './catalogue';
import { adoptParametricConstruct, type AdoptionOptions, type AdoptionSpec } from './cf-ib-aahl-01.adoption';
import { IB_COSINE_RULE_SIDE, IB_EXPONENTIAL_MODEL, IB_SHOW_THAT_STATIONARY_MINIMUM } from './ib-aahl-ext.constructs';

const OPTIONS: AdoptionOptions = { system: 'IB', provenanceNote: 'Track B: StudyUs-original deterministic construct for IB Mathematics: analysis and approaches HL, written in-session by the model; reviewed by nobody. No IB question, markscheme or wording is copied.', referenceSourceKeys: ['ibo-math-aa-guide-2021'], origin: 'TRACK_B_DETERMINISTIC' };
const ANSWER = (what: string) => ({ id: 'answer-equals-a-misconception', bypass: `A learner who ${what} would be marked right if the key equalled that value.`, instanceRule: 'Parameter sets whose key a modelled misconception also gives are dropped.' });
const c = (x: unknown) => x as ParametricConstruct<never>;

export const IB_AAHL_EXT_ADOPTION_SPECS: readonly AdoptionSpec[] = [
  {
    construct: c(IB_SHOW_THAT_STATIONARY_MINIMUM), familyId: 'tf.ib.extended.show-that-stationary-minimum', adapterId: 'IB.MATH_AA_HL.P1', commandTerm: 'show that', objectiveCode: 'aahl.p1.extended',
    concept: { stableId: 'math.calc.differentiation', canonicalName: 'Differentiation' }, skill: 'Algebraic reasoning', action: 'COMPUTE',
    object: 'A cubic curve with integer coefficients whose derivative factorises over the integers.', observable: 'Differentiates, shows where the gradient is zero, identifies the local minimum and gives its y-coordinate.',
    structure: "y = x³ − 3p x² + c or y = x³ − 3p x² − 9p² x + c; y' = 3x(x − 2p) or 3(x + p)(x − 3p); the minimum is at the larger stationary point.",
    variables: [{ symbol: 'p', meaning: 'Scale of the stationary points', role: 'PARAMETER', domain: 'INTEGER' }, { symbol: 'c', meaning: 'Constant term', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'form', meaning: 'Shape of the derivative', role: 'PARAMETER', domain: 'CATEGORY' }, { symbol: 'm', meaning: 'The y-coordinate of the local minimum', role: 'UNKNOWN', domain: 'INTEGER' }],
    relationships: ["y'(x) = 0 at the shown points", "y''(x) > 0 at the local minimum", 'm = y(x_min)'], constraints: ['The derivative has two integer zeros.', 'Exactly one of them is a local minimum.'],
    misconceptions: [{ id: 'gives-the-x-coordinate', description: 'Gives the x-coordinate of the minimum.', producesError: 'x_min' }, { id: 'gives-the-local-maximum', description: 'Evaluates the curve at the other stationary point.', producesError: 'y(x_max)' }, { id: 'gives-the-y-intercept', description: 'Gives y(0).', producesError: 'y(0) = c' }, { id: 'adds-instead-of-subtracting', description: 'Sign error when evaluating the cubic.', producesError: 'c + |cubic part|' }],
    levers: { FOUNDATIONAL: ['y′ = 3x(x − 2p), p = 1 or 2.'], STANDARD: ['y′ = 3x(x − 2p), p = 3 or 4.'], CHALLENGE: ['y′ = 3(x + p)(x − 3p): a linear term and a negative stationary point.'] },
    exclusions: ['Stationary points of a cubic only; points of inflexion and optimisation in context are not asked.'], challenge: 'MULTI_STAGE_DEPENDENCY',
    path: ['Differentiate.', 'Factorise the derivative to show where it is zero.', 'Decide which stationary point is the minimum (second derivative or sign change).', 'Evaluate y there.'], strategies: ['SECOND_DERIVATIVE_TEST', 'FIRST_DERIVATIVE_SIGN_CHANGE', 'CUBIC_SHAPE'], shortcut: ANSWER('gives the value at the local maximum'),
  },
  {
    construct: c(IB_COSINE_RULE_SIDE), familyId: 'tf.ib.trigonometry.cosine-rule-side', adapterId: 'IB.MATH_AA_HL.P2', commandTerm: 'find', objectiveCode: 'aahl.p2.trigonometry',
    concept: { stableId: 'math.trig.ratios', canonicalName: 'Trigonometry and triangles' }, skill: 'Geometric reasoning', action: 'COMPUTE',
    object: 'A triangle with two sides and the included angle of 60° or 120° (or two sides and a non-included 120° angle).', observable: 'Applies the cosine rule and gives the length of the asked side.',
    structure: 'c² = a² + b² − 2ab cos C with C = 60° or 120°, so c² = a² + b² ∓ ab; all three sides are integers.',
    variables: [{ symbol: 'a', meaning: 'Side BC (cm)', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'b', meaning: 'Side AC (cm)', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'angle', meaning: 'Angle ACB (degrees)', role: 'PARAMETER', domain: 'INTEGER' }, { symbol: 'ask', meaning: 'Opposite or adjacent side asked', role: 'PARAMETER', domain: 'CATEGORY' }, { symbol: 'L', meaning: 'The asked side', role: 'UNKNOWN', domain: 'INTEGER' }],
    relationships: ['c^2 = a^2 + b^2 - 2ab cos C', 'cos 60 = 1/2, cos 120 = -1/2'], constraints: ['The two shown sides differ.', 'The asked side is a positive integer.'],
    misconceptions: [{ id: 'uses-pythagoras', description: 'Treats the triangle as right-angled.', producesError: 'sqrt(a^2 + b^2)' }, { id: 'uses-the-wrong-sign-of-the-cosine', description: 'Uses cos 120° = +1/2.', producesError: 'sqrt(a^2 + b^2 + ab) at 60°' }, { id: 'gives-the-square-of-the-side', description: 'Forgets the square root.', producesError: 'c^2' }, { id: 'subtracts-the-shown-sides', description: 'Subtracts the shown sides.', producesError: 'c - a' }, { id: 'gives-the-shown-side', description: 'Gives a shown side.', producesError: 'AB = c' }],
    levers: { FOUNDATIONAL: ['Angle 60°, the side opposite is asked.'], STANDARD: ['Angle 120°, the side opposite is asked.'], CHALLENGE: ['Angle 120°, a side adjacent to it is asked: a quadratic in the unknown side.'] },
    exclusions: ['The cosine rule with exact cosines only; the sine rule, areas and the ambiguous case are not asked.'], challenge: 'NON_OBVIOUS_STRATEGY',
    path: ['Write the cosine rule for the angle shown.', 'Substitute the exact cosine.', 'Solve for the asked side (a quadratic when it is adjacent to the angle).'], strategies: ['COSINE_RULE', 'QUADRATIC_IN_THE_SIDE'], shortcut: ANSWER('uses Pythagoras'),
  },
  {
    construct: c(IB_EXPONENTIAL_MODEL), familyId: 'tf.ib.modelling.exponential-model', adapterId: 'IB.MATH_AA_HL.P2', commandTerm: 'find', objectiveCode: 'aahl.p2.extended',
    concept: { stableId: 'math.fun.exponential', canonicalName: 'Exponential models' }, skill: 'Mathematical modelling', action: 'COMPUTE',
    object: 'An exponential growth or decay model in context with a whole number of periods.', observable: 'Uses the model to give the quantity after a time, or the time until the quantity reaches a value.',
    structure: 'Q(t) = Q0 · b^(t / d) with b = 2, 1/2 or 3 and t a whole multiple of the period d.',
    variables: [{ symbol: 'n0', meaning: 'Initial quantity', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'd', meaning: 'Period of the model', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'k', meaning: 'Number of periods', role: 'PARAMETER', domain: 'INTEGER' }, { symbol: 'model', meaning: 'Growth, decay or time asked', role: 'PARAMETER', domain: 'CATEGORY' }, { symbol: 'q', meaning: 'The quantity or the time', role: 'UNKNOWN', domain: 'INTEGER' }],
    relationships: ['Q(t) = Q0 * b^(t/d)', 't = d * log_b(Q / Q0)'], constraints: ['The time is a whole number of periods.', 'The answer is a positive integer.'],
    misconceptions: [{ id: 'linear-growth', description: 'Adds a fixed amount each period.', producesError: 'Q0 + Q0 k' }, { id: 'one-period-short', description: 'Counts one period fewer.', producesError: 'Q0 b^(k-1)' }, { id: 'uses-the-time-as-the-exponent', description: 'Uses t instead of t/d as the exponent.', producesError: 'Q0 b^t' }, { id: 'gives-the-number-of-periods', description: 'Gives the number of periods instead of the time.', producesError: 'k periods' }],
    levers: { FOUNDATIONAL: ['Growth: N = N0 × 2^(t/d), the number after a time is asked.'], STANDARD: ['Decay: the mass halves each period, the mass after a time is asked.'], CHALLENGE: ['Tripling: the time until a given population is asked (a logarithm).'] },
    exclusions: ['Whole numbers of periods only; continuous e-based models and regression are not asked.'], challenge: 'MULTI_STAGE_DEPENDENCY',
    path: ['Read the base and the period of the model.', 'Find the number of periods.', 'Apply the model, or invert it for the time.'], strategies: ['REPEATED_MULTIPLICATION', 'EXPONENT_LAWS', 'LOGARITHMS'], shortcut: ANSWER('counts one period fewer'),
  },
];

export const IB_AAHL_EXT_ENTRIES: readonly LibraryEntry[] = IB_AAHL_EXT_ADOPTION_SPECS.map((s) => adoptParametricConstruct(s, OPTIONS));
