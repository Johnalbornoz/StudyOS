/**
 * Phase 3B: Assessment Profiles.
 *
 * Cumulative Assessment and Mock Exam both run in Evidence Mode
 * ASSESSMENT, but they answer different questions -- "how solid is
 * accumulated knowledge?" vs. "how ready is the student to perform
 * under real exam conditions?" -- and that difference has to show up
 * as distinct, explicit configuration, not just a different guidance
 * string on the same shapeless object. This is that configuration:
 * typed, centralized, and never a place to sneak in a mastery
 * threshold -- mastery thresholds belong exclusively to Phase 2.2's
 * mastery_policies, this file never reads or writes them.
 */

import type { ActivityType } from './activity-taxonomy';

export type VerificationStrictness = 'ADAPTIVE' | 'SELECTIVE';

export interface AssessmentProfile {
  activityType: 'CUMULATIVE_ASSESSMENT' | 'MOCK_EXAM';
  /** ADAPTIVE: verification triggers whenever confidence is below threshold, on every ambiguous concept. SELECTIVE: only the trigger engine's own deterministic rules apply, no extra profile-driven floor. */
  verificationStrictness: VerificationStrictness;
  /** Below this raw grading confidence (0-1), a single answer is treated as weak evidence regardless of correctness. */
  minimumGradingConfidence: number;
  /** Whether this profile expects question variants to be used (still falls back to the original question if variant generation fails). */
  questionVariants: boolean;
  /** Whether this profile requires a real timer in the UI. Purely a config flag here -- Phase 3B does not implement the timer itself. */
  timed: boolean;
  /** Whether this profile follows a real exam's structure (sections/distribution) rather than a flat question list. */
  examStructure: boolean;
  randomizeQuestions: boolean;
  /** Assessment Confidence (0-100) bands this profile treats as low/high, purely for surfacing "why am I being asked this" and evidence-strength labeling -- never a mastery threshold. */
  assessmentConfidenceThresholds: { low: number; high: number };
  /** Only Mock Exam compares actual performance against predicted Exam Readiness -- Cumulative Assessment has no "exam" to be ready for. */
  examReadinessComparison: boolean;
}

export const ASSESSMENT_PROFILES: Record<'CUMULATIVE_ASSESSMENT' | 'MOCK_EXAM', AssessmentProfile> = {
  CUMULATIVE_ASSESSMENT: {
    activityType: 'CUMULATIVE_ASSESSMENT',
    verificationStrictness: 'ADAPTIVE',
    minimumGradingConfidence: 0.6,
    questionVariants: true,
    timed: false,
    examStructure: false,
    randomizeQuestions: true,
    assessmentConfidenceThresholds: { low: 55, high: 80 },
    examReadinessComparison: false,
  },
  MOCK_EXAM: {
    activityType: 'MOCK_EXAM',
    verificationStrictness: 'SELECTIVE',
    minimumGradingConfidence: 0.6,
    questionVariants: true,
    timed: true,
    examStructure: true,
    randomizeQuestions: true,
    assessmentConfidenceThresholds: { low: 55, high: 80 },
    examReadinessComparison: true,
  },
};

/** Returns null for any Activity Type that isn't a profiled Assessment activity (e.g. PRACTICE, SOLO_CHECK) -- those never consult a profile at all. */
export function getAssessmentProfile(activityType: ActivityType): AssessmentProfile | null {
  if (activityType === 'CUMULATIVE_ASSESSMENT' || activityType === 'MOCK_EXAM') {
    return ASSESSMENT_PROFILES[activityType];
  }
  return null;
}
