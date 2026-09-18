/**
 * F5 -- multidimensional analytical Learner State. Derived from Evidence,
 * never a pedagogical progression authority -- see
 * docs/implementation/f5/F5_CANONICAL_V2_BOUNDARY.md. Canonical V2
 * (src/lib/pedagogical-engine, pedagogical-decision) never reads any of
 * these types or tables.
 */

export type StateDimension = 'SKILL' | 'COMPETENCY' | 'TRANSFER_ANALYTICS';

export type DimensionState = 'NO_EVIDENCE' | 'INSUFFICIENT_EVIDENCE' | 'EMERGING' | 'CONSISTENT_INDEPENDENT';

export interface AggregationPolicyVersion {
  id: string;
  dimension: StateDimension;
  version: number;
  rules: Record<string, unknown>;
  status: 'ACTIVE' | 'RETIRED';
}

/** A qualifying evidence row, reduced to only what the pure classifier needs. */
export interface QualifyingEvidenceItem {
  id: string;
  result: string;
  independent: boolean;
  occurredAt: string;
}

export interface DimensionStateResult {
  state: DimensionState;
  evidenceCount: number;
  independentEvidenceCount: number;
  lastEvidenceAt: string | null;
}

export interface SkillState extends DimensionStateResult {
  studentId: string;
  skillId: string;
  policyVersionId: string;
}

export interface CompetencyState extends DimensionStateResult {
  studentId: string;
  competencyId: string;
  policyVersionId: string;
}

export interface TransferAnalytics {
  studentId: string;
  conceptId: string;
  canonicalConceptId: string | null;
  contextFamiliarCount: number;
  contextAlteredCount: number;
  contextRealWorldCount: number;
  contextUnfamiliarCount: number;
  contextCrossDomainCount: number;
  distinctContextCount: number;
  policyVersionId: string;
}

export interface ExplainedEvidence {
  id: string;
  occurredAt: string;
  included: boolean;
  reason: string;
}

export interface StateExplanation {
  state: DimensionState | null;
  policyVersion: number | null;
  evidence: ExplainedEvidence[];
  insufficientBecause: string | null;
}
