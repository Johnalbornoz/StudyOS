/**
 * Exam V2 -- assessment structure: persistence of the catalogue and the
 * dynamic, hierarchical selection the Student walks through (sections 1-2).
 *
 *   IB -> Diploma Programme -> Group 5 -> Math AA -> HL -> [Paper 1, Paper 2, Paper 3]
 *   PISA -> PISA 2022 -> Mathematics
 *   Saber 11 -> Matemáticas
 *   PAA -> Matemáticas
 *   Cambridge -> IGCSE -> 0580 -> Extended -> [Paper 2, Paper 4]
 *
 * The UI never hard-codes a level: it renders whatever children a node has,
 * in the framework's own words. A node is AVAILABLE only when it is bound to
 * a published exam version (and, for a paper, to one of its components).
 */
import { db } from '@/lib/db';
import { upsertSources } from './source-registry.service';
import { ASSESSMENT_CATALOG, flattenCatalog, type CatalogFamily, type CatalogNode } from './structure';
import { packageReadiness, modesFor, isMockReady, READINESS_MODEL, READINESS_ORDER, type ReadinessState, type ComponentReadiness } from './readiness';
import { bankInProgressSql, readinessFor, selectableSql, stateSql } from './readiness-view';
import type { ContentAudience } from '../audience';
import { assessExam } from '../question-bank/mock-certification';
import { certificationInputFromConfig } from '../question-bank/certification-input';
import type { ContentReadiness, EngineCapability } from '../fidelity';
import { parseExamVerticalConfig, type ExamVerticalConfig } from '../vertical-config';
import { allV2Configs } from '../verticals/v2/all';
import { applyBankReadinessOverlay, readinessMode } from '../question-bank/capability-overlay.service';

/** Parsed configurations by key (the catalogue binds to these). */
export function configsByKey(): Map<string, ExamVerticalConfig> {
  const out = new Map<string, ExamVerticalConfig>();
  for (const v of allV2Configs()) {
    const p = parseExamVerticalConfig(v);
    if (p.ok) out.set(p.config.key, p.config);
  }
  return out;
}

/**
 * Readiness of a catalogue node from its binding (pure). Unbound -> CATALOG_ONLY.
 * `audience` STUDENT (default): real content only; TECHNICAL_DEMO: the engine view (fixtures count).
 */
export function nodeReadiness(node: CatalogNode, configs: Map<string, ExamVerticalConfig>, audience: ContentAudience = 'STUDENT'): { state: ReadinessState; components: ComponentReadiness[]; modes: Array<'PRACTICE' | 'MOCK' | 'CHALLENGE'>; mockable: boolean } {
  if (node.notExaminable || !node.bind) return { state: 'CATALOG_ONLY', components: [], modes: [], mockable: false };
  const cfg = configs.get(node.bind.configKey);
  if (!cfg) return { state: 'CATALOG_ONLY', components: [], modes: [], mockable: false };
  const keys = node.bind.sectionKey ? [node.bind.sectionKey] : node.bind.sectionKeys;
  const r = packageReadiness(cfg, keys, node.bind.objectiveCodes, audience);
  const modes = modesFor(r.state, node.modes, { mockable: r.mockable });
  // The state shown is what this entry OFFERS: an area-practice node over a mock-ready config is "practice", never "mock available".
  const state: ReadinessState = isMockReady(r.state) && !modes.includes('MOCK') ? (modes.includes('PRACTICE') ? 'PRACTICE_READY' : 'STRUCTURE_READY') : r.state;
  return { ...r, state, modes };
}

export interface NodeFidelity {
  engineCapability: EngineCapability;
  contentReadiness: ContentReadiness;
  /** Certified (Mock Certification gate). Never inferred from length or from the engine. */
  mockReady: boolean;
  mockApplicability: string;
  assessmentSemantics: string;
  nonMockableComponents: string[];
}

/** The two dimensions of a bound node, from its configuration (pure). Unbound -> null. */
export function nodeFidelity(node: CatalogNode, configs: Map<string, ExamVerticalConfig>): NodeFidelity | null {
  if (node.notExaminable || !node.bind) return null;
  const cfg = configs.get(node.bind.configKey);
  if (!cfg) return null;
  const keys = node.bind.sectionKey ? [node.bind.sectionKey] : node.bind.sectionKeys;
  const a = assessExam(certificationInputFromConfig(cfg, keys));
  // A skill-focused entry is practice by construction: it never reproduces a paper.
  const skillOnly = !!node.bind.objectiveCodes?.length;
  return {
    engineCapability: a.engineCapability,
    contentReadiness: skillOnly && a.contentReadiness !== 'NONE' ? 'PRACTICE_READY' : a.contentReadiness,
    mockReady: !skillOnly && a.mockReady,
    mockApplicability: skillOnly ? 'NOT_APPLICABLE_SKILL_PRACTICE' : a.mockApplicability,
    assessmentSemantics: a.semantics,
    nonMockableComponents: a.nonMockableComponents,
  };
}

export interface ApplyStructureResult {
  write: boolean;
  nodes: number;
  bound: number;
  unresolvedBindings: string[];
}

export async function applyAssessmentStructure(options: { write: boolean }, families: CatalogFamily[] = ASSESSMENT_CATALOG): Promise<ApplyStructureResult> {
  const flat = flattenCatalog(families);
  const configs = configsByKey();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const sourceKeys = [...new Set(flat.flatMap((f) => f.node.sourceKeys ?? []))];
    const sourceIds = await upsertSources(client, sourceKeys);
    const idByKey = new Map<string, string>();
    const unresolved: string[] = [];
    let bound = 0;
    for (const { family, parentKey, order, node } of flat) {
      let definitionId: string | null = null;
      let versionId: string | null = null;
      let componentId: string | null = null;
      if (node.bind) {
        // Structure-only definitions stay DRAFT (out of every startable catalogue) but carry the published structure.
        const def = (await client.query(`SELECT id FROM exam_definitions WHERE config_key = $1 AND status IN ('ACTIVE', 'DRAFT')`, [node.bind.configKey])).rows[0];
        const ver = def ? (await client.query(`SELECT id FROM exam_versions WHERE exam_definition_id = $1 AND status = 'PUBLISHED' ORDER BY created_at DESC LIMIT 1`, [def.id])).rows[0] : null;
        definitionId = def?.id ?? null;
        versionId = ver?.id ?? null;
        if (ver && node.bind.sectionKey) componentId = (await client.query(`SELECT id FROM assessment_components WHERE exam_version_id = $1 AND section_key = $2`, [ver.id, node.bind.sectionKey])).rows[0]?.id ?? null;
        const ok = !!versionId && (!node.bind.sectionKey || !!componentId);
        if (ok) bound++;
        else unresolved.push(node.key);
      }
      // QB-1: Students see real-content readiness; the engine (technical demo) view is stored beside it, never instead.
      const readiness = nodeReadiness(node, configs, 'STUDENT');
      const engine = nodeReadiness(node, configs, 'TECHNICAL_DEMO');
      const fidelity = nodeFidelity(node, configs);
      const selectable = !!versionId && (!node.bind?.sectionKey || !!componentId) && readiness.modes.length > 0;
      const r = await client.query(
        `INSERT INTO assessment_structure_nodes (family, parent_id, node_key, node_type, label, labels, description, order_index, curriculum_version, first_assessment, last_assessment,
           syllabus_code, framework_version, exam_definition_id, exam_version_id, assessment_component_id, selectable, status, source_ids, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 'ACTIVE', $18, $19)
         ON CONFLICT (family, node_key) DO UPDATE SET parent_id = EXCLUDED.parent_id, node_type = EXCLUDED.node_type, label = EXCLUDED.label, labels = EXCLUDED.labels,
           description = EXCLUDED.description, order_index = EXCLUDED.order_index, curriculum_version = EXCLUDED.curriculum_version, first_assessment = EXCLUDED.first_assessment,
           last_assessment = EXCLUDED.last_assessment, syllabus_code = EXCLUDED.syllabus_code, framework_version = EXCLUDED.framework_version,
           exam_definition_id = EXCLUDED.exam_definition_id, exam_version_id = EXCLUDED.exam_version_id, assessment_component_id = EXCLUDED.assessment_component_id,
           selectable = EXCLUDED.selectable, status = 'ACTIVE', source_ids = EXCLUDED.source_ids, metadata = EXCLUDED.metadata
         RETURNING id`,
        [
          family,
          parentKey ? idByKey.get(parentKey) ?? null : null,
          node.key,
          node.type,
          node.label,
          node.labels ? JSON.stringify(node.labels) : null,
          node.description ?? null,
          order,
          node.curriculumVersion ?? null,
          node.firstAssessment ?? null,
          node.lastAssessment ?? null,
          node.syllabusCode ?? null,
          node.frameworkVersion ?? null,
          definitionId,
          versionId,
          componentId,
          selectable,
          (node.sourceKeys ?? []).map((k) => sourceIds.get(k)!).filter(Boolean),
          JSON.stringify({
            facts: node.facts ?? null, bind: node.bind ?? null, purpose: node.purpose ?? null, notExaminable: !!node.notExaminable,
            readiness: { model: READINESS_MODEL, audience: 'STUDENT', state: readiness.state, modes: readiness.modes, components: readiness.components, bankInProgress: readiness.components.some((c) => c.bankInProgress), mockable: readiness.mockable },
            engineReadiness: { model: READINESS_MODEL, audience: 'TECHNICAL_DEMO', state: engine.state, modes: engine.modes, components: engine.components, mockable: engine.mockable },
            fidelity,
          }),
        ]
      );
      idByKey.set(node.key, r.rows[0].id);
    }
    // Nodes removed from the catalogue are retired, never deleted (instances may reference them).
    await client.query(`UPDATE assessment_structure_nodes SET status = 'RETIRED', selectable = false WHERE NOT (node_key = ANY($1::text[]))`, [flat.map((f) => f.node.key)]);
    await client.query(options.write ? 'COMMIT' : 'ROLLBACK');
    return { write: options.write, nodes: flat.length, bound, unresolvedBindings: unresolved };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export interface StructureNodeView {
  key: string;
  family: string;
  type: CatalogNode['type'];
  label: string;
  description: string | null;
  facts: Record<string, string | number> | null;
  /** Bound to a published exam version (this node, or for a paper: its component). */
  available: boolean;
  /** The node where the Student picks papers / components and a mode. */
  isExamLevel: boolean;
  /** CATALOG_ONLY | STRUCTURE_READY | PRACTICE_READY | REDUCED_MOCK_READY | FULL_MOCK_READY (own binding, else best descendant). */
  readiness: ReadinessState;
  /** Structure configured and some valid items, not yet enough to practise ("Banco en preparación"). */
  bankInProgress: boolean;
  /** Own binding's bank: valid items, positions of one form, form length vs official (null: not published / not bound). */
  bank: { items: number; positions: number; lengthCoveragePercent: number | null } | null;
  purpose: 'FULL_TEST' | 'AREA_PRACTICE' | 'SKILL_PRACTICE' | null;
  notExaminable: boolean;
  hasChildren: boolean;
  versioning: { curriculumVersion: string | null; firstAssessment: number | null; lastAssessment: number | null; syllabusCode: string | null; frameworkVersion: string | null };
  sources: Array<{ title: string; publisher: string | null; url: string | null; confidence: string }>;
}

const COMPONENT_NODE_TYPES = new Set(['PAPER', 'COMPONENT', 'PORTFOLIO', 'PERFORMANCE', 'PROJECT', 'SECTION']);

function localized(labels: Record<string, string> | null, label: string, language: string): string {
  return (labels && labels[language]) || label;
}

export async function listStructureFamilies(audience: ContentAudience = 'STUDENT'): Promise<Array<{ family: string; roots: number; available: boolean }>> {
  const r = await db.query(
    `SELECT n.family, count(*) FILTER (WHERE n.parent_id IS NULL)::int AS roots, bool_or(${selectableSql('n', audience)}) AS available
       FROM assessment_structure_nodes n WHERE n.status = 'ACTIVE' GROUP BY n.family ORDER BY n.family`
  );
  return r.rows.map((x: any) => ({ family: x.family, roots: x.roots, available: !!x.available }));
}

export async function listStructureChildren(params: { family: string; parentKey: string | null; language: string; /** In-process scenarios only: the engine view. */ audience?: ContentAudience }): Promise<StructureNodeView[]> {
  const audience = params.audience ?? 'STUDENT';
  const r = await db.query(
    `SELECT n.*, (SELECT count(*) FROM assessment_structure_nodes c WHERE c.parent_id = n.id AND c.status = 'ACTIVE')::int AS child_count,
            (WITH RECURSIVE sub AS (
               SELECT c.id, ${selectableSql('c', audience)} AS selectable, c.metadata FROM assessment_structure_nodes c WHERE c.parent_id = n.id AND c.status = 'ACTIVE'
               UNION ALL
               SELECT c.id, ${selectableSql('c', audience)} AS selectable, c.metadata FROM assessment_structure_nodes c JOIN sub ON c.parent_id = sub.id WHERE c.status = 'ACTIVE'
             ) SELECT bool_or(selectable) FROM sub) AS descendant_selectable,
            (WITH RECURSIVE sub AS (
               SELECT c.id, c.metadata FROM assessment_structure_nodes c WHERE c.parent_id = n.id AND c.status = 'ACTIVE'
               UNION ALL
               SELECT c.id, c.metadata FROM assessment_structure_nodes c JOIN sub ON c.parent_id = sub.id WHERE c.status = 'ACTIVE'
             ) SELECT array_agg(DISTINCT ${stateSql('sub', audience)}) FROM sub) AS descendant_states,
            (WITH RECURSIVE sub AS (
               SELECT c.id, c.metadata FROM assessment_structure_nodes c WHERE c.parent_id = n.id AND c.status = 'ACTIVE'
               UNION ALL
               SELECT c.id, c.metadata FROM assessment_structure_nodes c JOIN sub ON c.parent_id = sub.id WHERE c.status = 'ACTIVE'
             ) SELECT bool_or(${bankInProgressSql('sub', audience)}) FROM sub) AS descendant_bank,
            COALESCE((SELECT json_agg(json_build_object('title', s.title, 'publisher', s.publisher, 'url', s.url, 'confidence', s.confidence) ORDER BY s.source_key)
                        FROM assessment_sources s WHERE s.id = ANY(n.source_ids)), '[]'::json) AS sources
       FROM assessment_structure_nodes n
       LEFT JOIN assessment_structure_nodes p ON p.id = n.parent_id
      WHERE n.family = $1 AND n.status = 'ACTIVE' AND (($2::text IS NULL AND n.parent_id IS NULL) OR p.node_key = $2)
      ORDER BY n.order_index, n.label`,
    [params.family, params.parentKey]
  );
  return r.rows.map((row: any) => {
    // QB-1: the audience's readiness view (a pre-QB-1 row is never a Student truth).
    const view = readinessFor(row, audience);
    const n = { ...row, selectable: view.selectable, metadata: { ...row.metadata, readiness: view.readiness } };
    const bind = n.metadata?.bind ?? null;
    // The exam level is the bound node above the components (IB HL, Cambridge Extended, PISA Mathematics...).
    const isExamLevel = !!bind && !COMPONENT_NODE_TYPES.has(n.node_type);
    const order = READINESS_ORDER;
    const states: ReadinessState[] = [n.metadata?.readiness?.state, ...((n.descendant_states as string[] | null) ?? [])].filter((x): x is ReadinessState => order.includes(x as ReadinessState));
    const readiness = states.reduce<ReadinessState>((best, s) => (order.indexOf(s) > order.indexOf(best) ? s : best), 'CATALOG_ONLY');
    const own = n.metadata?.readiness as { components?: ComponentReadiness[]; bankInProgress?: boolean } | undefined;
    const comps = own?.components ?? [];
    const lengths = comps.map((c) => c.lengthCoveragePercent).filter((x): x is number => x !== null && x !== undefined);
    return {
      readiness,
      bankInProgress: readiness === 'STRUCTURE_READY' && (!!own?.bankInProgress || !!n.descendant_bank),
      bank: comps.length ? { items: comps.reduce((a, c) => a + (c.bankItems ?? 0), 0), positions: comps.reduce((a, c) => a + (c.requiredPositions ?? 0), 0), lengthCoveragePercent: lengths.length === comps.length ? Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length) : null } : null,
      purpose: n.metadata?.purpose ?? null,
      notExaminable: !!n.metadata?.notExaminable,
      key: n.node_key,
      family: n.family,
      type: n.node_type,
      label: localized(n.labels, n.label, params.language),
      description: n.description,
      facts: n.metadata?.facts ?? null,
      available: !!n.selectable || !!n.descendant_selectable,
      isExamLevel: !!isExamLevel && !!n.selectable,
      hasChildren: n.child_count > 0,
      versioning: { curriculumVersion: n.curriculum_version, firstAssessment: n.first_assessment, lastAssessment: n.last_assessment, syllabusCode: n.syllabus_code, frameworkVersion: n.framework_version },
      sources: n.sources ?? [],
    };
  });
}

export interface ExamLevelSelection {
  nodeKey: string;
  family: string;
  label: string;
  purpose: 'FULL_TEST' | 'AREA_PRACTICE' | 'SKILL_PRACTICE' | null;
  examDefinitionId: string;
  examVersionId: string;
  /** Modes this entry offers, already filtered by readiness. */
  modes: Array<'PRACTICE' | 'MOCK' | 'CHALLENGE'>;
  readiness: ReadinessState;
  /** Skill-level practice: the objectives the instance is restricted to. */
  focusObjectiveIds: string[];
  /** A full test = all components together, never a pick of some. */
  componentsFixed: boolean;
  components: Array<{ componentId: string; nodeKey: string | null; name: string; facts: Record<string, string | number> | null; untimed: boolean; kind: string | null; readiness: ReadinessState; officialMinutes: number | null; officialItems: number | null; officialMarks: number | null; calculator: string | null; plannedMinutes: number | null }>;
  /**
   * Official assessment routes (e.g. Cambridge 9709 AS: P1+P2 / P1+P4 / P1+P5; A Level linear or staged).
   * Empty when the framework defines none. A Mock / Challenge must take exactly one option.
   */
  routes: Array<{ key: string; label: string; componentIds: string[]; stage: number | null; stageCount: number | null }>;
  /** "Sobre esta área": the entry's own description (framework words), when it has one. */
  description: string | null;
  /** Bank of this entry: valid items, positions of one form, form length vs official (null: not published). */
  bank: { items: number; positions: number; lengthCoveragePercent: number | null } | null;
}

/**
 * Resolves an exam-level node (bound to a vertical, e.g. "Math AA HL") into
 * its published version and the components the Student may pick.
 */
export async function resolveExamLevel(nodeKey: string, language: string, internal: { /** In-process scenarios only (never a Student route): the engine view. */ audience?: ContentAudience } = {}): Promise<ExamLevelSelection | null> {
  const audience = internal.audience ?? 'STUDENT';
  // Question Bank: in ENFORCE mode a node's readiness / selectability comes from the latest bank-health snapshot (same overlay as the capabilities).
  const enforce = readinessMode() === 'ENFORCE';
  const raw = (await db.query(`SELECT * FROM assessment_structure_nodes WHERE node_key = $1 AND status = 'ACTIVE' AND (selectable = true OR $2) LIMIT 1`, [nodeKey, enforce || audience === 'TECHNICAL_DEMO'])).rows[0];
  // Student: the QB-1 view (fixture-derived rows never offer modes) + the bank overlay. Technical demo: the engine view.
  const n = !raw ? null : audience === 'TECHNICAL_DEMO' ? (() => { const v = readinessFor(raw, 'TECHNICAL_DEMO'); return { ...raw, selectable: v.selectable, metadata: { ...raw.metadata, readiness: v.readiness } }; })() : (await applyBankReadinessOverlay([raw]))[0];
  if (!n || !n.selectable || !n.exam_version_id) return null;
  const bind = n.metadata?.bind ?? {};
  const readiness = n.metadata?.readiness ?? { state: 'CATALOG_ONLY', modes: [], components: [] };
  const comps = await db.query(
    `SELECT ac.id, ac.name, ac.section_key, ac.duration_minutes, ac.timing_status, ac.definition, ac.simulation_capable, ac.max_marks,
            (SELECT c.node_key FROM assessment_structure_nodes c WHERE c.assessment_component_id = ac.id AND c.status = 'ACTIVE' LIMIT 1) AS node_key,
            (SELECT c.metadata FROM assessment_structure_nodes c WHERE c.assessment_component_id = ac.id AND c.status = 'ACTIVE' LIMIT 1) AS node_metadata
       FROM assessment_components ac WHERE ac.exam_version_id = $1 AND ac.simulation_capable = true ORDER BY ac.sequence_order NULLS LAST, ac.created_at`,
    [n.exam_version_id]
  );
  // A node bound to one component (PISA domain, Saber area, PAA area) or a declared set offers only those.
  const sectionKeys: string[] | null = bind.sectionKey ? [bind.sectionKey] : bind.sectionKeys ?? null;
  let focusObjectiveIds: string[] = [];
  if (Array.isArray(bind.objectiveCodes) && bind.objectiveCodes.length) {
    const r = await db.query(
      `SELECT DISTINCT lo.id FROM blueprint_objective_targets t JOIN assessment_blueprints b ON b.id = t.blueprint_id
         JOIN learning_objectives lo ON lo.id = t.learning_objective_id WHERE b.exam_version_id = $1 AND lo.code = ANY($2::text[])`,
      [n.exam_version_id, bind.objectiveCodes]
    );
    focusObjectiveIds = r.rows.map((x: any) => x.id);
  }
  const compReadiness = new Map<string, ReadinessState>((readiness.components ?? []).map((c: any) => [c.sectionKey, c.state]));
  const rules = (await db.query(`SELECT navigation_rules FROM exam_versions WHERE id = $1`, [n.exam_version_id])).rows[0]?.navigation_rules ?? {};
  const idByKey = new Map<string, string>(comps.rows.map((c: any) => [c.section_key, c.id]));
  const toIds = (keys: string[]) => (keys.every((k) => idByKey.has(k)) ? keys.map((k) => idByKey.get(k)!) : null);
  const routes: ExamLevelSelection['routes'] = [];
  for (const r of (rules.assessmentRoutes ?? []) as Array<{ key: string; label: string; componentSets: string[][]; stages?: string[][][] }>) {
    if (r.stages?.length) {
      for (const stages of r.stages) stages.forEach((set, i) => { const ids = toIds(set); if (ids) routes.push({ key: r.key, label: r.label, componentIds: ids, stage: i + 1, stageCount: stages.length }); });
    }
    for (const set of r.componentSets) { const ids = toIds(set); if (ids) routes.push({ key: r.key, label: r.label, componentIds: ids, stage: null, stageCount: null }); }
  }
  return {
    nodeKey,
    family: n.family,
    label: localized(n.labels, n.label, language),
    purpose: n.metadata?.purpose ?? null,
    examDefinitionId: n.exam_definition_id,
    examVersionId: n.exam_version_id,
    modes: readiness.modes ?? [],
    readiness: readiness.state,
    focusObjectiveIds,
    componentsFixed: n.metadata?.purpose === 'FULL_TEST',
    components: comps.rows
      .filter((c: any) => !sectionKeys || sectionKeys.includes(c.section_key))
      .map((c: any) => ({
        componentId: c.id,
        nodeKey: c.node_key,
        name: c.definition?.officialName ?? c.name,
        facts: c.node_metadata?.facts ?? null,
        untimed: c.timing_status !== 'CONFIGURED' || c.duration_minutes === null,
        kind: c.definition?.kind ?? null,
        readiness: compReadiness.get(c.section_key) ?? 'CATALOG_ONLY',
        officialMinutes: c.definition?.officialDurationMinutes ?? null,
        officialItems: c.definition?.officialItemCount ?? null,
        officialMarks: c.max_marks === null ? null : Number(c.max_marks),
        calculator: c.definition?.calculatorPolicy ?? null,
        plannedMinutes: c.duration_minutes ?? null,
      })),
    routes,
    description: n.description ?? null,
    bank: (() => {
      const cs = (readiness.components ?? []) as ComponentReadiness[];
      if (!cs.length) return null;
      const lengths = cs.map((c) => c.lengthCoveragePercent).filter((x): x is number => x !== null && x !== undefined);
      return { items: cs.reduce((a, c) => a + (c.bankItems ?? 0), 0), positions: cs.reduce((a, c) => a + (c.requiredPositions ?? 0), 0), lengthCoveragePercent: lengths.length === cs.length ? Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length) : null };
    })(),
  };
}
