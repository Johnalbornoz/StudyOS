/**
 * F9 -- deterministic Simulation Plan builder (task §20-22). Reads real
 * blueprint data only; never invents a target. AI is never given
 * authority over any field in the returned plan (task §21/47).
 */
import { db } from '@/lib/db';
import { getBlueprintForVersion, listObjectiveTargets } from '@/lib/assessment/blueprint.service';
import { blueprintV2Mode } from '@/lib/exam-core/blueprint-v2/flag';
import { getComponent, listComponentsForVersion } from '@/lib/assessment/component.service';
import { getExamVersion } from '@/lib/assessment/exam-definition.service';
import { canFullMockBeOffered } from '@/lib/assessment/full-mock-guard.service';
import type { BlueprintObjectiveTarget } from '@/lib/assessment/types';
import type { AssessmentComponent } from '@/lib/assessment/types';
import type { SimulationPlan, SimulationPlanSection, SimulationPlanTarget, SimulationType, TimingMode } from './types';

/**
 * Track B: targets are grouped by section (component) in the version's
 * section order, keeping blueprint order inside a section -- a stable sort,
 * so the same blueprint always yields the same plan order.
 */
export function orderTargetsBySection<T extends { assessmentComponentId: string }>(targets: T[], components: AssessmentComponent[]): T[] {
  const order = new Map(components.map((c, i) => [c.id, i]));
  return targets
    .map((t, i) => ({ t, i }))
    .sort((a, b) => (order.get(a.t.assessmentComponentId) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.t.assessmentComponentId) ?? Number.MAX_SAFE_INTEGER) || a.i - b.i)
    .map((x) => x.t);
}

/** Contiguous runs of the same component in `selectedTargets` (works for pre-Track-B plans too). */
export function deriveSections(
  selectedTargets: Array<{ assessmentComponentId: string }>,
  components: Array<Pick<AssessmentComponent, 'id' | 'name' | 'durationMinutes' | 'timingStatus'> & { sectionKey?: string | null }>,
  timingMode: TimingMode
): SimulationPlanSection[] {
  const byId = new Map(components.map((c) => [c.id, c]));
  const sections: SimulationPlanSection[] = [];
  selectedTargets.forEach((t, index) => {
    const last = sections[sections.length - 1];
    if (last && last.componentId === t.assessmentComponentId) {
      last.endIndex = index;
      return;
    }
    const c = byId.get(t.assessmentComponentId);
    sections.push({
      componentId: t.assessmentComponentId,
      key: c?.sectionKey ?? t.assessmentComponentId,
      name: c?.name ?? t.assessmentComponentId,
      order: sections.length,
      startIndex: index,
      endIndex: index,
      durationSeconds: timingMode !== 'UNTIMED' && c && c.timingStatus === 'CONFIGURED' && c.durationMinutes !== null ? c.durationMinutes * 60 : null,
    });
  });
  return sections;
}

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
  /** Exam V2: restrict the plan to these components (an exam instance's selected papers). */
  assessmentComponentIds?: string[];
  /** Exam V2: restrict the plan to these objectives (skill-level practice). */
  learningObjectiveIds?: string[];
}): Promise<SimulationPlan> {
  const versionComponents = await listComponentsForVersion(params.examVersionId);
  const only = params.assessmentComponentIds && params.assessmentComponentIds.length > 0 ? new Set(params.assessmentComponentIds) : null;
  const focus = params.learningObjectiveIds && params.learningObjectiveIds.length > 0 ? new Set(params.learningObjectiveIds) : null;
  const targets = orderTargetsBySection((await selectTargets(params)).filter((t) => (!only || only.has(t.assessmentComponentId)) && (!focus || focus.has(t.learningObjectiveId))), versionComponents);
  if (targets.length === 0) throw new Error(`no blueprint targets selected for ${params.simulationType}`);

  const examVersion = await getExamVersion(params.examVersionId);
  const blueprint = await getBlueprintForVersion(params.examVersionId);
  // Blueprint V2 SHADOW (BP-4A): only the legacy F9 path (no instance components). An exam-instance plan was
  // already observed once in formInputs -- one shadow observation per flow. Observe only; nothing is returned.
  if (!only && blueprint && blueprintV2Mode() === 'SHADOW') {
    const { shadowObserveSimulationPlan } = await import('@/lib/exam-core/blueprint-v2/runtime-hook');
    const all = await listObjectiveTargets(blueprint.id);
    await shadowObserveSimulationPlan({
      examVersionId: params.examVersionId,
      legacyBlueprintId: blueprint.id,
      simulationType: params.simulationType,
      components: versionComponents.map((c) => ({ id: c.id, sectionKey: c.sectionKey ?? null })),
      allTargets: all.map((t) => ({ id: t.id, learningObjectiveId: t.learningObjectiveId, assessmentComponentId: t.assessmentComponentId, questionType: t.questionType, difficultyMin: t.difficultyMin, difficultyMax: t.difficultyMax, commandTermId: t.commandTermId, ...(t.constraints?.length ? { constraints: t.constraints.map((c) => ({ ...c })) } : {}) })),
    });
  }

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

  const sections = deriveSections(selectedTargets, versionComponents, params.timingMode);

  const plan = {
    simulationType: params.simulationType,
    sections,
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
    sections: plan.sections,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}
