/**
 * F6 -- Structure Version / Structure Node (task 8/9). Publishing a new
 * version never deletes or mutates an old one -- it transitions the
 * prior PUBLISHED row to SUPERSEDED (INV-F6-09, task 7's "do not assume
 * two versions share identical structure"). Cycle prevention ports F4's
 * canonical_concept_prerequisites::wouldCreateCycle pattern verbatim.
 */
import { db, type DbExecutor } from '@/lib/db';
import type { StructureNode, StructureVersion, StructureVersionStatus } from './types';

export class StructureCycleError extends Error {
  constructor(public nodeId: string, public parentId: string) {
    super(`Setting ${parentId} as the parent of ${nodeId} would create a cycle`);
  }
}
export class StructureOrphanError extends Error {
  constructor(public parentId: string, public structureVersionId: string) {
    super(`Parent ${parentId} does not exist in structure version ${structureVersionId}`);
  }
}

function toVersion(r: any): StructureVersion {
  return {
    id: r.id,
    academicSubjectId: r.academic_subject_id,
    versionLabel: r.version_label,
    effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to,
    status: r.status,
    sourceLocator: r.source_locator,
  };
}

function toNode(r: any): StructureNode {
  return {
    id: r.id,
    structureVersionId: r.structure_version_id,
    parentId: r.parent_id,
    nodeType: r.node_type,
    sourceLabel: r.source_label,
    code: r.code,
    orderIndex: r.order_index,
    description: r.description,
    status: r.status,
  };
}

export async function createStructureVersion(params: { academicSubjectId: string; versionLabel: string; effectiveFrom?: string; sourceLocator?: string }): Promise<StructureVersion> {
  const result = await db.query(
    `INSERT INTO structure_versions (academic_subject_id, version_label, effective_from, source_locator)
     VALUES ($1, $2, $3, $4) RETURNING id, academic_subject_id, version_label, effective_from, effective_to, status, source_locator`,
    [params.academicSubjectId, params.versionLabel, params.effectiveFrom ?? null, params.sourceLocator ?? null]
  );
  return toVersion(result.rows[0]);
}

/**
 * Publishes a DRAFT structure version, atomically superseding whatever
 * was previously PUBLISHED for the same subject. The superseded row's
 * nodes/objectives/mappings remain fully intact and queryable (INV-F6-09,
 * task adversarial case L) -- never deleted, never rewritten.
 */
export async function publishStructureVersion(structureVersionId: string): Promise<StructureVersion> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query(`SELECT academic_subject_id, status FROM structure_versions WHERE id = $1`, [structureVersionId]);
    if (current.rows.length === 0) throw new Error(`structure version ${structureVersionId} not found`);
    const { academic_subject_id: subjectId, status } = current.rows[0];
    if (status !== 'DRAFT') throw new Error(`only a DRAFT structure version may be published (current status: ${status})`);

    await client.query(
      `UPDATE structure_versions SET status = 'SUPERSEDED', updated_at = now() WHERE academic_subject_id = $1 AND status = 'PUBLISHED'`,
      [subjectId]
    );
    const updated = await client.query(
      `UPDATE structure_versions SET status = 'PUBLISHED', updated_at = now() WHERE id = $1
       RETURNING id, academic_subject_id, version_label, effective_from, effective_to, status, source_locator`,
      [structureVersionId]
    );
    await client.query('COMMIT');
    return toVersion(updated.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function getPublishedStructureVersion(academicSubjectId: string): Promise<StructureVersion | null> {
  const result = await db.query(
    `SELECT id, academic_subject_id, version_label, effective_from, effective_to, status, source_locator
     FROM structure_versions WHERE academic_subject_id = $1 AND status = 'PUBLISHED'`,
    [academicSubjectId]
  );
  return result.rows.length === 0 ? null : toVersion(result.rows[0]);
}

/** True if `parentId` is already (transitively) a descendant of `nodeId` -- i.e. adding parentId as nodeId's parent would close a cycle. Same recursive-CTE shape as F4's prerequisite.service.ts::wouldCreateCycle. */
async function wouldCreateCycle(client: DbExecutor, nodeId: string, parentId: string): Promise<boolean> {
  if (nodeId === parentId) return true;
  const result = await client.query(
    `
    WITH RECURSIVE reachable AS (
      SELECT id AS descendant_id FROM structure_nodes WHERE parent_id = $1
      UNION
      SELECT n.id FROM structure_nodes n
      JOIN reachable r ON n.parent_id = r.descendant_id
    )
    SELECT 1 FROM reachable WHERE descendant_id = $2
    `,
    [nodeId, parentId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function createStructureNode(params: {
  structureVersionId: string;
  parentId?: string;
  nodeType: string;
  sourceLabel: string;
  code?: string;
  orderIndex?: number;
  description?: string;
  source?: string;
  sourceLocator?: string;
}, client: DbExecutor = db): Promise<StructureNode> {
  if (params.parentId) {
    const parentRow = await client.query(`SELECT structure_version_id FROM structure_nodes WHERE id = $1`, [params.parentId]);
    if (parentRow.rows.length === 0 || parentRow.rows[0].structure_version_id !== params.structureVersionId) {
      throw new StructureOrphanError(params.parentId, params.structureVersionId);
    }
  }
  const result = await client.query(
    `INSERT INTO structure_nodes (structure_version_id, parent_id, node_type, source_label, code, order_index, description, source, source_locator)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, structure_version_id, parent_id, node_type, source_label, code, order_index, description, status`,
    [
      params.structureVersionId,
      params.parentId ?? null,
      params.nodeType,
      params.sourceLabel,
      params.code ?? null,
      params.orderIndex ?? 0,
      params.description ?? null,
      params.source ?? null,
      params.sourceLocator ?? null,
    ]
  );
  return toNode(result.rows[0]);
}

/** Re-parents an EXISTING node -- the only path where a cycle could be introduced (creation with a fresh id can never cycle back to itself). */
export async function setStructureNodeParent(nodeId: string, newParentId: string, client: DbExecutor = db): Promise<void> {
  const nodeRow = await client.query(`SELECT structure_version_id FROM structure_nodes WHERE id = $1`, [nodeId]);
  if (nodeRow.rows.length === 0) throw new Error(`structure node ${nodeId} not found`);
  const parentRow = await client.query(`SELECT structure_version_id FROM structure_nodes WHERE id = $1`, [newParentId]);
  if (parentRow.rows.length === 0 || parentRow.rows[0].structure_version_id !== nodeRow.rows[0].structure_version_id) {
    throw new StructureOrphanError(newParentId, nodeRow.rows[0].structure_version_id);
  }
  if (await wouldCreateCycle(client, nodeId, newParentId)) {
    throw new StructureCycleError(nodeId, newParentId);
  }
  await client.query(`UPDATE structure_nodes SET parent_id = $2 WHERE id = $1`, [nodeId, newParentId]);
}

export async function getStructureNodesForVersion(structureVersionId: string): Promise<StructureNode[]> {
  const result = await db.query(
    `SELECT id, structure_version_id, parent_id, node_type, source_label, code, order_index, description, status
     FROM structure_nodes WHERE structure_version_id = $1 ORDER BY order_index`,
    [structureVersionId]
  );
  return result.rows.map(toNode);
}

export async function addStructureNodeLocalization(structureNodeId: string, language: string, label: string): Promise<void> {
  await db.query(`INSERT INTO structure_node_localizations (structure_node_id, language, label) VALUES ($1, $2, $3)`, [structureNodeId, language, label]);
}
