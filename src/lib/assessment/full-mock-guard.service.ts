/**
 * F7 -- Full Mock Guard (task 34). CAN_FULL_MOCK_BE_OFFERED? Pure
 * readiness check -- never the simulator itself. Prepares F9.
 */
import { db } from '@/lib/db';
import { getExamVersion } from './exam-definition.service';
import { getBlueprintForVersion, listObjectiveTargets } from './blueprint.service';
import { getComponent } from './component.service';
import type { FullMockReadiness } from './types';

export async function canFullMockBeOffered(examVersionId: string): Promise<FullMockReadiness> {
  const reasons: string[] = [];
  const miniMockObjectiveIds: string[] = [];

  const examVersion = await getExamVersion(examVersionId);
  if (!examVersion) throw new Error(`exam version ${examVersionId} not found`);

  if (!examVersion.scoringModelId) reasons.push('NO_SCORING_MODEL_CONFIGURED');

  const blueprint = await getBlueprintForVersion(examVersionId);
  if (!blueprint || blueprint.status !== 'PUBLISHED') {
    reasons.push('NO_PUBLISHED_BLUEPRINT');
    return { ready: false, reasons, miniMockObjectiveIds };
  }

  const targets = await listObjectiveTargets(blueprint.id);
  for (const target of targets) {
    const component = await getComponent(target.assessmentComponentId);
    const componentOk = !!component && component.supportStatus === 'SUPPORTED' && component.timingStatus === 'CONFIGURED' && component.toolRuleStatus === 'CONFIGURED';

    if (!component) {
      reasons.push(`COMPONENT_NOT_FOUND: ${target.assessmentComponentId}`);
      continue;
    }
    if (component.supportStatus !== 'SUPPORTED') reasons.push(`UNSUPPORTED_COMPONENT: ${component.name}`);
    if (component.timingStatus !== 'CONFIGURED') reasons.push(`TIMING_NOT_CONFIGURED: ${component.name}`);
    if (component.toolRuleStatus !== 'CONFIGURED') reasons.push(`TOOL_RULES_NOT_CONFIGURED: ${component.name}`);

    const mappingCheck = await db.query(
      `SELECT
         EXISTS(SELECT 1 FROM objective_concept_mappings WHERE learning_objective_id = $1 AND status = 'PUBLISHED') AS has_concept,
         EXISTS(SELECT 1 FROM objective_skill_mappings WHERE learning_objective_id = $1 AND status = 'PUBLISHED') AS has_skill,
         EXISTS(SELECT 1 FROM approved_items WHERE learning_objective_id = $1 AND status = 'PUBLISHED') AS has_bank_items`,
      [target.learningObjectiveId]
    );
    const isMapped = mappingCheck.rows[0].has_concept || mappingCheck.rows[0].has_skill;
    // Track B: an objective is deliverable when items can be generated for it
    // (a published mapping) OR served from the approved bank (published items).
    // A bank-only objective writes no learning evidence (no mapped concept) --
    // honest, never a guessed concept.
    const isDeliverable = isMapped || mappingCheck.rows[0].has_bank_items === true;
    if (!isDeliverable) reasons.push(`OBJECTIVE_NOT_MAPPED: ${target.learningObjectiveId}`);

    if (componentOk && isDeliverable) miniMockObjectiveIds.push(target.learningObjectiveId);
  }

  return { ready: reasons.length === 0, reasons, miniMockObjectiveIds };
}
