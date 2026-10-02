/**
 * Exam V2 -- shared builder for the IB DP sciences (first assessment 2025):
 *   Paper 1 = 1A (multiple choice) + 1B (data-based), one sitting, 36 %
 *   Paper 2 = short-answer and extended-response, 44 %
 *   Internal assessment (scientific investigation, 20 %) -- coursework, not simulated.
 * Marks, times and weights per level come from the sourced IB data
 * (ib-dp.generated.ts) -- never typed here -- so SL and HL can never drift
 * from the guide. The time split between 1A and 1B is not published: the
 * reduced form uses the official Paper 1 pace per mark for both and says so.
 */
import type { z } from 'zod';
import type { ExamVerticalConfigInput } from '../../vertical-config';
import type { ApprovedItemContentSchema } from '../../items';
import { FIXTURE_PROVENANCE } from '../fixture-builders';
import { subjectByKey, componentDefinition } from '../../catalog/ib-dp';

type ItemInput = z.input<typeof ApprovedItemContentSchema>;
export interface ScienceObjective { code: string; description: string; count: number }
export interface ScienceItem { objectiveCode: string; content: ItemInput; hlOnly?: boolean }

export const SCIENCE_TERMS = [
  { term: 'state', expectedReasoningType: 'FACTUAL', description: 'Give a specific name, value or other brief answer without explanation or calculation.' },
  { term: 'calculate', expectedReasoningType: 'PROCEDURAL', description: 'Obtain a numerical answer showing the relevant stages in the working.' },
  { term: 'determine', expectedReasoningType: 'PROCEDURAL', description: 'Obtain the only possible answer.' },
  { term: 'explain', expectedReasoningType: 'CONCEPTUAL', description: 'Give a detailed account including reasons or causes.' },
  { term: 'outline', expectedReasoningType: 'CONCEPTUAL', description: 'Give a brief account or summary.' },
  { term: 'deduce', expectedReasoningType: 'CONCEPTUAL', description: 'Reach a conclusion from the information given.' },
  { term: 'suggest', expectedReasoningType: 'CONCEPTUAL', description: 'Propose a solution, hypothesis or other possible answer.' },
];

const marksOf = (c: ItemInput): number => (c.parts ? c.parts.reduce((n, p) => n + (p.marks ?? 0) + (p.method?.marks ?? 0), 0) : (c.marks ?? 1) + (c.method?.marks ?? 0));

export function scienceConfig(params: {
  subjectKey: 'physics' | 'chemistry' | 'biology';
  level: 'SL' | 'HL';
  key: string;
  displayName: string;
  objectives: { p1a: ScienceObjective[]; p1b: ScienceObjective[]; p2: ScienceObjective[] };
  items: ScienceItem[];
  dataBooklet: boolean;
}): ExamVerticalConfigInput {
  const s = subjectByKey(params.subjectKey);
  if (!s || !s.paper1Combined) throw new Error(`science spec missing: ${params.subjectKey}`);
  const L = params.level;
  const comp = (k: string) => s.components.find((c) => c.key === k)!;
  const items = params.items.filter((i) => L === 'HL' || !i.hlOnly).map((i) => ({ objectiveCode: i.objectiveCode, content: { ...i.content, key: `${params.key.replace('v2.ib.', '')}.${i.content.key}` } }));
  // Reduced form time = official pace (minutes per mark) x the marks a form plans (first `count` items per objective).
  const planned = (objs: ScienceObjective[]) => objs.reduce((n, o) => n + items.filter((i) => i.objectiveCode === o.code).slice(0, o.count).reduce((m, i) => m + marksOf(i.content), 0), 0);
  const p1Pace = (s.paper1Combined.minutes[L] ?? 90) / (s.paper1Combined.marks[L] ?? 45);
  const p2c = comp('p2');
  const p2Pace = (p2c.minutes?.[L] ?? 90) / (p2c.marks?.[L] ?? 50);
  const minutes = (pace: number, marks: number) => Math.max(5, Math.round(pace * marks));
  const def = (k: string, extra: string[] = []) => {
    const d = componentDefinition(s, comp(k), L);
    return { ...d, limitations: [...d.limitations, ...extra, 'StudyUS delivers a reduced form (original items); time is proportional to the official pace per mark.'].slice(0, 10) };
  };
  const tools = { calculator: 'calculator', dataBooklet: params.dataBooklet };
  return {
    key: params.key,
    family: 'IB',
    contentStatus: 'DEV_CERT_FIXTURE',
    organization: { name: 'International Baccalaureate' },
    programme: { name: 'IB Diploma Programme', type: 'CURRICULUM' },
    subject: { name: s.name, level: L },
    definition: {
      name: `IB ${params.displayName} ${L}`,
      purpose: `Practice in the official IB ${params.displayName} ${L} structure (Paper 1A, 1B, 2; first assessment 2025). Original StudyUS items; not IB questions or markschemes.`,
      domains: params.objectives.p1a.map((o) => o.description.split(':')[0]),
    },
    version: {
      label: `V2 ${s.firstAssessment}`,
      examYear: 2027,
      examSession: 'May / November',
      supportedModalities: ['PAPER'],
      delivery: {
        navigation: 'FREE_ORDER_WITHIN_SECTION',
        breaks: [{ afterSectionKey: 'p1b', minutes: 10 }],
        itemFeedback: 'AUTO',
        resultReview: 'FULL',
        permittedResources: [params.dataBooklet ? `${s.name} data booklet` : null, 'Calculator'].filter((x): x is string => !!x),
      },
    },
    framework: {
      frameworkKey: `ib-dp-${params.subjectKey}`,
      curriculumVersion: (s.curriculumVersion ?? `first assessment ${s.firstAssessment}`).slice(0, 100),
      firstAssessment: s.firstAssessment!,
      lastAssessment: s.lastAssessment,
      syllabusCode: null,
      frameworkVersion: String(s.firstAssessment),
      sourceKeys: s.sourceKeys.slice(0, 12),
    },
    scoring: { name: `IB ${params.displayName} ${L} practice -- marks`, scoringType: 'MARK_SCHEME', policy: { engine: 'exam-scoring-v1', strategy: 'RAW', transform: { type: 'NONE' }, unit: '%', provenance: FIXTURE_PROVENANCE } },
    structureLabel: `V2 ${s.firstAssessment}`,
    commandTerms: SCIENCE_TERMS,
    sections: [
      { key: 'p1a', name: 'Paper 1A (multiple choice)', componentType: 'PAPER', subject: { name: s.name, level: L }, durationMinutes: minutes(p1Pace, planned(params.objectives.p1a)), toolRules: tools, targetDifficultyIndex: 1.0, definition: def('p1a'), objectives: params.objectives.p1a.map((o) => ({ code: o.code, description: o.description, targets: [{ count: o.count }] })) },
      { key: 'p1b', name: 'Paper 1B (data-based questions)', componentType: 'PAPER', subject: { name: s.name, level: L }, durationMinutes: minutes(p1Pace, planned(params.objectives.p1b)), toolRules: tools, targetDifficultyIndex: 1.0, definition: def('p1b'), objectives: params.objectives.p1b.map((o) => ({ code: o.code, description: o.description, targets: [{ count: o.count }] })) },
      { key: 'p2', name: 'Paper 2', componentType: 'PAPER', subject: { name: s.name, level: L }, durationMinutes: minutes(p2Pace, planned(params.objectives.p2)), toolRules: tools, targetDifficultyIndex: 1.0, definition: def('p2'), objectives: params.objectives.p2.map((o) => ({ code: o.code, description: o.description, targets: [{ count: o.count }] })) },
    ],
    items,
  };
}
