/**
 * PISA -- DEV certification fixture configuration.
 *
 * PISA is an assessment FRAMEWORK, not a school-subject exam: domains are
 * sections, items are grouped in units around a shared stimulus (context),
 * and the result is reported as a band, never as an individual high-stakes
 * score.
 *
 * ENGINE_SUPPORT: reading / mathematics / science domains, stimulus-based
 * units kept together on delivery, free order inside a domain, multi-select
 * and numeric items, band reporting through a configured transformation.
 * OFFICIAL_CONTENT_COVERAGE: NONE -- units, bands and cut points are
 * illustrative DEV fixtures, not OECD proficiency levels.
 */
import type { ExamVerticalConfigInput } from '../vertical-config';
import { choice, multiSelect, numeric, FIXTURE_PROVENANCE } from './fixture-builders';

const en = 'en';
const GARDEN = {
  key: 'pisa.read.garden',
  title: 'Community garden notice',
  text:
    'The Riverside Community Garden opens on 1 April. Plots are free for residents, but each gardener must volunteer two hours per month to maintain the shared paths. ' +
    'Tools are stored in the green shed, which is locked at 8 p.m. Gardeners who do not use their plot for two months will lose it to the next person on the waiting list.',
};
const PLANS = {
  key: 'pisa.math.plans',
  title: 'Mobile data plans',
  text: 'Plan A costs 10 zeds per month and includes 5 GB of data. Plan B costs 4 zeds per month plus 1.5 zeds for each GB used.',
};
const GREENHOUSE = {
  key: 'pisa.sci.greenhouse',
  title: 'Greenhouse experiment',
  text:
    'A student grows identical bean plants in two greenhouses. Greenhouse 1 is kept at 20 °C and Greenhouse 2 at 30 °C. Both receive the same amount of water and light. ' +
    'After three weeks, the plants in Greenhouse 2 are taller on average.',
};

export const PISA_DEV_CERT: ExamVerticalConfigInput = {
  key: 'dev-cert.pisa',
  family: 'PISA',
  contentStatus: 'DEV_CERT_FIXTURE',
  organization: { name: 'OECD' },
  programme: { name: 'PISA', type: 'ASSESSMENT_FRAMEWORK' },
  definition: {
    name: 'PISA-style practice — certification (DEV)',
    purpose: 'DEV certification fixture for the PISA vertical -- original units; illustrative bands, not OECD proficiency levels; no individual high-stakes score.',
    domains: ['Reading', 'Mathematics', 'Science'],
  },
  version: {
    label: 'DEV-CERT v1',
    examYear: 2027,
    supportedModalities: ['DIGITAL'],
    delivery: {
      navigation: 'FREE_ORDER_WITHIN_SECTION',
      breaks: [],
      itemFeedback: 'NEVER',
      resultReview: 'FULL',
      allowedSimulationTypes: ['DOMAIN_EXAM', 'MINI_MOCK', 'FULL_MOCK'],
      permittedResources: ['On-screen calculator (mathematics)'],
    },
  },
  scoring: {
    name: 'PISA DEV fixture -- raw fraction to illustrative bands',
    scoringType: 'PARTIAL_CREDIT',
    policy: {
      engine: 'exam-scoring-v1',
      strategy: 'RAW',
      transform: {
        type: 'BANDS',
        bands: [
          { minFraction: 0, label: 'Band 1 (illustrative)' },
          { minFraction: 0.4, label: 'Band 2 (illustrative)' },
          { minFraction: 0.65, label: 'Band 3 (illustrative)' },
          { minFraction: 0.85, label: 'Band 4 (illustrative)' },
        ],
      },
      provenance: FIXTURE_PROVENANCE,
    },
  },
  structureLabel: 'DEV-CERT v1',
  sections: [
    {
      key: 'reading',
      name: 'Reading',
      componentType: 'SECTION',
      durationMinutes: 12,
      objectives: [
        { code: 'pisa.read.locate', description: 'Locate and retrieve information in a continuous text.', targets: [{ questionType: 'multiple_choice', count: 2 }] },
        { code: 'pisa.read.reflect', description: 'Evaluate which statements a text supports.', targets: [{ questionType: 'multi_select', count: 1 }] },
      ],
    },
    {
      key: 'mathematics',
      name: 'Mathematics',
      componentType: 'SECTION',
      durationMinutes: 12,
      toolRules: { calculator: 'on-screen' },
      objectives: [
        { code: 'pisa.math.formulate', description: 'Formulate a real-world situation mathematically to compare options.', targets: [{ questionType: 'multiple_choice', count: 2 }] },
        { code: 'pisa.math.employ', description: 'Employ a linear model to find an equality point.', targets: [{ questionType: 'numeric_problem', count: 1 }] },
      ],
    },
    {
      key: 'science',
      name: 'Science',
      componentType: 'SECTION',
      durationMinutes: 12,
      objectives: [{ code: 'pisa.sci.inquiry', description: 'Evaluate and design scientific enquiry (variables and controls).', targets: [{ questionType: 'multiple_choice', count: 2 }] }],
    },
  ],
  items: [
    { objectiveCode: 'pisa.read.locate', content: choice({ key: 'pisa.read.01', language: en, stimulus: GARDEN, question: 'What must gardeners do in exchange for a free plot?', options: ['Pay a monthly fee', 'Volunteer two hours per month', 'Lock the shed every night', 'Join the waiting list'], correct: 1, explanation: 'The notice says each gardener must volunteer two hours per month.', difficulty: 2 }) },
    { objectiveCode: 'pisa.read.locate', content: choice({ key: 'pisa.read.02', language: en, stimulus: GARDEN, question: 'Why might a gardener lose their plot?', options: ['They arrive after 8 p.m.', 'They do not use it for two months.', 'They use tools from the green shed.', 'They live in Riverside.'], correct: 1, explanation: 'Plots unused for two months go to the next person on the waiting list.' }) },
    { objectiveCode: 'pisa.read.reflect', content: multiSelect({ key: 'pisa.read.03', language: en, stimulus: GARDEN, question: 'Which statements are supported by the notice? Select all that apply.', options: ['The garden opens in April.', 'Tools are kept in the green shed.', 'Plots cost money for residents.', 'There is a waiting list.'], correct: [0, 1, 3], explanation: 'Plots are free for residents; the other three statements are stated in the notice.', marks: 2 }) },
    { objectiveCode: 'pisa.math.formulate', content: choice({ key: 'pisa.math.01', language: en, stimulus: PLANS, question: 'Maria uses 3 GB per month. Which plan is cheaper for her?', options: ['Plan A', 'Plan B', 'Both cost the same', 'It cannot be determined'], correct: 1, explanation: 'Plan B: 4 + 3 × 1.5 = 8.5 zeds, less than 10.' }) },
    { objectiveCode: 'pisa.math.formulate', content: choice({ key: 'pisa.math.03', language: en, stimulus: PLANS, question: 'How much does Plan B cost for 6 GB?', options: ['9 zeds', '10 zeds', '13 zeds', '15 zeds'], correct: 2, explanation: '4 + 6 × 1.5 = 13 zeds.' }) },
    { objectiveCode: 'pisa.math.employ', content: numeric({ key: 'pisa.math.02', language: en, stimulus: PLANS, question: 'For how many GB per month do both plans cost the same? Give a number.', answers: ['4'], tolerance: 0.01, explanation: '4 + 1.5g = 10, so g = 4 (within Plan A’s 5 GB).', difficulty: 4 }) },
    { objectiveCode: 'pisa.sci.inquiry', content: choice({ key: 'pisa.sci.01', language: en, stimulus: GREENHOUSE, question: 'Which variable did the student change on purpose?', options: ['Amount of water', 'Temperature', 'Amount of light', 'Type of plant'], correct: 1, explanation: 'Only the temperature differs between the greenhouses.', difficulty: 2 }) },
    { objectiveCode: 'pisa.sci.inquiry', content: choice({ key: 'pisa.sci.02', language: en, stimulus: GREENHOUSE, question: 'Why did the student give both greenhouses the same water and light?', options: ['To make the plants grow faster', 'So that a difference can be linked to temperature', 'Because beans need no light', 'To save water'], correct: 1, explanation: 'Controlling other variables isolates the effect of temperature.' }) },
    { objectiveCode: 'pisa.sci.inquiry', content: choice({ key: 'pisa.sci.03', language: en, stimulus: GREENHOUSE, question: 'Which conclusion is best supported by this experiment?', options: ['Temperature always increases plant height.', 'In this experiment, the warmer greenhouse produced taller plants on average.', 'Water has no effect on plants.', 'Light is not needed for growth.'], correct: 1, explanation: 'The result supports a conclusion limited to these conditions.', difficulty: 4 }) },
  ],
};
