/**
 * F6 -- Learning Objectives / Knowledge Requirements (task 10).
 */
import { db, type DbExecutor } from '@/lib/db';
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

export class ObjectiveReparentError extends Error {
  constructor(public readonly code: 'OBJECTIVE_NOT_FOUND' | 'NODE_NOT_FOUND' | 'NODE_NOT_ACTIVE' | 'DIFFERENT_STRUCTURE_VERSION', detail: string) {
    super(`${code}: ${detail}`);
    this.name = 'ObjectiveReparentError';
  }
}

/**
 * Moves an EXISTING objective under another node of the SAME structure version -- the governed operation by
 * which real hierarchy is given to an objective that an exam configuration first hung from a bootstrap
 * section node. The objective keeps its id, code and description, so every item, blueprint target, mapping
 * and attempt that references it is untouched; only its place in the hierarchy changes. An objective never
 * leaves its structure version.
 */
export async function reparentLearningObjective(objectiveId: string, newStructureNodeId: string, client: DbExecutor = db): Promise<{ objectiveId: string; fromNodeId: string; toNodeId: string; moved: boolean }> {
  const current = await client.query(`SELECT lo.structure_node_id, n.structure_version_id FROM learning_objectives lo JOIN structure_nodes n ON n.id = lo.structure_node_id WHERE lo.id = $1`, [objectiveId]);
  if (current.rows.length === 0) throw new ObjectiveReparentError('OBJECTIVE_NOT_FOUND', objectiveId);
  const target = await client.query(`SELECT structure_version_id, status FROM structure_nodes WHERE id = $1`, [newStructureNodeId]);
  if (target.rows.length === 0) throw new ObjectiveReparentError('NODE_NOT_FOUND', newStructureNodeId);
  if (target.rows[0].status !== 'ACTIVE') throw new ObjectiveReparentError('NODE_NOT_ACTIVE', newStructureNodeId);
  if (target.rows[0].structure_version_id !== current.rows[0].structure_version_id) throw new ObjectiveReparentError('DIFFERENT_STRUCTURE_VERSION', `${objectiveId} -> ${newStructureNodeId}`);
  const fromNodeId = current.rows[0].structure_node_id as string;
  if (fromNodeId === newStructureNodeId) return { objectiveId, fromNodeId, toNodeId: newStructureNodeId, moved: false };
  await client.query(`UPDATE learning_objectives SET structure_node_id = $2 WHERE id = $1`, [objectiveId, newStructureNodeId]);
  return { objectiveId, fromNodeId, toNodeId: newStructureNodeId, moved: true };
}
