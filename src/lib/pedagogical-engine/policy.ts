/**
 * CANON-R2 -- centralized Pedagogical Policy v1. Every numeric
 * pedagogical parameter used anywhere in this engine is read from this
 * ONE object -- never a scattered per-file constant, never a magic
 * number inline. Bump `POLICY_VERSION` on any parameter change; the
 * decision output always names the version that produced it (see
 * `CanonicalPedagogicalDecision.policyVersion`).
 */

export const POLICY_VERSION = 'studyus-canonical-v1' as const;

export interface DifficultyRange {
  min: number;
  max: number;
}

export const CANONICAL_POLICY = {
  version: POLICY_VERSION,
  learn: {
    difficulty: { min: 1, max: 2 } as DifficultyRange,
    /**
     * CANON-R2R1: LEARN is a comprehension checkpoint (a passed LEARN
     * check quiz), never mere activity existence. The bar is EXCLUSIVE
     * -- exactly 80% still fails, only a score strictly greater than 80
     * qualifies (product decision, CANON-R2R1 Part 5). Named
     * `...Exclusive` rather than reusing `minimumScorePercent` so the
     * comparison operator (`>`, never `>=`) is never ambiguous at a call
     * site.
     */
    minimumScorePercentExclusive: 80,
  },
  practice: {
    minItems: 2,
    maxItems: 3,
    difficulty: { min: 2, max: 4 } as DifficultyRange,
    minimumScorePercent: 80,
    independenceRequired: false,
  },
  prove: {
    itemCount: 10,
    difficulty: { min: 3, max: 4 } as DifficultyRange,
    minimumScorePercent: 80,
    independenceRequired: true,
  },
  retention: {
    itemCount: 10,
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
