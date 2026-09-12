import type { ActivityType } from '@/lib/activity-taxonomy';
import type { getMessages } from '@/lib/i18n/messages';

/**
 * LX-6 R6/R12-R15 -- "why this now," in learner language.
 *
 * A THIRD presentation-only mapping alongside activityLabel.ts (noun
 * badge, "Practice") and activityCta.ts (imperative CTA verb, "Practice").
 * This one is a short sentence explaining what kind of learning moment
 * this is and why it comes next -- e.g. "You've got the idea. Now put it
 * into practice." for PRACTICE, "No hints -- show you can do it on your
 * own." for SOLO_VERIFY (Prove).
 *
 * Exactly like its two siblings: pure `ActivityType -> string` lookup,
 * never a new taxonomy, never a threshold, never a heuristic, and never
 * a value the caller could derive any other way -- the caller must
 * already hold a real `ActivityType` from a canonical Phase 4
 * LearningDecision. This function does not choose the activity; it only
 * renders it.
 */
export function activityNarrative(activityType: ActivityType, t: ReturnType<typeof getMessages>): string {
  return t[`todayNarrative.${activityType}` as keyof typeof t];
}
