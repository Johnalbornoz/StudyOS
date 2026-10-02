/**
 * Exam V2 -- IB DP Mathematics: AA SL and AI SL / HL (current courses,
 * first assessment 2021, last assessment 2028). Structure per level from the
 * sourced IB data (ib-dp.generated.ts):
 *   AA SL: P1 no calculator, P2 GDC (90 min, 80 marks, 40 % each)
 *   AI SL: P1 and P2, GDC on both (90 min, 80 marks, 40 % each)
 *   AI HL: P1, P2 (120 min, 110 marks, 30 %), P3 (60 min, 55 marks, 20 %), GDC
 * Internal assessment (exploration) is coursework, not simulated.
 * AA SL reuses the AA bank's SL-appropriate items; AI has its own applied,
 * technology-based items (finance, regression, modelling, statistics).
 */
import type { ExamVerticalConfigInput } from '../../vertical-config';
import { FIXTURE_PROVENANCE } from '../fixture-builders';
import { subjectByKey, componentDefinition } from '../../catalog/ib-dp';
import { IB_MATH_AA_HL_V2 } from './ib-math-aa-hl';
import { mc, mathItem, mathPart, choicePart, multiPart } from './builders';

const en = 'en';
const TERMS = (IB_MATH_AA_HL_V2.commandTerms ?? []) as NonNullable<ExamVerticalConfigInput['commandTerms']>;

function mathConfig(params: {
  subjectKey: 'math-aa' | 'math-ai';
  level: 'SL' | 'HL';
  key: string;
  name: string;
  sections: Array<{ key: 'p1' | 'p2' | 'p3'; name: string; objectives: Array<{ code: string; description: string; count: number }>; minutes: number }>;
  items: ExamVerticalConfigInput['items'];
}): ExamVerticalConfigInput {
  const s = subjectByKey(params.subjectKey)!;
  const comp = (k: string) => s.components.find((c) => c.key === k)!;
  return {
    key: params.key,
    family: 'IB',
    contentStatus: 'DEV_CERT_FIXTURE',
    organization: { name: 'International Baccalaureate' },
    programme: { name: 'IB Diploma Programme', type: 'CURRICULUM' },
    subject: { name: s.name, level: params.level },
    definition: { name: `IB ${params.name} ${params.level}`, purpose: `Practice in the official IB ${params.name} ${params.level} paper structure. Original StudyUS items; not IB questions or markschemes.` },
    version: {
      label: `V2 2021-2028`,
      examYear: 2027,
      examSession: 'May / November',
      supportedModalities: ['DIGITAL'],
      delivery: { navigation: 'FREE_ORDER_WITHIN_SECTION', breaks: params.sections.length > 1 ? [{ afterSectionKey: params.sections[0].key, minutes: 10 }] : [], itemFeedback: 'AUTO', resultReview: 'FULL', permittedResources: ['Formula booklet', params.subjectKey === 'math-ai' ? 'GDC (all papers)' : 'GDC (Paper 2 only)'] },
    },
    framework: { frameworkKey: `ib-dp-${params.subjectKey}`, curriculumVersion: (s.curriculumVersion ?? 'first assessment 2021').slice(0, 100), firstAssessment: s.firstAssessment ?? 2021, lastAssessment: s.lastAssessment, syllabusCode: null, frameworkVersion: '2021', sourceKeys: s.sourceKeys.slice(0, 12) },
    scoring: { name: `IB ${params.name} ${params.level} practice -- marks`, scoringType: 'MARK_SCHEME', policy: { engine: 'exam-scoring-v1', strategy: 'RAW', transform: { type: 'NONE' }, unit: '%', provenance: FIXTURE_PROVENANCE } },
    structureLabel: 'V2 2021-2028',
    commandTerms: TERMS,
    sections: params.sections.map((sec) => {
      const d = componentDefinition(s, comp(sec.key), params.level);
      return {
        key: sec.key, name: sec.name, componentType: 'PAPER' as const, subject: { name: s.name, level: params.level }, durationMinutes: sec.minutes,
        toolRules: { calculator: d.calculatorPolicy === 'NONE' ? false : 'graphic display calculator', formulaBooklet: true }, targetDifficultyIndex: 1.0,
        definition: { ...d, limitations: [...d.limitations, 'StudyUS delivers a reduced form (original items); time is proportional to the official pace per mark.'].slice(0, 10) },
        objectives: sec.objectives.map((o) => ({ code: o.code, description: o.description, targets: [{ count: o.count }] })),
      };
    }),
    items: params.items,
  };
}

/* ---------------- AA SL ---------------- */
const aaslItems = IB_MATH_AA_HL_V2.items
  .filter((i) => /^aahl\.p[12]\./.test(i.objectiveCode))
  .map((i) => ({ objectiveCode: i.objectiveCode.replace('aahl.', 'aasl.'), content: { ...i.content, key: i.content.key.replace('aahl.', 'aasl.') } }));

export const IB_MATH_AA_SL_V2 = mathConfig({
  subjectKey: 'math-aa', level: 'SL', key: 'v2.ib.math-aa-sl', name: 'Mathematics: analysis and approaches',
  sections: [
    { key: 'p1', name: 'Paper 1 (no calculator)', minutes: 30, objectives: [
      { code: 'aasl.p1.algebra', description: 'Number and algebra: logarithms, sequences and series.', count: 1 },
      { code: 'aasl.p1.functions', description: 'Functions: rational functions, inverses, quadratics.', count: 1 },
      { code: 'aasl.p1.calculus', description: 'Calculus without technology.', count: 2 },
      { code: 'aasl.p1.extended', description: 'Section B: extended response.', count: 1 },
    ] },
    { key: 'p2', name: 'Paper 2 (GDC)', minutes: 18, objectives: [
      { code: 'aasl.p2.statistics', description: 'Statistics and probability with technology.', count: 2 },
      { code: 'aasl.p2.trigonometry', description: 'Geometry and trigonometry.', count: 1 },
      { code: 'aasl.p2.extended', description: 'Section B: modelling and probability.', count: 1 },
    ] },
  ],
  items: aaslItems,
});

/* ---------------- AI (shared SL / HL bank) ---------------- */
const t = (area: string, skill: string) => ({ contentCategory: area, skill, cognitiveDemand: 'APPLICATION' as const });
const AI_ITEMS: ExamVerticalConfigInput['items'] = [
  { objectiveCode: 'ai.p1.number', content: mathItem({ key: 'ai.p1.compound', language: en, commandTerm: 'calculate', calculator: 'GDC_REQUIRED', difficulty: 2, difficultyIndex: 0.95, tags: t('Number and algebra', 'Financial mathematics'), question: '$1000 is invested at 5 % per year compounded annually. Calculate its value after 3 years, to the nearest cent.', math: { kind: 'NUMBER', answers: ['1157.625'], requiredForm: 'DECIMAL', decimalPlaces: 2, tolerance: { absolute: 0.006 } }, display: '1157.63', marks: 2, method: { marks: 1, criterion: 'M', intermediates: ['1000*1.05^3'] }, explanation: '1000 × 1.05³ = 1157.63.' }) },
  { objectiveCode: 'ai.p1.number', content: mathItem({ key: 'ai.p1.error', language: en, commandTerm: 'calculate', calculator: 'GDC_REQUIRED', difficulty: 2, difficultyIndex: 0.95, tags: t('Number and algebra', 'Percentage error'), question: 'A distance is estimated as 50 m; the exact value is 48 m. Calculate the percentage error, to 3 significant figures (number only).', math: { kind: 'NUMBER', answers: ['4.166666667'], significantFigures: 3 }, marks: 2, explanation: '|50 − 48|/48 × 100 ≈ 4.17 %.' }) },
  { objectiveCode: 'ai.p1.statistics', content: mathItem({ key: 'ai.p1.regression', language: en, commandTerm: 'calculate', calculator: 'GDC_REQUIRED', difficulty: 2, difficultyIndex: 0.95, tags: t('Statistics and probability', 'Linear regression'), question: 'The regression line of y on x is y = 2.5x + 10. Estimate y when x = 8.', math: { kind: 'NUMBER', answers: ['30'] }, marks: 2, explanation: '2.5 × 8 + 10 = 30.' }) },
  { objectiveCode: 'ai.p1.statistics', content: mc({ key: 'ai.p1.pearson', language: en, commandTerm: 'interpret', calculator: 'GDC_REQUIRED', difficulty: 2, difficultyIndex: 0.9, tags: t('Statistics and probability', 'Correlation'), question: 'For two variables r = −0.93. Which interpretation is correct?', options: ['Strong negative linear correlation', 'Weak positive correlation', 'No correlation', 'One variable causes the other to decrease'], correct: 0, marks: 2, explanation: '|r| close to 1, negative sign; correlation is not causation.' }) },
  { objectiveCode: 'ai.p1.functions', content: mathItem({ key: 'ai.p1.linear-model', language: en, commandTerm: 'find', calculator: 'GDC_REQUIRED', difficulty: 2, difficultyIndex: 0.95, tags: t('Functions', 'Linear models'), question: 'A taxi charges C = 15 + 4n dollars for n km. Find n when C = 75.', math: { kind: 'NUMBER', answers: ['15'] }, marks: 2, explanation: '4n = 60.' }) },
  { objectiveCode: 'ai.p2.modelling', content: multiPart({ key: 'ai.p2.cooling', language: en, commandTerm: 'find', calculator: 'GDC_REQUIRED', difficulty: 3, difficultyIndex: 1.0, tags: t('Functions', 'Exponential modelling'), question: 'The temperature of a drink is modelled by T(t) = 20 + 70(0.9)ᵗ, t in minutes.',
    parts: [
      mathPart('a', 'Write down the initial temperature.', { kind: 'NUMBER', answers: ['90'] }, 1, 'A'),
      mathPart('b', 'Find T(5) to 3 significant figures.', { kind: 'NUMBER', answers: ['61.3343'], significantFigures: 3 }, 2, 'A'),
      mathPart('c', 'Find the time when T = 40, to 3 significant figures.', { kind: 'NUMBER', answers: ['11.89193049'], significantFigures: 3 }, 2, 'A', { marks: 1, criterion: 'M', intermediates: ['70*0.9^t=20'] }),
    ],
    explanation: 'T(0) = 90; T(5) = 20 + 70 × 0.9⁵ ≈ 61.3; 0.9ᵗ = 2/7 ⇒ t ≈ 11.9 min.' }) },
  { objectiveCode: 'ai.p2.statistics', content: multiPart({ key: 'ai.p2.normal', language: en, commandTerm: 'find', calculator: 'GDC_REQUIRED', difficulty: 3, difficultyIndex: 1.0, tags: t('Statistics and probability', 'Normal distribution, chi-squared'), question: 'Heights are normally distributed with mean 170 cm and standard deviation 8 cm.',
    parts: [
      mathPart('a', 'Find P(X < 180), to 3 significant figures.', { kind: 'NUMBER', answers: ['0.894350161'], significantFigures: 3 }, 2, 'A'),
      choicePart('b', 'A χ² test of independence gives p = 0.03 at the 5 % level. Conclusion:', ['Reject H₀: the variables are not independent', 'Accept H₀: the variables are independent', 'The test is invalid', 'Increase the significance level'], 0, 2, 'A'),
    ],
    explanation: 'P(Z < 1.25) ≈ 0.894; p < 0.05 ⇒ reject independence.' }) },
  { objectiveCode: 'ai.p3.investigation', content: multiPart({ key: 'ai.p3.population', language: en, commandTerm: 'show that', calculator: 'GDC_REQUIRED', difficulty: 4, difficultyIndex: 1.05, tags: t('Functions', 'Extended investigation: recurrence model'), question: 'This question investigates a population model Pₙ₊₁ = 1.2Pₙ − 0.001Pₙ² with P₀ = 100.',
    parts: [
      mathPart('a', 'Find P₁.', { kind: 'NUMBER', answers: ['110'] }, 1, 'A'),
      mathPart('b', 'Find the non-zero equilibrium population (Pₙ₊₁ = Pₙ).', { kind: 'NUMBER', answers: ['200'] }, 3, 'A', { marks: 1, criterion: 'M', intermediates: ['P=1.2P-0.001P^2', '0.2=0.001P'] }),
      choicePart('c', 'Using technology, describe the long-term behaviour from P₀ = 100.', ['It increases towards 200', 'It decreases to 0', 'It oscillates without limit', 'It grows without bound'], 0, 2, 'A'),
    ],
    explanation: 'P₁ = 120 − 10 = 110; equilibrium 0.2P = 0.001P² ⇒ P = 200; iterating converges to 200.' }) },
];

const AI_P1 = [
  { code: 'ai.p1.number', description: 'Number and algebra: finance, approximation, errors.', count: 1 },
  { code: 'ai.p1.statistics', description: 'Statistics: regression, correlation.', count: 1 },
  { code: 'ai.p1.functions', description: 'Functions: linear and non-linear models.', count: 1 },
];
const AI_P2 = [
  { code: 'ai.p2.modelling', description: 'Extended response: modelling with technology.', count: 1 },
  { code: 'ai.p2.statistics', description: 'Extended response: statistics and probability.', count: 1 },
];

export const IB_MATH_AI_SL_V2 = mathConfig({
  subjectKey: 'math-ai', level: 'SL', key: 'v2.ib.math-ai-sl', name: 'Mathematics: applications and interpretation',
  sections: [{ key: 'p1', name: 'Paper 1 (GDC)', minutes: 7, objectives: AI_P1 }, { key: 'p2', name: 'Paper 2 (GDC)', minutes: 11, objectives: AI_P2 }],
  items: AI_ITEMS!.filter((i) => !i.objectiveCode.startsWith('ai.p3')),
});
export const IB_MATH_AI_HL_V2 = mathConfig({
  subjectKey: 'math-ai', level: 'HL', key: 'v2.ib.math-ai-hl', name: 'Mathematics: applications and interpretation',
  sections: [
    { key: 'p1', name: 'Paper 1 (GDC)', minutes: 7, objectives: AI_P1 },
    { key: 'p2', name: 'Paper 2 (GDC)', minutes: 11, objectives: AI_P2 },
    { key: 'p3', name: 'Paper 3 (GDC, investigation)', minutes: 7, objectives: [{ code: 'ai.p3.investigation', description: 'Extended problem solving: investigation with technology.', count: 1 }] },
  ],
  items: AI_ITEMS!.map((i) => ({ ...i, content: { ...i.content, key: `hl.${i.content.key}` } })),
});
