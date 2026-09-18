/**
 * F6 -- Curriculum Mapping (task 11/12/14/15/16). One generic
 * implementation shared by all three concrete mapping tables
 * (objective_concept_mappings / objective_skill_mappings /
 * objective_competency_mappings) -- table/column names below come ONLY
 * from the fixed internal config map, never from caller input, so the
 * dynamic SQL construction is safe (equivalent to three near-identical
 * hand-written services, without the triplication).
 *
 * DRAFT -> PROPOSED -> IN_REVIEW -> APPROVED -> PUBLISHED, with REJECTED
 * reachable from PROPOSED/IN_REVIEW and RETIRED reachable from PUBLISHED.
 * A published mapping's substantive fields are immutable -- "changing" it
 * means creating a new row in the same mapping_group_id with an
 * incremented version (task 12, INV-F6-08/09).
 */
import { db, type DbExecutor } from '@/lib/db';
import { hasEditorialRole } from './editorial.service';
import type { MappingProvenance, MappingRecord, RelationType } from './types';

export type MappingKind = 'CONCEPT' | 'SKILL' | 'COMPETENCY';

const TABLE_CONFIG: Record<MappingKind, { table: string; column: string }> = {
  CONCEPT: { table: 'objective_concept_mappings', column: 'canonical_concept_id' },
  SKILL: { table: 'objective_skill_mappings', column: 'skill_id' },
  COMPETENCY: { table: 'objective_competency_mappings', column: 'competency_id' },
};

export class SelfApprovalError extends Error {
  constructor(public mappingId: string, public actorUserId: string) {
    super(`${actorUserId} cannot approve mapping ${mappingId} -- creator and reviewer must differ (task 15)`);
  }
}
export class EditorialPermissionError extends Error {
  constructor(role: string, action: string) {
    super(`missing ACTIVE ${role} grant required for ${action}`);
  }
}
export class InvalidMappingTransitionError extends Error {
  constructor(from: string, to: string) {
    super(`cannot transition mapping from ${from} to ${to}`);
  }
}

function toMapping(kind: MappingKind, r: any): MappingRecord {
  const column = TABLE_CONFIG[kind].column;
  return {
    id: r.id,
    learningObjectiveId: r.learning_objective_id,
    targetId: r[column],
    relationType: r.relation_type,
    scope: r.scope,
    level: r.level,
    rationale: r.rationale,
    provenance: r.provenance,
    confidence: r.confidence !== null && r.confidence !== undefined ? Number(r.confidence) : null,
    status: r.status,
    mappingGroupId: r.mapping_group_id,
    version: r.version,
    createdBy: r.created_by,
    reviewedBy: r.reviewed_by,
    reviewedAt: r.reviewed_at,
    publishedAt: r.published_at,
  };
}

export async function createMapping(
  kind: MappingKind,
  actorUserId: string,
  params: { learningObjectiveId: string; targetId: string; relationType: RelationType; scope?: string; level?: string; rationale?: string; provenance?: MappingProvenance; confidence?: number }
): Promise<MappingRecord> {
  if (!(await hasEditorialRole(actorUserId, 'EDITOR'))) throw new EditorialPermissionError('EDITOR', 'createMapping');
  const { table, column } = TABLE_CONFIG[kind];
  const result = await db.query(
    `INSERT INTO ${table} (learning_objective_id, ${column}, relation_type, scope, level, rationale, provenance, confidence, status, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'DRAFT', $9)
     RETURNING *`,
    [params.learningObjectiveId, params.targetId, params.relationType, params.scope ?? null, params.level ?? null, params.rationale ?? null, params.provenance ?? 'MANUAL', params.confidence ?? null, actorUserId]
  );
  return toMapping(kind, result.rows[0]);
}

async function transition(kind: MappingKind, mappingId: string, from: string[], to: string, extraSet: string, extraParams: unknown[], client: DbExecutor = db): Promise<MappingRecord> {
  const { table } = TABLE_CONFIG[kind];
  const current = await client.query(`SELECT status FROM ${table} WHERE id = $1`, [mappingId]);
  if (current.rows.length === 0) throw new Error(`mapping ${mappingId} not found`);
  if (!from.includes(current.rows[0].status)) throw new InvalidMappingTransitionError(current.rows[0].status, to);
  const result = await client.query(
    `UPDATE ${table} SET status = $1${extraSet} WHERE id = $2 RETURNING *`,
    [to, mappingId, ...extraParams]
  );
  return toMapping(kind, result.rows[0]);
}

export async function proposeMapping(kind: MappingKind, actorUserId: string, mappingId: string): Promise<MappingRecord> {
  if (!(await hasEditorialRole(actorUserId, 'EDITOR'))) throw new EditorialPermissionError('EDITOR', 'proposeMapping');
  return transition(kind, mappingId, ['DRAFT'], 'PROPOSED', '', []);
}

export async function beginReview(kind: MappingKind, actorUserId: string, mappingId: string): Promise<MappingRecord> {
  if (!(await hasEditorialRole(actorUserId, 'REVIEWER'))) throw new EditorialPermissionError('REVIEWER', 'beginReview');
  return transition(kind, mappingId, ['PROPOSED'], 'IN_REVIEW', ', reviewed_by = $3', [actorUserId]);
}

/** Task 15/AC-F6-10: creator != reviewer, enforced by an explicit equality check, not inferred. */
export async function approveMapping(kind: MappingKind, actorUserId: string, mappingId: string): Promise<MappingRecord> {
  if (!(await hasEditorialRole(actorUserId, 'REVIEWER'))) throw new EditorialPermissionError('REVIEWER', 'approveMapping');
  const { table } = TABLE_CONFIG[kind];
  const current = await db.query(`SELECT created_by, status FROM ${table} WHERE id = $1`, [mappingId]);
  if (current.rows.length === 0) throw new Error(`mapping ${mappingId} not found`);
  if (current.rows[0].created_by === actorUserId) throw new SelfApprovalError(mappingId, actorUserId);
  return transition(kind, mappingId, ['IN_REVIEW'], 'APPROVED', ', reviewed_by = $3, reviewed_at = now()', [actorUserId]);
}

export async function rejectMapping(kind: MappingKind, actorUserId: string, mappingId: string): Promise<MappingRecord> {
  if (!(await hasEditorialRole(actorUserId, 'REVIEWER'))) throw new EditorialPermissionError('REVIEWER', 'rejectMapping');
  return transition(kind, mappingId, ['PROPOSED', 'IN_REVIEW'], 'REJECTED', ', reviewed_by = $3, reviewed_at = now()', [actorUserId]);
}

/**
 * Publishes an APPROVED mapping. If another row in the SAME
 * mapping_group_id is currently PUBLISHED (a version replacement), it is
 * retired atomically in the same transaction -- never left PUBLISHED
 * alongside the new one, never deleted (INV-F6-09).
 */
export async function publishMapping(kind: MappingKind, actorUserId: string, mappingId: string): Promise<MappingRecord> {
  if (!(await hasEditorialRole(actorUserId, 'PUBLISHER'))) throw new EditorialPermissionError('PUBLISHER', 'publishMapping');
  const { table } = TABLE_CONFIG[kind];
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query(`SELECT status, mapping_group_id FROM ${table} WHERE id = $1`, [mappingId]);
    if (current.rows.length === 0) throw new Error(`mapping ${mappingId} not found`);
    if (current.rows[0].status !== 'APPROVED') throw new InvalidMappingTransitionError(current.rows[0].status, 'PUBLISHED');
    await client.query(
      `UPDATE ${table} SET status = 'RETIRED' WHERE mapping_group_id = $1 AND status = 'PUBLISHED' AND id <> $2`,
      [current.rows[0].mapping_group_id, mappingId]
    );
    const result = await client.query(`UPDATE ${table} SET status = 'PUBLISHED', published_at = now() WHERE id = $1 RETURNING *`, [mappingId]);
    await client.query('COMMIT');
    return toMapping(kind, result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Direct retirement without a replacement (adversarial case G). */
export async function retireMapping(kind: MappingKind, actorUserId: string, mappingId: string): Promise<MappingRecord> {
  if (!(await hasEditorialRole(actorUserId, 'PUBLISHER'))) throw new EditorialPermissionError('PUBLISHER', 'retireMapping');
  return transition(kind, mappingId, ['PUBLISHED'], 'RETIRED', '', []);
}

/** Creates a new DRAFT version of a mapping in the SAME mapping_group_id -- the only way to "change" a published mapping (task 12). */
export async function createNewMappingVersion(
  kind: MappingKind,
  actorUserId: string,
  previousMappingId: string,
  overrides: { relationType?: RelationType; scope?: string; level?: string; rationale?: string }
): Promise<MappingRecord> {
  if (!(await hasEditorialRole(actorUserId, 'EDITOR'))) throw new EditorialPermissionError('EDITOR', 'createNewMappingVersion');
  const { table, column } = TABLE_CONFIG[kind];
  const previous = await db.query(`SELECT * FROM ${table} WHERE id = $1`, [previousMappingId]);
  if (previous.rows.length === 0) throw new Error(`mapping ${previousMappingId} not found`);
  const p = previous.rows[0];
  const result = await db.query(
    `INSERT INTO ${table} (learning_objective_id, ${column}, relation_type, scope, level, rationale, provenance, status, mapping_group_id, version, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, 'MANUAL', 'DRAFT', $7, $8, $9)
     RETURNING *`,
    [
      p.learning_objective_id,
      p[column],
      overrides.relationType ?? p.relation_type,
      overrides.scope ?? p.scope,
      overrides.level ?? p.level,
      overrides.rationale ?? p.rationale,
      p.mapping_group_id,
      p.version + 1,
      actorUserId,
    ]
  );
  return toMapping(kind, result.rows[0]);
}

export async function getMapping(kind: MappingKind, mappingId: string): Promise<MappingRecord | null> {
  const { table } = TABLE_CONFIG[kind];
  const result = await db.query(`SELECT * FROM ${table} WHERE id = $1`, [mappingId]);
  return result.rows.length === 0 ? null : toMapping(kind, result.rows[0]);
}

export async function listMappingsForObjective(kind: MappingKind, learningObjectiveId: string, status?: string): Promise<MappingRecord[]> {
  const { table } = TABLE_CONFIG[kind];
  const result = status
    ? await db.query(`SELECT * FROM ${table} WHERE learning_objective_id = $1 AND status = $2`, [learningObjectiveId, status])
    : await db.query(`SELECT * FROM ${table} WHERE learning_objective_id = $1`, [learningObjectiveId]);
  return result.rows.map((r: any) => toMapping(kind, r));
}
