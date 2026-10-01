/**
 * Exam V2 reference vertical -- IB DP Mathematics: analysis and approaches HL.
 *
 * STRUCTURE (sources: ibo-math-aa-guide-2021, ibo-math-aa-brief-2021,
 * ibo-math-dp-page; first assessment 2021, last November 2028):
 *   Paper 1  120 min, 110 marks, 30%, no calculator, Section A short / Section B extended
 *   Paper 2  120 min, 110 marks, 30%, GDC,           Section A short / Section B extended
 *   Paper 3   60 min,  55 marks, 20%, GDC,           two extended problem-solving questions
 *   IA (exploration) 20 marks, 20% -- coursework, not simulated.
 *
 * CONTENT: original StudyUS practice items (FIXTURE). The bank fills a REDUCED
 * form of each paper; section time is proportional to the marks delivered
 * (~1.09 min per mark, the official ratio), and the form says how much of
 * the official paper it covers. Never official IB questions or markschemes.
 */
import type { ExamVerticalConfigInput } from '../../vertical-config';
import { FIXTURE_PROVENANCE } from '../fixture-builders';
import { mathItem, mathPart, multiPart, choicePart } from './builders';

const en = 'en';
const SOURCES = ['ibo-math-aa-guide-2021', 'ibo-math-aa-brief-2021', 'ibo-math-dp-page'];
const TERMS = [
  { term: 'find', expectedReasoningType: 'PROCEDURAL', description: 'Obtain an answer showing relevant stages in the working.' },
  { term: 'solve', expectedReasoningType: 'PROCEDURAL', description: 'Obtain the answer(s) using algebraic and/or numerical and/or graphical methods.' },
  { term: 'show that', expectedReasoningType: 'CONCEPTUAL', description: 'Obtain the required result (possibly using information given) without the formality of proof.' },
  { term: 'hence', expectedReasoningType: 'PROCEDURAL', description: 'Use the preceding work to obtain the required result.' },
  { term: 'write down', expectedReasoningType: 'FACTUAL', description: 'Obtain the answer(s), usually by extracting information. Little or no calculation is required.' },
  { term: 'calculate', expectedReasoningType: 'PROCEDURAL', description: 'Obtain a numerical answer showing the relevant stages in the working.' },
];
const P1_TOOLS = { calculator: false, formulaBooklet: true };
const P2_TOOLS = { calculator: 'graphic display calculator', formulaBooklet: true };

export const IB_MATH_AA_HL_V2: ExamVerticalConfigInput = {
  key: 'v2.ib.math-aa-hl',
  family: 'IB',
  contentStatus: 'DEV_CERT_FIXTURE',
  organization: { name: 'International Baccalaureate' },
  programme: { name: 'IB Diploma Programme', type: 'CURRICULUM' },
  subject: { name: 'Mathematics: analysis and approaches', level: 'HL' },
  definition: {
    name: 'IB Mathematics: analysis and approaches HL',
    purpose: 'Practice in the official IB Math AA HL paper structure (P1, P2, P3). Original StudyUS items; not IB questions or markschemes.',
    domains: ['Number and algebra', 'Functions', 'Geometry and trigonometry', 'Statistics and probability', 'Calculus'],
  },
  version: {
    label: 'V2 2021-2028',
    examYear: 2027,
    examSession: 'May / November',
    supportedModalities: ['DIGITAL'],
    delivery: {
      navigation: 'FREE_ORDER_WITHIN_SECTION',
      breaks: [{ afterSectionKey: 'p1', minutes: 10 }, { afterSectionKey: 'p2', minutes: 10 }],
      itemFeedback: 'AUTO',
      resultReview: 'FULL',
      permittedResources: ['Formula booklet', 'GDC (Papers 2 and 3 only)'],
    },
  },
  framework: {
    frameworkKey: 'ib-dp-math-aa',
    curriculumVersion: 'Mathematics: analysis and approaches guide (first assessment 2021)',
    firstAssessment: 2021,
    lastAssessment: 2028,
    syllabusCode: null,
    frameworkVersion: '2021',
    sourceKeys: SOURCES,
  },
  scoring: {
    name: 'IB Math AA HL practice -- marks',
    scoringType: 'MARK_SCHEME',
    policy: { engine: 'exam-scoring-v1', strategy: 'RAW', transform: { type: 'NONE' }, unit: '%', provenance: FIXTURE_PROVENANCE },
  },
  structureLabel: 'V2 2021-2028',
  commandTerms: TERMS,
  sections: [
    {
      key: 'p1',
      name: 'Paper 1 (no calculator)',
      componentType: 'PAPER',
      subject: { name: 'Mathematics: analysis and approaches', level: 'HL' },
      durationMinutes: 30,
      toolRules: P1_TOOLS,
      targetDifficultyIndex: 1.0,
      definition: {
        officialName: 'Paper 1',
        kind: 'WRITTEN_PAPER',
        assessment: 'EXTERNAL',
        officialDurationMinutes: 120,
        maxMarks: 110,
        weightingPercent: 30,
        calculatorPolicy: 'NONE',
        responseFormats: ['MATH_EXPRESSION', 'SHORT_RESPONSE', 'EXTENDED_RESPONSE'],
        sections: [
          { key: 'A', label: 'Section A: compulsory short-response questions', marksApprox: 55, responseKind: 'short response' },
          { key: 'B', label: 'Section B: compulsory extended-response questions', marksApprox: 55, responseKind: 'extended response' },
        ],
        commandTerms: TERMS.map((t) => t.term),
        limitations: ['StudyUS delivers a reduced form (original items); time is proportional to the marks delivered.'],
        sourceKeys: SOURCES,
      },
      objectives: [
        { code: 'aahl.p1.algebra', description: 'Number and algebra: logarithms, exponents, sequences and series.', targets: [{ commandTerm: 'solve', count: 1 }] },
        { code: 'aahl.p1.functions', description: 'Functions: rational functions, inverses, quadratics and inequalities.', targets: [{ commandTerm: 'find', count: 1 }] },
        { code: 'aahl.p1.calculus', description: 'Calculus: differentiation and integration without technology.', targets: [{ commandTerm: 'find', count: 2 }] },
        { code: 'aahl.p1.extended', description: 'Extended response: multi-step analysis across topics.', targets: [{ commandTerm: 'show that', count: 1 }] },
      ],
    },
    {
      key: 'p2',
      name: 'Paper 2 (GDC)',
      componentType: 'PAPER',
      subject: { name: 'Mathematics: analysis and approaches', level: 'HL' },
      durationMinutes: 16,
      toolRules: P2_TOOLS,
      targetDifficultyIndex: 1.0,
      definition: {
        officialName: 'Paper 2',
        kind: 'WRITTEN_PAPER',
        assessment: 'EXTERNAL',
        officialDurationMinutes: 120,
        maxMarks: 110,
        weightingPercent: 30,
        calculatorPolicy: 'GDC_REQUIRED',
        responseFormats: ['MATH_EXPRESSION', 'SHORT_RESPONSE', 'EXTENDED_RESPONSE'],
        sections: [
          { key: 'A', label: 'Section A: compulsory short-response questions', marksApprox: 55, responseKind: 'short response' },
          { key: 'B', label: 'Section B: compulsory extended-response questions', marksApprox: 55, responseKind: 'extended response' },
        ],
        commandTerms: TERMS.map((t) => t.term),
        limitations: ['Answers that are not exact are given to three significant figures unless stated otherwise.', 'StudyUS delivers a reduced form (original items).'],
        sourceKeys: SOURCES,
      },
      objectives: [
        { code: 'aahl.p2.statistics', description: 'Statistics and probability with technology: distributions and descriptive statistics.', targets: [{ commandTerm: 'find', count: 2 }] },
        { code: 'aahl.p2.trigonometry', description: 'Geometry and trigonometry: triangles and trigonometric equations.', targets: [{ commandTerm: 'find', count: 1 }] },
        { code: 'aahl.p2.extended', description: 'Extended response: modelling and probability in context.', targets: [{ commandTerm: 'find', count: 1 }] },
      ],
    },
    {
      key: 'p3',
      name: 'Paper 3 (GDC, problem solving)',
      componentType: 'PAPER',
      subject: { name: 'Mathematics: analysis and approaches', level: 'HL' },
      durationMinutes: 10,
      toolRules: P2_TOOLS,
      targetDifficultyIndex: 1.0,
      definition: {
        officialName: 'Paper 3',
        kind: 'WRITTEN_PAPER',
        assessment: 'EXTERNAL',
        officialDurationMinutes: 60,
        maxMarks: 55,
        weightingPercent: 20,
        calculatorPolicy: 'GDC_REQUIRED',
        responseFormats: ['MATH_EXPRESSION', 'EXTENDED_RESPONSE'],
        sections: [{ key: 'Q', label: 'Two compulsory extended-response problem-solving questions', marksApprox: 55, responseKind: 'extended problem solving' }],
        commandTerms: TERMS.map((t) => t.term),
        limitations: ['StudyUS delivers one of the two investigations per form (original items).'],
        sourceKeys: SOURCES,
      },
      objectives: [{ code: 'aahl.p3.investigation', description: 'Extended problem solving: conjecture, generalize and justify.', targets: [{ commandTerm: 'show that', count: 1 }] }],
    },
  ],
  items: [
    // ---------------- Paper 1 ----------------
    {
      objectiveCode: 'aahl.p1.algebra',
      content: mathItem({
        key: 'aahl.p1.alg.log', language: en, commandTerm: 'solve', calculator: 'NONE', difficulty: 3, difficultyIndex: 1.0,
        tags: { assessmentObjective: 'AO2', contentCategory: 'Number and algebra', cognitiveDemand: 'APPLICATION' },
        question: 'Solve the equation log₂(x) + log₂(x − 2) = 3. Show your working.',
        math: { kind: 'NUMBER', answers: ['4'] },
        marks: 3,
        method: { marks: 2, criterion: 'M', intermediates: ['x(x-2)=8', 'x^2-2x-8=0', '(x-4)(x+2)=0'] },
        explanation: 'log₂(x(x−2)) = 3 ⇒ x² − 2x − 8 = 0 ⇒ x = 4 or x = −2; x = −2 is rejected (log undefined), so x = 4.',
      }),
    },
    {
      objectiveCode: 'aahl.p1.algebra',
      content: mathItem({
        key: 'aahl.p1.alg.series', language: en, commandTerm: 'find', calculator: 'NONE', difficulty: 2, difficultyIndex: 0.95,
        tags: { assessmentObjective: 'AO1', contentCategory: 'Number and algebra', cognitiveDemand: 'APPLICATION' },
        question: 'Find the sum to infinity of the geometric series 18 + 12 + 8 + …',
        math: { kind: 'NUMBER', answers: ['54'] },
        marks: 2,
        method: { marks: 1, criterion: 'M', intermediates: ['18/(1-2/3)'] },
        explanation: 'r = 2/3, so S∞ = 18 / (1 − 2/3) = 54.',
      }),
    },
    {
      objectiveCode: 'aahl.p1.functions',
      content: multiPart({
        key: 'aahl.p1.fn.rational', language: en, commandTerm: 'find', calculator: 'NONE', difficulty: 3, difficultyIndex: 1.0,
        tags: { assessmentObjective: 'AO2', contentCategory: 'Functions', cognitiveDemand: 'ANALYSIS' },
        question: 'The function f is defined by f(x) = (2x + 1)/(x − 3), x ≠ 3.',
        parts: [
          mathPart('a', 'Write down the equation of the vertical asymptote of the graph of f.', { kind: 'EQUATION', answers: ['x=3'] }, 1, 'A'),
          mathPart('b', 'Write down the equation of the horizontal asymptote of the graph of f.', { kind: 'EQUATION', answers: ['y=2'] }, 1, 'A'),
          mathPart('c', 'Find f⁻¹(x).', { kind: 'EXPRESSION', answers: ['(3x+1)/(x-2)'] }, 2, 'A', { marks: 1, criterion: 'M', intermediates: ['x(y-3)=2y+1', 'xy-3x=2y+1'] }),
        ],
        explanation: 'Vertical asymptote x = 3, horizontal y = 2; swapping x and y: x(y − 3) = 2y + 1 ⇒ y = (3x + 1)/(x − 2).',
      }),
    },
    {
      objectiveCode: 'aahl.p1.functions',
      content: multiPart({
        key: 'aahl.p1.fn.quadratic', language: en, commandTerm: 'solve', calculator: 'NONE', difficulty: 3, difficultyIndex: 1.0,
        tags: { assessmentObjective: 'AO2', contentCategory: 'Functions', cognitiveDemand: 'APPLICATION' },
        question: 'Let g(x) = x² − 6x + 5.',
        parts: [
          mathPart('a', 'Factorize g(x).', { kind: 'EXPRESSION', answers: ['(x-1)(x-5)'], requiredForm: 'FACTORED' }, 2, 'A'),
          mathPart('b', 'Hence solve g(x) < 0. Give your answer as an interval.', { kind: 'INTERVAL', answers: ['(1,5)'] }, 2, 'A'),
        ],
        explanation: 'g(x) = (x − 1)(x − 5), negative strictly between the roots: 1 < x < 5.',
      }),
    },
    {
      objectiveCode: 'aahl.p1.calculus',
      content: mathItem({
        key: 'aahl.p1.calc.product', language: en, commandTerm: 'find', calculator: 'NONE', difficulty: 3, difficultyIndex: 1.0,
        tags: { assessmentObjective: 'AO2', contentCategory: 'Calculus', cognitiveDemand: 'APPLICATION' },
        question: 'Find f′(x) for f(x) = x³e^{2x}.',
        math: { kind: 'EXPRESSION', answers: ['3x^2 e^{2x}+2x^3 e^{2x}'] },
        marks: 3,
        explanation: 'Product rule: f′(x) = 3x²e^{2x} + 2x³e^{2x} = x²e^{2x}(3 + 2x).',
      }),
    },
    {
      objectiveCode: 'aahl.p1.calculus',
      content: mathItem({
        key: 'aahl.p1.calc.integral', language: en, commandTerm: 'find', calculator: 'NONE', difficulty: 2, difficultyIndex: 0.95,
        tags: { assessmentObjective: 'AO1', contentCategory: 'Calculus', cognitiveDemand: 'APPLICATION' },
        question: 'Find the exact value of ∫₀² (3x² − 2x) dx.',
        math: { kind: 'NUMBER', answers: ['4'], requiredForm: 'EXACT' },
        marks: 2,
        method: { marks: 1, criterion: 'M', intermediates: ['x^3-x^2', '8-4'] },
        explanation: '[x³ − x²]₀² = 8 − 4 = 4.',
      }),
    },
    {
      objectiveCode: 'aahl.p1.calculus',
      content: mathItem({
        key: 'aahl.p1.calc.tangent', language: en, commandTerm: 'find', calculator: 'NONE', difficulty: 3, difficultyIndex: 1.05,
        tags: { assessmentObjective: 'AO2', contentCategory: 'Calculus', cognitiveDemand: 'APPLICATION' },
        question: 'Find the gradient of the tangent to the curve y = ln(x² + 1) at the point where x = 1.',
        math: { kind: 'NUMBER', answers: ['1'] },
        marks: 2,
        method: { marks: 1, criterion: 'M', intermediates: ['2x/(x^2+1)'] },
        explanation: 'dy/dx = 2x/(x² + 1); at x = 1 this is 2/2 = 1.',
      }),
    },
    {
      objectiveCode: 'aahl.p1.extended',
      content: multiPart({
        key: 'aahl.p1.ext.xe', language: en, commandTerm: 'show that', calculator: 'NONE', difficulty: 4, difficultyIndex: 1.05,
        tags: { assessmentObjective: 'AO3', contentCategory: 'Calculus', cognitiveDemand: 'ANALYSIS' },
        question: 'Consider the function f(x) = x e^{−x}, x ∈ ℝ.',
        parts: [
          mathPart('a', 'Find f′(x).', { kind: 'EXPRESSION', answers: ['e^{-x}(1-x)'] }, 3, 'A'),
          mathPart('b', 'Hence find the x-coordinate of the maximum point of the graph of f.', { kind: 'EQUATION', answers: ['x=1'] }, 2, 'A'),
          mathPart('c', 'Show that f″(x) = (x − 2)e^{−x}. Enter your final expression for f″(x).', { kind: 'EXPRESSION', answers: ['(x-2)e^{-x}'] }, 3, 'A'),
          mathPart('d', 'Find the x-coordinate of the point of inflexion.', { kind: 'EQUATION', answers: ['x=2'] }, 2, 'A'),
        ],
        explanation: 'f′(x) = e^{−x} − xe^{−x} = e^{−x}(1 − x) ⇒ max at x = 1; f″(x) = −e^{−x} − e^{−x}(1 − x) = (x − 2)e^{−x}, which changes sign at x = 2.',
      }),
    },
    {
      objectiveCode: 'aahl.p1.extended',
      content: multiPart({
        key: 'aahl.p1.ext.geometric', language: en, commandTerm: 'find', calculator: 'NONE', difficulty: 3, difficultyIndex: 1.0,
        tags: { assessmentObjective: 'AO2', contentCategory: 'Number and algebra', cognitiveDemand: 'ANALYSIS' },
        question: 'A geometric sequence has first term u₁ = 3 and common ratio r = 2.',
        parts: [
          mathPart('a', 'Find u₈.', { kind: 'NUMBER', answers: ['384'] }, 2, 'A'),
          mathPart('b', 'Find the sum of the first 8 terms.', { kind: 'NUMBER', answers: ['765'] }, 2, 'A'),
          mathPart('c', 'Find the least value of n for which Sₙ > 3000.', { kind: 'NUMBER', answers: ['10'], requiredForm: 'INTEGER' }, 2, 'A', { marks: 1, criterion: 'M', intermediates: ['3(2^n-1)>3000', '2^n>1001'] }),
        ],
        explanation: 'u₈ = 3·2⁷ = 384; S₈ = 3(2⁸ − 1) = 765; 3(2ⁿ − 1) > 3000 ⇒ 2ⁿ > 1001 ⇒ n = 10.',
      }),
    },
    // ---------------- Paper 2 ----------------
    {
      objectiveCode: 'aahl.p2.statistics',
      content: mathItem({
        key: 'aahl.p2.stat.normal', language: en, commandTerm: 'find', calculator: 'GDC_REQUIRED', difficulty: 2, difficultyIndex: 0.95,
        tags: { assessmentObjective: 'AO1', contentCategory: 'Statistics and probability', cognitiveDemand: 'APPLICATION' },
        question: 'The masses of apples are normally distributed with mean 150 g and standard deviation 12 g. Find the probability that a randomly chosen apple has a mass greater than 168 g. Give your answer to 3 significant figures.',
        math: { kind: 'NUMBER', answers: ['0.0668072'], significantFigures: 3, tolerance: { absolute: 0.00005 } },
        display: '0.0668',
        marks: 2,
        explanation: 'P(X > 168) = P(Z > 1.5) ≈ 0.0668.',
      }),
    },
    {
      objectiveCode: 'aahl.p2.statistics',
      content: mathItem({
        key: 'aahl.p2.stat.binomial', language: en, commandTerm: 'find', calculator: 'GDC_REQUIRED', difficulty: 2, difficultyIndex: 1.0,
        tags: { assessmentObjective: 'AO1', contentCategory: 'Statistics and probability', cognitiveDemand: 'APPLICATION' },
        question: 'A fair spinner lands on red with probability 0.3. It is spun 10 times. Find the probability that it lands on red exactly 3 times. Give your answer to 3 significant figures.',
        math: { kind: 'NUMBER', answers: ['0.266827932'], significantFigures: 3 },
        display: '0.267',
        marks: 2,
        explanation: 'X ~ B(10, 0.3): P(X = 3) = C(10,3)(0.3)³(0.7)⁷ ≈ 0.267.',
      }),
    },
    {
      objectiveCode: 'aahl.p2.statistics',
      content: mathItem({
        key: 'aahl.p2.stat.mean', language: en, commandTerm: 'find', calculator: 'GDC_REQUIRED', difficulty: 1, difficultyIndex: 0.85,
        tags: { assessmentObjective: 'AO1', contentCategory: 'Statistics and probability', cognitiveDemand: 'RECALL' },
        question: 'The mean of the five numbers 12, 15, 9, 20 and k is 14. Find k.',
        math: { kind: 'NUMBER', answers: ['14'] },
        marks: 2,
        explanation: '12 + 15 + 9 + 20 + k = 70 ⇒ k = 14.',
      }),
    },
    {
      objectiveCode: 'aahl.p2.trigonometry',
      content: mathItem({
        key: 'aahl.p2.trig.cosine', language: en, commandTerm: 'find', calculator: 'GDC_REQUIRED', difficulty: 3, difficultyIndex: 1.0,
        tags: { assessmentObjective: 'AO2', contentCategory: 'Geometry and trigonometry', cognitiveDemand: 'APPLICATION' },
        question: 'In triangle ABC, AC = 7 cm, BC = 9 cm and angle ACB = 40°. Find AB, giving your answer to 3 significant figures with its unit.',
        math: { kind: 'NUMBER', answers: ['5.78601 cm'], significantFigures: 3, tolerance: { absolute: 0.0005 }, units: { expected: 'cm', required: true, allowConversion: true } },
        display: '5.79 cm',
        marks: 3,
        explanation: 'AB² = 7² + 9² − 2·7·9·cos 40° ≈ 33.48 ⇒ AB ≈ 5.79 cm.',
      }),
    },
    {
      objectiveCode: 'aahl.p2.trigonometry',
      content: multiPart({
        key: 'aahl.p2.trig.equation', language: en, commandTerm: 'solve', calculator: 'GDC_REQUIRED', difficulty: 3, difficultyIndex: 1.05,
        tags: { assessmentObjective: 'AO2', contentCategory: 'Geometry and trigonometry', cognitiveDemand: 'APPLICATION' },
        question: 'Solve 5 sin x = 3 for 0 ≤ x ≤ π. Give your answers to 3 significant figures.',
        parts: [
          mathPart('a', 'The smaller solution.', { kind: 'NUMBER', answers: ['0.643501109'], significantFigures: 3 }, 2, 'A'),
          mathPart('b', 'The larger solution.', { kind: 'NUMBER', answers: ['2.498091545'], significantFigures: 3 }, 2, 'A'),
        ],
        explanation: 'sin x = 0.6 ⇒ x = 0.644 or x = π − 0.644 = 2.50.',
      }),
    },
    {
      objectiveCode: 'aahl.p2.extended',
      content: multiPart({
        key: 'aahl.p2.ext.cooling', language: en, commandTerm: 'find', calculator: 'GDC_REQUIRED', difficulty: 3, difficultyIndex: 1.0,
        tags: { assessmentObjective: 'AO4', contentCategory: 'Functions', context: 'scientific', cognitiveDemand: 'APPLICATION' },
        question: 'The temperature of a cup of tea, T °C, t minutes after it is made is modelled by T(t) = 20 + 60e^{−0.05t}.',
        parts: [
          mathPart('a', 'Write down the initial temperature of the tea.', { kind: 'NUMBER', answers: ['80'] }, 1, 'A'),
          mathPart('b', 'Find the temperature after 10 minutes, to 3 significant figures.', { kind: 'NUMBER', answers: ['56.39183969'], significantFigures: 3 }, 2, 'A'),
          mathPart('c', 'Find the time taken for the tea to cool to 30 °C, to 3 significant figures.', { kind: 'NUMBER', answers: ['35.83518938'], significantFigures: 3 }, 2, 'A', { marks: 1, criterion: 'M', intermediates: ['60e^{-0.05t}=10'] }),
        ],
        explanation: 'T(0) = 80; T(10) = 20 + 60e^{−0.5} ≈ 56.4; 60e^{−0.05t} = 10 ⇒ t = 20 ln 6 ≈ 35.8 min.',
      }),
    },
    {
      objectiveCode: 'aahl.p2.extended',
      content: multiPart({
        key: 'aahl.p2.ext.bag', language: en, commandTerm: 'find', calculator: 'GDC_REQUIRED', difficulty: 3, difficultyIndex: 1.0,
        tags: { assessmentObjective: 'AO2', contentCategory: 'Statistics and probability', cognitiveDemand: 'ANALYSIS' },
        question: 'A bag contains 5 red and 3 blue counters. Two counters are taken at random without replacement.',
        parts: [
          mathPart('a', 'Find the probability that both counters are red. Give your answer as a fraction in its simplest form.', { kind: 'NUMBER', answers: ['5/14'], requiredForm: 'SIMPLIFIED_FRACTION' }, 2, 'A'),
          mathPart('b', 'Find the probability that the counters are different colours, as a fraction in its simplest form.', { kind: 'NUMBER', answers: ['15/28'], requiredForm: 'SIMPLIFIED_FRACTION' }, 2, 'A'),
          choicePart('c', 'Which statement about the events "first is red" and "second is red" is true?', ['They are independent', 'They are not independent', 'They are mutually exclusive', 'They are complementary'], 1, 1, 'A'),
        ],
        explanation: 'P(RR) = 5/8 · 4/7 = 5/14; P(different) = 2 · 5/8 · 3/7 = 15/28; without replacement the events are dependent.',
      }),
    },
    // ---------------- Paper 3 ----------------
    {
      objectiveCode: 'aahl.p3.investigation',
      content: multiPart({
        key: 'aahl.p3.inv.powers', language: en, commandTerm: 'show that', calculator: 'GDC_REQUIRED', difficulty: 4, difficultyIndex: 1.05,
        tags: { assessmentObjective: 'AO5', contentCategory: 'Number and algebra', cognitiveDemand: 'SYNTHESIS' },
        question: 'This question investigates sums of powers. Let Sₙ = 1 + 2 + … + n and Cₙ = 1³ + 2³ + … + n³.',
        parts: [
          mathPart('a', 'Write down S₁₀.', { kind: 'NUMBER', answers: ['55'] }, 1, 'A'),
          mathPart('b', 'Write down an expression for Sₙ in terms of n.', { kind: 'EXPRESSION', answers: ['n(n+1)/2'] }, 2, 'A'),
          mathPart('c', 'Calculate C₁, C₂, C₃ and C₄ and compare them with S₁, …, S₄. Hence conjecture an expression for Cₙ in terms of n.', { kind: 'EXPRESSION', answers: ['(n(n+1)/2)^2'] }, 3, 'A'),
          mathPart('d', 'Use your conjecture to find C₂₀.', { kind: 'NUMBER', answers: ['44100'] }, 2, 'A'),
        ],
        explanation: 'Sₙ = n(n+1)/2; Cₙ = 1, 9, 36, 100 = Sₙ² ⇒ Cₙ = (n(n+1)/2)²; C₂₀ = 210² = 44100.',
      }),
    },
    {
      objectiveCode: 'aahl.p3.investigation',
      content: multiPart({
        key: 'aahl.p3.inv.ladder', language: en, commandTerm: 'find', calculator: 'GDC_REQUIRED', difficulty: 4, difficultyIndex: 1.05,
        tags: { assessmentObjective: 'AO4', contentCategory: 'Calculus', context: 'occupational', cognitiveDemand: 'SYNTHESIS' },
        question: 'A 5 m ladder leans against a vertical wall. Its foot slides away from the wall at 0.4 m s⁻¹.',
        parts: [
          mathPart('a', 'Find the height of the top of the ladder when its foot is 3 m from the wall. Include the unit.', { kind: 'NUMBER', answers: ['4 m'], units: { expected: 'm', required: true } }, 2, 'A'),
          mathPart('b', 'Find the rate at which the top of the ladder is moving at that instant (negative means downwards). Include the unit.', { kind: 'NUMBER', answers: ['-0.3 m/s'], units: { expected: 'm/s', required: true, allowConversion: true } }, 3, 'A'),
          mathPart('c', 'Find the angle between the ladder and the ground at that instant, in radians, to 3 significant figures.', { kind: 'NUMBER', answers: ['0.927295218'], significantFigures: 3 }, 2, 'A'),
        ],
        explanation: 'y = √(25 − 9) = 4 m; x dx/dt + y dy/dt = 0 ⇒ 3(0.4) + 4 dy/dt = 0 ⇒ dy/dt = −0.3 m s⁻¹; cos θ = 3/5 ⇒ θ ≈ 0.927 rad.',
      }),
    },
  ],
};
