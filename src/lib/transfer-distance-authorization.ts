/**
 * Phase 7 -- Step 7E2: deterministic server-side authorization of a
 * requested transfer distance.
 *
 * The browser is NOT authoritative for NEAR / MID / FAR. A client (or a
 * hand-edited URL) may ASK for any distance; the server decides the
 * MAXIMUM distance this learner has earned for this concept from
 * canonical `concept_transfer_state.transfer_depth`, and clamps the
 * request down to it. There is deliberately no public "give me a FAR
 * task" path: FAR is reachable only once demonstrated transfer depth
 * has reached GENERALIZED / ROBUST.
 *
 * PURE. No DB, no AI, no clock. The caller supplies the persisted
 * transfer depth (null when there is no concept_transfer_state row).
 */
import type { TransferDepth, TransferDistance } from '@/lib/transfer-policy';

const DISTANCE_RANK: Record<TransferDistance, number> = { NEAR: 0, MID: 1, FAR: 2 };
const RANK_TO_DISTANCE: readonly TransferDistance[] = ['NEAR', 'MID', 'FAR'];

/**
 * The furthest distance a learner may be served for a concept, given
 * their canonical demonstrated transfer depth:
 *   no row / NONE     -> NEAR   (must earn near transfer first)
 *   NEAR_DEMONSTRATED  -> MID    (near shown; may step up ONE level)
 *   GENERALIZED / ROBUST -> FAR
 */
export function maxAuthorizedTransferDistance(transferDepth: TransferDepth | null): TransferDistance {
  switch (transferDepth) {
    case 'GENERALIZED':
    case 'ROBUST':
      return 'FAR';
    case 'NEAR_DEMONSTRATED':
      return 'MID';
    case 'NONE':
    case null:
    default:
      return 'NEAR';
  }
}

export interface TransferDistanceAuthorization {
  /** The distance the server will actually generate / persist / grade. */
  authorized: TransferDistance;
  /** The distance the client asked for (normalized). */
  requested: TransferDistance;
  /** True when `authorized` is a step down from `requested`. */
  clamped: boolean;
  maxAuthorized: TransferDistance;
}

function normalizeDistance(v: unknown): TransferDistance {
  return v === 'MID' || v === 'FAR' ? v : 'NEAR';
}

/**
 * Clamp a requested distance to what the learner has earned. Never
 * throws, never rejects -- a request beyond the earned ceiling is
 * quietly served at the ceiling (the caller emits one [ops] WARN when
 * `clamped` is true).
 */
export function authorizeRequestedTransferDistance(
  requested: unknown,
  transferDepth: TransferDepth | null,
): TransferDistanceAuthorization {
  const req = normalizeDistance(requested);
  const maxAuthorized = maxAuthorizedTransferDistance(transferDepth);
  const authorizedRank = Math.min(DISTANCE_RANK[req], DISTANCE_RANK[maxAuthorized]);
  const authorized = RANK_TO_DISTANCE[authorizedRank];
  return { authorized, requested: req, clamped: authorizedRank < DISTANCE_RANK[req], maxAuthorized };
}
