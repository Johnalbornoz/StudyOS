/**
 * IB Diploma Programme -- DEV certification fixture configurations (TWO
 * subjects, so no single IB subject is treated as "all of IB").
 *
 * ENGINE_SUPPORT: programme -> subject (with SL/HL level) -> papers as
 * components, command terms on objectives and items, structured multi-part
 * items marked against a deterministic mark scheme, criterion-based scoring
 * (CRITERIA strategy), per-paper timing and tool rules.
 * OFFICIAL_CONTENT_COVERAGE: NONE -- papers, criteria, durations and items are
 * original fixtures; the criteria labels are generic fixture criteria, not an
 * IB subject's assessment criteria.
 */
import type { ExamVerticalConfigInput } from '../vertical-config';
import { choice, partChoice, partText, structured, FIXTURE_PROVENANCE } from './fixture-builders';

const en = 'en';
const IB_TERMS = [
  { term: 'write down', expectedReasoningType: 'FACTUAL', description: 'Obtain the answer with little or no working.' },
  { term: 'calculate', expectedReasoningType: 'PROCEDURAL', description: 'Obtain a numerical answer showing relevant working.' },
  { term: 'hence', expectedReasoningType: 'PROCEDURAL', description: 'Use the preceding work to obtain the answer.' },
  { term: 'explain', expectedReasoningType: 'CONCEPTUAL', description: 'Give a detailed account including reasons or causes.' },
  { term: 'identify', expectedReasoningType: 'FACTUAL', description: 'Provide an answer from a number of possibilities.' },
];

export const IB_MATH_AA_SL_DEV_CERT: ExamVerticalConfigInput = {
  key: 'dev-cert.ib.math-aa-sl',
  family: 'IB',
  contentStatus: 'DEV_CERT_FIXTURE',
  organization: { name: 'International Baccalaureate' },
  programme: { name: 'IB Diploma Programme', type: 'CURRICULUM' },
  subject: { name: 'Mathematics: Analysis and Approaches', level: 'SL' },
  definition: {
    name: 'IB Mathematics: Analysis and Approaches SL — certification (DEV)',
    purpose: 'DEV certification fixture for the IB vertical -- original structured items marked against fixture criteria; not an IB specification.',
    domains: ['Functions', 'Sequences', 'Applications'],
  },
  version: {
    label: 'DEV-CERT v1',
    examYear: 2027,
    examSession: 'May (fixture)',
    supportedModalities: ['DIGITAL'],
    delivery: {
      navigation: 'LINEAR',
      breaks: [{ afterSectionKey: 'paper1', minutes: 5 }],
      itemFeedback: 'AUTO',
      resultReview: 'FULL',
      permittedResources: ['Graphic display calculator (Paper 2 only)'],
    },
  },
  scoring: {
    name: 'IB Math AA SL DEV fixture -- criteria',
    scoringType: 'MARK_SCHEME',
    policy: {
      engine: 'exam-scoring-v1',
      strategy: 'CRITERIA',
      criterionWeights: { knowledge: 1, application: 2, communication: 1 },
      transform: { type: 'NONE' },
      unit: '%',
      provenance: FIXTURE_PROVENANCE,
    },
  },
  structureLabel: 'DEV-CERT v1',
  commandTerms: IB_TERMS,
  sections: [
    {
      key: 'paper1',
      name: 'Paper 1 (no calculator)',
      componentType: 'PAPER',
      subject: { name: 'Mathematics: Analysis and Approaches', level: 'SL' },
      durationMinutes: 20,
      toolRules: { calculator: false },
      objectives: [
        { code: 'ibm.functions', description: 'Analyse quadratic functions: intercepts, roots and vertex.', targets: [{ commandTerm: 'write down', count: 1 }] },
        { code: 'ibm.sequences', description: 'Use arithmetic sequences and series.', targets: [{ commandTerm: 'calculate', count: 1 }] },
      ],
    },
    {
      key: 'paper2',
      name: 'Paper 2 (calculator)',
      componentType: 'PAPER',
      subject: { name: 'Mathematics: Analysis and Approaches', level: 'SL' },
      durationMinutes: 20,
      toolRules: { calculator: 'graphic display calculator' },
      objectives: [{ code: 'ibm.applications', description: 'Apply exponential and geometric models in context.', targets: [{ commandTerm: 'calculate', count: 1 }] }],
    },
  ],
  items: [
    {
      objectiveCode: 'ibm.functions',
      content: structured({
        key: 'ibm.p1.01',
        language: en,
        commandTerm: 'write down',
        question: 'The function f is defined by f(x) = 2x² − 8.',
        parts: [
          partText('a', 'Write down the y-coordinate of the y-intercept of the graph of f.', ['-8', '−8', 'y = -8', 'y=-8'], 1, 'knowledge'),
          partChoice('b', 'Find the values of x for which f(x) = 0.', ['x = ±4', 'x = ±2', 'x = 2 only', 'x = 8'], 1, 2, 'application'),
          partChoice('c', 'Hence, write down the coordinates of the vertex of the graph of f.', ['(0, −8)', '(2, 0)', '(−8, 0)', '(0, 2)'], 0, 1, 'communication'),
        ],
        explanation: '(a) f(0) = −8. (b) 2x² = 8 so x = ±2. (c) The parabola is symmetric about x = 0: vertex (0, −8).',
      }),
    },
    {
      objectiveCode: 'ibm.sequences',
      content: structured({
        key: 'ibm.p1.02',
        language: en,
        commandTerm: 'calculate',
        question: 'Consider the arithmetic sequence 3, 7, 11, …',
        parts: [
          partText('a', 'Write down the common difference.', ['4'], 1, 'knowledge', 0),
          partText('b', 'Calculate the sum of the first 10 terms.', ['210'], 2, 'application', 0),
          partChoice('c', 'Which formula did you use for the sum?', ['Sₙ = n/2 (2u₁ + (n − 1)d)', 'Sₙ = u₁ rⁿ', 'Sₙ = n(u₁ + d)', 'Sₙ = u₁ / (1 − r)'], 0, 1, 'communication'),
        ],
        explanation: 'd = 4; S₁₀ = 10/2 (6 + 36) = 210.',
      }),
    },
    {
      objectiveCode: 'ibm.applications',
      content: structured({
        key: 'ibm.p2.01',
        language: en,
        commandTerm: 'calculate',
        calculatorAllowed: true,
        question: 'A population of bacteria is modelled by P(t) = 500·e^(0.2t), where t is the time in hours.',
        parts: [
          partText('a', 'Write down the initial population.', ['500'], 1, 'knowledge', 0),
          partText('b', 'Calculate P(5), giving your answer to the nearest whole number.', ['1359'], 2, 'application', 1),
          partChoice('c', 'Explain what the value 0.2 represents in this context.', ['The initial population', 'The continuous growth rate per hour', 'The time in hours', 'The maximum population'], 1, 1, 'communication'),
        ],
        explanation: 'P(0) = 500; P(5) = 500e ≈ 1359; 0.2 is the continuous hourly growth rate.',
      }),
    },
    {
      objectiveCode: 'ibm.applications',
      content: structured({
        key: 'ibm.p2.02',
        language: en,
        commandTerm: 'calculate',
        calculatorAllowed: true,
        question: 'A right circular cone has base radius 3 cm and height 4 cm.',
        parts: [
          partText('a', 'Calculate the slant height of the cone.', ['5'], 1, 'knowledge', 0.01),
          partText('b', 'Calculate the volume of the cone, giving your answer correct to 3 significant figures.', ['37.7'], 2, 'application', 0.05),
          partChoice('c', 'Identify the appropriate unit for the volume.', ['cm', 'cm²', 'cm³', 'cm⁴'], 2, 1, 'communication'),
        ],
        explanation: 'Slant height √(9 + 16) = 5; V = (1/3)π·3²·4 = 12π ≈ 37.7 cm³.',
      }),
    },
  ],
};

export const IB_BIOLOGY_HL_DEV_CERT: ExamVerticalConfigInput = {
  key: 'dev-cert.ib.biology-hl',
  family: 'IB',
  contentStatus: 'DEV_CERT_FIXTURE',
  organization: { name: 'International Baccalaureate' },
  programme: { name: 'IB Diploma Programme', type: 'CURRICULUM' },
  subject: { name: 'Biology', level: 'HL' },
  definition: {
    name: 'IB Biology HL — certification (DEV)',
    purpose: 'DEV certification fixture: a second IB subject (multiple-choice paper) proving IB is configured per subject, not hard-coded.',
    domains: ['Molecular biology', 'Cell biology'],
  },
  version: {
    label: 'DEV-CERT v1',
    examYear: 2027,
    examSession: 'May (fixture)',
    delivery: { navigation: 'FREE_ORDER_WITHIN_SECTION', breaks: [], itemFeedback: 'NEVER', resultReview: 'SCORES_ONLY', permittedResources: [] },
  },
  scoring: {
    name: 'IB Biology HL DEV fixture -- raw',
    scoringType: 'BINARY',
    policy: { engine: 'exam-scoring-v1', strategy: 'RAW', transform: { type: 'NONE' }, unit: '%', provenance: FIXTURE_PROVENANCE },
  },
  structureLabel: 'DEV-CERT v1',
  commandTerms: IB_TERMS,
  sections: [
    {
      key: 'paper1',
      name: 'Paper 1 (multiple choice)',
      componentType: 'PAPER',
      subject: { name: 'Biology', level: 'HL' },
      durationMinutes: 10,
      objectives: [
        { code: 'ibb.molecular', description: 'Describe the roles of nucleic acids in protein synthesis.', targets: [{ questionType: 'multiple_choice', commandTerm: 'identify', count: 1 }] },
        { code: 'ibb.cells', description: 'Relate cell processes to organelles and cell division.', targets: [{ questionType: 'multiple_choice', commandTerm: 'identify', count: 1 }] },
      ],
    },
  ],
  items: [
    { objectiveCode: 'ibb.molecular', content: choice({ key: 'ibb.p1.01', language: en, commandTerm: 'identify', question: 'Which molecule carries amino acids to the ribosome during translation?', options: ['mRNA', 'tRNA', 'rRNA', 'DNA'], correct: 1, explanation: 'tRNA molecules carry specific amino acids to the ribosome.' }) },
    { objectiveCode: 'ibb.cells', content: choice({ key: 'ibb.p1.02', language: en, commandTerm: 'identify', question: 'Where in a eukaryotic cell does the Krebs cycle take place?', options: ['Cytoplasm', 'Chloroplast stroma', 'Mitochondrial matrix', 'Nucleus'], correct: 2, explanation: 'The Krebs cycle occurs in the mitochondrial matrix.' }) },
    { objectiveCode: 'ibb.cells', content: choice({ key: 'ibb.p1.03', language: en, commandTerm: 'identify', question: 'Which process produces genetically different haploid cells?', options: ['Mitosis', 'Meiosis', 'Binary fission', 'Translation'], correct: 1, explanation: 'Meiosis halves the chromosome number and introduces variation.' }) },
  ],
};
