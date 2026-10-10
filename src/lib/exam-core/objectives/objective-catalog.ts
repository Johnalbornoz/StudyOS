/**
 * Exam preparation, objective first -- WHAT a Student can choose to prepare for.
 *
 *   "Exam availability ≠ activity availability."
 *
 * Every governed catalogue entry that is an exam (or an examined subject
 * level, or a programme with its own planner) is a preparation OBJECTIVE,
 * whatever its readiness. Readiness never decides whether an objective can be
 * chosen; it only decides which activities exist inside the preparation
 * (see capabilities.ts).
 *
 * The objective level follows each framework's own structure, never one
 * generic hierarchy:
 *
 *   PAA                      -> the whole test (areas live inside the preparation)
 *   PISA 2022                -> the whole test (domains live inside)
 *   Saber 11                 -> the whole test (areas live inside)
 *   IB Diploma Programme     -> Subject -> SL / HL (TOK and EE: the subject itself)
 *   Cambridge IGCSE          -> Subject -> Core / Extended
 *   Cambridge AS & A Level   -> Subject (syllabus code) -> AS Level / A Level
 *   Cambridge AICE Diploma   -> the Diploma Planner (a group award, not an exam)
 *
 * A Cambridge subject listed in several AICE groups is ONE qualification:
 * its objective key is the syllabus code and level, whatever group node it
 * was reached from. Pure: built from the code catalogue only.
 */
import { ASSESSMENT_CATALOG, type CatalogFamily, type CatalogNode } from '../catalog/structure';

export type ObjectiveFramework = 'PAA' | 'PISA' | 'SABER11' | 'IB_DP' | 'CIE_IGCSE' | 'CIE_AS_A' | 'CIE_AICE';
export type ObjectiveKind = 'EXAM' | 'SUBJECT_LEVEL' | 'PROGRAMME_PLAN';

/** Order of the framework cards, and the region each framework belongs to (filters). */
export const OBJECTIVE_FRAMEWORKS: Array<{ key: ObjectiveFramework; region: 'INTERNATIONAL' | 'CO' | 'PR_LATAM' }> = [
  { key: 'PAA', region: 'PR_LATAM' },
  { key: 'SABER11', region: 'CO' },
  { key: 'PISA', region: 'INTERNATIONAL' },
  { key: 'IB_DP', region: 'INTERNATIONAL' },
  { key: 'CIE_IGCSE', region: 'INTERNATIONAL' },
  { key: 'CIE_AS_A', region: 'INTERNATIONAL' },
  { key: 'CIE_AICE', region: 'INTERNATIONAL' },
];

/**
 * T1 final delta (B1) -- catalogue FAMILIES shown as ONE entry on the landing: the awarding body first,
 * then its programmes. Cambridge International -> IGCSE / International AS & A Level / AICE Diploma.
 * Frameworks, qualifications, syllabus codes, levels and series availability are unchanged underneath.
 */
export const OBJECTIVE_FAMILIES: Array<{ key: 'CAMBRIDGE'; frameworks: ObjectiveFramework[] }> = [
  { key: 'CAMBRIDGE', frameworks: ['CIE_IGCSE', 'CIE_AS_A', 'CIE_AICE'] },
];
export function familyOfFramework(framework: string): string | null {
  return OBJECTIVE_FAMILIES.find((f) => (f.frameworks as string[]).includes(framework))?.key ?? null;
}

export interface ExamObjective {
  /** Canonical identity of the objective (stored on the preparation profile). */
  key: string;
  framework: ObjectiveFramework;
  /** Catalogue family of its nodes (assessment_structure_nodes.family). */
  family: CatalogFamily['family'];
  kind: ObjectiveKind;
  /** Primary catalogue node, and every node that is the same objective (AICE multi-group subjects). */
  nodeKey: string;
  nodeKeys: string[];
  label: string;
  labels: Partial<Record<'es' | 'en' | 'pt' | 'fr' | 'de', string>>;
  /** Framework context, in the framework's own words (shown to tell options apart). */
  context: { programme: string | null; groups: string[]; subject: string | null; syllabusCode: string | null; level: string | null; version: string | null };
  description: string | null;
  /** Every configured vertical bound inside the objective (its activities and requirements come from these). */
  configKeys: string[];
  /** Real catalogue children with sourced facts (papers, components, areas, domains) -- never invented. */
  /** `labelEn` (M03c): the catalogue's English name of the part, when `label` is its Spanish one. Display only. */
  catalogParts: Array<{ key: string; type: CatalogNode['type']; label: string; labelEn?: string; facts: Record<string, string | number> | null }>;
  sourceKeys: string[];
  /** Lower-cased text the search matches against. */
  searchText: string;
  /** Catalogue SUBJECT node the objective belongs to (null for whole-test / planner objectives). */
  subjectNodeKey: string | null;
  /**
   * T1 UI polish (M03c): the catalogue's own names of `context.groups`, per language, in the same order
   * ("Group 1: Mathematics and Sciences" / "Group 1: Matemáticas y Ciencias"). Display only -- `context.groups`
   * (what is stored with a preparation) is unchanged.
   */
  groupNames: Array<{ es: string; en: string }>;
}

const PART_TYPES = new Set<CatalogNode['type']>(['PAPER', 'COMPONENT', 'PORTFOLIO', 'PERFORMANCE', 'PROJECT', 'SECTION', 'AREA', 'DOMAIN', 'VARIANT']);

/**
 * Where the objective sits in each framework -- configuration, not branching:
 *   TEST            the whole test is the objective (its areas / domains live inside)
 *   SUBJECT_LEVEL   Subject -> level / tier is the objective
 * `planner`: the programme itself is also an objective (a planner, not an exam);
 * `subjectFramework`: the framework its subject levels belong to.
 */
interface FrameworkRule { rootKey: string | RegExp; framework: ObjectiveFramework; objectiveLevel: 'TEST' | 'SUBJECT_LEVEL'; planner?: { key: string }; subjectFramework?: ObjectiveFramework; canonicalSubjectKey?: (syllabusCode: string, levelNodeKey: string) => string }
const FRAMEWORK_RULES: FrameworkRule[] = [
  { rootKey: 'paa', framework: 'PAA', objectiveLevel: 'TEST' },
  { rootKey: /^pisa\./, framework: 'PISA', objectiveLevel: 'TEST' },
  { rootKey: 'saber11', framework: 'SABER11', objectiveLevel: 'TEST' },
  { rootKey: 'ib.dp', framework: 'IB_DP', objectiveLevel: 'SUBJECT_LEVEL' },
  { rootKey: 'cie.igcse', framework: 'CIE_IGCSE', objectiveLevel: 'SUBJECT_LEVEL' },
  {
    rootKey: 'cie.aice', framework: 'CIE_AICE', objectiveLevel: 'SUBJECT_LEVEL', planner: { key: 'cie.aice.diploma' }, subjectFramework: 'CIE_AS_A',
    // One Cambridge qualification per syllabus code and level, whatever AICE group it is listed under.
    canonicalSubjectKey: (code, levelKey) => `cie.asal.${code}.${levelKey.endsWith('.as') ? 'as' : 'a'}`,
  },
];
function ruleOfRoot(root: CatalogNode): FrameworkRule | null {
  return FRAMEWORK_RULES.find((r) => (typeof r.rootKey === 'string' ? r.rootKey === root.key : r.rootKey.test(root.key))) ?? null;
}

function walk(n: CatalogNode, visit: (n: CatalogNode) => void) {
  visit(n);
  for (const c of n.children ?? []) walk(c, visit);
}
function bindKeys(n: CatalogNode): string[] {
  const out = new Set<string>();
  walk(n, (x) => { if (x.bind) out.add(x.bind.configKey); });
  return [...out];
}
function parts(n: CatalogNode): ExamObjective['catalogParts'] {
  const kids = (n.children ?? []).filter((c) => PART_TYPES.has(c.type) && !c.notExaminable);
  return kids.map((c) => ({ key: c.key, type: c.type, label: c.labels?.es ?? c.label, labelEn: c.label, facts: c.facts ?? null }));
}
function versionText(n: CatalogNode, parent?: CatalogNode): string | null {
  const v = n.frameworkVersion ?? parent?.frameworkVersion ?? null;
  const a = n.firstAssessment ?? parent?.firstAssessment;
  const b = n.lastAssessment ?? parent?.lastAssessment;
  if (a && b) return a === b ? `${v ?? a}` : `${v ? `${v} · ` : ''}${a}–${b}`;
  return v;
}
const strip = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Every preparation objective of the catalogue, in framework order. */
export function listExamObjectives(families: CatalogFamily[] = ASSESSMENT_CATALOG): ExamObjective[] {
  const out = new Map<string, ExamObjective>();
  const add = (o: Omit<ExamObjective, 'searchText' | 'nodeKeys' | 'subjectNodeKey' | 'groupNames'> & { nodeKeys?: string[]; subjectNodeKey?: string | null; groupNames?: Array<{ es: string; en: string }> }) => {
    const prev = out.get(o.key);
    if (prev) {
      // Same qualification reached from another group: one objective, every group named.
      prev.nodeKeys.push(o.nodeKey);
      o.context.groups.forEach((g, i) => {
        if (prev.context.groups.includes(g)) return;
        prev.context.groups.push(g);
        prev.groupNames.push(o.groupNames?.[i] ?? { es: g, en: g });
      });
      for (const k of o.configKeys) if (!prev.configKeys.includes(k)) prev.configKeys.push(k);
      prev.searchText = strip([prev.searchText, ...o.context.groups].join(' '));
      return;
    }
    const full: ExamObjective = { ...o, nodeKeys: o.nodeKeys ?? [o.nodeKey], searchText: '', subjectNodeKey: o.subjectNodeKey ?? null, groupNames: o.groupNames ?? o.context.groups.map((g) => ({ es: g, en: g })) };
    full.searchText = strip([o.label, o.labels.es, o.labels.en, o.context.programme, o.context.subject, o.context.syllabusCode, o.context.level, ...o.context.groups, o.framework].filter(Boolean).join(' '));
    out.set(o.key, full);
  };

  for (const fam of families) {
    for (const root of fam.roots) {
      const rule = ruleOfRoot(root);
      if (!rule) continue;
      const framework = rule.framework;
      if (rule.objectiveLevel === 'TEST') {
        // The test is the objective; areas / domains are inside the preparation.
        add({
          key: root.key, framework, family: fam.family, kind: 'EXAM', nodeKey: root.key, label: root.label, labels: root.labels ?? {},
          context: { programme: null, groups: [], subject: null, syllabusCode: null, level: null, version: versionText(root) },
          description: root.description ?? null, configKeys: bindKeys(root), catalogParts: parts(root).filter((p) => !p.key.endsWith('.full') && !p.key.endsWith('.practice')).concat(
            (root.children ?? []).filter((c) => c.key.endsWith('.practice')).flatMap((c) => parts(c))
          ),
          sourceKeys: root.sourceKeys ?? [],
        });
        continue;
      }
      if (rule.planner) {
        add({
          key: rule.planner.key, framework, family: fam.family, kind: 'PROGRAMME_PLAN', nodeKey: root.key, label: root.label, labels: root.labels ?? {},
          context: { programme: root.label, groups: [], subject: null, syllabusCode: null, level: null, version: null },
          description: root.description ?? null, configKeys: [], catalogParts: (root.children ?? []).map((g) => ({ key: g.key, type: g.type, label: g.labels?.es ?? g.label, labelEn: g.label, facts: null })),
          sourceKeys: root.sourceKeys ?? [],
        });
      }
      const fw: ObjectiveFramework = rule.subjectFramework ?? framework;
      const programmeOf = rule.subjectFramework ? 'Cambridge International AS & A Level' : root.label;
      // Programmes and qualifications made of subjects: the subject level is the objective.
      const visitSubjects = (n: CatalogNode, groups: CatalogNode[]) => {
        if (n.type === 'SUBJECT') {
          if (n.notExaminable) return;
          const levels = (n.children ?? []).filter((c) => c.type === 'LEVEL' || c.type === 'VARIANT');
          const group = groups[groups.length - 1];
          const groupLabel = group ? group.labels?.es ?? group.label : null;
          const groupNames = group ? [{ es: group.labels?.es ?? group.label, en: group.label }] : [];
          const subjectLabel = n.labels?.es ?? n.label;
          if (levels.length === 0) {
            add({
              key: n.key, framework: fw, family: fam.family, kind: 'SUBJECT_LEVEL', nodeKey: n.key, label: subjectLabel, labels: n.labels ?? {},
              context: { programme: programmeOf, groups: groupLabel ? [groupLabel] : [], subject: subjectLabel, syllabusCode: n.syllabusCode ?? null, level: null, version: versionText(n) },
              description: n.description ?? null, configKeys: bindKeys(n), catalogParts: parts(n), sourceKeys: n.sourceKeys ?? [], subjectNodeKey: n.key, groupNames,
            });
            return;
          }
          for (const lv of levels) {
            const levelLabel = lv.labels?.es ?? lv.label;
            const key = rule.canonicalSubjectKey && n.syllabusCode ? rule.canonicalSubjectKey(n.syllabusCode, lv.key) : lv.key;
            add({
              key, framework: fw, family: fam.family, kind: 'SUBJECT_LEVEL', nodeKey: lv.key, label: `${subjectLabel} · ${levelLabel}`, labels: {},
              context: { programme: programmeOf, groups: groupLabel ? [groupLabel] : [], subject: subjectLabel, syllabusCode: n.syllabusCode ?? lv.syllabusCode ?? null, level: levelLabel, version: versionText(lv, n) },
              description: n.description ?? null, configKeys: bindKeys(lv), catalogParts: parts(lv), sourceKeys: lv.sourceKeys ?? n.sourceKeys ?? [], subjectNodeKey: n.key, groupNames,
            });
          }
          return;
        }
        for (const c of n.children ?? []) visitSubjects(c, n.type === 'AREA' ? [...groups, n] : groups);
      };
      visitSubjects(root, []);
    }
  }
  return [...out.values()];
}

let cache: { list: ExamObjective[]; byKey: Map<string, ExamObjective>; byNode: Map<string, ExamObjective>; byConfig: Map<string, ExamObjective> } | null = null;
function index() {
  if (!cache) {
    const list = listExamObjectives();
    const byKey = new Map(list.map((o) => [o.key, o]));
    const byNode = new Map<string, ExamObjective>();
    const byConfig = new Map<string, ExamObjective>();
    for (const o of list) {
      for (const k of o.nodeKeys) byNode.set(k, o);
      for (const c of o.configKeys) if (!byConfig.has(c)) byConfig.set(c, o);
    }
    cache = { list, byKey, byNode, byConfig };
  }
  return cache;
}

export const examObjectives = (): ExamObjective[] => index().list;
export const objectiveByKey = (key: string): ExamObjective | null => index().byKey.get(key) ?? null;
/** The objective a catalogue node belongs to (the node itself, or its closest objective ancestor). */
export function objectiveForNode(nodeKey: string): ExamObjective | null {
  const { byNode, list } = index();
  if (byNode.has(nodeKey)) return byNode.get(nodeKey)!;
  // A descendant (paper, area, skill...): the objective whose node key prefixes it.
  let best: ExamObjective | null = null;
  for (const o of list) for (const k of o.nodeKeys) if (nodeKey.startsWith(`${k}.`) && (!best || k.length > best.nodeKey.length)) best = o;
  return best;
}
/** The objective a configured vertical belongs to (e.g. v2.aice.9709-as -> Mathematics 9709 AS Level). */
export const objectiveForConfig = (configKey: string): ExamObjective | null => index().byConfig.get(configKey) ?? null;

/** Search over every objective (accent- and case-insensitive; every word must match). */
export function searchObjectives(q: string, list: ExamObjective[] = examObjectives()): ExamObjective[] {
  const words = strip(q).split(/\s+/).filter(Boolean);
  if (!words.length) return list;
  return list.filter((o) => words.every((w) => o.searchText.includes(w)));
}
