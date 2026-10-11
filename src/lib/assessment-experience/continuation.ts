/**
 * B4 -- AssessmentContinuationView: what comes after a result (pure).
 *
 * No dead ends: every result has a primary step. That step is ALWAYS one a canonical authority supplied --
 * the continuation resolver's answer for the concept just worked on, or the Learning Decision authority's
 * next challenge. This module chooses nothing pedagogical: it presents the answer it was given, and when no
 * authority has an action it sends the Student to the surface where the decision is shown (Today), never
 * to a step of its own invention. Exam gaps are not an input here: they are shown, not prioritised.
 */
import type { ContinuationResolution } from '@/lib/lx/continuation';
import type { NextChallengeView } from '@/lib/experience/next-challenge';

export const TODAY_HREF = '/dashboard/today' as const;

export type ContinuationPrimary =
  /** The continuation resolver says: launch this now. */
  | { kind: 'LAUNCH'; href: string; activityType: string }
  /** The Learning Decision authority has a next challenge; Today launches it. */
  | { kind: 'NEXT_CHALLENGE'; href: typeof TODAY_HREF; conceptId: string; subjectId: string; activityType: string }
  /** The canonical answer is "not yet" (a retention check that is not due). */
  | { kind: 'WAITING'; href: typeof TODAY_HREF; nextEligibleAt: string | null }
  /** No authority has an action right now: go to where the decision lives. */
  | { kind: 'RETURN'; href: typeof TODAY_HREF };

export type SecondaryKind = 'BACK_TO_EXAM_PREP' | 'BACK_TO_PROGRESS' | 'BACK_TO_PATH' | 'BACK_TO_ASSIGNMENTS';

export interface AssessmentContinuationView {
  /** CANONICAL when the primary step is an authority's own action; NONE when it is the return to Today. */
  authority: 'CANONICAL' | 'NONE';
  primary: ContinuationPrimary;
  secondary: Array<{ kind: SecondaryKind; href: string }>;
}

export interface ContinuationFacts {
  /** `resolveContinuation` for the concept just worked on, when the surface has one. */
  resolution?: ContinuationResolution | null;
  /** The snapshot's next challenge (`presentSnapshotNextChallenge`), when the surface read it. */
  nextChallenge?: NextChallengeView | null;
  secondary?: ReadonlyArray<{ kind: SecondaryKind; href: string }>;
}

/**
 * The resolver's answer is about the concept the Student just worked on, so it is presented first when it
 * is an action. This is not a ranking between two decisions: both come from the same authority, and a
 * surface normally supplies only the one it has.
 */
export function continuationViewOf(facts: ContinuationFacts): AssessmentContinuationView {
  const secondary = [...(facts.secondary ?? [])];
  const r = facts.resolution ?? null;
  const n = facts.nextChallenge ?? null;
  if (r?.status === 'LAUNCH') return { authority: 'CANONICAL', primary: { kind: 'LAUNCH', href: r.launchTarget, activityType: r.activityType }, secondary };
  if (n?.status === 'READY') return { authority: 'CANONICAL', primary: { kind: 'NEXT_CHALLENGE', href: TODAY_HREF, conceptId: n.conceptId, subjectId: n.subjectId, activityType: n.activityType }, secondary };
  if (r?.status === 'WAITING') return { authority: 'CANONICAL', primary: { kind: 'WAITING', href: TODAY_HREF, nextEligibleAt: r.nextEligibleAt }, secondary };
  if (n?.status === 'WAITING') return { authority: 'CANONICAL', primary: { kind: 'WAITING', href: TODAY_HREF, nextEligibleAt: n.nextEligibleAt }, secondary };
  return { authority: 'NONE', primary: { kind: 'RETURN', href: TODAY_HREF }, secondary };
}
