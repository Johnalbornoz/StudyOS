/**
 * F8 -- the ONLY path F8 uses to write Evidence (task §25). Wraps F5's
 * REAL, UNMODIFIED updateMastery() -- never a new evidence-writing
 * path. Maps interventionType to an EXISTING EvidenceSourceType (no
 * new source type). Never attaches competencyIds (F8 introduces no new
 * competency-attachment path -- INV-F8-12/AC-F8-23). Metadata keys are
 * attached only when genuinely populated, never empty placeholders.
 */
import { updateMastery, type MasteryUpdateResult } from '@/services/mastery.service';
import type { EvidenceResult, EvidenceSourceType } from '@/lib/algorithms/mastery';
import { normalizeResponseTiming, toResponseTimingEntries, withBehaviorMetadata } from '@/lib/algorithms/response-timing';
import { buildOperationKey } from '@/lib/algorithms/evidence-idempotency';
import { db } from '@/lib/db';
import type { FrameworkIdentity, InterventionType, AssistanceLevel } from './types';

const SOURCE_TYPE_BY_INTERVENTION: Record<Exclude<InterventionType, 'PROVE'>, EvidenceSourceType> = {
  EXPLAIN: 'EXPLANATION',
  WORKED_EXAMPLE: 'REMEDIATION',
  GUIDED_PRACTICE: 'GUIDED_EXERCISE',
  CONTEXTUAL_HELP: 'GUIDED_EXERCISE',
  INDEPENDENT_PRACTICE: 'PRACTICE_QUESTION',
};

export interface WriteInterventionEvidenceParams {
  studentId: string;
  conceptId: string;
  subjectId: string;
  interventionSessionId: string;
  interventionAttemptId: string; // minted by session.service.ts BEFORE this call -- the stable operationId
  interventionType: Exclude<InterventionType, 'PROVE'>;
  result: EvidenceResult;
  scorePercent: number;
  difficulty: number;
  skillId?: string;
  framework: FrameworkIdentity | null;
  commandTermId?: string | null;
  questionType?: string | null;
  reasoningRequirement?: string | null;
  assistanceLevel: AssistanceLevel;
  hintsUsed: number;
  timing?: { questionPresentedAt: string; answerSubmittedAt: string };
  diagnosisId: string;
  attemptNumber: number;
}

export interface WriteInterventionEvidenceOutcome {
  masteryResult: MasteryUpdateResult;
  evidenceId: string;
}

export async function writeInterventionEvidence(params: WriteInterventionEvidenceParams): Promise<WriteInterventionEvidenceOutcome> {
  const sourceType = SOURCE_TYPE_BY_INTERVENTION[params.interventionType];

  const metadata: Record<string, unknown> = {
    context: {
      interventionSessionId: params.interventionSessionId,
      diagnosisId: params.diagnosisId,
      attemptNumber: params.attemptNumber,
    },
  };
  if (params.skillId) metadata.skillIds = [params.skillId];
  if (params.framework) {
    metadata.framework = {
      academicOrganizationId: params.framework.academicOrganizationId,
      academicProgrammeId: params.framework.academicProgrammeId,
      examFamily: params.framework.examFamily ?? null,
    };
    if (params.framework.examVersionId) metadata.examVersionId = params.framework.examVersionId;
  }
  if (params.commandTermId) metadata.commandTermId = params.commandTermId;
  if (params.questionType) metadata.questionType = params.questionType;
  if (params.reasoningRequirement) metadata.reasoningRequirement = params.reasoningRequirement;

  let metadataWithBehavior: Record<string, unknown> = metadata;
  if (params.timing) {
    const timing = normalizeResponseTiming(params.timing);
    const entries = toResponseTimingEntries([{ timing }]);
    metadataWithBehavior = withBehaviorMetadata(metadata, entries);
  }

  const identity = {
    operationType: 'INTERVENTION_ATTEMPT' as const,
    operationId: params.interventionAttemptId,
    conceptId: params.conceptId,
  };

  const masteryResult = await updateMastery({
    studentId: params.studentId,
    conceptId: params.conceptId,
    subjectId: params.subjectId,
    evidence: {
      sourceType,
      result: params.result,
      difficulty: params.difficulty,
      scorePercent: params.scorePercent,
    },
    telemetry: {
      activityType: params.interventionType,
      learningMode: 'AI_NATIVE',
      hintsUsed: params.hintsUsed,
      aiAssistanceType: params.assistanceLevel,
    },
    metadata: metadataWithBehavior,
    identity,
  });

  // The operation_key is deterministic from `identity` -- look up the
  // row updateMastery just inserted (or, on an idempotent replay, the
  // one it inserted the first time) rather than adding a return field
  // to updateMastery itself.
  const operationKey = buildOperationKey(identity);
  const evidenceRow = await db.query(`SELECT id FROM learning_evidence WHERE operation_key = $1`, [operationKey]);
  if (evidenceRow.rows.length === 0) {
    throw new Error(`writeInterventionEvidence: no learning_evidence row found for operation_key ${operationKey} after updateMastery()`);
  }

  return { masteryResult, evidenceId: evidenceRow.rows[0].id };
}
