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

export type FirstDestinationReason = 'ONBOARDING_NO_SUBJECT' | 'RESUME_TODAY' | 'RESUME_EXAM_PREPARATION';

export interface LearnerSetupState {
  /** true once the learner has created at least one subject (subjects are the unit every canonical engine consumes). */
  hasSubject: boolean;
  /**
   * Track B (objective first): true once the learner chose an exam goal. A
   * Student may start by "Quiero prepararme para un examen" without building a
   * subject first; that Student resumes in their exam preparation.
   */
  hasExamGoal?: boolean;
}

export interface FirstDestination {
  path: string;
  reason: FirstDestinationReason;
}

export const ONBOARDING_PATH = '/dashboard/onboarding' as const;
export const START_PATH = '/dashboard/today' as const;
export const EXAM_PREPARATION_PATH = '/dashboard/exam-prep' as const;

export function resolveFirstDestination(state: LearnerSetupState): FirstDestination {
  if (!state.hasSubject) {
    if (state.hasExamGoal) return { path: EXAM_PREPARATION_PATH, reason: 'RESUME_EXAM_PREPARATION' };
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
  if (state.hasSubject) return START_PATH;
  return state.hasExamGoal ? EXAM_PREPARATION_PATH : null;
}
