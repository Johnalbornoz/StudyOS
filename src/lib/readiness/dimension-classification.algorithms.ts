/**
 * F9 -- pure, deterministic readiness dimension classifiers + overall
 * combiner (task §5-7, §46). No I/O, no AI. Given the identical inputs
 * (already-fetched diagnoses/coverage/counts + policy), always
 * byte-identical output.
 */
import type { StoredGapDiagnosis } from '@/lib/diagnostics/diagnosis.service';
import type { GapType } from '@/lib/diagnostics/types';
import type { BlueprintCoverageSummary, DimensionReadinessResult, DimensionStatus, OverallReadinessStatus, ReadinessPolicyRules } from './types';

function gapNamedByDiagnosis(diagnosis: StoredGapDiagnosis, gapType: GapType): boolean {
  return diagnosis.primaryGapType === gapType || (diagnosis.primaryGapType === 'MIXED' && diagnosis.secondarySignals.includes(gapType));
}

/** Shared by KNOWLEDGE_READINESS/SKILL_READINESS/EXAM_TECHNIQUE_READINESS/SPEED_FLUENCY_READINESS. `diagnoses` must already be filtered by the caller to only those applicable to this dimension's scope (e.g. skill-scoped diagnoses for SKILL_READINESS). */
export function classifyGapBasedDimension(
  dimension: 'KNOWLEDGE_READINESS' | 'SKILL_READINESS' | 'EXAM_TECHNIQUE_READINESS' | 'SPEED_FLUENCY_READINESS',
  gapType: GapType,
  diagnoses: StoredGapDiagnosis[],
  policy: ReadinessPolicyRules
): DimensionReadinessResult {
  const diagnosedCount = diagnoses.length;

  if (diagnosedCount < policy.gapBasedDimensions.minimumDiagnosedTargetsForConfidentStatus) {
    return {
      dimension,
      status: 'INSUFFICIENT_EVIDENCE',
      detail: { diagnosedTargetCount: diagnosedCount, gapNamedCount: 0, totalConsideredTargetCount: diagnoses.length },
      reasonCodes: ['BELOW_MINIMUM_DIAGNOSED_TARGETS'],
      evidenceIncludedIds: diagnoses.map((d) => d.id),
      evidenceExcludedIds: [],
      blueprintTargetsConsidered: [],
      unsupportedPlatformAreas: [],
      whatWouldImproveConfidence: 'More diagnosed blueprint targets for this dimension would increase confidence.',
    };
  }

  const named = diagnoses.filter((d) => gapNamedByDiagnosis(d, gapType));
  const hasInsufficient = diagnoses.some((d) => d.primaryGapType === 'INSUFFICIENT_EVIDENCE');

  let status: DimensionStatus;
  let reasonCodes: string[];
  if (named.length > 0) {
    status = 'WEAK';
    reasonCodes = ['GAP_DIAGNOSED'];
  } else if (hasInsufficient) {
    status = 'DEVELOPING';
    reasonCodes = ['SOME_TARGETS_INSUFFICIENT_EVIDENCE'];
  } else {
    status = 'STRONG';
    reasonCodes = ['NO_GAP_DIAGNOSED'];
  }

  return {
    dimension,
    status,
    detail: { diagnosedTargetCount: diagnosedCount, gapNamedCount: named.length, totalConsideredTargetCount: diagnoses.length },
    reasonCodes,
    evidenceIncludedIds: diagnoses.map((d) => d.id),
    evidenceExcludedIds: [],
    blueprintTargetsConsidered: [],
    unsupportedPlatformAreas: [],
    whatWouldImproveConfidence:
      status === 'STRONG' ? 'Additional independent evidence across more contexts would further raise confidence.' : 'Targeted practice on the diagnosed gap would improve this dimension.',
  };
}

export function classifyBlueprintCoverageDimension(coverage: BlueprintCoverageSummary, policy: ReadinessPolicyRules): DimensionReadinessResult {
  const fraction = coverage.evidencedFraction;
  let status: DimensionStatus;
  if (fraction === null) status = 'INSUFFICIENT_EVIDENCE';
  else if (fraction >= policy.coverage.minimumEvidencedFractionForSimulationReady) status = 'STRONG';
  else if (fraction >= policy.coverage.minimumEvidencedFractionForEarlyPreparation) status = 'DEVELOPING';
  else status = 'WEAK';

  return {
    dimension: 'BLUEPRINT_EVIDENCE_COVERAGE',
    status,
    detail: {
      totalTargets: coverage.totalTargets,
      supportedAndEvidenced: coverage.supportedAndEvidenced,
      supportedButUnevidenced: coverage.supportedButUnevidenced,
      evidencedFraction: fraction,
    },
    reasonCodes: fraction === null ? ['NO_ELIGIBLE_TARGETS'] : ['EVIDENCED_FRACTION_COMPUTED'],
    evidenceIncludedIds: coverage.targets.filter((t) => t.diagnosisId).map((t) => t.diagnosisId as string),
    evidenceExcludedIds: [],
    blueprintTargetsConsidered: coverage.targets.map((t) => t.targetId),
    unsupportedPlatformAreas: coverage.targets.filter((t) => t.status === 'UNSUPPORTED_BY_PLATFORM').map((t) => t.targetId),
    whatWouldImproveConfidence: 'Attempting practice against SUPPORTED_BUT_UNEVIDENCED targets would raise this dimension.',
  };
}

export function classifySimulationPerformanceDimension(
  stats: { completedAttemptCount: number; averageScorePercent: number | null; byComponent: Record<string, number> },
  policy: ReadinessPolicyRules
): DimensionReadinessResult {
  if (stats.completedAttemptCount < policy.simulationPerformance.minimumCompletedAttemptsForConfidentStatus) {
    return {
      dimension: 'SIMULATION_PERFORMANCE',
      status: 'INSUFFICIENT_EVIDENCE',
      detail: { completedAttemptCount: stats.completedAttemptCount },
      reasonCodes: ['BELOW_MINIMUM_COMPLETED_ATTEMPTS'],
      evidenceIncludedIds: [],
      evidenceExcludedIds: [],
      blueprintTargetsConsidered: [],
      unsupportedPlatformAreas: [],
      whatWouldImproveConfidence: 'Completing at least one Topic/Domain/Mini Mock attempt would establish a baseline.',
    };
  }
  const pct = stats.averageScorePercent ?? 0;
  const status: DimensionStatus = pct >= 70 ? 'STRONG' : pct >= 40 ? 'DEVELOPING' : 'WEAK';
  return {
    dimension: 'SIMULATION_PERFORMANCE',
    status,
    detail: { completedAttemptCount: stats.completedAttemptCount, averageScorePercent: stats.averageScorePercent, byComponent: stats.byComponent },
    reasonCodes: ['AVERAGE_SCORE_COMPUTED'],
    evidenceIncludedIds: [],
    evidenceExcludedIds: [],
    blueprintTargetsConsidered: [],
    unsupportedPlatformAreas: [],
    whatWouldImproveConfidence: 'Additional completed simulation attempts would stabilize this average.',
  };
}

export function classifyEvidenceSufficiencyDimension(
  stats: { totalQualifyingEvidenceCount: number; independentEvidenceCount: number; distinctQuestionTypeCount: number; distinctContextCount: number; mostRecentEvidenceAgeDays: number | null },
  policy: ReadinessPolicyRules
): DimensionReadinessResult {
  const sufficient =
    stats.totalQualifyingEvidenceCount >= policy.evidenceSufficiency.minimumQualifyingEvidenceForSufficient &&
    stats.distinctQuestionTypeCount >= policy.evidenceSufficiency.minimumDistinctQuestionTypesForSufficient &&
    stats.mostRecentEvidenceAgeDays !== null &&
    stats.mostRecentEvidenceAgeDays <= policy.evidenceSufficiency.maxRecencyDaysForFresh;

  return {
    dimension: 'EVIDENCE_SUFFICIENCY',
    status: sufficient ? 'STRONG' : 'INSUFFICIENT_EVIDENCE',
    detail: stats,
    reasonCodes: sufficient ? ['EVIDENCE_SUFFICIENT'] : ['EVIDENCE_BELOW_SUFFICIENCY_THRESHOLD'],
    evidenceIncludedIds: [],
    evidenceExcludedIds: [],
    blueprintTargetsConsidered: [],
    unsupportedPlatformAreas: [],
    whatWouldImproveConfidence: 'More recent, diverse, independent evidence across more question types would improve confidence in every other dimension.',
  };
}

export function combineOverallReadinessStatus(dimensions: DimensionReadinessResult[], fullMockReady: boolean): OverallReadinessStatus {
  const coverage = dimensions.find((d) => d.dimension === 'BLUEPRINT_EVIDENCE_COVERAGE');
  const gapDimensions = dimensions.filter((d) =>
    ['KNOWLEDGE_READINESS', 'SKILL_READINESS', 'EXAM_TECHNIQUE_READINESS', 'SPEED_FLUENCY_READINESS'].includes(d.dimension)
  );

  if (!coverage || coverage.status === 'INSUFFICIENT_EVIDENCE' || coverage.status === 'WEAK') return 'INSUFFICIENT_EVIDENCE';
  if (gapDimensions.some((d) => d.status === 'WEAK')) return 'DEVELOPING';
  if (coverage.status === 'DEVELOPING') return 'EARLY_PREPARATION';
  if (fullMockReady) return 'FULL_MOCK_ELIGIBLE';
  return 'SIMULATION_READY';
}
