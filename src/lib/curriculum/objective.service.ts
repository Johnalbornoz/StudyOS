/**
 * F6 -- Learning Objectives / Knowledge Requirements (task 10).
 */
import { db } from '@/lib/db';
import type { LearningObjective } from './types';

function toObjective(r: any): LearningObjective {
  return { id: r.id, structureNodeId: r.structure_node_id, code: r.code, description: r.description, status: r.status };
}

export async function createLearningObjective(params: { structureNodeId: string; code?: string; description: string }): Promise<LearningObjective> {
  const result = await db.query(
    `INSERT INTO learning_objectives (structure_node_id, code, description) VALUES ($1, $2, $3)
     RETURNING id, structure_node_id, code, description, status`,
    [params.structureNodeId, params.code ?? null, params.description]
  );
  return toObjective(result.rows[0]);
}

export async function getLearningObjective(id: string): Promise<LearningObjective | null> {
  const result = await db.query(`SELECT id, structure_node_id, code, description, status FROM learning_objectives WHERE id = $1`, [id]);
  return result.rows.length === 0 ? null : toObjective(result.rows[0]);
}

export async function listObjectivesForNode(structureNodeId: string): Promise<LearningObjective[]> {
  const result = await db.query(`SELECT id, structure_node_id, code, description, status FROM learning_objectives WHERE structure_node_id = $1`, [structureNodeId]);
  return result.rows.map(toObjective);
}

/** All objectives under an entire structure version (every node), for coverage computation. */
export async function listObjectivesForStructureVersion(structureVersionId: string): Promise<LearningObjective[]> {
  const result = await db.query(
    `SELECT lo.id, lo.structure_node_id, lo.code, lo.description, lo.status
     FROM learning_objectives lo JOIN structure_nodes sn ON sn.id = lo.structure_node_id
     WHERE sn.structure_version_id = $1`,
    [structureVersionId]
  );
  return result.rows.map(toObjective);
}
