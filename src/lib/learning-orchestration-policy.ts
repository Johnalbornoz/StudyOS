/**
 * Phase 8 -- Learning Orchestration: the canonical PURE deterministic
 * orchestration policy (Step 8A1, POLICY FOUNDATION ONLY).
 *
 * Phase 8 owns WHEN, SEQUENCE, CONTINUITY, CAPACITY ALLOCATION and
 * REPLANNING -- and nothing else. It does NOT own Mastery, Knowledge
 * State, verification qualification, concept ranking, LearningDecision
 * activity selection, TeachingIntent, Memory `nextReviewAt`,
 * TransferDepth, novelty certification, curriculum truth, or
 * prerequisite truth. Those remain the authority of Phases 1-7.
 *
 * PURE. Deterministic. Same input -> same output, always. No DB, no AI,
 * no React, no network, no process env, no randomness, and NO hidden
 * clock -- every time-dependent function receives `now`, `timezone`,
 * `horizonStart` and `horizonEnd` explicitly. `Intl` is used only for
 * timezone-aware CALENDAR-DATE math (deterministic, clock-free).
 *
 * PHASE 4 BOUNDARY. This file NEVER recreates dominantSignal /
 * selectActivityType / computeLearningState, never computes a concept
 * priority score, and never overrides Phase 4's `priorityScore`. It
 * only CARRIES Phase 4's already-computed priority as an input and uses
 * it to resolve TEMPORAL competition between opportunities Phase 4 has
 * already made eligible.
 *
 * NO SIDE-EFFECTING READS (8A0 correction). Nothing here mutates
 * anything. There is deliberately no "a read rebuilds the plan" path --
 * all plan creation / replanning will go through an explicit Phase 8
 * write boundary (8B+), invoked by an explicit trigger (8E+), never
 * from a dashboard/plan read.
 *
 * 8A1 wires NOTHING into Today, Study Plan, updateMastery, Phase 4/5/6/7,
 * or any route. It defines vocabulary, types, and pure primitives only.
 */

import { estimateActivityMinutes } from '@/lib/learning-execution-policy';
import type { ActivityType } from '@/lib/activity-taxonomy';

// ---------------------------------------------------------------------
// Version + horizon
// ---------------------------------------------------------------------

/**
 * Bumped whenever the orchestration RULES change: goal-tier
 * classification, candidate ordering, capacity/allocation semantics,
 * the operation-key identity, the diff model, or the frozen-window
 * rule. Persisted on `learning_plan.orchestration_policy_version` and
 * copied onto every `learning_plan_item`; a bump triggers a controlled
 * full replan of every ACTIVE plan (safe -- plans are downstream
 * orchestration, never cognitive state).
 */
export const ORCHESTRATION_POLICY_VERSION = 1 as const;

/**
 * The canonical rolling horizon: `today` through `today + 13` in the
 * LEARNER's timezone -- 14 calendar days inclusive. This is NOT a
 * mastery deadline, NOT a fixed 14-day course, and NOT a reset cycle;
 * successive recomputes just roll it forward one day.
 */
export const ORCHESTRATION_HORIZON_DAYS = 14 as const;

/**
 * New Phase 8 orchestration default (not a pedagogy constant): the
 * execution policy (learning-execution-policy.ts) caps a day by
 * MINUTES only and has no item cap, so there is no prior canonical
 * value to reuse. Overridable per day via `DailyCapacityInput.maxItems`.
 */
export const ORCHESTRATION_MAX_ITEMS_PER_DAY = 4 as const;

// ---------------------------------------------------------------------
// Legacy Study Plan cutover (Step 8G1)
// ---------------------------------------------------------------------

/**
 * The single source of truth for a learner's schedule. Every plan read
 * and every plan write goes through these tables (8B read boundary /
 * 8B SOLE writer). The legacy `study_plans` / `study_sessions` /
 * `study_session_items` tables are frozen historical data -- still
 * present, never dropped, never written by any production flow.
 */
export const CANONICAL_PLAN_AUTHORITY = 'learning_plan/learning_plan_item' as const;

/**
 * `false` after 8G1: no production code path inserts a `study_plans`,
 * `study_sessions`, or `study_session_items` row. `storeStudyPlan` is a
 * disabled stub that throws; `/api/study-plan/generate` is a
 * compatibility shim over the canonical planner.
 */
export const LEGACY_PLAN_WRITER_ACTIVE = false as const;

// ---------------------------------------------------------------------
// Plan + item status taxonomy
// ---------------------------------------------------------------------

export type LearningPlanStatus = 'ACTIVE' | 'SUPERSEDED';
export const LEARNING_PLAN_STATUSES: readonly LearningPlanStatus[] = ['ACTIVE', 'SUPERSEDED'];

/**
 * PLANNED -> READY -> (COMPLETED | SKIPPED | EXPIRED | SUPERSEDED).
 * COMPLETED / SKIPPED / EXPIRED / SUPERSEDED are TERMINAL (history) --
 * a replan diff never reopens them. Deliberately NO IN_PROGRESS /
 * BLOCKED / PAUSED / FAILED (no repo evidence requires them; an item
 * either has completion evidence or it does not).
 */
export type LearningPlanItemStatus = 'PLANNED' | 'READY' | 'COMPLETED' | 'SKIPPED' | 'EXPIRED' | 'SUPERSEDED';
export const LEARNING_PLAN_ITEM_STATUSES: readonly LearningPlanItemStatus[] = [
  'PLANNED',
  'READY',
  'COMPLETED',
  'SKIPPED',
  'EXPIRED',
  'SUPERSEDED',
];
const TERMINAL_ITEM_STATUSES: ReadonlySet<LearningPlanItemStatus> = new Set([
  'COMPLETED',
  'SKIPPED',
  'EXPIRED',
  'SUPERSEDED',
]);
export function isTerminalItemStatus(status: LearningPlanItemStatus): boolean {
  return TERMINAL_ITEM_STATUSES.has(status);
}

// ---------------------------------------------------------------------
// Orchestration sources + reason codes (closed, internal, non-learner-facing)
// ---------------------------------------------------------------------

export type OrchestrationSource =
  | 'PHASE4_DECISION'
  | 'RETENTION_WINDOW'
  | 'TRANSFER_READINESS'
  | 'ASSESSMENT_PREP'
  | 'CURRICULUM_PROGRESSION'
  | 'REMEDIATION'
  | 'PREREQUISITE'
  | 'MANUAL_RESCHEDULE';
export const ORCHESTRATION_SOURCES: readonly OrchestrationSource[] = [
  'PHASE4_DECISION',
  'RETENTION_WINDOW',
  'TRANSFER_READINESS',
  'ASSESSMENT_PREP',
  'CURRICULUM_PROGRESSION',
  'REMEDIATION',
  'PREREQUISITE',
  'MANUAL_RESCHEDULE',
];

/** Machine provenance only -- never rendered raw, never carries learner prose. */
export type OrchestrationReasonCode =
  | 'ASSESSMENT_APPROACHING'
  | 'RETENTION_DUE'
  | 'REMEDIATION_REQUIRED'
  | 'VERIFICATION_READY'
  | 'PREREQUISITE_FIRST'
  | 'TRANSFER_PROGRESSION'
  | 'MISCONCEPTION_BLOCK'
  | 'LEARNING_DEBT'
  | 'CURRICULUM_PROGRESSION'
  | 'LEARNER_REQUESTED';
export const ORCHESTRATION_REASON_CODES: readonly OrchestrationReasonCode[] = [
  'ASSESSMENT_APPROACHING',
  'RETENTION_DUE',
  'REMEDIATION_REQUIRED',
  'VERIFICATION_READY',
  'PREREQUISITE_FIRST',
  'TRANSFER_PROGRESSION',
  'MISCONCEPTION_BLOCK',
  'LEARNING_DEBT',
  'CURRICULUM_PROGRESSION',
  'LEARNER_REQUESTED',
];

// ---------------------------------------------------------------------
// Goal tiers (deterministic precedence; NO concept ranking here)
// ---------------------------------------------------------------------

/**
 * 1 = highest orchestration precedence. Concept-level WHAT stays Phase
 * 4; this only orders CLASSES of temporal obligation.
 *
 *   1 ACTIVE LEARNING BLOCKER  MISCONCEPTION_BLOCK / PREREQUISITE_FIRST /
 *                              REMEDIATION_REQUIRED / LEARNING_DEBT
 *   2 RETENTION INTEGRITY      RETENTION_DUE
 *   3 ASSESSMENT READINESS     ASSESSMENT_APPROACHING
 *   4 VERIFICATION READINESS   VERIFICATION_READY
 *   5 TRANSFER PROGRESSION     TRANSFER_PROGRESSION
 *   6 CURRICULUM PROGRESSION   CURRICULUM_PROGRESSION
 *   7 LEARNER REQUEST          LEARNER_REQUESTED
 *
 * LEARNING_DEBT sits in tier 1: an unresolved learning debt means a
 * concept has regressed below the mastery bar and needs repair
 * attention -- the same blocker class as active remediation.
 */
export type OrchestrationGoalTier = 1 | 2 | 3 | 4 | 5 | 6 | 7;

const GOAL_TIER_BY_REASON: Record<OrchestrationReasonCode, OrchestrationGoalTier> = {
  MISCONCEPTION_BLOCK: 1,
  PREREQUISITE_FIRST: 1,
  REMEDIATION_REQUIRED: 1,
  LEARNING_DEBT: 1,
  RETENTION_DUE: 2,
  ASSESSMENT_APPROACHING: 3,
  VERIFICATION_READY: 4,
  TRANSFER_PROGRESSION: 5,
  CURRICULUM_PROGRESSION: 6,
  LEARNER_REQUESTED: 7,
};

export function getOrchestrationGoalTier(reasonCode: OrchestrationReasonCode): OrchestrationGoalTier {
  return GOAL_TIER_BY_REASON[reasonCode];
}

// ---------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------

/**
 * The minimal, safe "why is this scheduled" record persisted on
 * `learning_plan_item.provenance` (JSONB). It carries a canonical
 * source pointer and a bounded set of primitive facts -- NEVER student
 * answers, AI output, prompts, PII, or a full LearningDecision blob.
 * It is NOT part of plan-item identity (see buildLearningPlanItemOperationKey).
 */
export interface OrchestrationProvenance {
  /** e.g. 'assessment_occurrence', 'concept_memory_state', 'remediation_path', 'phase4_decision'. */
  sourceType: string;
  /** Opaque canonical id of that source row, when one exists. */
  sourceRef?: string | null;
  /** Bounded primitive facts for deterministic explainability (e.g. daysUntil, lastReviewAt). */
  facts?: Record<string, string | number | boolean | null>;
}

// ---------------------------------------------------------------------
// Planning candidate
// ---------------------------------------------------------------------

/**
 * A pure planning candidate -- one temporal opportunity the
 * orchestration service has already deemed eligible (from Phase 4
 * decisions, Phase 6 retention windows, Phase 7 transfer readiness,
 * assessment dates, curriculum eligibility, etc.). It carries only
 * input snapshots, never live learner-state truth.
 */
export interface OrchestrationCandidate {
  studentId: string;
  subjectId: string;
  conceptId?: string | null;

  intendedActivityType: ActivityType;

  reasonCode: OrchestrationReasonCode;
  source: OrchestrationSource;

  /** Phase 4's own priorityScore, CARRIED not computed. Higher = more urgent. */
  phase4PriorityScore?: number | null;

  /** ISO date (YYYY-MM-DD). A slot on/before this date is strongly preferred; an unsatisfiable deadline is surfaced, never silently ignored. */
  hardDeadline?: string | null;
  /** ISO date. The policy MUST NOT schedule before this (retention nextReviewAt day, transfer spacing, teacher commitment). */
  earliestDate?: string | null;
  /** ISO date. The policy MUST NOT schedule after this. */
  latestDate?: string | null;

  estimatedMinutes: number;

  /** A fixed calendar commitment (e.g. a scheduled assessment): it stays on its supplied date; a capacity conflict is surfaced, the item is never auto-moved. */
  fixed?: boolean;

  /** Deterministic stable identity for the candidate itself, used only as a final tie-break. */
  candidateKey?: string;

  provenance?: OrchestrationProvenance;
}

/** Convenience: the estimated minutes for a candidate, reusing the ONE canonical duration table. */
export function candidateEstimatedMinutes(activityType: ActivityType): number {
  return estimateActivityMinutes(activityType);
}

// ---------------------------------------------------------------------
// Deterministic candidate ordering
// ---------------------------------------------------------------------

/** ISO-date compare with nulls last. */
function compareNullableDateAsc(a: string | null | undefined, b: string | null | undefined): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Numeric compare DESC with nulls last (a missing Phase 4 score never outranks a present one). */
function compareNullableNumberDesc(a: number | null | undefined, b: number | null | undefined): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return b - a;
}

function compareString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The one canonical total ordering of planning candidates:
 *   1. goal tier ASC (blocker first)
 *   2. hard deadline ASC (soonest first; none last)
 *   3. Phase 4 priorityScore DESC (carried, never computed; none last)
 *   4. conceptId ASC (stable; subject-level items -> subjectId)
 *   5. candidateKey / reasonCode ASC (final stable tie-break)
 *
 * Phase 8 is NOT inventing concept priority -- steps 3-5 only make the
 * order reproducible once Phase 4's own signal is exhausted.
 */
export function compareOrchestrationCandidates(a: OrchestrationCandidate, b: OrchestrationCandidate): number {
  const tier = getOrchestrationGoalTier(a.reasonCode) - getOrchestrationGoalTier(b.reasonCode);
  if (tier !== 0) return tier;

  const deadline = compareNullableDateAsc(a.hardDeadline, b.hardDeadline);
  if (deadline !== 0) return deadline;

  const priority = compareNullableNumberDesc(a.phase4PriorityScore, b.phase4PriorityScore);
  if (priority !== 0) return priority;

  const concept = compareString(a.conceptId ?? `subject:${a.subjectId}`, b.conceptId ?? `subject:${b.subjectId}`);
  if (concept !== 0) return concept;

  return compareString(a.candidateKey ?? a.reasonCode, b.candidateKey ?? b.reasonCode);
}

/** Pure: returns a NEW array in canonical order; never mutates the input. */
export function orderOrchestrationCandidates(candidates: readonly OrchestrationCandidate[]): OrchestrationCandidate[] {
  return [...candidates].sort(compareOrchestrationCandidates);
}

// ---------------------------------------------------------------------
// Timezone-aware calendar-date helpers (Intl only; no clock)
// ---------------------------------------------------------------------

export interface HorizonResult {
  ok: boolean;
  horizonStart?: string;
  horizonEnd?: string;
  error?: 'INVALID_TIMEZONE' | 'INVALID_NOW';
}

export function isValidIanaTimezone(timezone: string): boolean {
  try {
    // Throws RangeError for an unknown timezone. Deterministic, clock-free.
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/** The calendar date (YYYY-MM-DD) that `now` falls on, in `timezone`. */
function localCalendarDate(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const y = parts.find((p) => p.type === 'year')!.value;
  const m = parts.find((p) => p.type === 'month')!.value;
  const d = parts.find((p) => p.type === 'day')!.value;
  return `${y}-${m}-${d}`;
}

/** Pure YYYY-MM-DD arithmetic via UTC anchoring (no local-time/DST drift on a date-only value). */
export function addDaysToIsoDate(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const anchor = Date.UTC(y, m - 1, d);
  const shifted = new Date(anchor + days * 86_400_000);
  const yy = shifted.getUTCFullYear();
  const mm = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(shifted.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/** Whole-day difference `b - a` between two YYYY-MM-DD dates. */
export function daysBetweenIsoDates(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/**
 * The canonical rolling horizon for a recompute anchored at `now` in
 * `timezone`: `[localDate(now), localDate(now) + (horizonDays - 1)]`.
 * A missing / invalid input is a deterministic failure -- the pure
 * policy never silently falls back to UTC or the machine clock (the IO
 * layer decides that, supplying `timezone_assumed=true`).
 */
export function computeOrchestrationHorizon(
  now: Date,
  timezone: string,
  horizonDays: number = ORCHESTRATION_HORIZON_DAYS,
): HorizonResult {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) return { ok: false, error: 'INVALID_NOW' };
  if (!isValidIanaTimezone(timezone)) return { ok: false, error: 'INVALID_TIMEZONE' };
  const horizonStart = localCalendarDate(now, timezone);
  const horizonEnd = addDaysToIsoDate(horizonStart, Math.max(1, Math.floor(horizonDays)) - 1);
  return { ok: true, horizonStart, horizonEnd };
}

/** True iff `[horizonStart, horizonEnd]` is a valid window of 1..ORCHESTRATION_HORIZON_DAYS inclusive days. */
export function isValidHorizonBound(horizonStart: string, horizonEnd: string): boolean {
  const span = daysBetweenIsoDates(horizonStart, horizonEnd);
  return span >= 0 && span <= ORCHESTRATION_HORIZON_DAYS - 1;
}

// ---------------------------------------------------------------------
// Capacity + allocation
// ---------------------------------------------------------------------

/**
 * One horizon day's capacity. `available=false` (weekend the learner
 * did not opt into, a marked-unavailable day, a holiday) -> nothing is
 * placed there. Weekend-unavailability is NOT hardcoded here -- the
 * caller supplies `available` per date so school/product rules can
 * evolve without a policy rewrite.
 */
export interface DailyCapacityInput {
  /** YYYY-MM-DD. */
  date: string;
  availableMinutes: number;
  maxItems: number;
  available: boolean;
}

/** Optional allocation constraints. `maxSubjectSwitches` is an INPUT, not a certified constant -- no product rule exists yet, so there is no default cap. */
export interface AllocationOptions {
  maxSubjectSwitches?: number;
}

export type DeferReason = 'NO_ELIGIBLE_DAY' | 'INSUFFICIENT_CAPACITY' | 'HARD_DEADLINE_UNSATISFIABLE' | 'FIXED_SLOT_CONFLICT';

export interface PlacedCandidate {
  candidate: OrchestrationCandidate;
  scheduledDate: string;
  estimatedMinutes: number;
  operationKey: string;
}

export interface DeferredCandidate {
  candidate: OrchestrationCandidate;
  reason: DeferReason;
}

export interface AllocationResult {
  placed: PlacedCandidate[];
  deferred: DeferredCandidate[];
}

export interface AllocationInput {
  candidates: readonly OrchestrationCandidate[];
  dailyCapacity: readonly DailyCapacityInput[];
  horizonStart: string;
  horizonEnd: string;
  now: Date;
  timezone: string;
  options?: AllocationOptions;
}

interface DayLedger {
  date: string;
  available: boolean;
  minutesLeft: number;
  itemsLeft: number;
  subjectsUsed: Set<string>;
  subjectSwitchesLeft: number;
}

/**
 * Deterministic single-pass allocator. Walks candidates in canonical
 * order (orderOrchestrationCandidates) and places each on the EARLIEST
 * legitimate day:
 *   - never before `earliestDate` (retention / spacing / commitments),
 *   - never after `latestDate`,
 *   - prefer a day on/before `hardDeadline`; if none has capacity ->
 *     deferred(HARD_DEADLINE_UNSATISFIABLE), never a silent post-deadline slot,
 *   - `fixed` items must land on their supplied `earliestDate` (== the
 *     commitment date); a capacity conflict there -> deferred(FIXED_SLOT_CONFLICT),
 *     never auto-moved,
 *   - respect per-day minutes, item count, and (if supplied) subject switches.
 * No DB, no Phase 4 call, no AI, no Date.now beyond the explicit `now`.
 * Inputs are never mutated.
 */
export function allocateCandidatesToHorizon(input: AllocationInput): AllocationResult {
  const { candidates, dailyCapacity, horizonStart, horizonEnd, options } = input;

  const capByDate = new Map<string, DailyCapacityInput>();
  for (const c of dailyCapacity) capByDate.set(c.date, c);

  // Build the ordered day ledger for the horizon window.
  const days: DayLedger[] = [];
  const span = Math.max(0, daysBetweenIsoDates(horizonStart, horizonEnd));
  for (let i = 0; i <= span; i++) {
    const date = addDaysToIsoDate(horizonStart, i);
    const cap = capByDate.get(date);
    days.push({
      date,
      available: cap ? cap.available : false,
      minutesLeft: cap ? Math.max(0, cap.availableMinutes) : 0,
      itemsLeft: cap ? Math.max(0, cap.maxItems) : 0,
      subjectsUsed: new Set<string>(),
      subjectSwitchesLeft:
        options?.maxSubjectSwitches != null ? Math.max(0, Math.floor(options.maxSubjectSwitches)) : Number.POSITIVE_INFINITY,
    });
  }

  const placed: PlacedCandidate[] = [];
  const deferred: DeferredCandidate[] = [];

  const canTake = (day: DayLedger, cand: OrchestrationCandidate, minutes: number): boolean => {
    if (!day.available) return false;
    if (day.minutesLeft < minutes) return false;
    if (day.itemsLeft < 1) return false;
    const subj = cand.subjectId;
    if (!day.subjectsUsed.has(subj) && day.subjectsUsed.size > 0 && day.subjectSwitchesLeft < 1) return false;
    return true;
  };

  const take = (day: DayLedger, cand: OrchestrationCandidate, minutes: number, operationKey: string): void => {
    if (!day.subjectsUsed.has(cand.subjectId)) {
      if (day.subjectsUsed.size > 0 && day.subjectSwitchesLeft !== Number.POSITIVE_INFINITY) day.subjectSwitchesLeft -= 1;
      day.subjectsUsed.add(cand.subjectId);
    }
    day.minutesLeft -= minutes;
    day.itemsLeft -= 1;
    placed.push({ candidate: cand, scheduledDate: day.date, estimatedMinutes: minutes, operationKey });
  };

  for (const cand of orderOrchestrationCandidates(candidates)) {
    const minutes = cand.estimatedMinutes > 0 ? cand.estimatedMinutes : estimateActivityMinutes(cand.intendedActivityType);
    const earliest = cand.earliestDate && cand.earliestDate > horizonStart ? cand.earliestDate : horizonStart;
    const latest = cand.latestDate && cand.latestDate < horizonEnd ? cand.latestDate : horizonEnd;

    // Fixed commitment: only its own day (its earliestDate == commitment date).
    if (cand.fixed) {
      const target = days.find((d) => d.date === (cand.earliestDate ?? cand.hardDeadline ?? ''));
      if (!target) {
        deferred.push({ candidate: cand, reason: 'NO_ELIGIBLE_DAY' });
        continue;
      }
      const opKey = buildLearningPlanItemOperationKey({
        studentId: cand.studentId,
        conceptId: cand.conceptId ?? null,
        subjectId: cand.subjectId,
        reasonCode: cand.reasonCode,
        scheduledDate: target.date,
        orchestrationPolicyVersion: ORCHESTRATION_POLICY_VERSION,
      });
      if (canTake(target, cand, minutes)) take(target, cand, minutes, opKey);
      else deferred.push({ candidate: cand, reason: 'FIXED_SLOT_CONFLICT' });
      continue;
    }

    // A hard deadline is a HARD placement cap: the policy prefers a
    // slot on/before it and NEVER places after it -- an unfittable
    // deadline surfaces as a deterministic deferral, not a
    // post-deadline slot the caller must silently trust.
    const hasDeadline = cand.hardDeadline != null && cand.hardDeadline >= earliest;
    const latestEffective = cand.hardDeadline != null && cand.hardDeadline < latest ? cand.hardDeadline : latest;

    let landed = false;
    for (const day of days) {
      if (day.date < earliest) continue;
      if (day.date > latestEffective) break;
      const opKey = buildLearningPlanItemOperationKey({
        studentId: cand.studentId,
        conceptId: cand.conceptId ?? null,
        subjectId: cand.subjectId,
        reasonCode: cand.reasonCode,
        scheduledDate: day.date,
        orchestrationPolicyVersion: ORCHESTRATION_POLICY_VERSION,
      });
      if (canTake(day, cand, minutes)) {
        take(day, cand, minutes, opKey);
        landed = true;
        break;
      }
    }
    if (landed) continue;

    // Nothing fit. Classify the deferral deterministically.
    const daysInWindow = days.filter((d) => d.date >= earliest && d.date <= latestEffective);
    if (daysInWindow.length === 0) {
      deferred.push({ candidate: cand, reason: hasDeadline ? 'HARD_DEADLINE_UNSATISFIABLE' : 'NO_ELIGIBLE_DAY' });
    } else if (hasDeadline) {
      deferred.push({ candidate: cand, reason: 'HARD_DEADLINE_UNSATISFIABLE' });
    } else {
      deferred.push({ candidate: cand, reason: 'INSUFFICIENT_CAPACITY' });
    }
  }

  return { placed, deferred };
}

// ---------------------------------------------------------------------
// Plan-item operation key (deterministic identity)
// ---------------------------------------------------------------------

const OP_KEY_SEPARATOR = '::';

function assertNoOpKeySeparator(value: string, field: string): void {
  if (value.includes(OP_KEY_SEPARATOR)) {
    throw new Error(`LearningPlanItem operation key ${field} must not contain "${OP_KEY_SEPARATOR}": ${JSON.stringify(value)}`);
  }
}

export interface LearningPlanItemIdentity {
  studentId: string;
  /** null for a subject-level item (e.g. MOCK_EXAM) -- falls back to `subject:<subjectId>`. */
  conceptId: string | null;
  subjectId: string;
  reasonCode: OrchestrationReasonCode;
  /** YYYY-MM-DD -- the scheduled DATE is the identity bucket (a legitimate reschedule to a new date is a NEW opportunity). */
  scheduledDate: string;
  orchestrationPolicyVersion: number;
}

/**
 * Deterministic, pure, no randomness. Same student + same concept (or
 * subject fallback) + same reason + same scheduled date + same policy
 * version => same key. Follows the repo's `buildOperationKey`
 * convention (a "::"-joined string of stable segments, each asserted
 * separator-free -- NOT unstable JSON.stringify). `provenance` is NEVER
 * part of identity.
 *
 * A legitimate reschedule to a different date yields a DIFFERENT key;
 * the projector (8B) then SUPERSEDES the old item and ADDs the new one,
 * preserving the full schedule history rather than mutating a date.
 */
export function buildLearningPlanItemOperationKey(identity: LearningPlanItemIdentity): string {
  const conceptSegment = identity.conceptId ?? `subject:${identity.subjectId}`;
  const versionSegment = `v${identity.orchestrationPolicyVersion}`;
  const segments = ['LPI', versionSegment, identity.studentId, conceptSegment, identity.reasonCode, identity.scheduledDate];
  for (const [i, seg] of segments.entries()) assertNoOpKeySeparator(seg, `segment[${i}]`);
  return segments.join(OP_KEY_SEPARATOR);
}

// ---------------------------------------------------------------------
// Minimal-diff plan model
// ---------------------------------------------------------------------

export type PlanItemDiffKind = 'UNCHANGED' | 'ADDED' | 'SUPERSEDED';

/** A minimal shape the diff needs -- the projector maps rows/candidates onto this. */
export interface DiffableItem {
  operationKey: string;
  status: LearningPlanItemStatus;
}

export interface PlanItemDiffEntry {
  kind: PlanItemDiffKind;
  operationKey: string;
}

/**
 * Pure minimal-change diff of a live plan against a freshly proposed
 * one, keyed by `operationKey`:
 *   - same key present in both, current item is LIVE (PLANNED/READY)   -> UNCHANGED
 *   - key only in `proposed`                                          -> ADDED
 *   - key only in `current`, current item is LIVE                      -> SUPERSEDED
 *   - current item is TERMINAL (COMPLETED/SKIPPED/EXPIRED/SUPERSEDED)  -> never touched
 * A "move" (day 1 -> day 2) surfaces here as {SUPERSEDED old} + {ADDED new},
 * never a mutable MOVED state -- the full schedule history stays deterministic.
 * Output is sorted by operationKey for stable, reproducible replays.
 */
export function diffLearningPlanItems(
  current: readonly DiffableItem[],
  proposed: readonly { operationKey: string }[],
): PlanItemDiffEntry[] {
  const currentByKey = new Map(current.map((c) => [c.operationKey, c]));
  const proposedKeys = new Set(proposed.map((p) => p.operationKey));
  const entries: PlanItemDiffEntry[] = [];

  for (const p of proposed) {
    const existing = currentByKey.get(p.operationKey);
    if (!existing) {
      entries.push({ kind: 'ADDED', operationKey: p.operationKey });
    } else if (!isTerminalItemStatus(existing.status)) {
      entries.push({ kind: 'UNCHANGED', operationKey: p.operationKey });
    }
    // else: terminal item that happens to match a proposal key -> leave it; do not re-add.
  }

  for (const c of current) {
    if (proposedKeys.has(c.operationKey)) continue;
    if (isTerminalItemStatus(c.status)) continue; // never reopen history
    entries.push({ kind: 'SUPERSEDED', operationKey: c.operationKey });
  }

  return entries.sort((a, b) => compareString(a.operationKey, b.operationKey));
}

// ---------------------------------------------------------------------
// Frozen near-term window
// ---------------------------------------------------------------------

export interface FrozenWindowInput {
  now: Date;
  timezone: string;
  /** YYYY-MM-DD of the item under consideration. */
  scheduledDate: string;
}

/**
 * An item is FROZEN when its scheduled date is today (in the learner's
 * timezone) or earlier -- automatic replanning must not move or
 * supersede it. Timezone is NEVER inferred here; `now` + `timezone`
 * are explicit inputs.
 */
export function isItemFrozen(input: FrozenWindowInput): boolean {
  if (!isValidIanaTimezone(input.timezone)) return false; // caller must supply a valid tz; fail open (not frozen) rather than crash a pure fn
  const today = localCalendarDate(input.now, input.timezone);
  return input.scheduledDate <= today;
}

export interface FrozenOverride {
  /** The caller derived "a tier-1 cognitive change occurred" from CANONICAL inputs (Phase 4/2/3) -- the policy does not judge criticality itself. */
  criticalOverride?: boolean;
  /** The learner explicitly rescheduled this item. */
  manualReschedule?: boolean;
}

/**
 * Whether a FROZEN item may still be superseded on this replan. Only a
 * caller-supplied `criticalOverride` (a tier-1 canonical change) or an
 * explicit `manualReschedule` unlocks it. Automatic churn cannot.
 */
export function canReplaceFrozenItem(frozen: boolean, override: FrozenOverride = {}): boolean {
  if (!frozen) return true;
  return override.criticalOverride === true || override.manualReschedule === true;
}

/**
 * 8A1 does NOT persist a per-day "move count". A minimal stability
 * guarantee is provided structurally instead: `diffLearningPlanItems`
 * emits UNCHANGED for every matching live item (no wholesale rewrite),
 * and `canReplaceFrozenItem` protects the near-term window. A richer
 * churn budget is deferred until state supports it without extra schema.
 */
export const CHURN_BUDGET_IMPLEMENTED = false as const;
