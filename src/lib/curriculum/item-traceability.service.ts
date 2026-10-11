/**
 * Curriculum traceability of Question Bank item versions (read-only).
 *
 * An item version is linked to ONE Topic node (`question_bank_item_curriculum_nodes`); its official Domain is
 * that Topic's parent and its Section the Domain's parent. The link table allows one row per item version and
 * only a Topic under a Domain, so "exactly one Domain and exactly one Topic" is structural, not computed.
 * An item version with no link is untraced (every legacy item): nothing is derived or guessed for it.
 */
import { db, type DbExecutor } from '@/lib/db';

export interface ItemCurriculumTrace {
  approvedItemId: string;
  structureVersionId: string;
  topic: { nodeId: string; code: string | null; label: string; authority: string | null };
  domain: { nodeId: string; code: string | null; label: string };
  section: { nodeId: string; code: string | null; label: string } | null;
  /** The item's objective hangs from the same Domain node as its Topic. False when the objective was not placed under a Domain. */
  objectiveUnderSameDomain: boolean;
}

/** Traces of the given item versions. A version with no link is absent from the map. */
export async function loadItemCurriculumTraces(approvedItemIds: readonly string[], client: DbExecutor = db): Promise<Map<string, ItemCurriculumTrace>> {
  const out = new Map<string, ItemCurriculumTrace>();
  if (approvedItemIds.length === 0) return out;
  const ready = await client.query(`SELECT to_regclass('public.question_bank_item_curriculum_nodes') IS NOT NULL AS ready`);
  if (ready.rows[0]?.ready !== true) return out;
  const r = await client.query(
    `SELECT l.approved_item_id, t.structure_version_id, t.id AS topic_id, t.code AS topic_code, t.source_label AS topic_label, t.source AS topic_authority,
            d.id AS domain_id, d.code AS domain_code, d.source_label AS domain_label, s.id AS section_id, s.code AS section_code, s.source_label AS section_label,
            (lo.structure_node_id = d.id) AS objective_under_domain
       FROM question_bank_item_curriculum_nodes l
       JOIN structure_nodes t ON t.id = l.structure_node_id
       JOIN structure_nodes d ON d.id = t.parent_id
       LEFT JOIN structure_nodes s ON s.id = d.parent_id
       JOIN approved_items ai ON ai.id = l.approved_item_id
       JOIN learning_objectives lo ON lo.id = ai.learning_objective_id
      WHERE l.approved_item_id = ANY($1::uuid[])`,
    [[...new Set(approvedItemIds)]]
  );
  for (const x of r.rows as any[]) {
    out.set(x.approved_item_id, {
      approvedItemId: x.approved_item_id, structureVersionId: x.structure_version_id,
      topic: { nodeId: x.topic_id, code: x.topic_code ?? null, label: x.topic_label, authority: x.topic_authority ?? null },
      domain: { nodeId: x.domain_id, code: x.domain_code ?? null, label: x.domain_label },
      section: x.section_id ? { nodeId: x.section_id, code: x.section_code ?? null, label: x.section_label } : null,
      objectiveUnderSameDomain: x.objective_under_domain === true,
    });
  }
  return out;
}
