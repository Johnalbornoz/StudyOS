/**
 * F9 -- deterministic Simulation Plan builder (task §20-22). Reads real
 * blueprint data only; never invents a target. AI is never given
 * authority over any field in the returned plan (task §21/47).
 */
import { db } from '@/lib/db';
import { getBlueprintForVersion, listObjectiveTargets } from '@/lib/assessment/blueprint.service';
import { getComponent } from '@/lib/assessment/component.service';
import { getExamVersion } from '@/lib/assessment/exam-definition.service';
import { canFullMockBeOffered } from '@/lib/assessment/full-mock-guard.service';
import type { BlueprintObjectiveTarget } from '@/lib/assessment/types';
import type { SimulationPlan, SimulationPlanTarget, SimulationType, TimingMode } from './types';

export class TimingConfigurationError extends Error {
  constructor(componentName: string) {
    super(`TIMING_NOT_CONFIGURED: ${componentName} -- cannot build a ${'TRAINING_TIMED/OFFICIAL_SIMULATION_TIMED'} plan`);
    this.name = 'TimingConfigurationError';
  }
}

async function selectTargets(params: {
  examVersionId: string;
  simulationType: SimulationType;
  learningObjectiveId?: string;
  academicSubjectId?: string;
}): Promise<BlueprintObjectiveTarget[]> {
  const blueprint = await getBlueprintForVersion(params.examVersionId);
  if (!blueprint) throw new Error(`no blueprint for exam version ${params.examVersionId}`);
  const allTargets = await listObjectiveTargets(blueprint.id);

  switch (params.simulationType) {
    case 'TOPIC_EXAM':
      return allTargets.filter((t) => t.learningObjectiveId === params.learningObjectiveId);
    case 'DOMAIN_EXAM': {
      const result: BlueprintObjectiveTarget[] = [];
      for (const t of allTargets) {
        const component = await getComponent(t.assessmentComponentId);
        if (component?.academicSubjectId === params.academicSubjectId) result.push(t);
      }
      return result;
    }
    case 'MINI_MOCK': {
      const guard = await canFullMockBeOffered(params.examVersionId);
      return allTargets.filter((t) => guard.miniMockObjectiveIds.includes(t.learningObjectiveId));
    }
    case 'FULL_MOCK':
      return allTargets;
  }
}

export async function buildSimulationPlan(params: {
  studentId: string;
  examVersionId: string;
  simulationType: SimulationType;
  learningObjectiveId?: string;
  academicSubjectId?: string;
  timingMode: TimingMode;
  readinessSnapshotId?: string;
}): Promise<SimulationPlan> {
  const targets = await selectTargets(params);
  if (targets.length === 0) throw new Error(`no blueprint targets selected for ${params.simulationType}`);

  const examVersion = await getExamVersion(params.examVersionId);
  const blueprint = await getBlueprintForVersion(params.examVersionId);

  const selectedTargets: SimulationPlanTarget[] = [];
  const toolRules: Record<string, Record<string, unknown> | null> = {};
  let totalSeconds = 0;
  const componentsSeen = new Set<string>();

  for (const target of targets) {
    const component = await getComponent(target.assessmentComponentId);
    if (!component) continue;

    if (params.timingMode !== 'UNTIMED') {
      if (component.timingStatus !== 'CONFIGURED' || component.durationMinutes === null) {
        throw new TimingConfigurationError(component.name);
      }
      if (!componentsSeen.has(component.id)) {
        totalSeconds += component.durationMinutes * 60;
      }
    }
    componentsSeen.add(component.id);
    toolRules[component.id] = component.toolRuleStatus === 'CONFIGURED' ? component.toolRules : null;

    const componentSeconds = params.timingMode === 'UNTIMED' || component.durationMinutes === null ? null : Math.floor((component.durationMinutes * 60) / targets.filter((t) => t.assessmentComponentId === component.id).length);

    selectedTargets.push({
      blueprintObjectiveTargetId: target.id,
      assessmentComponentId: target.assessmentComponentId,
      questionType: target.questionType,
      difficultyRange: target.difficultyMin !== null && target.difficultyMax !== null ? { min: target.difficultyMin, max: target.difficultyMax } : null,
      reasoningRequirement: target.reasoningRequirement,
      commandTermId: target.commandTermId,
      allocatedSeconds: componentSeconds,
    });
  }

  const plan = {
    simulationType: params.simulationType,
    frameworkVersion: { examVersionId: params.examVersionId, blueprintId: blueprint?.id ?? null },
    selectedTargets,
    timingAllocation: { mode: params.timingMode, totalSeconds: params.timingMode === 'UNTIMED' ? null : totalSeconds },
    toolRules,
    scoringConfiguration: { scoringModelId: examVersion?.scoringModelId ?? null },
  };

  const result = await db.query(
    `INSERT INTO simulation_plans (student_id, exam_version_id, blueprint_id, simulation_type, readiness_snapshot_id, plan)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, created_at`,
    [params.studentId, params.examVersionId, blueprint?.id ?? null, params.simulationType, params.readinessSnapshotId ?? null, JSON.stringify(plan)]
  );

  return {
    id: result.rows[0].id,
    studentId: params.studentId,
    examVersionId: params.examVersionId,
    blueprintId: blueprint?.id ?? null,
    readinessSnapshotId: params.readinessSnapshotId ?? null,
    ...plan,
    createdAt: result.rows[0].created_at instanceof Date ? result.rows[0].created_at.toISOString() : result.rows[0].created_at,
  };
}

export async function getSimulationPlanById(id: string): Promise<SimulationPlan | null> {
  const result = await db.query(`SELECT * FROM simulation_plans WHERE id = $1`, [id]);
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  const plan = row.plan;
  return {
    id: row.id,
    studentId: row.student_id,
    examVersionId: row.exam_version_id,
    blueprintId: row.blueprint_id,
    simulationType: row.simulation_type,
    readinessSnapshotId: row.readiness_snapshot_id,
    selectedTargets: plan.selectedTargets,
    timingAllocation: plan.timingAllocation,
    toolRules: plan.toolRules,
    scoringConfiguration: plan.scoringConfiguration,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}
