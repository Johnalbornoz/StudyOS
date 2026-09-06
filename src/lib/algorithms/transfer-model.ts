/**
 * Phase 7 -- Step 7C2: the pure, deterministic, replayable Transfer
 * state model.
 *
 * PURE. No DB, no AI, no React, no environment, no random, no hidden
 * clock (every timestamp comes from the canonical evidence rows passed
 * in). Given the full canonical TRANSFER evidence history for one
 * (student, concept), `replayTransferState` produces exactly the
 * fields persisted in `concept_transfer_state`.
 *
 * SEMANTIC BOUNDARY (7D has not happened):
 *   - Legacy / pre-7D TRANSFER evidence carries a `transferDistance`
 *     (NEAR/MID/FAR) that was NOT server-certified against
 *     deterministic novelty. It keeps its full weight in the
 *     already-certified demonstrated Transfer SCORE (computeTransferScore,
 *     unchanged), but for Phase 7 DEPTH it is treated conservatively:
 *     a successful independent legacy attempt can establish at most
 *     NEAR_DEMONSTRATED and is counted as a NEAR success. It can NEVER
 *     establish GENERALIZED or ROBUST.
 *   - `phase7Certified` evidence (future, 7D) carries
 *     noveltyValidationPassed + noveltyDimensions + a valid task
 *     identity; it drives the real transferDepthTransition rules
 *     (NEAR/MID/FAR counts, distinct novelty dimensions, task
 *     families). No production route emits such rows yet -- this path
 *     is exercised only by synthetic test evidence.
 */
import {
  TRANSFER_POLICY_VERSION,
  NOVELTY_DIMENSIONS,
  transferDepthTransition,
  isRobustSpacingSatisfied,
  type TransferDistance,
  type TransferDepth,
  type NoveltyDimension,
  type TransferDepthPriorState,
} from '@/lib/transfer-policy';
import { computeTransferScore, type TransferEvidenceRow } from '@/lib/algorithms/transfer-score';

export type TransferProjectionOutcome = 'SUCCESS' | 'PARTIAL' | 'FAILURE';

/** The pure per-attempt view the replay folds over. */
export interface CanonicalTransferProjectionEvidence {
  evidenceId: string;
  timestamp: string;
  result: TransferProjectionOutcome;

  /** As stored (legacy default handled by the normalizer). Kept at full weight for the SCORE only. */
  transferDistance: TransferDistance;
  assisted: boolean;

  transferTaskId: string | null;
  promptFingerprint: string | null;

  /** 7D-only. Always false / empty for current production rows. */
  noveltyValidationPassed: boolean;
  noveltyDimensions: NoveltyDimension[];
  taskFamilyId: string | null;

  targetConceptIds: string[];

  /**
   * Whether the required spacing before THIS success is satisfied.
   * There is no Phase 7 spacing policy yet, so this is always false in
   * production (only synthetic test evidence sets it) -- which is why
   * production can never reach ROBUST.
   */
  spacingSatisfied: boolean;

  /**
   * True only when enough trusted structured metadata is explicitly
   * present (see toProjectionEvidence). NEVER inferred from
   * transferDistance / promptFingerprint / transferTaskId alone.
   */
  phase7Certified: boolean;
}

export interface TransferReplayResult {
  demonstratedTransferScore: number | null;
  nearTransferSuccessCount: number;
  midTransferSuccessCount: number;
  farTransferSuccessCount: number;
  distinctNoveltyDimensionsOk: NoveltyDimension[];
  lastSuccessfulTransferAt: string | null;
  lastSuccessfulTransferDistance: TransferDistance | null;
  transferDepth: TransferDepth;
  policyVersion: number;
}

const VALID_DISTANCES: readonly TransferDistance[] = ['NEAR', 'MID', 'FAR'];
const CANONICAL_FINGERPRINT = /^[0-9a-f]{64}$/;
const NOVELTY_ORDER = new Map(NOVELTY_DIMENSIONS.map((d, i) => [d, i] as const));

export function isValidTransferDistance(v: unknown): v is TransferDistance {
  return typeof v === 'string' && (VALID_DISTANCES as readonly string[]).includes(v);
}

function toNoveltyDimensions(v: unknown): NoveltyDimension[] {
  if (!Array.isArray(v)) return [];
  return v.filter((d): d is NoveltyDimension => typeof d === 'string' && NOVELTY_ORDER.has(d as NoveltyDimension));
}

function outcomeFromResult(result: unknown): TransferProjectionOutcome {
  if (result === 'correct') return 'SUCCESS';
  if (result === 'partial') return 'PARTIAL';
  return 'FAILURE';
}

export interface RawTransferEvidenceRow {
  id: string;
  timestamp: string | Date;
  result: string;
  metadata: Record<string, unknown> | null;
}

export class InvalidCurrentTransferEvidenceError extends Error {
  constructor(reason: string, evidenceId: string) {
    super(`INVALID_CURRENT_TRANSFER_EVIDENCE: ${reason} (evidence=${evidenceId})`);
    this.name = 'InvalidCurrentTransferEvidenceError';
  }
}

/**
 * Normalize ONE raw `learning_evidence` row into the pure projection
 * shape.
 *
 * Historical rows: conservative -- missing / malformed metadata never
 * throws and never earns unearned depth (a bad `transferDistance`
 * degrades to NEAR, which is exactly what computeTransferScore already
 * does via `|| 'NEAR'`).
 *
 * The CURRENT row (`isCurrent = true`, i.e. the row `updateMastery`
 * just inserted) is held to the post-7C1 canonical-route contract:
 * valid task id, canonical fingerprint, sourceConceptId === conceptId,
 * assisted === false, valid distance. A violation is a live-writer bug
 * -> throw -> the whole updateMastery transaction rolls back.
 */
export function toProjectionEvidence(
  row: RawTransferEvidenceRow,
  ctx: { conceptId: string; isCurrent: boolean },
): CanonicalTransferProjectionEvidence {
  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  const evidenceId = row.id;
  // Canonicalize to ISO regardless of whether pg handed us a Date
  // (timestamptz, OID 1184) or a string -- keeps replay + semantic
  // comparison deterministic.
  const timestamp = new Date(row.timestamp).toISOString();
  const result = outcomeFromResult(row.result);

  const rawDistance = meta.transferDistance;
  const rawFingerprint = typeof meta.promptFingerprint === 'string' ? meta.promptFingerprint : null;
  const rawTaskId = typeof meta.transferTaskId === 'string' && meta.transferTaskId.length > 0 ? meta.transferTaskId : null;
  const rawSourceConceptId = typeof meta.sourceConceptId === 'string' ? meta.sourceConceptId : null;
  const assisted = meta.assisted === true; // missing -> false (conservative + matches historical route: assisted was always stamped false)

  if (ctx.isCurrent) {
    if (!rawTaskId) throw new InvalidCurrentTransferEvidenceError('missing transferTaskId', evidenceId);
    if (!rawFingerprint || !CANONICAL_FINGERPRINT.test(rawFingerprint))
      throw new InvalidCurrentTransferEvidenceError('missing/non-canonical promptFingerprint', evidenceId);
    if (rawSourceConceptId !== ctx.conceptId)
      throw new InvalidCurrentTransferEvidenceError('sourceConceptId does not match conceptId', evidenceId);
    if (assisted) throw new InvalidCurrentTransferEvidenceError('assisted must be false for a canonical Transfer proof', evidenceId);
    if (!isValidTransferDistance(rawDistance)) throw new InvalidCurrentTransferEvidenceError('invalid transferDistance', evidenceId);
  }

  // For the SCORE, distance keeps its stored value (|| 'NEAR'), exactly
  // as computeTransferScore has always defaulted it.
  const scoreDistance: TransferDistance = isValidTransferDistance(rawDistance) ? rawDistance : 'NEAR';

  const noveltyValidationPassed = meta.noveltyValidationPassed === true;
  const noveltyDimensions = toNoveltyDimensions(meta.noveltyDimensions);
  const taskFamilyId = typeof meta.taskFamilyId === 'string' && meta.taskFamilyId.length > 0 ? meta.taskFamilyId : null;
  const targetConceptIds = Array.isArray(meta.targetConceptIds)
    ? meta.targetConceptIds.filter((c): c is string => typeof c === 'string')
    : [];

  // 7D certification gate -- ALL must be explicitly present. Current
  // production 7B/7C1 rows never satisfy this (no noveltyValidationPassed).
  const phase7Certified =
    noveltyValidationPassed &&
    noveltyDimensions.length > 0 &&
    rawTaskId !== null &&
    !assisted &&
    isValidTransferDistance(rawDistance);

  return {
    evidenceId,
    timestamp,
    result,
    transferDistance: scoreDistance,
    assisted,
    transferTaskId: rawTaskId,
    promptFingerprint: rawFingerprint,
    noveltyValidationPassed,
    noveltyDimensions,
    taskFamilyId,
    targetConceptIds,
    spacingSatisfied: meta.spacingSatisfied === true,
    phase7Certified,
  };
}

function sortCanonical(a: CanonicalTransferProjectionEvidence, b: CanonicalTransferProjectionEvidence): number {
  if (a.timestamp !== b.timestamp) return a.timestamp < b.timestamp ? -1 : 1;
  return a.evidenceId < b.evidenceId ? -1 : a.evidenceId > b.evidenceId ? 1 : 0;
}

function sortNovelty(dims: readonly NoveltyDimension[]): NoveltyDimension[] {
  return Array.from(new Set(dims)).sort((x, y) => (NOVELTY_ORDER.get(x) ?? 0) - (NOVELTY_ORDER.get(y) ?? 0));
}

/**
 * Fold the full canonical TRANSFER history into persisted Phase 7
 * state. Deterministic: sorted by (timestamp ASC, evidenceId ASC); no
 * clock, no randomness, no DB-ordering dependency.
 */
export function replayTransferState(evidence: readonly CanonicalTransferProjectionEvidence[]): TransferReplayResult {
  const ordered = [...evidence].sort(sortCanonical);

  // --- demonstrated score: EXACT existing semantics, all rows ---
  const scoreRows: TransferEvidenceRow[] = ordered.map((e) => ({
    transferDistance: e.transferDistance,
    result: e.result === 'SUCCESS' ? 'correct' : e.result === 'PARTIAL' ? 'partial' : 'incorrect',
    assisted: e.assisted,
    timestamp: e.timestamp,
  }));
  const demonstratedTransferScore = computeTransferScore(scoreRows);

  // --- Phase 7 depth / counts ---
  let near = 0;
  let mid = 0;
  let far = 0;
  let lastSuccessfulTransferAt: string | null = null;
  let lastSuccessfulTransferDistance: TransferDistance | null = null;

  // Running aggregate for transferDepthTransition. Only qualifying
  // successes (independent) contribute; legacy successes contribute as
  // NEAR.
  const prior: {
    depth: TransferDepth;
    successfulDistances: TransferDistance[];
    successfulNoveltyDimensions: NoveltyDimension[];
    successfulTaskFamilyIds: string[];
  } = { depth: 'NONE', successfulDistances: [], successfulNoveltyDimensions: [], successfulTaskFamilyIds: [] };

  // 7G1: the timestamp of the qualified SUCCESS that first established
  // GENERALIZED -- the anchor the ROBUST spacing rule measures from.
  let generalizedEstablishedAt: string | null = null;

  for (const e of ordered) {
    if (e.result !== 'SUCCESS' || e.assisted) continue; // PARTIAL/FAILURE/assisted: score only, never depth
    // an independent SUCCESS
    lastSuccessfulTransferAt = e.timestamp;

    if (!e.phase7Certified) {
      // conservative legacy: a NEAR success, at most NEAR_DEMONSTRATED
      near += 1;
      lastSuccessfulTransferDistance = 'NEAR';
      const priorState: TransferDepthPriorState = { ...prior };
      const res = transferDepthTransition({
        prior: priorState,
        attempt: {
          qualifies: true,
          outcome: 'SUCCESS',
          transferDistance: 'NEAR',
          noveltyDimensions: [],
          taskFamilyId: null,
          spacingSatisfied: false,
        },
      });
      // transferDepthTransition already caps a NEAR success at
      // NEAR_DEMONSTRATED and is monotonic.
      prior.depth = res.depth;
      if (!prior.successfulDistances.includes('NEAR')) prior.successfulDistances.push('NEAR');
      continue;
    }

    // phase7-certified SUCCESS -- real transition rules
    if (e.transferDistance === 'NEAR') near += 1;
    else if (e.transferDistance === 'MID') mid += 1;
    else far += 1;
    lastSuccessfulTransferDistance = e.transferDistance;

    // 7G1: deterministic ROBUST spacing -- satisfied when >= 3 days
    // (TRANSFER_ROBUST_MIN_SPACING_DAYS) have elapsed since GENERALIZED
    // was established. An explicit `meta.spacingSatisfied` (synthetic /
    // test evidence only -- never set by any production writer) still
    // acts as an override so that path is unchanged.
    const spacingSatisfied =
      e.spacingSatisfied ||
      (prior.depth === 'GENERALIZED' && isRobustSpacingSatisfied(generalizedEstablishedAt, e.timestamp));

    const res = transferDepthTransition({
      prior: { ...prior },
      attempt: {
        qualifies: true,
        outcome: 'SUCCESS',
        transferDistance: e.transferDistance,
        noveltyDimensions: e.noveltyDimensions,
        taskFamilyId: e.taskFamilyId,
        spacingSatisfied,
      },
    });
    prior.depth = res.depth;
    if (generalizedEstablishedAt === null && (res.depth === 'GENERALIZED' || res.depth === 'ROBUST')) {
      generalizedEstablishedAt = e.timestamp;
    }
    if (!prior.successfulDistances.includes(e.transferDistance)) prior.successfulDistances.push(e.transferDistance);
    prior.successfulNoveltyDimensions = sortNovelty([...prior.successfulNoveltyDimensions, ...e.noveltyDimensions]);
    if (e.taskFamilyId && !prior.successfulTaskFamilyIds.includes(e.taskFamilyId)) prior.successfulTaskFamilyIds.push(e.taskFamilyId);
  }

  return {
    demonstratedTransferScore,
    nearTransferSuccessCount: near,
    midTransferSuccessCount: mid,
    farTransferSuccessCount: far,
    distinctNoveltyDimensionsOk: sortNovelty(prior.successfulNoveltyDimensions),
    lastSuccessfulTransferAt,
    lastSuccessfulTransferDistance,
    transferDepth: prior.depth,
    policyVersion: TRANSFER_POLICY_VERSION,
  };
}

/** True when two replay results are semantically equal (ignores nothing -- all persisted fields). */
export function transferReplayResultEquals(a: TransferReplayResult, b: TransferReplayResult): boolean {
  return (
    a.demonstratedTransferScore === b.demonstratedTransferScore &&
    a.nearTransferSuccessCount === b.nearTransferSuccessCount &&
    a.midTransferSuccessCount === b.midTransferSuccessCount &&
    a.farTransferSuccessCount === b.farTransferSuccessCount &&
    a.lastSuccessfulTransferAt === b.lastSuccessfulTransferAt &&
    a.lastSuccessfulTransferDistance === b.lastSuccessfulTransferDistance &&
    a.transferDepth === b.transferDepth &&
    a.policyVersion === b.policyVersion &&
    a.distinctNoveltyDimensionsOk.length === b.distinctNoveltyDimensionsOk.length &&
    a.distinctNoveltyDimensionsOk.every((d, i) => d === b.distinctNoveltyDimensionsOk[i])
  );
}
