/**
 * Cambridge 9709 Papers 2, 4 and 5 -- the ten StudyUs-original deterministic constructs (cie-9709-p2p4p5.constructs.ts)
 * as governed library entries: adapters CAMBRIDGE.9709.P2 / P4 / P5, the IB-proven generic capability reused
 * (SHORT_RESPONSE, answer marks, exact numeric policy, canonical scorer), Cambridge semantics kept (the syllabus's own
 * command words). The objective each entry is placed in is set by the caller. Written by the model, reviewed by nobody.
 */
import type { ParametricConstruct } from './parametric';
import type { LibraryEntry } from './catalogue';
import { adoptParametricConstruct, type AdoptionOptions, type AdoptionSpec } from './cf-ib-aahl-01.adoption';
import { CIE_BINOMIAL_EXACT, CIE_CONSTANT_ACCELERATION, CIE_COUNTING_ARRANGEMENTS, CIE_ENERGY_WORK_POWER, CIE_FORCES_ON_A_PLANE, CIE_LOG_EXP_EQUATION, CIE_NORMAL_EXACT, CIE_NUMERICAL_ROOT, CIE_PRODUCT_QUOTIENT_GRADIENT, CIE_PROBABILITY_EVENTS } from './cie-9709-p2p4p5.constructs';

const P2 = 'CAMBRIDGE.9709.P2';
const P4 = 'CAMBRIDGE.9709.P4';
const P5 = 'CAMBRIDGE.9709.P5';
const OPTIONS: AdoptionOptions = { system: 'CAMBRIDGE', provenanceNote: 'Track B: StudyUs-original deterministic construct for Cambridge 9709 Papers 2, 4 and 5, written in-session by the model; reviewed by nobody. No Cambridge question, mark scheme or wording is copied.', referenceSourceKeys: ['cie-9709-syllabus-2026-2027'], origin: 'TRACK_B_DETERMINISTIC' };
const ANSWER = (what: string) => ({ id: 'answer-equals-a-misconception', bypass: `A learner who ${what} would be marked right if the key equalled that value.`, instanceRule: 'Parameter sets whose key a modelled misconception also gives are dropped.' });
const c = (x: unknown) => x as ParametricConstruct<never>;
const form = (meaning: string) => ({ symbol: 'form', meaning, role: 'PARAMETER' as const, domain: 'CATEGORY' as const });

export const CIE_9709_P2P4P5_ADOPTION_SPECS: readonly AdoptionSpec[] = [
  // ------------------------------------------------------------------------------------------------ Paper 2
  {
    construct: c(CIE_LOG_EXP_EQUATION), familyId: 'tf.cie.logarithms.log-exp-equation', adapterId: P2, commandTerm: 'determine',
    concept: { stableId: 'math.alg.logarithms', canonicalName: 'Logarithms' }, skill: 'Algebraic reasoning', action: 'COMPUTE',
    object: 'An exponential equation with a power of an integer base, or a logarithmic equation combining two logarithms of one base.', observable: 'Uses the laws of indices or of logarithms to remove the exponent or the logarithms, solves, and gives the admissible exact value of x.',
    structure: 'a^(kx + m) = a^q gives x = (q - m)/k; log_a(x + p) + log_a x = q gives x(x + p) = a^q; log_a(x + p) - log_a(x - c) = q gives x + p = a^q (x - c).',
    variables: [{ symbol: 'a', meaning: 'Base', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'q', meaning: 'Power of the base / right-hand side', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'k', meaning: 'Coefficient of x in the exponent', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'm', meaning: 'Constant in the exponent', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'p', meaning: 'Shift in the first argument', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'c', meaning: 'Shift in the second argument', role: 'GIVEN', domain: 'INTEGER' }, form('Exponential, sum or difference of logarithms'), { symbol: 'X', meaning: 'The solution', role: 'UNKNOWN', domain: 'RATIONAL' }],
    relationships: ['k x + m = q', 'x (x + p) = a^q', 'x + p = a^q (x - c)'], constraints: ['Every logarithm is defined at the solution.', 'The solution is positive and exact.'],
    misconceptions: [{ id: 'ignores-the-constant-in-the-exponent', description: 'Solves kx = q.', producesError: 'q / k' }, { id: 'adds-the-arguments', description: 'Replaces the product of the arguments by their sum.', producesError: '(a^q - p) / 2' }, { id: 'gives-the-rejected-root-without-its-sign', description: 'Gives the size of the negative root.', producesError: 'r + p' }, { id: 'ignores-the-second-shift', description: 'Drops the shift of the second argument.', producesError: 'p / (a^q - 1)' }, { id: 'takes-the-power-as-a-product', description: 'Takes a^q to be a times q.', producesError: 'a q instead of a^q' }],
    levers: { FOUNDATIONAL: ['Exponential equation with a power of the base on the right.'], STANDARD: ['Sum of two logarithms of one base; reject the negative root.'], CHALLENGE: ['Difference of two logarithms of one base; a fractional solution.'] },
    exclusions: ['Exact solutions only (syllabus 2.2); equations needing a calculator logarithm are not asked by this construct.'], challenge: 'MULTI_STAGE_DEPENDENCY',
    path: ['Write both sides with one base, or combine the logarithms.', 'Remove the exponent or the logarithms.', 'Solve and keep the admissible root.'], strategies: ['LAWS_OF_INDICES', 'LAWS_OF_LOGARITHMS'], shortcut: ANSWER('adds the arguments of the logarithms'),
  },
  {
    construct: c(CIE_PRODUCT_QUOTIENT_GRADIENT), familyId: 'tf.cie.differentiation.product-quotient-gradient', adapterId: P2, commandTerm: 'calculate',
    concept: { stableId: 'math.calc.differentiation', canonicalName: 'Differentiation' }, skill: 'Algebraic reasoning', action: 'COMPUTE',
    object: 'A curve given as a product or quotient of polynomials, or as a linear factor times ln or e of a linear function, and the x-coordinate of a point on it.', observable: 'Applies the product, quotient and chain rules, evaluates the derivative at the point, and gives the exact gradient.',
    structure: "Product: (uv)' = u'v + uv'; quotient: (u/v)' = (u'v - uv')/v^2; at the point, ln(ax + b) = ln 1 = 0 or e^(ax + b) = e^0 = 1, so the gradient is rational.",
    variables: [{ symbol: 'a', meaning: 'Coefficient a', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'b', meaning: 'Coefficient b', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'c', meaning: 'Coefficient c', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'p', meaning: 'Coefficient of x in the linear factor', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'q', meaning: 'Constant of the linear factor', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 't', meaning: 'x-coordinate of the point', role: 'GIVEN', domain: 'INTEGER' }, form('Product, quotient, ln product or exponential product'), { symbol: 'm', meaning: 'The gradient', role: 'UNKNOWN', domain: 'RATIONAL' }],
    relationships: ["m = y'(t)", "(uv)' = u'v + uv'", "(u/v)' = (u'v - uv') / v^2"], constraints: ['The gradient is positive and exact.', 'The curve is defined near the point.'],
    misconceptions: [{ id: 'multiplies-the-derivatives-of-the-factors', description: "Takes (uv)' to be u'v'.", producesError: "u'(t) v'(t)" }, { id: 'gives-the-y-coordinate', description: 'Gives y(t) instead of the gradient.', producesError: 'y(t)' }, { id: 'reverses-the-order-in-the-numerator', description: "Uses uv' - u'v in the quotient rule.", producesError: "(u v' - u' v) / v^2" }, { id: 'drops-the-chain-rule-factor', description: 'Differentiates ln(ax + b) or e^(ax + b) without the factor a.', producesError: 'missing factor a' }],
    levers: { FOUNDATIONAL: ['Product of two polynomials.'], STANDARD: ['Quotient of two linear functions; a fractional gradient.'], CHALLENGE: ['Linear factor times ln or e of a linear function (product and chain rules).'] },
    exclusions: ['Gradient at a point only (syllabus 2.4); stationary points and implicit differentiation are not asked by this construct.'], challenge: 'NON_OBVIOUS_STRATEGY',
    path: ['Identify u and v.', 'Apply the product or quotient rule (with the chain rule).', 'Substitute x = t.'], strategies: ['PRODUCT_RULE', 'QUOTIENT_RULE', 'CHAIN_RULE'], shortcut: ANSWER('multiplies the derivatives of the factors'),
  },
  {
    construct: c(CIE_NUMERICAL_ROOT), familyId: 'tf.cie.numerical-methods.root-location', adapterId: P2, commandTerm: 'determine',
    concept: { stableId: 'math.calc.numerical-methods', canonicalName: 'Numerical methods' }, skill: 'Algebraic reasoning', action: 'COMPUTE',
    object: 'An equation whose root is located by a change of sign, approached by a convergent fixed-point iteration, or found exactly once located.', observable: 'Locates the root by a sign change, or finds the limit of the iteration from its fixed-point equation, and gives the exact value asked.',
    structure: 'x^3 + bx - N is increasing with one non-integer root; x_(n+1) = p/(x_n + q) converges to the positive root of x^2 + qx - p = 0; (dx - u)(x^2 + v) = 0 has the one real root u/d.',
    variables: [{ symbol: 'b', meaning: 'Linear coefficient of the cubic', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'N', meaning: 'Constant of the cubic', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'p', meaning: 'Numerator of the iteration', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'q', meaning: 'Shift of the iteration', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'd', meaning: 'Leading coefficient of the factorisable cubic', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'u', meaning: 'Constant of the linear factor', role: 'PARAMETER', domain: 'INTEGER' }, { symbol: 'v', meaning: 'Constant of the quadratic factor', role: 'PARAMETER', domain: 'INTEGER' }, form('Sign change, iteration or located root'), { symbol: 'alpha', meaning: 'The value asked', role: 'UNKNOWN', domain: 'RATIONAL' }],
    relationships: ['f(n) < 0 < f(n + 1)', 'alpha = p / (alpha + q)', '(d x - u)(x^2 + v) = 0'], constraints: ['The iteration converges (|F\'(alpha)| < 1).', 'The value is positive and exact.'],
    misconceptions: [{ id: 'gives-the-upper-integer', description: 'Gives n + 1 instead of n.', producesError: 'n + 1' }, { id: 'ignores-the-linear-term', description: 'Takes the cube root of N.', producesError: 'floor(cbrt(N))' }, { id: 'gives-the-second-iterate', description: 'Stops after one iteration.', producesError: 'x2 = p / (1 + q)' }, { id: 'gives-the-midpoint-of-the-interval', description: 'Gives the midpoint of the located interval.', producesError: 'n + 1/2' }],
    levers: { FOUNDATIONAL: ['Locate the root of an increasing cubic between consecutive integers.'], STANDARD: ['Limit of a convergent fixed-point iteration.'], CHALLENGE: ['Exact root of a factorisable cubic located between two integers.'] },
    exclusions: ['Exact values only (syllabus 2.6); iterates to a stated number of decimal places are not asked by this construct.'], challenge: 'NON_OBVIOUS_STRATEGY',
    path: ['Evaluate the function at consecutive integers, or set alpha = F(alpha).', 'Solve the resulting equation exactly.', 'Check the value lies in the stated interval.'], strategies: ['SIGN_CHANGE', 'FIXED_POINT_EQUATION', 'FACTORISATION'], shortcut: ANSWER('gives the upper bound of the interval'),
  },
  // ------------------------------------------------------------------------------------------------ Paper 4
  {
    construct: c(CIE_CONSTANT_ACCELERATION), familyId: 'tf.cie.mechanics.constant-acceleration', adapterId: P4, commandTerm: 'calculate',
    concept: { stableId: 'math.mech.kinematics', canonicalName: 'Mechanics: kinematics' }, skill: 'Mathematical modelling', action: 'COMPUTE',
    object: 'A particle moving in a straight line with constant acceleration, horizontally or vertically under gravity (g = 10 m s^-2).', observable: 'Chooses the constant-acceleration equation that links the shown quantities and gives the speed or distance asked.',
    structure: 'v = u + at, s = ut + at^2/2, v^2 = u^2 + 2as; vertically upwards the acceleration is -10 m s^-2.',
    variables: [{ symbol: 'u', meaning: 'Initial speed (m/s)', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'a', meaning: 'Acceleration (m/s^2)', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 't', meaning: 'Time (s)', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'h', meaning: 'Height above the point of projection (m)', role: 'GIVEN', domain: 'INTEGER' }, form('Final speed, distance or vertical motion'), { symbol: 'Q', meaning: 'The speed or distance', role: 'UNKNOWN', domain: 'RATIONAL' }],
    relationships: ['v = u + a t', 's = u t + a t^2 / 2', 'v^2 = u^2 - 2 g h'], constraints: ['The acceleration is constant.', 'The value asked is positive.'],
    misconceptions: [{ id: 'omits-the-initial-speed', description: 'Uses v = at.', producesError: 'v = a t' }, { id: 'omits-the-half', description: 'Uses s = ut + at^2.', producesError: 'u t + a t^2' }, { id: 'forgets-the-square-root', description: 'Gives v^2 instead of v.', producesError: 'u^2 - 20 h' }, { id: 'adds-two-g-h', description: 'Uses v^2 = u^2 + 2gh going upwards.', producesError: 'sqrt(u^2 + 20 h)' }],
    levers: { FOUNDATIONAL: ['Final speed from v = u + at.'], STANDARD: ['Distance from s = ut + at^2/2.'], CHALLENGE: ['Vertical motion under gravity: speed at a height.'] },
    exclusions: ['Constant acceleration only (syllabus 4.2); variable acceleration and graphs are not asked by this construct.'], challenge: 'TRANSFER',
    path: ['List the known quantities.', 'Choose the equation linking them to the unknown.', 'Solve.'], strategies: ['SUVAT_EQUATIONS', 'ENERGY_CONSERVATION'], shortcut: ANSWER('omits the half'),
  },
  {
    construct: c(CIE_FORCES_ON_A_PLANE), familyId: 'tf.cie.mechanics.forces-on-a-plane', adapterId: P4, commandTerm: 'calculate',
    concept: { stableId: 'math.mech.forces-equilibrium', canonicalName: 'Mechanics: forces and equilibrium' }, skill: 'Mathematical modelling', action: 'COMPUTE',
    object: 'A particle on a rough horizontal surface or on a smooth or rough plane whose inclination has an exact sine (3-4-5, 5-12-13), with g = 10 m s^-2.', observable: 'Resolves the forces, uses F = mu R and Newton\'s second law (or equilibrium), and gives the acceleration or the force asked.',
    structure: 'Horizontal: P - mu m g = m a; smooth incline: P - m g sin(theta) = m a; rough incline at constant speed: P = m g (sin(theta) + mu cos(theta)).',
    variables: [{ symbol: 'm', meaning: 'Mass (kg)', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'P', meaning: 'Applied force (N)', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'k', meaning: 'Ten times the coefficient of friction', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 's', meaning: 'Opposite side of the slope triangle', role: 'PARAMETER', domain: 'INTEGER' }, { symbol: 'c', meaning: 'Adjacent side of the slope triangle', role: 'PARAMETER', domain: 'INTEGER' }, { symbol: 'h', meaning: 'Hypotenuse of the slope triangle', role: 'PARAMETER', domain: 'INTEGER' }, form('Rough horizontal, smooth incline or rough incline'), { symbol: 'Q', meaning: 'The acceleration or the force', role: 'UNKNOWN', domain: 'RATIONAL' }],
    relationships: ['R = m g cos(theta)', 'F = mu R', 'resultant force = m a'], constraints: ['sin(theta) and cos(theta) are exact fractions.', 'The value asked is positive.'],
    misconceptions: [{ id: 'ignores-the-friction', description: 'Leaves out the friction force.', producesError: 'P / m' }, { id: 'uses-cos-instead-of-sin', description: 'Uses m g cos(theta) along the slope.', producesError: 'P/m - g cos(theta)' }, { id: 'friction-in-the-wrong-direction', description: 'Takes friction up the slope while the particle moves up.', producesError: 'm g (sin - mu cos)' }, { id: 'omits-g-in-the-normal-reaction', description: 'Uses R = m instead of R = m g.', producesError: 'friction mu m' }],
    levers: { FOUNDATIONAL: ['Rough horizontal surface, horizontal force.'], STANDARD: ['Smooth inclined plane, force along the slope.'], CHALLENGE: ['Rough inclined plane, constant speed up the slope.'] },
    exclusions: ['Forces along or parallel to the surface only (syllabus 4.1, 4.3); connected particles are not asked by this construct.'], challenge: 'MULTI_STAGE_DEPENDENCY',
    path: ['Resolve perpendicular to the surface for R.', 'Use F = mu R.', 'Resolve along the surface and apply Newton\'s second law or equilibrium.'], strategies: ['RESOLVING_FORCES', 'NEWTONS_SECOND_LAW'], shortcut: ANSWER('ignores the friction'),
  },
  {
    construct: c(CIE_ENERGY_WORK_POWER), familyId: 'tf.cie.mechanics.energy-work-power', adapterId: P4, commandTerm: 'calculate',
    concept: { stableId: 'math.mech.energy-work-power', canonicalName: 'Mechanics: energy, work and power' }, skill: 'Mathematical modelling', action: 'COMPUTE',
    object: 'A car whose engine works at a constant power against a constant resistance, or a particle sliding down a rough slope (g = 10 m s^-2).', observable: 'Uses P = F v with Newton\'s second law, or the work-energy principle, and gives the speed, acceleration or work asked.',
    structure: 'Driving force D = P / v; at maximum speed D = resistance; D - F = m a; work against resistance = loss of potential energy - gain of kinetic energy.',
    variables: [{ symbol: 'w', meaning: 'Power of the engine (kW)', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'F', meaning: 'Resistance (N)', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'm', meaning: 'Mass (kg)', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'v', meaning: 'Speed (m/s)', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'h', meaning: 'Vertical height descended (m)', role: 'GIVEN', domain: 'INTEGER' }, form('Maximum speed, acceleration or work against resistance'), { symbol: 'Q', meaning: 'The speed, acceleration or work', role: 'UNKNOWN', domain: 'RATIONAL' }],
    relationships: ['P = D v', 'D - F = m a', 'W = m g h - m v^2 / 2'], constraints: ['The power is given in kilowatts.', 'The value asked is positive.'],
    misconceptions: [{ id: 'forgets-the-kilowatt-conversion', description: 'Uses the power in kW as if it were in W.', producesError: 'w / F' }, { id: 'ignores-the-resistance', description: 'Uses D = m a.', producesError: '1000 w / (v m)' }, { id: 'ignores-the-kinetic-energy', description: 'Gives the loss of potential energy as the work.', producesError: 'm g h' }, { id: 'omits-the-half-in-the-kinetic-energy', description: 'Uses kinetic energy m v^2.', producesError: 'm g h - m v^2' }],
    levers: { FOUNDATIONAL: ['Maximum speed at constant power.'], STANDARD: ['Acceleration at a given speed at constant power.'], CHALLENGE: ['Work done against resistance on a slope (energy).'] },
    exclusions: ['Constant power and constant resistance only (syllabus 4.5).'], challenge: 'TRANSFER',
    path: ['Convert the power to watts and find the driving force, or write the energy equation.', 'Apply equilibrium, Newton\'s second law or the work-energy principle.', 'Solve.'], strategies: ['POWER_EQUALS_FORCE_TIMES_SPEED', 'WORK_ENERGY_PRINCIPLE'], shortcut: ANSWER('forgets the kilowatt conversion'),
  },
  // ------------------------------------------------------------------------------------------------ Paper 5
  {
    construct: c(CIE_COUNTING_ARRANGEMENTS), familyId: 'tf.cie.probability.counting-arrangements', adapterId: P5, commandTerm: 'calculate',
    concept: { stableId: 'math.prob.permutations-combinations', canonicalName: 'Permutations and combinations' }, skill: 'Combinatorial reasoning', action: 'COMPUTE',
    object: 'Selections from different objects, committees from two groups, or arrangements of objects identical by colour with a restriction.', observable: 'Decides whether order matters, multiplies independent choices, treats a restricted block as one object, and gives the number of ways.',
    structure: 'C(n, r); C(a, i) C(b, j); with the reds as one block, (B + G + 1)! / (B! G!).',
    variables: [{ symbol: 'n', meaning: 'Number of different books', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'r', meaning: 'Number chosen', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'a', meaning: 'Number of men', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'i', meaning: 'Men chosen', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'b', meaning: 'Number of women', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'j', meaning: 'Women chosen', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'red', meaning: 'Red beads', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'blue', meaning: 'Blue beads', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'green', meaning: 'Green beads', role: 'GIVEN', domain: 'INTEGER' }, form('Selection, committee or restricted arrangement'), { symbol: 'W', meaning: 'The number of ways', role: 'UNKNOWN', domain: 'INTEGER' }],
    relationships: ['C(n, r) = n! / (r! (n - r)!)', 'ways = C(a, i) C(b, j)', 'ways = (B + G + 1)! / (B! G!)'], constraints: ['The number of ways is a positive integer.', 'Objects of one colour are identical.'],
    misconceptions: [{ id: 'uses-permutations-instead-of-combinations', description: 'Counts ordered selections.', producesError: 'P(n, r)' }, { id: 'adds-instead-of-multiplying', description: 'Adds the choices for the two groups.', producesError: 'C(a, i) + C(b, j)' }, { id: 'ignores-the-split-by-gender', description: 'Chooses from everyone together.', producesError: 'C(a + b, i + j)' }, { id: 'ignores-the-restriction', description: 'Counts every arrangement.', producesError: 'n! / (R! B! G!)' }, { id: 'treats-the-red-beads-as-distinct', description: 'Multiplies by R! for the block.', producesError: 'ways times R!' }],
    levers: { FOUNDATIONAL: ['A single selection.'], STANDARD: ['Selection from two groups.'], CHALLENGE: ['Arrangement with repeated objects and a restriction.'] },
    exclusions: ['Counting only (syllabus 5.2); probabilities from counting are not asked by this construct.'], challenge: 'NON_OBVIOUS_STRATEGY',
    path: ['Decide whether order matters.', 'Split into independent stages and multiply, or treat the block as one object.', 'Divide by the repeats.'], strategies: ['COMBINATIONS', 'MULTIPLICATION_PRINCIPLE', 'BLOCK_METHOD'], shortcut: ANSWER('uses permutations instead of combinations'),
  },
  {
    construct: c(CIE_PROBABILITY_EVENTS), familyId: 'tf.cie.probability.events', adapterId: P5, commandTerm: 'calculate',
    concept: { stableId: 'math.prob.probability-events', canonicalName: 'Probability and events' }, skill: 'Probabilistic reasoning', action: 'COMPUTE',
    object: 'Two independent events, a two-way classification of a group, or two draws without replacement from a bag.', observable: 'Uses the rules for independent and complementary events, conditional probability from counts, or a tree without replacement, and gives the exact probability.',
    structure: 'P(A or B) = 1 - (1 - P(A))(1 - P(B)) for independent events; P(A | B) = n(A and B) / n(B); P(same) = [r(r - 1) + b(b - 1)] / [n(n - 1)].',
    variables: [{ symbol: 'pa', meaning: 'Numerator of P(A)', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'qa', meaning: 'Denominator of P(A)', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'pb', meaning: 'Numerator of P(B)', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'qb', meaning: 'Denominator of P(B)', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'w', meaning: 'Count of A and B', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'x', meaning: 'Count of A only', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'y', meaning: 'Count of B only', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'z', meaning: 'Count of neither', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'red', meaning: 'Red balls', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'blue', meaning: 'Blue balls', role: 'GIVEN', domain: 'INTEGER' }, form('Independent events, conditional or without replacement'), { symbol: 'Pr', meaning: 'The probability', role: 'UNKNOWN', domain: 'RATIONAL' }],
    relationships: ['P(A or B) = P(A) + P(B) - P(A) P(B)', 'P(A | B) = P(A and B) / P(B)', 'P(R then R) = r/n (r - 1)/(n - 1)'], constraints: ['The probability is an exact fraction strictly between 0 and 1.'],
    misconceptions: [{ id: 'adds-the-probabilities', description: 'Adds P(A) and P(B) for independent events.', producesError: 'P(A) + P(B)' }, { id: 'gives-the-probability-of-both', description: 'Gives P(A and B).', producesError: 'P(A) P(B)' }, { id: 'conditions-on-the-wrong-event', description: 'Gives P(B | A) instead of P(A | B).', producesError: 'w / (w + x)' }, { id: 'replaces-the-first-ball', description: 'Treats the draws as with replacement.', producesError: '(r^2 + b^2) / n^2' }],
    levers: { FOUNDATIONAL: ['Union of two independent events.'], STANDARD: ['Conditional probability from a two-way classification.'], CHALLENGE: ['Two draws without replacement, two outcomes combined.'] },
    exclusions: ['Exact probabilities only (syllabus 5.3); Venn diagrams with unknown regions are not asked by this construct.'], challenge: 'MISCONCEPTION_RESISTANCE',
    path: ['Identify the events and whether they are independent.', 'Use the complement, the conditional formula or a tree.', 'Combine exactly.'], strategies: ['COMPLEMENT_RULE', 'CONDITIONAL_FROM_COUNTS', 'TREE_DIAGRAM'], shortcut: ANSWER('adds the probabilities'),
  },
  {
    construct: c(CIE_BINOMIAL_EXACT), familyId: 'tf.cie.probability.binomial-exact', adapterId: P5, commandTerm: 'calculate',
    concept: { stableId: 'math.prob.binomial-distribution', canonicalName: 'Binomial distribution' }, skill: 'Probabilistic reasoning', action: 'COMPUTE',
    object: 'A binomial random variable B(n, p) with a small number of trials and a simple rational p.', observable: 'Uses Var(X) = np(1 - p) or the binomial probability formula and gives the exact value.',
    structure: 'X ~ B(n, p): P(X = r) = C(n, r) p^r (1 - p)^(n - r); Var(X) = n p (1 - p).',
    variables: [{ symbol: 'n', meaning: 'Number of trials', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'r', meaning: 'Number of successes', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'pn', meaning: 'Numerator of p', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'pd', meaning: 'Denominator of p', role: 'GIVEN', domain: 'INTEGER' }, form('Variance, one probability or at most one'), { symbol: 'Q', meaning: 'The variance or probability', role: 'UNKNOWN', domain: 'RATIONAL' }],
    relationships: ['P(X = r) = C(n, r) p^r q^(n - r)', 'Var(X) = n p q', 'P(X <= 1) = q^n + n p q^(n - 1)'], constraints: ['q = 1 - p.', 'The value is an exact fraction.'],
    misconceptions: [{ id: 'gives-the-mean', description: 'Gives E(X) instead of Var(X).', producesError: 'E(X) = n p' }, { id: 'omits-the-binomial-coefficient', description: 'Leaves out C(n, r).', producesError: 'p^r q^(n - r)' }, { id: 'swaps-p-and-q', description: 'Exchanges success and failure.', producesError: 'C(n, r) q^r p^(n - r)' }, { id: 'gives-only-p-of-one', description: 'Gives P(X = 1) for P(X <= 1).', producesError: 'n p q^(n - 1)' }],
    levers: { FOUNDATIONAL: ['Variance of a binomial variable.'], STANDARD: ['One binomial probability.'], CHALLENGE: ['A cumulative probability P(X <= 1).'] },
    exclusions: ['Exact values only (syllabus 5.4); the normal approximation is not asked by this construct.'], challenge: 'MULTI_STAGE_DEPENDENCY',
    path: ['Identify n and p.', 'Apply the variance formula or the probability formula.', 'Add the cases when more than one value is included.'], strategies: ['BINOMIAL_FORMULA', 'VARIANCE_FORMULA'], shortcut: ANSWER('omits the binomial coefficient'),
  },
  {
    construct: c(CIE_NORMAL_EXACT), familyId: 'tf.cie.probability.normal-exact', adapterId: P5, commandTerm: 'determine',
    concept: { stableId: 'math.prob.normal-distribution', canonicalName: 'Normal distribution' }, skill: 'Probabilistic reasoning', action: 'COMPUTE',
    object: 'A normal random variable with its mean and variance, or with probability statements whose z-values are stated exactly.', observable: 'Standardises, uses the symmetry of the normal curve, or solves two standardised equations, and gives the exact value without tables.',
    structure: 'z = (x - mu)/sigma; P(X < a) = P(X > 2 mu - a); x1 = mu + z1 sigma and x2 = mu + z2 sigma determine mu and sigma.',
    variables: [{ symbol: 'mu', meaning: 'Mean', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'sigma', meaning: 'Standard deviation', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'x', meaning: 'Value of X (the first value)', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'z1h', meaning: 'Twice the first z-value', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'z2h', meaning: 'Twice the second z-value', role: 'GIVEN', domain: 'INTEGER' }, { symbol: 'x2', meaning: 'The second value of X', role: 'GIVEN', domain: 'INTEGER' }, form('Standardise, symmetry or two statements'), { symbol: 'Q', meaning: 'The z-value, the value or the mean', role: 'UNKNOWN', domain: 'RATIONAL' }],
    relationships: ['z = (x - mu) / sigma', 'b = 2 mu - a', 'mu = (z2 x1 - z1 x2) / (z2 - z1)'], constraints: ['Every z-value is exact, so no table is needed.', 'The value asked is positive.'],
    misconceptions: [{ id: 'divides-by-the-variance', description: 'Divides by sigma^2 instead of sigma.', producesError: '(x - mu) / sigma^2' }, { id: 'gives-the-distance-from-the-mean', description: 'Gives mu - a for the symmetric value.', producesError: 'mu - a' }, { id: 'averages-the-two-values', description: 'Takes the mean as the midpoint of the two values.', producesError: '(x1 + x2) / 2' }, { id: 'gives-the-standard-deviation', description: 'Gives sigma instead of mu.', producesError: 'sigma' }],
    levers: { FOUNDATIONAL: ['Standardise one value.'], STANDARD: ['Symmetry of the normal curve about the mean.'], CHALLENGE: ['Mean from two probability statements with exact z-values.'] },
    exclusions: ['Exact values only (syllabus 5.5); probabilities read from tables are not asked by this construct.'], challenge: 'MULTI_STAGE_DEPENDENCY',
    path: ['Write each statement in standardised form.', 'Use symmetry or solve the simultaneous equations.', 'Give the value asked.'], strategies: ['STANDARDISATION', 'SYMMETRY', 'SIMULTANEOUS_EQUATIONS'], shortcut: ANSWER('averages the two values'),
  },
];

export const CIE_9709_P2P4P5_ENTRIES: readonly LibraryEntry[] = CIE_9709_P2P4P5_ADOPTION_SPECS.map((s) => adoptParametricConstruct(s, OPTIONS));

/**
 * AICE-9709-IDENTITY-COLLISION-2026-10-16: the two P5 constructs on the EXISTING canonical identities (PAA-certified,
 * Spanish display labels) instead of the superseded duplicates. Families and construct / renderer identities of their
 * own (an envelope already stored is never replaced); same construct functions, key, errors and certification route.
 */
const CANONICAL: Readonly<Record<string, { stableId: string; canonicalName: string }>> = {
  'math.prob.permutations-combinations': { stableId: 'math.prob.counting', canonicalName: 'Técnicas de conteo' },
  'math.prob.probability-events': { stableId: 'math.prob.probability', canonicalName: 'Probabilidad' },
};
export const CIE_9709_P5_CANONICAL_ENTRIES: readonly LibraryEntry[] = CIE_9709_P2P4P5_ADOPTION_SPECS.filter((s) => CANONICAL[s.concept.stableId]).map((s) => {
  const x = s.construct as unknown as ParametricConstruct;
  return adoptParametricConstruct({
    ...s, familyId: `${s.familyId}-canonical`, concept: { ...CANONICAL[s.concept.stableId], canonicalSubject: 'Matemáticas' },
    construct: c({ ...x, construct: `${x.construct}_CANONICAL`, rendererVersion: x.rendererVersion.replace(/@/, '-canonical@') }),
  }, OPTIONS);
});
