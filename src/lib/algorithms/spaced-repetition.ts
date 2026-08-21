/**
 * Spaced repetition: how long a concept can go without review before
 * it's at risk of being forgotten.
 *
 * The interval scales with mastery and confidence -- a concept just
 * barely past the "solid" threshold needs review again soon; a concept
 * mastered to 95%+ with high confidence can go much longer. This is the
 * standard spaced-repetition principle: well-known material is
 * reviewed less often, not on a fixed schedule.
 *
 * forgetting_risk is deliberately NOT a stored value anywhere -- it
 * decays continuously with time, so a value written today is wrong
 * tomorrow. It's always computed from (days since last practice) vs.
 * the interval that was used to set next_review_date.
 */

const MIN_INTERVAL_DAYS = 2;
const MAX_INTERVAL_DAYS = 45;

/** Days before a concept at this mastery/confidence should be reviewed again. */
export function calculateReviewIntervalDays(masteryScore: number, confidenceScore: number): number {
  const masteryFactor = Math.max(0, Math.min(1, masteryScore / 100));
  const confidenceFactor = Math.max(0.5, Math.min(1, confidenceScore / 100));
  const interval =
    MIN_INTERVAL_DAYS +
    (MAX_INTERVAL_DAYS - MIN_INTERVAL_DAYS) * Math.pow(masteryFactor, 1.5) * confidenceFactor;
  return Math.round(interval);
}

/** The next date a concept is due for review, given a practice event today. */
export function calculateNextReviewDate(
  masteryScore: number,
  confidenceScore: number,
  fromDate: Date = new Date()
): string {
  const days = calculateReviewIntervalDays(masteryScore, confidenceScore);
  const next = new Date(fromDate);
  next.setDate(next.getDate() + days);
  return next.toISOString().slice(0, 10);
}

/**
 * Forgetting risk (0-100): how much retention has likely decayed since
 * last practice, relative to the review interval that was set at that
 * time. 0 = just reviewed. ~50 right at the scheduled review date.
 * Asymptotic toward 100 well past it (Ebbinghaus-style decay curve).
 */
export function calculateForgettingRisk(daysSincePractice: number, reviewIntervalDays: number): number {
  if (daysSincePractice <= 0) return 0;
  const ratio = daysSincePractice / Math.max(1, reviewIntervalDays);
  const risk = 100 * (1 - Math.exp(-0.7 * ratio));
  return Math.round(Math.max(0, Math.min(100, risk)));
}
