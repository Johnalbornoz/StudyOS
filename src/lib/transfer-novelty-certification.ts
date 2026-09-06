/**
 * Phase 7 -- Step 7D2: deterministic server-side novelty certification.
 *
 * The server -- never the AI, never the browser -- is the sole
 * authority on whether a generated transfer task genuinely earns its
 * claimed NEAR / MID / FAR distance. This module is the PURE decision
 * core: given the AI-proposed distance + novelty dimensions, the 7B2
 * structural-fingerprint guard outcome, and the server-resolved set of
 * real target concept ids, it returns a single boolean verdict plus a
 * machine reason. No DB, no AI, no clock, no randomness.
 *
 * The route persists `novelty_validation_passed = true` on the
 * transfer_task_instances row ONLY when `certified` is true here. 7D3
 * is what makes a certified row count toward demonstrated transfer
 * depth; an uncertified task is still served to the learner (they get
 * the practice) but never advances NEAR_DEMONSTRATED / GENERALIZED.
 */
import {
  validateTransferDistanceNovelty,
  NOVELTY_DIMENSIONS,
  type NoveltyDimension,
  type TransferDistance,
} from '@/lib/transfer-policy';

export type TransferNoveltyCertificationReason =
  | 'CERTIFIED'
  | 'NO_NOVELTY_DIMENSIONS'
  | 'INVALID_NOVELTY_DIMENSION'
  | 'DISTANCE_NOVELTY_MISMATCH'
  | 'STRUCTURAL_FINGERPRINT_NOT_UNIQUE'
  | 'UNRESOLVED_TARGET_CONCEPT';

export interface TransferNoveltyCertificationInput {
  transferDistance: TransferDistance;
  /** Exactly the dimensions the generator proposed (already filtered to canonical values upstream, re-checked here). */
  noveltyDimensions: readonly string[];
  /** Result of the 7B2 structural-duplicate guard: true == this prompt's fingerprint is not a recent duplicate. */
  fingerprintGuardEligible: boolean;
  /** The target concept ids the generator asked for (7D1: always empty; 7G2 may populate). */
  requestedTargetConceptIds: readonly string[];
  /**
   * The subset of `requestedTargetConceptIds` the server actually
   * resolved to real concepts, via ONE batched query (never N+1).
   * Order-independent; compared as a set.
   */
  resolvedTargetConceptIds: readonly string[];
}

export interface TransferNoveltyCertificationResult {
  certified: boolean;
  reason: TransferNoveltyCertificationReason;
  /** The canonical dimensions actually used for the distance check (echo, for the caller to persist). */
  noveltyDimensions: NoveltyDimension[];
}

const CANONICAL = new Set<string>(NOVELTY_DIMENSIONS);

/**
 * Deterministic. Order of checks is fixed so the `reason` is stable for
 * a given input. Every failure path returns `certified: false`.
 */
export function certifyStructuredTransferNovelty(
  input: TransferNoveltyCertificationInput,
): TransferNoveltyCertificationResult {
  const dims = input.noveltyDimensions.map((d) => d.trim().toUpperCase());

  if (dims.length < 1) {
    return { certified: false, reason: 'NO_NOVELTY_DIMENSIONS', noveltyDimensions: [] };
  }
  if (!dims.every((d) => CANONICAL.has(d))) {
    return {
      certified: false,
      reason: 'INVALID_NOVELTY_DIMENSION',
      noveltyDimensions: dims.filter((d) => CANONICAL.has(d)) as NoveltyDimension[],
    };
  }

  const canonicalDims = dims as NoveltyDimension[];

  const distanceCheck = validateTransferDistanceNovelty(input.transferDistance, canonicalDims);
  if (!distanceCheck.valid) {
    return { certified: false, reason: 'DISTANCE_NOVELTY_MISMATCH', noveltyDimensions: canonicalDims };
  }

  if (!input.fingerprintGuardEligible) {
    return { certified: false, reason: 'STRUCTURAL_FINGERPRINT_NOT_UNIQUE', noveltyDimensions: canonicalDims };
  }

  // Every requested target concept must have resolved to a real concept
  // server-side. Set comparison -- order and duplicates don't matter.
  const resolved = new Set(input.resolvedTargetConceptIds);
  for (const id of input.requestedTargetConceptIds) {
    if (!resolved.has(id)) {
      return { certified: false, reason: 'UNRESOLVED_TARGET_CONCEPT', noveltyDimensions: canonicalDims };
    }
  }

  return { certified: true, reason: 'CERTIFIED', noveltyDimensions: canonicalDims };
}
