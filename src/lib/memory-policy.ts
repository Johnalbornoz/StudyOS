/**
 * STUDYUS PHASE 6 -- RETENTION & MEMORY ENGINE
 * Step 6C: canonical memory vocabulary + Memory Policy v1.
 *
 * This module is PURE: no DB access, no `Date.now()`, no side effects.
 * Every function takes explicit timestamp/data inputs and returns a
 * plain value. It has ZERO production callers as of Step 6C -- it
 * exists to lock the vocabulary and policy constants deterministically,
 * ahead of the Step 6D state table and Step 6E projector that will
 * actually wire this into `mastery.service.ts::updateMastery`'s
 * transaction. Until then, importing this module changes nothing.
 *
 * Step 6C-R deliberately does NOT mirror `knowledge-state.service.ts`'s
 * `scoreOf` fallback convention (correct=100/partial=50/incorrect=0)
 * for qualifying retention attempts -- its Section 5 audit confirmed
 * `score_percent` is always populated by every current write path
 * that can produce one, so `normalizedPerformanceForQualifiedAttempt`
 * requires it rather than silently falling back to a label-derived
 * guess that could misrepresent a real PARTIAL score.
 *
 * ============================================================
 * WHY EvidenceMode IS NOT TRUSTED FROM THE RAW EVIDENCE ROW
 * ============================================================
 * `learning_evidence.metadata.evidenceMode` is free-text JSON stamped
 * at write time -- nothing enforces it matches the row's own
 * `activity_type` (Phase 6A finding). Every function here that needs
 * to know whether an activity was independent/unassisted looks it up
 * via `evidenceModeForActivity()` from the canonical, fixed,
 * total `activity-taxonomy.ts` map instead of reading a caller-
 * supplied EvidenceMode value. `activity_type` alone is still not
 * sufficient proof of independence by itself -- both the type AND its
 * canonical mode are checked.
 */

import { evidenceModeForActivity, type ActivityType, type EvidenceMode } from './activity-taxonomy';
import type { EvidenceResult } from './algorithms/mastery';

// ============================================================
// SECTION 1 -- CANONICAL VOCABULARY
// ============================================================

/**
 * MemoryStatus -- the canonical, evidence-driven summary state for a
 * concept's memory (Phase 6's OWN field, distinct from and never a
 * duplicate of `concept_knowledge_state.mastery_state`, even where a
 * value name is shared for conceptual clarity, e.g. WAITING_FOR_RETENTION).
 *
 * PERSISTED IN 6D: yes (`concept_memory_state.memory_status`), as the
 *   base value only.
 * EVENT-DRIVEN OR TIME-DERIVED: event-driven. A *live* `retentionDue`
 *   overlay (nextReviewAt <= now) is computed on top of this at read
 *   time -- "DUE" is deliberately NOT a 6th member of this enum
 *   (see computeRetentionDue below).
 * MAY UPDATE: a new qualifying evidence event (via the Step 6E projector).
 * MUST NOT UPDATE: elapsed time alone. Passing time never transitions
 *   DEVELOPING/STABLE into AT_RISK -- only a genuine qualifying
 *   failure/partial does.
 */
export type MemoryStatus = 'NOT_ESTABLISHED' | 'WAITING_FOR_RETENTION' | 'DEVELOPING' | 'STABLE' | 'AT_RISK';

/**
 * MemoryStability -- how resistant the memory currently appears to
 * forgetting, based purely on the consecutive-successful-qualified-
 * attempt streak. Feeds the review-interval lookup and
 * PredictionConfidence. NEVER itself a "how much is retained" score --
 * that is DemonstratedRetention's job.
 *
 * PERSISTED IN 6D: yes (`concept_memory_state.memory_stability`).
 * EVENT-DRIVEN OR TIME-DERIVED: event-driven only.
 * MAY UPDATE: a new qualifying evidence event.
 * MUST NOT UPDATE: elapsed time alone.
 */
export type MemoryStability = 'UNSTABLE' | 'DEVELOPING' | 'STABLE';

/**
 * PredictionConfidence -- how much to trust the LIVE Retrievability/
 * ForgettingRisk prediction right now. This is NOT AI confidence and
 * NOT the learner's self-reported confidence (`confidence_before_answer`)
 * -- it is a deterministic function of MemoryStability alone.
 *
 * PERSISTED IN 6D: no -- always derived live, same lifecycle as
 *   Retrievability/ForgettingRisk themselves.
 * EVENT-DRIVEN OR TIME-DERIVED: time-derived live (recomputed on read,
 *   though its only real input, MemoryStability, is itself event-driven).
 * MAY UPDATE: recomputed on every read.
 * MUST NOT UPDATE: never persisted, so "update" does not apply.
 */
export type PredictionConfidence = 'LOW' | 'MEDIUM' | 'HIGH';

/**
 * RetentionAttemptOutcome -- the canonical 3-way classification of a
 * QualifiedRetentionAttempt, derived directly from the existing,
 * already-deterministic `learning_evidence.result` convention
 * (see SUCCESS_OUTCOME_SEMANTICS below). Not a new invention.
 */
export type RetentionAttemptOutcome = 'SUCCESS' | 'FAILURE' | 'PARTIAL';

/**
 * CompetenceAnchor -- the bootstrapping event. Represents "the first
 * time this student demonstrated genuine, unassisted competence in
 * this concept" -- established by ANY EvidenceMode INDEPENDENT/
 * ASSESSMENT activity answered correctly, not restricted to the
 * narrower QUALIFYING_ACTIVITY_TYPES list used for ongoing retention
 * attempts (Step 6C Section 2's own wording: "INDEPENDENT/ASSESSMENT
 * event", not "one of the six retention-attempt types"). This is a
 * deliberate, intentional asymmetry -- see isAnchorEligible.
 *
 * The anchor event itself is an ANCHOR_EVENT, never a
 * QualifiedRetentionAttempt and never RetentionProof -- no elapsed
 * retention gap exists yet at the moment it's set.
 *
 * PERSISTED IN 6D: yes, as the `initialCompetenceAnchorAt` timestamp
 *   (`concept_memory_state.initial_competence_anchor_at`).
 * EVENT-DRIVEN OR TIME-DERIVED: event-driven.
 * MAY UPDATE: set exactly once, the first time an eligible event occurs.
 * MUST NOT UPDATE: never overwritten once set (even by a later,
 *   otherwise-eligible event) -- it is a fixed historical fact.
 */
export interface CompetenceAnchor {
  readonly studentId: string;
  readonly conceptId: string;
  readonly establishedAt: string; // ISO timestamp = initialCompetenceAnchorAt
  readonly sourceEvidenceId: string;
}

/**
 * QualifiedRetentionAttempt -- a delayed, eligible, unassisted retrieval
 * attempt that meets MINIMUM_RETENTION_GAP from its reference anchor.
 * May succeed, fail, or partially succeed -- ALL three outcomes are
 * valid retention-domain evidence (a failure proves an attempt
 * genuinely occurred), but only a SUCCESS is RetentionProof.
 *
 * PERSISTED IN 6D: not as individual rows -- Phase 6 aggregates these
 *   into `concept_memory_state`'s counters/timestamps; the underlying
 *   `learning_evidence` rows remain the durable, replayable source.
 * EVENT-DRIVEN OR TIME-DERIVED: event-driven (each one IS an event).
 */
export interface QualifiedRetentionAttempt {
  readonly studentId: string;
  readonly conceptId: string;
  readonly occurredAt: string; // ISO timestamp
  readonly outcome: RetentionAttemptOutcome;
  /**
   * 0-100. MUST be derived via `normalizedPerformanceForQualifiedAttempt`
   * from the row's actual `score_percent` -- never a result-label
   * fallback (correct=100/partial=50/incorrect=0). Step 6C-R's audit
   * (Section 5) confirmed `score_percent` is always populated as a
   * real number for every current production write path that can tag
   * one of QUALIFYING_ACTIVITY_TYPES, so no fallback is needed or
   * permitted for this field.
   */
  readonly normalizedPerformance: number;
  readonly sourceEvidenceId: string;
}

/** RetentionProof -- a QualifiedRetentionAttempt whose outcome is SUCCESS. See isRetentionProof. */
export type RetentionProof = QualifiedRetentionAttempt & { readonly outcome: 'SUCCESS' };

/**
 * DemonstratedRetention -- the canonical EVIDENCED retention score
 * Phase 2 will consume (Step 6G) as the input to its retention
 * dimension, replacing `classifyRetention()`. Deliberately NEVER
 * decayed by calendar time -- only by which qualifying attempts fall
 * inside the most-recent-N window. Calendar-time decay belongs only
 * to Retrievability/ForgettingRisk (a different, predicted concept).
 *
 * PERSISTED IN 6D: yes (`concept_memory_state.demonstrated_retention_score`
 *   + `retention_evidence_count`).
 * EVENT-DRIVEN OR TIME-DERIVED: event-driven only.
 * MAY UPDATE: a new qualifying evidence event.
 * MUST NOT UPDATE: elapsed time alone, AI, or the anchor-setting event itself.
 */
export interface DemonstratedRetentionResult {
  readonly score: number | null; // 0-100, or null before the first qualifying attempt
  readonly evidenceCount: number; // number of qualifying attempts actually used in the window
  readonly policyVersion: number;
}

/**
 * MemoryAge -- raw elapsed time (days) since the reference retrieval
 * anchor used for prediction (lastSuccessfulRetentionAt, or the
 * competence anchor as a low-confidence fallback). Not itself a
 * "score" -- purely an input to Retrievability/ForgettingRisk.
 *
 * PERSISTED IN 6D: no.
 * EVENT-DRIVEN OR TIME-DERIVED: time-derived live.
 */
export type MemoryAgeDays = number;

/**
 * Retrievability / ForgettingRisk -- the PREDICTED complement pair:
 * FORGETTING_RISK = 100 - RETRIEVABILITY_NOW. Explicit, deterministic,
 * exponential-decay function of MemoryAge vs. the stability-derived
 * expected interval. NEVER an input to Mastery or VALIDATED_MASTERY.
 *
 * PERSISTED IN 6D: no -- always derived live.
 * EVENT-DRIVEN OR TIME-DERIVED: time-derived live.
 * MAY UPDATE: recomputed on every read.
 * MUST NOT UPDATE: mastery_score, VALIDATED_MASTERY, or any persisted
 *   Phase 2 field, ever, under any circumstance.
 */
export interface RetrievabilityResult {
  readonly retrievabilityNow: number; // 0-100
  readonly forgettingRisk: number; // 100 - retrievabilityNow
  readonly memoryAgeDays: MemoryAgeDays;
  readonly anchorUsed: 'LAST_SUCCESSFUL_RETENTION' | 'INITIAL_COMPETENCE_ANCHOR';
  readonly predictionConfidence: PredictionConfidence;
}

/**
 * NextReviewAt -- the scheduled timestamp Phase 6 recommends
 * rechecking this concept. Event-driven and persisted; NEVER
 * auto-advanced by a background process while overdue (none exists
 * in this codebase, and Phase 6 must not introduce one) -- it only
 * changes on the next actual qualifying event. `daysOverdue` is a
 * separate, live-derived value layered on top.
 *
 * PERSISTED IN 6D: yes (`concept_memory_state.next_review_at`).
 * EVENT-DRIVEN OR TIME-DERIVED: SCHEDULED PERSISTED -- persisted,
 *   updated only by an evidence event, but its value denotes a
 *   future point in time.
 */
export type NextReviewAt = string | null;

/**
 * The four canonical timestamps (Step 6C's semantic correction to
 * Phase 6B, itself refined by Step 6C-R). Each has a distinct,
 * non-overlapping meaning -- see `nextMemoryTimestamps` for the exact
 * transition rule governing which timestamp a given outcome is and is
 * not allowed to move.
 *
 * Step 6C-R renamed the "most recent non-successful attempt" field to
 * its current name below: the original name was too narrow the moment
 * PARTIAL was confirmed to be a second non-proof outcome alongside
 * FAILURE. There were zero live callers at the time of the rename, so
 * no ambiguous alias was kept anywhere in this module.
 */
export interface MemoryTimestamps {
  /** Set once, the first time an eligible anchor event occurs. Never overwritten. */
  readonly initialCompetenceAnchorAt: string | null;
  /** Most recent QUALIFYING attempt of ANY outcome (success, failure, or partial). Used for minimum-spacing/audit/scheduling-after-an-attempt. */
  readonly lastQualifiedAttemptAt: string | null;
  /** Most recent SUCCESSFUL qualified attempt only. The preferred anchor for MemoryAge/Retrievability/ForgettingRisk. A FAILURE or PARTIAL MUST NOT move this. */
  readonly lastSuccessfulRetentionAt: string | null;
  /** Most recent qualified attempt whose outcome was PARTIAL or FAILURE (i.e. NOT SUCCESS) -- both update it, SUCCESS never does. Observability/audit only -- never a prediction anchor. */
  readonly lastUnsuccessfulRetentionAt: string | null;
}

/**
 * MemoryDecisionSignal -- the Phase 6 -> Phase 4 contract (Step 6B
 * Section 10 / Step 6C Section 13). Raw memory signals ONLY. Phase 4
 * remains sole authority for priority/banding/activity selection --
 * this type deliberately has NO priority, priorityBand,
 * recommendedActivity, urgency score, or rank field, and none should
 * ever be added to it.
 */
export interface MemoryDecisionSignal {
  readonly retentionDue: boolean;
  readonly nextReviewAt: NextReviewAt;
  readonly daysOverdue: number | null;
  readonly retrievabilityNow: number | null;
  readonly forgettingRisk: number | null;
  readonly memoryStatus: MemoryStatus;
  readonly lastSuccessfulRetentionAt: string | null;
  readonly memoryStability: MemoryStability;
  readonly predictionConfidence: PredictionConfidence;
}

// ============================================================
// SECTION 5 -- MEMORY POLICY V1 (immutable, versioned, deterministic)
// ============================================================

export const MEMORY_POLICY_VERSION = 1 as const;

/**
 * The six ActivityTypes whose evidence may qualify as a
 * QualifiedRetentionAttempt. RETENTION_CHECK is the purpose-built
 * primary vehicle; the other five are genuinely independent/assessment
 * activities that may also constitute real retention proof under the
 * same strict conditions (Phase 6B Section 2, Option C -- Hybrid).
 *
 * PRACTICE and REVIEW are excluded because their EvidenceMode is
 * PRACTICE (assistance-tolerant) -- this directly enforces
 * PRACTICE_WITH_HELP_CANNOT_PROVE_RETENTION. DIAGNOSTIC_CHECK is
 * excluded despite its ASSESSMENT EvidenceMode: it is a narrow,
 * single-purpose root-cause probe, not a general retrieval test (a
 * deliberate, reversible product decision, not a technical necessity
 * -- see Step 6B Section 22 open questions).
 */
export const QUALIFYING_ACTIVITY_TYPES: readonly ActivityType[] = [
  'RETENTION_CHECK',
  'SOLO_CHECK',
  'SOLO_VERIFY',
  'TRANSFER',
  'CUMULATIVE_ASSESSMENT',
  'MOCK_EXAM',
];

/** Documented negative list -- explicitly never qualifying, regardless of EvidenceMode. */
export const EXCLUDED_ACTIVITY_TYPES: readonly ActivityType[] = ['PRACTICE', 'REVIEW', 'DIAGNOSTIC_CHECK'];

/** EvidenceModes a qualifying retention attempt (or a competence anchor) must have, per the canonical activity taxonomy -- never trusted from the raw row's own metadata. */
const QUALIFYING_EVIDENCE_MODES: readonly EvidenceMode[] = ['INDEPENDENT', 'ASSESSMENT'];

export interface MemoryPolicyV1 {
  readonly version: 1;

  // --- Qualification (Section 3) ---
  readonly minimumRetentionGapDays: number;
  readonly qualifyingActivityTypes: readonly ActivityType[];

  // --- Scoring (Section 5 / 11) ---
  readonly demonstratedRetentionMaxEvidence: number;
  readonly recencyWeightDecay: number;
  readonly difficultyWeight: number; // no-op in v1 (must equal 1.0)
  readonly cognitiveLevelWeight: number; // no-op in v1 (must equal 1.0)

  // --- Stability (Section 6) ---
  readonly stabilityDevelopingAtSuccesses: number; // consecutive successes at which DEVELOPING begins
  readonly stabilityStableAtSuccesses: number; // consecutive successes at which STABLE begins

  // --- Review scheduling (Section 7) ---
  readonly reviewIntervalDaysBySuccessCount: readonly number[]; // index = consecutive successes (0..5); 6+ uses the last entry
  readonly minimumReviewIntervalDays: number;
  readonly maximumReviewIntervalDays: number;

  // --- Retrievability (Section 8) ---
  readonly retrievabilityDecayConstantK: number;
}

/**
 * The single, frozen v1 policy. `demonstratedRetentionMaxEvidence: 5`
 * with `recencyWeightDecay: 0.80` produces weights [1.0, 0.8, 0.64,
 * 0.512, 0.4096] for the 1st..5th-most-recent qualifying attempt,
 * normalized by their own sum (see computeDemonstratedRetention).
 *
 * `reviewIntervalDaysBySuccessCount[0] = 3` deliberately covers BOTH
 * "anchor only, no qualified attempt yet" and "the most recent
 * qualified attempt was a failure" -- both states have
 * consecutiveSuccesses === 0, so a single lookup table entry serves
 * both of Section 7's "anchor -> 3 days" and "failure -> 3 days"
 * rules without a separate branch.
 */
export const MEMORY_POLICY_V1: MemoryPolicyV1 = Object.freeze({
  version: 1,

  minimumRetentionGapDays: 3,
  qualifyingActivityTypes: QUALIFYING_ACTIVITY_TYPES,

  demonstratedRetentionMaxEvidence: 5,
  recencyWeightDecay: 0.8,
  difficultyWeight: 1.0,
  cognitiveLevelWeight: 1.0,

  stabilityDevelopingAtSuccesses: 1,
  stabilityStableAtSuccesses: 3,

  reviewIntervalDaysBySuccessCount: [3, 4, 7, 14, 28, 56, 84],
  minimumReviewIntervalDays: 3,
  maximumReviewIntervalDays: 84,

  retrievabilityDecayConstantK: 0.7,
});

// ============================================================
// SECTION 4 -- SUCCESS OUTCOME SEMANTICS (audited, not invented)
// ============================================================
//
// Audited against the CURRENT repository: `learning_evidence.result`
// is already a deterministic, existing convention (src/lib/algorithms/
// mastery.ts's `EvidenceResult = 'correct' | 'incorrect' | 'partial'`),
// populated at submission time from a concept-bucket score threshold
// (src/app/api/quizzes/generate-and-take/route.ts:
// `result: conceptScore >= 70 ? 'correct' : conceptScore >= 50 ? 'partial' : 'incorrect'`).
// This is NOT genuinely ambiguous -- Phase 6C reuses this existing
// convention exactly rather than inventing a new threshold:
//
//   'correct' -> SUCCESS (= RetentionProof)
//   'partial' -> PARTIAL (qualifying evidence, NOT proof)
//   'incorrect' -> FAILURE (qualifying evidence, NOT proof)
//
// For stability/status/scheduling purposes PARTIAL is treated
// identically to FAILURE (Step 6C-R Section 2's frozen semantics) --
// only SUCCESS advances the consecutive-success streak or updates
// lastSuccessfulRetentionAt. PARTIAL is NOT coerced to a fixed numeric
// score for DemonstratedRetention, though -- see
// normalizedPerformanceForQualifiedAttempt below.
//
// | Outcome | RetentionProof | streak      | Stability | Status  | interval | lastSuccessfulRetentionAt | lastUnsuccessfulRetentionAt |
// |---------|-----------------|-------------|-----------|---------|----------|---------------------------|------------------------------|
// | SUCCESS | YES             | +1          | per count | per count (DEVELOPING/STABLE) | per count | updated | unchanged |
// | PARTIAL | NO              | reset to 0  | UNSTABLE  | AT_RISK | 3 days   | unchanged | updated |
// | FAILURE | NO              | reset to 0  | UNSTABLE  | AT_RISK | 3 days   | unchanged | updated |

/** Maps the existing, already-canonical `EvidenceResult` to Phase 6's RetentionAttemptOutcome. Not a new threshold. */
export function classifyRetentionAttemptOutcome(result: EvidenceResult): RetentionAttemptOutcome {
  if (result === 'correct') return 'SUCCESS';
  if (result === 'partial') return 'PARTIAL';
  return 'FAILURE';
}

/** A QualifiedRetentionAttempt is RetentionProof iff its outcome is SUCCESS. PARTIAL and FAILURE are both real retention-domain evidence, but neither is proof. */
export function isRetentionProof(attempt: QualifiedRetentionAttempt): attempt is RetentionProof {
  return attempt.outcome === 'SUCCESS';
}

/**
 * The canonical -- and ONLY -- way to derive
 * `QualifiedRetentionAttempt.normalizedPerformance`. `scorePercent` is
 * REQUIRED, not optional: Step 6C-R's Section 5 audit confirmed
 * `learning_evidence.score_percent` is always populated as a real
 * number by every current production write path capable of tagging
 * one of QUALIFYING_ACTIVITY_TYPES (route.ts:803 `scorePercent:
 * conceptScore`; assessment-verification.service.ts:325; transfer/
 * submit/route.ts:58 -- all compute a real `Math.round(...)` or
 * ternary numeric value, never leave it undefined). There is
 * therefore no legitimate case where a QUALIFYING attempt needs a
 * label-derived fallback (correct=100/partial=50/incorrect=0) -- and
 * Step 6C-R explicitly forbids inventing one, since that would let a
 * PARTIAL silently read as a fixed 50 instead of its real, possibly
 * very different, stored score (e.g. 62). A caller that somehow lacks
 * a real scorePercent for evidence tagged with a qualifying activity
 * type has a genuine upstream data problem, not something Phase 6
 * should paper over -- it should not construct a
 * QualifiedRetentionAttempt at all in that case.
 */
export function normalizedPerformanceForQualifiedAttempt(scorePercent: number): number {
  return Math.max(0, Math.min(100, Math.round(scorePercent)));
}

/**
 * Given the previous consecutive-successful-qualified-attempt streak
 * and a new attempt's outcome, returns the new streak. SUCCESS
 * extends it; PARTIAL and FAILURE both reset it to 0 -- there is no
 * partial-credit streak. Pure, no clock input.
 */
export function nextConsecutiveSuccesses(previousConsecutiveSuccesses: number, outcome: RetentionAttemptOutcome): number {
  return outcome === 'SUCCESS' ? previousConsecutiveSuccesses + 1 : 0;
}

/**
 * The canonical timestamp transition rule for one new
 * QualifiedRetentionAttempt. `initialCompetenceAnchorAt` is never
 * touched here (it is set once, elsewhere, by an ANCHOR_EVENT).
 * SUCCESS moves `lastSuccessfulRetentionAt` and leaves
 * `lastUnsuccessfulRetentionAt` untouched; PARTIAL and FAILURE both
 * move `lastUnsuccessfulRetentionAt` and leave
 * `lastSuccessfulRetentionAt` untouched. `lastQualifiedAttemptAt`
 * always moves, regardless of outcome -- it is the minimum-spacing/
 * audit anchor, not a prediction anchor.
 */
export function nextMemoryTimestamps(previous: MemoryTimestamps, attempt: QualifiedRetentionAttempt): MemoryTimestamps {
  const isSuccess = attempt.outcome === 'SUCCESS';
  return {
    initialCompetenceAnchorAt: previous.initialCompetenceAnchorAt,
    lastQualifiedAttemptAt: attempt.occurredAt,
    lastSuccessfulRetentionAt: isSuccess ? attempt.occurredAt : previous.lastSuccessfulRetentionAt,
    lastUnsuccessfulRetentionAt: isSuccess ? previous.lastUnsuccessfulRetentionAt : attempt.occurredAt,
  };
}

// ============================================================
// SECTION 2 -- COMPETENCE ANCHOR ELIGIBILITY
// ============================================================

/**
 * Plain, DB-free description of one evidence row's relevant fields --
 * the only shape this module ever reads.
 *
 * IMPORTANT for the Step 6D/6E projector: `activityType` here MUST be
 * sourced from `learning_evidence.metadata.activityType` (a real,
 * correctly-cased `ActivityType` value, e.g. `'RETENTION_CHECK'`) --
 * NEVER from the top-level `learning_evidence.activity_type` column.
 * Confirmed by direct source read (Step 6C-R): that top-level column
 * is populated from a free-text `telemetry.activityType` string that
 * is NOT the canonical taxonomy and is inconsistent across writers --
 * e.g. `route.ts:819` stamps the literal string `'quiz'` for every
 * quiz mode including RETENTION_CHECK, and
 * `transfer/submit/route.ts:62` stamps the lowercase `'transfer'`
 * (which would never match the `ActivityType` union's `'TRANSFER'`
 * even if it were read). The top-level column carries no
 * qualification-relevant information and must never be used for it.
 */
export interface RetentionQualificationInput {
  readonly activityType: ActivityType;
  readonly result: EvidenceResult;
  readonly aiAssistanceType: string; // must equal 'NONE' to ever qualify or anchor
  readonly hintsUsed: number;
  readonly hasValidOperationKey: boolean;
  readonly occurredAt: string; // ISO timestamp
}

/**
 * Broader than QUALIFYING_ACTIVITY_TYPES by design (Step 6C Section 2):
 * ANY EvidenceMode INDEPENDENT/ASSESSMENT activity, answered correctly,
 * unassisted, may establish the competence anchor -- not only the six
 * retention-attempt-shaped types. A DIAGNOSTIC_CHECK can set the
 * anchor (it genuinely proves first independent competence) even
 * though it can never later count as a qualifying retention re-test.
 */
export function isAnchorEligible(input: RetentionQualificationInput): boolean {
  if (input.result !== 'correct') return false;
  if (input.aiAssistanceType !== 'NONE') return false;
  if (input.hintsUsed !== 0) return false;
  if (!input.hasValidOperationKey) return false;
  return QUALIFYING_EVIDENCE_MODES.includes(evidenceModeForActivity(input.activityType));
}

// ============================================================
// SECTION 3 -- RETENTION EVIDENCE QUALIFICATION V1
// ============================================================

function daysBetween(earlierIso: string, laterIso: string): number {
  const ms = new Date(laterIso).getTime() - new Date(earlierIso).getTime();
  return ms / (1000 * 60 * 60 * 24);
}

/**
 * Whether `input` qualifies as a QualifiedRetentionAttempt relative to
 * `referenceAnchorAt` (the caller-supplied gap anchor -- per Step 6C
 * Section 2, this is `initialCompetenceAnchorAt` before any qualified
 * attempt exists, else the previous `lastQualifiedAttemptAt`).
 * Concept-level by construction: the caller is responsible for
 * scoping `input`/`referenceAnchorAt` to one (student_id, concept_id)
 * pair -- this function never mixes concepts.
 */
export function isQualifiedRetentionAttempt(
  input: RetentionQualificationInput,
  referenceAnchorAt: string | null,
  policy: MemoryPolicyV1 = MEMORY_POLICY_V1
): boolean {
  if (referenceAnchorAt === null) return false;
  if (!policy.qualifyingActivityTypes.includes(input.activityType)) return false;
  if (!QUALIFYING_EVIDENCE_MODES.includes(evidenceModeForActivity(input.activityType))) return false;
  if (input.aiAssistanceType !== 'NONE') return false;
  if (input.hintsUsed !== 0) return false;
  if (!input.hasValidOperationKey) return false;
  return daysBetween(referenceAnchorAt, input.occurredAt) >= policy.minimumRetentionGapDays;
}

// ============================================================
// SECTION 6 -- MEMORY STABILITY V1
// ============================================================

/** Pure function of the consecutive-successful-qualified-attempt streak. A failure resets the streak to 0 BEFORE this is called -- this function does not itself inspect outcomes. */
export function stabilityFromConsecutiveSuccesses(
  consecutiveSuccesses: number,
  policy: MemoryPolicyV1 = MEMORY_POLICY_V1
): MemoryStability {
  if (consecutiveSuccesses >= policy.stabilityStableAtSuccesses) return 'STABLE';
  if (consecutiveSuccesses >= policy.stabilityDevelopingAtSuccesses) return 'DEVELOPING';
  return 'UNSTABLE';
}

// ============================================================
// SECTION 7 -- REVIEW SCHEDULE POLICY V1
// ============================================================

/**
 * consecutiveSuccesses === 0 covers BOTH "anchor established, no
 * qualified attempt yet" and "most recent qualified attempt was a
 * failure/partial" -- both map to the same 3-day entry, matching
 * Section 7's frozen sequence exactly with no separate failure branch.
 * Difficulty adjustment is a documented no-op in v1.
 */
export function reviewIntervalDaysForSuccessCount(
  consecutiveSuccesses: number,
  policy: MemoryPolicyV1 = MEMORY_POLICY_V1
): number {
  const table = policy.reviewIntervalDaysBySuccessCount;
  const index = Math.min(consecutiveSuccesses, table.length - 1);
  const days = table[Math.max(0, index)];
  return Math.min(policy.maximumReviewIntervalDays, Math.max(policy.minimumReviewIntervalDays, days));
}

/** Adds `days` to `fromIso`, returning an ISO timestamp -- the pure scheduling primitive `NextReviewAt` is built from. */
export function addDaysIso(fromIso: string, days: number): string {
  const d = new Date(fromIso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

/**
 * `daysOverdue` is always live-derived (never persisted) -- `nextReviewAt`
 * itself never silently advances while overdue; only a new qualifying
 * event changes it.
 */
export function computeRetentionDue(nextReviewAt: NextReviewAt, nowIso: string): { retentionDue: boolean; daysOverdue: number | null } {
  if (nextReviewAt === null) return { retentionDue: false, daysOverdue: null };
  const overdueDays = daysBetween(nextReviewAt, nowIso);
  const retentionDue = overdueDays >= 0;
  return { retentionDue, daysOverdue: retentionDue ? Math.floor(overdueDays) : null };
}

// ============================================================
// SECTION 8 -- RETRIEVABILITY / FORGETTING RISK POLICY V1
// ============================================================

/**
 * MemoryAge is measured from `lastSuccessfulRetentionAt` when it
 * exists; a failed/partial qualified attempt NEVER resets it (Step
 * 6C's semantic correction -- a failure proves an attempt occurred,
 * not that memory was refreshed). Falls back to
 * `initialCompetenceAnchorAt` only when no successful retention proof
 * exists yet, which forces LOW predictionConfidence (see
 * predictionConfidenceFromStability -- this is guaranteed by
 * construction: no successful proof means consecutiveSuccesses is
 * necessarily 0, which is exactly the UNSTABLE/LOW case).
 */
export function computeRetrievability(
  timestamps: Pick<MemoryTimestamps, 'lastSuccessfulRetentionAt' | 'initialCompetenceAnchorAt'>,
  consecutiveSuccesses: number,
  nowIso: string,
  policy: MemoryPolicyV1 = MEMORY_POLICY_V1
): RetrievabilityResult | null {
  const anchorAt = timestamps.lastSuccessfulRetentionAt ?? timestamps.initialCompetenceAnchorAt;
  if (anchorAt === null) return null; // NOT_ESTABLISHED -- nothing to predict from yet

  const anchorUsed: RetrievabilityResult['anchorUsed'] =
    timestamps.lastSuccessfulRetentionAt !== null ? 'LAST_SUCCESSFUL_RETENTION' : 'INITIAL_COMPETENCE_ANCHOR';

  const memoryAgeDays = Math.max(0, daysBetween(anchorAt, nowIso));
  const stability = stabilityFromConsecutiveSuccesses(consecutiveSuccesses, policy);
  const expectedIntervalDays = reviewIntervalDaysForSuccessCount(consecutiveSuccesses, policy);

  const ratio = memoryAgeDays / Math.max(1, expectedIntervalDays);
  const forgettingRisk = Math.round(Math.max(0, Math.min(100, 100 * (1 - Math.exp(-policy.retrievabilityDecayConstantK * ratio)))));
  const retrievabilityNow = 100 - forgettingRisk;

  return {
    retrievabilityNow,
    forgettingRisk,
    memoryAgeDays,
    anchorUsed,
    predictionConfidence: predictionConfidenceFromStability(stability),
  };
}

// ============================================================
// SECTION 9 -- PREDICTION CONFIDENCE V1
// ============================================================

/**
 * A direct 1:1 mapping from MemoryStability. This deliberately
 * collapses Step 6C's three stated LOW conditions ("no successful
 * RetentionProof exists" / "only competence anchor exists" / "stability
 * = UNSTABLE") into one rule: all three are exactly the
 * consecutiveSuccesses === 0 case, which is what UNSTABLE already
 * means. Verified explicitly by a unit test, not just asserted here.
 * Never derived from AI or from the learner's own self-reported
 * confidence (`confidence_before_answer`) -- unrelated concepts.
 */
export function predictionConfidenceFromStability(stability: MemoryStability): PredictionConfidence {
  if (stability === 'STABLE') return 'HIGH';
  if (stability === 'DEVELOPING') return 'MEDIUM';
  return 'LOW';
}

// ============================================================
// SECTION 10 -- MEMORY STATUS V1
// ============================================================

export interface MemoryStatusInput {
  readonly hasCompetenceAnchor: boolean;
  readonly hasQualifiedAttempt: boolean;
  readonly mostRecentQualifiedOutcome: RetentionAttemptOutcome | null;
  readonly consecutiveSuccesses: number;
  readonly policy?: MemoryPolicyV1;
}

/**
 * Pure evidence-driven state derivation. `retentionDue` ("DUE") is
 * deliberately NOT one of these five states -- see computeRetentionDue,
 * a separate live overlay. Passing time alone can never move this
 * function's output between calls with the same evidence-derived
 * inputs -- it takes no clock input at all.
 */
export function computeMemoryStatus(input: MemoryStatusInput): MemoryStatus {
  if (!input.hasCompetenceAnchor) return 'NOT_ESTABLISHED';
  if (!input.hasQualifiedAttempt) return 'WAITING_FOR_RETENTION';
  if (input.mostRecentQualifiedOutcome !== 'SUCCESS') return 'AT_RISK';
  const policy = input.policy ?? MEMORY_POLICY_V1;
  return stabilityFromConsecutiveSuccesses(input.consecutiveSuccesses, policy) === 'STABLE' ? 'STABLE' : 'DEVELOPING';
}

// ============================================================
// SECTION 11 -- DEMONSTRATED RETENTION V1
// ============================================================

/**
 * `attempts` must be QualifiedRetentionAttempt rows for ONE
 * (student, concept) pair, ordered most-recent-first, and must NEVER
 * include the anchor-setting event itself (that event is an
 * ANCHOR_EVENT, not a QualifiedRetentionAttempt -- see Section 2).
 * Uses at most `policy.demonstratedRetentionMaxEvidence` of them,
 * weighted by recency only (never by calendar time -- an attempt from
 * a year ago and one from yesterday get the same weight if they sit
 * at the same ordinal position in the window). Difficulty/cognitive
 * weighting is a documented no-op in v1 (policy.difficultyWeight /
 * cognitiveLevelWeight both fixed at 1.0).
 */
export function computeDemonstratedRetention(
  attemptsMostRecentFirst: readonly QualifiedRetentionAttempt[],
  policy: MemoryPolicyV1 = MEMORY_POLICY_V1
): DemonstratedRetentionResult {
  if (attemptsMostRecentFirst.length === 0) {
    return { score: null, evidenceCount: 0, policyVersion: policy.version };
  }
  const windowed = attemptsMostRecentFirst.slice(0, policy.demonstratedRetentionMaxEvidence);
  let weightedSum = 0;
  let weightTotal = 0;
  windowed.forEach((attempt, i) => {
    const weight = Math.pow(policy.recencyWeightDecay, i) * policy.difficultyWeight * policy.cognitiveLevelWeight;
    weightedSum += weight * attempt.normalizedPerformance;
    weightTotal += weight;
  });
  const score = Math.round(weightedSum / weightTotal);
  return { score: Math.max(0, Math.min(100, score)), evidenceCount: windowed.length, policyVersion: policy.version };
}

// ============================================================
// SECTION 12 / 13 -- CONTRACT ASSERTIONS (types only, no live wiring)
// ============================================================
//
// Phase 2's determineMasteryState (unchanged in this step) will, from
// Step 6G onward, consume ONLY `DemonstratedRetentionResult.score` --
// never RetrievabilityResult, PredictionConfidence, or
// MemoryDecisionSignal.daysOverdue/retrievabilityNow/forgettingRisk.
// This file enforces that separation structurally: nothing in
// Section 4/6/7/10/11 (the evidence-driven half) takes a `now`
// timestamp parameter; only Section 8/9 (the predicted half, Section
// 7's computeRetentionDue included) does. A reviewer can verify
// TIME_ALONE_DOES_NOT_CHANGE_VALIDATED_MASTERY / PREDICTED_FORGETTING_
// CANNOT_REVOKE_VALIDATED_MASTERY purely by checking which functions
// accept a clock input.
