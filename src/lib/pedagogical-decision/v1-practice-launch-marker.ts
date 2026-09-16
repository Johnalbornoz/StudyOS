/**
 * CANON-R5R1/R5R1A -- v1 EVIDENCE PERSISTENCE & CANONICAL PRACTICE
 * CONTRACT ENFORCEMENT: the trusted, server-only authorization for a
 * Canonical-Engine-created Practice quiz session.
 *
 * TRUST MODEL (Part 1/2/14): a client's `v1Launch: true` request field
 * is never, by itself, sufficient to stamp a quiz session as v1, and it
 * is NEVER a source of pedagogical parameters. It is only a REQUEST to
 * attempt canonical authorization -- this function always independently
 * re-verifies by calling `getCanonicalPedagogicalDecision` FRESH for the
 * exact (studentId, conceptId) pair, and the returned authorization's
 * `itemCount`/`difficulty`/`assistanceAllowed` come EXCLUSIVELY from
 * that fresh decision's own `activityContract` -- never from
 * `validated.maxQuestions`/`validated.difficulty`/`validated.quizMode`
 * (CANON-R5R1A Part 0's own Primary Invariant: "Canonical stage
 * verification alone is insufficient" -- a client CANNOT widen the
 * contract, request a different mode, or otherwise influence what gets
 * generated once a session is authorized).
 *
 * A forged/stale/wrong claim (Part 15/16/17's own manual tests: a
 * client asks for maxQuestions=20/difficulty=5/quizMode=quick_check
 * while the true canonical state is PRACTICE with a 2-3/2-4 contract,
 * or the true state is PROVE/WAITING/BLOCKED) simply fails
 * re-verification (or is silently overridden -- see the caller,
 * `generate-and-take/route.ts`) -- the caller degrades to ordinary
 * legacy generation, never a thrown error, never a blocked generation.
 *
 * `resolveV1PracticeEligibility`/`resolveAuthorizedItemCount`
 * (canonical-session-launch.ts) are the SAME functions
 * `resolveCanonicalLaunch` (session start) uses -- every call site
 * agrees on "is this eligible" and "which item count" by construction,
 * never by coincidence (Part 19: single source, no duplicated 2/3/2-4
 * constants).
 */
import { V1_POLICY_VERSION } from '@/lib/pedagogical-migration';
import type { PedagogicalStage } from '@/lib/pedagogical-engine';
import { getCanonicalPedagogicalDecision, CanonicalDecisionUnavailableError } from './canonical-decision.service';
import { resolveV1PracticeEligibility, resolveAuthorizedItemCount } from './canonical-session-launch';

/**
 * CANON-R5R1A Part 18 -- the full trusted authorization: not just "this
 * concept is at canonical PRACTICE" (R5R1's `V1PracticeLaunchMarker`),
 * but the EXACT generation parameters the server must use, derived
 * directly from `decision.activityContract`.
 */
export interface V1PracticeLaunchMarker {
  pedagogicalPolicyVersion: typeof V1_POLICY_VERSION;
  canonicalRevision: string;
  canonicalStage: PedagogicalStage;
  canonicalActivityType: 'PRACTICE' | 'REINFORCE';
  /** Directly from `activityContract.itemCount` -- `max` is the deterministic single value the server requests from the generator (resolveAuthorizedItemCount). */
  itemCount: { min: number; max: number; authorized: number };
  /** Directly from `activityContract.difficulty` -- `target` is the value the server sends to the generator; `min`/`max` bound what an ACTUAL administered attempt may fall within (Part 10/12). */
  difficulty: { min: number; max: number; target: number };
  /** `!activityContract.independence` -- Practice allows AI assistance (hints/Tutor); this is a pass-through of the engine's own `supportLevel`/`independence` fields, never a new AI behavior. */
  assistanceAllowed: boolean;
}

/**
 * Returns a trusted authorization only when a FRESH canonical decision,
 * computed right now, confirms this (studentId, conceptId) pair is
 * genuinely an EXECUTABLE v1 Practice/Reinforce activity with a real
 * `activityContract`. Returns `null` for every other case -- including
 * a transient read failure or a decision with no contract, which
 * degrades to "not v1" rather than blocking or failing the generation
 * request (a v1-ineligible request is handled by the existing,
 * unmodified legacy generation path exactly as before this phase).
 */
export async function verifyV1PracticeLaunchMarker(params: {
  studentId: string;
  conceptId: string;
}): Promise<V1PracticeLaunchMarker | null> {
  let decision;
  try {
    ({ decision } = await getCanonicalPedagogicalDecision(params));
  } catch (error) {
    if (error instanceof CanonicalDecisionUnavailableError) return null;
    throw error;
  }

  const eligibility = resolveV1PracticeEligibility(decision);
  if (!eligibility.eligible) return null;

  const contract = decision.activityContract;
  if (!contract || !contract.itemCount) {
    // EXECUTABLE PRACTICE/REINFORCE with no item-count contract should
    // not occur (buildActivityContract always sets one for these two
    // cases) -- fail closed rather than authorizing an uncontracted
    // activity (Part 0's Primary Invariant).
    return null;
  }

  const authorizedItemCount = resolveAuthorizedItemCount(contract.itemCount);
  if (authorizedItemCount == null) return null;

  return {
    pedagogicalPolicyVersion: V1_POLICY_VERSION,
    canonicalRevision: decision.canonicalRevision,
    canonicalStage: decision.stage,
    canonicalActivityType: eligibility.activityType,
    itemCount: { min: contract.itemCount.min, max: contract.itemCount.max, authorized: authorizedItemCount },
    difficulty: { min: contract.difficulty.min, max: contract.difficulty.max, target: contract.difficulty.target },
    assistanceAllowed: !contract.independence,
  };
}

/** CANON-R5R1A Part 11 -- the ONE closed reason code for "the actually administered activity didn't match its own authorized contract." */
export const V1_ACTIVITY_CONTRACT_VIOLATION = 'V1_ACTIVITY_CONTRACT_VIOLATION' as const;

export interface V1ContractComplianceResult {
  compliant: boolean;
  reason: typeof V1_ACTIVITY_CONTRACT_VIOLATION | null;
  detail?: string;
}

/**
 * CANON-R5R1A Part 10 -- verifies the ACTUAL administered activity
 * (real item count, real aggregate difficulty) against the authorization
 * that was persisted at generation time. Pure, no IO. Never clamps,
 * never fabricates -- a violation is reported, not silently corrected.
 */
export function checkV1ActivityContractCompliance(params: {
  authorization: Pick<V1PracticeLaunchMarker, 'itemCount' | 'difficulty'>;
  actualItemCount: number;
  actualDifficulty: number;
}): V1ContractComplianceResult {
  const { authorization, actualItemCount, actualDifficulty } = params;
  if (actualItemCount < authorization.itemCount.min || actualItemCount > authorization.itemCount.max) {
    return {
      compliant: false,
      reason: V1_ACTIVITY_CONTRACT_VIOLATION,
      detail: `actual itemCount ${actualItemCount} is outside the authorized range [${authorization.itemCount.min}, ${authorization.itemCount.max}]`,
    };
  }
  if (actualDifficulty < authorization.difficulty.min || actualDifficulty > authorization.difficulty.max) {
    return {
      compliant: false,
      reason: V1_ACTIVITY_CONTRACT_VIOLATION,
      detail: `actual difficulty ${actualDifficulty} is outside the authorized range [${authorization.difficulty.min}, ${authorization.difficulty.max}]`,
    };
  }
  return { compliant: true, reason: null };
}
