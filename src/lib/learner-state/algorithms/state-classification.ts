/**
 * F5 -- pure, zero-IO state classification. Given a fixed evidence set and
 * a fixed policy, always returns the same result -- the basis of
 * deterministic replay (task 25, AC-F5-13). No database access, no
 * randomness, no wall-clock dependency beyond the timestamps already
 * present on the input items.
 */
import type { DimensionStateResult, QualifyingEvidenceItem } from '../types';

export interface StateClassificationRules {
  minimumEvidenceCount: number;
}

export function computeDimensionState(
  qualifyingEvidence: QualifyingEvidenceItem[],
  rules: StateClassificationRules
): DimensionStateResult {
  const evidenceCount = qualifyingEvidence.length;

  if (evidenceCount === 0) {
    return { state: 'NO_EVIDENCE', evidenceCount: 0, independentEvidenceCount: 0, lastEvidenceAt: null };
  }

  const sorted = [...qualifyingEvidence].sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
  const independentEvidenceCount = sorted.filter((e) => e.independent).length;
  const lastEvidenceAt = sorted[0].occurredAt;

  if (evidenceCount < rules.minimumEvidenceCount) {
    return { state: 'INSUFFICIENT_EVIDENCE', evidenceCount, independentEvidenceCount, lastEvidenceAt };
  }

  const mostRecent = sorted.slice(0, rules.minimumEvidenceCount);
  const allRecentIndependentAndCorrect = mostRecent.every((e) => e.independent && e.result === 'correct');

  return {
    state: allRecentIndependentAndCorrect ? 'CONSISTENT_INDEPENDENT' : 'EMERGING',
    evidenceCount,
    independentEvidenceCount,
    lastEvidenceAt,
  };
}
