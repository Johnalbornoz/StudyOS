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
 *     generation route cannot yet honor (Prove/Retention exact-10,
 *     Transfer's 3-challenge structure, LEARN_CHECK) is refused with a
 *     controlled `NOT_READY` result and a closed reason code -- NEVER
 *     silently routed through the nearest legacy quiz_mode (Part 18: "Do
 *     not silently fall back to legacy Transfer" -- generalized to every
 *     stage this phase found unready, per `activity-launch-readiness.ts`'s
 *     own grounding).
 *   - Only PRACTICE and the REINFORCE overlay reach a real `READY` launch
 *     today -- into the EXISTING, unmodified `/dashboard/quiz` flow
 *     (`topic_practice` quiz_mode), with `maxQuestions`/`difficulty`
 *     forced from `activityContract` rather than that mode's own
 *     defaults (Part 14: "Do not independently choose question
 *     count/difficulty... the engine defines the pedagogical contract").
 *
 * Never chooses a DIFFERENT stage/action than the one the fresh decision
 * already computed, and never accepts a client-supplied stage/mode as an
 * input (Part 12/13's own "client mode ignored" requirement) -- the only
 * inputs are `studentId`/`subjectId` (for URL construction and ownership,
 * already verified by the caller) and the decision itself.
 */
import type { CanonicalPedagogicalDecision, PedagogicalActivityType } from '@/lib/pedagogical-engine';
import { resolveV1ActivityLaunchReadiness, type V1ActivityNotReadyReason } from './activity-launch-readiness';

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

const V1_QUIZ_MODE = 'topic_practice' as const;

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
  const itemCount = contract.itemCount ? String(contract.itemCount.max ?? contract.itemCount.min) : undefined;
  const difficulty = String(Math.max(1, Math.min(5, Math.round(contract.difficulty.target))));
  const params: Record<string, string> = {
    subjectId,
    conceptId,
    mode: V1_QUIZ_MODE,
    difficulty,
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
