/**
 * Exam V2 reference vertical -- Cambridge International AS & A Level Mathematics 9709, Paper 1 Pure Mathematics 1.
 *
 * STRUCTURE (source: cie-9709-syllabus-2026-2027, Version 4; extract with locators and document digest in
 * docs/exams/sources/cambridge-9709/CIE_9709_2026_2027_SOURCE_EXTRACT.json):
 *   Paper 1 Pure Mathematics 1   1 h 50 min   75 marks   10 to 12 structured questions   written, externally assessed
 *   scientific calculator expected; graphic / symbolic calculators not permitted
 *   subject content 1.1 Quadratics ... 1.8 Integration (printed pages 19-22): the OFFICIAL sections are the objectives
 *   command words: the syllabus's own table (section 4, p. 42)
 *
 * This is the CAMBRIDGE system's configuration of 9709 (programme Cambridge International AS & A Level). It is NOT
 * the AICE reference vertical (v2.aice.9709-as): no AICE equivalence is claimed or inferred here.
 * Only Paper 1 is configured (pilot scope). No fixture items: delivery is from the certified Exam Bank only.
 */
import type { ExamVerticalConfigInput } from '../../vertical-config';
import { FIXTURE_PROVENANCE } from '../fixture-builders';

const SOURCES = ['cie-9709-syllabus-2026-2027'];
/** The syllabus's command-word table (the same words the CAMBRIDGE.9709.P1 adapter governs). */
const TERMS = [
  { term: 'calculate', expectedReasoningType: 'PROCEDURAL' },
  { term: 'describe', expectedReasoningType: 'CONCEPTUAL' },
  { term: 'determine', expectedReasoningType: 'PROCEDURAL' },
  { term: 'evaluate', expectedReasoningType: 'PROCEDURAL' },
  { term: 'explain', expectedReasoningType: 'CONCEPTUAL' },
  { term: 'identify', expectedReasoningType: 'FACTUAL' },
  { term: 'justify', expectedReasoningType: 'CONCEPTUAL' },
  { term: 'show that', expectedReasoningType: 'CONCEPTUAL' },
  { term: 'sketch', expectedReasoningType: 'CONCEPTUAL' },
  { term: 'state', expectedReasoningType: 'FACTUAL' },
  { term: 'verify', expectedReasoningType: 'CONCEPTUAL' },
];
const AOS = [
  { code: 'AO1', label: 'Knowledge and understanding', weightPercent: '55' },
  { code: 'AO2', label: 'Application and communication', weightPercent: '45' },
];

/** The eight official Paper 1 sections (syllabus 3 > 1 Pure Mathematics 1), as objectives of the configuration. */
export const CIE_9709_P1_SECTIONS = [
  { section: '1.1', title: 'Quadratics', code: 'cie.9709.p1.quadratics', page: 19, term: 'determine' },
  { section: '1.2', title: 'Functions', code: 'cie.9709.p1.functions', page: 19, term: 'determine' },
  { section: '1.3', title: 'Coordinate geometry', code: 'cie.9709.p1.coordinate-geometry', page: 20, term: 'calculate' },
  { section: '1.4', title: 'Circular measure', code: 'cie.9709.p1.circular-measure', page: 20, term: 'calculate' },
  { section: '1.5', title: 'Trigonometry', code: 'cie.9709.p1.trigonometry', page: 21, term: 'determine' },
  { section: '1.6', title: 'Series', code: 'cie.9709.p1.series', page: 21, term: 'calculate' },
  { section: '1.7', title: 'Differentiation', code: 'cie.9709.p1.differentiation', page: 22, term: 'calculate' },
  { section: '1.8', title: 'Integration', code: 'cie.9709.p1.integration', page: 22, term: 'evaluate' },
] as const;

/**
 * Configurations supplied ONLY by deterministic certified Exam Bank content: no V5 generation profile targets them
 * (no provider is ever called for their questions), so the V5 generation factory's scope does not include them.
 */
export const DETERMINISTIC_BANK_ONLY_CONFIG_KEYS: readonly string[] = ['v2.cambridge.9709-as'];

export const CAMBRIDGE_9709_AS_V2: ExamVerticalConfigInput = {
  key: 'v2.cambridge.9709-as',
  family: 'CAMBRIDGE',
  contentStatus: 'DEV_CERT_FIXTURE',
  // positions are filled from the certified Exam Bank only (no fixture item is configured)
  bankSource: 'QUESTION_BANK',
  organization: { name: 'Cambridge International Education' },
  programme: { name: 'Cambridge International AS & A Level', type: 'CURRICULUM' },
  qualification: { name: 'Cambridge International AS Level' },
  subject: { name: 'Mathematics (9709)', level: 'AS Level' },
  definition: {
    name: 'Cambridge International AS & A Level Mathematics 9709 — Paper 1 Pure Mathematics 1',
    purpose: 'Practice in the official 9709 Paper 1 structure (syllabus 2026-2027). Original StudyUS items from the certified Exam Bank; not Cambridge questions or mark schemes.',
    domains: CIE_9709_P1_SECTIONS.map((s) => `${s.section} ${s.title}`),
  },
  version: {
    label: 'V2 9709 2026-2027 P1',
    examYear: 2026,
    examSession: 'March / June / November',
    supportedModalities: ['PAPER'],
    delivery: { navigation: 'FREE_ORDER_WITHIN_SECTION', breaks: [], itemFeedback: 'AUTO', resultReview: 'FULL', permittedResources: ['Scientific calculator'] },
  },
  framework: { frameworkKey: 'cie-9709', curriculumVersion: '9709 syllabus 2026-2027 (Version 4)', firstAssessment: 2026, lastAssessment: 2027, syllabusCode: '9709', frameworkVersion: 'v4', sourceKeys: SOURCES },
  scoring: { name: 'Cambridge 9709 Paper 1 practice -- marks (no official grade without published thresholds)', scoringType: 'MARK_SCHEME', policy: { engine: 'exam-scoring-v1', strategy: 'RAW', transform: { type: 'NONE' }, unit: 'marks', provenance: FIXTURE_PROVENANCE } },
  structureLabel: 'V2 9709 2026-2027 P1',
  commandTerms: TERMS,
  sections: [
    {
      key: 'p1', name: 'Paper 1 — Pure Mathematics 1', componentType: 'PAPER', subject: { name: 'Mathematics (9709)', level: 'AS Level' },
      durationMinutes: 35, toolRules: { calculator: 'scientific' }, targetDifficultyIndex: 1.0,
      definition: {
        officialName: 'Paper 1 Pure Mathematics 1', componentCode: '1', kind: 'WRITTEN_PAPER', assessment: 'EXTERNAL', officialDurationMinutes: 110, maxMarks: 75, weightingPercent: 60, calculatorPolicy: 'SCIENTIFIC_REQUIRED',
        responseFormats: ['MATH_EXPRESSION', 'SHORT_RESPONSE', 'EXTENDED_RESPONSE'], assessmentObjectives: AOS, commandTerms: TERMS.map((x) => x.term),
        limitations: ['StudyUS delivers a reduced pilot form: one certified position per official section (8 of the paper\'s 10 to 12 structured questions), at about the official pace per mark.', 'Answer-marked short responses only; method-marked structured questions are not yet in the certified supply.'],
        sourceKeys: SOURCES,
      },
      objectives: CIE_9709_P1_SECTIONS.map((s) => ({ code: s.code, description: `Pure 1 · ${s.section} ${s.title} (syllabus 9709 2026-2027, p. ${s.page}).`, targets: [{ commandTerm: s.term, count: 1 }] })),
    },
  ],
  items: [],
};
