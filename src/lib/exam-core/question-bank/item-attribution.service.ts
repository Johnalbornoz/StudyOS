/**
 * QB-R1B -- concept attribution of an item version: what the question is evidence OF, decided by a reviewer.
 *
 * One writer, used by every path that sets attribution (`question_bank_item_concepts`, migration 20261110_1300):
 *   exactly one PRIMARY canonical concept, zero or more SUPPORTING ones, on one item VERSION.
 *
 * Rules (the database enforces the structural ones; this service the governance ones):
 *   - the reviewer is a person -- never a system account -- and is not the author of the version;
 *   - the reviewer holds a qualification in force for the exam family of the item and the canonical subject of the
 *     PRIMARY concept they assign. Attribution is the act that decides the item's subject, so it is made by
 *     someone qualified in that subject;
 *   - nothing is attributed automatically: the concepts are named by the reviewer, never copied from the
 *     objective's mappings and never proposed by this service;
 *   - a competency is not a concept: only `canonical_concepts` ids are accepted;
 *   - attribution is reviewed content: it can be replaced while the version is under review and is fixed once the
 *     version is in use (the database refuses it);
 *   - every change is recorded (who, when, what it was, what it became, why) in the same transaction.
 *
 * Attribution comes BEFORE approval: an approving review of an unattributed version is refused
 * (`PRIMARY_ATTRIBUTION_REQUIRED`, reviewer-qualification.service).
 */
import type { DbExecutor } from '@/lib/db';
import { recordAdminAction } from '@/lib/admin/audit';
import { validQualification } from './reviewer-qualification.service';

export type AttributionRefusal =
  | 'ITEM_VERSION_NOT_FOUND'
  | 'NOT_A_BANK_VERSION'
  | 'REVIEWER_NOT_FOUND'
  | 'REVIEWER_IS_SYSTEM_ACCOUNT'
  | 'REVIEWER_NOT_ACTIVE'
  | 'REVIEWER_IS_AUTHOR'
  | 'PRIMARY_CONCEPT_REQUIRED'
  | 'CONCEPT_NOT_FOUND'
  | 'CONCEPT_LISTED_TWICE'
  | 'EXAM_FAMILY_UNDETERMINED'
  | 'REVIEWER_NOT_QUALIFIED'
  | 'REASON_REQUIRED'
  | 'ATTRIBUTION_FROZEN';

export class ItemAttributionError extends Error {
  constructor(public readonly code: AttributionRefusal, detail = '') {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'ItemAttributionError';
  }
}

export interface ItemAttribution {
  approvedItemId: string;
  primaryConceptId: string | null;
  supportingConceptIds: string[];
  attributedBy: string | null;
  attributedAt: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function loadItemAttribution(client: DbExecutor, approvedItemId: string): Promise<ItemAttribution> {
  const r = await client.query(`SELECT canonical_concept_id, role, attributed_by, attributed_at FROM question_bank_item_concepts WHERE approved_item_id = $1 ORDER BY role, canonical_concept_id`, [approvedItemId]);
  const rows = r.rows as Array<{ canonical_concept_id: string; role: string; attributed_by: string; attributed_at: Date | string }>;
  const primary = rows.find((x) => x.role === 'PRIMARY') ?? null;
  return {
    approvedItemId,
    primaryConceptId: primary?.canonical_concept_id ?? null,
    supportingConceptIds: rows.filter((x) => x.role === 'SUPPORTING').map((x) => x.canonical_concept_id),
    attributedBy: primary?.attributed_by ?? rows[0]?.attributed_by ?? null,
    attributedAt: primary ? new Date(primary.attributed_at).toISOString() : null,
  };
}

export interface SetItemAttributionInput {
  approvedItemId: string;
  reviewerUserId: string;
  /** The ONE canonical concept a correct answer is direct evidence of. */
  primaryConceptId: string;
  supportingConceptIds?: readonly string[];
  /** Why this attribution (the reviewer's note). Kept in the audit record. */
  reason: string;
}

/**
 * Sets the attribution of one item version, replacing what was there. Must run inside the caller's transaction:
 * the previous rows are removed and the new ones written together with the audit record, or not at all.
 */
export async function setItemAttribution(tx: DbExecutor, input: SetItemAttributionInput): Promise<ItemAttribution> {
  const supporting = [...(input.supportingConceptIds ?? [])];
  if (!input.primaryConceptId || !UUID.test(input.primaryConceptId)) throw new ItemAttributionError('PRIMARY_CONCEPT_REQUIRED', 'exactly one PRIMARY canonical concept id');
  if (supporting.some((id) => !UUID.test(id))) throw new ItemAttributionError('CONCEPT_NOT_FOUND', 'a SUPPORTING concept is not a canonical concept id');
  if (new Set([input.primaryConceptId, ...supporting]).size !== supporting.length + 1) throw new ItemAttributionError('CONCEPT_LISTED_TWICE', 'a concept has one role in an item version');
  if (input.reason.trim().length < 5) throw new ItemAttributionError('REASON_REQUIRED');

  const item = await tx.query(
    `SELECT ai.created_by, ai.bank_item_id, ai.bank_lifecycle_status, ed.exam_family
       FROM approved_items ai
       LEFT JOIN question_bank_items qi ON qi.id = ai.bank_item_id
       LEFT JOIN exam_versions ev ON ev.id = qi.exam_version_id
       LEFT JOIN exam_definitions ed ON ed.id = ev.exam_definition_id
      WHERE ai.id = $1 FOR UPDATE OF ai`,
    [input.approvedItemId]
  );
  const row = item.rows[0];
  if (!row) throw new ItemAttributionError('ITEM_VERSION_NOT_FOUND', input.approvedItemId);
  if (!row.bank_item_id) throw new ItemAttributionError('NOT_A_BANK_VERSION', input.approvedItemId);
  const reviewer = (await tx.query(`SELECT is_system, status FROM users WHERE id = $1`, [input.reviewerUserId])).rows[0];
  if (!reviewer) throw new ItemAttributionError('REVIEWER_NOT_FOUND', input.reviewerUserId);
  if (reviewer.is_system === true) throw new ItemAttributionError('REVIEWER_IS_SYSTEM_ACCOUNT', "attribution is a reviewer's decision; a system account never makes it");
  if (reviewer.status !== 'ACTIVE') throw new ItemAttributionError('REVIEWER_NOT_ACTIVE', reviewer.status);
  if (row.created_by === input.reviewerUserId) throw new ItemAttributionError('REVIEWER_IS_AUTHOR', 'the author does not attribute their own item');
  if (!row.exam_family) throw new ItemAttributionError('EXAM_FAMILY_UNDETERMINED', input.approvedItemId);

  const concepts = await tx.query(`SELECT id, canonical_subject_id FROM canonical_concepts WHERE id = ANY($1::uuid[]) AND status = 'ACTIVE'`, [[input.primaryConceptId, ...supporting]]);
  const subjectOf = new Map<string, string>((concepts.rows as any[]).map((c) => [c.id as string, c.canonical_subject_id as string]));
  for (const id of [input.primaryConceptId, ...supporting]) if (!subjectOf.has(id)) throw new ItemAttributionError('CONCEPT_NOT_FOUND', `${id} is not an active canonical concept`);

  const held = await validQualification(tx, { reviewerUserId: input.reviewerUserId, examFamily: row.exam_family, canonicalSubjectIds: [subjectOf.get(input.primaryConceptId)!] });
  if (!held) throw new ItemAttributionError('REVIEWER_NOT_QUALIFIED', `no valid qualification for exam family ${row.exam_family} and the canonical subject of the PRIMARY concept`);

  const before = await loadItemAttribution(tx, input.approvedItemId);
  try {
    await tx.query(`DELETE FROM question_bank_item_concepts WHERE approved_item_id = $1`, [input.approvedItemId]);
    await tx.query(`INSERT INTO question_bank_item_concepts (approved_item_id, canonical_concept_id, role, attributed_by) VALUES ($1, $2, 'PRIMARY', $3)`, [input.approvedItemId, input.primaryConceptId, input.reviewerUserId]);
    for (const id of supporting) await tx.query(`INSERT INTO question_bank_item_concepts (approved_item_id, canonical_concept_id, role, attributed_by) VALUES ($1, $2, 'SUPPORTING', $3)`, [input.approvedItemId, id, input.reviewerUserId]);
  } catch (e) {
    if (/QUESTION_BANK_ATTRIBUTION_FROZEN/.test((e as Error).message)) throw new ItemAttributionError('ATTRIBUTION_FROZEN', `version is ${row.bank_lifecycle_status}; attribute a new version instead`);
    throw e;
  }
  const after = await loadItemAttribution(tx, input.approvedItemId);
  await recordAdminAction(
    {
      actorUserId: input.reviewerUserId, action: 'QUESTION_BANK_ITEM_ATTRIBUTION_SET', targetType: 'QUESTION_BANK_ITEM_VERSION', targetId: input.approvedItemId,
      previousState: { primaryConceptId: before.primaryConceptId, supportingConceptIds: before.supportingConceptIds, attributedBy: before.attributedBy },
      newState: { primaryConceptId: after.primaryConceptId, supportingConceptIds: after.supportingConceptIds, reviewerQualificationId: held.qualificationId },
      reason: input.reason.trim(),
    },
    tx
  );
  return after;
}
