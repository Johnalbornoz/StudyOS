/**
 * LX-2C -- FIRST AUTHENTICATED DESTINATION.
 *
 * A pure, deterministic routing decision for where an authenticated
 * learner lands. It is NOT a learning-recommendation engine: it looks
 * only at whether the account has completed the minimum product setup
 * (a subject exists) and never at mastery / evidence / LearningState.
 *
 * Rules (deterministic, no loops -- the destinations below never
 * redirect an authenticated learner away again):
 *   - no subject yet            -> the onboarding / start experience
 *   - at least one subject       -> Today ("what should I do now")
 *
 * The learner is NEVER dropped straight onto the KPI-heavy Progress
 * page; Progress remains reachable from the learner shell.
 */

export type FirstDestinationReason = 'ONBOARDING_NO_SUBJECT' | 'RESUME_TODAY';

export interface LearnerSetupState {
  /** true once the learner has created at least one subject (subjects are the unit every canonical engine consumes). */
  hasSubject: boolean;
}

export interface FirstDestination {
  path: string;
  reason: FirstDestinationReason;
}

export const ONBOARDING_PATH = '/dashboard/onboarding' as const;
export const START_PATH = '/dashboard/today' as const;

export function resolveFirstDestination(state: LearnerSetupState): FirstDestination {
  if (!state.hasSubject) {
    return { path: ONBOARDING_PATH, reason: 'ONBOARDING_NO_SUBJECT' };
  }
  return { path: START_PATH, reason: 'RESUME_TODAY' };
}

/**
 * Guard for the onboarding route itself: a learner who already has a
 * subject should not be trapped there. Returns the path to bounce to,
 * or null to stay.
 */
export function onboardingRouteRedirect(state: LearnerSetupState): string | null {
  return state.hasSubject ? START_PATH : null;
}
