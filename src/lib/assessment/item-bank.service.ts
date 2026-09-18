/**
 * F7 -- Approved Item / Item Family (task 24). Its own independent
 * DRAFT..PUBLISHED workflow -- NEVER inherited from F6's
 * objective_concept_mappings.status (INV-F7-14). An approved Canonical
 * Concept mapping does not make any generated question automatically
 * approved.
 */
import { db } from '@/lib/db';
import type { ApprovedItem, WorkflowStatus } from './types';

function toItem(r: any): ApprovedItem {
  return { id: r.id, approvedItemFamilyId: r.approved_item_family_id, learningObjectiveId: r.learning_objective_id, questionType: r.question_type, content: r.content, status: r.status, createdBy: r.created_by };
}

export async function createApprovedItemFamily(actorUserId: string, params: { learningObjectiveId: string; familyKey: string; parameterization?: Record<string, unknown> }): Promise<{ id: string; status: WorkflowStatus }> {
  const result = await db.query(
    `INSERT INTO approved_item_families (learning_objective_id, family_key, parameterization, created_by) VALUES ($1, $2, $3, $4) RETURNING id, status`,
    [params.learningObjectiveId, params.familyKey, params.parameterization ? JSON.stringify(params.parameterization) : null, actorUserId]
  );
  return result.rows[0];
}

export async function createApprovedItem(actorUserId: string, params: { learningObjectiveId: string; approvedItemFamilyId?: string; questionType: string; content: Record<string, unknown> }): Promise<ApprovedItem> {
  const result = await db.query(
    `INSERT INTO approved_items (approved_item_family_id, learning_objective_id, question_type, content, created_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [params.approvedItemFamilyId ?? null, params.learningObjectiveId, params.questionType, JSON.stringify(params.content), actorUserId]
  );
  return toItem(result.rows[0]);
}

async function transitionItem(itemId: string, from: string[], to: string, extra: { reviewedBy?: string; setPublishedAt?: boolean } = {}): Promise<ApprovedItem> {
  const current = await db.query(`SELECT status FROM approved_items WHERE id = $1`, [itemId]);
  if (current.rows.length === 0) throw new Error(`approved item ${itemId} not found`);
  if (!from.includes(current.rows[0].status)) throw new Error(`cannot transition item from ${current.rows[0].status} to ${to}`);
  const result = extra.reviewedBy
    ? await db.query(`UPDATE approved_items SET status = $1, reviewed_by = $2, reviewed_at = now()${extra.setPublishedAt ? ', published_at = now()' : ''} WHERE id = $3 RETURNING *`, [to, extra.reviewedBy, itemId])
    : await db.query(`UPDATE approved_items SET status = $1 WHERE id = $2 RETURNING *`, [to, itemId]);
  return toItem(result.rows[0]);
}

export async function proposeApprovedItem(itemId: string): Promise<ApprovedItem> {
  return transitionItem(itemId, ['DRAFT'], 'PROPOSED');
}
export async function approveApprovedItem(reviewerUserId: string, itemId: string): Promise<ApprovedItem> {
  const current = await db.query(`SELECT created_by FROM approved_items WHERE id = $1`, [itemId]);
  if (current.rows.length > 0 && current.rows[0].created_by === reviewerUserId) {
    throw new Error(`${reviewerUserId} cannot approve their own item ${itemId} (creator != reviewer)`);
  }
  return transitionItem(itemId, ['PROPOSED', 'IN_REVIEW'], 'APPROVED', { reviewedBy: reviewerUserId });
}
export async function publishApprovedItem(itemId: string): Promise<ApprovedItem> {
  return transitionItem(itemId, ['APPROVED'], 'PUBLISHED', { setPublishedAt: true });
}
export async function retireApprovedItem(itemId: string): Promise<ApprovedItem> {
  return transitionItem(itemId, ['PUBLISHED'], 'RETIRED');
}

export async function listPublishedItemsForObjective(learningObjectiveId: string): Promise<ApprovedItem[]> {
  const result = await db.query(`SELECT * FROM approved_items WHERE learning_objective_id = $1 AND status = 'PUBLISHED'`, [learningObjectiveId]);
  return result.rows.map(toItem);
}

export async function getApprovedItem(itemId: string): Promise<ApprovedItem | null> {
  const result = await db.query(`SELECT * FROM approved_items WHERE id = $1`, [itemId]);
  return result.rows.length === 0 ? null : toItem(result.rows[0]);
}
