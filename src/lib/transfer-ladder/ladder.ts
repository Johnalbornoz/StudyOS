/**
 * APPLY -- the adaptive transfer ladder (transfer-ladder-v1). PURE: no DB, no AI, no clock.
 *
 * Product rule (operator, overnight 2026-10-16; contract
 * docs/orchestration/OVERNIGHT_2026-10-16_CONTRACTS.md section 1.2):
 *   - APPLY measures transfer into different contexts. It is not another practice.
 *   - The attempt holds 3..5 challenges and starts at NEAR.
 *   - A passed challenge moves up one level (NEAR -> MID -> FAR). A failed one stays at the same
 *     level; the next challenge is a DIFFERENT contextual challenge (enforced by the service). The
 *     level never goes down.
 *   - A challenge passes at scorePercent >= 80 (no 70% gate, no overall mean).
 *   - The attempt closes early when competence is demonstrated (a FAR challenge passed), and always
 *     at 5 challenges. It never closes before 3 challenges.
 *   - Only a challenge whose distance was CERTIFIED by the existing novelty/distance validation
 *     (certifyStructuredTransferNovelty -> validateTransferDistanceNovelty) counts toward the level
 *     reached. An uncertified pass is recorded as passed but never raises the level and never
 *     counts as the level reached. NEAR/MID/FAR metadata is never fabricated here: the level of a
 *     challenge is the level it was generated and certified at.
 *   - highestLevelReached = the highest level with a passed AND certified challenge (or null).
 *     NEAR / null -> APPLY in process (no rollback); MID -> consolidated (MEDIUM); FAR -> HIGH.
 */

export type TransferLadderLevel = 'NEAR' | 'MID' | 'FAR';

export const TRANSFER_LADDER_VERSION = 'transfer-ladder-v1' as const;

export const TRANSFER_LADDER_POLICY = {
  version: TRANSFER_LADDER_VERSION,
  startLevel: 'NEAR' as TransferLadderLevel,
  minChallenges: 3,
  maxChallenges: 5,
  /** Inclusive: a challenge passes at scorePercent >= 80. */
  passScorePercent: 80,
} as const;

const LEVEL_ORDER: readonly TransferLadderLevel[] = ['NEAR', 'MID', 'FAR'];

export function levelRank(level: TransferLadderLevel): number {
  return LEVEL_ORDER.indexOf(level);
}

/** One graded challenge, exactly the shape the evidence contract (section 1.2) carries. */
export interface TransferLadderChallenge {
  level: TransferLadderLevel;
  scorePercent: number;
  passed: boolean;
  certified: boolean;
  taskId: string;
  contextDomain: string | null;
}

export type TransferLadderCloseReason = 'FAR_DEMONSTRATED' | 'MAX_CHALLENGES';

export interface TransferLadderState {
  challenges: TransferLadderChallenge[];
  /** The level the NEXT challenge must be generated at (meaningless once closed). */
  currentLevel: TransferLadderLevel;
  closed: boolean;
  closeReason: TransferLadderCloseReason | null;
}

export type TransferLadderCompetency = 'LOW' | 'MEDIUM' | 'HIGH';

export interface TransferLadderEvidencePayload {
  version: typeof TRANSFER_LADDER_VERSION;
  challenges: TransferLadderChallenge[];
  highestLevelReached: TransferLadderLevel | null;
}

/** The ONE pass rule: >= 80 inclusive. A non-finite score never passes. */
export function isTransferChallengePassed(scorePercent: number): boolean {
  return Number.isFinite(scorePercent) && scorePercent >= TRANSFER_LADDER_POLICY.passScorePercent;
}

/** Normalizes a grader score (0..1) to a whole percentage 0..100. */
export function toScorePercent(score01: number): number {
  if (!Number.isFinite(score01)) return 0;
  return Math.max(0, Math.min(100, Math.round(score01 * 100)));
}

function nextLevelUp(level: TransferLadderLevel): TransferLadderLevel {
  const i = levelRank(level);
  return LEVEL_ORDER[Math.min(i + 1, LEVEL_ORDER.length - 1)];
}

/** Highest level with a passed AND certified challenge, or null. Never derived from an uncertified pass. */
export function highestLevelReached(challenges: readonly TransferLadderChallenge[]): TransferLadderLevel | null {
  let best: TransferLadderLevel | null = null;
  for (const c of challenges) {
    if (!(c.passed && c.certified)) continue;
    if (best === null || levelRank(c.level) > levelRank(best)) best = c.level;
  }
  return best;
}

export function initialTransferLadderState(): TransferLadderState {
  return { challenges: [], currentLevel: TRANSFER_LADDER_POLICY.startLevel, closed: false, closeReason: null };
}

/**
 * Replays the graded challenges in order into the ladder state. Deterministic: the state is a
 * function of the challenge list alone. Each challenge must have been generated at the level the
 * ladder required at that point (the service guarantees it; a mismatch throws -- it would mean a
 * level was fabricated or skipped).
 */
export function replayTransferLadder(challenges: readonly TransferLadderChallenge[]): TransferLadderState {
  let state = initialTransferLadderState();
  for (const c of challenges) state = applyTransferLadderChallenge(state, c);
  return state;
}

/**
 * Applies ONE graded challenge.
 *   - passed (>= 80) AND certified -> next level (FAR stays FAR);
 *   - otherwise (failed, or an uncertified pass) -> same level;
 *   - the level never goes down;
 *   - closes at a certified FAR pass (only once >= 3 challenges) or at 5 challenges.
 */
export function applyTransferLadderChallenge(state: TransferLadderState, challenge: TransferLadderChallenge): TransferLadderState {
  if (state.closed) throw new Error('TRANSFER_LADDER_ALREADY_CLOSED');
  if (challenge.level !== state.currentLevel) {
    throw new Error(`TRANSFER_LADDER_LEVEL_MISMATCH: expected ${state.currentLevel}, got ${challenge.level}`);
  }
  if (challenge.passed !== isTransferChallengePassed(challenge.scorePercent)) {
    throw new Error('TRANSFER_LADDER_PASS_FLAG_INCONSISTENT');
  }
  const challenges = [...state.challenges, challenge];
  const raises = challenge.passed && challenge.certified;
  const nextLevel = raises ? nextLevelUp(state.currentLevel) : state.currentLevel;
  const count = challenges.length;

  let closeReason: TransferLadderCloseReason | null = null;
  const farDemonstrated = challenge.level === 'FAR' && raises;
  if (farDemonstrated && count >= TRANSFER_LADDER_POLICY.minChallenges) closeReason = 'FAR_DEMONSTRATED';
  else if (count >= TRANSFER_LADDER_POLICY.maxChallenges) closeReason = 'MAX_CHALLENGES';

  return { challenges, currentLevel: nextLevel, closed: closeReason !== null, closeReason };
}

/** NEAR or nothing -> LOW (APPLY in process); MID -> MEDIUM; FAR -> HIGH. */
export function transferLadderCompetency(level: TransferLadderLevel | null): TransferLadderCompetency {
  if (level === 'FAR') return 'HIGH';
  if (level === 'MID') return 'MEDIUM';
  return 'LOW';
}

/** MID or FAR completes APPLY (engine rule, section 1.2). NEAR / null keeps APPLY in process. */
export function transferLadderCompletesApply(level: TransferLadderLevel | null): boolean {
  return level === 'MID' || level === 'FAR';
}

/** The exact `metadata.transferLadder` payload of the contract -- nothing more, nothing less. */
export function buildTransferLadderEvidence(challenges: readonly TransferLadderChallenge[]): TransferLadderEvidencePayload {
  return {
    version: TRANSFER_LADDER_VERSION,
    challenges: challenges.map((c) => ({
      level: c.level,
      scorePercent: c.scorePercent,
      passed: c.passed,
      certified: c.certified,
      taskId: c.taskId,
      contextDomain: c.contextDomain,
    })),
    highestLevelReached: highestLevelReached(challenges),
  };
}

export interface TransferLadderLevelPerformance {
  level: TransferLadderLevel;
  attempted: number;
  passed: number;
  certifiedPassed: number;
  bestScorePercent: number | null;
}

/** Per-level summary for the final screen. */
export function transferLadderPerformanceByLevel(challenges: readonly TransferLadderChallenge[]): TransferLadderLevelPerformance[] {
  return LEVEL_ORDER.map((level) => {
    const at = challenges.filter((c) => c.level === level);
    return {
      level,
      attempted: at.length,
      passed: at.filter((c) => c.passed).length,
      certifiedPassed: at.filter((c) => c.passed && c.certified).length,
      bestScorePercent: at.length > 0 ? Math.max(...at.map((c) => c.scorePercent)) : null,
    };
  });
}

/** Normalized context key used to enforce "a different context" within one attempt. */
export function normalizeContextKey(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const k = value.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return k.length > 0 ? k : null;
}

/**
 * True when `candidate` reuses a context (domain or scenario label) already used in this attempt.
 * Compares the domain when both have one; always compares the scenario label.
 */
export function isRepeatedContext(
  candidate: { contextDomain: string | null; context: string },
  previous: ReadonlyArray<{ contextDomain: string | null; context: string }>,
): boolean {
  const d = normalizeContextKey(candidate.contextDomain);
  const l = normalizeContextKey(candidate.context);
  return previous.some((p) => {
    const pd = normalizeContextKey(p.contextDomain);
    const pl = normalizeContextKey(p.context);
    return (d !== null && pd !== null && d === pd) || (l !== null && pl !== null && l === pl);
  });
}
