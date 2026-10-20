/**
 * F7 -- Full Mock Guard (task 34). CAN_FULL_MOCK_BE_OFFERED? Pure
 * readiness check -- never the simulator itself. Prepares F9.
 */
import { db } from '@/lib/db';
import { studentAudienceDefinitionSql } from '@/lib/exam-core/audience';
import { certifiedSupplySql } from '@/lib/exam-bank/delivery-scope';
import { lifecycleSqlFor } from '@/lib/exam-core/question-bank/lifecycle';
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
  // BRW-C3-01: set-based -- one read per distinct component and ONE query for every distinct objective (a 175-position
  // form used to run 175 sequential component reads + 175 heavy EXISTS queries inside the hand-in request, ~220 s on
  // Neon). Same predicates, same per-target reasons in the same order.
  const componentIds = [...new Set(targets.map((t) => t.assessmentComponentId))];
  const components = new Map(await Promise.all(componentIds.map(async (id) => [id, await getComponent(id)] as const)));
  const objectiveIds = [...new Set(targets.map((t) => t.learningObjectiveId))];
  const checks = objectiveIds.length === 0 ? [] : (await db.query(
    `SELECT o.id AS objective_id,
       EXISTS(SELECT 1 FROM objective_concept_mappings WHERE learning_objective_id = o.id AND status = 'PUBLISHED') AS has_concept,
       EXISTS(SELECT 1 FROM objective_skill_mappings WHERE learning_objective_id = o.id AND status = 'PUBLISHED') AS has_skill,
       EXISTS(SELECT 1 FROM approved_items ai WHERE ai.learning_objective_id = o.id AND ai.status = 'PUBLISHED' AND ${certifiedSupplySql('ai')}
                AND (${lifecycleSqlFor('PRACTICE', undefined, 'STUDENT')} OR EXISTS (SELECT 1 FROM exam_definitions d WHERE d.id = $2 AND NOT ${studentAudienceDefinitionSql('d')}))) AS has_bank_items,
       EXISTS(SELECT 1 FROM approved_items ai WHERE ai.learning_objective_id = o.id AND ai.status = 'PUBLISHED' AND ${certifiedSupplySql('ai')}
                AND (${lifecycleSqlFor('FULL_MOCK', undefined, 'STUDENT')} OR EXISTS (SELECT 1 FROM exam_definitions d WHERE d.id = $2 AND NOT ${studentAudienceDefinitionSql('d')}))) AS has_mock_items,
       EXISTS(SELECT 1 FROM exam_definitions d WHERE d.id = $2 AND NOT ${studentAudienceDefinitionSql('d')}) AS technical
     FROM unnest($1::uuid[]) WITH ORDINALITY AS o(id, ord) ORDER BY o.ord`,
    // QB-0: a Student exam's bank never counts DEV fixtures; a technical / internal exam is an engine demo (fixtures count).
    // Student exams count only Student-deliverable versions (DEFAULT_ELIGIBILITY: human-approved, never PILOT):
    // has_bank_items = practice-deliverable, has_mock_items = full-mock-deliverable.
    [objectiveIds, examVersion.examDefinitionId ?? null]
  )).rows;
  // one row per objective, in the order asked (WITH ORDINALITY)
  const checkOf = new Map<string, any>(objectiveIds.map((id, i) => [id, checks[i]]));

  for (const target of targets) {
    const component = components.get(target.assessmentComponentId) ?? null;
    const componentOk = !!component && component.supportStatus === 'SUPPORTED' && component.timingStatus === 'CONFIGURED' && component.toolRuleStatus === 'CONFIGURED';

    if (!component) {
      reasons.push(`COMPONENT_NOT_FOUND: ${target.assessmentComponentId}`);
      continue;
    }
    if (component.supportStatus !== 'SUPPORTED') reasons.push(`UNSUPPORTED_COMPONENT: ${component.name}`);
    if (component.timingStatus !== 'CONFIGURED') reasons.push(`TIMING_NOT_CONFIGURED: ${component.name}`);
    if (component.toolRuleStatus !== 'CONFIGURED') reasons.push(`TOOL_RULES_NOT_CONFIGURED: ${component.name}`);

    const check = checkOf.get(target.learningObjectiveId) ?? {};
    const isMapped = check.has_concept || check.has_skill;
    // Track B: an objective is deliverable when items can be generated for it
    // (a published mapping) OR served from the approved bank (published items).
    // A bank-only objective writes no learning evidence (no mapped concept) --
    // honest, never a guessed concept.
    const isDeliverable = isMapped || check.has_bank_items === true;
    if (!isDeliverable) reasons.push(`OBJECTIVE_NOT_MAPPED: ${target.learningObjectiveId}`);
    // QB-0: a FULL mock of a Student exam is never made of on-the-fly generated items -- every objective needs
    // real (non-fixture) bank content. Mapping-only objectives still serve mini-mock practice below.
    else if (check.technical !== true && check.has_mock_items !== true) reasons.push(`NO_REAL_MOCK_CONTENT: ${target.learningObjectiveId}`);

    if (componentOk && isDeliverable) miniMockObjectiveIds.push(target.learningObjectiveId);
  }

  return { ready: reasons.length === 0, reasons, miniMockObjectiveIds };
}
