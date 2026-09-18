/**
 * F6 -- Coverage (task 20/21). Computed on read, never persisted as a
 * snapshot (same philosophy as the Digital Learning Twin, F5's
 * assessment). Never combined with learner mastery (INV-F6-04) --
 * F5's learner_skill_state/learner_competency_state/concept_knowledge_state
 * remain the sole mastery authority; this service returns a wholly
 * separate result shape.
 */
import { db } from '@/lib/db';
import type { ContentCoverageResult, CoveragePolicyVersion, MappingCoverageResult } from './types';

export async function getActiveCoveragePolicy(): Promise<CoveragePolicyVersion> {
  const result = await db.query(`SELECT id, version, rules, status FROM coverage_policy_versions WHERE status = 'ACTIVE'`);
  if (result.rows.length === 0) throw new Error('No ACTIVE coverage policy version');
  const r = result.rows[0];
  return { id: r.id, version: r.version, rules: r.rules, status: r.status };
}

/**
 * fullyMappedCount and partiallyMappedCount are ALWAYS reported
 * separately, never summed (AC-F6-08) -- a PARTIAL mapping can never be
 * misread as proof of full coverage. Only PUBLISHED mappings count
 * (task 21) -- DRAFT/PROPOSED/IN_REVIEW/APPROVED/REJECTED/RETIRED never
 * do, regardless of how many exist.
 */
export async function computeMappingCoverage(structureVersionId: string): Promise<MappingCoverageResult> {
  const policy = await getActiveCoveragePolicy();
  const objectives = await db.query(
    `SELECT lo.id FROM learning_objectives lo JOIN structure_nodes sn ON sn.id = lo.structure_node_id WHERE sn.structure_version_id = $1`,
    [structureVersionId]
  );
  const total = objectives.rows.length;
  if (total === 0) return { total: 0, fullyMappedCount: 0, partiallyMappedCount: 0, unmappedCount: 0, policyVersion: policy.version };

  const objectiveIds = objectives.rows.map((r: any) => r.id);
  const mappings = await db.query(
    `SELECT learning_objective_id, relation_type FROM objective_concept_mappings WHERE learning_objective_id = ANY($1::uuid[]) AND status = ANY($2::text[])
     UNION ALL
     SELECT learning_objective_id, relation_type FROM objective_skill_mappings WHERE learning_objective_id = ANY($1::uuid[]) AND status = ANY($2::text[])
     UNION ALL
     SELECT learning_objective_id, relation_type FROM objective_competency_mappings WHERE learning_objective_id = ANY($1::uuid[]) AND status = ANY($2::text[])`,
    [objectiveIds, policy.rules.countedMappingStatuses]
  );

  const byObjective = new Map<string, string[]>();
  for (const row of mappings.rows as Array<{ learning_objective_id: string; relation_type: string }>) {
    const list = byObjective.get(row.learning_objective_id) ?? [];
    list.push(row.relation_type);
    byObjective.set(row.learning_objective_id, list);
  }

  let fullyMappedCount = 0;
  let partiallyMappedCount = 0;
  let unmappedCount = 0;
  for (const objectiveId of objectiveIds) {
    const relationTypes = byObjective.get(objectiveId) ?? [];
    if (relationTypes.some((rt) => policy.rules.fullCoverageRelationTypes.includes(rt))) fullyMappedCount++;
    else if (relationTypes.some((rt) => policy.rules.partialCoverageRelationTypes.includes(rt))) partiallyMappedCount++;
    else unmappedCount++;
  }

  return { total, fullyMappedCount, partiallyMappedCount, unmappedCount, policyVersion: policy.version };
}

/**
 * Duplicate resources never inflate coverage (AC-F6-14): the count is
 * DISTINCT objectives with >=1 PUBLISHED resource, never a resource
 * count. Rejected/DRAFT/unpublished/retired resources never count
 * (task 21).
 */
export async function computeContentCoverage(structureVersionId: string): Promise<ContentCoverageResult> {
  const policy = await getActiveCoveragePolicy();
  const objectives = await db.query(
    `SELECT lo.id FROM learning_objectives lo JOIN structure_nodes sn ON sn.id = lo.structure_node_id WHERE sn.structure_version_id = $1`,
    [structureVersionId]
  );
  const total = objectives.rows.length;
  if (total === 0) return { total: 0, withApprovedResourceCount: 0, policyVersion: policy.version };

  const objectiveIds = objectives.rows.map((r: any) => r.id);
  const covered = await db.query(
    `SELECT COUNT(DISTINCT rol.learning_objective_id)::int AS c
     FROM resource_objective_links rol
     JOIN academic_resources ar ON ar.id = rol.academic_resource_id
     WHERE rol.learning_objective_id = ANY($1::uuid[]) AND ar.status = 'PUBLISHED'`,
    [objectiveIds]
  );

  return { total, withApprovedResourceCount: covered.rows[0].c, policyVersion: policy.version };
}
