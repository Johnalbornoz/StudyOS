/**
 * Phase 7 -- Transfer & Deep Learning: the canonical deterministic
 * Transfer Policy (Step 7A1, POLICY FOUNDATION ONLY).
 *
 * This module defines the *vocabulary* and *rules* of transfer:
 *   - what a transfer task claims to be (TransferTaskDescriptor),
 *   - the novelty dimensions a task may vary,
 *   - how NEAR / MID / FAR are represented and what minimum novelty
 *     each distance requires,
 *   - what evidence qualifies as a transfer ATTEMPT
 *     (qualifiesAsTransferEvidence),
 *   - how demonstrated transfer DEPTH progresses
 *     (transferDepthTransition).
 *
 * PURE. Deterministic. Same input -> same output, always. No DB, no AI,
 * no React, no process env, no network, no Date.now()/random inside the
 * rule functions -- any time-dependent fact (e.g. whether spacing
 * between two successes is satisfied) is passed in explicitly as a
 * boolean by the future projector layer (7C), never computed here.
 *
 * ARCHITECTURAL BOUNDARY. Phase 7 owns transfer QUALIFICATION and
 * transfer DEPTH. It does NOT own:
 *   - WHAT the learner should do next (Phase 4),
 *   - HOW StudyUS should teach (Phase 5),
 *   - Mastery / Knowledge State (Phase 2),
 *   - memory / retention (Phase 6).
 * Nothing here reads or writes any of those. `computeTransferScore`
 * (the numeric transfer-dimension value consumed by Knowledge State)
 * remains exactly where it is -- src/services/transfer.service.ts,
 * unchanged, byte-for-byte identical semantics (NEAR 0.7 / MID 1.0 /
 * FAR 1.3, assisted x0.6, last-10 window). 7A1 does not touch it.
 *
 * 7A1 wires NOTHING into production evidence, generation, submission,
 * Phase 4, or the frontend -- that is 7B / 7C / 7D / 7E.
 */

// The canonical TransferDistance already exists in transfer.service.ts
// and is consumed by the certified transfer routes / computeTransferScore.
// Re-exported here (type-only, fully erased at build -- no runtime edge
// to that impure module) so this policy has one shared definition
// rather than a duplicate union.
export type { TransferDistance } from '@/services/transfer.service';
import type { TransferDistance } from '@/services/transfer.service';

// Phase 7 Step 7G1: bumped 1 -> 2. v2 activates the deterministic
// ROBUST spacing rule (TRANSFER_ROBUST_MIN_SPACING_DAYS) -- v1 could
// never reach ROBUST because no spacing policy existed. Every
// concept_transfer_state row is reprojected to v2 by a controlled
// production reprojection; the replayed depth / score for existing
// evidence is UNCHANGED by the bump (v1 already never reached ROBUST),
// so the reprojection earns no new depth and emits no depth-advance
// audit events.
export const TRANSFER_POLICY_VERSION = 2 as const;

/**
 * Phase 7 Step 7G1: the minimum number of days that must elapse
 * between the qualified SUCCESS that ESTABLISHED demonstrated
 * GENERALIZED transfer and a later qualified MID/FAR SUCCESS (in a new
 * task family) for that later success to advance depth to ROBUST.
 * Deterministic -- the replay computes the gap from the evidence rows'
 * own timestamps, never from a wall clock.
 */
export const TRANSFER_ROBUST_MIN_SPACING_DAYS = 3;

/**
 * Pure. True when `currentAt` is at least TRANSFER_ROBUST_MIN_SPACING_DAYS
 * after `generalizedAt`. Both are ISO timestamps from canonical
 * evidence rows. A missing / unparseable input is treated as
 * not-yet-spaced (fail closed -- never fabricate ROBUST).
 */
export function isRobustSpacingSatisfied(generalizedAt: string | null, currentAt: string): boolean {
  if (!generalizedAt) return false;
  const from = Date.parse(generalizedAt);
  const to = Date.parse(currentAt);
  if (Number.isNaN(from) || Number.isNaN(to)) return false;
  return (to - from) / 86_400_000 >= TRANSFER_ROBUST_MIN_SPACING_DAYS;
}

/** Exhaustive list mirror of TransferDistance -- for enum-drift tests and iteration. */
export const TRANSFER_DISTANCE_VALUES = ['NEAR', 'MID', 'FAR'] as const;

/**
 * How a transfer task differs from the context the concept was learned
 * in. Engine-internal only -- never shown to a learner.
 */
export type NoveltyDimension =
  | 'CONTEXT'
  | 'SURFACE'
  | 'REPRESENTATION'
  | 'STRATEGY'
  | 'CONCEPT_COMBINATION'
  | 'GOAL_FRAMING'
  | 'DATA_PRESENTATION'
  | 'CONSTRAINT';

export const NOVELTY_DIMENSIONS = [
  'CONTEXT',
  'SURFACE',
  'REPRESENTATION',
  'STRATEGY',
  'CONCEPT_COMBINATION',
  'GOAL_FRAMING',
  'DATA_PRESENTATION',
  'CONSTRAINT',
] as const;

/**
 * Orthogonal to distance: whether the task changes the *structure* of
 * the problem (STRUCTURAL) or its *representation* (equation <-> graph
 * <-> table <-> prose, REPRESENTATIONAL). A REPRESENTATIONAL task is
 * still NEAR / MID / FAR -- modality is NOT a fourth distance.
 */
export type TransferModality = 'STRUCTURAL' | 'REPRESENTATIONAL';
export const TRANSFER_MODALITIES = ['STRUCTURAL', 'REPRESENTATIONAL'] as const;

/**
 * Demonstrated transfer depth for one (student, concept). Monotonic in
 * Phase 7 core -- a later failure never demotes it (a failure may
 * later raise a separate "fragile" signal for Phase 4 in 7E, but the
 * historical capability stands).
 */
export type TransferDepth = 'NONE' | 'NEAR_DEMONSTRATED' | 'GENERALIZED' | 'ROBUST';
export const TRANSFER_DEPTH_VALUES = ['NONE', 'NEAR_DEMONSTRATED', 'GENERALIZED', 'ROBUST'] as const;

const TRANSFER_DEPTH_ORDER: Record<TransferDepth, number> = {
  NONE: 0,
  NEAR_DEMONSTRATED: 1,
  GENERALIZED: 2,
  ROBUST: 3,
};

/** Rank of a depth for monotonic comparisons (higher == deeper). */
export function transferDepthRank(depth: TransferDepth): number {
  return TRANSFER_DEPTH_ORDER[depth];
}

/** True iff `next` is strictly deeper than `prev` -- the only shape a real TRANSFER_DEPTH_ADVANCED transition takes. */
export function isDeeperTransferDepth(next: TransferDepth, prev: TransferDepth): boolean {
  return TRANSFER_DEPTH_ORDER[next] > TRANSFER_DEPTH_ORDER[prev];
}

// --- distance <-> novelty compatibility ------------------------------

/** CONTEXT/SURFACE alone are "the wrapper changed" -- not enough for MID/FAR. */
const SURFACE_ONLY_DIMENSIONS: readonly NoveltyDimension[] = ['CONTEXT', 'SURFACE'];
/** At least one of these must be present for a MID claim (stronger than a surface swap). */
const MID_QUALIFYING_DIMENSIONS: readonly NoveltyDimension[] = [
  'REPRESENTATION',
  'STRATEGY',
  'DATA_PRESENTATION',
  'CONCEPT_COMBINATION',
  'GOAL_FRAMING',
  'CONSTRAINT',
];
/** At least one of these must be present for a FAR claim (genuine generalization). */
const FAR_QUALIFYING_DIMENSIONS: readonly NoveltyDimension[] = ['CONCEPT_COMBINATION', 'GOAL_FRAMING', 'CONSTRAINT'];

export type DistanceNoveltyInvalidReason = 'NO_NOVELTY' | 'MID_SURFACE_ONLY' | 'FAR_NOT_GENERALIZING';

export interface DistanceNoveltyResult {
  valid: boolean;
  reason?: DistanceNoveltyInvalidReason;
}

/**
 * A distance claim is a claim about the MINIMUM novelty demonstrated.
 * Richer novelty never invalidates a lower claim (a FAR task may also
 * carry CONTEXT); a claim is invalid only when it falls SHORT of its
 * distance's minimum.
 *
 *   NEAR  -- any >= 1 novelty dimension (CONTEXT / SURFACE suffice)
 *   MID   -- >= 1 dimension beyond CONTEXT/SURFACE
 *   FAR   -- >= 1 of CONCEPT_COMBINATION / GOAL_FRAMING / CONSTRAINT
 *            (cross-subject/domain support for FAR is deliberately NOT
 *             built in 7A1)
 */
export function validateTransferDistanceNovelty(
  distance: TransferDistance,
  noveltyDimensions: readonly NoveltyDimension[],
): DistanceNoveltyResult {
  if (noveltyDimensions.length < 1) return { valid: false, reason: 'NO_NOVELTY' };

  if (distance === 'NEAR') return { valid: true };

  if (distance === 'MID') {
    const hasBeyondSurface = noveltyDimensions.some((d) => MID_QUALIFYING_DIMENSIONS.includes(d));
    return hasBeyondSurface ? { valid: true } : { valid: false, reason: 'MID_SURFACE_ONLY' };
  }

  // FAR
  const hasFarDimension = noveltyDimensions.some((d) => FAR_QUALIFYING_DIMENSIONS.includes(d));
  return hasFarDimension ? { valid: true } : { valid: false, reason: 'FAR_NOT_GENERALIZING' };
}

/** True when every supplied dimension is a surface-level one. */
export function isSurfaceOnlyNovelty(noveltyDimensions: readonly NoveltyDimension[]): boolean {
  return noveltyDimensions.length > 0 && noveltyDimensions.every((d) => SURFACE_ONLY_DIMENSIONS.includes(d));
}

// --- task descriptor & attempt input -------------------------------

/**
 * A pure, storage-agnostic description of a generated transfer task.
 * No DB columns, no AI object, no raw prompt text -- only what policy
 * and the future novelty validator need.
 */
export interface TransferTaskDescriptor {
  transferTaskId: string;
  sourceConceptId: string;
  targetConceptIds: string[];
  transferDistance: TransferDistance;
  transferModality: TransferModality;
  noveltyDimensions: NoveltyDimension[];
  contextDomain?: string | null;
  promptFingerprint: string;
  generatorVersion?: string | null;
  generatorPromptVersion?: string | null;
}

export type TransferAttemptOutcome = 'SUCCESS' | 'PARTIAL' | 'FAILURE';

/**
 * The pure evidence view of ONE transfer attempt that policy evaluates.
 * Deliberately decoupled from any DB row shape -- the caller
 * (7C projector / 7E signal layer) maps its rows into this.
 */
export interface TransferAttemptInput {
  activityType: string;
  evidenceMode: string;
  aiAssisted: boolean;
  operationKeyValid: boolean;
  taskIdentityValid: boolean;
  duplicateFingerprint: boolean;
  sameQuestionFallback: boolean;
  noveltyValidationPassed: boolean;
  transferDistance: TransferDistance;
  transferModality: TransferModality;
  noveltyDimensions: NoveltyDimension[];
  targetConceptIds: string[];
  targetConceptsIndependent: boolean;
  outcome: TransferAttemptOutcome;
  attemptedAt: Date | string;
  taskFamilyId?: string | null;
}

// --- qualification ------------------------------------------------

export type TransferQualificationReason =
  | 'NOT_TRANSFER_ACTIVITY'
  | 'NOT_INDEPENDENT'
  | 'AI_ASSISTED'
  | 'INVALID_OPERATION_IDENTITY'
  | 'INVALID_TASK_IDENTITY'
  | 'DUPLICATE_TASK'
  | 'SAME_QUESTION_FALLBACK'
  | 'NOVELTY_NOT_VALIDATED'
  | 'NO_NOVELTY'
  | 'DISTANCE_NOVELTY_MISMATCH'
  | 'FAR_TARGET_NOT_INDEPENDENT';

export interface TransferQualificationResult {
  qualifies: boolean;
  reasons: TransferQualificationReason[];
}

/**
 * Whether a transfer attempt qualifies as canonical transfer EVIDENCE
 * (an attempt -- SUCCESS, PARTIAL, and FAILURE outcomes can all be
 * qualifying attempts; whether it advances DEPTH is a separate
 * question, see transferDepthTransition).
 *
 * Ordinary non-qualification returns `{qualifies:false, reasons:[...]}`
 * -- it never throws.
 */
export function qualifiesAsTransferEvidence(input: TransferAttemptInput): TransferQualificationResult {
  const reasons: TransferQualificationReason[] = [];

  if (input.activityType !== 'TRANSFER') reasons.push('NOT_TRANSFER_ACTIVITY');
  if (input.evidenceMode !== 'INDEPENDENT') reasons.push('NOT_INDEPENDENT');
  if (input.aiAssisted) reasons.push('AI_ASSISTED');
  if (!input.operationKeyValid) reasons.push('INVALID_OPERATION_IDENTITY');
  if (!input.taskIdentityValid) reasons.push('INVALID_TASK_IDENTITY');
  if (input.duplicateFingerprint) reasons.push('DUPLICATE_TASK');
  if (input.sameQuestionFallback) reasons.push('SAME_QUESTION_FALLBACK');
  if (!input.noveltyValidationPassed) reasons.push('NOVELTY_NOT_VALIDATED');

  if (!input.noveltyDimensions || input.noveltyDimensions.length < 1) {
    reasons.push('NO_NOVELTY');
  } else {
    const dn = validateTransferDistanceNovelty(input.transferDistance, input.noveltyDimensions);
    if (!dn.valid) reasons.push('DISTANCE_NOVELTY_MISMATCH');
  }

  if (input.transferDistance === 'FAR' && input.targetConceptIds.length > 0 && !input.targetConceptsIndependent) {
    reasons.push('FAR_TARGET_NOT_INDEPENDENT');
  }

  return { qualifies: reasons.length === 0, reasons };
}

// --- success helpers ---------------------------------------------

export function isSuccessfulTransferAttempt(input: Pick<TransferAttemptInput, 'outcome'>): boolean {
  return input.outcome === 'SUCCESS';
}

export function isPartialTransferAttempt(input: Pick<TransferAttemptInput, 'outcome'>): boolean {
  return input.outcome === 'PARTIAL';
}

// --- transfer depth transition ---------------------------------

/**
 * The aggregate of a student's PRIOR qualified SUCCESSFUL transfer
 * attempts for one concept, as computed (deterministically, from
 * learning_evidence) by the future 7C projector.
 */
export interface TransferDepthPriorState {
  depth: TransferDepth;
  /** Distinct distances that have at least one prior qualified SUCCESS. */
  successfulDistances: readonly TransferDistance[];
  /** Distinct novelty dimensions across all prior qualified SUCCESSES. */
  successfulNoveltyDimensions: readonly NoveltyDimension[];
  /** Distinct task-family ids that have at least one prior qualified SUCCESS. */
  successfulTaskFamilyIds: readonly string[];
}

/** The single new attempt being applied to a prior state. */
export interface TransferDepthAttempt {
  /** Result of qualifiesAsTransferEvidence(...) for this attempt. */
  qualifies: boolean;
  outcome: TransferAttemptOutcome;
  transferDistance: TransferDistance;
  noveltyDimensions: readonly NoveltyDimension[];
  taskFamilyId?: string | null;
  /**
   * Whether the required spacing between the prior GENERALIZED-
   * establishing success and THIS success is satisfied. Supplied
   * explicitly by the projector (7C) -- policy never computes elapsed
   * time. No calendar duration is hardcoded in 7A1.
   */
  spacingSatisfied: boolean;
}

export interface TransferDepthTransitionInput {
  prior: TransferDepthPriorState;
  attempt: TransferDepthAttempt;
}

export type TransferDepthTransitionReason =
  | 'NOT_A_QUALIFYING_SUCCESS'
  | 'NO_CHANGE'
  | 'ADVANCED_TO_NEAR_DEMONSTRATED'
  | 'ADVANCED_TO_GENERALIZED_VIA_FAR'
  | 'ADVANCED_TO_GENERALIZED_VIA_BREADTH'
  | 'ADVANCED_TO_ROBUST';

export interface TransferDepthTransitionResult {
  depth: TransferDepth;
  advanced: boolean;
  reason: TransferDepthTransitionReason;
}

function uniqueUnion<T>(a: readonly T[], b: readonly T[]): T[] {
  return Array.from(new Set([...a, ...b]));
}

function maxDepth(a: TransferDepth, b: TransferDepth): TransferDepth {
  return TRANSFER_DEPTH_ORDER[a] >= TRANSFER_DEPTH_ORDER[b] ? a : b;
}

/**
 * Deterministic, monotonic transfer-depth state machine.
 *
 *   NONE -> NEAR_DEMONSTRATED      one qualified SUCCESS at NEAR or MID (or FAR)
 *   * -> GENERALIZED               (A) one qualified FAR SUCCESS, or
 *                                  (B) qualified SUCCESSES spanning >= 2 distinct
 *                                      novelty dimensions in >= 2 distinct task families
 *   GENERALIZED -> ROBUST          GENERALIZED already established, then a later
 *                                  qualified MID/FAR SUCCESS, spacingSatisfied,
 *                                  in a task family with no prior success
 *
 * A PARTIAL or FAILURE (or a non-qualifying attempt) never advances
 * depth, and never demotes it.
 */
export function transferDepthTransition(input: TransferDepthTransitionInput): TransferDepthTransitionResult {
  const { prior, attempt } = input;

  if (!attempt.qualifies || attempt.outcome !== 'SUCCESS') {
    return { depth: prior.depth, advanced: false, reason: 'NOT_A_QUALIFYING_SUCCESS' };
  }

  const distances = uniqueUnion(prior.successfulDistances, [attempt.transferDistance]);
  const dimensions = uniqueUnion(prior.successfulNoveltyDimensions, attempt.noveltyDimensions);
  const familyIsNew =
    typeof attempt.taskFamilyId === 'string' &&
    attempt.taskFamilyId.length > 0 &&
    !prior.successfulTaskFamilyIds.includes(attempt.taskFamilyId);
  const families = uniqueUnion(
    prior.successfulTaskFamilyIds,
    typeof attempt.taskFamilyId === 'string' && attempt.taskFamilyId.length > 0 ? [attempt.taskFamilyId] : [],
  );

  // ROBUST: only from an already-established GENERALIZED, via a spaced
  // MID/FAR success in a new task family.
  if (
    prior.depth === 'GENERALIZED' &&
    (attempt.transferDistance === 'MID' || attempt.transferDistance === 'FAR') &&
    attempt.spacingSatisfied &&
    familyIsNew
  ) {
    return { depth: 'ROBUST', advanced: true, reason: 'ADVANCED_TO_ROBUST' };
  }

  // GENERALIZED via a FAR success.
  if (distances.includes('FAR')) {
    const depth = maxDepth(prior.depth, 'GENERALIZED');
    return {
      depth,
      advanced: TRANSFER_DEPTH_ORDER[depth] > TRANSFER_DEPTH_ORDER[prior.depth],
      reason:
        TRANSFER_DEPTH_ORDER[depth] > TRANSFER_DEPTH_ORDER[prior.depth]
          ? 'ADVANCED_TO_GENERALIZED_VIA_FAR'
          : 'NO_CHANGE',
    };
  }

  // GENERALIZED via breadth: >= 2 distinct novelty dimensions across
  // >= 2 distinct task families.
  if (dimensions.length >= 2 && families.length >= 2) {
    const depth = maxDepth(prior.depth, 'GENERALIZED');
    return {
      depth,
      advanced: TRANSFER_DEPTH_ORDER[depth] > TRANSFER_DEPTH_ORDER[prior.depth],
      reason:
        TRANSFER_DEPTH_ORDER[depth] > TRANSFER_DEPTH_ORDER[prior.depth]
          ? 'ADVANCED_TO_GENERALIZED_VIA_BREADTH'
          : 'NO_CHANGE',
    };
  }

  // Any qualified success is at least NEAR_DEMONSTRATED.
  const depth = maxDepth(prior.depth, 'NEAR_DEMONSTRATED');
  return {
    depth,
    advanced: TRANSFER_DEPTH_ORDER[depth] > TRANSFER_DEPTH_ORDER[prior.depth],
    reason:
      TRANSFER_DEPTH_ORDER[depth] > TRANSFER_DEPTH_ORDER[prior.depth] ? 'ADVANCED_TO_NEAR_DEMONSTRATED' : 'NO_CHANGE',
  };
}
