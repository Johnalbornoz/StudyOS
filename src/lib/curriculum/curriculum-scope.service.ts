/**
 * B1 -- CurriculumScope reads. Read-only; one structure version per scope.
 *
 * `resolveCurriculumContext` (learning-plan/curriculum.service) stays the resolver of WHICH curriculum fits a
 * learner; a `CurriculumOption` it returns names a structure version, and this module loads that version as
 * the canonical scope.
 */
import { db, type DbExecutor } from '@/lib/db';
import { buildCurriculumScope, type CurriculumScope, type CurriculumScopeHeader, type CurriculumScopeRef } from './curriculum-scope';

async function loadHeader(structureVersionId: string, client: DbExecutor): Promise<CurriculumScopeHeader | null> {
  const r = await client.query(
    `SELECT sv.id AS version_id, sv.version_label, sv.status AS version_status,
            sub.id AS subject_id, sub.name AS subject_name, sub.level AS subject_level, sub.canonical_subject_id,
            q.id AS qualification_id, q.name AS qualification_name,
            p.id AS programme_id, p.name AS programme_name, p.programme_type,
            o.id AS organization_id, o.name AS organization_name
       FROM structure_versions sv
       JOIN academic_subjects sub ON sub.id = sv.academic_subject_id
       LEFT JOIN academic_qualifications q ON q.id = sub.qualification_id
       LEFT JOIN academic_programmes p ON p.id = sub.programme_id
       LEFT JOIN academic_organizations o ON o.id = p.organization_id
      WHERE sv.id = $1`,
    [structureVersionId]
  );
  const h = r.rows[0];
  if (!h) return null;
  return {
    organization: h.organization_id ? { id: h.organization_id, name: h.organization_name } : null,
    programme: h.programme_id ? { id: h.programme_id, name: h.programme_name, type: h.programme_type ?? null } : null,
    qualification: h.qualification_id ? { id: h.qualification_id, name: h.qualification_name } : null,
    subject: { academicSubjectId: h.subject_id, name: h.subject_name, level: h.subject_level ?? null, canonicalSubjectId: h.canonical_subject_id ?? null },
    structureVersion: { id: h.version_id, label: h.version_label, status: h.version_status },
  };
}

/** The scope of one structure version (any status: a historical attempt may reference a superseded version). */
export async function loadCurriculumScope(structureVersionId: string, client: DbExecutor = db): Promise<CurriculumScope | null> {
  const header = await loadHeader(structureVersionId, client);
  if (!header) return null;
  const [nodes, objectives] = await Promise.all([
    client.query(`SELECT id, parent_id, node_type, code, COALESCE(source_label, code) AS label, order_index FROM structure_nodes WHERE structure_version_id = $1`, [structureVersionId]),
    client.query(
      `SELECT lo.id, lo.structure_node_id, lo.code, lo.description
         FROM learning_objectives lo JOIN structure_nodes sn ON sn.id = lo.structure_node_id
        WHERE sn.structure_version_id = $1 AND lo.status = 'ACTIVE'`,
      [structureVersionId]
    ),
  ]);
  const objectiveIds = objectives.rows.map((o: any) => o.id as string);
  const mappings = objectiveIds.length
    ? await client.query(`SELECT learning_objective_id, canonical_concept_id, relation_type FROM objective_concept_mappings WHERE learning_objective_id = ANY($1::uuid[]) AND status = 'PUBLISHED'`, [objectiveIds])
    : { rows: [] as any[] };
  const conceptIds = [...new Set(mappings.rows.map((m: any) => m.canonical_concept_id as string))];
  const concepts = conceptIds.length ? await client.query(`SELECT id, name, canonical_subject_id FROM canonical_concepts WHERE id = ANY($1::uuid[]) AND status = 'ACTIVE'`, [conceptIds]) : { rows: [] as any[] };
  return buildCurriculumScope(header, { nodes: nodes.rows, objectives: objectives.rows, mappings: mappings.rows, concepts: concepts.rows });
}

/** The PUBLISHED structure version of an academic subject (at most one), or null. */
export async function publishedScopeRefForSubject(academicSubjectId: string, client: DbExecutor = db): Promise<CurriculumScopeRef | null> {
  const r = await client.query(`SELECT id FROM structure_versions WHERE academic_subject_id = $1 AND status = 'PUBLISHED' LIMIT 1`, [academicSubjectId]);
  return r.rows[0] ? { structureVersionId: r.rows[0].id, academicSubjectId } : null;
}

export async function loadPublishedCurriculumScopeForSubject(academicSubjectId: string, client: DbExecutor = db): Promise<CurriculumScope | null> {
  const ref = await publishedScopeRefForSubject(academicSubjectId, client);
  return ref ? loadCurriculumScope(ref.structureVersionId, client) : null;
}

/** The scope that contains a learning objective: an objective belongs to exactly one node, hence one version. */
export async function scopeRefForObjective(learningObjectiveId: string, client: DbExecutor = db): Promise<CurriculumScopeRef | null> {
  const r = await client.query(
    `SELECT sv.id AS structure_version_id, sv.academic_subject_id
       FROM learning_objectives lo JOIN structure_nodes sn ON sn.id = lo.structure_node_id JOIN structure_versions sv ON sv.id = sn.structure_version_id
      WHERE lo.id = $1`,
    [learningObjectiveId]
  );
  return r.rows[0] ? { structureVersionId: r.rows[0].structure_version_id, academicSubjectId: r.rows[0].academic_subject_id } : null;
}
