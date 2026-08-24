/**
 * Phase 3D -- Execution Scheduler: the pure deterministic policy that
 * turns Phase 3C's ranked LearningDecision[] into a time-constrained
 * daily plan.
 *
 * PHASE 3C DECIDES. PHASE 3D EXECUTES. This file never reorders
 * pedagogical priority -- it re-applies Phase 3C's own
 * `rankLearningDecisions` (never a copy of it) to guarantee a canonical
 * order regardless of input array order, then walks that order once,
 * fitting whatever fits into the available time. A lower-ranked item
 * filling leftover time never becomes "the higher priority" -- the
 * original LearningDecision (with its real priorityScore) always rides
 * along unchanged, and a skipped higher-ranked item is preserved in
 * `deferred` with an honest reason, never silently dropped.
 *
 * Pure: no DB, no fetch, no LLM, no Date.now() -- `now` is always an
 * explicit input. See learning-execution-scheduler.service.ts for the
 * IO layer that loads decisions and supplies real time/options.
 */

import { rankLearningDecisions, type LearningDecision } from './adaptive-learning-policy';
import type { ActivityType } from './activity-taxonomy';

export interface ExecutionConstraints {
  availableMinutes: number;
  now: Date;
}

export type DeferReason = 'INSUFFICIENT_TIME';

export type ExecutionReason = 'FITS_IN_ORDER' | 'FILLS_REMAINING_TIME';

export interface LearningPlanItem {
  decision: LearningDecision;
  sequence: number;
  estimatedMinutes: number;
  /** FITS_IN_ORDER: nothing ranked above it was skipped for time. FILLS_REMAINING_TIME: it executes only because at least one higher-ranked decision could not physically fit -- it never becomes "the" priority. */
  executionReason: ExecutionReason;
}

export interface DeferredDecision {
  decision: LearningDecision;
  reason: DeferReason;
}

export interface DailyLearningPlan {
  studentId: string;
  generatedAt: string;
  availableMinutes: number;
  plannedMinutes: number;
  items: LearningPlanItem[];
  deferred: DeferredDecision[];
}

/**
 * One deterministic duration estimate per ActivityType. No LLM
 * estimates duration; no adaptive prediction. DIAGNOSTIC_CHECK matches
 * generate-and-take's own 2-4 question default; REMEDIATION matches
 * today-plan.service.ts's existing "Minimum Effective Intervention"
 * estimate for continuing an active repair (both already-established
 * product expectations, reused rather than invented).
 */
const ACTIVITY_DURATION_MINUTES: Record<ActivityType, number> = {
  PRACTICE: 10,
  REVIEW: 8,
  SOLO_CHECK: 6,
  DIAGNOSTIC_CHECK: 4,
  REMEDIATION: 8,
  SOLO_VERIFY: 10,
  TRANSFER: 6,
  RETENTION_CHECK: 6,
  CUMULATIVE_ASSESSMENT: 20,
  MOCK_EXAM: 30,
};

export function estimateActivityMinutes(activityType: ActivityType): number {
  return ACTIVITY_DURATION_MINUTES[activityType];
}

/**
 * Builds the daily plan. Re-ranks via Phase 3C's own rankLearningDecisions
 * first (never a duplicate/copy of that policy) so the walk below is
 * always in true Phase 3C order regardless of what order the caller
 * happened to pass decisions in. Then a single top-down walk: each
 * decision is independently checked against the CURRENT remaining
 * budget -- if it fits, it's scheduled and the budget shrinks; if not,
 * it's deferred with INSUFFICIENT_TIME and the walk continues to the
 * next (lower-ranked) decision, which is exactly how a smaller
 * lower-ranked item can end up filling time a bigger higher-ranked item
 * couldn't, without ever reordering anything or splitting an item
 * across partial time.
 */
export function buildDailyLearningPlan(
  studentId: string,
  decisions: LearningDecision[],
  constraints: ExecutionConstraints
): DailyLearningPlan {
  const ranked = rankLearningDecisions(decisions);
  const { availableMinutes, now } = constraints;

  let remaining = availableMinutes;
  const items: LearningPlanItem[] = [];
  const deferred: DeferredDecision[] = [];
  let sequence = 1;

  for (const decision of ranked) {
    const estimatedMinutes = estimateActivityMinutes(decision.activityType);
    if (estimatedMinutes <= remaining) {
      const executionReason: ExecutionReason = deferred.length === 0 ? 'FITS_IN_ORDER' : 'FILLS_REMAINING_TIME';
      items.push({ decision, sequence: sequence++, estimatedMinutes, executionReason });
      remaining -= estimatedMinutes;
    } else {
      deferred.push({ decision, reason: 'INSUFFICIENT_TIME' });
    }
  }

  return {
    studentId,
    generatedAt: now.toISOString(),
    availableMinutes,
    plannedMinutes: availableMinutes - remaining,
    items,
    deferred,
  };
}

/** The single next executable item, or null with nothing planned. NBA v3's sole source of "what's next" -- no independent scoring. */
export function selectExecutableNextAction(plan: DailyLearningPlan): LearningPlanItem | null {
  return plan.items[0] ?? null;
}
