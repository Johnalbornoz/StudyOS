/**
 * TRACK B -- which certified Exam Bank supply this deployment may deliver, and whether a bank version is still
 * part of it NOW.
 *
 * A CORE_DERIVED bank version is a copy of a certified item instance. The copy is deliverable only while the
 * instance is eligible in the scope of the environment: the database decides that, every time, through
 * `student_eligible_item_instances_pilot` / `_production` (core, adapter, renderer envelope, blueprint,
 * applicability, rights, policy, quarantine -- public.assessment_item_instance_refusal). Nothing here caches it.
 *
 * SCOPE. `EXAM_BANK_DELIVERY_SCOPE` (server only) names the scope: PILOT_PREVIEW or PRODUCTION. Unset, or any
 * other value, is PRODUCTION: the narrower scope. A pilot-certified item is therefore never delivered by a
 * deployment that was not explicitly told it is a pilot.
 *
 * A PILOT_CERTIFIED bank version (generated, automated pilot certification -- migration 20261124_1000) is deliverable
 * only in the PILOT_PREVIEW scope and only through `exam_bank_pilot_deliverable_versions`.
 *
 * A LEGACY bank version (not core-derived) is untouched by this rule: `certifiedSupplySql` is TRUE for it.
 * This module reads no Student data and never asks a provider for anything.
 */
import { db } from '@/lib/db';

export type ExamBankDeliveryScope = 'PILOT_PREVIEW' | 'PRODUCTION';
/** The scope of this deployment. Fail closed: anything but an explicit PILOT_PREVIEW is PRODUCTION. */
export const examBankDeliveryScope = (env: Record<string, string | undefined> = process.env): ExamBankDeliveryScope => (env.EXAM_BANK_DELIVERY_SCOPE === 'PILOT_PREVIEW' ? 'PILOT_PREVIEW' : 'PRODUCTION');
const VIEW: Readonly<Record<ExamBankDeliveryScope, string>> = { PILOT_PREVIEW: 'public.student_eligible_item_instances_pilot', PRODUCTION: 'public.student_eligible_item_instances_production' };

/**
 * SQL predicate (alias of `approved_items`): this version is not core-derived, or its certified instance is
 * eligible in the deployment's scope now and its bank item is not retired. Constants only: no input reaches it.
 */
export function certifiedSupplySql(alias = 'ai', scope: ExamBankDeliveryScope = examBankDeliveryScope()): string {
  const governed = `cs_qi.lineage_class IN ('CORE_DERIVED', 'PILOT_CERTIFIED')`;
  // PILOT_CERTIFIED (generated, automatically certified for the pilot): deliverable ONLY by a PILOT_PREVIEW deployment,
  // and only while its certification of exactly this content stands. In any other scope it is never deliverable.
  const pilot = scope === 'PILOT_PREVIEW' ? ` OR EXISTS (SELECT 1 FROM public.exam_bank_pilot_deliverable_versions cs_pv WHERE cs_pv.approved_item_id = ${alias}.id)` : '';
  return `(NOT EXISTS (SELECT 1 FROM public.question_bank_items cs_qi WHERE cs_qi.id = ${alias}.bank_item_id AND ${governed})`
    + ` OR EXISTS (SELECT 1 FROM public.question_bank_items cs_qi JOIN ${VIEW[scope]} cs_el ON cs_el.id = cs_qi.item_instance_id`
    + ` WHERE cs_qi.id = ${alias}.bank_item_id AND cs_qi.lineage_class = 'CORE_DERIVED' AND cs_qi.retired_at IS NULL AND cs_qi.current_version_id = ${alias}.id)${pilot})`;
}

/**
 * Of these bank versions, the core-derived ones that are NOT deliverable now. Asked when a frozen form is started
 * and when a held item is retrieved: an item is never trusted from the moment it was selected.
 */
export async function certifiedItemsNoLongerEligible(approvedItemIds: readonly string[], scope: ExamBankDeliveryScope = examBankDeliveryScope()): Promise<string[]> {
  const ids = [...new Set(approvedItemIds.filter((x) => typeof x === 'string' && x.length > 0))];
  if (ids.length === 0) return [];
  const r = await db.query(`SELECT ai.id FROM approved_items ai WHERE ai.id = ANY($1::uuid[]) AND NOT ${certifiedSupplySql('ai', scope)}`, [ids]);
  return r.rows.map((x: { id: string }) => x.id);
}
