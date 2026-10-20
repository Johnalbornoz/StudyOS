/**
 * Exam V2 -- Cambridge International AS & A Level (AICE) configuration builder.
 *
 * One configuration per Subject + Qualification Level + Syllabus Version
 * (e.g. 9709 / AS Level / 2026-2027). EVERY official fact -- component names
 * and numbers, minutes, marks, AS / A Level weightings, calculator rules,
 * resources, assessment objectives, the allowed component combinations
 * (routes) -- comes from the sourced syllabus data (aice-syllabi.generated.ts),
 * never typed here, so no paper is invented and nothing crosses versions.
 * The caller only supplies the blueprint objectives (syllabus topics / AOs)
 * and the original StudyUS practice items.
 *
 * Reduced forms: a timed component's practice time is the official pace
 * (minutes per mark) x the marks the form plans; coursework stays untimed.
 */
import type { z } from 'zod';
import type { ExamVerticalConfigInput } from '../../../vertical-config';
import type { ApprovedItemContentSchema } from '../../../items';
import { FIXTURE_PROVENANCE } from '../../fixture-builders';
import { AICE_SYLLABI, type AiceSyllabus, type AiceSyllabusComponent } from '../../../aice/aice-syllabi.generated';
import { AICE_SUBJECTS } from '../../../aice/aice-subjects.generated';

type ItemInput = z.input<typeof ApprovedItemContentSchema>;
type Format = 'SELECTED_RESPONSE' | 'MULTI_SELECT' | 'SHORT_RESPONSE' | 'NUMERIC_ENTRY' | 'MATH_EXPRESSION' | 'EXTENDED_RESPONSE' | 'ESSAY' | 'MULTIMODAL_SUBMISSION';

export interface AiceObjective {
  code: string;
  description: string;
  /** Positions of this objective in one practice / mock form. */
  count: number;
}
export interface AiceItem {
  objectiveCode: string;
  content: ItemInput;
}

export const syllabus = (code: string): AiceSyllabus => {
  const s = AICE_SYLLABI.find((x) => x.code === code);
  if (!s) throw new Error(`AICE syllabus ${code} is not in the sourced data`);
  return s;
};

const marksOf = (c: ItemInput): number => (c.parts ? c.parts.reduce((n, p) => n + (p.marks ?? 0) + (p.method?.marks ?? 0), 0) : (c.marks ?? 1) + (c.method?.marks ?? 0));
const isMultipleChoice = (c: AiceSyllabusComponent) => /multiple[- ]choice/i.test(c.questionTypes ?? '');
const mcCount = (c: AiceSyllabusComponent) => Number(/(\d+)\s+(?:four-choice\s+)?multiple[- ]choice/i.exec(c.questionTypes ?? '')?.[1] ?? 0) || null;

function kindOf(c: AiceSyllabusComponent) {
  if (c.type === 'PRACTICAL') return { componentType: 'PRACTICAL' as const, kind: 'PRACTICAL' as const };
  if (c.type === 'ESSAY') return { componentType: 'COURSEWORK' as const, kind: 'COURSEWORK' as const };
  if (c.type === 'PRESENTATION') return { componentType: 'COURSEWORK' as const, kind: 'PRESENTATION' as const };
  if (c.type === 'RESEARCH_REPORT') return { componentType: 'COURSEWORK' as const, kind: 'RESEARCH_REPORT' as const };
  return { componentType: 'PAPER' as const, kind: isMultipleChoice(c) ? ('MULTIPLE_CHOICE_TEST' as const) : ('WRITTEN_PAPER' as const) };
}

/** Calculator rule as the syllabus states it; null when the syllabus does not state one (shown as such). */
function calculatorOf(c: AiceSyllabusComponent): 'NONE' | 'ALLOWED' | null {
  const t = (c.calculator ?? '').toLowerCase();
  if (!t || t.startsWith('n/a') || t.includes('not_confirmed') || t.includes('no explicit')) return null;
  if (t.includes('not permitted') && !t.includes('scientific')) return 'NONE';
  return 'ALLOWED';
}

export function aiceConfig(params: {
  code: string;
  level: 'AS' | 'A';
  objectives: Record<string, AiceObjective[]>;
  items: AiceItem[];
  responseFormats: Record<string, Format[]>;
  commandTerms?: Array<{ term: string; expectedReasoningType?: string; description?: string }>;
  limitations?: Record<string, string[]>;
}): ExamVerticalConfigInput {
  const s = syllabus(params.code);
  const subject = AICE_SUBJECTS.find((x) => x.code === params.code);
  if (!subject) throw new Error(`AICE subject ${params.code} is not in the sourced curriculum`);
  if (!subject.levels.includes(params.level)) throw new Error(`${params.code} is not offered at ${params.level}`);
  const L = params.level;
  const levelName = L === 'AS' ? 'AS Level' : 'A Level';
  const tag = `${params.code}-${L === 'AS' ? 'as' : 'a'}`;
  const comps = s.components.filter((c) => c.levels.includes(L));
  const items = params.items.filter((i) => comps.some((c) => (params.objectives[c.key] ?? []).some((o) => o.code === i.objectiveCode))).map((i) => ({ objectiveCode: i.objectiveCode, content: { ...i.content, key: `${tag}.${i.content.key}` } }));
  const planned = (objs: AiceObjective[]) => objs.reduce((n, o) => n + items.filter((i) => i.objectiveCode === o.code).slice(0, o.count).reduce((m, i) => m + marksOf(i.content), 0), 0);
  const subjectName = subject.name;
  const sections = comps.map((c) => {
    const objs = params.objectives[c.key];
    if (!objs?.length) throw new Error(`${tag}: no blueprint objectives for component ${c.key}`);
    const { componentType, kind } = kindOf(c);
    const weight = L === 'AS' ? c.weightAS : c.weightA;
    const timed = c.minutes !== null;
    const planMarks = planned(objs);
    const minutes = timed ? Math.max(5, Math.round((c.minutes! / c.marks) * planMarks)) : undefined;
    return {
      key: c.key,
      name: `${c.type === 'WRITTEN_PAPER' || c.type === 'PRACTICAL' ? 'Paper' : 'Component'} ${c.number} — ${c.name}`,
      componentType,
      subject: { name: subjectName, level: levelName },
      ...(minutes ? { durationMinutes: minutes } : {}),
      toolRules: { calculator: calculatorOf(c) ?? 'not-stated', resources: c.resources ?? null },
      targetDifficultyIndex: 1.0,
      definition: {
        officialName: `${c.type === 'WRITTEN_PAPER' || c.type === 'PRACTICAL' ? 'Paper' : 'Component'} ${c.number} ${c.name}`,
        componentCode: c.number,
        kind,
        assessment: 'EXTERNAL' as const,
        officialDurationMinutes: c.minutes,
        maxMarks: c.marks,
        weightingPercent: weight,
        officialItemCount: kind === 'MULTIPLE_CHOICE_TEST' ? mcCount(c) : null,
        calculatorPolicy: calculatorOf(c),
        ...(c.resources ? { resources: [c.resources.slice(0, 200)] } : {}),
        responseFormats: params.responseFormats[c.key] ?? ['EXTENDED_RESPONSE'],
        assessmentObjectives: s.assessmentObjectives.map((a) => ({ code: a.key, label: a.name.slice(0, 300), weightPercent: `${L === 'AS' ? a.weightAS ?? 0 : a.weightA ?? 0}%` })),
        limitations: [
          ...(params.limitations?.[c.key] ?? []),
          ...(calculatorOf(c) === null && c.type !== 'ESSAY' && c.type !== 'PRESENTATION' && c.type !== 'RESEARCH_REPORT' ? ['The syllabus does not state an explicit calculator rule for this paper.'] : []),
          timed ? `StudyUS reduced form: ${planMarks} of ${c.marks} marks of original practice items, at the official pace per mark.` : 'Coursework component: no official time; StudyUS practice task scored with a StudyUS rubric (Cambridge mark schemes are not reproduced).',
        ].slice(0, 10),
        sourceKeys: [s.sourceKey],
      },
      objectives: objs.map((o) => ({ code: o.code, description: o.description, targets: [{ count: o.count }] })),
    };
  });
  const routes = s.routes
    .filter((r) => (L === 'AS' ? r.key === 'AS_ONLY' : r.key !== 'AS_ONLY'))
    .map((r) => ({ key: r.key, label: r.description.slice(0, 200), componentSets: r.componentSets, ...(r.stages ? { stages: r.stages } : {}) }));
  return {
    key: `v2.aice.${tag}`,
    family: 'AICE',
    contentStatus: 'DEV_CERT_FIXTURE',
    organization: { name: 'Cambridge International' },
    programme: { name: 'Cambridge AICE Diploma', type: 'CURRICULUM' },
    qualification: { name: `Cambridge International ${levelName}` },
    subject: { name: subjectName, level: levelName },
    definition: {
      name: `Cambridge International ${levelName} ${subjectName} (${params.code})`,
      purpose: `StudyUS practice aligned to the Cambridge syllabus ${params.code} (${s.firstExam}-${s.lastExam}): official components, combinations, marks and timings; original items, never official Cambridge content.`,
      domains: (s.topics[L === 'AS' ? 'AS' : 'A'] ?? []).map((t) => t.slice(0, 100)).slice(0, 20),
    },
    version: {
      label: `${params.code} ${levelName} ${s.firstExam}-${s.lastExam}`,
      examYear: s.firstExam,
      examSession: 'June / November',
      supportedModalities: ['PAPER'],
      delivery: { navigation: 'LINEAR', breaks: sections.slice(0, -1).filter((x) => x.durationMinutes).map((x) => ({ afterSectionKey: x.key, minutes: 10 })), itemFeedback: 'AUTO', resultReview: 'FULL', permittedResources: [] },
    },
    framework: { frameworkKey: `cie-aice-${params.code}`, curriculumVersion: s.version.slice(0, 100), firstAssessment: s.firstExam, lastAssessment: s.lastExam, syllabusCode: params.code, frameworkVersion: s.versionKey, sourceKeys: [s.sourceKey, 'cie-aice-curriculum'] },
    scoring: { name: `${params.code} practice -- marks (no official Cambridge grade without published thresholds)`, scoringType: 'MARK_SCHEME', policy: { engine: 'exam-scoring-v1', strategy: 'RAW', transform: { type: 'NONE' }, unit: 'marks', provenance: FIXTURE_PROVENANCE } },
    reporting: { scaleNote: 'NO_OFFICIAL_SCALE', groups: sections.map((x) => ({ key: x.key, label: x.name.slice(0, 120), sectionKeys: [x.key] })) },
    assessmentRoutes: routes,
    structureLabel: `${params.code} ${levelName}`,
    commandTerms: params.commandTerms ?? [],
    aggregation: { qualificationGroupKey: 'cie-aice-diploma', groupName: 'Cambridge AICE Diploma', subjectGroup: subject.groups.join(' / ') },
    sections,
    items,
  } as ExamVerticalConfigInput;
}
