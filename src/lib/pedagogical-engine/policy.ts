/**
 * CANON-R2 -- centralized Pedagogical Policy v1. Every numeric
 * pedagogical parameter used anywhere in this engine is read from this
 * ONE object -- never a scattered per-file constant, never a magic
 * number inline. Bump `POLICY_VERSION` on any parameter change; the
 * decision output always names the version that produced it (see
 * `CanonicalPedagogicalDecision.policyVersion`).
 */

/** 2026-10-17 pilot pass policy (operator: PASS_THRESHOLD = 80_PERCENT_INCLUSIVE everywhere; Learn check 5; Practice 3/3 rolling; Retain 5). */
export const POLICY_VERSION = 'studyus-canonical-v2-pilot-2026-10-17' as const;

export interface DifficultyRange {
  min: number;
  max: number;
}

export const CANONICAL_POLICY = {
  version: POLICY_VERSION,
  learn: {
    difficulty: { min: 1, max: 2 } as DifficultyRange,
    /**
     * LEARN is a comprehension checkpoint (a passed LEARN check), never mere activity existence or a "complete" click.
     * 2026-10-17 pilot policy (supersedes CANON-R2R1 Part 5's EXCLUSIVE bar): PASS_THRESHOLD = 80% INCLUSIVE
     * (80.0% passes). The check has a fixed size of 5 questions (operator decision 2026-10-17; it was ungoverned).
     */
    minimumScorePercent: 80,
    itemCount: 5,
  },
  practice: {
    minItems: 2,
    maxItems: 3,
    /**
     * Pilot policy (overnight decision 2026-10-16, supersedes "each of the last 3 >= 80"): the decision window is the
     * LAST 3 completed valid practices; READY_TO_PROVE needs their AVERAGE >= 80% AND the LATEST practice >= 80%.
     * The other two need not pass individually. Never from fewer than 3 practices (rolling window).
     */
    windowSize: 3,
    minimumWindowAveragePercent: 80,
    latestMustPass: true,
    difficulty: { min: 2, max: 4 } as DifficultyRange,
    minimumScorePercent: 80,
    independenceRequired: false,
  },
  prove: {
    /** Fixed independent certification: exactly 10 valid questions; never shrunk. */
    itemCount: 10,
    /**
     * 2026-10-17 pilot policy: a PROVE attempt below 80% keeps the learner in PROVE with an immediate retry (no
     * rollback to PRACTICE); once PROVE has passed, a later optional attempt never undoes it.
     */
    failureStaysInProve: true,
    difficulty: { min: 3, max: 4 } as DifficultyRange,
    minimumScorePercent: 80,
    independenceRequired: true,
  },
  retention: {
    /** 2026-10-17 pilot policy: 5 questions (no newer governed count supersedes it). */
    itemCount: 5,
    minimumWaitDays: 3,
    difficulty: { min: 3, max: 4 } as DifficultyRange,
    minimumScorePercent: 80,
    independenceRequired: true,
    noveltyRequired: true,
  },
  transfer: {
    challengeCount: 3,
    depths: ['NEAR', 'CONTEXTUAL', 'HIGHER'] as const,
    difficulty: { min: 4, max: 5 } as DifficultyRange,
    minimumOverallScorePercent: 80,
    /**
     * CANON-R2R1 Part 1 -- FINAL product decision, superseding CANON-R2's
     * implementation-created 50% floor. Every one of the 3 challenges
     * must independently score >=70%; no challenge may be compensated
     * below 70% by stronger performance elsewhere, and the >=80% overall
     * average is checked independently and in addition to this
     * per-challenge floor -- neither check alone is sufficient.
     */
    perChallengeMinimumScorePercent: 70,
    independenceRequired: true,
  },
  reinforce: {
    difficulty: { min: 1, max: 3 } as DifficultyRange,
  },
} as const;

export type CanonicalPolicy = typeof CANONICAL_POLICY;
