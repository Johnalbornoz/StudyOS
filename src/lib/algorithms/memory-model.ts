/**
 * STUDYUS PHASE 6 -- RETENTION & MEMORY ENGINE
 * Step 6D: canonical evidence normalization + replay-based state
 * projection + live-derived signals.
 *
 * PURE MODULE: zero DB imports, zero AI imports, zero network, zero
 * `Date.now()`, zero environment reads, zero hidden clock. Every
 * timestamp/current-time value is an explicit input. Zero production
 * callers as of Step 6D -- wiring into `mastery.service.ts::updateMastery`
 * is Step 6E's job, not this one.
 *
 * Builds entirely on the frozen `src/lib/memory-policy.ts` vocabulary
 * and MemoryPolicy v1 (Steps 6C/6C-R) -- this file does not redefine
 * qualification, scoring, stability, scheduling, or retrievability
 * math; it only normalizes raw input into that vocabulary and replays
 * a sequence of evidence through it deterministically.
 */

import {
  type MemoryPolicyV1,
  MEMORY_POLICY_V1,
  type MemoryStability,
  type MemoryStatus,
  type PredictionConfidence,
  type MemoryTimestamps,
  type QualifiedRetentionAttempt,
  type RetentionQualificationInput,
  isAnchorEligible,
  isQualifiedRetentionAttempt,
  classifyRetentionAttemptOutcome,
  normalizedPerformanceForQualifiedAttempt,
  nextConsecutiveSuccesses,
  nextMemoryTimestamps,
  stabilityFromConsecutiveSuccesses,
  reviewIntervalDaysForSuccessCount,
  addDaysIso,
  computeRetentionDue,
  computeRetrievability,
  computeMemoryStatus,
  computeDemonstratedRetention,
} from '@/lib/memory-policy';
import { evidenceModeForActivity, type ActivityType, type EvidenceMode } from '@/lib/activity-taxonomy';
import type { EvidenceResult } from '@/lib/algorithms/mastery';

// ============================================================
// SECTION 6/7 -- CANONICAL EVIDENCE INPUT + RAW NORMALIZATION BOUNDARY
// ============================================================

/**
 * The metadata blob is the ONLY place a real ActivityType can be read
 * from (Step 6C-R's load-bearing finding). `evidenceMode` is present
 * on this shape only because some writers stamp it -- it is READ HERE
 * for completeness but deliberately NEVER TRUSTED (see
 * normalizeMemoryEvidence below): the canonical taxonomy always wins.
 */
export interface RawEvidenceMetadata {
  readonly activityType?: unknown;
  readonly evidenceMode?: unknown;
}

/**
 * A plain, DB-free description of one `learning_evidence`-shaped row.
 * `activityType` here is the RAW TOP-LEVEL COLUMN, included ONLY so
 * `normalizeMemoryEvidence` can be proven, by test, to ignore it --
 * that column is confirmed unreliable (stamped `'quiz'` for every
 * quiz mode, lowercase `'transfer'` for transfer submissions, etc.)
 * and ONLY `metadata.activityType` is ever read for qualification.
 */
export interface RawLearningEvidenceRow {
  readonly id: string;
  readonly studentId: string;
  readonly conceptId: string;
  /** The unreliable top-level `learning_evidence.activity_type` column. Never read by normalizeMemoryEvidence -- present only so tests can prove it. */
  readonly activityType: string | null;
  readonly result: EvidenceResult;
  readonly scorePercent: number | null;
  readonly aiAssistanceType: string;
  readonly hintsUsed: number;
  readonly operationKey: string | null;
  readonly timestamp: string; // ISO
  /** Observability only -- not used in any qualification/scoring decision. */
  readonly difficulty?: number;
  /** Observability only. Not derivable from a single learning_evidence row today (a concept-bucket can span multiple questions of different cognitive levels) -- never fabricated; only ever passed through if a caller already has a well-defined single value. */
  readonly cognitiveLevel?: string;
  readonly metadata: RawEvidenceMetadata | null;
}

/**
 * The normalized, DB-free shape the rest of Phase 6 operates on.
 * `activityType`/`evidenceMode` here are ALREADY validated canonical
 * values -- nothing downstream needs to re-validate them.
 */
export interface CanonicalMemoryEvidence {
  readonly evidenceId: string;
  readonly studentId: string;
  readonly conceptId: string;
  readonly activityType: ActivityType;
  readonly evidenceMode: EvidenceMode;
  readonly result: EvidenceResult;
  readonly scorePercent: number;
  readonly aiAssistanceType: string;
  readonly hintsUsed: number;
  readonly operationKey: string | null;
  readonly timestamp: string;
  readonly difficulty?: number;
  readonly cognitiveLevel?: string;
}

export type NormalizationFailureReason = 'MISSING_METADATA_ACTIVITY_TYPE' | 'UNKNOWN_ACTIVITY_TYPE' | 'MISSING_SCORE_PERCENT' | 'INVALID_SCORE_PERCENT';

export type NormalizedMemoryEvidenceResult =
  | { readonly valid: true; readonly evidence: CanonicalMemoryEvidence }
  | { readonly valid: false; readonly reason: NormalizationFailureReason };

/**
 * The PURE normalization boundary between raw `learning_evidence`-
 * shaped data and Phase 6's canonical vocabulary.
 *
 * ActivityType resolution (load-bearing, Step 6C-R):
 *   1. Read `raw.metadata.activityType` ONLY. `raw.activityType` (the
 *      top-level column) is NEVER read, under any condition -- not as
 *      a fallback, not for a "legacy" row, not for anything.
 *   2. The value must be a string AND a member of the canonical
 *      ActivityType taxonomy (checked via `evidenceModeForActivity`,
 *      the taxonomy's own total-mapping function -- an unrecognized
 *      key returns `undefined` at runtime despite the function's
 *      typed signature, which this normalizer treats as authoritative
 *      proof of invalidity). Anything else -> FAIL CLOSED.
 *   3. `evidenceMode` is ALWAYS derived from the taxonomy via that
 *      same lookup -- `raw.metadata.evidenceMode` is read nowhere in
 *      this function. If a caller's metadata claims an inconsistent
 *      EvidenceMode, that claim is silently and completely ignored;
 *      the taxonomy's own answer is the only one that can ever exist
 *      in the returned `CanonicalMemoryEvidence` -- there is no
 *      "inconsistency" to detect or reject, because the untrusted
 *      value never enters the computation at all.
 *
 * `scorePercent` is required (Step 6C-R Section 5's audit: every
 * current production writer that can tag a qualifying activity type
 * always populates it) -- missing or out-of-range fails closed rather
 * than inventing a label-derived fallback.
 */
export function normalizeMemoryEvidence(raw: RawLearningEvidenceRow): NormalizedMemoryEvidenceResult {
  const rawActivityType = raw.metadata?.activityType;
  if (typeof rawActivityType !== 'string' || rawActivityType.length === 0) {
    return { valid: false, reason: 'MISSING_METADATA_ACTIVITY_TYPE' };
  }

  // evidenceModeForActivity is typed as a total function over ActivityType,
  // but at runtime it is a plain object lookup -- an unrecognized key
  // returns `undefined`, which is exactly the taxonomy-membership check
  // this normalizer needs. This deliberately reuses the taxonomy's own
  // function as the sole source of truth rather than maintaining a
  // second, parallel list of valid ActivityType strings.
  const evidenceMode = evidenceModeForActivity(rawActivityType as ActivityType);
  if (evidenceMode === undefined) {
    return { valid: false, reason: 'UNKNOWN_ACTIVITY_TYPE' };
  }
  const activityType = rawActivityType as ActivityType;

  if (raw.scorePercent === null || raw.scorePercent === undefined) {
    return { valid: false, reason: 'MISSING_SCORE_PERCENT' };
  }
  if (!Number.isFinite(raw.scorePercent) || raw.scorePercent < 0 || raw.scorePercent > 100) {
    return { valid: false, reason: 'INVALID_SCORE_PERCENT' };
  }

  return {
    valid: true,
    evidence: {
      evidenceId: raw.id,
      studentId: raw.studentId,
      conceptId: raw.conceptId,
      activityType,
      evidenceMode,
      result: raw.result,
      scorePercent: raw.scorePercent,
      aiAssistanceType: raw.aiAssistanceType,
      hintsUsed: raw.hintsUsed,
      operationKey: raw.operationKey,
      timestamp: raw.timestamp,
      difficulty: raw.difficulty,
      cognitiveLevel: raw.cognitiveLevel,
    },
  };
}

function toQualificationInput(ev: CanonicalMemoryEvidence): RetentionQualificationInput {
  return {
    activityType: ev.activityType,
    result: ev.result,
    aiAssistanceType: ev.aiAssistanceType,
    hintsUsed: ev.hintsUsed,
    hasValidOperationKey: ev.operationKey !== null,
    occurredAt: ev.timestamp,
  };
}

// ============================================================
// SECTION 8-16 -- REPLAY-BASED STATE PROJECTION
// ============================================================

/**
 * Canonical pure MemoryState -- maps 1:1 to `concept_memory_state`'s
 * event-driven persisted columns (Step 6D Section 1), no semantic
 * translation needed at the future 6E write boundary. Deliberately
 * excludes every live-derived field (retrievabilityNow, forgettingRisk,
 * daysOverdue, retentionDue, predictionConfidence, memoryAgeDays) --
 * see computeLiveMemorySignals for those.
 */
export interface MemoryState {
  readonly studentId: string;
  readonly conceptId: string;
  readonly policyVersion: number;
  readonly initialCompetenceAnchorAt: string | null;
  readonly lastQualifiedAttemptAt: string | null;
  readonly lastSuccessfulRetentionAt: string | null;
  readonly lastUnsuccessfulRetentionAt: string | null;
  readonly demonstratedRetentionScore: number | null;
  /** The number of qualifying attempts actually backing demonstratedRetentionScore -- i.e. min(lifetime qualifying count, policy.demonstratedRetentionMaxEvidence), NOT an all-time lifetime counter. */
  readonly retentionEvidenceCount: number;
  readonly consecutiveQualifyingSuccesses: number;
  readonly memoryStability: MemoryStability;
  readonly memoryStatus: MemoryStatus;
  readonly nextReviewAt: string | null;
}

const EMPTY_TIMESTAMPS: MemoryTimestamps = {
  initialCompetenceAnchorAt: null,
  lastQualifiedAttemptAt: null,
  lastSuccessfulRetentionAt: null,
  lastUnsuccessfulRetentionAt: null,
};

/**
 * The output of a replay pass that also exposes the qualifying
 * attempts themselves (chronological order) -- Step 6E's memory-
 * projector service needs these (e.g. to derive an audit reason code
 * from the most recent attempt's outcome) without re-deriving
 * qualification a second time via a separate, potentially-drifting
 * code path.
 */
export interface MemoryProjectionDetail {
  readonly state: MemoryState;
  readonly qualifiedAttempts: readonly QualifiedRetentionAttempt[];
}

/**
 * Replays a sequence of CanonicalMemoryEvidence for ONE (student,
 * concept) pair and deterministically reconstructs MemoryState.
 *
 * Total deterministic order (Step 6E Section 1): `timestamp` ASC,
 * then `evidenceId` ASC as an explicit secondary key for same-
 * timestamp rows -- never array input order, DB natural order, or
 * object insertion order. This guarantees live projection, backfill,
 * and audit replay all reconstruct the exact same state from the
 * exact same evidence set, regardless of how it was fetched or
 * assembled.
 *
 * The identical algorithm serves live projection (Step 6E), backfill
 * (a future step), audit reconstruction, and these tests -- there is
 * exactly one code path, never a second incremental implementation
 * that could drift from replay's answer.
 *
 * No external "now" is used anywhere in this function -- every
 * timestamp written into the result comes from an evidence event
 * itself (the anchor event, or the most recent qualifying attempt).
 */
export function projectMemoryStateFromEvidenceDetailed(
  studentId: string,
  conceptId: string,
  evidence: readonly CanonicalMemoryEvidence[],
  policy: MemoryPolicyV1 = MEMORY_POLICY_V1
): MemoryProjectionDetail {
  const chronological = [...evidence].sort((a, b) => {
    const byTimestamp = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
    if (byTimestamp !== 0) return byTimestamp;
    return a.evidenceId < b.evidenceId ? -1 : a.evidenceId > b.evidenceId ? 1 : 0;
  });

  let timestamps: MemoryTimestamps = EMPTY_TIMESTAMPS;
  let consecutiveSuccesses = 0;
  let nextReviewAt: string | null = null;
  const qualifiedAttemptsChronological: QualifiedRetentionAttempt[] = [];

  for (const ev of chronological) {
    const input = toQualificationInput(ev);

    if (timestamps.initialCompetenceAnchorAt === null) {
      // No anchor yet: this event either establishes one (broader
      // eligibility -- ANY canonical INDEPENDENT/ASSESSMENT correct,
      // unassisted event, not just the 6 qualifying-attempt types --
      // Step 6C Section 2) or is skipped entirely. An ANCHOR_EVENT
      // never itself becomes a QualifiedRetentionAttempt, so it is
      // never evaluated against isQualifiedRetentionAttempt below.
      if (isAnchorEligible(input)) {
        timestamps = { ...timestamps, initialCompetenceAnchorAt: ev.timestamp };
        nextReviewAt = addDaysIso(ev.timestamp, policy.minimumReviewIntervalDays); // Section 15: anchor + 3 days
      }
      continue;
    }

    // Anchor exists: evaluate as a candidate QualifiedRetentionAttempt.
    // Reference spacing anchor is lastQualifiedAttemptAt once one
    // exists, otherwise initialCompetenceAnchorAt (Step 6C-R Section 9
    // -- this is the SPACING anchor, never the memory-age anchor).
    const referenceAnchorAt = timestamps.lastQualifiedAttemptAt ?? timestamps.initialCompetenceAnchorAt;
    if (!isQualifiedRetentionAttempt(input, referenceAnchorAt, policy)) {
      continue; // before the gap, or otherwise disqualified -- state is NOT mutated at all
    }

    const outcome = classifyRetentionAttemptOutcome(ev.result);
    const attempt: QualifiedRetentionAttempt = {
      studentId,
      conceptId,
      occurredAt: ev.timestamp,
      outcome,
      normalizedPerformance: normalizedPerformanceForQualifiedAttempt(ev.scorePercent),
      sourceEvidenceId: ev.evidenceId,
    };
    qualifiedAttemptsChronological.push(attempt);

    timestamps = nextMemoryTimestamps(timestamps, attempt);
    consecutiveSuccesses = nextConsecutiveSuccesses(consecutiveSuccesses, outcome);
    nextReviewAt = addDaysIso(ev.timestamp, reviewIntervalDaysForSuccessCount(consecutiveSuccesses, policy));
  }

  const hasCompetenceAnchor = timestamps.initialCompetenceAnchorAt !== null;
  const mostRecentOutcome = qualifiedAttemptsChronological.length > 0 ? qualifiedAttemptsChronological[qualifiedAttemptsChronological.length - 1].outcome : null;

  const memoryStability: MemoryStability = hasCompetenceAnchor ? stabilityFromConsecutiveSuccesses(consecutiveSuccesses, policy) : 'UNSTABLE';
  const memoryStatus = computeMemoryStatus({
    hasCompetenceAnchor,
    hasQualifiedAttempt: qualifiedAttemptsChronological.length > 0,
    mostRecentQualifiedOutcome: mostRecentOutcome,
    consecutiveSuccesses,
    policy,
  });

  // DemonstratedRetention wants most-recent-first.
  const demonstrated = computeDemonstratedRetention([...qualifiedAttemptsChronological].reverse(), policy);

  const state: MemoryState = {
    studentId,
    conceptId,
    policyVersion: policy.version,
    initialCompetenceAnchorAt: timestamps.initialCompetenceAnchorAt,
    lastQualifiedAttemptAt: timestamps.lastQualifiedAttemptAt,
    lastSuccessfulRetentionAt: timestamps.lastSuccessfulRetentionAt,
    lastUnsuccessfulRetentionAt: timestamps.lastUnsuccessfulRetentionAt,
    demonstratedRetentionScore: demonstrated.score,
    retentionEvidenceCount: demonstrated.evidenceCount,
    consecutiveQualifyingSuccesses: consecutiveSuccesses,
    memoryStability,
    memoryStatus,
    nextReviewAt: hasCompetenceAnchor ? nextReviewAt : null,
  };

  return { state, qualifiedAttempts: qualifiedAttemptsChronological };
}

/**
 * Thin, byte-for-byte-compatible wrapper over
 * projectMemoryStateFromEvidenceDetailed for callers (and all of Step
 * 6D's existing tests) that only need the persisted state shape.
 */
export function projectMemoryStateFromEvidence(
  studentId: string,
  conceptId: string,
  evidence: readonly CanonicalMemoryEvidence[],
  policy: MemoryPolicyV1 = MEMORY_POLICY_V1
): MemoryState {
  return projectMemoryStateFromEvidenceDetailed(studentId, conceptId, evidence, policy).state;
}

// ============================================================
// SECTION 17/18 -- LIVE-DERIVED SIGNALS
// ============================================================

/**
 * Every field here is TIME-DERIVED LIVE -- computed fresh from
 * `state` + `now`, never persisted, never written back into
 * MemoryState. Reuses memory-policy.ts's already-locked
 * computeRetrievability/computeRetentionDue verbatim -- this function
 * is pure orchestration over a MemoryState row, not a second
 * retrievability algorithm. The "which interval feeds retrievability"
 * question (Step 6D Section 18) was already answered, unambiguously,
 * in Step 6C: `reviewIntervalDaysForSuccessCount(consecutiveSuccesses)`
 * -- the exact same function that sets nextReviewAt. Reusing it here
 * (via computeRetrievability, which already does this internally) is
 * the only correct choice; introducing a second interval source would
 * itself create the ambiguity this step was told to avoid.
 */
export interface LiveMemorySignals {
  readonly memoryAgeDays: number | null;
  readonly retrievabilityNow: number | null;
  readonly forgettingRisk: number | null;
  readonly retentionDue: boolean;
  readonly daysOverdue: number | null;
  readonly predictionConfidence: PredictionConfidence;
}

export function computeLiveMemorySignals(state: MemoryState, nowIso: string, policy: MemoryPolicyV1 = MEMORY_POLICY_V1): LiveMemorySignals {
  const retrievability = computeRetrievability(
    { lastSuccessfulRetentionAt: state.lastSuccessfulRetentionAt, initialCompetenceAnchorAt: state.initialCompetenceAnchorAt },
    state.consecutiveQualifyingSuccesses,
    nowIso,
    policy
  );
  const due = computeRetentionDue(state.nextReviewAt, nowIso);

  return {
    memoryAgeDays: retrievability?.memoryAgeDays ?? null,
    retrievabilityNow: retrievability?.retrievabilityNow ?? null,
    forgettingRisk: retrievability?.forgettingRisk ?? null,
    retentionDue: due.retentionDue,
    daysOverdue: due.daysOverdue,
    // NOT_ESTABLISHED (no anchor at all, retrievability===null) has no
    // meaningful prediction to be confident or unconfident about --
    // still reported as LOW, the same "nothing to trust yet" answer
    // predictionConfidenceFromStability already gives for UNSTABLE.
    predictionConfidence: retrievability?.predictionConfidence ?? 'LOW',
  };
}
