/**
 * EA-1 -- the mathematics PROOF OF CONCEPT: ten MATH_PROBLEM task families (pure data, no IO).
 *
 * WHAT THIS IS, HONESTLY. Ten families drafted in one session by the model working on the phase, at the
 * coordinator's request (`authoringKind: 'STUDYUS_GENERATED'`). Every one is `lifecycle: 'DRAFT'` and
 * `reviewStatus: 'UNREVIEWED'`: no mathematician and no assessment specialist has read them. They exist to test
 * the architecture -- can one evidence target be carried into several assessment systems? -- and are not a
 * catalogue to produce from. They hold no question, no stem and no number of an item, and no text of any source.
 *
 * Two families per concept, deliberately unlike: one PROCEDURAL (the structure is given, the learner works it) and
 * one that needs the learner to build or judge (FORMULATE / INTERPRET / EVALUATE). That is what makes the support
 * matrix non-uniform: a procedural family cannot meet a system that requires transfer, and says so.
 *
 * CONCEPTS are certified PAA identities, by stable id, with THEIR OWN canonical subject. Four of the five live in
 * `Matemáticas`; `math.alg.quadratics` lives in `Mathematics`. The two subjects are never merged or equated here.
 *
 * `profileSupport` is StudyUs's draft judgement of ASSESSMENT-BEHAVIOUR fit, with a reason wherever it is not a
 * plain yes. `canonicalKnowledgeAvailability` is a FACT READ FROM THE REPOSITORY and nothing else:
 *   PAA        the concept is one of the 61 certified PAA identities
 *   others     a reviewed objective -> concept link of that exam family names this exact (subject, name), or not
 * A test recomputes every entry from the catalogue's link tables. Where it says NOT_CERTIFIED_FOR_THIS_EXAM_FAMILY
 * the family may still fit the system's behaviour; whether its concept may be assessed there is not ours to infer.
 */
import { MATH_PROBLEM_FAMILY_TYPE, type MathProblemSpecialization, type MathTaskFamily } from './math-problem';
import { TASK_FAMILY_CONTRACT_VERSION, type ConceptReference, type KnowledgeAvailability, type ProfileSupport, type SupportConstraint } from './task-family';

/** The assessment-system profile ids the proof of concept adapts into. Keys only: this directory imports no profile. */
export const MATH_POC_PROFILE_IDS = ['PAA', 'IB', 'CAMBRIDGE', 'PISA', 'ICFES'] as const;
export type MathPocProfileId = (typeof MATH_POC_PROFILE_IDS)[number];
export const MATH_POC_FAMILY_VERSION = '0.1.0-draft' as const;
export const MATH_POC_AUTHORED_AT = '2026-10-11T00:00:00Z' as const;

const RATIO: ConceptReference = { stableId: 'math.num.ratio-proportion', canonicalSubject: 'Matemáticas', canonicalName: 'Proporcionalidad' };
const LINEAR: ConceptReference = { stableId: 'math.fun.linear-functions-lines', canonicalSubject: 'Matemáticas', canonicalName: 'Rectas y funciones lineales' };
const QUADRATICS: ConceptReference = { stableId: 'math.alg.quadratics', canonicalSubject: 'Mathematics', canonicalName: 'Quadratic functions and inequalities' };
const PROBABILITY: ConceptReference = { stableId: 'math.prob.probability', canonicalSubject: 'Matemáticas', canonicalName: 'Probabilidad' };
const DATA: ConceptReference = { stableId: 'math.stat.data-representation', canonicalSubject: 'Matemáticas', canonicalName: 'Representación e interpretación de datos' };

const CERTIFIED: KnowledgeAvailability = { status: 'CERTIFIED_FOR_THIS_EXAM_FAMILY', basis: 'One of the 61 certified PAA concept identities (F-DATA).' };
const NOT: KnowledgeAvailability = { status: 'NOT_CERTIFIED_FOR_THIS_EXAM_FAMILY', basis: 'No certified identity and no reviewed objective link of this exam family names this concept.' };
const linked = (...objectiveCodes: string[]): KnowledgeAvailability => ({ status: 'CATALOGUE_LINK_RECORDED', basis: `Reviewed objective link(s): ${objectiveCodes.join(', ')}.` });

/**
 * The objective codes whose reviewed link names each concept, per profile. The single statement of the
 * availability facts; a test checks each code against `allLearningLinks()` and that no link was left out.
 */
export const MATH_POC_KNOWLEDGE_LINKS: Readonly<Record<string, Partial<Record<MathPocProfileId, readonly string[]>>>> = {
  [RATIO.stableId]: { PISA: ['pisa.cantidad.formular'] },
  [LINEAR.stableId]: {},
  [QUADRATICS.stableId]: { IB: ['aahl.p1.functions', 'aasl.p1.functions'], CAMBRIDGE: ['aice.9709.p1.quadratics'] },
  [PROBABILITY.stableId]: { PISA: ['pisa.incertidumbre.interpretar', 'pisa.incertidumbre.razonar'] },
  [DATA.stableId]: {},
};
const availabilityOf = (concept: ConceptReference): Record<MathPocProfileId, KnowledgeAvailability> => {
  const links = MATH_POC_KNOWLEDGE_LINKS[concept.stableId];
  const of = (p: MathPocProfileId): KnowledgeAvailability => (links[p]?.length ? linked(...links[p]!) : NOT);
  return { PAA: CERTIFIED, IB: of('IB'), CAMBRIDGE: of('CAMBRIDGE'), PISA: of('PISA'), ICFES: of('ICFES') };
};

const S: ProfileSupport = { status: 'SUPPORTED' };
const C = (...constraints: SupportConstraint[]): ProfileSupport => ({ status: 'SUPPORTED_WITH_CONSTRAINTS', constraints });
const U = (reason: string): ProfileSupport => ({ status: 'UNSUPPORTED', reason });

/** Reasons used by more than one family. Each states an assessment-behaviour fact about the FAMILY. */
const NO_TRANSFER = 'The task hands the learner the structure and asks only for the working: nothing is formulated from a situation and nothing is interpreted back into one, so it cannot show transfer.';
const NEEDS_STEPS: SupportConstraint = { kind: 'DIFFICULTY_ONLY', bands: ['STANDARD', 'CHALLENGE'], reason: 'At the foundational band the task is one line of working; a response marked on shown method needs the composed variants of the STEPS lever.' };
const NUMERIC_ONLY: SupportConstraint = { kind: 'RESPONSE_FORMAT_ONLY', formats: ['NUMERIC_ENTRY'], reason: 'With options to choose from, the answer can be found by trying each one; only a produced number shows the method the family is evidence of.' };
const NO_PRODUCED_RESPONSE = 'The family excludes selected response (options allow substitution instead of the method), and a system that offers nothing else cannot host it.';
const NEEDS_CALCULATOR = 'The family works on realistic multi-digit data by design and needs a calculator; a system that allows none cannot host it.';

type Draft = Pick<MathTaskFamily, 'familyId' | 'primaryConcepts' | 'targetSkills' | 'evidenceTarget' | 'supportedContexts' | 'difficultyLevers' | 'commonMisconceptions' | 'responseConstraints'> & { support: Record<MathPocProfileId, ProfileSupport>; specialization: MathProblemSpecialization };

const family = (d: Draft): MathTaskFamily => ({
  v: TASK_FAMILY_CONTRACT_VERSION, familyId: d.familyId, version: MATH_POC_FAMILY_VERSION, familyType: MATH_PROBLEM_FAMILY_TYPE, canonicalSubject: d.primaryConcepts[0].canonicalSubject, primaryConcepts: d.primaryConcepts,
  targetSkills: d.targetSkills, targetCompetencies: ['dev.comp.math-reasoning'], evidenceTarget: d.evidenceTarget, supportedContexts: d.supportedContexts, difficultyLevers: d.difficultyLevers, commonMisconceptions: d.commonMisconceptions,
  responseConstraints: d.responseConstraints, profileSupport: d.support, canonicalKnowledgeAvailability: availabilityOf(d.primaryConcepts[0]),
  provenance: { authoredBy: 'STUDYUS', authoringKind: 'STUDYUS_GENERATED', authoredAt: MATH_POC_AUTHORED_AT, referenceSourceKeys: ['studyus.q1.paa-certified-catalogue'], containsCopiedProtectedExpression: false, note: 'EA-1 proof of concept: drafted in-session by the model; unreviewed.' },
  lifecycle: 'DRAFT', reviewStatus: 'UNREVIEWED', specialization: d.specialization,
});

const ABSTRACT = { kind: 'ABSTRACT' as const, note: 'The quantities or the expression are given directly, with no situation.' };
const ctx = (kind: 'PERSONAL' | 'OCCUPATIONAL' | 'SOCIETAL' | 'SCIENTIFIC', note: string) => ({ kind, note });
const NO_STIMULUS = { stimulusNeed: 'NONE' as const, stimulusKinds: [] as string[] };

export const MATH_POC_FAMILIES: readonly MathTaskFamily[] = [
  // ---------------------------------------------------------------- Proporcionalidad (Matemáticas)
  family({
    familyId: 'tf.math.proportion.missing-value', primaryConcepts: [RATIO], targetSkills: ['Razonamiento proporcional'],
    evidenceTarget: { actions: ['SOLVE'], object: 'A direct proportion between two quantities in which three of the four values are given.', observablePerformance: 'Finds the fourth value by keeping the ratio between the two quantities constant.' },
    supportedContexts: [ABSTRACT, ctx('PERSONAL', 'An everyday pairing of two quantities that only names them (amount and cost, time and distance at a steady rate).')],
    difficultyLevers: [{ lever: 'scale-factor', kind: 'NUMERIC', description: 'Whether the factor between the two given values of one quantity is a whole number, a unit fraction or neither.' }, { lever: 'composed-proportion', kind: 'STEPS', description: 'Whether a second proportion or a unit conversion must be applied before the first can be used.' }],
    commonMisconceptions: ['Adds the difference between the known values instead of keeping the ratio.', 'Sets up the proportion with one pair of values inverted.'],
    responseConstraints: { allowedFormats: ['SELECTED_RESPONSE', 'NUMERIC_ENTRY', 'SHORT_RESPONSE'], ...NO_STIMULUS, note: null },
    support: { PAA: S, IB: C(NEEDS_STEPS), CAMBRIDGE: C(NEEDS_STEPS), PISA: U(NO_TRANSFER), ICFES: S },
    specialization: {
      mathematicalStructure: { construct: 'DIRECT_PROPORTION_MISSING_VALUE', description: 'Two quantities in direct proportion; one pair of corresponding values and one further value are known, its partner is unknown.' },
      variables: [{ symbol: 'a', meaning: 'First value of the first quantity', role: 'GIVEN', domain: 'RATIONAL' }, { symbol: 'b', meaning: 'Corresponding value of the second quantity', role: 'GIVEN', domain: 'RATIONAL' }, { symbol: 'c', meaning: 'Second value of the first quantity', role: 'GIVEN', domain: 'RATIONAL' }, { symbol: 'x', meaning: 'Value of the second quantity that corresponds to c', role: 'UNKNOWN', domain: 'RATIONAL' }],
      parameterRanges: [{ symbol: 'a', min: 2, max: 60, step: 1, note: null }, { symbol: 'b', min: 2, max: 240, step: 1, note: null }, { symbol: 'c', min: 3, max: 180, step: 1, note: 'Different from a.' }],
      relationships: ['a / b = c / x', 'x = b * c / a'],
      constraints: ['c is not equal to a.', 'a, b and c are positive.'],
      validSolutionRules: ['x is positive and is an integer or a terminating decimal with at most two places.', 'Exactly one value of x satisfies the proportion.'],
      misconceptionModels: [{ id: 'additive', description: 'Treats the relation as a constant difference.', producesError: 'x = b + (c - a)' }, { id: 'inverted', description: 'Inverts one ratio of the proportion.', producesError: 'x = a * b / c' }, { id: 'wrong-pair', description: 'Scales the wrong known value.', producesError: 'x = a * c / b' }],
      numericalDifficultyLevers: [{ lever: 'scale-factor', kind: 'NUMERIC', FOUNDATIONAL: 'c is a whole-number multiple of a.', STANDARD: 'c / a is a simple fraction such as 3/2 or 5/4.', CHALLENGE: 'c / a is not a simple fraction and x is a decimal.' }, { lever: 'composed-proportion', kind: 'STEPS', FOUNDATIONAL: 'One proportion.', STANDARD: 'One proportion after a unit conversion.', CHALLENGE: 'Two proportions applied in turn.' }],
      calculatorDependency: 'NONE',
    },
  }),
  family({
    familyId: 'tf.math.proportion.rate-comparison-model', primaryConcepts: [RATIO], targetSkills: ['Razonamiento proporcional'],
    evidenceTarget: { actions: ['FORMULATE', 'SOLVE', 'INTERPRET'], object: 'A situation offering two options, each described by an amount and what it gives in return, where the better option is not visible without a common rate.', observablePerformance: 'Chooses the quantity to compare, forms the two unit rates, and states which option the comparison favours and by how much.' },
    supportedContexts: [ctx('PERSONAL', 'A choice an individual makes between two offers.'), ctx('OCCUPATIONAL', 'A choice between two suppliers, tools or processes at work.'), ctx('SOCIETAL', 'A comparison of two public services, places or groups by a rate.')],
    difficultyLevers: [{ lever: 'rate-visibility', kind: 'NUMERIC', description: 'Whether one amount is a whole multiple of the other, so the comparison can be made by scaling, or a unit rate is needed.' }, { lever: 'unit-mismatch', kind: 'STEPS', description: 'Whether the two options are stated in the same units.' }, { lever: 'irrelevant-information', kind: 'CONTEXT_LOAD', description: 'Whether the situation carries quantities that the comparison does not need.' }],
    commonMisconceptions: ['Compares the amounts or the prices alone, ignoring the other quantity.', 'Forms the rate the wrong way round and reads the larger value as the better option.'],
    responseConstraints: { allowedFormats: ['SELECTED_RESPONSE', 'NUMERIC_ENTRY', 'SHORT_RESPONSE', 'EXTENDED_RESPONSE'], ...NO_STIMULUS, note: 'A numeric response asks for the difference between the two unit rates, never for the choice itself.' },
    support: { PAA: S, IB: S, CAMBRIDGE: S, PISA: S, ICFES: S },
    specialization: {
      mathematicalStructure: { construct: 'UNIT_RATE_COMPARISON_OF_TWO_OPTIONS', description: 'Two options, each a pair (amount, return); the options are ordered by the ratio return / amount.' },
      variables: [{ symbol: 'p1', meaning: 'Amount of option 1', role: 'GIVEN', domain: 'RATIONAL' }, { symbol: 'q1', meaning: 'Return of option 1', role: 'GIVEN', domain: 'RATIONAL' }, { symbol: 'p2', meaning: 'Amount of option 2', role: 'GIVEN', domain: 'RATIONAL' }, { symbol: 'q2', meaning: 'Return of option 2', role: 'GIVEN', domain: 'RATIONAL' }, { symbol: 'r1', meaning: 'Unit rate of option 1', role: 'DERIVED', domain: 'RATIONAL' }, { symbol: 'r2', meaning: 'Unit rate of option 2', role: 'DERIVED', domain: 'RATIONAL' }, { symbol: 'd', meaning: 'Difference between the unit rates', role: 'UNKNOWN', domain: 'RATIONAL' }],
      parameterRanges: [{ symbol: 'p1', min: 2, max: 500, step: null, note: null }, { symbol: 'q1', min: 2, max: 500, step: null, note: null }, { symbol: 'p2', min: 2, max: 500, step: null, note: null }, { symbol: 'q2', min: 2, max: 500, step: null, note: null }],
      relationships: ['r1 = q1 / p1', 'r2 = q2 / p2', 'd = r1 - r2'],
      constraints: ['r1 is not equal to r2: one option is strictly better.', 'The option with the larger amount is not automatically the better one.'],
      validSolutionRules: ['Both unit rates are terminating decimals with at most three places.', 'The better option cannot be identified from one quantity alone.'],
      misconceptionModels: [{ id: 'one-quantity', description: 'Compares only the amounts or only the returns.', producesError: 'Chooses the option with the larger q or the smaller p.' }, { id: 'inverted-rate', description: 'Computes p / q and reads the larger value as better.', producesError: 'Chooses the worse option.' }, { id: 'difference', description: 'Compares q - p for each option.', producesError: 'Orders the options by an additive comparison.' }],
      numericalDifficultyLevers: [{ lever: 'rate-visibility', kind: 'NUMERIC', FOUNDATIONAL: 'p2 is a whole multiple of p1.', STANDARD: 'A common multiple of p1 and p2 is easy to find.', CHALLENGE: 'Unit rates are needed and differ in the second decimal place.' }, { lever: 'unit-mismatch', kind: 'STEPS', FOUNDATIONAL: 'Same units.', STANDARD: 'One option needs a unit conversion.', CHALLENGE: 'Both quantities of one option need converting.' }],
      calculatorDependency: 'HELPFUL',
    },
  }),
  // ---------------------------------------------------------------- Rectas y funciones lineales (Matemáticas)
  family({
    familyId: 'tf.math.linear.line-through-two-points', primaryConcepts: [LINEAR], targetSkills: ['Razonamiento algebraico'],
    evidenceTarget: { actions: ['COMPUTE', 'REPRESENT'], object: 'Two points of the plane given by their coordinates.', observablePerformance: 'Computes the slope from the two points and writes the equation of the line through them, or a value the equation gives.' },
    supportedContexts: [ABSTRACT],
    difficultyLevers: [{ lever: 'coordinate-signs', kind: 'NUMERIC', description: 'Whether the coordinates are all positive or mix signs.' }, { lever: 'slope-form', kind: 'NUMERIC', description: 'Whether the slope is a whole number or a fraction.' }, { lever: 'asked-quantity', kind: 'STEPS', description: 'Whether the slope, the intercept, the equation or a further point of the line is asked.' }],
    commonMisconceptions: ['Divides the change in x by the change in y.', 'Subtracts the coordinates in opposite orders in numerator and denominator.', 'Takes the y-coordinate of a given point as the intercept.'],
    responseConstraints: { allowedFormats: ['SELECTED_RESPONSE', 'NUMERIC_ENTRY', 'MATH_EXPRESSION', 'SHORT_RESPONSE'], ...NO_STIMULUS, note: 'A numeric response asks for the slope, the intercept or a coordinate; an expression asks for the equation.' },
    support: { PAA: S, IB: S, CAMBRIDGE: S, PISA: U(NO_TRANSFER), ICFES: S },
    specialization: {
      mathematicalStructure: { construct: 'LINE_THROUGH_TWO_POINTS', description: 'A non-vertical line determined by two distinct points; slope and intercept follow from the coordinates.' },
      variables: [{ symbol: 'x1', meaning: 'x-coordinate of the first point', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'y1', meaning: 'y-coordinate of the first point', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'x2', meaning: 'x-coordinate of the second point', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'y2', meaning: 'y-coordinate of the second point', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'm', meaning: 'Slope', role: 'UNKNOWN', domain: 'RATIONAL' }, { symbol: 'b', meaning: 'y-intercept', role: 'UNKNOWN', domain: 'RATIONAL' }],
      parameterRanges: [{ symbol: 'x1', min: -10, max: 10, step: 1, note: null }, { symbol: 'y1', min: -20, max: 20, step: 1, note: null }, { symbol: 'x2', min: -10, max: 10, step: 1, note: 'Different from x1.' }, { symbol: 'y2', min: -20, max: 20, step: 1, note: null }],
      relationships: ['m = (y2 - y1) / (x2 - x1)', 'b = y1 - m * x1', 'y = m * x + b'],
      constraints: ['x1 is not equal to x2.', 'The two points are distinct.'],
      validSolutionRules: ['m and b are integers or fractions with a denominator of at most 6.', 'The asked quantity has exactly one value.'],
      misconceptionModels: [{ id: 'run-over-rise', description: 'Inverts the slope.', producesError: 'm = (x2 - x1) / (y2 - y1)' }, { id: 'mixed-order', description: 'Subtracts in opposite orders.', producesError: 'm = (y2 - y1) / (x1 - x2)' }, { id: 'point-as-intercept', description: 'Reads a given y-coordinate as the intercept.', producesError: 'b = y1' }],
      numericalDifficultyLevers: [{ lever: 'coordinate-signs', kind: 'NUMERIC', FOUNDATIONAL: 'All coordinates positive.', STANDARD: 'One negative coordinate.', CHALLENGE: 'Negative coordinates in both points.' }, { lever: 'slope-form', kind: 'NUMERIC', FOUNDATIONAL: 'Whole-number slope.', STANDARD: 'Negative whole-number or half-integer slope.', CHALLENGE: 'Fractional slope and fractional intercept.' }],
      calculatorDependency: 'NONE',
    },
  }),
  family({
    familyId: 'tf.math.linear.constant-rate-model', primaryConcepts: [LINEAR], targetSkills: ['Razonamiento algebraico'],
    evidenceTarget: { actions: ['FORMULATE', 'INTERPRET'], object: 'A situation in which a quantity starts at a fixed value and changes by the same amount for each unit of another quantity.', observablePerformance: 'Writes the linear relation that models the situation and says what its slope and its intercept mean in it.' },
    supportedContexts: [ctx('PERSONAL', 'A cost, a saving or a distance that grows steadily for one person.'), ctx('OCCUPATIONAL', 'A charge, an output or a stock level that changes at a constant rate at work.'), ctx('SCIENTIFIC', 'A measured quantity that changes at a constant rate.')],
    difficultyLevers: [{ lever: 'rate-sign', kind: 'NUMERIC', description: 'Whether the quantity grows or falls.' }, { lever: 'information-form', kind: 'REPRESENTATION', description: 'Whether the rate and the start are stated, or must be read from two values, a table or a graph.' }, { lever: 'question-direction', kind: 'STEPS', description: 'Whether the model is used forwards (a value) or backwards (when a value is reached).' }, { lever: 'situation-load', kind: 'CONTEXT_LOAD', description: 'How much of the situation has to be set aside to see the constant rate.' }],
    commonMisconceptions: ['Swaps the fixed start and the rate when writing the relation.', 'Describes the slope as a total amount rather than an amount per unit.', 'Ignores the starting value.'],
    responseConstraints: { allowedFormats: ['SELECTED_RESPONSE', 'NUMERIC_ENTRY', 'MATH_EXPRESSION', 'SHORT_RESPONSE', 'EXTENDED_RESPONSE'], stimulusNeed: 'OPTIONAL', stimulusKinds: ['TABLE', 'GRAPH'], note: 'A selected or numeric response asks for the meaning of a parameter or for a value the model gives; the model itself is asked as an expression.' },
    support: { PAA: S, IB: S, CAMBRIDGE: S, PISA: S, ICFES: S },
    specialization: {
      mathematicalStructure: { construct: 'LINEAR_MODEL_FIXED_START_CONSTANT_RATE', description: 'A quantity y equal to a starting value plus a constant rate times x; both parameters have a meaning in the situation.' },
      variables: [{ symbol: 'b', meaning: 'Starting value', role: 'PARAMETER', domain: 'RATIONAL' }, { symbol: 'm', meaning: 'Change of y per unit of x', role: 'PARAMETER', domain: 'RATIONAL' }, { symbol: 'x', meaning: 'Independent quantity', role: 'GIVEN', domain: 'RATIONAL' }, { symbol: 'y', meaning: 'Dependent quantity', role: 'UNKNOWN', domain: 'RATIONAL' }],
      parameterRanges: [{ symbol: 'b', min: 0, max: 1000, step: null, note: null }, { symbol: 'm', min: -50, max: 50, step: null, note: 'Not zero.' }, { symbol: 'x', min: 0, max: 100, step: null, note: null }],
      relationships: ['y = m * x + b'],
      constraints: ['m is not zero.', 'Every value of y used in an instance is meaningful in the situation (no negative amount where none can exist).'],
      validSolutionRules: ['The situation fixes m and b uniquely.', 'An asked value is an integer or a terminating decimal with at most two places.'],
      misconceptionModels: [{ id: 'swapped-parameters', description: 'Uses the start as the rate and the rate as the start.', producesError: 'y = b * x + m' }, { id: 'no-start', description: 'Drops the starting value.', producesError: 'y = m * x' }, { id: 'slope-as-total', description: 'Reads the slope as the value of y.', producesError: 'States m as an amount, not an amount per unit.' }],
      numericalDifficultyLevers: [{ lever: 'rate-sign', kind: 'NUMERIC', FOUNDATIONAL: 'Positive whole-number rate.', STANDARD: 'Negative or decimal rate.', CHALLENGE: 'Rate to be found from two non-consecutive values.' }, { lever: 'question-direction', kind: 'STEPS', FOUNDATIONAL: 'Forwards: a value of y.', STANDARD: 'Backwards: the x at which y reaches a value.', CHALLENGE: 'The x at which two such models agree is NOT asked: that is another family.' }],
      calculatorDependency: 'NONE',
    },
  }),
  // ---------------------------------------------------------------- Quadratic functions and inequalities (Mathematics)
  family({
    familyId: 'tf.math.quadratic.solve-by-factorising', primaryConcepts: [QUADRATICS], targetSkills: ['Razonamiento algebraico'],
    evidenceTarget: { actions: ['SOLVE'], object: 'A quadratic equation in one unknown with rational roots, given in or reducible to standard form.', observablePerformance: 'Brings the equation to standard form, factorises it and reads both roots from the factors.' },
    supportedContexts: [ABSTRACT],
    difficultyLevers: [{ lever: 'leading-coefficient', kind: 'NUMERIC', description: 'Whether the coefficient of the squared term is 1.' }, { lever: 'root-signs', kind: 'NUMERIC', description: 'Whether the roots share a sign.' }, { lever: 'rearrangement', kind: 'STEPS', description: 'Whether the equation is given in standard form or must first be rearranged or expanded.' }],
    commonMisconceptions: ['Takes the constants of the factors as the roots without changing their signs.', 'Divides both sides by the unknown and loses a root.', 'Factorises before one side is zero.'],
    responseConstraints: { allowedFormats: ['NUMERIC_ENTRY', 'MATH_EXPRESSION', 'SHORT_RESPONSE'], ...NO_STIMULUS, note: 'Selected response is excluded: with options, substitution replaces the method. A numeric response asks for ONE stated root (the greater, the positive) or for the sum of the roots.' },
    support: { PAA: C(NUMERIC_ONLY), IB: S, CAMBRIDGE: S, PISA: U(NO_TRANSFER), ICFES: U(NO_PRODUCED_RESPONSE) },
    specialization: {
      mathematicalStructure: { construct: 'QUADRATIC_EQUATION_RATIONAL_ROOTS_BY_FACTORISING', description: 'a x^2 + b x + c = 0 with two rational roots, solved through the factorised form a (x - r1)(x - r2) = 0.' },
      variables: [{ symbol: 'a', meaning: 'Coefficient of the squared term', role: 'PARAMETER', domain: 'INTEGER' }, { symbol: 'r1', meaning: 'First root', role: 'UNKNOWN', domain: 'RATIONAL' }, { symbol: 'r2', meaning: 'Second root', role: 'UNKNOWN', domain: 'RATIONAL' }, { symbol: 'b', meaning: 'Coefficient of the linear term', role: 'DERIVED', domain: 'INTEGER' }, { symbol: 'c', meaning: 'Constant term', role: 'DERIVED', domain: 'INTEGER' }],
      parameterRanges: [{ symbol: 'a', min: 1, max: 6, step: 1, note: null }, { symbol: 'r1', min: -12, max: 12, step: 0.5, note: null }, { symbol: 'r2', min: -12, max: 12, step: 0.5, note: 'Different from r1 unless a repeated root is intended and said.' }],
      relationships: ['a * (x - r1) * (x - r2) = 0', 'b = -a * (r1 + r2)', 'c = a * r1 * r2'],
      constraints: ['b and c are integers.', 'The equation is built from its roots, never the roots from arbitrary coefficients.'],
      validSolutionRules: ['Both roots are rational.', 'When one root is asked, the stem says which one, so the response has one value.'],
      misconceptionModels: [{ id: 'sign-of-roots', description: 'Reads the factor constants as roots.', producesError: 'x = -r1 and x = -r2' }, { id: 'lost-root', description: 'Divides by the unknown.', producesError: 'Only one root.' }, { id: 'non-zero-side', description: 'Sets each factor equal to the non-zero right-hand side.', producesError: 'Roots of another equation.' }],
      numericalDifficultyLevers: [{ lever: 'leading-coefficient', kind: 'NUMERIC', FOUNDATIONAL: 'a = 1, integer roots.', STANDARD: 'a = 1 with roots of opposite signs, or a common factor to take out first.', CHALLENGE: 'a greater than 1 with a fractional root.' }, { lever: 'rearrangement', kind: 'STEPS', FOUNDATIONAL: 'Given in standard form.', STANDARD: 'Terms on both sides.', CHALLENGE: 'A product to expand before rearranging.' }],
      calculatorDependency: 'NONE',
    },
  }),
  family({
    familyId: 'tf.math.quadratic.optimum-of-a-model', primaryConcepts: [QUADRATICS], targetSkills: ['Razonamiento algebraico'],
    evidenceTarget: { actions: ['FORMULATE', 'SOLVE', 'INTERPRET'], object: 'A situation in which a quantity to be made as large or as small as possible depends on one free measure through a product of two linear expressions.', observablePerformance: 'Expresses the quantity as a quadratic function of the free measure, finds its vertex, and states the optimal measure and the optimal value in the terms of the situation.' },
    supportedContexts: [ctx('OCCUPATIONAL', 'A design or pricing decision with one free measure.'), ctx('SCIENTIFIC', 'A measured quantity that rises and then falls.'), ctx('PERSONAL', 'A plan with a fixed total to share between two uses.')],
    difficultyLevers: [{ lever: 'model-given', kind: 'STEPS', description: 'Whether the quadratic is stated, or its two linear factors must be found from the situation.' }, { lever: 'vertex-form', kind: 'NUMERIC', description: 'Whether the vertex falls on a whole number.' }, { lever: 'domain-restriction', kind: 'CONTEXT_LOAD', description: 'Whether the situation limits the free measure so that the vertex must be checked against it.' }],
    commonMisconceptions: ['Gives a root of the quadratic as the optimum.', 'Reports the optimal measure when the optimal value is asked, or the reverse.', 'Finds the vertex of a model that does not fit the situation.'],
    responseConstraints: { allowedFormats: ['NUMERIC_ENTRY', 'SHORT_RESPONSE', 'EXTENDED_RESPONSE'], ...NO_STIMULUS, note: 'Selected response is excluded: the optimum could be found by testing the options, so nothing would have to be formulated.' },
    support: { PAA: C(NUMERIC_ONLY), IB: S, CAMBRIDGE: S, PISA: S, ICFES: U(NO_PRODUCED_RESPONSE) },
    specialization: {
      mathematicalStructure: { construct: 'QUADRATIC_MODEL_VERTEX_OPTIMUM', description: 'A quantity Q(x) = (p + q x)(r - s x) of one free measure x; its optimum is at the vertex of the parabola.' },
      variables: [{ symbol: 'p', meaning: 'Constant of the first linear factor', role: 'PARAMETER', domain: 'RATIONAL' }, { symbol: 'q', meaning: 'Rate of the first linear factor', role: 'PARAMETER', domain: 'RATIONAL' }, { symbol: 'r', meaning: 'Constant of the second linear factor', role: 'PARAMETER', domain: 'RATIONAL' }, { symbol: 's', meaning: 'Rate of the second linear factor', role: 'PARAMETER', domain: 'RATIONAL' }, { symbol: 'xv', meaning: 'Free measure at the optimum', role: 'UNKNOWN', domain: 'RATIONAL' }, { symbol: 'Qv', meaning: 'Optimal value', role: 'UNKNOWN', domain: 'RATIONAL' }],
      parameterRanges: [{ symbol: 'p', min: 0, max: 200, step: null, note: null }, { symbol: 'q', min: 1, max: 20, step: null, note: null }, { symbol: 'r', min: 10, max: 400, step: null, note: null }, { symbol: 's', min: 1, max: 20, step: null, note: null }],
      relationships: ['Q = (p + q * x) * (r - s * x)', 'xv = (q * r - p * s) / (2 * q * s)', 'Qv = (p + q * xv) * (r - s * xv)'],
      constraints: ['xv lies strictly inside the range of x the situation allows.', 'Both linear factors are positive at xv.'],
      validSolutionRules: ['xv is an integer or a terminating decimal with at most one place.', 'The situation determines both linear factors without ambiguity.'],
      misconceptionModels: [{ id: 'root-as-optimum', description: 'Solves Q = 0 and reports a root.', producesError: 'x = r / s' }, { id: 'measure-for-value', description: 'Reports xv where Qv is asked.', producesError: 'xv instead of Qv.' }, { id: 'midpoint-of-range', description: 'Takes the middle of the allowed range without the model.', producesError: 'A value that is the vertex only by coincidence.' }],
      numericalDifficultyLevers: [{ lever: 'vertex-form', kind: 'NUMERIC', FOUNDATIONAL: 'p = 0 and the vertex is a whole number.', STANDARD: 'p greater than 0, whole-number vertex.', CHALLENGE: 'Vertex at a half-integer.' }, { lever: 'model-given', kind: 'STEPS', FOUNDATIONAL: 'Both linear factors are stated.', STANDARD: 'One factor must be found from the situation.', CHALLENGE: 'Both factors must be found.' }],
      calculatorDependency: 'HELPFUL',
    },
  }),
  // ---------------------------------------------------------------- Probabilidad (Matemáticas)
  family({
    familyId: 'tf.math.probability.single-event-equally-likely', primaryConcepts: [PROBABILITY], targetSkills: ['Razonamiento estadístico y probabilístico'],
    evidenceTarget: { actions: ['COMPUTE'], object: 'One random draw from a finite set of equally likely outcomes described by counts.', observablePerformance: 'Counts the favourable and the possible outcomes and gives their ratio as the probability of the event.' },
    supportedContexts: [ABSTRACT, ctx('PERSONAL', 'A draw, a spin or a pick whose outcomes are listed by counts.')],
    difficultyLevers: [{ lever: 'event-form', kind: 'STEPS', description: 'Whether the event is one category, a union of categories or a complement.' }, { lever: 'answer-form', kind: 'NUMERIC', description: 'Whether the ratio is already in lowest terms.' }],
    commonMisconceptions: ['Gives favourable to unfavourable (odds) instead of favourable to possible.', 'Counts categories instead of outcomes.', 'Gives the count of favourable outcomes as the probability.'],
    responseConstraints: { allowedFormats: ['SELECTED_RESPONSE', 'NUMERIC_ENTRY', 'SHORT_RESPONSE'], ...NO_STIMULUS, note: null },
    support: { PAA: S, IB: C(NEEDS_STEPS), CAMBRIDGE: C(NEEDS_STEPS), PISA: U(NO_TRANSFER), ICFES: S },
    specialization: {
      mathematicalStructure: { construct: 'CLASSICAL_PROBABILITY_SINGLE_DRAW', description: 'A finite sample space of n equally likely outcomes; an event with k favourable outcomes has probability k / n.' },
      variables: [{ symbol: 'n', meaning: 'Number of possible outcomes', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'k', meaning: 'Number of favourable outcomes', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'P', meaning: 'Probability of the event', role: 'UNKNOWN', domain: 'RATIONAL' }],
      parameterRanges: [{ symbol: 'n', min: 4, max: 60, step: 1, note: null }, { symbol: 'k', min: 1, max: 59, step: 1, note: 'Less than n.' }],
      relationships: ['P = k / n'],
      constraints: ['0 < k < n.', 'The outcomes are equally likely by the description, not by assumption.'],
      validSolutionRules: ['P is strictly between 0 and 1.', 'The response is accepted as a fraction in any equivalent form or as the decimal the stem asks for.'],
      misconceptionModels: [{ id: 'odds', description: 'Favourable over unfavourable.', producesError: 'P = k / (n - k)' }, { id: 'categories', description: 'One over the number of categories.', producesError: 'P = 1 / (number of categories)' }, { id: 'complement', description: 'Gives the probability of the complement.', producesError: 'P = (n - k) / n' }],
      numericalDifficultyLevers: [{ lever: 'event-form', kind: 'STEPS', FOUNDATIONAL: 'One category.', STANDARD: 'Two categories together.', CHALLENGE: 'A complement described in words.' }, { lever: 'answer-form', kind: 'NUMERIC', FOUNDATIONAL: 'k / n already in lowest terms.', STANDARD: 'k / n simplifies.', CHALLENGE: 'k must first be found by adding or subtracting counts.' }],
      calculatorDependency: 'NONE',
    },
  }),
  family({
    familyId: 'tf.math.probability.compare-chances-to-decide', primaryConcepts: [PROBABILITY], targetSkills: ['Razonamiento estadístico y probabilístico'],
    evidenceTarget: { actions: ['FORMULATE', 'COMPUTE', 'EVALUATE'], object: 'A situation with two options, each with its own counts of outcomes, and a claim about which option gives the better chance of a stated result.', observablePerformance: 'Identifies the event and the sample space of each option, computes the two probabilities and judges the claim by comparing them.' },
    supportedContexts: [ctx('PERSONAL', 'A choice between two games, routes or offers.'), ctx('SOCIETAL', 'A claim made about two groups or two places.'), ctx('SCIENTIFIC', 'Two samples or two trials whose results are compared.')],
    difficultyLevers: [{ lever: 'count-trap', kind: 'NUMERIC', description: 'Whether the option with more favourable outcomes is also the one with the higher probability.' }, { lever: 'sample-space-visibility', kind: 'STEPS', description: 'Whether the totals are stated or must be found from the parts.' }, { lever: 'claim-wording', kind: 'CONTEXT_LOAD', description: 'Whether the claim is stated directly or has to be extracted from the situation.' }],
    commonMisconceptions: ['Compares the numbers of favourable outcomes instead of the probabilities.', 'Judges the claim from the totals alone.', 'Treats two different sample spaces as one.'],
    responseConstraints: { allowedFormats: ['SELECTED_RESPONSE', 'MULTI_SELECT', 'NUMERIC_ENTRY', 'SHORT_RESPONSE', 'EXTENDED_RESPONSE'], ...NO_STIMULUS, note: 'A numeric response asks for one of the two probabilities, or their difference.' },
    support: { PAA: S, IB: S, CAMBRIDGE: S, PISA: S, ICFES: S },
    specialization: {
      mathematicalStructure: { construct: 'COMPARISON_OF_TWO_CLASSICAL_PROBABILITIES', description: 'Two independent sample spaces with their own favourable counts; a claim is true or false according to the order of k1 / n1 and k2 / n2.' },
      variables: [{ symbol: 'n1', meaning: 'Outcomes of option 1', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'k1', meaning: 'Favourable outcomes of option 1', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'n2', meaning: 'Outcomes of option 2', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'k2', meaning: 'Favourable outcomes of option 2', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'P1', meaning: 'Probability under option 1', role: 'DERIVED', domain: 'RATIONAL' }, { symbol: 'P2', meaning: 'Probability under option 2', role: 'DERIVED', domain: 'RATIONAL' }, { symbol: 'verdict', meaning: 'Whether the claim holds', role: 'UNKNOWN', domain: 'CATEGORY' }],
      parameterRanges: [{ symbol: 'n1', min: 5, max: 200, step: 1, note: null }, { symbol: 'k1', min: 1, max: 199, step: 1, note: 'Less than n1.' }, { symbol: 'n2', min: 5, max: 200, step: 1, note: 'Different from n1.' }, { symbol: 'k2', min: 1, max: 199, step: 1, note: 'Less than n2.' }],
      relationships: ['P1 = k1 / n1', 'P2 = k2 / n2', 'verdict follows from the order of P1 and P2'],
      constraints: ['P1 is not equal to P2.', 'n1 is not equal to n2, so the counts alone do not decide.'],
      validSolutionRules: ['The claim is clearly true or clearly false.', 'The two probabilities differ by at least 0.02, so rounding cannot change the verdict.'],
      misconceptionModels: [{ id: 'count-comparison', description: 'Compares k1 with k2.', producesError: 'The verdict that the larger count gives.' }, { id: 'total-comparison', description: 'Compares n1 with n2.', producesError: 'The verdict that the smaller total gives.' }, { id: 'pooled-space', description: 'Adds the two sample spaces.', producesError: '(k1 + k2) / (n1 + n2) used for both options.' }],
      numericalDifficultyLevers: [{ lever: 'count-trap', kind: 'NUMERIC', FOUNDATIONAL: 'The option with more favourable outcomes also has the higher probability.', STANDARD: 'The option with more favourable outcomes has the LOWER probability.', CHALLENGE: 'As STANDARD, with probabilities that differ only in the second decimal place.' }, { lever: 'sample-space-visibility', kind: 'STEPS', FOUNDATIONAL: 'Totals stated.', STANDARD: 'One total to be added up.', CHALLENGE: 'Both totals to be added up.' }],
      calculatorDependency: 'HELPFUL',
    },
  }),
  // ---------------------------------------------------------------- Representación e interpretación de datos (Matemáticas)
  family({
    familyId: 'tf.math.data.rate-of-change-from-realistic-dataset', primaryConcepts: [DATA], targetSkills: ['Razonamiento estadístico y probabilístico'],
    evidenceTarget: { actions: ['INTERPRET', 'COMPUTE'], object: 'A table or graph of realistic, multi-digit values of one variable for several categories or periods.', observablePerformance: 'Locates the values the question needs in the representation and computes from them a relative change or a share that the representation does not show.' },
    supportedContexts: [ctx('SOCIETAL', 'Public figures by place or by year.'), ctx('SCIENTIFIC', 'Measurements by sample or by period.'), ctx('OCCUPATIONAL', 'Production, sales or stock by period.'), ctx('PERSONAL', 'A household or personal record over time.')],
    difficultyLevers: [{ lever: 'values-needed', kind: 'STEPS', description: 'How many values must be read and combined.' }, { lever: 'representation-density', kind: 'REPRESENTATION', description: 'How many series and categories the representation holds beyond the ones needed.' }, { lever: 'value-size', kind: 'NUMERIC', description: 'How many significant digits the values have.' }],
    commonMisconceptions: ['Gives the absolute difference where a relative change is asked.', 'Divides by the later value instead of the earlier one.', 'Reads the value of a neighbouring category or period.'],
    responseConstraints: { allowedFormats: ['SELECTED_RESPONSE', 'MULTI_SELECT', 'NUMERIC_ENTRY', 'SHORT_RESPONSE'], stimulusNeed: 'REQUIRED', stimulusKinds: ['TABLE', 'GRAPH', 'DATA_SET'], note: 'The stimulus is data first: a structured table or data set, and a chart that references it.' },
    support: { PAA: U(NEEDS_CALCULATOR), IB: C({ kind: 'CALCULATOR_ONLY', policies: ['GDC_REQUIRED'], reason: 'The values are realistic by design: only a component of the system that provides a calculator can host the task.' }), CAMBRIDGE: S, PISA: S, ICFES: U(NEEDS_CALCULATOR) },
    specialization: {
      mathematicalStructure: { construct: 'RELATIVE_CHANGE_OR_SHARE_FROM_TABULATED_VALUES', description: 'Values v_i of one variable indexed by category or period; the asked quantity is (v_j - v_i) / v_i or v_i / sum(v).' },
      variables: [{ symbol: 'vi', meaning: 'Reference value read from the representation', role: 'GIVEN', domain: 'REAL' }, { symbol: 'vj', meaning: 'Comparison value read from the representation', role: 'GIVEN', domain: 'REAL' }, { symbol: 'total', meaning: 'Sum of the values of the series', role: 'DERIVED', domain: 'REAL' }, { symbol: 'result', meaning: 'Relative change or share, as a percentage', role: 'UNKNOWN', domain: 'REAL' }],
      parameterRanges: [{ symbol: 'vi', min: 100, max: 999999, step: null, note: 'At least three significant digits.' }, { symbol: 'vj', min: 100, max: 999999, step: null, note: 'At least three significant digits.' }],
      relationships: ['result = 100 * (vj - vi) / vi', 'result = 100 * vi / total'],
      constraints: ['vi is not zero and not equal to vj.', 'The representation holds at least four values of the series.'],
      validSolutionRules: ['The stem states the rounding of the result.', 'No other pair of values in the representation gives the same rounded result.'],
      misconceptionModels: [{ id: 'absolute-difference', description: 'Reports vj - vi.', producesError: 'vj - vi' }, { id: 'wrong-base', description: 'Divides by the later value.', producesError: '100 * (vj - vi) / vj' }, { id: 'neighbour-value', description: 'Reads an adjacent row or column.', producesError: 'The result for another category or period.' }],
      numericalDifficultyLevers: [{ lever: 'values-needed', kind: 'STEPS', FOUNDATIONAL: 'Two values of one series.', STANDARD: 'Two values and a total.', CHALLENGE: 'Values of two series combined.' }, { lever: 'value-size', kind: 'NUMERIC', FOUNDATIONAL: 'Three significant digits.', STANDARD: 'Four or five significant digits.', CHALLENGE: 'Values in different units of magnitude (thousands and millions).' }],
      calculatorDependency: 'REQUIRED',
    },
  }),
  family({
    familyId: 'tf.math.data.judge-claim-against-display', primaryConcepts: [DATA], targetSkills: ['Razonamiento estadístico y probabilístico'],
    evidenceTarget: { actions: ['INTERPRET', 'EVALUATE'], object: 'A data display of small whole-number values and a statement someone makes about what it shows.', observablePerformance: 'Reads what the display does and does not show and decides whether the statement is supported, contradicted or undecidable from it.' },
    supportedContexts: [ctx('SOCIETAL', 'A statement in a report or a notice about a group.'), ctx('PERSONAL', 'A statement about a class, a team or a household.'), ctx('SCIENTIFIC', 'A conclusion drawn from a small set of measurements.'), ctx('OCCUPATIONAL', 'A statement about results at work.')],
    difficultyLevers: [{ lever: 'statement-kind', kind: 'ABSTRACTION', description: 'Whether the statement is about single values, about a comparison, or about a trend or a cause the display cannot establish.' }, { lever: 'display-feature', kind: 'REPRESENTATION', description: 'Whether the display has a feature that invites a wrong reading (a scale that does not start at zero, unequal intervals).' }],
    commonMisconceptions: ['Accepts a statement about cause because the display shows an association.', 'Reads the height of a bar without reading the scale.', 'Takes the largest category for the majority.'],
    responseConstraints: { allowedFormats: ['SELECTED_RESPONSE', 'MULTI_SELECT', 'SHORT_RESPONSE', 'EXTENDED_RESPONSE'], stimulusNeed: 'REQUIRED', stimulusKinds: ['TABLE', 'GRAPH'], note: 'A numeric response cannot carry a judgement and is excluded.' },
    support: { PAA: S, IB: S, CAMBRIDGE: S, PISA: S, ICFES: S },
    specialization: {
      mathematicalStructure: { construct: 'CLAIM_EVALUATION_AGAINST_A_DATA_DISPLAY', description: 'A display of counts or measures by category and a statement whose truth value is SUPPORTED, CONTRADICTED or NOT_DECIDABLE from the display.' },
      variables: [{ symbol: 'categories', meaning: 'Number of categories in the display', role: 'PARAMETER', domain: 'INTEGER' }, { symbol: 'value', meaning: 'A value of the display', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'verdict', meaning: 'Truth value of the statement given the display', role: 'UNKNOWN', domain: 'CATEGORY' }],
      parameterRanges: [{ symbol: 'categories', min: 3, max: 8, step: 1, note: null }, { symbol: 'value', min: 0, max: 100, step: 1, note: 'Whole numbers that need no calculator.' }],
      relationships: ['verdict is determined by the values of the display and the statement, and by nothing outside them'],
      constraints: ['The statement refers only to what the display could show.', 'Exactly one verdict is defensible.'],
      validSolutionRules: ['The verdict does not depend on knowledge from outside the display.', 'A statement of cause is NOT_DECIDABLE unless the display is of an experiment and says so.'],
      misconceptionModels: [{ id: 'association-as-cause', description: 'Accepts a causal statement.', producesError: 'SUPPORTED for a statement the display cannot decide.' }, { id: 'scale-ignored', description: 'Compares heights without the scale.', producesError: 'A wrong ratio between two categories.' }, { id: 'plurality-as-majority', description: 'Takes the largest category for more than half.', producesError: 'SUPPORTED for a majority that the values contradict.' }],
      numericalDifficultyLevers: [{ lever: 'statement-kind', kind: 'ABSTRACTION', FOUNDATIONAL: 'About single values.', STANDARD: 'About a comparison or a total.', CHALLENGE: 'About a trend or a cause.' }, { lever: 'display-feature', kind: 'REPRESENTATION', FOUNDATIONAL: 'Plain display.', STANDARD: 'Two series.', CHALLENGE: 'A scale or an interval that invites a wrong reading.' }],
      calculatorDependency: 'NONE',
    },
  }),
];

export const mathPocFamilyOf = (familyId: string): MathTaskFamily | null => MATH_POC_FAMILIES.find((f) => f.familyId === familyId) ?? null;
