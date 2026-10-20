/**
 * Exam V2 reference vertical -- IB DP Visual Arts (new course, first
 * assessment May 2027). PortfolioPerformanceAssessment: every component is
 * a multimodal SUBMISSION (images / PDF pages / statement / process evidence)
 * assessed by the double assessor with vision, never a timed paper.
 *
 * STRUCTURE (sources: ibo-visual-arts-brief-2027, ibo-visual-arts-updates):
 *   SL  Art-making inquiries portfolio  32 marks  40%  external  (≤15 screens, ≤3000 words)
 *       Connections study               24 marks  20%  external  (≤10 screens, ≤2500 words)  SL only
 *       Resolved artworks               32 marks  40%  internal  (5 artworks, rationale ≤700 words)
 *   HL  Art-making inquiries portfolio  32 marks  30%  external
 *       Artist project                  40 marks  30%  external  (≤12 screens, ≤2500 words, video ≤3 min, intentions ≤100 words)
 *       Selected resolved artworks      40 marks  40%  internal  (5 of ≥8 works, ≤8 screens, rationale ≤700 words)
 *
 * The official criterion descriptors are NOT public. The rubrics here are
 * StudyUS practice rubrics whose totals equal the official component marks,
 * labelled as such; they are never presented as IB criteria. The practice
 * tasks are smaller than the official submissions (fewer screens / words)
 * and say so.
 */
import type { ExamVerticalConfigInput } from '../../vertical-config';
import { FIXTURE_PROVENANCE } from '../fixture-builders';
import { levels, portfolioItem } from './builders';

const en = 'en';
const SOURCES = ['ibo-visual-arts-brief-2027', 'ibo-visual-arts-updates'];
const PRACTICE_RUBRIC_NOTE = 'StudyUS practice rubric (not the IB assessment criteria, which are not public). Totals match the official component marks.';
const UNTIMED = { allowedTimingModes: ['UNTIMED' as const], allowedSimulationTypes: ['FULL_MOCK' as const, 'TOPIC_EXAM' as const] };

const aipRubric = {
  kind: 'BEST_FIT' as const,
  guidance: `${PRACTICE_RUBRIC_NOTE} Judge the submission as a whole first, then place it in each criterion.`,
  disagreementThreshold: 4,
  minConfidence: 0.6,
  criteria: [
    { id: 'A', name: 'Inquiry: a focused artistic question and its investigation', maxMarks: 8, descriptors: levels(8, ['A question is named but barely investigated.', 'The question is investigated with some relevant sources.', 'A clear question drives a sustained, relevant investigation.', 'A focused, personal question drives a thorough, purposeful investigation.']) },
    { id: 'B', name: 'Experimentation with media, techniques and processes', maxMarks: 8, descriptors: levels(8, ['Little experimentation; one medium used superficially.', 'Some experimentation with limited development.', 'Purposeful experimentation that develops skills and ideas.', 'Sustained, inventive experimentation that clearly moves the work forward.']) },
    { id: 'C', name: 'Reflection and evaluation of the process', maxMarks: 8, descriptors: levels(8, ['Description without reflection.', 'Some reflection, mostly descriptive.', 'Reflection explains decisions and evaluates outcomes.', 'Insightful, critical reflection that informs next steps.']) },
    { id: 'D', name: 'Communication: selection, layout and clarity of the screens', maxMarks: 8, descriptors: levels(8, ['Screens are disorganized or hard to follow.', 'Screens are mostly clear with some organization.', 'Screens are well selected and clearly organized.', 'Screens are purposefully curated and communicate the inquiry very effectively.']) },
  ],
};

const connectionsRubric = {
  kind: 'ANALYTIC' as const,
  guidance: PRACTICE_RUBRIC_NOTE,
  disagreementThreshold: 3,
  minConfidence: 0.6,
  criteria: [
    { id: 'A', name: 'Analysis of the two artworks in context', maxMarks: 8, descriptors: levels(8, ['Mostly descriptive.', 'Some analysis of form and context.', 'Clear analysis of form, function and context.', 'Perceptive, well-supported analysis of form, function and context.']) },
    { id: 'B', name: 'Connections between the artworks and to own practice', maxMarks: 8, descriptors: levels(8, ['Connections are asserted, not shown.', 'Some relevant connections.', 'Well-explained connections, including to own work.', 'Insightful connections that inform own practice.']) },
    { id: 'C', name: 'Communication, terminology and referencing', maxMarks: 8, descriptors: levels(8, ['Little subject terminology; no references.', 'Some terminology; inconsistent references.', 'Accurate terminology and references.', 'Precise terminology, clear structure and complete references.']) },
  ],
};

function resolvedRubric(max: 32 | 40) {
  const each = max / 4;
  return {
    kind: 'BEST_FIT' as const,
    guidance: PRACTICE_RUBRIC_NOTE,
    disagreementThreshold: max === 40 ? 5 : 4,
    minConfidence: 0.6,
    criteria: [
      { id: 'A', name: 'Technical competence and use of materials', maxMarks: each, descriptors: levels(each, ['Limited control of materials.', 'Adequate control with some inconsistencies.', 'Good control appropriate to the intentions.', 'Assured, sophisticated control of materials.']) },
      { id: 'B', name: 'Formal qualities and composition', maxMarks: each, descriptors: levels(each, ['Composition is weak or accidental.', 'Some effective formal decisions.', 'Formal qualities support the work.', 'Formal qualities are refined and purposeful.']) },
      { id: 'C', name: 'Meaning and realization of intentions', maxMarks: each, descriptors: levels(each, ['Intentions are unclear.', 'Intentions are partly realized.', 'Intentions are clearly realized.', 'Intentions are realized with depth and originality.']) },
      { id: 'D', name: 'Curatorial rationale and coherence of the selection', maxMarks: each, descriptors: levels(each, ['Rationale missing or unrelated.', 'Rationale describes the works.', 'Rationale explains selection and arrangement.', 'Rationale is coherent, reflective and well argued.']) },
    ],
  };
}

const artistProjectRubric = {
  kind: 'BEST_FIT' as const,
  guidance: PRACTICE_RUBRIC_NOTE,
  disagreementThreshold: 5,
  minConfidence: 0.6,
  criteria: [
    { id: 'A', name: 'Intentions and project planning', maxMarks: 10, descriptors: levels(10, ['Intentions vague.', 'Intentions stated; plan partial.', 'Clear intentions and a workable plan.', 'Ambitious, precise intentions with a well-reasoned plan.']) },
    { id: 'B', name: 'Development through research and experimentation', maxMarks: 10, descriptors: levels(10, ['Little development.', 'Some development.', 'Purposeful development.', 'Sustained, insightful development.']) },
    { id: 'C', name: 'Realization of the project', maxMarks: 10, descriptors: levels(10, ['Barely realized.', 'Partly realized.', 'Realized with skill.', 'Realized with skill and originality.']) },
    { id: 'D', name: 'Reflection and communication', maxMarks: 10, descriptors: levels(10, ['Little reflection.', 'Some reflection.', 'Clear evaluative reflection.', 'Critical reflection, clearly communicated.']) },
  ],
};

const aipTasks = (prefix: string) => [
  portfolioItem({
    key: `${prefix}.aip.light`, language: en, difficulty: 3, difficultyIndex: 1.0,
    tags: { assessmentObjective: 'AO1-AO4', responseFormat: 'portfolio' },
    question: 'Practice inquiry — "How can light change the meaning of an everyday object?" Develop one art-making inquiry from this question: investigate artists and sources, experiment with at least two media, and reflect on your decisions. Submit 3–6 screens (images or PDF pages) and a short statement (max 300 words).',
    explanation: 'Practice task in the format of the Art-making inquiries portfolio (smaller than the official ≤15 screens / ≤3000 words).',
    portfolio: { componentKind: 'PROCESS_PORTFOLIO', statementRequired: true, statementMaxWords: 300, requiredArtifacts: [{ kind: 'PORTFOLIO_PAGE', min: 3, max: 6, label: 'Inquiry screens (image or PDF page)' }], rubric: aipRubric },
  }),
  portfolioItem({
    key: `${prefix}.aip.place`, language: en, difficulty: 3, difficultyIndex: 1.0,
    tags: { assessmentObjective: 'AO1-AO4', responseFormat: 'portfolio' },
    question: 'Practice inquiry — "What does a place remember?" Investigate a place that matters to you through observation, research and experimentation with at least two techniques. Submit 3–6 screens and a short statement (max 300 words).',
    explanation: 'Practice task in the format of the Art-making inquiries portfolio (reduced size).',
    portfolio: { componentKind: 'PROCESS_PORTFOLIO', statementRequired: true, statementMaxWords: 300, requiredArtifacts: [{ kind: 'PORTFOLIO_PAGE', min: 3, max: 6, label: 'Inquiry screens (image or PDF page)' }], rubric: aipRubric },
  }),
];

const resolvedTasks = (prefix: string, max: 32 | 40) => [
  portfolioItem({
    key: `${prefix}.resolved.series`, language: en, difficulty: 3, difficultyIndex: 1.0,
    tags: { assessmentObjective: 'AO3-AO4', responseFormat: 'portfolio' },
    question: 'Practice selection — Choose 2–5 of your resolved artworks that belong together. Upload a photograph of each and write a curatorial rationale (max 300 words) explaining the selection, the arrangement and what the works mean together.',
    explanation: 'Practice task in the format of the resolved artworks component (reduced size).',
    portfolio: { componentKind: 'EXHIBITION', statementRequired: true, statementMaxWords: 300, requiredArtifacts: [{ kind: 'IMAGE', min: 2, max: 5, label: 'Resolved artwork (photograph)' }], rubric: resolvedRubric(max) },
  }),
  portfolioItem({
    key: `${prefix}.resolved.dialogue`, language: en, difficulty: 3, difficultyIndex: 1.0,
    tags: { assessmentObjective: 'AO3-AO4', responseFormat: 'portfolio' },
    question: 'Practice selection — Present 2–5 resolved artworks that show a dialogue between two ideas or materials. Upload a photograph of each and a rationale (max 300 words).',
    explanation: 'Practice task in the format of the resolved artworks component (reduced size).',
    portfolio: { componentKind: 'EXHIBITION', statementRequired: true, statementMaxWords: 300, requiredArtifacts: [{ kind: 'IMAGE', min: 2, max: 5, label: 'Resolved artwork (photograph)' }], rubric: resolvedRubric(max) },
  }),
];

function base(level: 'SL' | 'HL') {
  return {
    family: 'IB' as const,
    contentStatus: 'DEV_CERT_FIXTURE' as const,
    organization: { name: 'International Baccalaureate' },
    programme: { name: 'IB Diploma Programme', type: 'CURRICULUM' as const },
    subject: { name: 'Visual arts', level },
    definition: {
      name: `IB Visual arts ${level} (first assessment 2027)`,
      purpose: 'Portfolio practice in the official component structure. StudyUS practice rubrics (IB criteria are not public); never official IB assessment.',
      domains: ['Art-making', 'Inquiry', 'Communication'],
    },
    version: {
      label: 'V2 2027',
      examYear: 2027,
      examSession: 'May',
      supportedModalities: ['DIGITAL'],
      delivery: { navigation: 'FREE_ORDER_WITHIN_SECTION' as const, breaks: [], itemFeedback: 'NEVER' as const, resultReview: 'FULL' as const, permittedResources: ['Own sketchbooks and process materials'], ...UNTIMED },
    },
    framework: {
      frameworkKey: 'ib-dp-visual-arts',
      curriculumVersion: 'Visual arts (first assessment 2027)',
      firstAssessment: 2027,
      lastAssessment: null,
      syllabusCode: null,
      frameworkVersion: '2027',
      sourceKeys: SOURCES,
    },
    scoring: { name: `IB Visual arts ${level} practice -- rubric marks`, scoringType: 'RUBRIC' as const, policy: { engine: 'exam-scoring-v1' as const, strategy: 'RAW' as const, transform: { type: 'NONE' as const }, unit: '%', provenance: FIXTURE_PROVENANCE } },
    structureLabel: 'V2 2027',
    commandTerms: [],
  };
}

const aipDefinition = (weight: number) => ({
  officialName: 'Art-making inquiries portfolio',
  kind: 'PORTFOLIO' as const,
  assessment: 'EXTERNAL' as const,
  officialDurationMinutes: null,
  maxMarks: 32,
  weightingPercent: weight,
  calculatorPolicy: null,
  responseFormats: ['MULTIMODAL_SUBMISSION' as const],
  submissionLimits: ['Up to 15 screens', 'Up to 3000 words'],
  limitations: [PRACTICE_RUBRIC_NOTE, 'Practice tasks ask for 3-6 screens and a 300-word statement.', 'Audio and video are not assessed by AI: such criteria go to human review.'],
  sourceKeys: SOURCES,
});

export const IB_VISUAL_ARTS_SL_V2: ExamVerticalConfigInput = {
  key: 'v2.ib.visual-arts-sl',
  ...base('SL'),
  sections: [
    {
      key: 'aip', name: 'Art-making inquiries portfolio', componentType: 'COURSEWORK', subject: { name: 'Visual arts', level: 'SL' },
      definition: aipDefinition(40),
      objectives: [{ code: 'vasl.aip', description: 'Investigate an artistic question through research, experimentation and reflection.', targets: [{ count: 1 }] }],
    },
    {
      key: 'connections', name: 'Connections study', componentType: 'COURSEWORK', subject: { name: 'Visual arts', level: 'SL' },
      definition: {
        officialName: 'Connections study', kind: 'PORTFOLIO', assessment: 'EXTERNAL', officialDurationMinutes: null, maxMarks: 24, weightingPercent: 20, calculatorPolicy: null,
        responseFormats: ['MULTIMODAL_SUBMISSION'], submissionLimits: ['Up to 10 screens', 'Up to 2500 words', 'SL only'],
        limitations: [PRACTICE_RUBRIC_NOTE, 'Practice task asks for up to 4 screens and 600 words.'], sourceKeys: SOURCES,
      },
      objectives: [{ code: 'vasl.connections', description: 'Analyse and connect artworks from different contexts and relate them to own practice.', targets: [{ count: 1 }] }],
    },
    {
      key: 'resolved', name: 'Resolved artworks', componentType: 'COURSEWORK', subject: { name: 'Visual arts', level: 'SL' },
      definition: {
        officialName: 'Resolved artworks', kind: 'PORTFOLIO', assessment: 'INTERNAL', officialDurationMinutes: null, maxMarks: 32, weightingPercent: 40, calculatorPolicy: null,
        responseFormats: ['MULTIMODAL_SUBMISSION'], submissionLimits: ['5 resolved artworks', 'Rationale up to 700 words'],
        limitations: [PRACTICE_RUBRIC_NOTE, 'Practice task asks for 2-5 works and a 300-word rationale.'], sourceKeys: SOURCES,
      },
      objectives: [{ code: 'vasl.resolved', description: 'Present resolved artworks with a coherent curatorial rationale.', targets: [{ count: 1 }] }],
    },
  ],
  items: [
    ...aipTasks('vasl').map((content) => ({ objectiveCode: 'vasl.aip', content })),
    {
      objectiveCode: 'vasl.connections',
      content: portfolioItem({
        key: 'vasl.connections.portraits', language: en, difficulty: 3, difficultyIndex: 1.0,
        tags: { assessmentObjective: 'AO1-AO2', responseFormat: 'portfolio' },
        question: 'Practice connections study — Choose two portraits from different cultures or periods. Analyse how each communicates identity (form, function, context), connect them to each other and to one of your own works. Submit up to 4 screens with images and annotations, and a text of max 600 words with references.',
        explanation: 'Practice task in the format of the Connections study (reduced size).',
        portfolio: { componentKind: 'COMPARATIVE_STUDY', statementRequired: true, statementMaxWords: 600, requiredArtifacts: [{ kind: 'PORTFOLIO_PAGE', min: 1, max: 4, label: 'Screens with images and annotations' }, { kind: 'BIBLIOGRAPHY', min: 0, max: 1, label: 'References' }], rubric: connectionsRubric },
      }),
    },
    {
      objectiveCode: 'vasl.connections',
      content: portfolioItem({
        key: 'vasl.connections.landscape', language: en, difficulty: 3, difficultyIndex: 1.0,
        tags: { assessmentObjective: 'AO1-AO2', responseFormat: 'portfolio' },
        question: 'Practice connections study — Compare two artworks that represent landscape in very different ways. Analyse each in its context, explain the connections and relate them to your own practice. Up to 4 screens and max 600 words with references.',
        explanation: 'Practice task in the format of the Connections study (reduced size).',
        portfolio: { componentKind: 'COMPARATIVE_STUDY', statementRequired: true, statementMaxWords: 600, requiredArtifacts: [{ kind: 'PORTFOLIO_PAGE', min: 1, max: 4, label: 'Screens with images and annotations' }, { kind: 'BIBLIOGRAPHY', min: 0, max: 1, label: 'References' }], rubric: connectionsRubric },
      }),
    },
    ...resolvedTasks('vasl', 32).map((content) => ({ objectiveCode: 'vasl.resolved', content })),
  ],
};

export const IB_VISUAL_ARTS_HL_V2: ExamVerticalConfigInput = {
  key: 'v2.ib.visual-arts-hl',
  ...base('HL'),
  sections: [
    {
      key: 'aip', name: 'Art-making inquiries portfolio', componentType: 'COURSEWORK', subject: { name: 'Visual arts', level: 'HL' },
      definition: aipDefinition(30),
      objectives: [{ code: 'vahl.aip', description: 'Investigate an artistic question through research, experimentation and reflection.', targets: [{ count: 1 }] }],
    },
    {
      key: 'project', name: 'Artist project', componentType: 'COURSEWORK', subject: { name: 'Visual arts', level: 'HL' },
      definition: {
        officialName: 'Artist project', kind: 'PROJECT', assessment: 'EXTERNAL', officialDurationMinutes: null, maxMarks: 40, weightingPercent: 30, calculatorPolicy: null,
        responseFormats: ['MULTIMODAL_SUBMISSION'], submissionLimits: ['Up to 12 screens', 'Up to 2500 words', 'Video up to 3 minutes', 'Intentions up to 100 words'],
        limitations: [PRACTICE_RUBRIC_NOTE, 'Video is stored for human review; AI assesses images and text only.'], sourceKeys: SOURCES,
      },
      objectives: [{ code: 'vahl.project', description: 'Plan, develop and realize an independent artist project with stated intentions.', targets: [{ count: 1 }] }],
    },
    {
      key: 'resolved', name: 'Selected resolved artworks', componentType: 'COURSEWORK', subject: { name: 'Visual arts', level: 'HL' },
      definition: {
        officialName: 'Selected resolved artworks', kind: 'PORTFOLIO', assessment: 'INTERNAL', officialDurationMinutes: null, maxMarks: 40, weightingPercent: 40, calculatorPolicy: null,
        responseFormats: ['MULTIMODAL_SUBMISSION'], submissionLimits: ['5 of at least 8 resolved works', 'Up to 8 screens', 'Rationale up to 700 words', 'Artwork texts up to 1000 words'],
        limitations: [PRACTICE_RUBRIC_NOTE, 'Practice task asks for 2-5 works and a 300-word rationale.'], sourceKeys: SOURCES,
      },
      objectives: [{ code: 'vahl.resolved', description: 'Select and present resolved artworks with a coherent curatorial rationale.', targets: [{ count: 1 }] }],
    },
  ],
  items: [
    ...aipTasks('vahl').map((content) => ({ objectiveCode: 'vahl.aip', content })),
    {
      objectiveCode: 'vahl.project',
      content: portfolioItem({
        key: 'vahl.project.public', language: en, difficulty: 4, difficultyIndex: 1.05,
        tags: { assessmentObjective: 'AO1-AO4', responseFormat: 'portfolio' },
        question: 'Practice artist project — Propose and develop a small artwork for a public space in your school. State your intentions (max 100 words), document research and development, and show the realized work. Submit 3–8 screens and a reflection (max 400 words). A video (max 3 min) may be added; it goes to human review.',
        explanation: 'Practice task in the format of the Artist project (reduced size).',
        portfolio: { componentKind: 'PROJECT', statementRequired: true, statementMaxWords: 400, requiredArtifacts: [{ kind: 'PORTFOLIO_PAGE', min: 3, max: 8, label: 'Project screens' }, { kind: 'VIDEO', min: 0, max: 1, label: 'Optional video (human review)' }], rubric: artistProjectRubric },
      }),
    },
    {
      objectiveCode: 'vahl.project',
      content: portfolioItem({
        key: 'vahl.project.archive', language: en, difficulty: 4, difficultyIndex: 1.05,
        tags: { assessmentObjective: 'AO1-AO4', responseFormat: 'portfolio' },
        question: 'Practice artist project — Create a work that responds to a family or community archive (photographs, letters, objects). State your intentions (max 100 words), document development and present the outcome. Submit 3–8 screens and a reflection (max 400 words).',
        explanation: 'Practice task in the format of the Artist project (reduced size).',
        portfolio: { componentKind: 'PROJECT', statementRequired: true, statementMaxWords: 400, requiredArtifacts: [{ kind: 'PORTFOLIO_PAGE', min: 3, max: 8, label: 'Project screens' }], rubric: artistProjectRubric },
      }),
    },
    ...resolvedTasks('vahl', 40).map((content) => ({ objectiveCode: 'vahl.resolved', content })),
  ],
};
