/**
 * CF-IB-AAHL-01 -- the EIGHT further Content Factory constructs Track B adopts, re-projected into IB's governed
 * SHORT_RESPONSE with answer marks (the projection R1 proved for QUADRATIC_MINIMUM_VALUE: same parameter set, same
 * prompt, same key, same EXACT numeric policy, same marks; only the response format the adapter offers).
 *
 *   P1 algebra    GEOMETRIC_SUM_TO_INFINITY, LOG_EQUATION_ONE_ADMISSIBLE_ROOT
 *   P1 calculus   DEFINITE_INTEGRAL_POLYNOMIAL, AREA_BETWEEN_CURVE_AND_AXIS, TANGENT_GRADIENT_AT_A_POINT, CUBIC_LOCAL_MAXIMUM
 *   P2 statistics BINOMIAL_EXACT_PROBABILITY, NORMAL_SYMMETRY
 * NOT adopted: INVERSE_FUNCTION_VALUE -- the functions bucket is the human-certified D02, which places only
 * math.alg.quadratics; automation never re-places a human-certified bucket.
 *
 * The construct code is the Content Factory's, copied byte-for-byte (cf-ib-aahl-01.constructs.ts); every package
 * candidate is rendered again from ITS parameter set (cf-ib-aahl-01.package-seeds.ts). Nothing is regenerated. The core
 * family records state what each construct already does (its parameters, relationship, misconception models, levers);
 * parameter ranges are read from the construct's own enumeration. Written by the model, reviewed by nobody.
 */
import { constructCoreOf, type ConstructCoreRecord } from '../construct-core';
import { RendererEnvelopeSchema, type RendererEnvelope } from '../renderer-envelope';
import type { DifficultyMechanism } from '../instance-validators';
import { parameterSetsOf, parametricStrategy, PLANNING_BANDS, type ParametricConstruct, type PlanningBand } from './parametric';
import type { LibraryEntry } from './catalogue';
import { AREA_BETWEEN_CURVE_AND_AXIS, BINOMIAL_EXACT_PROBABILITY, CUBIC_LOCAL_MAXIMUM, DEFINITE_INTEGRAL_POLYNOMIAL, GEOMETRIC_SUM_TO_INFINITY, LOG_EQUATION, NORMAL_SYMMETRY, TANGENT_GRADIENT_AT_A_POINT } from './cf-ib-aahl-01.constructs';
import { CF_IB_AAHL_01_PACKAGE_SEEDS } from './cf-ib-aahl-01.package-seeds';

const CORE_VERSION = '0.1.0-cf.1';
const MARKS_BY_BAND = { FOUNDATIONAL: 2, STANDARD: 3, CHALLENGE: 4 } as const;
const BAND_DIFFICULTY: Record<PlanningBand, number> = { FOUNDATIONAL: 2, STANDARD: 3, CHALLENGE: 4 };

interface Variable { symbol: string; meaning: string; role: 'GIVEN' | 'UNKNOWN' | 'PARAMETER' | 'DERIVED'; domain: 'INTEGER' | 'RATIONAL' | 'REAL' | 'CATEGORY' }
interface AdoptionSpec {
  construct: ParametricConstruct<never>;
  familyId: string;
  adapterId: 'IB.MATH_AA_HL.P1' | 'IB.MATH_AA_HL.P2';
  commandTerm: 'find' | 'solve';
  concept: { stableId: string; canonicalName: string };
  skill: string;
  action: 'COMPUTE' | 'SOLVE';
  object: string;
  observable: string;
  structure: string;
  variables: Variable[];
  relationships: string[];
  constraints: string[];
  misconceptions: { id: string; description: string; producesError: string }[];
  levers: Record<PlanningBand, string[]>;
  exclusions: string[];
  challenge: DifficultyMechanism;
  path: string[];
  strategies: string[];
  shortcut: { id: string; bypass: string; instanceRule: string };
}

/** The numeric range of each GIVEN / PARAMETER variable over every planning band, read from the construct itself. */
function rangesOf(spec: AdoptionSpec): { symbol: string; min: number; max: number; step: number }[] {
  return spec.variables.filter((v) => v.domain !== 'CATEGORY' && v.role !== 'UNKNOWN').map((v) => {
    const values = PLANNING_BANDS.flatMap((b) => parameterSetsOf(spec.construct as ParametricConstruct, b).map((p) => Number(p[v.symbol])));
    return { symbol: v.symbol, min: Math.min(...values), max: Math.max(...values), step: 1 };
  });
}

function adopt(spec: AdoptionSpec): LibraryEntry {
  const c = spec.construct as ParametricConstruct;
  const ranges = rangesOf(spec);
  const built = constructCoreOf({
    family: {
      v: 1, familyId: spec.familyId, version: CORE_VERSION, familyType: 'MATH_PROBLEM', canonicalSubject: 'Mathematics',
      primaryConcepts: [{ stableId: spec.concept.stableId, canonicalSubject: 'Mathematics', canonicalName: spec.concept.canonicalName }],
      targetSkills: [spec.skill], targetCompetencies: ['dev.comp.math-reasoning'],
      evidenceTarget: { actions: [spec.action], object: spec.object, observablePerformance: spec.observable },
      supportedContexts: [{ kind: 'ABSTRACT', note: 'The mathematical object is given directly.' }],
      difficultyLevers: [{ lever: 'band-form', kind: 'STEPS', description: 'The band fixes the form of the task (see the envelope lever settings).' }],
      commonMisconceptions: spec.misconceptions.map((m) => m.description),
      responseConstraints: { allowedFormats: ['NUMERIC_ENTRY', 'SHORT_RESPONSE'], stimulusNeed: 'NONE', stimulusKinds: [], note: 'A produced value; no candidate value is offered.' },
      profileSupport: { IB: { status: 'SUPPORTED' } },
      provenance: { authoredBy: 'STUDYUS', authoringKind: 'STUDYUS_GENERATED', authoredAt: '2026-10-14T00:00:00Z', referenceSourceKeys: ['studyus.content-factory.cf-ib-aahl-01'], containsCopiedProtectedExpression: false, note: 'Content Factory CF-IB-AAHL-01: deterministic construct written in-session by the model; reviewed by nobody. Adopted by Track B unchanged.' },
      lifecycle: 'IN_REVIEW', reviewStatus: 'IN_REVIEW',
      specialization: {
        mathematicalStructure: { construct: c.construct, description: spec.structure },
        variables: spec.variables,
        parameterRanges: ranges.map((r) => ({ ...r, note: null })),
        relationships: spec.relationships,
        constraints: spec.constraints,
        validSolutionRules: ['The keyed value is exact, in lowest terms, and checked by a second route that does not reuse the answer.', 'The keyed value is never what a modelled misconception gives.'],
        misconceptionModels: spec.misconceptions,
        numericalDifficultyLevers: [{ lever: 'band-form', kind: 'STEPS', FOUNDATIONAL: spec.levers.FOUNDATIONAL.join(' '), STANDARD: spec.levers.STANDARD.join(' '), CHALLENGE: spec.levers.CHALLENGE.join(' ') }],
        calculatorDependency: 'NONE',
      },
    },
    shortcutConstraints: [{ id: spec.shortcut.id, bypass: spec.shortcut.bypass, excludedFormats: ['SELECTED_RESPONSE'], instanceRule: spec.shortcut.instanceRule }],
  });
  if (!built.ok) throw new Error(`CF_IB_AAHL_01_CORE_INVALID ${spec.familyId}: ${built.issue} ${built.details.join('; ')}`);
  const parsed = RendererEnvelopeSchema.safeParse({
    v: 1, rendererVersion: c.rendererVersion, strategy: 'PARAMETRIC_DETERMINISTIC', construct: c.construct, constructFamilyId: built.core.constructFamilyId, constructFamilyVersion: built.core.familyVersion,
    adapterIds: [spec.adapterId], languages: ['en'], responseFormats: ['SHORT_RESPONSE'], commandTerms: [spec.commandTerm],
    parameterRanges: ranges,
    bands: PLANNING_BANDS.map((b) => ({ planningBand: b, itemDifficulty: BAND_DIFFICULTY[b], leverSettings: spec.levers[b] })),
    stimulusKinds: [], exclusions: spec.exclusions,
  });
  if (!parsed.success) throw new Error(`CF_IB_AAHL_01_ENVELOPE_INVALID ${spec.familyId}: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  return {
    core: built.core, envelope: parsed.data as RendererEnvelope, construct: c, strategy: parametricStrategy(c, { format: 'SHORT_RESPONSE', marksByBand: MARKS_BY_BAND }),
    targets: [{ adapterId: spec.adapterId, language: 'en', responseFormat: 'SHORT_RESPONSE', commandTerm: spec.commandTerm }],
    reasoning: { minimumSuccessfulPath: spec.path, supportedStrategies: spec.strategies, requiredObservableMethod: null },
    challengeMechanisms: [spec.challenge], origin: 'CF_PACKAGE', packageSeeds: CF_IB_AAHL_01_PACKAGE_SEEDS[spec.familyId],
  };
}

const P1 = 'IB.MATH_AA_HL.P1' as const;
const P2 = 'IB.MATH_AA_HL.P2' as const;
const ANSWER = (what: string) => ({ id: 'answer-equals-a-misconception', bypass: `A learner who ${what} would be marked right if the key equalled that value.`, instanceRule: 'Parameter sets whose key a modelled misconception also gives are dropped (withoutCollisions).' });

export const CF_IB_AAHL_01_ADOPTION_SPECS: readonly AdoptionSpec[] = [
  {
    construct: GEOMETRIC_SUM_TO_INFINITY as never, familyId: 'tf.math.series.geometric-sum-to-infinity', adapterId: P1, commandTerm: 'find',
    concept: { stableId: 'math.alg.sequences-series', canonicalName: 'Sequences and series' }, skill: 'Algebraic reasoning', action: 'COMPUTE',
    object: 'A convergent geometric series with a rational common ratio, given by its first terms or by two consecutive terms.', observable: 'Identifies the first term and the common ratio and applies the sum to infinity of a convergent geometric series.',
    structure: 'A geometric series with first term t1 and common ratio r = sign * p / q, 0 < p < q <= 5; the sum to infinity is t1 / (1 - r).',
    variables: [{ symbol: 't1', meaning: 'First term', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 't2', meaning: 'Second term', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 't3', meaning: 'Third term', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'p', meaning: 'Numerator of the absolute ratio', role: 'PARAMETER', domain: 'INTEGER' }, { symbol: 'q', meaning: 'Denominator of the absolute ratio', role: 'PARAMETER', domain: 'INTEGER' }, { symbol: 'sign', meaning: 'Sign of the common ratio', role: 'PARAMETER', domain: 'INTEGER' }, { symbol: 'shown', meaning: 'Which terms are shown', role: 'PARAMETER', domain: 'CATEGORY' }, { symbol: 'S', meaning: 'The sum to infinity', role: 'UNKNOWN', domain: 'RATIONAL' }],
    relationships: ['r = sign * p / q', 'S = t1 / (1 - r)', 't2 = r * t1, t3 = r * t2'], constraints: ['|r| < 1, so the series converges.', 'The first term is a positive integer of at most 400.'],
    misconceptions: [{ id: 'uses-one-plus-r', description: 'Uses 1 + r in the denominator.', producesError: 't1 / (1 + r)' }, { id: 'sums-the-shown-terms', description: 'Adds only the terms shown.', producesError: 't1 + t2 + t3' }, { id: 'starts-from-the-second-term', description: 'Starts the sum from the second term.', producesError: 't2 / (1 - r)' }],
    levers: { FOUNDATIONAL: ['Positive ratio.', 'The first three terms are shown.'], STANDARD: ['Negative ratio.', 'The first three terms are shown.'], CHALLENGE: ['Positive ratio.', 'Only the second and third terms are shown; the first term must be recovered.'] },
    exclusions: ['Sum to infinity only: partial sums and the n-th term are not asked.', 'The vertical fixture series is never re-issued.'], challenge: 'MULTI_STAGE_DEPENDENCY',
    path: ['Find the common ratio from consecutive terms.', 'Recover the first term when it is not shown.', 'Apply S = u1 / (1 - r).'], strategies: ['SUM_TO_INFINITY_FORMULA'], shortcut: ANSWER('adds the shown terms'),
  },
  {
    construct: LOG_EQUATION as never, familyId: 'tf.math.logarithms.equation-one-admissible-root', adapterId: P1, commandTerm: 'solve',
    concept: { stableId: 'math.alg.logarithms', canonicalName: 'Logarithms' }, skill: 'Algebraic reasoning', action: 'SOLVE',
    object: 'A logarithmic equation in one unknown with integer bases, written with the laws of logarithms or a change of base.', observable: 'Combines the logarithms with their laws, removes them by exponentiation, solves and keeps only the admissible root.',
    structure: 'log_b of expressions in x equal to an integer n; combining the logarithms gives a polynomial equation with exactly one root in the domain.',
    variables: [{ symbol: 'base', meaning: 'Base of the logarithms', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'n', meaning: 'Right-hand side', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'k', meaning: 'Shift in the argument, or the power of the second base', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'c', meaning: 'Shift in the second argument', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'form', meaning: 'Sum, difference or change of base', role: 'PARAMETER', domain: 'CATEGORY' }, { symbol: 'root', meaning: 'The admissible solution', role: 'UNKNOWN', domain: 'INTEGER' }],
    relationships: ['SUM: x (x - k) = base^n', 'DIFFERENCE: x + k = base^n (x - c)', 'CHANGE_OF_BASE: log_b x + log_(b^k) x = n'], constraints: ['Exactly one root lies in the domain of every logarithm.', 'The root is a positive integer of at most 1000.'],
    misconceptions: [{ id: 'adds-the-arguments', description: 'Adds the arguments instead of multiplying them.', producesError: '(base^n + k) / 2' }, { id: 'uses-n-times-the-base', description: 'Takes b^n to be n times b.', producesError: 'base * n' }, { id: 'subtracts-the-arguments', description: 'Subtracts the arguments instead of dividing them.', producesError: 'no value' }, { id: 'ignores-the-change-of-base', description: 'Treats the second logarithm as base b.', producesError: 'base^n / 2' }, { id: 'treats-both-logs-as-base-b', description: 'Writes 2 log_b x = n.', producesError: 'sqrt(base^n)' }],
    levers: { FOUNDATIONAL: ['Sum of two logarithms of the same base.'], STANDARD: ['Difference of two logarithms of the same base.'], CHALLENGE: ['Logarithms of a base and a power of that base (change of base).'] },
    exclusions: ['One admissible root only; the rejected root is never asked for.', 'The vertical fixture equation is never re-issued.'], challenge: 'DOMAIN_CONSTRAINT',
    path: ['Combine the logarithms with the laws of logarithms (or change the base).', 'Exponentiate and solve the resulting equation.', 'Reject the root outside the domain.'], strategies: ['LAWS_OF_LOGARITHMS', 'CHANGE_OF_BASE'], shortcut: ANSWER('adds the arguments'),
  },
  {
    construct: DEFINITE_INTEGRAL_POLYNOMIAL as never, familyId: 'tf.math.calculus.definite-integral-polynomial', adapterId: P1, commandTerm: 'find',
    concept: { stableId: 'math.calc.integration', canonicalName: 'Integration' }, skill: 'Algebraic reasoning', action: 'COMPUTE',
    object: 'The definite integral of a polynomial of degree at most 3 with integer coefficients between integer limits.', observable: 'Finds an antiderivative and evaluates it between the limits to give the exact value.',
    structure: 'The integral from lo to hi of c3 x^3 + c2 x^2 + c1 x + c0, equal to F(hi) - F(lo) for an antiderivative F.',
    variables: [{ symbol: 'c3', meaning: 'Cubic coefficient', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'c2', meaning: 'Quadratic coefficient', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'c1', meaning: 'Linear coefficient', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'c0', meaning: 'Constant term', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'lo', meaning: 'Lower limit', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'hi', meaning: 'Upper limit', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'I', meaning: 'The value of the integral', role: 'UNKNOWN', domain: 'RATIONAL' }],
    relationships: ['F(x) = c3 x^4 / 4 + c2 x^3 / 3 + c1 x^2 / 2 + c0 x', 'I = F(hi) - F(lo)'], constraints: ['hi > lo and hi - lo <= 4.', 'The value is positive.'],
    misconceptions: [{ id: 'evaluates-only-the-upper-limit', description: 'Evaluates the antiderivative at the upper limit only.', producesError: 'F(hi)' }, { id: 'reverses-the-limits', description: 'Subtracts in the wrong order.', producesError: 'F(lo) - F(hi)' }, { id: 'subtracts-the-integrand-values', description: 'Subtracts the integrand instead of an antiderivative.', producesError: 'f(hi) - f(lo)' }],
    levers: { FOUNDATIONAL: ['Quadratic integrand, no constant term.', 'Positive limits.'], STANDARD: ['Quadratic integrand.', 'A non-positive lower limit.'], CHALLENGE: ['Cubic integrand.', 'Fractional value.'] },
    exclusions: ['Polynomial integrands only.', 'Positive values only.', 'The vertical fixture integral is never re-issued.'], challenge: 'MULTI_STAGE_DEPENDENCY',
    path: ['Integrate term by term.', 'Evaluate at the upper and the lower limit and subtract.'], strategies: ['ANTIDERIVATIVE'], shortcut: ANSWER('evaluates only the upper limit'),
  },
  {
    construct: AREA_BETWEEN_CURVE_AND_AXIS as never, familyId: 'tf.math.calculus.area-between-curve-and-axis', adapterId: P1, commandTerm: 'find',
    concept: { stableId: 'math.calc.integration', canonicalName: 'Integration' }, skill: 'Algebraic reasoning', action: 'COMPUTE',
    object: 'A downward parabola with integer roots, given in expanded form, and the region it encloses with the x-axis.', observable: 'Finds where the curve meets the x-axis and integrates between those points to give the exact enclosed area.',
    structure: 'y = k (x - r)(s - x), positive between r < s; the enclosed area is the integral from r to s, equal to k (s - r)^3 / 6.',
    variables: [{ symbol: 'k', meaning: 'Scale of the curve', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'r', meaning: 'Smaller root', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 's', meaning: 'Larger root', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'A', meaning: 'The enclosed area', role: 'UNKNOWN', domain: 'RATIONAL' }],
    relationships: ['y = -k x^2 + k (r + s) x - k r s', 'A = k (s - r)^3 / 6'], constraints: ['r < s, s - r <= 12, r >= -4.'],
    misconceptions: [{ id: 'gives-the-maximum-height', description: 'Gives the height of the vertex.', producesError: 'k (s - r)^2 / 4' }, { id: 'divides-by-three-not-six', description: 'Divides by 3 instead of 6.', producesError: 'k (s - r)^3 / 3' }, { id: 'forgets-the-leading-coefficient', description: 'Ignores the scale k.', producesError: '(s - r)^3 / 6' }],
    levers: { FOUNDATIONAL: ['k = 1.', 'One root at 0.'], STANDARD: ['k = 1.', 'Both roots non-zero.'], CHALLENGE: ['k >= 2.'] },
    exclusions: ['A single region above the x-axis only.'], challenge: 'MULTI_STAGE_DEPENDENCY',
    path: ['Find the roots of the curve.', 'Integrate the curve between the roots.'], strategies: ['DEFINITE_INTEGRAL_BETWEEN_ROOTS'], shortcut: ANSWER('gives the maximum height'),
  },
  {
    construct: TANGENT_GRADIENT_AT_A_POINT as never, familyId: 'tf.math.calculus.tangent-gradient-at-a-point', adapterId: P1, commandTerm: 'find',
    concept: { stableId: 'math.calc.differentiation', canonicalName: 'Differentiation' }, skill: 'Algebraic reasoning', action: 'COMPUTE',
    object: 'A polynomial curve of degree at most 3, given expanded or as a product, and a point on it given by its x-coordinate.', observable: 'Differentiates the curve and evaluates the derivative at the point to give the gradient of the tangent.',
    structure: "The gradient of the tangent to y = f(x) at x = t is f'(t); in product form f(x) = (x^2 + u)(x + w).",
    variables: [{ symbol: 'c3', meaning: 'Cubic coefficient', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'c2', meaning: 'Quadratic coefficient', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'c1', meaning: 'Linear coefficient', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'c0', meaning: 'Constant term', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 't', meaning: 'x-coordinate of the point', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'u', meaning: 'Constant of the quadratic factor', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'w', meaning: 'Constant of the linear factor', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'form', meaning: 'Expanded or product form', role: 'PARAMETER', domain: 'CATEGORY' }, { symbol: 'm', meaning: 'The gradient', role: 'UNKNOWN', domain: 'INTEGER' }],
    relationships: ["m = f'(t)", "f'(x) = 3 c3 x^2 + 2 c2 x + c1"], constraints: ['The gradient is a positive integer of at most 200.'],
    misconceptions: [{ id: 'gives-the-y-coordinate', description: 'Gives f(t) instead of the gradient.', producesError: 'f(t)' }, { id: 'drops-the-power-without-multiplying', description: 'Lowers the power without multiplying by it.', producesError: 'c3 t^2 + c2 t + c1' }, { id: 'multiplies-the-derivatives-of-the-factors', description: 'Multiplies the derivatives of the two factors.', producesError: 'the product 2t times 1' }],
    levers: { FOUNDATIONAL: ['Quadratic curve, expanded.'], STANDARD: ['Cubic curve, expanded.'], CHALLENGE: ['Cubic curve given as a product of factors.'] },
    exclusions: ['Gradient only: the equation of the tangent is not asked.'], challenge: 'NON_OBVIOUS_STRATEGY',
    path: ['Expand the curve when it is a product (or use the product rule).', 'Differentiate.', 'Evaluate the derivative at the point.'], strategies: ['POWER_RULE', 'PRODUCT_RULE'], shortcut: ANSWER('gives the y-coordinate'),
  },
  {
    construct: CUBIC_LOCAL_MAXIMUM as never, familyId: 'tf.math.calculus.cubic-local-maximum', adapterId: P1, commandTerm: 'find',
    concept: { stableId: 'math.calc.differentiation', canonicalName: 'Differentiation' }, skill: 'Algebraic reasoning', action: 'COMPUTE',
    object: 'A cubic curve with integer stationary points, given in expanded form.', observable: 'Finds the stationary points, decides which is the local maximum and gives its x- or y-coordinate.',
    structure: "y = lead (x^3 - 3 (r + s)/2 x^2 + 3 r s x) + d, so y' = 3 lead (x - r)(x - s); the local maximum is at r when lead = 1 and at s when lead = -1.",
    variables: [{ symbol: 'lead', meaning: 'Sign of the leading coefficient', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'r', meaning: 'Smaller stationary abscissa', role: 'PARAMETER', domain: 'INTEGER' }, { symbol: 's', meaning: 'Larger stationary abscissa', role: 'PARAMETER', domain: 'INTEGER' }, { symbol: 'd', meaning: 'Constant term', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'ask', meaning: 'x- or y-coordinate asked', role: 'PARAMETER', domain: 'CATEGORY' }, { symbol: 'M', meaning: 'The asked coordinate of the local maximum', role: 'UNKNOWN', domain: 'INTEGER' }],
    relationships: ["y' = 3 lead (x - r)(x - s)", 'the local maximum is where the derivative changes from positive to negative'], constraints: ['r + s is even and s > r.', 'The key is a positive integer of at most 500.'],
    misconceptions: [{ id: 'gives-the-local-minimum', description: 'Gives the x-coordinate of the local minimum.', producesError: 'the other stationary abscissa' }, { id: 'gives-the-maximum-value', description: 'Gives the y-coordinate when the x-coordinate is asked.', producesError: 'y at the maximum' }, { id: 'gives-the-x-coordinate', description: 'Gives the x-coordinate when the y-coordinate is asked.', producesError: 'x at the maximum' }, { id: 'gives-the-local-minimum-value', description: 'Gives the value at the local minimum.', producesError: 'y at the minimum' }],
    levers: { FOUNDATIONAL: ['Positive leading coefficient.', 'The x-coordinate is asked.'], STANDARD: ['Negative leading coefficient.', 'The x-coordinate is asked.'], CHALLENGE: ['Positive leading coefficient.', 'The y-coordinate is asked.'] },
    exclusions: ['Integer stationary points only.'], challenge: 'MULTI_STAGE_DEPENDENCY',
    path: ['Differentiate and solve the derivative equal to zero.', 'Classify the stationary points (second derivative or sign change).', 'Give the asked coordinate of the maximum.'], strategies: ['SECOND_DERIVATIVE_TEST', 'SIGN_OF_THE_DERIVATIVE'], shortcut: ANSWER('gives the local minimum'),
  },
  {
    construct: BINOMIAL_EXACT_PROBABILITY as never, familyId: 'tf.math.probability.binomial-exact-probability', adapterId: P2, commandTerm: 'find',
    concept: { stableId: 'math.prob.binomial-distribution', canonicalName: 'Binomial distribution' }, skill: 'Probabilistic reasoning', action: 'COMPUTE',
    object: 'A binomial random variable with a small number of trials and a simple rational success probability, and an event about it.', observable: 'Identifies the binomial model and computes the exact probability of the event.',
    structure: 'X ~ B(n, p) with p = pn / pd; P(X = k) = C(n, k) p^k (1 - p)^(n - k), summed over the event.',
    variables: [{ symbol: 'n', meaning: 'Number of trials', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'pn', meaning: 'Numerator of p', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'pd', meaning: 'Denominator of p', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'k', meaning: 'Number of successes in the event', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'event', meaning: 'Equals, at most or at least', role: 'PARAMETER', domain: 'CATEGORY' }, { symbol: 'P', meaning: 'The probability', role: 'UNKNOWN', domain: 'RATIONAL' }],
    relationships: ['P(X = j) = C(n, j) p^j (1 - p)^(n - j)', 'P(event) = sum of P(X = j) over the event'], constraints: ['3 <= n <= 6, p a fraction with denominator at most 6.', 'The exact answer has a denominator of at most 50000.'],
    misconceptions: [{ id: 'forgets-the-binomial-coefficient', description: 'Omits C(n, k).', producesError: 'p^k (1 - p)^(n - k)' }, { id: 'gives-only-the-point-probability', description: 'Gives P(X = k) for a cumulative event.', producesError: 'P(X = k)' }, { id: 'uses-the-wrong-tail', description: 'Gives the complement of the event.', producesError: '1 - P(event)' }, { id: 'swaps-p-and-q', description: 'Swaps the probabilities of success and failure.', producesError: 'P with 1 - p' }],
    levers: { FOUNDATIONAL: ['A single value: P(X = k).'], STANDARD: ['A cumulative event: P(X <= k).'], CHALLENGE: ['An upper-tail event: P(X >= k).'] },
    exclusions: ['Exact fractions only; no normal approximation.'], challenge: 'MULTI_STAGE_DEPENDENCY',
    path: ['Identify n and p.', 'Write the probabilities of the values in the event.', 'Add them (or use the complement).'], strategies: ['BINOMIAL_FORMULA', 'COMPLEMENT'], shortcut: ANSWER('forgets the binomial coefficient'),
  },
  {
    construct: NORMAL_SYMMETRY as never, familyId: 'tf.math.probability.normal-symmetry', adapterId: P2, commandTerm: 'find',
    concept: { stableId: 'math.prob.normal-distribution', canonicalName: 'Normal distribution' }, skill: 'Probabilistic reasoning', action: 'COMPUTE',
    object: 'A normal random variable with an unstated standard deviation and probabilities of intervals symmetric about the mean.', observable: 'Uses the symmetry of the normal distribution about its mean to find the mean or a tail probability.',
    structure: 'X ~ N(mu, sigma^2) is symmetric about mu: P(X < mu - w) = P(X > mu + w), and the two tails and the centre sum to 1.',
    variables: [{ symbol: 'a', meaning: 'Lower value', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'b', meaning: 'Upper value', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'mu', meaning: 'Mean (when stated)', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'given', meaning: 'Given probability, in hundredths', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'task', meaning: 'What is asked', role: 'PARAMETER', domain: 'CATEGORY' }, { symbol: 'v', meaning: 'The mean or the probability asked', role: 'UNKNOWN', domain: 'RATIONAL' }],
    relationships: ['mu = (a + b) / 2 when the tails are equal', 'P(X > b) = (1 - P(a < X < b)) / 2', 'P(X < a) = 1 - P(X < b) when a and b are symmetric about mu'], constraints: ['The standard deviation is never stated.', 'Given probabilities are even hundredths strictly between 0.5 and 1.'],
    misconceptions: [{ id: 'adds-the-two-values', description: 'Adds the two values instead of averaging.', producesError: 'a + b' }, { id: 'gives-half-the-gap', description: 'Gives half the distance between the values.', producesError: '(b - a) / 2' }, { id: 'gives-the-complement-of-the-centre', description: 'Gives both tails together.', producesError: '1 - P(centre)' }, { id: 'halves-the-centre', description: 'Halves the central probability.', producesError: 'P(centre) / 2' }, { id: 'gives-the-given-probability', description: 'Repeats the given probability.', producesError: 'P(X < b)' }, { id: 'subtracts-a-half', description: 'Subtracts one half from the given probability.', producesError: 'P(X < b) - 0.5' }],
    levers: { FOUNDATIONAL: ['Find the mean from two equal tails.'], STANDARD: ['Find a tail from a central probability.'], CHALLENGE: ['Find a lower tail from an upper cumulative probability.'] },
    exclusions: ['Symmetry only: no inverse-normal or standardisation is asked.'], challenge: 'NON_OBVIOUS_STRATEGY',
    path: ['Use the symmetry of the distribution about the mean.', 'Use that total probability is 1.'], strategies: ['SYMMETRY_ABOUT_THE_MEAN'], shortcut: ANSWER('halves the centre'),
  },
];

/** The eight adopted entries (each renders exactly its 30 package candidates). */
export const CF_IB_AAHL_01_ADOPTED: readonly LibraryEntry[] = CF_IB_AAHL_01_ADOPTION_SPECS.map(adopt);
