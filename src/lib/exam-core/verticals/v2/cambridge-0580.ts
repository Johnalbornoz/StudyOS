/**
 * Exam V2 reference vertical -- Cambridge IGCSE Mathematics 0580, Extended tier.
 *
 * STRUCTURE (source: cie-0580-syllabus-2025-2027, Version 3, exams 2025-2027):
 *   Paper 2 (Extended)  non-calculator      2 h  100 marks  50%
 *   Paper 4 (Extended)  scientific calculator 2 h 100 marks 50%
 *   AO1 Knowledge and understanding of mathematical techniques  40-50% (Extended)
 *   AO2 Analyse, interpret and communicate mathematically       50-60% (Extended)
 *   Non-exact answers to 3 significant figures, angles to 1 decimal place.
 * Core (Papers 1 and 3) is listed in the catalogue but not configured.
 *
 * Original StudyUS practice items (FIXTURE). Reduced forms; time proportional
 * to the official pace (1.2 min per mark).
 */
import type { ExamVerticalConfigInput } from '../../vertical-config';
import { FIXTURE_PROVENANCE } from '../fixture-builders';
import { mathItem, mathPart, multiPart, mc } from './builders';

const en = 'en';
const SOURCES = ['cie-0580-syllabus-2025-2027'];
const TERMS = [
  { term: 'work out', expectedReasoningType: 'PROCEDURAL', description: 'Calculate from given facts, figures or information with or without the use of a calculator.' },
  { term: 'calculate', expectedReasoningType: 'PROCEDURAL', description: 'Work out from given facts, figures or information.' },
  { term: 'show that', expectedReasoningType: 'CONCEPTUAL', description: 'Provide structured evidence that leads to a given result.' },
  { term: 'write down', expectedReasoningType: 'FACTUAL', description: 'Give an answer without significant working.' },
];
const AOS = [
  { code: 'AO1', label: 'Knowledge and understanding of mathematical techniques', weightPercent: '40-50' },
  { code: 'AO2', label: 'Analyse, interpret and communicate mathematically', weightPercent: '50-60' },
];

export const CAMBRIDGE_0580_EXTENDED_V2: ExamVerticalConfigInput = {
  key: 'v2.cambridge.0580-extended',
  family: 'CAMBRIDGE',
  contentStatus: 'DEV_CERT_FIXTURE',
  organization: { name: 'Cambridge International Education' },
  programme: { name: 'Cambridge IGCSE', type: 'CURRICULUM' },
  qualification: { name: 'Cambridge IGCSE' },
  subject: { name: 'Mathematics (0580)', level: 'Extended' },
  definition: {
    name: 'Cambridge IGCSE Mathematics 0580 — Extended',
    purpose: 'Practice in the official 0580 Extended paper structure (Papers 2 and 4). Original StudyUS items; not Cambridge questions or mark schemes.',
    domains: ['Number', 'Algebra and graphs', 'Coordinate geometry', 'Geometry', 'Mensuration', 'Trigonometry', 'Transformations and vectors', 'Probability', 'Statistics'],
  },
  version: {
    label: 'V2 0580 2025-2027',
    examYear: 2026,
    examSession: 'June / November',
    supportedModalities: ['PAPER'],
    delivery: { navigation: 'FREE_ORDER_WITHIN_SECTION', breaks: [{ afterSectionKey: 'p2', minutes: 10 }], itemFeedback: 'AUTO', resultReview: 'FULL', permittedResources: ['Scientific calculator (Paper 4 only)'] },
  },
  framework: { frameworkKey: 'cie-igcse-0580', curriculumVersion: '0580 syllabus 2025-2027 (Version 3)', firstAssessment: 2025, lastAssessment: 2027, syllabusCode: '0580', frameworkVersion: 'v3', sourceKeys: SOURCES },
  scoring: { name: 'Cambridge 0580 Extended practice -- marks', scoringType: 'MARK_SCHEME', policy: { engine: 'exam-scoring-v1', strategy: 'RAW', transform: { type: 'NONE' }, unit: '%', provenance: FIXTURE_PROVENANCE } },
  structureLabel: 'V2 0580 2025-2027',
  commandTerms: TERMS,
  sections: [
    {
      key: 'p2', name: 'Paper 2 (Extended, non-calculator)', componentType: 'PAPER', subject: { name: 'Mathematics (0580)', level: 'Extended' },
      durationMinutes: 24, toolRules: { calculator: false }, targetDifficultyIndex: 1.0,
      definition: {
        officialName: 'Paper 2 Non-calculator (Extended)', kind: 'WRITTEN_PAPER', assessment: 'EXTERNAL', officialDurationMinutes: 120, maxMarks: 100, weightingPercent: 50, calculatorPolicy: 'NONE',
        responseFormats: ['MATH_EXPRESSION', 'SHORT_RESPONSE', 'EXTENDED_RESPONSE'], assessmentObjectives: AOS, commandTerms: TERMS.map((x) => x.term),
        limitations: ['StudyUS delivers a reduced form (original items); time is proportional (1.2 min per mark).'], sourceKeys: SOURCES,
      },
      objectives: [
        { code: 'cie.p2.number', description: 'Number: fractions, indices, standard form, bounds.', targets: [{ commandTerm: 'work out', count: 1 }] },
        { code: 'cie.p2.algebra', description: 'Algebra: manipulation, equations, sequences.', targets: [{ commandTerm: 'work out', count: 1 }] },
        { code: 'cie.p2.geometry', description: 'Geometry and coordinate geometry.', targets: [{ commandTerm: 'calculate', count: 1 }] },
        { code: 'cie.p2.structured', description: 'Structured multi-step question.', targets: [{ commandTerm: 'show that', count: 1 }] },
      ],
    },
    {
      key: 'p4', name: 'Paper 4 (Extended, calculator)', componentType: 'PAPER', subject: { name: 'Mathematics (0580)', level: 'Extended' },
      durationMinutes: 24, toolRules: { calculator: 'scientific' }, targetDifficultyIndex: 1.0,
      definition: {
        officialName: 'Paper 4 Calculator (Extended)', kind: 'WRITTEN_PAPER', assessment: 'EXTERNAL', officialDurationMinutes: 120, maxMarks: 100, weightingPercent: 50, calculatorPolicy: 'SCIENTIFIC_REQUIRED',
        responseFormats: ['MATH_EXPRESSION', 'SHORT_RESPONSE', 'EXTENDED_RESPONSE'], assessmentObjectives: AOS, commandTerms: TERMS.map((x) => x.term),
        limitations: ['Non-exact answers to 3 significant figures; angles to 1 decimal place.', 'StudyUS delivers a reduced form (original items).'], sourceKeys: SOURCES,
      },
      objectives: [
        { code: 'cie.p4.statistics', description: 'Statistics and probability.', targets: [{ commandTerm: 'calculate', count: 1 }] },
        { code: 'cie.p4.mensuration', description: 'Mensuration and trigonometry.', targets: [{ commandTerm: 'calculate', count: 1 }] },
        { code: 'cie.p4.functions', description: 'Functions and graphs.', targets: [{ commandTerm: 'work out', count: 1 }] },
        { code: 'cie.p4.structured', description: 'Structured multi-step question in context.', targets: [{ commandTerm: 'calculate', count: 1 }] },
      ],
    },
  ],
  items: [
    // ---- Paper 2 ----
    { objectiveCode: 'cie.p2.number', content: mathItem({ key: 'cie.p2.num.fraction', language: en, commandTerm: 'work out', calculator: 'NONE', difficulty: 2, difficultyIndex: 0.95, tags: { assessmentObjective: 'AO1', contentCategory: 'Number' },
      question: 'Work out 2 3/5 ÷ 1 1/4. Give your answer as a mixed number in its simplest form.', math: { kind: 'NUMBER', answers: ['2 2/25'], requiredForm: 'EXACT' }, marks: 2, method: { marks: 1, criterion: 'M', intermediates: ['13/5*4/5'] },
      explanation: '13/5 × 4/5 = 52/25 = 2 2/25.' }) },
    { objectiveCode: 'cie.p2.number', content: mathItem({ key: 'cie.p2.num.standard', language: en, commandTerm: 'work out', calculator: 'NONE', difficulty: 3, difficultyIndex: 1.0, tags: { assessmentObjective: 'AO1', contentCategory: 'Number' },
      question: 'Work out (6 × 10⁵) × (4 × 10⁻²). Give your answer in standard form.', math: { kind: 'NUMBER', answers: ['2.4*10^4'], requiredForm: 'SCIENTIFIC' }, marks: 2,
      explanation: '24 × 10³ = 2.4 × 10⁴.' }) },
    { objectiveCode: 'cie.p2.algebra', content: mathItem({ key: 'cie.p2.alg.simultaneous', language: en, commandTerm: 'work out', calculator: 'NONE', difficulty: 3, difficultyIndex: 1.0, tags: { assessmentObjective: 'AO1', contentCategory: 'Algebra and graphs' },
      question: 'Solve the simultaneous equations 3x + 2y = 16 and x − y = 2. Enter the value of x.', math: { kind: 'NUMBER', answers: ['4'] }, marks: 2, method: { marks: 1, criterion: 'M', intermediates: ['5x=20', '3x+2(x-2)=16', '5y=10'] },
      explanation: 'x = y + 2 ⇒ 3(y + 2) + 2y = 16 ⇒ y = 2, x = 4.' }) },
    { objectiveCode: 'cie.p2.algebra', content: mathItem({ key: 'cie.p2.alg.nth', language: en, commandTerm: 'write down', calculator: 'NONE', difficulty: 2, difficultyIndex: 0.95, tags: { assessmentObjective: 'AO2', contentCategory: 'Algebra and graphs' },
      question: 'Find an expression for the nth term of the sequence 5, 8, 11, 14, …', math: { kind: 'EXPRESSION', answers: ['3n+2'] }, marks: 2,
      explanation: 'Common difference 3, so 3n + 2.' }) },
    { objectiveCode: 'cie.p2.geometry', content: mathItem({ key: 'cie.p2.geo.gradient', language: en, commandTerm: 'calculate', calculator: 'NONE', difficulty: 3, difficultyIndex: 1.0, tags: { assessmentObjective: 'AO1', contentCategory: 'Coordinate geometry' },
      question: 'A line passes through (−1, 4) and (3, −4). Find the equation of the line in the form y = mx + c.', math: { kind: 'EQUATION', answers: ['y=-2x+2'] }, marks: 3,
      explanation: 'm = (−4 − 4)/(3 + 1) = −2; 4 = −2(−1) + c ⇒ c = 2.' }) },
    { objectiveCode: 'cie.p2.geometry', content: mc({ key: 'cie.p2.geo.polygon', language: en, commandTerm: 'calculate', calculator: 'NONE', difficulty: 2, difficultyIndex: 0.95, tags: { assessmentObjective: 'AO1', contentCategory: 'Geometry' },
      question: 'The interior angle of a regular polygon is 150°. How many sides does the polygon have?', options: ['12', '10', '15', '6'], correct: 0, marks: 2,
      explanation: 'Exterior angle 30°; 360 ÷ 30 = 12.' }) },
    { objectiveCode: 'cie.p2.structured', content: multiPart({ key: 'cie.p2.str.quadratic', language: en, commandTerm: 'show that', calculator: 'NONE', difficulty: 4, difficultyIndex: 1.05, tags: { assessmentObjective: 'AO2', contentCategory: 'Algebra and graphs' },
      question: 'A rectangle has length (x + 5) cm and width (x − 1) cm. Its area is 40 cm².',
      parts: [
        mathPart('a', 'Show that x² + 4x − 45 = 0. Enter the equation you obtain.', { kind: 'EQUATION', answers: ['x^2+4x-45=0'] }, 2, 'AO2'),
        mathPart('b', 'Factorise x² + 4x − 45.', { kind: 'EXPRESSION', answers: ['(x+9)(x-5)'], requiredForm: 'FACTORED' }, 2, 'AO1'),
        mathPart('c', 'Write down the length of the rectangle, with its unit.', { kind: 'NUMBER', answers: ['10 cm'], units: { expected: 'cm', required: true, allowConversion: true } }, 1, 'AO2'),
      ],
      explanation: '(x + 5)(x − 1) = 40 ⇒ x² + 4x − 45 = 0 = (x + 9)(x − 5) ⇒ x = 5, length 10 cm.' }) },
    { objectiveCode: 'cie.p2.structured', content: multiPart({ key: 'cie.p2.str.probability', language: en, commandTerm: 'calculate', calculator: 'NONE', difficulty: 3, difficultyIndex: 1.0, tags: { assessmentObjective: 'AO2', contentCategory: 'Probability' },
      question: 'A box has 4 green and 6 yellow pens. Two pens are taken at random without replacement.',
      parts: [
        mathPart('a', 'Find the probability that both pens are green. Give your answer as a fraction in its simplest form.', { kind: 'NUMBER', answers: ['2/15'], requiredForm: 'SIMPLIFIED_FRACTION' }, 2, 'AO1'),
        mathPart('b', 'Find the probability that at least one pen is yellow, as a fraction in its simplest form.', { kind: 'NUMBER', answers: ['13/15'], requiredForm: 'SIMPLIFIED_FRACTION' }, 2, 'AO2'),
      ],
      explanation: 'P(GG) = 4/10 · 3/9 = 2/15; P(at least one yellow) = 1 − 2/15 = 13/15.' }) },
    // ---- Paper 4 ----
    { objectiveCode: 'cie.p4.statistics', content: mathItem({ key: 'cie.p4.stat.mean', language: en, commandTerm: 'calculate', calculator: 'SCIENTIFIC_REQUIRED', difficulty: 3, difficultyIndex: 1.0, tags: { assessmentObjective: 'AO1', contentCategory: 'Statistics' },
      question: 'The times, t minutes, of 40 runners: 10 < t ≤ 20 (frequency 6), 20 < t ≤ 30 (14), 30 < t ≤ 40 (12), 40 < t ≤ 50 (8). Calculate an estimate of the mean time. Give your answer to 3 significant figures.',
      math: { kind: 'NUMBER', answers: ['30.5'], significantFigures: 3 }, marks: 3, method: { marks: 1, criterion: 'M', intermediates: ['15*6+25*14+35*12+45*8', '1220/40'] },
      explanation: '(15·6 + 25·14 + 35·12 + 45·8) / 40 = 1220 / 40 = 30.5.' }) },
    { objectiveCode: 'cie.p4.statistics', content: mc({ key: 'cie.p4.stat.correlation', language: en, commandTerm: 'write down', calculator: 'SCIENTIFIC_REQUIRED', difficulty: 2, difficultyIndex: 0.9, tags: { assessmentObjective: 'AO2', contentCategory: 'Statistics' },
      question: 'A scatter diagram shows that as the outdoor temperature increases, the number of hot drinks sold decreases. What type of correlation is this?', options: ['Negative', 'Positive', 'Zero', 'Perfect positive'], correct: 0, marks: 1,
      explanation: 'One variable increases while the other decreases: negative correlation.' }) },
    { objectiveCode: 'cie.p4.mensuration', content: mathItem({ key: 'cie.p4.mens.sector', language: en, commandTerm: 'calculate', calculator: 'SCIENTIFIC_REQUIRED', difficulty: 3, difficultyIndex: 1.0, tags: { assessmentObjective: 'AO1', contentCategory: 'Mensuration' },
      question: 'A sector of a circle has radius 9 cm and angle 80°. Calculate the area of the sector. Give your answer to 3 significant figures, with its unit.',
      math: { kind: 'NUMBER', answers: ['56.5486678 cm^2'], significantFigures: 3, units: { expected: 'cm^2', required: true, allowConversion: true } }, marks: 2,
      explanation: '(80/360) × π × 9² = 18π ≈ 56.5 cm².' }) },
    { objectiveCode: 'cie.p4.mensuration', content: mathItem({ key: 'cie.p4.mens.angle', language: en, commandTerm: 'calculate', calculator: 'SCIENTIFIC_REQUIRED', difficulty: 3, difficultyIndex: 1.0, tags: { assessmentObjective: 'AO1', contentCategory: 'Trigonometry' },
      question: 'A ramp is 6 m long and rises 1.5 m. Calculate the angle the ramp makes with the horizontal, in degrees, correct to 1 decimal place.',
      math: { kind: 'NUMBER', answers: ['14.4775'], requiredForm: 'DECIMAL', decimalPlaces: 1 }, display: '14.5', marks: 2,
      explanation: 'sin θ = 1.5 / 6 ⇒ θ ≈ 14.5°.' }) },
    { objectiveCode: 'cie.p4.functions', content: multiPart({ key: 'cie.p4.fn.composite', language: en, commandTerm: 'work out', calculator: 'SCIENTIFIC_REQUIRED', difficulty: 3, difficultyIndex: 1.0, tags: { assessmentObjective: 'AO1', contentCategory: 'Algebra and graphs' },
      question: 'f(x) = 2x − 3 and g(x) = x² + 1.',
      parts: [
        mathPart('a', 'Work out fg(2).', { kind: 'NUMBER', answers: ['7'] }, 2, 'AO1'),
        mathPart('b', 'Find f⁻¹(x).', { kind: 'EXPRESSION', answers: ['(x+3)/2'] }, 2, 'AO1'),
        mathPart('c', 'Find gf(x), giving your answer in its simplest (expanded) form.', { kind: 'EXPRESSION', answers: ['4x^2-12x+10'], requiredForm: 'EXPANDED' }, 2, 'AO2'),
      ],
      explanation: 'g(2) = 5, f(5) = 7; f⁻¹(x) = (x + 3)/2; gf(x) = (2x − 3)² + 1 = 4x² − 12x + 10.' }) },
    { objectiveCode: 'cie.p4.functions', content: mathItem({ key: 'cie.p4.fn.quadratic', language: en, commandTerm: 'work out', calculator: 'SCIENTIFIC_REQUIRED', difficulty: 4, difficultyIndex: 1.1, tags: { assessmentObjective: 'AO1', contentCategory: 'Algebra and graphs' },
      question: 'Solve 2x² − 5x − 4 = 0. Enter the positive solution correct to 2 decimal places.',
      math: { kind: 'NUMBER', answers: ['3.137458609'], requiredForm: 'DECIMAL', decimalPlaces: 2 }, display: '3.14', marks: 3, method: { marks: 1, criterion: 'M', intermediates: ['(5+sqrt(57))/4'] },
      explanation: 'x = (5 ± √57)/4 ⇒ x ≈ 3.14 or x ≈ −0.64.' }) },
    { objectiveCode: 'cie.p4.structured', content: multiPart({ key: 'cie.p4.str.journey', language: en, commandTerm: 'calculate', calculator: 'SCIENTIFIC_REQUIRED', difficulty: 3, difficultyIndex: 1.0, tags: { assessmentObjective: 'AO2', contentCategory: 'Number', context: 'travel' },
      question: 'A train travels 240 km at an average speed of 80 km/h, then 150 km at 100 km/h.',
      parts: [
        mathPart('a', 'Calculate the total time for the journey, in hours.', { kind: 'NUMBER', answers: ['4.5 h'], units: { expected: 'h', required: false, allowConversion: true } }, 2, 'AO1'),
        mathPart('b', 'Calculate the average speed for the whole journey, in km/h, with its unit.', { kind: 'NUMBER', answers: ['86.6666667 km/h'], significantFigures: 3, units: { expected: 'km/h', required: true, allowConversion: true } }, 2, 'AO2'),
        mathPart('c', 'The fare is $36. It increases by 15%. Calculate the new fare in dollars.', { kind: 'NUMBER', answers: ['41.4'] }, 2, 'AO1'),
      ],
      explanation: '3 h + 1.5 h = 4.5 h; 390 / 4.5 ≈ 86.7 km/h; 36 × 1.15 = $41.40.' }) },
    { objectiveCode: 'cie.p4.structured', content: multiPart({ key: 'cie.p4.str.cylinder', language: en, commandTerm: 'calculate', calculator: 'SCIENTIFIC_REQUIRED', difficulty: 4, difficultyIndex: 1.05, tags: { assessmentObjective: 'AO2', contentCategory: 'Mensuration' },
      question: 'A cylindrical tank has radius 0.6 m and height 1.5 m.',
      parts: [
        mathPart('a', 'Calculate the volume of the tank in m³, to 3 significant figures, with its unit.', { kind: 'NUMBER', answers: ['1.696460033 m^3'], significantFigures: 3, units: { expected: 'm^3', required: true, allowConversion: true } }, 2, 'AO1'),
        mathPart('b', 'Water flows in at 12 litres per minute. Calculate the time to fill the tank, in minutes, to 3 significant figures.', { kind: 'NUMBER', answers: ['141.3716694'], significantFigures: 3 }, 3, 'AO2', { marks: 1, criterion: 'M', intermediates: ['1696.46/12'] }),
      ],
      explanation: 'V = π × 0.6² × 1.5 ≈ 1.70 m³ = 1696 litres; 1696 ÷ 12 ≈ 141 minutes.' }) },
  ],
};
