/**
 * LX-6 R2 -- THE CANONICAL TODAY CONTRACT.
 *
 * Today's job is narrow: present ONE server-authoritative "next best
 * learning action," not compute one. Every actual decision -- which
 * concept, which ActivityType, whether it's due, in what order relative
 * to other pending work -- is already made upstream:
 *
 *   Evidence -> Knowledge State -> Learning State -> Learning Decision
 *     (Phase 3C: adaptive-learning-orchestrator.service.ts /
 *      adaptive-learning-policy.ts's rankLearningDecisions)
 *   -> Execution fit (Phase 3D: learning-execution-policy.ts's
 *      buildDailyLearningPlan / selectExecutableNextAction -- "NBA v3's
 *      sole source of 'what's next', no independent scoring")
 *   -> ONE Learning OS snapshot per render
 *      (learning-os-snapshot.service.ts::getLearningOSSnapshot)
 *
 * This module adds NOTHING pedagogical on top of that snapshot. It only
 * names the four semantic states a presentation surface needs (R4) as an
 * explicit, testable enum instead of ad-hoc booleans, and separates a
 * genuine READ FAILURE (`UNRESOLVED`) from a genuine "nothing is due"
 * (`CONSOLIDATED`) -- a distinction the pre-LX-6 page conflated (a failed
 * snapshot fetch fell through the same `isEmpty` branch as a caught-up
 * student, and could additionally throw a second time on the cold-state
 * check with no failure handling of its own).
 *
 * `deriveTodayState` is pure: no DB, no fetch, no Date.now() -- every
 * input is a fact some other canonical authority already produced.
 */

export type TodayState =
  /** A canonical Learning Decision exists and fits today -- render the primary action. */
  | 'NEXT_ACTION_AVAILABLE'
  /** The snapshot read succeeded; the student genuinely has no decision pending right now. */
  | 'CONSOLIDATED'
  /** The snapshot read succeeded; there is no evidence yet to ground a recommendation (a new/cold profile). */
  | 'NO_ACTIVE_LEARNING_PATH'
  /** The canonical read itself failed -- StudyUS does not know what's next. Never invent a fallback action here. */
  | 'UNRESOLVED';

export interface TodayStateInputs {
  /** True only when reading the canonical snapshot (getLearningOSSnapshot) itself threw. */
  snapshotReadFailed: boolean;
  /**
   * Phase 3D's OWN "what's next" answer for this render
   * (`selectExecutableNextAction(dailyPlan) !== null`) -- never
   * re-derived from decisions.length here. A student can in principle
   * have pending Phase 3C decisions that still don't resolve to an
   * executable item (Phase 3D's own time-fit call); this module defers
   * to that answer rather than assuming decisionCount > 0 always means
   * "there is a primary action."
   */
  hasPrimaryAction: boolean;
  /** Step 6L-A's existing cold-profile check: has this student EVER recorded learning_evidence? Only consulted when there is no primary action. */
  isColdProfile: boolean;
}

/**
 * The one place Today's four semantic states are named. A read failure
 * is checked FIRST and unconditionally -- it is never downgraded to
 * "empty" or "cold" (those require canonical data that a failed read
 * never actually produced).
 */
export function deriveTodayState(inputs: TodayStateInputs): TodayState {
  if (inputs.snapshotReadFailed) return 'UNRESOLVED';
  if (inputs.hasPrimaryAction) return 'NEXT_ACTION_AVAILABLE';
  return inputs.isColdProfile ? 'NO_ACTIVE_LEARNING_PATH' : 'CONSOLIDATED';
}
