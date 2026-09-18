/**
 * F7 -- Assessment Blueprint (task 8/9). Samples F6's learning_objectives
 * directly -- never curriculum-tree structure_nodes/order_index
 * (INV-F6-05/INV-F7-05, adversarial case K).
 */
import { db } from '@/lib/db';
import type { AssessmentBlueprint, BlueprintObjectiveTarget } from './types';

function toBlueprint(r: any): AssessmentBlueprint {
  return { id: r.id, examVersionId: r.exam_version_id, status: r.status };
}
function toTarget(r: any): BlueprintObjectiveTarget {
  return {
    id: r.id,
    blueprintId: r.blueprint_id,
    learningObjectiveId: r.learning_objective_id,
    assessmentComponentId: r.assessment_component_id,
    targetItemCount: r.target_item_count,
    questionType: r.question_type,
    commandTermId: r.command_term_id,
    reasoningRequirement: r.reasoning_requirement,
    difficultyMin: r.difficulty_min,
    difficultyMax: r.difficulty_max,
    skillId: r.skill_id,
  };
}

export async function createBlueprint(examVersionId: string): Promise<AssessmentBlueprint> {
  const result = await db.query(`INSERT INTO assessment_blueprints (exam_version_id) VALUES ($1) RETURNING *`, [examVersionId]);
  return toBlueprint(result.rows[0]);
}

export async function publishBlueprint(blueprintId: string): Promise<AssessmentBlueprint> {
  const result = await db.query(`UPDATE assessment_blueprints SET status = 'PUBLISHED' WHERE id = $1 AND status = 'DRAFT' RETURNING *`, [blueprintId]);
  if (result.rows.length === 0) throw new Error(`blueprint ${blueprintId} could not be published from its current status`);
  return toBlueprint(result.rows[0]);
}

export async function addComponentAllocation(blueprintId: string, assessmentComponentId: string, params: { itemCount?: number; weight?: number } = {}): Promise<void> {
  await db.query(
    `INSERT INTO blueprint_component_allocations (blueprint_id, assessment_component_id, item_count, weight) VALUES ($1, $2, $3, $4)
     ON CONFLICT (blueprint_id, assessment_component_id) DO UPDATE SET item_count = $3, weight = $4`,
    [blueprintId, assessmentComponentId, params.itemCount ?? null, params.weight ?? null]
  );
}

export async function addObjectiveTarget(params: {
  blueprintId: string;
  learningObjectiveId: string;
  assessmentComponentId: string;
  targetItemCount?: number;
  questionType?: string;
  commandTermId?: string;
  reasoningRequirement?: string;
  difficultyMin?: number;
  difficultyMax?: number;
  skillId?: string;
}): Promise<BlueprintObjectiveTarget> {
  const result = await db.query(
    `INSERT INTO blueprint_objective_targets (
       blueprint_id, learning_objective_id, assessment_component_id, target_item_count, question_type,
       command_term_id, reasoning_requirement, difficulty_min, difficulty_max, skill_id
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
    [
      params.blueprintId,
      params.learningObjectiveId,
      params.assessmentComponentId,
      params.targetItemCount ?? null,
      params.questionType ?? null,
      params.commandTermId ?? null,
      params.reasoningRequirement ?? null,
      params.difficultyMin ?? null,
      params.difficultyMax ?? null,
      params.skillId ?? null,
    ]
  );
  return toTarget(result.rows[0]);
}

export async function getBlueprintForVersion(examVersionId: string): Promise<AssessmentBlueprint | null> {
  const result = await db.query(`SELECT * FROM assessment_blueprints WHERE exam_version_id = $1`, [examVersionId]);
  return result.rows.length === 0 ? null : toBlueprint(result.rows[0]);
}

export async function listObjectiveTargets(blueprintId: string): Promise<BlueprintObjectiveTarget[]> {
  const result = await db.query(`SELECT * FROM blueprint_objective_targets WHERE blueprint_id = $1`, [blueprintId]);
  return result.rows.map(toTarget);
}

export async function getObjectiveTarget(targetId: string): Promise<BlueprintObjectiveTarget | null> {
  const result = await db.query(`SELECT * FROM blueprint_objective_targets WHERE id = $1`, [targetId]);
  return result.rows.length === 0 ? null : toTarget(result.rows[0]);
}
