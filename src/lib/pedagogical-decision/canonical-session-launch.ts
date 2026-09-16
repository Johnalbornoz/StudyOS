/**
 * CANON-R5 Parts 12-19 -- resolves ONE fresh `CanonicalPedagogicalDecision`
 * into an executable (or explicitly refused) launch, for
 * `/api/learning/session/start` to consume when the feature gate is on.
 *
 * This is the session-start enforcement boundary itself (Part 12: "the
 * most important integration"):
 *   - `actionState !== 'EXECUTABLE'` (WAITING/LOCKED/CONSOLIDATED/BLOCKED)
 *     NEVER reaches generation -- Part 13's own example (Retention
 *     WAITING -> zero AI generation) generalizes to every non-EXECUTABLE
 *     state here, not just Retention.
 *   - An EXECUTABLE decision whose `activityContract` the existing
 *     generation route cannot yet honor (Retention exact-10, Transfer's
 *     3-challenge structure, LEARN_CHECK) is refused with a controlled
 *     `NOT_READY` result and a closed reason code -- NEVER silently
 *     routed through the nearest legacy quiz_mode (Part 18: "Do not
 *     silently fall back to legacy Transfer" -- generalized to every
 *     stage this phase found unready, per `activity-launch-readiness.ts`'s
 *     own grounding).
 *   - PRACTICE, its REINFORCE overlay, and (as of CANON-R6) PROVE all
 *     reach a real `READY` launch -- into the EXISTING, unmodified
 *     `/dashboard/quiz` flow, with `maxQuestions`/`difficulty` forced
 *     from `activityContract` rather than that mode's own defaults
 *     (Part 14: "Do not independently choose question count/difficulty...
 *     the engine defines the pedagogical contract"). PRACTICE/REINFORCE
 *     use `topic_practice`; PROVE uses its OWN distinct, server-only
 *     `canonical_prove` quiz_mode (`v1QuizModeForActivityType`) -- never
 *     legacy `quick_check`, which stays fixed at 6 items for every other
 *     caller (CANON-R6 Part 1).
 *
 * Never chooses a DIFFERENT stage/action than the one the fresh decision
 * already computed, and never accepts a client-supplied stage/mode as an
 * input (Part 12/13's own "client mode ignored" requirement) -- the only
 * inputs are `studentId`/`subjectId` (for URL construction and ownership,
 * already verified by the caller) and the decision itself.
 */
import type { CanonicalPedagogicalDecision, PedagogicalActivityType } from '@/lib/pedagogical-engine';
import { resolveV1ActivityLaunchReadiness, type V1ActivityNotReadyReason } from './activity-launch-readiness';
import { resolveCanonicalImplementation, type CanonicalQuizMode } from './canonical-implementation-registry';

export type CanonicalLaunchStatus = 'READY' | 'WAITING' | 'LOCKED' | 'CONSOLIDATED' | 'BLOCKED' | 'NOT_READY';

export interface CanonicalLearningSession {
  policyVersion: string;
  canonicalRevision: string;
  stage: CanonicalPedagogicalDecision['stage'];
  actionState: CanonicalPedagogicalDecision['actionState'];
  activityType: PedagogicalActivityType | 'REINFORCE' | null;
  launchStatus: CanonicalLaunchStatus;
  /** A navigable URL into the EXISTING quiz flow, or null when nothing should launch. */
  launchTarget: string | null;
  launchParams: Record<string, string>;
  waitingReason: CanonicalPedagogicalDecision['waitingReason'];
  nextEligibleAt: CanonicalPedagogicalDecision['nextEligibleAt'];
  /** Present only when `launchStatus === 'NOT_READY'` -- see activity-launch-readiness.ts. */
  notReadyReason: V1ActivityNotReadyReason | null;
}

/**
 * CANON-V2-ARCH-CLEANUP -- delegates entirely to the ONE canonical
 * implementation registry (Section 6 of this phase's own spec) --
 * never a second, locally-maintained mode-guessing switch. Every
 * `PedagogicalActivityType | 'REINFORCE'` value resolves to a real
 * quiz mode; there is no "not yet mapped" branch left to fall through.
 */
function v1QuizModeForActivityType(activityType: PedagogicalActivityType | 'REINFORCE'): CanonicalQuizMode {
  // The registry is total over this exact union (canonical-implementation-registry.ts)
  // -- a `null` result here is the same impossible-configuration case
  // `resolveV1ActivityLaunchReadiness` already guards against, so by
  // the time this is called (only after that readiness check passed)
  // it cannot actually happen. The fallback is defensive only.
  return resolveCanonicalImplementation(activityType)?.quizMode ?? 'topic_practice';
}

export type V1PracticeEligibility =
  | { eligible: true; activityType: PedagogicalActivityType | 'REINFORCE' }
  | { eligible: false };

/**
 * CANON-R5R1/R6/CANON-V2-ARCH-CLEANUP Part 2/20/12 -- THE ONE
 * eligibility check for "is this fresh decision a real, launchable v1
 * activity right now." Now recognizes every canonical activity type --
 * LEARN_CHECK, PRACTICE/REINFORCE, PROVE, RETENTION_CHECK, and TRANSFER
 * -- since `canonical-implementation-registry.ts` is total over all of
 * them (Section 1/7: "NOT_READY must NOT be part of the normal
 * canonical learner journey"). Shared by `resolveCanonicalLaunch`
 * (session start) and `verifyV1PracticeLaunchMarker` (the independent,
 * generation-time re-verification `/api/quizzes/generate-and-take`
 * performs before ever trusting a client's `v1Launch` intent flag) so
 * both call sites agree by construction, never by coincidence.
 */
export function resolveV1PracticeEligibility(decision: CanonicalPedagogicalDecision): V1PracticeEligibility {
  if (decision.actionState !== 'EXECUTABLE') return { eligible: false };
  const activityType = decision.intervention === 'REINFORCE' ? 'REINFORCE' : (decision.activityContract?.activityType ?? null);
  if (!activityType) return { eligible: false };
  if (!resolveV1ActivityLaunchReadiness(activityType).ready) return { eligible: false };
  return { eligible: true, activityType };
}

/**
 * CANON-R5R1A Part 3/19 -- THE ONE deterministic choice of "which single
 * item count to request from the generator" given a `{min,max}` range --
 * shared by the launch-URL builder below (a presentation hint only) and
 * `verifyV1PracticeAuthorization`'s real, enforced server override
 * (`v1-practice-launch-marker.ts`), so both agree on the SAME derived
 * value from the SAME contract rather than picking independently. The
 * frozen engine's `ActivityContract.itemCount` has no separate `target`
 * field (only `min`/`max`) -- `max` is the deterministic, documented
 * choice (never a random/heuristic pick).
 */
export function resolveAuthorizedItemCount(itemCount: { min: number; max: number } | null): number | null {
  if (!itemCount) return null;
  return itemCount.max ?? itemCount.min;
}

function buildPracticeLaunch(
  subjectId: string,
  conceptId: string,
  activityType: PedagogicalActivityType | 'REINFORCE',
  decision: CanonicalPedagogicalDecision,
): Pick<CanonicalLearningSession, 'launchStatus' | 'launchTarget' | 'launchParams' | 'notReadyReason'> {
  const contract = decision.activityContract;
  if (!contract) {
    // EXECUTABLE with no activityContract should not occur for
    // PRACTICE/REINFORCE (buildActivityContract only returns null for
    // CONSOLIDATED without an active REINFORCE overlay) -- fail closed
    // rather than launching an uncontracted activity.
    return { launchStatus: 'BLOCKED', launchTarget: null, launchParams: {}, notReadyReason: null };
  }
  const resolvedItemCount = resolveAuthorizedItemCount(contract.itemCount);
  const itemCount = resolvedItemCount != null ? String(resolvedItemCount) : undefined;
  const difficulty = String(Math.max(1, Math.min(5, Math.round(contract.difficulty.target))));
  const params: Record<string, string> = {
    subjectId,
    conceptId,
    mode: v1QuizModeForActivityType(activityType),
    difficulty,
    // CANON-R5R1 Part 2/3 -- the one durable INTENT signal that this
    // launch came from the canonical engine, never authoritative on its
    // own: /api/quizzes/generate-and-take independently re-verifies via
    // a fresh getCanonicalPedagogicalDecision call before ever stamping
    // v1 evidence (Part 6: a legacy caller that never sets this flag can
    // never become v1-stamped, however its own concept's canonical stage
    // happens to read).
    v1Launch: '1',
  };
  if (itemCount) params.maxQuestions = itemCount;
  const qs = new URLSearchParams(params).toString();
  return { launchStatus: 'READY', launchTarget: `/dashboard/quiz?${qs}`, launchParams: params, notReadyReason: null };
}

/**
 * `subjectId`/`conceptId` must already be caller-verified to belong to
 * `studentId` (the same ownership discipline `learning-session-engine.service.ts`
 * already applies for the legacy path) -- this function does not
 * re-verify ownership itself.
 */
export function resolveCanonicalLaunch(params: {
  subjectId: string;
  conceptId: string;
  decision: CanonicalPedagogicalDecision;
}): CanonicalLearningSession {
  const { subjectId, conceptId, decision } = params;
  const base = {
    policyVersion: decision.policyVersion,
    canonicalRevision: decision.canonicalRevision,
    stage: decision.stage,
    actionState: decision.actionState,
    waitingReason: decision.waitingReason,
    nextEligibleAt: decision.nextEligibleAt,
  };

  if (decision.actionState === 'WAITING') {
    return { ...base, activityType: null, launchStatus: 'WAITING', launchTarget: null, launchParams: {}, notReadyReason: null };
  }
  if (decision.actionState === 'CONSOLIDATED') {
    return { ...base, activityType: null, launchStatus: 'CONSOLIDATED', launchTarget: null, launchParams: {}, notReadyReason: null };
  }
  if (decision.actionState === 'LOCKED' || decision.actionState === 'BLOCKED') {
    return { ...base, activityType: null, launchStatus: decision.actionState, launchTarget: null, launchParams: {}, notReadyReason: null };
  }

  // actionState === 'EXECUTABLE'.
  const activityType = decision.intervention === 'REINFORCE' ? 'REINFORCE' : (decision.activityContract?.activityType ?? null);
  if (!activityType) {
    return { ...base, activityType: null, launchStatus: 'BLOCKED', launchTarget: null, launchParams: {}, notReadyReason: null };
  }

  const readiness = resolveV1ActivityLaunchReadiness(activityType);
  if (!readiness.ready) {
    return { ...base, activityType, launchStatus: 'NOT_READY', launchTarget: null, launchParams: {}, notReadyReason: readiness.reason };
  }

  const launch = buildPracticeLaunch(subjectId, conceptId, activityType, decision);
  return { ...base, activityType, ...launch };
}
