/**
 * Exam V2 -- IB Diploma Programme: full catalogue + structure, derived from the
 * reviewed research data (ib-dp.generated.ts). Nothing here is a generic
 * pattern: every subject / level gets exactly the components its current
 * guide defines (no copied "Paper 1/2/3", no historical components).
 *
 *   IB -> Diploma Programme -> Group -> Subject [-> curriculum version] -> SL/HL -> Paper / component
 *
 * Subjects with a bank have hand-written configurations (FULL_CONFIG_KEYS);
 * every other subject / level gets a STRUCTURE-ONLY configuration (sourced
 * component definitions + blueprint, no items) => STRUCTURE_READY, shown as
 * "Próximamente" with its real structure. Courses whose last assessment is
 * before 2027 (legacy CS / DT / Visual arts) and school-based syllabuses are
 * documented, not catalogued as current.
 */
import type { ExamVerticalConfigInput } from '../vertical-config';
import type { CatalogNode } from './structure';
import { FIXTURE_PROVENANCE } from '../verticals/fixture-builders';
import { IB_DP_SUBJECTS, type IbComponentSpec, type IbLevel, type IbSubjectSpec } from './ib-dp.generated';

/** Subject/level -> hand-written configuration with a bank. */
export const FULL_CONFIG_KEYS: Record<string, string> = {
  'math-aa:HL': 'v2.ib.math-aa-hl',
  'math-aa:SL': 'v2.ib.math-aa-sl',
  'math-ai:SL': 'v2.ib.math-ai-sl',
  'math-ai:HL': 'v2.ib.math-ai-hl',
  'visual-arts:SL': 'v2.ib.visual-arts-sl',
  'visual-arts:HL': 'v2.ib.visual-arts-hl',
  'physics:SL': 'v2.ib.physics-sl',
  'physics:HL': 'v2.ib.physics-hl',
  'chemistry:SL': 'v2.ib.chemistry-sl',
  'chemistry:HL': 'v2.ib.chemistry-hl',
  'biology:SL': 'v2.ib.biology-sl',
  'biology:HL': 'v2.ib.biology-hl',
};

/** Not current for students sitting 2027+ (documented in the readiness report, not catalogued). */
export const NOT_CURRENT = new Set(['computer-science-legacy', 'design-technology-legacy', 'visual-arts-legacy', 'group4-school-based-syllabuses']);
/** Two curriculum versions shown under one subject. */
const VERSION_PAIRS: Record<string, string> = { 'history-2028': 'history', 'religion-and-society': 'world-religions' };

export const GROUP_LABELS: Record<string, { en: string; es: string }> = {
  '1': { en: 'Group 1: Studies in language and literature', es: 'Grupo 1: Estudios de lengua y literatura' },
  '2': { en: 'Group 2: Language acquisition', es: 'Grupo 2: Adquisición de lenguas' },
  '3': { en: 'Group 3: Individuals and societies', es: 'Grupo 3: Individuos y sociedades' },
  '4': { en: 'Group 4: Sciences', es: 'Grupo 4: Ciencias' },
  '5': { en: 'Group 5: Mathematics', es: 'Grupo 5: Matemáticas' },
  '6': { en: 'Group 6: The arts', es: 'Grupo 6: Artes' },
  core: { en: 'DP core', es: 'Núcleo del Programa del Diploma' },
};

const sanitize = (k: string) => k.toLowerCase().replace(/[^a-z0-9._-]/g, '-').replace(/^-+/, '');
export const subjectByKey = (key: string) => IB_DP_SUBJECTS.find((s) => s.key === key);
const levelsOf = (s: IbSubjectSpec): IbLevel[] => s.levels.filter((l) => l === 'SL' || l === 'HL' || l === 'CORE');
const at = <T,>(rec: Partial<Record<IbLevel, T>> | null | undefined, level: IbLevel): T | null => (rec ? rec[level] ?? null : null);

function calculatorPolicy(c: IbComponentSpec): 'NONE' | 'ALLOWED' | 'GDC_REQUIRED' | 'SCIENTIFIC_REQUIRED' | null {
  const v = (c.calculator ?? '').toUpperCase();
  if (v === 'NONE') return 'NONE';
  if (v.includes('GDC')) return 'GDC_REQUIRED';
  if (v.includes('SCIENTIFIC')) return 'SCIENTIFIC_REQUIRED';
  if (v.includes('CALCULATOR')) return 'ALLOWED';
  return null;
}

function kindOf(c: IbComponentSpec): 'WRITTEN_PAPER' | 'MULTIPLE_CHOICE_TEST' | 'PORTFOLIO' | 'PERFORMANCE' | 'PROJECT' | 'ORAL' | 'INTERNAL_ASSESSMENT' {
  const t = `${c.name} ${c.format ?? ''}`.toLowerCase();
  if (/oral|presentation/.test(t) && !/paper/.test(c.name.toLowerCase())) return 'ORAL';
  if (/perform|presenting music|solo theatre|dance/.test(t) && !/paper/.test(c.name.toLowerCase())) return 'PERFORMANCE';
  if (/portfolio|exhibition|artworks|composition/.test(t) && !/paper/.test(c.name.toLowerCase())) return 'PORTFOLIO';
  if (/project|investigation|dossier|essay|exploration|written assignment|music-maker/.test(t) && !/^paper/.test(c.name.toLowerCase())) return c.type === 'INTERNAL' ? 'INTERNAL_ASSESSMENT' : 'PROJECT';
  if (c.type === 'INTERNAL') return 'INTERNAL_ASSESSMENT';
  if (/multiple choice|mcq/.test(t)) return 'MULTIPLE_CHOICE_TEST';
  return 'WRITTEN_PAPER';
}

function responseFormats(c: IbComponentSpec): Array<'SELECTED_RESPONSE' | 'SHORT_RESPONSE' | 'EXTENDED_RESPONSE' | 'ESSAY' | 'MULTIMODAL_SUBMISSION' | 'MATH_EXPRESSION' | 'NUMERIC_ENTRY'> {
  const t = `${c.name} ${c.format ?? ''}`.toLowerCase();
  const kind = kindOf(c);
  if (kind === 'ORAL' || kind === 'PERFORMANCE' || kind === 'PORTFOLIO') return ['MULTIMODAL_SUBMISSION'];
  const out = new Set<'SELECTED_RESPONSE' | 'SHORT_RESPONSE' | 'EXTENDED_RESPONSE' | 'ESSAY' | 'MULTIMODAL_SUBMISSION' | 'MATH_EXPRESSION' | 'NUMERIC_ENTRY'>();
  if (/multiple choice|mcq/.test(t)) out.add('SELECTED_RESPONSE');
  if (/essay|commentary|analysis|composition/.test(t)) out.add('ESSAY');
  if (/short|structured|data|source|response|question/.test(t)) out.add('SHORT_RESPONSE');
  if (/extended|essay/.test(t)) out.add('EXTENDED_RESPONSE');
  if (kind === 'PROJECT' || kind === 'INTERNAL_ASSESSMENT') out.add('MULTIMODAL_SUBMISSION');
  if (out.size === 0) out.add('EXTENDED_RESPONSE');
  return [...out];
}

function assessmentObjectives(s: IbSubjectSpec) {
  return s.assessmentObjectives.slice(0, 12).map((ao, i) => {
    const m = ao.match(/^(AO\d+|A\d+)\s*[:.-]?\s*(.*)$/i);
    return { code: (m ? m[1] : `AO${i + 1}`).toUpperCase().slice(0, 20), label: (m ? m[2] || ao : ao).slice(0, 300) };
  });
}

/** Paper 1A / 1B share one sitting whose split is not published: the definition says so. */
function combinedNote(s: IbSubjectSpec, level: IbLevel): string | null {
  const p = s.paper1Combined;
  if (!p) return null;
  return `Paper 1 (1A + 1B) is one sitting: ${at(p.minutes, level) ?? '?'} min, ${at(p.marks, level) ?? '?'} marks, ${at(p.weightPercent, level) ?? '?'} %. The 1A/1B time split is not published.`;
}

export function componentDefinition(s: IbSubjectSpec, c: IbComponentSpec, level: IbLevel) {
  const external = c.type !== 'INTERNAL';
  const minutes = at(c.minutes, level);
  const isTimedExam = external && kindOf(c) !== 'PORTFOLIO' && kindOf(c) !== 'PROJECT' && kindOf(c) !== 'PERFORMANCE' && minutes !== null && minutes <= 300;
  const note = /^p1[ab]$/.test(c.key) ? combinedNote(s, level) : null;
  return {
    officialName: c.name,
    kind: kindOf(c),
    assessment: external ? ('EXTERNAL' as const) : ('INTERNAL' as const),
    officialDurationMinutes: isTimedExam ? minutes : null,
    maxMarks: at(c.marks, level),
    weightingPercent: at(c.weightPercent, level) ?? (/^p1[ab]$/.test(c.key) ? null : null),
    calculatorPolicy: calculatorPolicy(c),
    responseFormats: responseFormats(c),
    assessmentObjectives: assessmentObjectives(s),
    submissionLimits: [],
    limitations: [c.format, note, c.resources && c.resources !== 'n/a' ? `Resources: ${c.resources}` : null, c.notes, s.confidence !== 'HIGH' ? `Source confidence: ${s.confidence}${s.gaps ? ` — ${s.gaps}` : ''}` : null]
      .filter((x): x is string => !!x)
      .map((x) => x.slice(0, 300))
      .slice(0, 10),
    sourceKeys: s.sourceKeys.slice(0, 10),
  };
}

function componentType(c: IbComponentSpec): 'PAPER' | 'WRITTEN' | 'ORAL' | 'COURSEWORK' {
  const k = kindOf(c);
  if (k === 'ORAL') return 'ORAL';
  if (c.type === 'INTERNAL' || k === 'PORTFOLIO' || k === 'PROJECT' || k === 'PERFORMANCE' || k === 'INTERNAL_ASSESSMENT') return 'COURSEWORK';
  return /^paper/i.test(c.name) ? 'PAPER' : 'WRITTEN';
}

export const structureConfigKey = (subjectKey: string, level: IbLevel) => `v2.ib.s.${subjectKey}${level === 'CORE' ? '' : `-${level.toLowerCase()}`}`;

/** STRUCTURE-ONLY configuration for one subject / level (no bank). */
export function structureConfig(s: IbSubjectSpec, level: IbLevel): ExamVerticalConfigInput | null {
  const comps = s.components.filter((c) => c.levels.includes(level));
  if (comps.length === 0 || s.sourceKeys.length === 0 || !s.firstAssessment) return null;
  const subjectName = s.name;
  return {
    key: structureConfigKey(s.key, level),
    family: 'IB',
    contentStatus: 'DEV_CERT_FIXTURE',
    structureOnly: true,
    organization: { name: 'International Baccalaureate' },
    programme: { name: 'IB Diploma Programme', type: 'CURRICULUM' },
    subject: { name: subjectName, level: level === 'CORE' ? undefined : level },
    definition: {
      name: `IB ${subjectName}${level === 'CORE' ? '' : ` ${level}`}`,
      purpose: 'Official component structure (components, timing, marks, weighting, resources) with sources. No StudyUS practice bank yet.',
    },
    version: {
      label: `V2 structure ${s.firstAssessment}`,
      examYear: Math.max(2027, s.firstAssessment),
      delivery: { navigation: 'FREE_ORDER_WITHIN_SECTION', breaks: [], itemFeedback: 'NEVER', resultReview: 'FULL', permittedResources: [] },
    },
    framework: {
      frameworkKey: `ib-dp-${s.key}`,
      curriculumVersion: (s.curriculumVersion ?? `first assessment ${s.firstAssessment}`).slice(0, 100),
      firstAssessment: s.firstAssessment,
      lastAssessment: s.lastAssessment,
      syllabusCode: null,
      frameworkVersion: String(s.firstAssessment),
      sourceKeys: s.sourceKeys.slice(0, 12),
    },
    scoring: { name: `IB ${subjectName} ${level} -- structure only`, scoringType: 'MARK_SCHEME', policy: { engine: 'exam-scoring-v1', strategy: 'RAW', transform: { type: 'NONE' }, unit: '%', provenance: FIXTURE_PROVENANCE } },
    structureLabel: `V2 structure ${s.firstAssessment}`,
    commandTerms: [],
    sections: comps.map((c) => ({
      key: sanitize(c.key),
      name: c.name.slice(0, 200),
      componentType: componentType(c),
      subject: { name: subjectName, level: level === 'CORE' ? undefined : level },
      simulationCapable: false,
      definition: componentDefinition(s, c, level),
      objectives: [{ code: `ibs.${s.key}.${level.toLowerCase()}.${sanitize(c.key)}`.slice(0, 80), description: `${c.name}: ${(c.format ?? 'component').slice(0, 900)}`, targets: [{ count: 1 }] }],
    })),
    items: [],
  };
}

/** Every IB configuration the catalogue binds to that is NOT hand-written. */
export function ibStructureConfigs(): ExamVerticalConfigInput[] {
  const out: ExamVerticalConfigInput[] = [];
  for (const s of IB_DP_SUBJECTS) {
    if (NOT_CURRENT.has(s.key) || s.key === 'cas') continue;
    for (const level of levelsOf(s)) {
      if (FULL_CONFIG_KEYS[`${s.key}:${level}`]) continue;
      const cfg = structureConfig(s, level);
      if (cfg) out.push(cfg);
    }
  }
  return out;
}

const facts = (c: IbComponentSpec, level: IbLevel, s: IbSubjectSpec): Record<string, string | number> => {
  const f: Record<string, string | number> = {};
  const def = componentDefinition(s, c, level);
  if (def.officialDurationMinutes) f.minutes = def.officialDurationMinutes;
  if (def.maxMarks) f.marks = def.maxMarks;
  if (def.weightingPercent) f.weightPercent = def.weightingPercent;
  const calc = calculatorPolicy(c);
  if (calc === 'NONE') f.calculator = 'none';
  if (calc === 'GDC_REQUIRED') f.calculator = 'GDC';
  if (calc === 'ALLOWED') f.calculator = 'allowed';
  f.assessment = c.type === 'INTERNAL' ? 'internal' : 'external';
  return f;
};

/** The IB family tree for the structure catalogue. */
export function ibCatalogTree(fullConfigSections: (configKey: string) => Array<{ key: string; officialName: string }> | null): CatalogNode {
  const levelNode = (s: IbSubjectSpec, level: IbLevel, nodePrefix: string): CatalogNode => {
    const full = FULL_CONFIG_KEYS[`${s.key}:${level}`];
    const configKey = full ?? structureConfigKey(s.key, level);
    const comps = s.components.filter((c) => c.levels.includes(level));
    const sections = full ? fullConfigSections(full) ?? [] : comps.map((c) => ({ key: sanitize(c.key), officialName: c.name }));
    const sectionNames = new Set(sections.map((x) => x.officialName.toLowerCase()));
    const key = level === 'CORE' ? nodePrefix : `${nodePrefix}.${level.toLowerCase()}`;
    const children: CatalogNode[] = sections.map((sec) => {
      const spec = comps.find((c) => c.name.toLowerCase() === sec.officialName.toLowerCase() || sanitize(c.key) === sec.key);
      return {
        key: `${key}.${sec.key}`,
        type: spec && kindOf(spec) === 'ORAL' ? 'COMPONENT' : spec && (kindOf(spec) === 'PORTFOLIO' || kindOf(spec) === 'PERFORMANCE') ? (kindOf(spec) === 'PERFORMANCE' ? 'PERFORMANCE' : 'PORTFOLIO') : spec && kindOf(spec) === 'PROJECT' ? 'PROJECT' : /paper/i.test(sec.officialName) ? 'PAPER' : 'COMPONENT',
        label: sec.officialName,
        facts: spec ? facts(spec, level, s) : undefined,
        bind: { configKey, sectionKey: sec.key },
        sourceKeys: s.sourceKeys.slice(0, 6),
      } as CatalogNode;
    });
    // Components the guide defines that a bank configuration does not simulate (e.g. internal assessment): shown, not offered.
    if (full) {
      for (const c of comps) {
        if (sectionNames.has(c.name.toLowerCase()) || sections.some((x) => x.key === sanitize(c.key))) continue;
        children.push({ key: `${key}.${sanitize(c.key)}`, type: c.type === 'INTERNAL' ? 'COMPONENT' : 'PAPER', label: c.name, facts: facts(c, level, s), description: 'Not simulated (coursework or not yet configured).', sourceKeys: s.sourceKeys.slice(0, 6) });
      }
    }
    return {
      key,
      type: level === 'CORE' ? 'SUBJECT' : 'LEVEL',
      label: level === 'CORE' ? s.name : level,
      labels: level === 'SL' ? { es: 'Nivel Medio (NM)' } : level === 'HL' ? { es: 'Nivel Superior (NS)' } : undefined,
      bind: { configKey },
      curriculumVersion: s.curriculumVersion?.slice(0, 120),
      firstAssessment: s.firstAssessment ?? undefined,
      lastAssessment: s.lastAssessment ?? undefined,
      sourceKeys: s.sourceKeys.slice(0, 6),
      children,
    };
  };

  const subjectNode = (s: IbSubjectSpec): CatalogNode => {
    const prefix = `ib.dp.${s.key}`;
    if (s.key === 'cas') {
      return { key: prefix, type: 'SUBJECT', label: s.name, notExaminable: true, description: 'Creativity, activity, service: required, not assessed with marks (no mock exam).', sourceKeys: s.sourceKeys.slice(0, 6) };
    }
    if (levelsOf(s).includes('CORE')) return levelNode(s, 'CORE', prefix);
    const pair = Object.entries(VERSION_PAIRS).find(([, base]) => base === s.key)?.[0];
    const versionLabel = (x: IbSubjectSpec) => [x.firstAssessment ? `first assessment ${x.firstAssessment}` : null, x.lastAssessment ? `last assessment ${x.lastAssessment}` : null].filter(Boolean).join(' · ');
    if (pair) {
      const next = subjectByKey(pair)!;
      return {
        key: prefix, type: 'SUBJECT', label: s.name, sourceKeys: [...s.sourceKeys, ...next.sourceKeys].slice(0, 8),
        children: [
          { key: `${prefix}.current`, type: 'VARIANT', label: `Current version (${versionLabel(s)})`, labels: { es: `Versión actual (${versionLabel(s)})` }, firstAssessment: s.firstAssessment ?? undefined, lastAssessment: s.lastAssessment ?? undefined, children: levelsOf(s).map((l) => levelNode(s, l, `${prefix}.current`)) },
          { key: `${prefix}.next`, type: 'VARIANT', label: `${next.name} (${versionLabel(next)})`, labels: { es: `${next.name} (${versionLabel(next)})` }, firstAssessment: next.firstAssessment ?? undefined, children: levelsOf(next).map((l) => levelNode(next, l, `${prefix}.next`)) },
        ],
      };
    }
    return {
      key: prefix, type: 'SUBJECT', label: s.name,
      curriculumVersion: s.curriculumVersion?.slice(0, 120), firstAssessment: s.firstAssessment ?? undefined, lastAssessment: s.lastAssessment ?? undefined, sourceKeys: s.sourceKeys.slice(0, 6),
      children: levelsOf(s).map((l) => levelNode(s, l, prefix)),
    };
  };

  const groups = ['1', '2', '3', '4', '5', '6', 'core'];
  return {
    key: 'ib.dp', type: 'PROGRAMME', label: 'IB Diploma Programme', labels: { es: 'Programa del Diploma del IB' },
    children: groups.map((g) => ({
      key: `ib.dp.g${g}`, type: 'AREA' as const, label: GROUP_LABELS[g].en, labels: { es: GROUP_LABELS[g].es },
      children: IB_DP_SUBJECTS.filter((s) => s.group === g && !NOT_CURRENT.has(s.key) && !VERSION_PAIRS[s.key]).map(subjectNode),
    })),
  };
}
