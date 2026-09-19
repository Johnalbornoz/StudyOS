/**
 * F9 -- Simulation eligibility for all four levels (task §11-15).
 * TOPIC_EXAM/DOMAIN_EXAM/MINI_MOCK never depend on FULL_MOCK's own
 * `ready` flag (INV-F9-23) -- each is computed by its own independent
 * call.
 */
import { getBlueprintForVersion, listObjectiveTargets, getObjectiveTarget } from '@/lib/assessment/blueprint.service';
import { getComponent } from '@/lib/assessment/component.service';
import { canFullMockBeOffered } from '@/lib/assessment/full-mock-guard.service';
import { getFullMockEligibility } from './full-mock-eligibility.service';
import type { SimulationEligibility, SimulationType } from './types';

async function isTargetPlatformSupported(assessmentComponentId: string): Promise<boolean> {
  const component = await getComponent(assessmentComponentId);
  return !!component && component.supportStatus === 'SUPPORTED';
}

export async function getSimulationEligibility(params: {
  studentId: string;
  examVersionId: string;
  simulationType: SimulationType;
  learningObjectiveId?: string;
  academicSubjectId?: string;
}): Promise<SimulationEligibility> {
  if (params.simulationType === 'FULL_MOCK') {
    return getFullMockEligibility(params.examVersionId);
  }

  if (params.simulationType === 'MINI_MOCK') {
    const guard = await canFullMockBeOffered(params.examVersionId);
    return {
      simulationType: 'MINI_MOCK',
      eligible: guard.miniMockObjectiveIds.length > 0,
      reasons: guard.miniMockObjectiveIds.length > 0 ? [] : ['NO_FULLY_SUPPORTED_MAPPED_OBJECTIVES'],
      structuralReadiness: guard,
    };
  }

  const blueprint = await getBlueprintForVersion(params.examVersionId);
  if (!blueprint) return { simulationType: params.simulationType, eligible: false, reasons: ['NO_BLUEPRINT_FOR_EXAM_VERSION'] };
  const targets = await listObjectiveTargets(blueprint.id);

  if (params.simulationType === 'TOPIC_EXAM') {
    if (!params.learningObjectiveId) return { simulationType: 'TOPIC_EXAM', eligible: false, reasons: ['LEARNING_OBJECTIVE_ID_REQUIRED'] };
    const matching = targets.filter((t) => t.learningObjectiveId === params.learningObjectiveId);
    if (matching.length === 0) return { simulationType: 'TOPIC_EXAM', eligible: false, reasons: ['NO_BLUEPRINT_TARGET_FOR_OBJECTIVE'] };
    const supported = await Promise.all(matching.map((t) => isTargetPlatformSupported(t.assessmentComponentId)));
    const eligible = supported.some(Boolean);
    return { simulationType: 'TOPIC_EXAM', eligible, reasons: eligible ? [] : ['OBJECTIVE_COMPONENT_UNSUPPORTED'] };
  }

  // DOMAIN_EXAM
  if (!params.academicSubjectId) return { simulationType: 'DOMAIN_EXAM', eligible: false, reasons: ['ACADEMIC_SUBJECT_ID_REQUIRED'] };
  const subjectTargets = [];
  for (const target of targets) {
    const component = await getComponent(target.assessmentComponentId);
    if (component?.academicSubjectId === params.academicSubjectId) subjectTargets.push({ target, component });
  }
  if (subjectTargets.length === 0) return { simulationType: 'DOMAIN_EXAM', eligible: false, reasons: ['NO_BLUEPRINT_TARGETS_FOR_SUBJECT'] };
  const anySupported = subjectTargets.some((t) => t.component?.supportStatus === 'SUPPORTED');
  return { simulationType: 'DOMAIN_EXAM', eligible: anySupported, reasons: anySupported ? [] : ['NO_SUPPORTED_TARGETS_FOR_SUBJECT'] };
}

// Re-export so callers only need one import for either target-lookup helper this module relies on.
export { getObjectiveTarget };
