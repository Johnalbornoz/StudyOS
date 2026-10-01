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

export interface ApplyStructureResult {
  write: boolean;
  nodes: number;
  bound: number;
  unresolvedBindings: string[];
}

export async function applyAssessmentStructure(options: { write: boolean }, families: CatalogFamily[] = ASSESSMENT_CATALOG): Promise<ApplyStructureResult> {
  const flat = flattenCatalog(families);
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
        const def = (await client.query(`SELECT id FROM exam_definitions WHERE config_key = $1 AND status = 'ACTIVE'`, [node.bind.configKey])).rows[0];
        const ver = def ? (await client.query(`SELECT id FROM exam_versions WHERE exam_definition_id = $1 AND status = 'PUBLISHED' ORDER BY created_at DESC LIMIT 1`, [def.id])).rows[0] : null;
        definitionId = def?.id ?? null;
        versionId = ver?.id ?? null;
        if (ver && node.bind.sectionKey) componentId = (await client.query(`SELECT id FROM assessment_components WHERE exam_version_id = $1 AND section_key = $2`, [ver.id, node.bind.sectionKey])).rows[0]?.id ?? null;
        const ok = !!versionId && (!node.bind.sectionKey || !!componentId);
        if (ok) bound++;
        else unresolved.push(node.key);
      }
      const selectable = !!versionId && (!node.bind?.sectionKey || !!componentId);
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
          JSON.stringify({ facts: node.facts ?? null, bind: node.bind ?? null }),
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
  hasChildren: boolean;
  versioning: { curriculumVersion: string | null; firstAssessment: number | null; lastAssessment: number | null; syllabusCode: string | null; frameworkVersion: string | null };
  sources: Array<{ title: string; publisher: string | null; url: string | null; confidence: string }>;
}

const COMPONENT_NODE_TYPES = new Set(['PAPER', 'COMPONENT', 'PORTFOLIO', 'PERFORMANCE', 'PROJECT', 'SECTION']);

function localized(labels: Record<string, string> | null, label: string, language: string): string {
  return (labels && labels[language]) || label;
}

export async function listStructureFamilies(): Promise<Array<{ family: string; roots: number; available: boolean }>> {
  const r = await db.query(
    `SELECT family, count(*) FILTER (WHERE parent_id IS NULL)::int AS roots, bool_or(selectable) AS available
       FROM assessment_structure_nodes WHERE status = 'ACTIVE' GROUP BY family ORDER BY family`
  );
  return r.rows.map((x: any) => ({ family: x.family, roots: x.roots, available: !!x.available }));
}

export async function listStructureChildren(params: { family: string; parentKey: string | null; language: string }): Promise<StructureNodeView[]> {
  const r = await db.query(
    `SELECT n.*, (SELECT count(*) FROM assessment_structure_nodes c WHERE c.parent_id = n.id AND c.status = 'ACTIVE')::int AS child_count,
            (WITH RECURSIVE sub AS (
               SELECT c.id, c.selectable FROM assessment_structure_nodes c WHERE c.parent_id = n.id AND c.status = 'ACTIVE'
               UNION ALL
               SELECT c.id, c.selectable FROM assessment_structure_nodes c JOIN sub ON c.parent_id = sub.id WHERE c.status = 'ACTIVE'
             ) SELECT bool_or(selectable) FROM sub) AS descendant_selectable,
            COALESCE((SELECT json_agg(json_build_object('title', s.title, 'publisher', s.publisher, 'url', s.url, 'confidence', s.confidence) ORDER BY s.source_key)
                        FROM assessment_sources s WHERE s.id = ANY(n.source_ids)), '[]'::json) AS sources
       FROM assessment_structure_nodes n
       LEFT JOIN assessment_structure_nodes p ON p.id = n.parent_id
      WHERE n.family = $1 AND n.status = 'ACTIVE' AND (($2::text IS NULL AND n.parent_id IS NULL) OR p.node_key = $2)
      ORDER BY n.order_index, n.label`,
    [params.family, params.parentKey]
  );
  return r.rows.map((n: any) => {
    const bind = n.metadata?.bind ?? null;
    // The exam level is the bound node above the components (IB HL, Cambridge Extended, PISA Mathematics...).
    const isExamLevel = !!bind && !COMPONENT_NODE_TYPES.has(n.node_type);
    return {
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
  examDefinitionId: string;
  examVersionId: string;
  components: Array<{ componentId: string; nodeKey: string | null; name: string; facts: Record<string, string | number> | null; untimed: boolean; kind: string | null }>;
}

/**
 * Resolves an exam-level node (bound to a vertical, e.g. "Math AA HL") into
 * its published version and the components the Student may pick.
 */
export async function resolveExamLevel(nodeKey: string, language: string): Promise<ExamLevelSelection | null> {
  const n = (await db.query(`SELECT * FROM assessment_structure_nodes WHERE node_key = $1 AND status = 'ACTIVE' AND selectable = true LIMIT 1`, [nodeKey])).rows[0];
  if (!n || !n.exam_version_id) return null;
  const comps = await db.query(
    `SELECT ac.id, ac.name, ac.section_key, ac.duration_minutes, ac.timing_status, ac.definition, ac.simulation_capable,
            (SELECT c.node_key FROM assessment_structure_nodes c WHERE c.assessment_component_id = ac.id AND c.status = 'ACTIVE' LIMIT 1) AS node_key,
            (SELECT c.metadata FROM assessment_structure_nodes c WHERE c.assessment_component_id = ac.id AND c.status = 'ACTIVE' LIMIT 1) AS node_metadata
       FROM assessment_components ac WHERE ac.exam_version_id = $1 AND ac.simulation_capable = true ORDER BY ac.sequence_order NULLS LAST, ac.created_at`,
    [n.exam_version_id]
  );
  // A node bound to one component (PISA domain, Saber area) offers only that component.
  const only = n.assessment_component_id as string | null;
  return {
    nodeKey,
    family: n.family,
    label: localized(n.labels, n.label, language),
    examDefinitionId: n.exam_definition_id,
    examVersionId: n.exam_version_id,
    components: comps.rows
      .filter((c: any) => !only || c.id === only)
      .map((c: any) => ({
        componentId: c.id,
        nodeKey: c.node_key,
        name: c.definition?.officialName ?? c.name,
        facts: c.node_metadata?.facts ?? null,
        untimed: c.timing_status !== 'CONFIGURED' || c.duration_minutes === null,
        kind: c.definition?.kind ?? null,
      })),
  };
}
