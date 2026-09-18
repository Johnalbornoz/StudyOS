/**
 * F6 -- Activity Metadata Bridge (task 27). A read-only contract
 * preparing F7/F8 -- never writes to learning_evidence, never
 * retroactively touches historical Evidence, never generates any
 * activity. See docs/implementation/f6/F6_ACTIVITY_METADATA_BRIDGE.md.
 */
import { db } from '@/lib/db';

export interface ActivityMetadataResolution {
  learningObjectiveId: string;
  canonicalConceptIds: string[];
  skillIds: string[];
  competencyIds: string[];
  structureVersionId: string;
}

/** Returns null when the objective has no PUBLISHED mappings at all -- never a partial or guessed result. */
export async function resolveActivityMetadataForObjective(learningObjectiveId: string): Promise<ActivityMetadataResolution | null> {
  const objective = await db.query(
    `SELECT lo.id, sn.structure_version_id FROM learning_objectives lo
     JOIN structure_nodes sn ON sn.id = lo.structure_node_id
     WHERE lo.id = $1`,
    [learningObjectiveId]
  );
  if (objective.rows.length === 0) return null;

  const [concepts, skills, competencies] = await Promise.all([
    db.query(`SELECT canonical_concept_id FROM objective_concept_mappings WHERE learning_objective_id = $1 AND status = 'PUBLISHED'`, [learningObjectiveId]),
    db.query(`SELECT skill_id FROM objective_skill_mappings WHERE learning_objective_id = $1 AND status = 'PUBLISHED'`, [learningObjectiveId]),
    db.query(`SELECT competency_id FROM objective_competency_mappings WHERE learning_objective_id = $1 AND status = 'PUBLISHED'`, [learningObjectiveId]),
  ]);

  if (concepts.rows.length === 0 && skills.rows.length === 0 && competencies.rows.length === 0) return null;

  return {
    learningObjectiveId,
    canonicalConceptIds: concepts.rows.map((r: any) => r.canonical_concept_id),
    skillIds: skills.rows.map((r: any) => r.skill_id),
    competencyIds: competencies.rows.map((r: any) => r.competency_id),
    structureVersionId: objective.rows[0].structure_version_id,
  };
}
