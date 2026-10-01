/**
 * Cambridge -- DEV certification fixture configurations, including AICE.
 *
 * One ecosystem, one engine:
 *   Cambridge International -> programme -> qualification -> subject -> paper.
 * IGCSE is a qualification; AICE is ANOTHER qualification (the AICE Diploma)
 * whose subjects are aggregated by subject group -- the same Cambridge
 * structures, no AICE engine. No certificate/diploma rule is asserted: the
 * aggregate reports what the Student has, and "rules not configured".
 *
 * ENGINE_SUPPORT: qualification layer, papers as components, mark-scheme
 * multi-part items (method / accuracy marks), WEIGHTED_ITEMS scoring,
 * per-paper timing, AICE subject grouping.
 * OFFICIAL_CONTENT_COVERAGE: NONE -- papers, marks, groups and items are
 * original fixtures; no syllabus code, grade threshold or diploma rule.
 */
import type { ExamVerticalConfigInput } from '../vertical-config';
import { choice, partChoice, partText, shortText, structured, FIXTURE_PROVENANCE } from './fixture-builders';

const en = 'en';
const CAMBRIDGE_TERMS = [
  { term: 'simplify', expectedReasoningType: 'PROCEDURAL', description: 'Write in its simplest form.' },
  { term: 'factorise', expectedReasoningType: 'PROCEDURAL', description: 'Write as a product of factors.' },
  { term: 'find', expectedReasoningType: 'PROCEDURAL', description: 'Obtain an answer, showing relevant stages in the working.' },
];

export const CAMBRIDGE_IGCSE_MATH_DEV_CERT: ExamVerticalConfigInput = {
  key: 'dev-cert.cambridge.igcse-math',
  family: 'CAMBRIDGE',
  contentStatus: 'DEV_CERT_FIXTURE',
  organization: { name: 'Cambridge International' },
  programme: { name: 'Cambridge Upper Secondary', type: 'CURRICULUM' },
  qualification: { name: 'Cambridge IGCSE' },
  subject: { name: 'Mathematics', level: 'Extended' },
  definition: {
    name: 'Cambridge IGCSE Mathematics (Extended) — certification (DEV)',
    purpose: 'DEV certification fixture for the Cambridge vertical -- original mark-scheme items; no syllabus code or grade threshold.',
    domains: ['Number', 'Algebra', 'Geometry'],
  },
  version: {
    label: 'DEV-CERT v1',
    examYear: 2027,
    examSession: 'June (fixture)',
    delivery: { navigation: 'LINEAR', breaks: [], itemFeedback: 'AUTO', resultReview: 'FULL', permittedResources: ['Scientific calculator (Paper B only)'] },
  },
  scoring: {
    name: 'Cambridge IGCSE Math DEV fixture -- marks',
    scoringType: 'MARK_SCHEME',
    policy: { engine: 'exam-scoring-v1', strategy: 'WEIGHTED_ITEMS', transform: { type: 'NONE' }, unit: '%', provenance: FIXTURE_PROVENANCE },
  },
  structureLabel: 'DEV-CERT v1',
  commandTerms: CAMBRIDGE_TERMS,
  sections: [
    {
      key: 'paper_a',
      name: 'Paper A (short answer, fixture)',
      componentType: 'PAPER',
      subject: { name: 'Mathematics', level: 'Extended' },
      durationMinutes: 15,
      toolRules: { calculator: false },
      objectives: [
        { code: 'cie.algebra', description: 'Simplify and factorise algebraic expressions.', targets: [{ commandTerm: 'simplify', count: 1 }] },
        { code: 'cie.number', description: 'Use standard form.', targets: [{ questionType: 'multiple_choice', count: 1 }] },
      ],
    },
    {
      key: 'paper_b',
      name: 'Paper B (structured, fixture)',
      componentType: 'PAPER',
      subject: { name: 'Mathematics', level: 'Extended' },
      durationMinutes: 20,
      toolRules: { calculator: 'scientific' },
      objectives: [
        { code: 'cie.money', description: 'Solve problems involving money and percentage change.', targets: [{ commandTerm: 'find', count: 1 }] },
        { code: 'cie.geometry', description: "Apply Pythagoras' theorem in right-angled triangles.", targets: [{ commandTerm: 'find', count: 1 }] },
      ],
    },
  ],
  items: [
    { objectiveCode: 'cie.algebra', content: shortText({ key: 'cie.a.01', language: en, commandTerm: 'simplify', question: 'Simplify 3a + 5b − a + 2b.', answers: ['2a + 7b', '2a+7b', '7b + 2a', '7b+2a'], marks: 2, explanation: '3a − a = 2a and 5b + 2b = 7b.', difficulty: 2 }) },
    { objectiveCode: 'cie.algebra', content: shortText({ key: 'cie.a.03', language: en, commandTerm: 'factorise', question: 'Factorise completely 6x + 9.', answers: ['3(2x + 3)', '3(2x+3)', '3 (2x + 3)'], marks: 2, explanation: 'The highest common factor is 3.', difficulty: 2 }) },
    { objectiveCode: 'cie.number', content: choice({ key: 'cie.a.02', language: en, question: 'Write 0.00052 in standard form.', options: ['5.2 × 10⁻⁴', '5.2 × 10⁴', '52 × 10⁻⁵', '0.52 × 10⁻³'], correct: 0, explanation: 'Standard form needs 1 ≤ a < 10: 5.2 × 10⁻⁴.' }) },
    {
      objectiveCode: 'cie.money',
      content: structured({
        key: 'cie.b.01',
        language: en,
        commandTerm: 'find',
        calculatorAllowed: true,
        question: 'A shop sells pens for $1.20 each.',
        parts: [
          partText('a', 'Find the cost of 15 pens, in dollars.', ['18', '18.00', '$18', '$18.00'], 1, 'A', 0.001),
          partChoice('b', 'The price increases by 15%. Which calculation gives the new price of one pen?', ['1.20 × 0.15', '1.20 × 1.15', '1.20 + 0.15', '1.20 ÷ 1.15'], 1, 1, 'M'),
          partText('c', 'Find the new price of one pen, in dollars.', ['1.38', '$1.38'], 2, 'A', 0.001),
        ],
        explanation: '15 × 1.20 = 18; 1.20 × 1.15 = 1.38.',
      }),
    },
    {
      objectiveCode: 'cie.geometry',
      content: structured({
        key: 'cie.b.02',
        language: en,
        commandTerm: 'find',
        calculatorAllowed: true,
        question: 'Triangle ABC has a right angle at B. AB = 6 cm and BC = 8 cm.',
        parts: [
          partChoice('a', 'Which theorem should be used to find AC?', ['Thales', 'Pythagoras', 'Sine rule', 'Midpoint theorem'], 1, 1, 'M'),
          partText('b', 'Find the length of AC, in cm.', ['10'], 2, 'A', 0.01),
        ],
        explanation: 'AC² = 6² + 8² = 100, so AC = 10 cm.',
      }),
    },
  ],
};

const AICE_QUALIFICATION = { name: 'Cambridge AICE Diploma' };
const AICE_PROGRAMME = { name: 'Cambridge Advanced', type: 'CURRICULUM' as const };

export const AICE_AS_MATH_DEV_CERT: ExamVerticalConfigInput = {
  key: 'dev-cert.aice.as-math',
  family: 'AICE',
  contentStatus: 'DEV_CERT_FIXTURE',
  organization: { name: 'Cambridge International' },
  programme: AICE_PROGRAMME,
  qualification: AICE_QUALIFICATION,
  subject: { name: 'Mathematics', level: 'AS Level' },
  aggregation: { qualificationGroupKey: 'aice-diploma', groupName: 'Cambridge AICE Diploma', subjectGroup: 'Fixture group 1' },
  definition: {
    name: 'Cambridge AICE — AS Mathematics — certification (DEV)',
    purpose: 'DEV certification fixture for the AICE vertical (a Cambridge qualification aggregation, not a separate engine).',
    domains: ['Pure Mathematics'],
  },
  version: {
    label: 'DEV-CERT v1',
    examYear: 2027,
    examSession: 'June (fixture)',
    delivery: { navigation: 'LINEAR', breaks: [], itemFeedback: 'AUTO', resultReview: 'FULL', permittedResources: ['Scientific calculator'] },
  },
  scoring: {
    name: 'AICE AS Math DEV fixture -- marks',
    scoringType: 'MARK_SCHEME',
    policy: { engine: 'exam-scoring-v1', strategy: 'WEIGHTED_ITEMS', transform: { type: 'NONE' }, unit: '%', provenance: FIXTURE_PROVENANCE },
  },
  structureLabel: 'DEV-CERT v1',
  commandTerms: CAMBRIDGE_TERMS,
  sections: [
    {
      key: 'pure1',
      name: 'Pure Mathematics paper (fixture)',
      componentType: 'PAPER',
      subject: { name: 'Mathematics', level: 'AS Level' },
      durationMinutes: 20,
      objectives: [
        { code: 'aice.math.calculus', description: 'Differentiate polynomials and classify stationary points.', targets: [{ commandTerm: 'find', count: 2 }] },
        { code: 'aice.math.exponentials', description: 'Solve simple exponential equations.', targets: [{ count: 1 }] },
      ],
    },
  ],
  items: [
    { objectiveCode: 'aice.math.calculus', content: choice({ key: 'aice.m.01', language: en, question: 'Find dy/dx for y = 3x⁴ − 2x.', options: ['12x³ − 2', '12x³', '3x³ − 2', '12x⁴ − 2'], correct: 0, explanation: 'd/dx(3x⁴) = 12x³ and d/dx(−2x) = −2.', commandTerm: 'find', marks: 2 }) },
    {
      objectiveCode: 'aice.math.calculus',
      content: structured({
        key: 'aice.m.02',
        language: en,
        commandTerm: 'find',
        question: 'The curve C has equation y = x² − 4x + 3.',
        parts: [
          partText('a', 'Find the x-coordinate of the stationary point of C.', ['2', 'x = 2', 'x=2'], 2, 'A', 0),
          partChoice('b', 'Is the stationary point a minimum or a maximum?', ['Minimum', 'Maximum'], 0, 1, 'M'),
        ],
        explanation: "dy/dx = 2x − 4 = 0 gives x = 2; d²y/dx² = 2 > 0, so it is a minimum.",
      }),
    },
    { objectiveCode: 'aice.math.exponentials', content: shortText({ key: 'aice.m.03', language: en, question: 'Solve 2^x = 32.', answers: ['5', 'x = 5', 'x=5'], marks: 2, explanation: '32 = 2⁵, so x = 5.', difficulty: 2 }) },
  ],
};

const REMOTE = {
  key: 'aice.egp.remote',
  title: 'Remote work',
  text:
    'Remote work has spread rapidly. Supporters argue that it saves commuting time and widens the pool of candidates employers can hire. ' +
    'Critics reply that it weakens team cohesion and blurs the line between work and home. ' +
    'The evidence so far suggests that outcomes depend heavily on how organisations manage communication.',
};

export const AICE_AS_EGP_DEV_CERT: ExamVerticalConfigInput = {
  key: 'dev-cert.aice.as-english-general-paper',
  family: 'AICE',
  contentStatus: 'DEV_CERT_FIXTURE',
  organization: { name: 'Cambridge International' },
  programme: AICE_PROGRAMME,
  qualification: AICE_QUALIFICATION,
  subject: { name: 'English General Paper', level: 'AS Level' },
  aggregation: { qualificationGroupKey: 'aice-diploma', groupName: 'Cambridge AICE Diploma', subjectGroup: 'Fixture group 2' },
  definition: {
    name: 'Cambridge AICE — AS English General Paper — certification (DEV)',
    purpose: 'DEV certification fixture: a second AICE subject in the same qualification aggregation.',
    domains: ['Comprehension'],
  },
  version: {
    label: 'DEV-CERT v1',
    examYear: 2027,
    examSession: 'June (fixture)',
    delivery: { navigation: 'FREE_ORDER_WITHIN_SECTION', breaks: [], itemFeedback: 'NEVER', resultReview: 'FULL', permittedResources: [] },
  },
  scoring: {
    name: 'AICE AS EGP DEV fixture -- raw',
    scoringType: 'BINARY',
    policy: { engine: 'exam-scoring-v1', strategy: 'RAW', transform: { type: 'NONE' }, unit: '%', provenance: FIXTURE_PROVENANCE },
  },
  structureLabel: 'DEV-CERT v1',
  sections: [
    {
      key: 'comprehension',
      name: 'Comprehension paper (fixture)',
      componentType: 'PAPER',
      subject: { name: 'English General Paper', level: 'AS Level' },
      durationMinutes: 10,
      objectives: [{ code: 'aice.egp.argument', description: "Identify a writer's position and the arguments presented.", targets: [{ questionType: 'multiple_choice', count: 2 }] }],
    },
  ],
  items: [
    { objectiveCode: 'aice.egp.argument', content: choice({ key: 'aice.egp.01', language: en, stimulus: REMOTE, question: "What is the writer's overall position?", options: ['Remote work should be banned.', 'Remote work is always better.', 'The effects of remote work depend on how it is managed.', 'Commuting time is irrelevant.'], correct: 2, explanation: 'The final sentence states that outcomes depend on how communication is managed.' }) },
    { objectiveCode: 'aice.egp.argument', content: choice({ key: 'aice.egp.02', language: en, stimulus: REMOTE, question: 'Which point is presented as a criticism of remote work?', options: ['It saves commuting time.', 'It widens the candidate pool.', 'It weakens team cohesion.', 'It improves communication.'], correct: 2, explanation: 'Critics say it weakens team cohesion.' }) },
    { objectiveCode: 'aice.egp.argument', content: choice({ key: 'aice.egp.03', language: en, stimulus: REMOTE, question: "In the passage, 'blurs' most nearly means:", options: ['sharpens', 'makes less clear', 'removes completely', 'measures'], correct: 1, explanation: "To blur a line is to make it less clear.", difficulty: 2 }) },
  ],
};
