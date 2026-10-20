/**
 * Curriculum convergence -- Learn curriculum provenance.
 *
 * The canonical concept answers WHAT is being learned; the provenance answers WHERE in the Student's
 * curriculum it belongs: academic subject -> structure version -> curriculum node -> learning objective
 * (table `learner_concept_curriculum_provenance`, migration 20261122_1000). Durable ids only -- programme,
 * qualification and level are read from the academic subject, labels from the governed rows.
 *
 * Authority, fail closed:
 *   - a lineage the caller states is VERIFIED against the published catalogue (it is refused, never repaired);
 *   - when none is stated, the lineage is taken from an academic subject the Student EXPLICITLY has (an exam
 *     they prepare, a subject of their Academic Profile) and only when the concept is mapped there. Otherwise
 *     nothing is recorded: a concept is never attributed to a curriculum by similarity, size or default.
 */
import { db } from '@/lib/db';
import { studentExplicitAcademicSubjects } from './curriculum.service';

type Executor = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };

export interface CurriculumProvenanceRef {
  academicSubjectId: string;
  structureVersionId: string;
  structureNodeId: string;
  learningObjectiveId: string;
}

export const CURRICULUM_PROVENANCE_INVALID = 'CURRICULUM_PROVENANCE_INVALID' as const;

/** Is this lineage a real, PUBLISHED chain of the catalogue that reaches this canonical concept? */
export async function verifyCurriculumProvenance(canonicalConceptId: string, ref: CurriculumProvenanceRef, client: Executor = db): Promise<boolean> {
  const r = await client.query(
    `SELECT 1
       FROM learning_objectives lo
       JOIN structure_nodes sn ON sn.id = lo.structure_node_id
       JOIN structure_versions sv ON sv.id = sn.structure_version_id AND sv.status = 'PUBLISHED'
       JOIN objective_concept_mappings ocm ON ocm.learning_objective_id = lo.id AND ocm.status = 'PUBLISHED'
       JOIN canonical_concepts cc ON cc.id = ocm.canonical_concept_id AND cc.status = 'ACTIVE'
      WHERE lo.id = $1 AND lo.status = 'ACTIVE' AND sn.id = $2 AND sv.id = $3 AND sv.academic_subject_id = $4 AND cc.id = $5
      LIMIT 1`,
    [ref.learningObjectiveId, ref.structureNodeId, ref.structureVersionId, ref.academicSubjectId, canonicalConceptId]
  );
  return r.rows.length > 0;
}

/**
 * The lineage of a canonical concept inside a curriculum the Student EXPLICITLY has, or null: the first of
 * their explicit academic subjects (exam preparations, then Academic Profile selections -- the same authority
 * order as resolveCurriculumContext) whose PUBLISHED structure maps this concept. Inside that one structure
 * the objective is the first in catalogue order (node order, objective code, id). The choice is among the
 * objectives of the Student's own curriculum, never among curricula the Student did not name: with no
 * explicit subject that maps the concept, nothing is derived.
 */
export async function deriveCurriculumProvenance(studentId: string, canonicalConceptId: string): Promise<CurriculumProvenanceRef | null> {
  const explicit = [...new Set((await studentExplicitAcademicSubjects(studentId)).map((e) => e.academicSubjectId))];
  if (explicit.length === 0) return null;
  const r = await db.query(
    `SELECT sv.academic_subject_id, sv.id AS structure_version_id, sn.id AS structure_node_id, lo.id AS learning_objective_id
       FROM objective_concept_mappings ocm
       JOIN canonical_concepts cc ON cc.id = ocm.canonical_concept_id AND cc.status = 'ACTIVE'
       JOIN learning_objectives lo ON lo.id = ocm.learning_objective_id AND lo.status = 'ACTIVE'
       JOIN structure_nodes sn ON sn.id = lo.structure_node_id
       JOIN structure_versions sv ON sv.id = sn.structure_version_id AND sv.status = 'PUBLISHED'
      WHERE ocm.status = 'PUBLISHED' AND ocm.relation_type IN ('FULL', 'PARTIAL') AND ocm.canonical_concept_id = $2 AND sv.academic_subject_id = ANY($1::uuid[])
      ORDER BY sn.order_index, lo.code NULLS LAST, lo.id`,
    [explicit, canonicalConceptId]
  );
  for (const academicSubjectId of explicit) {
    const row = r.rows.find((x: any) => x.academic_subject_id === academicSubjectId);
    if (row) return { academicSubjectId, structureVersionId: row.structure_version_id, structureNodeId: row.structure_node_id, learningObjectiveId: row.learning_objective_id };
  }
  return null;
}

/**
 * Record the lineage of a Learn concept (inside the caller's transaction). The first recorded lineage stays:
 * a concept that already has one keeps it. Returns whether a row was written.
 */
export async function recordCurriculumProvenance(client: Executor, learnerConceptId: string, canonicalConceptId: string, ref: CurriculumProvenanceRef, actorUserId: string | null): Promise<boolean> {
  const r = await client.query(
    `INSERT INTO learner_concept_curriculum_provenance (learner_concept_id, canonical_concept_id, academic_subject_id, structure_version_id, structure_node_id, learning_objective_id, recorded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (learner_concept_id) DO NOTHING
     RETURNING learner_concept_id`,
    [learnerConceptId, canonicalConceptId, ref.academicSubjectId, ref.structureVersionId, ref.structureNodeId, ref.learningObjectiveId, actorUserId]
  );
  return r.rows.length > 0;
}

export interface LearnerConceptCurriculumGroup {
  learnerConceptId: string;
  canonicalConceptId: string;
  academicSubjectId: string;
  structureVersionId: string;
  structureNodeId: string;
  learningObjectiveId: string;
  programmeId: string;
  programme: string;
  qualification: string | null;
  subject: string;
  level: string | null;
  versionLabel: string;
  nodeType: string;
  nodeLabel: string;
  nodeOrder: number;
  objectiveCode: string | null;
  objectiveDescription: string;
}

/** The recorded lineage of Learn concepts, with the governed labels it points at (read-only). */
export async function curriculumProvenanceForLearnerConcepts(learnerConceptIds: string[], locale: string, client: Executor = db): Promise<Map<string, LearnerConceptCurriculumGroup>> {
  const out = new Map<string, LearnerConceptCurriculumGroup>();
  const ids = [...new Set(learnerConceptIds.filter(Boolean))];
  if (ids.length === 0) return out;
  const r = await client.query(
    `SELECT p.learner_concept_id, p.canonical_concept_id, p.academic_subject_id, p.structure_version_id, p.structure_node_id, p.learning_objective_id,
            ap.id AS programme_id, ap.name AS programme, aq.name AS qualification, asub.name AS subject, asub.level, sv.version_label,
            sn.node_type, COALESCE(snl.label, sn.source_label, sn.code, '') AS node_label, COALESCE(sn.order_index, 0) AS node_order,
            lo.code AS objective_code, lo.description AS objective_description
       FROM learner_concept_curriculum_provenance p
       JOIN academic_subjects asub ON asub.id = p.academic_subject_id
       JOIN academic_programmes ap ON ap.id = asub.programme_id
       LEFT JOIN academic_qualifications aq ON aq.id = asub.qualification_id
       JOIN structure_versions sv ON sv.id = p.structure_version_id
       JOIN structure_nodes sn ON sn.id = p.structure_node_id
       JOIN learning_objectives lo ON lo.id = p.learning_objective_id
       LEFT JOIN LATERAL (SELECT label FROM structure_node_localizations l WHERE l.structure_node_id = sn.id AND l.language = $2 LIMIT 1) snl ON true
      WHERE p.learner_concept_id = ANY($1::uuid[])`,
    [ids, locale]
  );
  for (const row of r.rows) {
    out.set(row.learner_concept_id, {
      learnerConceptId: row.learner_concept_id, canonicalConceptId: row.canonical_concept_id, academicSubjectId: row.academic_subject_id,
      structureVersionId: row.structure_version_id, structureNodeId: row.structure_node_id, learningObjectiveId: row.learning_objective_id,
      programmeId: row.programme_id, programme: row.programme, qualification: row.qualification, subject: row.subject, level: row.level, versionLabel: row.version_label,
      nodeType: row.node_type, nodeLabel: row.node_label ?? '', nodeOrder: Number(row.node_order ?? 0), objectiveCode: row.objective_code, objectiveDescription: row.objective_description ?? '',
    });
  }
  return out;
}
