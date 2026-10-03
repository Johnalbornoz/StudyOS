/**
 * Cambridge AICE Diploma -- catalogue tree, generated from the sourced data:
 *
 *   Cambridge AICE Diploma (PROGRAMME, a group award -- never an exam)
 *     Core / Group 1-4 (AREA, Cambridge curriculum groups)
 *       Subject (syllabus code)                  e.g. Mathematics (9709)
 *         AS Level / A Level (LEVEL, credits)    bound to v2.aice.<code>-as|a when configured
 *           Paper / Component (official number, minutes, marks, weighting)
 *
 * A subject Cambridge lists in several groups appears under each of them
 * ("También puede contar para Group 3"), always bound to the SAME
 * configuration: one subject, one set of results; where it counts is the
 * Student's choice in the Diploma plan. Subjects without verified component
 * data stay catalogue entries ("Aún no disponible") -- no paper is invented.
 */
import type { CatalogNode } from './structure';
import { AICE_SUBJECTS } from '../aice/aice-subjects.generated';
import { AICE_SYLLABI } from '../aice/aice-syllabi.generated';

const GROUPS: Array<{ key: 'CORE' | 'GROUP_1' | 'GROUP_2' | 'GROUP_3' | 'GROUP_4'; node: string; label: string; es: string }> = [
  { key: 'CORE', node: 'core', label: 'Core: Global Perspectives & Research', es: 'Core (obligatorio): Global Perspectives & Research' },
  { key: 'GROUP_1', node: 'g1', label: 'Group 1: Mathematics and Sciences', es: 'Group 1: Matemáticas y Ciencias' },
  { key: 'GROUP_2', node: 'g2', label: 'Group 2: Languages', es: 'Group 2: Idiomas' },
  { key: 'GROUP_3', node: 'g3', label: 'Group 3: Arts and Humanities', es: 'Group 3: Artes y Humanidades' },
  { key: 'GROUP_4', node: 'g4', label: 'Group 4: Interdisciplinary (optional)', es: 'Group 4: Interdisciplinario (opcional)' },
];
const GROUP_ES: Record<string, string> = { GROUP_1: 'Group 1', GROUP_2: 'Group 2', GROUP_3: 'Group 3', GROUP_4: 'Group 4' };

export type SectionsLookup = (configKey: string) => Array<{ key: string }> | null;

export function aiceCatalogTree(sectionsOf: SectionsLookup): CatalogNode {
  const groupNode = (g: (typeof GROUPS)[number]): CatalogNode => {
    const subjects = AICE_SUBJECTS.filter((s) => (g.key === 'CORE' ? s.code === '9239' : s.groups.includes(g.key) && s.code !== '9239'));
    return {
      key: `cie.aice.${g.node}`,
      type: 'AREA',
      label: g.label,
      labels: { es: g.es },
      description: g.key === 'CORE' ? 'Compulsory for the AICE Diploma (Cambridge International AS Level Global Perspectives & Research 9239).' : g.key === 'GROUP_4' ? 'Optional; at most 2 credits count towards the Diploma.' : 'At least one credit from this group is required for the Diploma.',
      sourceKeys: ['cie-aice-curriculum', 'cie-aice-qualification'],
      children: subjects.map((s) => subjectNode(s, g.key, g.node)),
    };
  };
  const subjectNode = (s: (typeof AICE_SUBJECTS)[number], group: string, gnode: string): CatalogNode => {
    const syl = AICE_SYLLABI.find((x) => x.code === s.code);
    const others = s.groups.filter((x) => x !== group && x !== 'CORE');
    return {
      key: `cie.aice.${gnode}.${s.code}`,
      type: 'SUBJECT',
      label: `${s.name} (${s.code})`,
      syllabusCode: s.code,
      ...(syl ? { firstAssessment: syl.firstExam, lastAssessment: syl.lastExam, frameworkVersion: syl.versionKey, curriculumVersion: syl.version.slice(0, 100) } : {}),
      description: s.code === '9239'
        ? 'AS Level: Core obligatorio del Diploma. El A Level también aporta 1 crédito de Group 4 (A Level also gives one Group 4 credit).'
        : others.length ? `También puede contar para ${others.map((o) => GROUP_ES[o] ?? o).join(' o ')} (Also eligible for ${others.map((o) => GROUP_ES[o] ?? o).join(' / ')}).` : undefined,
      sourceKeys: syl ? [syl.sourceKey, 'cie-aice-curriculum'] : ['cie-aice-curriculum'],
      children: s.levels.map((lv) => levelNode(s, lv, gnode, syl)),
    };
  };
  const levelNode = (s: (typeof AICE_SUBJECTS)[number], lv: 'AS' | 'A', gnode: string, syl: (typeof AICE_SYLLABI)[number] | undefined): CatalogNode => {
    const configKey = `v2.aice.${s.code}-${lv === 'AS' ? 'as' : 'a'}`;
    const sections = sectionsOf(configKey);
    const key = `cie.aice.${gnode}.${s.code}.${lv === 'AS' ? 'as' : 'a'}`;
    const comps = syl?.components.filter((c) => c.levels.includes(lv)) ?? [];
    return {
      key,
      type: 'LEVEL',
      label: lv === 'AS' ? 'AS Level' : 'A Level',
      facts: { credits: lv === 'AS' ? 1 : 2, ...(syl ? { syllabusVersion: syl.versionKey } : {}) },
      ...(syl ? { syllabusCode: s.code, frameworkVersion: syl.versionKey, firstAssessment: syl.firstExam, lastAssessment: syl.lastExam } : {}),
      sourceKeys: syl ? [syl.sourceKey] : ['cie-aice-curriculum'],
      ...(sections ? { bind: { configKey }, modes: ['PRACTICE', 'MOCK', 'CHALLENGE'] as Array<'PRACTICE' | 'MOCK' | 'CHALLENGE'> } : {}),
      children: comps.map((c) => ({
        key: `${key}.${c.key}`,
        type: c.type === 'WRITTEN_PAPER' ? 'PAPER' : c.type === 'PRACTICAL' ? 'COMPONENT' : 'PROJECT',
        label: `${c.type === 'WRITTEN_PAPER' || c.type === 'PRACTICAL' ? 'Paper' : 'Component'} ${c.number} — ${c.name}`,
        facts: { ...(c.minutes ? { minutes: c.minutes } : {}), marks: c.marks, ...((lv === 'AS' ? c.weightAS : c.weightA) !== null ? { weightPercent: (lv === 'AS' ? c.weightAS : c.weightA) as number } : {}) },
        sourceKeys: [syl!.sourceKey],
        ...(sections?.some((x) => x.key === c.key) ? { bind: { configKey, sectionKey: c.key } } : {}),
      })),
    };
  };
  return {
    key: 'cie.aice',
    type: 'PROGRAMME',
    label: 'Cambridge AICE Diploma',
    description: 'A group award: Cambridge International AS & A Level results across the Core and Groups 1-4 (7 credits; AS Level = 1, A Level = 2).',
    sourceKeys: ['cie-aice-qualification', 'cie-aice-curriculum'],
    children: GROUPS.map(groupNode),
  };
}
