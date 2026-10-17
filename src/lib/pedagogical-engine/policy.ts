/**
 * CANON-R2 -- centralized Pedagogical Policy v1. Every numeric
 * pedagogical parameter used anywhere in this engine is read from this
 * ONE object -- never a scattered per-file constant, never a magic
 * number inline. Bump `POLICY_VERSION` on any parameter change; the
 * decision output always names the version that produced it (see
 * `CanonicalPedagogicalDecision.policyVersion`).
 */

/**
 * Overnight pilot convergence 2026-10-16 (docs/orchestration/OVERNIGHT_2026-10-16_CONTRACTS.md sections 0 and 1):
 * LEARN is a guided 4-7 interaction session with no score gate; Practice = last 3 average >= 80 AND latest >= 80;
 * APPLY (TRANSFER) is an adaptive NEAR/MID/FAR ladder of 3-5 challenges, each passing at >= 80, consolidating at MID;
 * internal assessments (subject Test / Mock) can revalidate a concept back to PRACTICE. Supersedes
 * 'studyus-canonical-v2-pilot-2026-10-17' (Learn check 5 at >= 80; Transfer 3 challenges, 80 overall, 70 each).
 */
export const POLICY_VERSION = 'studyus-canonical-v3-pilot-2026-10-16' as const;

/** The APPLY ladder levels, in ascending order (index order IS the precedence). */
export type TransferLevel = 'NEAR' | 'MID' | 'FAR';

export interface DifficultyRange {
  min: number;
  max: number;
}

export const CANONICAL_POLICY = {
  version: POLICY_VERSION,
  learn: {
    difficulty: { min: 1, max: 2 } as DifficultyRange,
    /**
     * Contract 1.1: LEARN is a GUIDED understanding session of 4 to 7 interactions, closed by the AI once it judges
     * understanding (at 4 or more) or by the cap (exactly 7). There is NO score gate: the score/itemCount gate of the
     * 2026-10-17 policy (5 questions, >= 80%) is removed. A legacy LEARN_CHECK quiz qualifies when it was completed
     * with at least `minInteractions` items, whatever its score.
     */
    minInteractions: 4,
    maxInteractions: 7,
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
    difficulty: { min: 4, max: 5 } as DifficultyRange,
    /**
     * Contract 1.2: APPLY is an adaptive ladder of 3 to 5 challenges over the levels NEAR -> MID -> FAR. A challenge
     * passes at scorePercent >= 80 (there is no 70% floor and no overall mean any more). APPLY completes when the
     * highest passed AND certified level is at least MID (MID -> consolidation MEDIUM, FAR -> HIGH). Reaching only
     * NEAR never rolls anything back: the concept stays in TRANSFER and APPLY may be repeated.
     */
    minChallenges: 3,
    maxChallenges: 5,
    perChallengePassPercent: 80,
    levels: ['NEAR', 'MID', 'FAR'] as readonly TransferLevel[],
    consolidatedMinimumLevel: 'MID' as TransferLevel,
    independenceRequired: true,
  },
  /**
   * Contract 1.3: internal assessments (subject Test = CUMULATIVE_ASSESSMENT, subject Mock = MOCK_EXAM, any origin)
   * revalidate a concept that is past PRACTICE. Per (session, concept) score: < 60 revalidates to PRACTICE at once;
   * 60-79 is an alert (2 consecutive alerts revalidate); >= 80 resets the alert counter. Never satisfies a stage.
   */
  internalAssessment: {
    strongContradictionBelow: 60,
    alertBelow: 80,
    consecutiveAlertsForRevalidation: 2,
  },
  reinforce: {
    difficulty: { min: 1, max: 3 } as DifficultyRange,
  },
} as const;

export type CanonicalPolicy = typeof CANONICAL_POLICY;
