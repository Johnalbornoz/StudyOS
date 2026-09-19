/**
 * F9 -- the "which activity/simulation next" contract (task §32).
 * Deliberately NOT named remediation.service.ts (Phase 2's own
 * RemediationPattern system) and distinct from F8's selectIntervention
 * (which picks a TEACHING TECHNIQUE within one activity, not which
 * activity to do next) -- see F9_REMEDIATION_LOOP.md. Pure, no AI, no
 * writes: a recommendation only (INV-F9-27).
 */
import { getActiveInterventionPolicy } from '@/lib/teaching/intervention-policy.service';
import { selectIntervention } from '@/lib/teaching/intervention-selection.service';
import type { InterventionType } from '@/lib/teaching/types';
import type { PostExamDiagnosisResult } from './post-exam-diagnosis.service';
import type { ReadinessSnapshot } from '@/lib/readiness/types';
import type { SimulationType } from './types';

export type NextAction =
  | 'REVIEW_KNOWLEDGE' | 'TRAIN_SKILL' | 'TRAIN_TECHNIQUE' | 'TRAIN_FLUENCY'
  | 'MORE_EVIDENCE_NEEDED' | 'RETRY_TOPIC_EXAM' | 'RETRY_DOMAIN_EXAM' | 'MINI_MOCK' | 'FULL_MOCK' | 'CONTINUE_LEARNING';

export interface NextActionRecommendation {
  action: NextAction;
  rationale: string[];
  relatedGapDiagnosisIds: string[];
  relatedInterventionType?: InterventionType;
}

export async function determineNextAction(params: {
  postExamDiagnosis: PostExamDiagnosisResult;
  readinessSnapshot: ReadinessSnapshot;
  simulationType: SimulationType;
}): Promise<NextActionRecommendation> {
  const { postExamDiagnosis, readinessSnapshot, simulationType } = params;
  const relatedGapDiagnosisIds = postExamDiagnosis.diagnoses.map((d) => d.id);

  const gapOrder: Array<{ action: NextAction; ids: string[]; gapType: 'KNOWLEDGE_GAP' | 'SKILL_GAP' | 'EXAM_TECHNIQUE_GAP' | 'SPEED_FLUENCY_GAP' }> = [
    { action: 'REVIEW_KNOWLEDGE', ids: postExamDiagnosis.knowledgeGaps, gapType: 'KNOWLEDGE_GAP' },
    { action: 'TRAIN_TECHNIQUE', ids: postExamDiagnosis.examTechniqueGaps, gapType: 'EXAM_TECHNIQUE_GAP' },
    { action: 'TRAIN_SKILL', ids: postExamDiagnosis.skillGaps, gapType: 'SKILL_GAP' },
    { action: 'TRAIN_FLUENCY', ids: postExamDiagnosis.speedFluencyGaps, gapType: 'SPEED_FLUENCY_GAP' },
  ];

  for (const entry of gapOrder) {
    if (entry.ids.length > 0) {
      const policy = await getActiveInterventionPolicy();
      const chain = policy.rules.chains[entry.gapType];
      return { action: entry.action, rationale: [`${entry.gapType}_DIAGNOSED`], relatedGapDiagnosisIds, relatedInterventionType: chain?.[0] };
    }
  }

  if (postExamDiagnosis.insufficientEvidenceAreas.length > 0) {
    return { action: 'MORE_EVIDENCE_NEEDED', rationale: ['INSUFFICIENT_EVIDENCE_AREAS_REMAIN'], relatedGapDiagnosisIds };
  }

  if (simulationType === 'TOPIC_EXAM' && (readinessSnapshot.overallStatus === 'EARLY_PREPARATION' || readinessSnapshot.overallStatus === 'DEVELOPING')) {
    return { action: 'RETRY_DOMAIN_EXAM', rationale: ['NO_GAPS_BUT_DOMAIN_READINESS_NOT_YET_SIMULATION_READY'], relatedGapDiagnosisIds };
  }
  if (simulationType === 'DOMAIN_EXAM' && readinessSnapshot.overallStatus === 'SIMULATION_READY') {
    return { action: 'MINI_MOCK', rationale: ['DOMAIN_EXAM_CLEAR_AND_SIMULATION_READY'], relatedGapDiagnosisIds };
  }
  if (simulationType === 'MINI_MOCK' && readinessSnapshot.overallStatus === 'FULL_MOCK_ELIGIBLE') {
    return { action: 'FULL_MOCK', rationale: ['MINI_MOCK_CLEAR_AND_FULL_MOCK_ELIGIBLE'], relatedGapDiagnosisIds };
  }
  if (simulationType === 'TOPIC_EXAM') return { action: 'RETRY_TOPIC_EXAM', rationale: ['NO_GAPS_DETECTED_BUT_LEVEL_NOT_YET_EXHAUSTED'], relatedGapDiagnosisIds };
  if (simulationType === 'DOMAIN_EXAM') return { action: 'RETRY_DOMAIN_EXAM', rationale: ['NO_GAPS_DETECTED_BUT_LEVEL_NOT_YET_EXHAUSTED'], relatedGapDiagnosisIds };

  return { action: 'CONTINUE_LEARNING', rationale: ['NO_URGENT_GAP_NO_OBVIOUS_NEXT_SIMULATION_STEP'], relatedGapDiagnosisIds };
}
