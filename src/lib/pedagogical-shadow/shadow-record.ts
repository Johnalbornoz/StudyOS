/**
 * CANON-R3 Part 22 -- assembles the ONE safe, serializable shadow
 * record from already-computed pieces. No learner answer text, no
 * question text, no learner name, no free-form responses -- every
 * field here is a stage/action/count/id/reasonCode, never content
 * (verified by source-audit tests against this file's own output
 * shape, and directly by construction: none of its inputs carry such
 * content either -- see `StudyUSEvidenceRow`'s own field list).
 */
import type { ComparisonOutcome, EvidenceAdapterResult, NewCanonicalSnapshot, OldCanonicalSnapshot, ShadowComparisonRecord } from './types';

export function buildShadowComparisonRecord(params: {
  conceptId: string;
  adapterResult: EvidenceAdapterResult;
  oldSnapshot: OldCanonicalSnapshot;
  newSnapshot: NewCanonicalSnapshot;
  comparison: ComparisonOutcome;
}): ShadowComparisonRecord {
  const { conceptId, adapterResult, oldSnapshot, newSnapshot, comparison } = params;
  return {
    conceptId,
    evidenceSnapshotFingerprint: adapterResult.evidenceSnapshotFingerprint,
    old: {
      stage: oldSnapshot.stage,
      action: oldSnapshot.nextAction,
      progress: oldSnapshot.progressPercent,
    },
    new: {
      stage: newSnapshot.stage,
      actionState: newSnapshot.actionState,
      nextCanonicalAction: newSnapshot.nextCanonicalAction,
      progress: newSnapshot.progressPercent,
      policyVersion: newSnapshot.policyVersion,
    },
    comparison: {
      result: comparison.result,
      reasonCodes: comparison.reasonCodes,
    },
    adapter: {
      evidenceCount: adapterResult.items.length,
      unresolvedMappings: [...new Set(adapterResult.unresolved.map((u) => u.reason))],
      warnings: adapterResult.warnings,
      confidence: adapterResult.confidence,
    },
  };
}
