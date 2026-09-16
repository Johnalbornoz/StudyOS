/**
 * CANON-R5R1/R5R1A/R6 -- v1 EVIDENCE PERSISTENCE & CANONICAL
 * PRACTICE/PROVE CONTRACT ENFORCEMENT: the trusted, server-only
 * authorization for a Canonical-Engine-created Practice or (as of
 * CANON-R6) Prove quiz session.
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
import type { PedagogicalStage, PedagogicalActivityType } from '@/lib/pedagogical-engine';
import { getCanonicalPedagogicalDecision, CanonicalDecisionUnavailableError } from './canonical-decision.service';
import { resolveV1PracticeEligibility, resolveAuthorizedItemCount } from './canonical-session-launch';

/**
 * CANON-R5R1A/R6 Part 18 -- the full trusted authorization: not just
 * "this concept is at canonical PRACTICE/PROVE" (R5R1's original
 * `V1PracticeLaunchMarker`), but the EXACT generation parameters the
 * server must use, derived directly from `decision.activityContract`.
 *
 * CANON-R6 Part 12: widened, IN PLACE (name kept -- "generalize
 * carefully... do not over-generalize"), to also cover PROVE alongside
 * PRACTICE/REINFORCE. Every existing R5R1/R5R1A field
 * (`assistanceAllowed`, `itemCount`, `difficulty`) is unchanged; three
 * fields are newly added (`independence`, `supportLevel`,
 * `minimumScorePercent`), all additive and all pass-throughs of the
 * SAME `activityContract` fields already on the engine's own frozen
 * output -- Practice's own values (`independence: false, supportLevel:
 * 'ASSISTED', minimumScorePercent: 80`) are unchanged from before this
 * phase, verified by the full pre-existing R5R1A test suite passing
 * unmodified.
 */
export interface V1PracticeLaunchMarker {
  pedagogicalPolicyVersion: typeof V1_POLICY_VERSION;
  canonicalRevision: string;
  canonicalStage: PedagogicalStage;
  canonicalActivityType: PedagogicalActivityType | 'REINFORCE';
  /**
   * Directly from `activityContract.itemCount` -- `max` is the
   * deterministic single value the server requests from the generator
   * (resolveAuthorizedItemCount). `null` ONLY for LEARN_CHECK
   * (CANON-V2-ARCH-CLEANUP): the Pedagogical Engine v1 deliberately
   * reports no canonical item-count authority for the comprehension
   * checkpoint (evidence-sufficiency-contract.ts's own `EvidencePurpose
   * 'LEARN'` case) -- a caller sees this as "no canonical override,
   * fall back to the execution default," never as an uncontracted
   * activity to reject.
   */
  itemCount: { min: number; max: number; authorized: number } | null;
  /** Directly from `activityContract.difficulty` -- `target` is the value the server sends to the generator; `min`/`max` bound what an ACTUAL administered attempt may fall within (Part 10/12). */
  difficulty: { min: number; max: number; target: number };
  /** `!activityContract.independence` -- Practice allows AI assistance (hints/Tutor); this is a pass-through of the engine's own `supportLevel`/`independence` fields, never a new AI behavior. */
  assistanceAllowed: boolean;
  /** CANON-R6 -- `activityContract.independence` verbatim (the engine's own field; `assistanceAllowed` above is its negation, kept for R5R1A backward compatibility). `true` for PROVE, `false` for PRACTICE/REINFORCE. */
  independence: boolean;
  /** CANON-R6 -- `activityContract.supportLevel` verbatim ('ASSISTED' for Practice/Reinforce, 'NONE' for Prove). */
  supportLevel: 'ASSISTED' | 'NONE';
  /** CANON-R6 -- `activityContract.minimumScorePercent` verbatim (80 for both Practice and Prove today). */
  minimumScorePercent: number;
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
  if (!contract) {
    // EXECUTABLE with no activityContract at all should not occur --
    // fail closed rather than authorizing an uncontracted activity
    // (Part 0's Primary Invariant).
    return null;
  }

  // CANON-V2-ARCH-CLEANUP -- `contract.itemCount === null` is the
  // EXPECTED, deliberate shape for LEARN_CHECK (Section 2/8.A: "no
  // canonical item-count authority exists for the comprehension
  // check"), never a defect to fail closed on. Every OTHER reachable
  // activity type's contract always carries a real itemCount
  // (buildActivityContract's own invariant) -- for those, a `null`
  // here really would mean "uncontracted," so this still fails closed
  // exactly as before for everything except LEARN_CHECK.
  let authorizedItemCount: number | null = null;
  if (contract.itemCount) {
    authorizedItemCount = resolveAuthorizedItemCount(contract.itemCount);
    if (authorizedItemCount == null) return null;
  } else if (eligibility.activityType !== 'LEARN_CHECK') {
    return null;
  }

  return {
    pedagogicalPolicyVersion: V1_POLICY_VERSION,
    canonicalRevision: decision.canonicalRevision,
    canonicalStage: decision.stage,
    canonicalActivityType: eligibility.activityType,
    itemCount: contract.itemCount && authorizedItemCount != null ? { min: contract.itemCount.min, max: contract.itemCount.max, authorized: authorizedItemCount } : null,
    difficulty: { min: contract.difficulty.min, max: contract.difficulty.max, target: contract.difficulty.target },
    assistanceAllowed: !contract.independence,
    independence: contract.independence,
    supportLevel: contract.supportLevel,
    // `ActivityContract.minimumScorePercent` is `number | null` only for
    // CONSOLIDATED (never reaches here -- CONSOLIDATED's actionState is
    // never 'EXECUTABLE', already filtered above) -- every other
    // reachable canonical activity type, LEARN_CHECK included, always
    // carries a real value. 80 is a defensive fallback only, never a
    // value this code path can actually need in practice.
    minimumScorePercent: contract.minimumScorePercent ?? 80,
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
 * CANON-R5R1A/R6 Part 10/13 -- verifies the ACTUAL administered activity
 * against the authorization that was persisted at generation time. Pure,
 * no IO. Never clamps, never fabricates -- a violation is reported, not
 * silently corrected.
 *
 * CANON-R6: `actualHintsUsed`/`actualAiAssistanceType` are additive,
 * optional inputs -- checked ONLY when `authorization.independence` is
 * true (PROVE) AND the caller actually supplies them. Practice's own
 * authorization always has `independence: false`, so this new check is
 * unconditionally skipped for every Practice call, exactly preserving
 * R5R1A's original two-check (item count, difficulty) behavior.
 *
 * CANON-V2-ARCH-CLEANUP -- `authorization.itemCount === null`
 * (LEARN_CHECK only) skips the item-count range check entirely: there
 * is no canonical item-count contract to violate for an activity whose
 * own authority deliberately reports none.
 */
export function checkV1ActivityContractCompliance(params: {
  authorization: Pick<V1PracticeLaunchMarker, 'itemCount' | 'difficulty' | 'independence'>;
  actualItemCount: number;
  actualDifficulty: number;
  actualHintsUsed?: number;
  actualAiAssistanceType?: string;
}): V1ContractComplianceResult {
  const { authorization, actualItemCount, actualDifficulty, actualHintsUsed, actualAiAssistanceType } = params;
  if (authorization.itemCount && (actualItemCount < authorization.itemCount.min || actualItemCount > authorization.itemCount.max)) {
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
  if (authorization.independence) {
    if (actualHintsUsed !== undefined && actualHintsUsed > 0) {
      return {
        compliant: false,
        reason: V1_ACTIVITY_CONTRACT_VIOLATION,
        detail: `an independent (no-assistance) contract requires hintsUsed === 0; actual was ${actualHintsUsed}`,
      };
    }
    if (actualAiAssistanceType !== undefined && actualAiAssistanceType !== 'NONE') {
      return {
        compliant: false,
        reason: V1_ACTIVITY_CONTRACT_VIOLATION,
        detail: `an independent (no-assistance) contract requires aiAssistanceType === 'NONE'; actual was ${actualAiAssistanceType}`,
      };
    }
  }
  return { compliant: true, reason: null };
}
