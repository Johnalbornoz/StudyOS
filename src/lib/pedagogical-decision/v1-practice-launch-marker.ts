/**
 * CANON-R5R1 -- v1 EVIDENCE PERSISTENCE: the trusted, server-only launch
 * marker for a Canonical-Engine-created Practice quiz session.
 *
 * TRUST MODEL (Part 2/12/20): a client's `v1Launch: true` request field
 * is never, by itself, sufficient to stamp a quiz session as v1. It is
 * only a REQUEST to attempt canonical stamping -- this function always
 * independently re-verifies by calling `getCanonicalPedagogicalDecision`
 * FRESH for the exact (studentId, conceptId) pair before ever returning
 * a marker. A forged/stale/wrong claim (Part 20's own "Server Trust
 * Test": a client sends `canonicalStage: PROVE` for what should be a
 * legacy session) simply fails this re-verification and the caller
 * degrades to ordinary legacy generation -- never a thrown error, never
 * a blocked generation, since a v1-ineligible request is exactly what
 * unmodified legacy Practice generation already handles correctly.
 *
 * `resolveV1PracticeEligibility` (canonical-session-launch.ts) is the
 * SAME eligibility check `resolveCanonicalLaunch` (session start) uses
 * -- both call sites agree on "is this a real, launchable v1 Practice
 * activity right now" by construction.
 */
import { V1_POLICY_VERSION } from '@/lib/pedagogical-migration';
import type { PedagogicalStage } from '@/lib/pedagogical-engine';
import { getCanonicalPedagogicalDecision, CanonicalDecisionUnavailableError } from './canonical-decision.service';
import { resolveV1PracticeEligibility } from './canonical-session-launch';

export interface V1PracticeLaunchMarker {
  pedagogicalPolicyVersion: typeof V1_POLICY_VERSION;
  canonicalRevision: string;
  canonicalStage: PedagogicalStage;
  canonicalActivityType: 'PRACTICE' | 'REINFORCE';
}

/**
 * Returns a trusted marker only when a FRESH canonical decision, computed
 * right now, confirms this (studentId, conceptId) pair is genuinely an
 * EXECUTABLE v1 Practice/Reinforce activity. Returns `null` for every
 * other case -- including a transient read failure, which degrades to
 * "not v1" rather than blocking or failing the generation request (a
 * v1-ineligible request is handled by the existing, unmodified legacy
 * generation path exactly as before this phase).
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

  return {
    pedagogicalPolicyVersion: V1_POLICY_VERSION,
    canonicalRevision: decision.canonicalRevision,
    canonicalStage: decision.stage,
    canonicalActivityType: eligibility.activityType,
  };
}
