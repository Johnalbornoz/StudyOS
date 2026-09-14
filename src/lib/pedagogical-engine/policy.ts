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
    /** Below this on any single challenge, the challenge counts as a complete failure regardless of the overall average (documented policy decision -- CANON-R2 report §TRANSFER, the spec's own 100/100/20 example). */
    perChallengeFailureFloor: 50,
    independenceRequired: true,
  },
  reinforce: {
    difficulty: { min: 1, max: 3 } as DifficultyRange,
  },
} as const;

export type CanonicalPolicy = typeof CANONICAL_POLICY;
