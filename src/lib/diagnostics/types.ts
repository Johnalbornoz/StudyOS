/**
 * F8 -- Diagnostic gap classification vocabulary. See
 * docs/implementation/f8/F8_GAP_CLASSIFICATION_MODEL.md.
 *
 * This is a NEW, distinctly-named taxonomy -- it does not replace, and
 * is never conflated with, the legacy `PrimaryBarrier`
 * (adaptive-teaching-policy.ts), the root-cause `DiagnosisState`
 * (cognitive-diagnosis.service.ts), or the intervention-selection
 * `RemediationPattern` (remediation.service.ts). All three answer a
 * different question at a different scope; see
 * F8_CURRENT_TEACHING_DIAGNOSTIC_ASSESSMENT.md §4.
 */

export type GapType = 'KNOWLEDGE_GAP' | 'SKILL_GAP' | 'EXAM_TECHNIQUE_GAP' | 'SPEED_FLUENCY_GAP';
export type DiagnosisResultType = GapType | 'MIXED' | 'INSUFFICIENT_EVIDENCE';

/** Raw evidence shape fetched from learning_evidence -- see evidence-gate.service.ts. */
export interface EvidenceRow {
  id: string;
  result: 'correct' | 'incorrect' | 'partial';
  aiAssistanceType: string;
  hintsUsed: number;
  difficulty: number;
  scorePercent: number | null;
  timestamp: string;
  activityType: string | null;
  metadata: Record<string, unknown> | null;
}

/** Scopes one diagnosis run -- only the fields relevant to the dimensions actually evaluated need be present. */
export interface DiagnosisScope {
  skillId?: string;
  learningObjectiveId?: string;
  examVersionId?: string;
  assessmentComponentId?: string;
  commandTermId?: string;
}

export interface DimensionResult {
  gapType: GapType;
  supported: boolean;
  confidence: number;
  supportingEvidenceIds: string[];
  contradictingEvidenceIds: string[];
  reasonCodes: string[];
}

export interface GapDiagnosis {
  primaryGapType: DiagnosisResultType;
  secondarySignals: GapType[];
  confidence: number;
  supportingEvidenceIds: string[];
  contradictingEvidenceIds: string[];
  reasonCodes: string[];
  alternatives: DimensionResult[];
}

export interface DiagnosticPolicyRules {
  knowledge: {
    minimumIndependentEvidenceCount: number;
    minimumDistinctForms: number;
    failureRateThreshold: number;
  };
  skill: {
    minimumQualifyingEvidenceCount: number;
    failureRateThreshold: number;
  };
  technique: {
    minimumSimpleFormEvidenceCount: number;
    minimumComplexFormEvidenceCount: number;
    knowledgeSoundThreshold: number;
    failureRateThreshold: number;
  };
  speed: {
    minimumValidTimingSampleCount: number;
    minimumCorrectnessBaseline: number;
    latencyRatioThreshold: number;
    expectedResponseTimeMsByDifficultyBand: Record<string, number | null>;
  };
  mixedGapPriority: GapType[];
  confidence: {
    baseConfidenceAtMinimumEvidence: number;
    confidenceGainPerExtraEvidenceItem: number;
  };
}

export interface DiagnosticPolicyVersion {
  id: string;
  version: number;
  rules: DiagnosticPolicyRules;
  status: 'ACTIVE' | 'RETIRED';
  effectiveFrom: string;
  createdAt: string;
}

/** Stable, enumerable reason codes -- see F8_GAP_CLASSIFICATION_MODEL.md. */
export const REASON_CODES = {
  BELOW_MINIMUM_EVIDENCE_COUNT: 'BELOW_MINIMUM_EVIDENCE_COUNT',
  SINGLE_FORMAT_ONLY: 'SINGLE_FORMAT_ONLY',
  MULTI_FORMAT_FAILURE_PATTERN: 'MULTI_FORMAT_FAILURE_PATTERN',
  SIMPLE_COMMAND_TERM_FAILURE: 'SIMPLE_COMMAND_TERM_FAILURE',
  ACTIVE_MISCONCEPTION_PRESENT: 'ACTIVE_MISCONCEPTION_PRESENT',
  NOT_APPLICABLE: 'NOT_APPLICABLE',
  NO_QUALIFYING_SKILL_EVIDENCE: 'NO_QUALIFYING_SKILL_EVIDENCE',
  QUALIFYING_SKILL_EVIDENCE_FOUND: 'QUALIFYING_SKILL_EVIDENCE_FOUND',
  CONCEPT_SOUND_TECHNIQUE_FAILURE: 'CONCEPT_SOUND_TECHNIQUE_FAILURE',
  TIMING_SAMPLE_INSUFFICIENT: 'TIMING_SAMPLE_INSUFFICIENT',
  TIMING_EXPECTATION_UNAVAILABLE: 'TIMING_EXPECTATION_UNAVAILABLE',
  KNOWLEDGE_GAP_BLOCKS_SPEED_DIAGNOSIS: 'KNOWLEDGE_GAP_BLOCKS_SPEED_DIAGNOSIS',
  CONSISTENT_LATENCY_ABOVE_EXPECTATION: 'CONSISTENT_LATENCY_ABOVE_EXPECTATION',
} as const;
