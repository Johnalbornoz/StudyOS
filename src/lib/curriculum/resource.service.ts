/**
 * F6 -- Academic Resources (task 13/26): an editorial citation/reference,
 * NOT file storage, and a fully independent workflow from mapping
 * approval (INV-F6-10, AC-F6-09) -- same status vocabulary, completely
 * separate tables and transitions.
 */
import { db } from '@/lib/db';
import { hasEditorialRole } from './editorial.service';
import { EditorialPermissionError, InvalidMappingTransitionError, SelfApprovalError } from './mapping.service';
import type { AcademicResource, ResourceType } from './types';

function toResource(r: any): AcademicResource {
  return {
    id: r.id,
    title: r.title,
    resourceType: r.resource_type,
    description: r.description,
    sourceLocator: r.source_locator,
    status: r.status,
    resourceGroupId: r.resource_group_id,
    version: r.version,
    createdBy: r.created_by,
    reviewedBy: r.reviewed_by,
    reviewedAt: r.reviewed_at,
    publishedAt: r.published_at,
  };
}

export async function createResource(actorUserId: string, params: { title: string; resourceType: ResourceType; description?: string; sourceLocator?: string }): Promise<AcademicResource> {
  if (!(await hasEditorialRole(actorUserId, 'EDITOR'))) throw new EditorialPermissionError('EDITOR', 'createResource');
  const result = await db.query(
    `INSERT INTO academic_resources (title, resource_type, description, source_locator, status, created_by)
     VALUES ($1, $2, $3, $4, 'DRAFT', $5) RETURNING *`,
    [params.title, params.resourceType, params.description ?? null, params.sourceLocator ?? null, actorUserId]
  );
  return toResource(result.rows[0]);
}

export async function proposeResource(actorUserId: string, resourceId: string): Promise<AcademicResource> {
  if (!(await hasEditorialRole(actorUserId, 'EDITOR'))) throw new EditorialPermissionError('EDITOR', 'proposeResource');
  const current = await db.query(`SELECT status FROM academic_resources WHERE id = $1`, [resourceId]);
  if (current.rows.length === 0) throw new Error(`resource ${resourceId} not found`);
  if (current.rows[0].status !== 'DRAFT') throw new InvalidMappingTransitionError(current.rows[0].status, 'PROPOSED');
  const result = await db.query(`UPDATE academic_resources SET status = 'PROPOSED' WHERE id = $1 RETURNING *`, [resourceId]);
  return toResource(result.rows[0]);
}

export async function approveResource(actorUserId: string, resourceId: string): Promise<AcademicResource> {
  if (!(await hasEditorialRole(actorUserId, 'REVIEWER'))) throw new EditorialPermissionError('REVIEWER', 'approveResource');
  const current = await db.query(`SELECT status, created_by FROM academic_resources WHERE id = $1`, [resourceId]);
  if (current.rows.length === 0) throw new Error(`resource ${resourceId} not found`);
  if (current.rows[0].created_by === actorUserId) throw new SelfApprovalError(resourceId, actorUserId);
  if (!['PROPOSED', 'IN_REVIEW'].includes(current.rows[0].status)) throw new InvalidMappingTransitionError(current.rows[0].status, 'APPROVED');
  const result = await db.query(
    `UPDATE academic_resources SET status = 'APPROVED', reviewed_by = $2, reviewed_at = now() WHERE id = $1 RETURNING *`,
    [resourceId, actorUserId]
  );
  return toResource(result.rows[0]);
}

export async function rejectResource(actorUserId: string, resourceId: string): Promise<AcademicResource> {
  if (!(await hasEditorialRole(actorUserId, 'REVIEWER'))) throw new EditorialPermissionError('REVIEWER', 'rejectResource');
  const result = await db.query(
    `UPDATE academic_resources SET status = 'REJECTED', reviewed_by = $2, reviewed_at = now() WHERE id = $1 AND status IN ('PROPOSED','IN_REVIEW') RETURNING *`,
    [resourceId, actorUserId]
  );
  if (result.rows.length === 0) throw new Error(`resource ${resourceId} could not be rejected from its current status`);
  return toResource(result.rows[0]);
}

export async function publishResource(actorUserId: string, resourceId: string): Promise<AcademicResource> {
  if (!(await hasEditorialRole(actorUserId, 'PUBLISHER'))) throw new EditorialPermissionError('PUBLISHER', 'publishResource');
  const current = await db.query(`SELECT status FROM academic_resources WHERE id = $1`, [resourceId]);
  if (current.rows.length === 0) throw new Error(`resource ${resourceId} not found`);
  if (current.rows[0].status !== 'APPROVED') throw new InvalidMappingTransitionError(current.rows[0].status, 'PUBLISHED');
  const result = await db.query(`UPDATE academic_resources SET status = 'PUBLISHED', published_at = now() WHERE id = $1 RETURNING *`, [resourceId]);
  return toResource(result.rows[0]);
}

export async function retireResource(actorUserId: string, resourceId: string): Promise<AcademicResource> {
  if (!(await hasEditorialRole(actorUserId, 'PUBLISHER'))) throw new EditorialPermissionError('PUBLISHER', 'retireResource');
  const result = await db.query(`UPDATE academic_resources SET status = 'RETIRED' WHERE id = $1 AND status = 'PUBLISHED' RETURNING *`, [resourceId]);
  if (result.rows.length === 0) throw new Error(`resource ${resourceId} could not be retired from its current status`);
  return toResource(result.rows[0]);
}

export async function linkResourceToObjective(academicResourceId: string, learningObjectiveId: string): Promise<void> {
  await db.query(
    `INSERT INTO resource_objective_links (academic_resource_id, learning_objective_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [academicResourceId, learningObjectiveId]
  );
}

export async function getResource(resourceId: string): Promise<AcademicResource | null> {
  const result = await db.query(`SELECT * FROM academic_resources WHERE id = $1`, [resourceId]);
  return result.rows.length === 0 ? null : toResource(result.rows[0]);
}
