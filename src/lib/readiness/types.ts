/**
 * F9 -- Readiness Engine vocabulary. See docs/implementation/f9/
 * F9_READINESS_EXPLAINABILITY.md. Distinctly named throughout from the
 * pre-existing, LIVE legacy `exam-readiness.service.ts` (a single
 * opaque percentage + fabricated predicted score) -- never confused
 * with, never extending it.
 */

export type ReadinessDimension =
  | 'KNOWLEDGE_READINESS'
  | 'SKILL_READINESS'
  | 'EXAM_TECHNIQUE_READINESS'
  | 'SPEED_FLUENCY_READINESS'
  | 'BLUEPRINT_EVIDENCE_COVERAGE'
  | 'SIMULATION_PERFORMANCE'
  | 'EVIDENCE_SUFFICIENCY';

export type DimensionStatus = 'STRONG' | 'DEVELOPING' | 'WEAK' | 'INSUFFICIENT_EVIDENCE' | 'NOT_APPLICABLE';

export type OverallReadinessStatus = 'INSUFFICIENT_EVIDENCE' | 'EARLY_PREPARATION' | 'DEVELOPING' | 'SIMULATION_READY' | 'FULL_MOCK_ELIGIBLE';

export type ScoreProjectionAvailability = 'AVAILABLE' | 'NOT_AVAILABLE_NO_CALIBRATION' | 'NOT_AVAILABLE_INSUFFICIENT_DATA' | 'NOT_APPLICABLE';

export interface DimensionReadinessResult {
  dimension: ReadinessDimension;
  status: DimensionStatus;
  detail: Record<string, unknown>;
  reasonCodes: string[];
  evidenceIncludedIds: string[];
  evidenceExcludedIds: string[];
  blueprintTargetsConsidered: string[];
  unsupportedPlatformAreas: string[];
  whatWouldImproveConfidence: string;
}

export type BlueprintTargetCoverageStatus = 'SUPPORTED_AND_EVIDENCED' | 'SUPPORTED_BUT_UNEVIDENCED' | 'UNSUPPORTED_BY_PLATFORM' | 'UNMAPPED' | 'NOT_REQUIRED';

export interface BlueprintTargetCoverage {
  targetId: string;
  status: BlueprintTargetCoverageStatus;
  reasonCodes: string[];
  studentConceptId: string | null;
  diagnosisId: string | null;
}

export interface BlueprintCoverageSummary {
  totalTargets: number;
  supportedAndEvidenced: number;
  supportedButUnevidenced: number;
  unsupportedByPlatform: number;
  unmapped: number;
  notRequired: number;
  evidencedFraction: number | null; // null when denominator is zero
  targets: BlueprintTargetCoverage[];
}

export interface ReadinessPolicyRules {
  gapBasedDimensions: { minimumDiagnosedTargetsForConfidentStatus: number };
  coverage: { minimumEvidencedFractionForEarlyPreparation: number; minimumEvidencedFractionForSimulationReady: number };
  evidenceSufficiency: { minimumQualifyingEvidenceForSufficient: number; minimumDistinctQuestionTypesForSufficient: number; maxRecencyDaysForFresh: number };
  simulationPerformance: { minimumCompletedAttemptsForConfidentStatus: number };
}

export interface ReadinessPolicyVersion {
  id: string;
  version: number;
  rules: ReadinessPolicyRules;
  status: 'ACTIVE' | 'RETIRED';
  effectiveFrom: string;
  createdAt: string;
}

export interface EvidenceCounts {
  total: number;
  independent: number;
  assisted: number;
}

export interface ReadinessSnapshot {
  id: string;
  studentId: string;
  examProfileId: string;
  examVersionId: string;
  readinessPolicyVersionId: string;
  overallStatus: OverallReadinessStatus;
  dimensions: DimensionReadinessResult[];
  blueprintCoverage: BlueprintCoverageSummary;
  evidenceCounts: EvidenceCounts;
  diagnosticGapReferences: string[];
  simulationHistoryUsed: string[];
  reasonCodes: string[];
  limitations: string[];
  scoreProjectionAvailability: ScoreProjectionAvailability;
  calculatedAt: string;
}
