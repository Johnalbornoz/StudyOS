/**
 * Cambridge International AS & A Level Mathematics 9709 (syllabus 2026-2027,
 * Version 4) -- the AICE reference vertical. Components, minutes, marks,
 * weightings, calculator rule (scientific only), MF19 and the exact component
 * combinations come from the sourced syllabus (builder.ts). Topics follow the
 * syllabus content headings. Items are ORIGINAL StudyUS practice, graded by
 * the math engine (equivalence, fractions / radicals, s.f., d.p., method marks).
 */
import { mc, mathItem, mathPart, choicePart, multiPart } from '../builders';
import { aiceConfig, type AiceItem, type AiceObjective } from './builder';

const en = 'en';
const T = (topic: string, ao: 'AO1' | 'AO2' = 'AO1') => ({ contentCategory: topic, cognitiveDemand: ao === 'AO1' ? ('COMPREHENSION' as const) : ('APPLICATION' as const), assessmentObjective: ao });

const OBJECTIVES: Record<string, AiceObjective[]> = {
  p1: [
    { code: 'aice.9709.p1.quadratics', description: 'Pure 1 · Quadratics (completing the square, discriminant).', count: 1 },
    { code: 'aice.9709.p1.series', description: 'Pure 1 · Series (binomial expansion, arithmetic and geometric progressions).', count: 1 },
    { code: 'aice.9709.p1.differentiation', description: 'Pure 1 · Differentiation (stationary points and their nature).', count: 1 },
    { code: 'aice.9709.p1.integration', description: 'Pure 1 · Integration (definite integrals, areas).', count: 1 },
  ],
  p2: [
    { code: 'aice.9709.p2.logarithms', description: 'Pure 2 · Logarithmic and exponential functions.', count: 1 },
    { code: 'aice.9709.p2.differentiation', description: 'Pure 2 · Differentiation (product rule, exponentials).', count: 1 },
    { code: 'aice.9709.p2.numerical', description: 'Pure 2 · Numerical solution of equations (iteration).', count: 1 },
  ],
  p3: [
    { code: 'aice.9709.p3.vectors', description: 'Pure 3 · Vectors (scalar product, angles).', count: 1 },
    { code: 'aice.9709.p3.complex', description: 'Pure 3 · Complex numbers.', count: 1 },
    { code: 'aice.9709.p3.differential-equations', description: 'Pure 3 · Differential equations (separable).', count: 1 },
  ],
  p4: [
    { code: 'aice.9709.p4.kinematics', description: 'Mechanics · Kinematics of motion in a straight line.', count: 1 },
    { code: 'aice.9709.p4.forces', description: 'Mechanics · Forces, equilibrium and friction.', count: 1 },
    { code: 'aice.9709.p4.energy', description: 'Mechanics · Energy, work and power.', count: 1 },
  ],
  p5: [
    { code: 'aice.9709.p5.permutations', description: 'Probability & Statistics 1 · Permutations and combinations.', count: 1 },
    { code: 'aice.9709.p5.probability', description: 'Probability & Statistics 1 · Probability.', count: 1 },
    { code: 'aice.9709.p5.distributions', description: 'Probability & Statistics 1 · Discrete random variables and the binomial distribution.', count: 1 },
    { code: 'aice.9709.p5.normal', description: 'Probability & Statistics 1 · The normal distribution.', count: 1 },
  ],
  p6: [
    { code: 'aice.9709.p6.poisson', description: 'Probability & Statistics 2 · The Poisson distribution.', count: 1 },
    { code: 'aice.9709.p6.linear-combinations', description: 'Probability & Statistics 2 · Linear combinations of random variables.', count: 1 },
    { code: 'aice.9709.p6.hypothesis', description: 'Probability & Statistics 2 · Sampling, estimation and hypothesis tests.', count: 1 },
  ],
};

const ITEMS: AiceItem[] = [
  // ---- Paper 1 ----
  { objectiveCode: 'aice.9709.p1.quadratics', content: multiPart({ key: 'p1.square', language: en, difficultyIndex: 0.95, tags: T('Quadratics'), commandTerm: 'express', calculator: 'ALLOWED', question: 'The expression 2x² − 12x + 7 can be written as 2(x − b)² + c.', explanation: '2x² − 12x + 7 = 2(x² − 6x) + 7 = 2(x − 3)² − 18 + 7 = 2(x − 3)² − 11. The minimum value is −11 at x = 3.', parts: [
    mathPart('a', 'State the value of b.', { kind: 'NUMBER', answers: ['3'] }, 1, 'AO1'),
    mathPart('b', 'State the value of c.', { kind: 'NUMBER', answers: ['-11'] }, 2, 'AO1', { marks: 1, criterion: 'M', intermediates: ['7-18', '2*9'] }),
    choicePart('c', 'What is the minimum value of 2x² − 12x + 7?', ['−11', '3', '7', '−18'], 0, 1, 'AO2'),
  ] }) },
  { objectiveCode: 'aice.9709.p1.series', content: mathItem({ key: 'p1.binomial', language: en, difficultyIndex: 0.95, tags: T('Series'), commandTerm: 'find', calculator: 'ALLOWED', question: 'Find the coefficient of x² in the expansion of (2 + x)⁵.', explanation: 'The term in x² is ⁵C₂ · 2³ · x² = 10 · 8 · x² = 80x².', math: { kind: 'NUMBER', answers: ['80'] }, marks: 2, method: { marks: 1, criterion: 'M', intermediates: ['10*8', '10*2^3'] } }) },
  { objectiveCode: 'aice.9709.p1.differentiation', content: multiPart({ key: 'p1.stationary', language: en, difficultyIndex: 1.0, tags: T('Differentiation', 'AO2'), commandTerm: 'find', calculator: 'ALLOWED', question: 'A curve has equation y = 2x³ − 9x² + 12x − 4.', explanation: 'dy/dx = 6x² − 18x + 12 = 6(x − 1)(x − 2) = 0 gives x = 1 and x = 2. d²y/dx² = 12x − 18 is −6 at x = 1, so that point is a maximum.', parts: [
    mathPart('a', 'Find the smaller x-coordinate of the stationary points.', { kind: 'NUMBER', answers: ['1'] }, 2, 'AO1', { marks: 1, criterion: 'M', intermediates: ['6x^2-18x+12', 'x^2-3x+2'] }),
    mathPart('b', 'Find the larger x-coordinate of the stationary points.', { kind: 'NUMBER', answers: ['2'] }, 1, 'AO1'),
    choicePart('c', 'Determine the nature of the stationary point with the smaller x-coordinate.', ['Maximum', 'Minimum', 'Point of inflexion', 'It cannot be determined'], 0, 2, 'AO2'),
  ] }) },
  { objectiveCode: 'aice.9709.p1.integration', content: mathItem({ key: 'p1.definite', language: en, difficultyIndex: 0.9, tags: T('Integration'), commandTerm: 'find', calculator: 'ALLOWED', question: 'Find the exact value of ∫₁³ (3x² − 4x) dx.', explanation: '[x³ − 2x²] from 1 to 3 = (27 − 18) − (1 − 2) = 9 + 1 = 10.', math: { kind: 'NUMBER', answers: ['10'] }, marks: 3, method: { marks: 1, criterion: 'M', intermediates: ['x^3-2x^2', '9-(-1)'] } }) },
  // ---- Paper 2 ----
  { objectiveCode: 'aice.9709.p2.logarithms', content: mathItem({ key: 'p2.exponential', language: en, difficultyIndex: 0.95, tags: T('Logarithmic and exponential functions'), commandTerm: 'solve', calculator: 'ALLOWED', question: 'Solve the equation 3^(2x) = 20, giving x correct to 3 significant figures.', explanation: '2x ln 3 = ln 20, so x = ln 20 / (2 ln 3) = 1.36 (3 s.f.).', math: { kind: 'NUMBER', answers: ['1.363480'], significantFigures: 3 }, marks: 3, method: { marks: 1, criterion: 'M', intermediates: ['2.9957/2.1972', '2.9957/(2*1.0986)'] } }) },
  { objectiveCode: 'aice.9709.p2.differentiation', content: mathItem({ key: 'p2.product', language: en, difficultyIndex: 1.0, tags: T('Differentiation'), commandTerm: 'find', calculator: 'ALLOWED', question: 'Given y = x² e^(3x), find the exact value of dy/dx when x = 1.', explanation: 'dy/dx = 2x e^(3x) + 3x² e^(3x); at x = 1 this is 2e³ + 3e³ = 5e³.', math: { kind: 'EXPRESSION', answers: ['5*e^3'] }, marks: 3, method: { marks: 1, criterion: 'M', intermediates: ['2*x*e^(3*x)+3*x^2*e^(3*x)'] } }) },
  { objectiveCode: 'aice.9709.p2.numerical', content: mathItem({ key: 'p2.iteration', language: en, difficultyIndex: 1.05, tags: T('Numerical solution of equations', 'AO2'), commandTerm: 'use', calculator: 'ALLOWED', question: 'The equation x³ − 2x − 5 = 0 has one real root. Use the iterative formula x(n+1) = (2x(n) + 5)^(1/3) with x(1) = 2 to find the root correct to 2 decimal places.', explanation: 'x(2) = 2.0801, x(3) = 2.0924, x(4) = 2.0942, x(5) = 2.0945 … the root is 2.09 (2 d.p.).', math: { kind: 'NUMBER', answers: ['2.094551'], decimalPlaces: 2 }, marks: 3 }) },
  // ---- Paper 3 ----
  { objectiveCode: 'aice.9709.p3.vectors', content: mathItem({ key: 'p3.angle', language: en, difficultyIndex: 1.0, tags: T('Vectors'), commandTerm: 'find', calculator: 'ALLOWED', question: 'Find the angle between the vectors 2i − j + 2k and i + 2j + 2k, in degrees correct to 1 decimal place.', explanation: 'a·b = 2 − 2 + 4 = 4; |a| = |b| = 3; cos θ = 4/9, θ = 63.6°.', math: { kind: 'NUMBER', answers: ['63.61220'], decimalPlaces: 1 }, marks: 3, method: { marks: 1, criterion: 'M', intermediates: ['4/9', '4/(3*3)'] } }) },
  { objectiveCode: 'aice.9709.p3.complex', content: multiPart({ key: 'p3.product', language: en, difficultyIndex: 0.95, tags: T('Complex numbers'), commandTerm: 'find', calculator: 'ALLOWED', question: 'The complex numbers z and w are z = 1 + 2i and w = 3 − i. Find zw in the form a + bi.', explanation: '(1 + 2i)(3 − i) = 3 − i + 6i − 2i² = 5 + 5i.', parts: [
    mathPart('a', 'State a (the real part of zw).', { kind: 'NUMBER', answers: ['5'] }, 1, 'AO1'),
    mathPart('b', 'State b (the imaginary part of zw).', { kind: 'NUMBER', answers: ['5'] }, 1, 'AO1'),
  ] }) },
  { objectiveCode: 'aice.9709.p3.differential-equations', content: mathItem({ key: 'p3.separable', language: en, difficultyIndex: 1.05, tags: T('Differential equations', 'AO2'), commandTerm: 'solve', calculator: 'ALLOWED', question: 'The variables x and y satisfy dy/dx = 2xy, and y = 3 when x = 0. Find y when x = 1, correct to 3 significant figures.', explanation: '∫ dy/y = ∫ 2x dx gives ln y = x² + c, so y = 3e^(x²). When x = 1, y = 3e = 8.15 (3 s.f.).', math: { kind: 'NUMBER', answers: ['8.154845'], significantFigures: 3 }, marks: 4, method: { marks: 1, criterion: 'M', intermediates: ['3*2.71828', '3*e'] } }) },
  // ---- Paper 4 ----
  { objectiveCode: 'aice.9709.p4.kinematics', content: multiPart({ key: 'p4.uniform', language: en, difficultyIndex: 0.9, tags: T('Kinematics'), commandTerm: 'find', calculator: 'ALLOWED', question: 'A car accelerates uniformly from 4 m s⁻¹ to 20 m s⁻¹ in 8 s.', explanation: 'a = (20 − 4)/8 = 2 m s⁻²; s = ½(4 + 20) × 8 = 96 m.', parts: [
    mathPart('a', 'Find the acceleration, in m s⁻².', { kind: 'NUMBER', answers: ['2'] }, 1, 'AO1'),
    mathPart('b', 'Find the distance travelled, in m.', { kind: 'NUMBER', answers: ['96'] }, 2, 'AO1', { marks: 1, criterion: 'M', intermediates: ['(4+20)/2*8'] }),
  ] }) },
  { objectiveCode: 'aice.9709.p4.forces', content: mathItem({ key: 'p4.friction', language: en, difficultyIndex: 0.95, tags: T('Forces and equilibrium', 'AO2'), commandTerm: 'find', calculator: 'ALLOWED', question: 'A box of mass 5 kg rests on rough horizontal ground. The coefficient of friction is 0.4. Find the least horizontal force, in N, needed to make the box move. Take g = 10 m s⁻².', explanation: 'R = 5g = 50 N; limiting friction F = μR = 0.4 × 50 = 20 N.', math: { kind: 'NUMBER', answers: ['20'] }, marks: 2 }) },
  { objectiveCode: 'aice.9709.p4.energy', content: mathItem({ key: 'p4.fall', language: en, difficultyIndex: 0.9, tags: T('Energy, work and power'), commandTerm: 'find', calculator: 'ALLOWED', question: 'A particle of mass 2 kg is released from rest and falls 5 m. Ignoring air resistance and taking g = 10 m s⁻², find its speed, in m s⁻¹, using an energy method.', explanation: 'mgh = ½mv²: 2 × 10 × 5 = ½ × 2 × v², v² = 100, v = 10 m s⁻¹.', math: { kind: 'NUMBER', answers: ['10'] }, marks: 2, method: { marks: 1, criterion: 'M', intermediates: ['2*10*5', 'sqrt(100)'] } }) },
  // ---- Paper 5 ----
  { objectiveCode: 'aice.9709.p5.permutations', content: mathItem({ key: 'p5.level', language: en, difficultyIndex: 0.9, tags: T('Permutations and combinations'), commandTerm: 'find', calculator: 'ALLOWED', question: 'Find the number of different arrangements of the letters of the word LEVEL.', explanation: '5! / (2! × 2!) = 120 / 4 = 30.', math: { kind: 'NUMBER', answers: ['30'] }, marks: 2 }) },
  { objectiveCode: 'aice.9709.p5.probability', content: mathItem({ key: 'p5.union', language: en, difficultyIndex: 0.9, tags: T('Probability'), commandTerm: 'find', calculator: 'ALLOWED', question: 'Events A and B are independent with P(A) = 0.4 and P(B) = 0.5. Find P(A ∪ B).', explanation: 'P(A ∪ B) = 0.4 + 0.5 − 0.4 × 0.5 = 0.7.', math: { kind: 'NUMBER', answers: ['0.7'] }, marks: 2 }) },
  { objectiveCode: 'aice.9709.p5.distributions', content: mathItem({ key: 'p5.binomial', language: en, difficultyIndex: 1.0, tags: T('Discrete random variables'), commandTerm: 'find', calculator: 'ALLOWED', question: 'The random variable X has the distribution B(10, 0.3). Find P(X = 2), correct to 3 significant figures.', explanation: '¹⁰C₂ × 0.3² × 0.7⁸ = 45 × 0.09 × 0.05764801 = 0.233 (3 s.f.).', math: { kind: 'NUMBER', answers: ['0.2334744'], significantFigures: 3 }, marks: 2, method: { marks: 1, criterion: 'M', intermediates: ['45*0.3^2*0.7^8'] } }) },
  { objectiveCode: 'aice.9709.p5.normal', content: mathItem({ key: 'p5.normal', language: en, difficultyIndex: 1.0, tags: T('The normal distribution'), commandTerm: 'find', calculator: 'ALLOWED', question: 'The random variable X has the distribution N(50, 4²). Find P(X < 56), correct to 3 significant figures.', explanation: 'z = (56 − 50)/4 = 1.5; Φ(1.5) = 0.933 (3 s.f.).', math: { kind: 'NUMBER', answers: ['0.9331928'], significantFigures: 3 }, marks: 3, method: { marks: 1, criterion: 'M', intermediates: ['(56-50)/4'] } }) },
  // ---- Paper 6 ----
  { objectiveCode: 'aice.9709.p6.poisson', content: mathItem({ key: 'p6.poisson', language: en, difficultyIndex: 1.0, tags: T('The Poisson distribution'), commandTerm: 'find', calculator: 'ALLOWED', question: 'The random variable X has the distribution Po(3). Find P(X = 2), correct to 3 significant figures.', explanation: 'e⁻³ × 3² / 2! = 4.5e⁻³ = 0.224 (3 s.f.).', math: { kind: 'NUMBER', answers: ['0.2240418'], significantFigures: 3 }, marks: 2 }) },
  { objectiveCode: 'aice.9709.p6.linear-combinations', content: mathItem({ key: 'p6.variance', language: en, difficultyIndex: 1.0, tags: T('Linear combinations of random variables'), commandTerm: 'find', calculator: 'ALLOWED', question: 'The independent random variables X and Y have Var(X) = 4 and Var(Y) = 9. Find Var(2X − Y).', explanation: 'Var(2X − Y) = 4 Var(X) + Var(Y) = 16 + 9 = 25.', math: { kind: 'NUMBER', answers: ['25'] }, marks: 2 }) },
  { objectiveCode: 'aice.9709.p6.hypothesis', content: mc({ key: 'p6.type1', language: en, difficultyIndex: 0.95, tags: T('Hypothesis tests', 'AO2'), commandTerm: 'state', calculator: 'ALLOWED', question: 'In a hypothesis test, what is a Type I error?', options: ['Rejecting the null hypothesis when it is true', 'Accepting the null hypothesis when it is false', 'Rejecting the alternative hypothesis when it is true', 'Using the wrong significance level'], correct: 0, explanation: 'A Type I error is rejecting H₀ when H₀ is true; its probability is the significance level.' }) },
];

const FORMATS = { p1: ['MATH_EXPRESSION', 'NUMERIC_ENTRY', 'EXTENDED_RESPONSE'], p2: ['MATH_EXPRESSION', 'NUMERIC_ENTRY', 'EXTENDED_RESPONSE'], p3: ['MATH_EXPRESSION', 'NUMERIC_ENTRY', 'EXTENDED_RESPONSE'], p4: ['NUMERIC_ENTRY', 'EXTENDED_RESPONSE'], p5: ['NUMERIC_ENTRY', 'EXTENDED_RESPONSE'], p6: ['NUMERIC_ENTRY', 'EXTENDED_RESPONSE', 'SELECTED_RESPONSE'] } as const;
const TERMS = ['express', 'find', 'solve', 'use', 'state'].map((term) => ({ term }));

export const AICE_9709_AS = aiceConfig({ code: '9709', level: 'AS', objectives: OBJECTIVES, items: ITEMS, responseFormats: FORMATS as never, commandTerms: TERMS });
export const AICE_9709_A = aiceConfig({ code: '9709', level: 'A', objectives: OBJECTIVES, items: ITEMS, responseFormats: FORMATS as never, commandTerms: TERMS });
