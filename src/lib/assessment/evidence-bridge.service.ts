/**
 * F7 -- Evidence Bridge (task 28). Calls F5's REAL, UNMODIFIED
 * updateMastery() with the EXISTING 'EXAM_SIMULATION' evidence source
 * type -- no new evidence-writing path, no change to F5. Never
 * fabricates Competency evidence merely because a competency is
 * contextually relevant to the framework (INV-F7-18, adversarial case
 * M) -- metadata keys are attached ONLY when F6's own PUBLISHED-mapping
 * resolution actually names them.
 *
 * Requires the caller to already know which of the STUDENT'S OWN
 * concepts corresponds to the objective being assessed -- evidence is
 * fundamentally per-student-concept-scoped (F5), while F6 objectives are
 * canonical-scoped. This bridge does not, and cannot, invent that
 * correspondence itself (see F7_EVIDENCE_BRIDGE.md).
 */
import { updateMastery, type MasteryUpdateResult } from '@/services/mastery.service';
import { resolveActivityMetadataForObjective } from '@/lib/curriculum/activity-metadata-bridge.service';
import type { EvidenceResult } from '@/lib/algorithms/mastery';

export interface BridgeExamResponseParams {
  studentId: string;
  conceptId: string;
  subjectId: string;
  learningObjectiveId: string;
  result: EvidenceResult;
  difficulty: number;
  scorePercent?: number;
}

export interface BridgeExamResponseOutcome {
  masteryResult: MasteryUpdateResult;
  attachedSkillIds: string[];
  attachedCompetencyIds: string[];
}

export async function bridgeExamResponseToEvidence(params: BridgeExamResponseParams): Promise<BridgeExamResponseOutcome> {
  const bridge = await resolveActivityMetadataForObjective(params.learningObjectiveId);

  const metadata: Record<string, unknown> = {};
  const attachedSkillIds = bridge?.skillIds ?? [];
  const attachedCompetencyIds = bridge?.competencyIds ?? [];
  // Only attach a key when the array is genuinely non-empty -- never
  // `competencyIds: []` sitting on the evidence row implying "checked,
  // found none," and never a fabricated id (INV-F7-18).
  if (attachedSkillIds.length > 0) metadata.skillIds = attachedSkillIds;
  if (attachedCompetencyIds.length > 0) metadata.competencyIds = attachedCompetencyIds;

  const masteryResult = await updateMastery({
    studentId: params.studentId,
    conceptId: params.conceptId,
    subjectId: params.subjectId,
    evidence: {
      sourceType: 'EXAM_SIMULATION',
      result: params.result,
      difficulty: params.difficulty,
      scorePercent: params.scorePercent,
    },
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
  });

  return { masteryResult, attachedSkillIds, attachedCompetencyIds };
}
