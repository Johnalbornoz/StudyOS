/**
 * Curriculum convergence -- coverage audit and the deterministic canonical-subject completion.
 *
 * Reads the catalogue, classifies every academic subject without a canonical subject and every published
 * structure version without concept mappings (coverage-classification.ts), and -- only for the subjects whose
 * canonical subject is a stated fact -- writes `academic_subjects.canonical_subject_id`. A value is never
 * overwritten; nothing else is touched. Every other case is returned for the review queue.
 */
import type { DbExecutor } from '@/lib/db';
import { classifyStructureVersion, classifyUnmappedAcademicSubject, configKeyOf, type AcademicSubjectMappingDecision, type StructureVersionMappingClass } from './coverage-classification';

export interface UnmappedSubjectRow extends AcademicSubjectMappingDecision {
  programme: string;
  programmeType: string;
  name: string;
  level: string | null;
  configKey: string | null;
  canonicalSubject: string | null;
}

export async function auditUnmappedAcademicSubjects(client: DbExecutor): Promise<UnmappedSubjectRow[]> {
  const r = await client.query(
    `SELECT a.id, a.name, a.level, a.status, p.name AS programme, p.programme_type,
            (SELECT sv.source_locator FROM structure_versions sv WHERE sv.academic_subject_id = a.id AND sv.status = 'PUBLISHED') AS source_locator,
            ARRAY(SELECT DISTINCT cc.canonical_subject_id::text
                    FROM structure_versions sv
                    JOIN structure_nodes n ON n.structure_version_id = sv.id
                    JOIN learning_objectives lo ON lo.structure_node_id = n.id AND lo.status = 'ACTIVE'
                    JOIN objective_concept_mappings m ON m.learning_objective_id = lo.id AND m.status = 'PUBLISHED'
                    JOIN canonical_concepts cc ON cc.id = m.canonical_concept_id AND cc.status = 'ACTIVE'
                    JOIN canonical_subjects cs ON cs.id = cc.canonical_subject_id AND cs.status = 'ACTIVE'
                   WHERE sv.academic_subject_id = a.id AND sv.status = 'PUBLISHED') AS mapped,
            ARRAY(SELECT cs.id::text FROM canonical_subjects cs WHERE cs.status = 'ACTIVE' AND lower(trim(cs.name)) = lower(trim(a.name))) AS exact
       FROM academic_subjects a JOIN academic_programmes p ON p.id = a.programme_id
      WHERE a.canonical_subject_id IS NULL
      ORDER BY p.name, a.name, a.level NULLS FIRST, a.id`
  );
  const names = new Map<string, string>((await client.query(`SELECT id::text, name FROM canonical_subjects`)).rows.map((x: any) => [x.id as string, x.name as string]));
  return r.rows.map((row: any) => {
    const configKey = configKeyOf(row.source_locator);
    const decision = classifyUnmappedAcademicSubject({ academicSubjectId: row.id, programme: row.programme, name: row.name, level: row.level, status: row.status, configKey, mappedCanonicalSubjectIds: row.mapped ?? [], exactNameCanonicalSubjectIds: row.exact ?? [] });
    return { ...decision, programme: row.programme, programmeType: row.programme_type, name: row.name, level: row.level, configKey, canonicalSubject: decision.canonicalSubjectId ? names.get(decision.canonicalSubjectId) ?? null : null };
  });
}

/** Writes the canonical subject of every MAPPABLE_DETERMINISTICALLY subject (never overwrites one). Returns the rows written. */
export async function applyDeterministicCanonicalSubjects(client: DbExecutor): Promise<{ before: UnmappedSubjectRow[]; mapped: UnmappedSubjectRow[] }> {
  const before = await auditUnmappedAcademicSubjects(client);
  const mapped: UnmappedSubjectRow[] = [];
  for (const row of before) {
    if (row.classification !== 'MAPPABLE_DETERMINISTICALLY' || !row.canonicalSubjectId) continue;
    const w = await client.query(`UPDATE academic_subjects SET canonical_subject_id = $2 WHERE id = $1 AND canonical_subject_id IS NULL`, [row.academicSubjectId, row.canonicalSubjectId]);
    if ((w.rowCount ?? 0) === 1) mapped.push(row);
  }
  return { before, mapped };
}

export interface StructureVersionRow {
  structureVersionId: string;
  programme: string;
  programmeType: string;
  subject: string;
  level: string | null;
  versionLabel: string;
  status: string;
  configKey: string | null;
  nodes: number;
  nodeTypes: Record<string, number>;
  topics: number;
  activeObjectives: number;
  publishedConceptMappings: number;
  classification: StructureVersionMappingClass;
}

/** Every structure version with its node / objective / mapping counts and its classification. */
export async function auditStructureVersions(client: DbExecutor): Promise<StructureVersionRow[]> {
  const r = await client.query(
    `SELECT sv.id, sv.status, sv.version_label, sv.source_locator, a.name AS subject, a.level, a.status AS subject_status, p.name AS programme, p.programme_type,
            COALESCE((SELECT jsonb_object_agg(t.node_type, t.n) FROM (SELECT node_type, count(*)::int AS n FROM structure_nodes n WHERE n.structure_version_id = sv.id GROUP BY node_type) t), '{}'::jsonb) AS node_types,
            (SELECT count(*)::int FROM learning_objectives lo JOIN structure_nodes n ON n.id = lo.structure_node_id WHERE n.structure_version_id = sv.id AND lo.status = 'ACTIVE') AS objectives,
            (SELECT count(*)::int FROM objective_concept_mappings m JOIN learning_objectives lo ON lo.id = m.learning_objective_id JOIN structure_nodes n ON n.id = lo.structure_node_id
              WHERE n.structure_version_id = sv.id AND m.status = 'PUBLISHED') AS mappings,
            EXISTS (SELECT 1 FROM canonical_concepts cc WHERE cc.canonical_subject_id = a.canonical_subject_id AND cc.status = 'ACTIVE') AS canonical_has_concepts
       FROM structure_versions sv JOIN academic_subjects a ON a.id = sv.academic_subject_id JOIN academic_programmes p ON p.id = a.programme_id
      ORDER BY p.name, a.name, a.level NULLS FIRST, sv.version_label, sv.id`
  );
  return r.rows.map((row: any) => {
    const nodeTypes = (row.node_types ?? {}) as Record<string, number>;
    const nodes = Object.values(nodeTypes).reduce((a, b) => a + Number(b), 0);
    const configKey = configKeyOf(row.source_locator);
    return {
      structureVersionId: row.id, programme: row.programme, programmeType: row.programme_type, subject: row.subject, level: row.level, versionLabel: row.version_label, status: row.status, configKey,
      nodes, nodeTypes, topics: Number(nodeTypes.TOPIC ?? 0), activeObjectives: row.objectives, publishedConceptMappings: row.mappings,
      classification: classifyStructureVersion({ structureVersionId: row.id, status: row.status, subjectStatus: row.subject_status, configKey, nodes, activeObjectives: row.objectives, publishedConceptMappings: row.mappings, canonicalSubjectHasConcepts: row.canonical_has_concepts === true }),
    };
  });
}
