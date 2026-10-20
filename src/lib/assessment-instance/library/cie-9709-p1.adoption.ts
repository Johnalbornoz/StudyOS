/**
 * Cambridge 9709 Paper 1 -- the eight StudyUs-original deterministic constructs (cie-9709-p1.constructs.ts) as
 * governed library entries: one per OFFICIAL syllabus section, adapter CAMBRIDGE.9709.P1, IB-proven generic
 * capability reused (SHORT_RESPONSE, answer marks, exact numeric policy, canonical scorer), Cambridge semantics kept
 * (the syllabus's own command words; scientific calculator expected). Written by the model, reviewed by nobody.
 */
import type { ParametricConstruct } from './parametric';
import type { LibraryEntry } from './catalogue';
import { adoptParametricConstruct, type AdoptionOptions, type AdoptionSpec } from './cf-ib-aahl-01.adoption';
import { CIE_DEFINITE_INTEGRAL, CIE_DISTANCE_BETWEEN_POINTS, CIE_GP_SUM_TO_INFINITY, CIE_GRADIENT_AT_A_POINT, CIE_INVERSE_FUNCTION_VALUE, CIE_QUADRATIC_MINIMUM, CIE_SECTOR_MEASURE, CIE_TRIG_EQUATION_IN_INTERVAL } from './cie-9709-p1.constructs';

const P1 = 'CAMBRIDGE.9709.P1';
const OPTIONS: AdoptionOptions = { system: 'CAMBRIDGE', provenanceNote: 'Track B: StudyUs-original deterministic construct for Cambridge 9709 Paper 1, written in-session by the model; reviewed by nobody. No Cambridge question, mark scheme or wording is copied.', referenceSourceKeys: ['cie-9709-syllabus-2026-2027'], origin: 'TRACK_B_DETERMINISTIC' };
const ANSWER = (what: string) => ({ id: 'answer-equals-a-misconception', bypass: `A learner who ${what} would be marked right if the key equalled that value.`, instanceRule: 'Parameter sets whose key a modelled misconception also gives are dropped.' });
const c = (x: unknown) => x as ParametricConstruct<never>;

export const CIE_9709_P1_ADOPTION_SPECS: readonly AdoptionSpec[] = [
  {
    construct: c(CIE_QUADRATIC_MINIMUM), familyId: 'tf.cie.quadratics.minimum-value', adapterId: P1, commandTerm: 'determine',
    concept: { stableId: 'math.alg.quadratics', canonicalName: 'Quadratic functions and inequalities' }, skill: 'Algebraic reasoning', action: 'COMPUTE',
    object: 'A quadratic function f(x) = ax² + bx + c with a > 0 and integer coefficients, defined for all real x.', observable: 'Completes the square (or locates the vertex) and gives the minimum value of the function.',
    structure: 'f(x) = ax² + bx + c with integer a >= 1, b != 0, c > 0; completing the square gives the minimum c - b²/4a > 0.',
    variables: [{ symbol: 'a', meaning: 'Leading coefficient', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'b', meaning: 'Linear coefficient', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'c', meaning: 'Constant term', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'm', meaning: 'The minimum value', role: 'UNKNOWN', domain: 'RATIONAL' }],
    relationships: ['f(x) = a(x + b/2a)^2 + c - b^2/4a', 'm = c - b^2 / (4a)'], constraints: ['a >= 1, so the graph has a minimum point.', 'The minimum is positive.'],
    misconceptions: [{ id: 'gives-the-x-coordinate-of-the-vertex', description: 'Gives the x-coordinate of the vertex.', producesError: '-b / (2a)' }, { id: 'gives-the-y-intercept', description: 'Gives f(0).', producesError: 'f(0) = c' }, { id: 'adds-the-square-term', description: 'Completes the square with the wrong sign.', producesError: 'c + b^2 / (4a)' }],
    levers: { FOUNDATIONAL: ['a = 1, integer vertex.'], STANDARD: ['a from 2 to 4, integer vertex abscissa.'], CHALLENGE: ['a from 2 to 4, fractional vertex abscissa.'] },
    exclusions: ['Minimum value only (syllabus 1.1, completed-square use).'], challenge: 'NON_OBVIOUS_STRATEGY',
    path: ['Complete the square (or use x = -b/2a).', 'Read the minimum value.'], strategies: ['COMPLETING_THE_SQUARE', 'VERTEX_FORMULA', 'DERIVATIVE_ZERO'], shortcut: ANSWER('gives the x-coordinate of the vertex'),
  },
  {
    construct: c(CIE_INVERSE_FUNCTION_VALUE), familyId: 'tf.cie.functions.inverse-value', adapterId: P1, commandTerm: 'determine',
    concept: { stableId: 'math.fun.rational-functions-inverses', canonicalName: 'Rational functions and inverses' }, skill: 'Algebraic reasoning', action: 'COMPUTE',
    object: 'A one-one linear or rational function with integer coefficients and a value of its inverse.', observable: 'Finds the inverse of the one-one function (or solves f(x) = k) and gives the value of the inverse at k.',
    structure: 'f(x) = (ax + b)/(cx + d), ad - bc != 0 (c = 0, d = 1 for a linear function); f⁻¹(k) = (dk - b)/(a - ck).',
    variables: [{ symbol: 'a', meaning: 'Coefficient a', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'b', meaning: 'Coefficient b', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'c', meaning: 'Coefficient c', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'd', meaning: 'Coefficient d', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'k', meaning: 'Input of the inverse', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'kind', meaning: 'Linear or rational', role: 'PARAMETER', domain: 'CATEGORY' }, { symbol: 'v', meaning: 'The value of the inverse', role: 'UNKNOWN', domain: 'RATIONAL' }],
    relationships: ['f(v) = k', 'v = (d k - b) / (a - c k)'], constraints: ['f is one-one on its domain.', 'The value is positive.'],
    misconceptions: [{ id: 'evaluates-f-instead-of-its-inverse', description: 'Evaluates f(k) instead of the inverse.', producesError: 'f(k)' }, { id: 'takes-the-reciprocal-of-f', description: 'Takes 1/f(k) as the inverse.', producesError: '1 / f(k)' }],
    levers: { FOUNDATIONAL: ['Linear function.'], STANDARD: ['Rational function, integer value.'], CHALLENGE: ['Rational function, fractional value.'] },
    exclusions: ['A value of the inverse only (syllabus 1.2); range, composition and transformations are not asked.'], challenge: 'MISCONCEPTION_RESISTANCE',
    path: ['Set f(x) = k (or find f⁻¹).', 'Solve for x.'], strategies: ['SOLVE_F_EQUALS_K', 'INVERSE_FUNCTION'], shortcut: ANSWER('evaluates f(k)'),
  },
  {
    construct: c(CIE_DISTANCE_BETWEEN_POINTS), familyId: 'tf.cie.coordinate-geometry.segment-length', adapterId: P1, commandTerm: 'calculate',
    concept: { stableId: 'math.geo.coordinate-plane', canonicalName: 'Plano cartesiano: coordenadas, distancia y punto medio', canonicalSubject: 'Matemáticas' }, skill: 'Geometric reasoning', action: 'COMPUTE',
    object: 'A line segment AB given by the coordinates of its ends, or of one end and its midpoint.', observable: 'Uses the midpoint relation where needed and the distance formula to give the length of AB.',
    structure: 'A = (x1, y1), B = (x1 + dx, y1 + dy) with dx² + dy² a perfect square; |AB| = sqrt(dx² + dy²); the midpoint is A + (dx/2, dy/2).',
    variables: [{ symbol: 'x1', meaning: 'x-coordinate of A', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'y1', meaning: 'y-coordinate of A', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'dx', meaning: 'Change in x from A to B', role: 'PARAMETER', domain: 'INTEGER' }, { symbol: 'dy', meaning: 'Change in y from A to B', role: 'PARAMETER', domain: 'INTEGER' }, { symbol: 'given', meaning: 'Both ends, or an end and the midpoint', role: 'PARAMETER', domain: 'CATEGORY' }, { symbol: 'L', meaning: 'The length of AB', role: 'UNKNOWN', domain: 'INTEGER' }],
    relationships: ['L^2 = dx^2 + dy^2', 'midpoint = ((x1 + x2)/2, (y1 + y2)/2)'], constraints: ['The length is a positive integer.', 'The midpoint has integer coordinates.'],
    misconceptions: [{ id: 'gives-the-square-of-the-length', description: 'Forgets the square root.', producesError: 'dx^2 + dy^2' }, { id: 'adds-the-coordinate-differences', description: 'Adds the coordinate differences.', producesError: '|dx| + |dy|' }, { id: 'gives-the-distance-to-the-midpoint', description: 'Gives the length from A to the midpoint.', producesError: 'L / 2' }],
    levers: { FOUNDATIONAL: ['Both ends shown, first quadrant, B up and to the right of A.'], STANDARD: ['Both ends shown, negative coordinates or directions.'], CHALLENGE: ['One end and the midpoint shown.'] },
    exclusions: ['Distance and midpoint only (syllabus 1.3); line and circle equations are not asked by this construct.'], challenge: 'MULTI_STAGE_DEPENDENCY',
    path: ['Recover B from the midpoint when it is the midpoint that is shown.', 'Apply the distance formula.'], strategies: ['DISTANCE_FORMULA', 'MIDPOINT_RELATION'], shortcut: ANSWER('forgets the square root'),
  },
  {
    construct: c(CIE_SECTOR_MEASURE), familyId: 'tf.cie.circular-measure.sector', adapterId: P1, commandTerm: 'calculate',
    concept: { stableId: 'math.geo.circles', canonicalName: 'Círculo: circunferencia, área y arcos', canonicalSubject: 'Matemáticas' }, skill: 'Geometric reasoning', action: 'COMPUTE',
    object: 'A sector of a circle given by its radius and its angle in radians, or by its radius and its arc length.', observable: 'Uses s = rθ and A = ½r²θ (θ in radians) to give the arc length or the sector area.',
    structure: 'A sector of radius r and angle θ radians: s = r θ, A = r² θ / 2 = r s / 2.',
    variables: [{ symbol: 'r', meaning: 'Radius (cm)', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'theta10', meaning: 'Ten times the angle in radians', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'ask', meaning: 'Arc, area, or area from the arc', role: 'PARAMETER', domain: 'CATEGORY' }, { symbol: 'q', meaning: 'The arc length or the area', role: 'UNKNOWN', domain: 'RATIONAL' }],
    relationships: ['s = r * theta', 'A = r^2 * theta / 2', 'A = r * s / 2'], constraints: ['theta is between 0.2 and 3.0 radians, not a whole number.', 'The arc length is an integer when it is the arc that is shown.'],
    misconceptions: [{ id: 'gives-the-area', description: 'Gives the area when the arc is asked.', producesError: 'r^2 theta / 2' }, { id: 'uses-the-diameter', description: 'Uses the diameter in s = r theta.', producesError: '2 r theta' }, { id: 'omits-the-half', description: 'Omits the half in the area formula.', producesError: 'r^2 theta' }, { id: 'gives-the-arc-length', description: 'Gives the arc length when the area is asked.', producesError: 'r theta' }, { id: 'uses-r-not-r-squared', description: 'Uses r instead of r squared.', producesError: 'r theta / 2' }],
    levers: { FOUNDATIONAL: ['Arc length from the radius and the angle.'], STANDARD: ['Sector area from the radius and the angle.'], CHALLENGE: ['Sector area from the radius and the arc length.'] },
    exclusions: ['Radian measure only (syllabus 1.4); degree conversion and triangle work are not asked by this construct.'], challenge: 'MULTI_STAGE_DEPENDENCY',
    path: ['Find the angle in radians when only the arc is shown (θ = s / r).', 'Apply s = rθ or A = ½r²θ.'], strategies: ['ARC_LENGTH_FORMULA', 'SECTOR_AREA_FORMULA'], shortcut: ANSWER('omits the half'),
  },
  {
    construct: c(CIE_TRIG_EQUATION_IN_INTERVAL), familyId: 'tf.cie.trigonometry.equation-in-interval', adapterId: P1, commandTerm: 'determine',
    concept: { stableId: 'math.trig.ratios', canonicalName: 'Trigonometry and triangles' }, skill: 'Algebraic reasoning', action: 'SOLVE',
    object: 'A simple trigonometric equation c·f(x − α) = v with an exact value v, and an interval of 90° that holds exactly one solution.', observable: 'Uses exact values and the signs of sine, cosine and tangent in each quadrant to give the one solution in the interval.',
    structure: 'f in {sin, cos, tan}, v an exact value (±1/2, ±√3/2, ±1, ±√3, ±1/√3); the solution in the stated quadrant is the reference angle placed in that quadrant, shifted by α.',
    variables: [{ symbol: 'fn', meaning: 'The trigonometric function', role: 'PARAMETER', domain: 'CATEGORY' }, { symbol: 'value', meaning: 'The exact value', role: 'PARAMETER', domain: 'CATEGORY' }, { symbol: 'quadrant', meaning: 'The quadrant of the interval', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'shift', meaning: 'Shift of the argument (degrees)', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'x', meaning: 'The solution (degrees)', role: 'UNKNOWN', domain: 'INTEGER' }],
    relationships: ['f(x - shift) = value', 'x - shift = the reference angle placed in the quadrant'], constraints: ['Exactly one solution lies in the interval.', 'The solution is positive.'],
    misconceptions: [{ id: 'gives-the-principal-reference-angle', description: 'Gives the reference angle instead of the solution in the interval.', producesError: 'reference angle (+ shift)' }, { id: 'uses-the-wrong-quadrant-rule', description: 'Places the reference angle with the wrong quadrant rule.', producesError: '180 - ref or 180 + ref' }, { id: 'ignores-the-shift', description: 'Solves for x - shift and stops.', producesError: 'x - shift' }, { id: 'subtracts-the-shift', description: 'Subtracts the shift instead of adding it.', producesError: 'x - 2 shift' }],
    levers: { FOUNDATIONAL: ['Positive exact value, no shift.'], STANDARD: ['Negative exact value, no shift.'], CHALLENGE: ['Shifted argument.'] },
    exclusions: ['One solution in a stated interval (syllabus 1.5); general solutions and identities are not asked.'], challenge: 'DOMAIN_CONSTRAINT',
    path: ['Find the reference angle from the exact value.', 'Place it in the quadrant of the interval using the sign of the function.', 'Undo the shift.'], strategies: ['CAST_DIAGRAM', 'GRAPH_SYMMETRY'], shortcut: ANSWER('gives the reference angle'),
  },
  {
    construct: c(CIE_GP_SUM_TO_INFINITY), familyId: 'tf.cie.series.gp-sum-to-infinity', adapterId: P1, commandTerm: 'calculate',
    concept: { stableId: 'math.alg.sequences-series', canonicalName: 'Sequences and series' }, skill: 'Algebraic reasoning', action: 'COMPUTE',
    object: 'A convergent geometric progression with a rational common ratio, given by its first terms or by two consecutive terms.', observable: 'Finds the common ratio and the first term and applies the sum to infinity of a convergent geometric progression.',
    structure: 'A geometric progression with first term a and ratio r, |r| < 1; the sum to infinity is a / (1 - r).',
    variables: [{ symbol: 't1', meaning: 'First term', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 't2', meaning: 'Second term', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 't3', meaning: 'Third term', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'p', meaning: 'Numerator of |r|', role: 'PARAMETER', domain: 'INTEGER' }, { symbol: 'q', meaning: 'Denominator of |r|', role: 'PARAMETER', domain: 'INTEGER' }, { symbol: 'sign', meaning: 'Sign of r', role: 'PARAMETER', domain: 'INTEGER' }, { symbol: 'shown', meaning: 'Which terms are shown', role: 'PARAMETER', domain: 'CATEGORY' }, { symbol: 'S', meaning: 'The sum to infinity', role: 'UNKNOWN', domain: 'RATIONAL' }],
    relationships: ['r = t2 / t1', 'S = t1 / (1 - r)'], constraints: ['|r| < 1.', 'The first term is a positive integer of at most 400.'],
    misconceptions: [{ id: 'uses-one-plus-r', description: 'Uses 1 + r in the denominator.', producesError: 't1 / (1 + r)' }, { id: 'sums-the-shown-terms', description: 'Adds only the terms shown.', producesError: 't1 + t2 + t3' }, { id: 'starts-from-the-second-term', description: 'Starts from the second term.', producesError: 't2 / (1 - r)' }],
    levers: { FOUNDATIONAL: ['Positive ratio, first three terms shown.'], STANDARD: ['Negative ratio, first three terms shown.'], CHALLENGE: ['Second and third terms shown; the first term must be recovered.'] },
    exclusions: ['Sum to infinity only (syllabus 1.6); binomial expansion and arithmetic progressions are not asked by this construct.'], challenge: 'MULTI_STAGE_DEPENDENCY',
    path: ['Find r from consecutive terms.', 'Recover the first term when it is not shown.', 'Apply S = a / (1 - r).'], strategies: ['SUM_TO_INFINITY_FORMULA'], shortcut: ANSWER('adds the shown terms'),
  },
  {
    construct: c(CIE_GRADIENT_AT_A_POINT), familyId: 'tf.cie.differentiation.gradient-at-a-point', adapterId: P1, commandTerm: 'calculate',
    concept: { stableId: 'math.calc.differentiation', canonicalName: 'Differentiation' }, skill: 'Algebraic reasoning', action: 'COMPUTE',
    object: 'A polynomial curve of degree at most 3, given expanded or as a product, and the x-coordinate of a point on it.', observable: 'Differentiates and evaluates the derivative at the point to give the gradient of the curve.',
    structure: "The gradient of y = f(x) at x = t is f'(t).",
    variables: [{ symbol: 'c3', meaning: 'Cubic coefficient', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'c2', meaning: 'Quadratic coefficient', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'c1', meaning: 'Linear coefficient', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'c0', meaning: 'Constant term', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 't', meaning: 'x-coordinate of the point', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'u', meaning: 'Constant of the quadratic factor', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'w', meaning: 'Constant of the linear factor', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'form', meaning: 'Expanded or product form', role: 'PARAMETER', domain: 'CATEGORY' }, { symbol: 'm', meaning: 'The gradient', role: 'UNKNOWN', domain: 'INTEGER' }],
    relationships: ["m = f'(t)", "f'(x) = 3 c3 x^2 + 2 c2 x + c1"], constraints: ['The gradient is a positive integer of at most 200.'],
    misconceptions: [{ id: 'gives-the-y-coordinate', description: 'Gives f(t).', producesError: 'f(t)' }, { id: 'drops-the-power-without-multiplying', description: 'Lowers the power without multiplying.', producesError: 'c3 t^2 + c2 t + c1' }, { id: 'multiplies-the-derivatives-of-the-factors', description: 'Multiplies the derivatives of the factors.', producesError: 'the product 2t times 1' }],
    levers: { FOUNDATIONAL: ['Quadratic curve.'], STANDARD: ['Cubic curve.'], CHALLENGE: ['Cubic curve given as a product.'] },
    exclusions: ['Gradient at a point only (syllabus 1.7).'], challenge: 'NON_OBVIOUS_STRATEGY',
    path: ['Expand a product.', 'Differentiate.', 'Substitute x = t.'], strategies: ['POWER_RULE', 'EXPAND_THEN_DIFFERENTIATE'], shortcut: ANSWER('gives the y-coordinate'),
  },
  {
    construct: c(CIE_DEFINITE_INTEGRAL), familyId: 'tf.cie.integration.definite-integral', adapterId: P1, commandTerm: 'evaluate',
    concept: { stableId: 'math.calc.integration', canonicalName: 'Integration' }, skill: 'Algebraic reasoning', action: 'COMPUTE',
    object: 'The definite integral of a polynomial of degree at most 3 with integer coefficients between integer limits.', observable: 'Integrates term by term and evaluates between the limits to give the exact value.',
    structure: 'The integral from lo to hi of c3 x^3 + c2 x^2 + c1 x + c0 equals F(hi) - F(lo).',
    variables: [{ symbol: 'c3', meaning: 'Cubic coefficient', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'c2', meaning: 'Quadratic coefficient', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'c1', meaning: 'Linear coefficient', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'c0', meaning: 'Constant term', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'lo', meaning: 'Lower limit', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'hi', meaning: 'Upper limit', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'I', meaning: 'The value', role: 'UNKNOWN', domain: 'RATIONAL' }],
    relationships: ['F(x) = c3 x^4/4 + c2 x^3/3 + c1 x^2/2 + c0 x', 'I = F(hi) - F(lo)'], constraints: ['hi > lo, hi - lo <= 4.', 'The value is positive.'],
    misconceptions: [{ id: 'evaluates-only-the-upper-limit', description: 'Evaluates only at the upper limit.', producesError: 'F(hi)' }, { id: 'reverses-the-limits', description: 'Subtracts in the wrong order.', producesError: 'F(lo) - F(hi)' }, { id: 'subtracts-the-integrand-values', description: 'Subtracts the integrand values.', producesError: 'f(hi) - f(lo)' }],
    levers: { FOUNDATIONAL: ['Quadratic integrand, positive limits.'], STANDARD: ['Quadratic integrand, non-positive lower limit.'], CHALLENGE: ['Cubic integrand, fractional value.'] },
    exclusions: ['Definite integrals of polynomials only (syllabus 1.8); areas and volumes are not asked by this construct.'], challenge: 'MULTI_STAGE_DEPENDENCY',
    path: ['Integrate term by term.', 'Evaluate at the limits and subtract.'], strategies: ['ANTIDERIVATIVE'], shortcut: ANSWER('evaluates only the upper limit'),
  },
];

export const CIE_9709_P1_ENTRIES: readonly LibraryEntry[] = CIE_9709_P1_ADOPTION_SPECS.map((s) => adoptParametricConstruct(s, OPTIONS));
