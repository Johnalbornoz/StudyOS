import type { LearnerReadScope } from './index';

/**
 * L10 SF-4 -- shaping helpers for payloads that several relationships read.
 * Pure: the scope comes from `resolveLearnerReadScope`; nothing here decides
 * who may read, only how much of an already-authorized payload is returned.
 */

export function isOwnerScope(scope: LearnerReadScope): boolean {
  return scope.relationships.includes('OWNER');
}

/** A result is RELEASED once it is scored and has not been invalidated. */
export function isReleasedResult(result: { status?: string | null } | null | undefined): boolean {
  return result?.status === 'SCORED';
}

interface ResultViewLike {
  result: { status?: string | null } | null;
  review: unknown[] | null;
  reviewPolicy: 'FULL' | 'SCORES_ONLY';
}

/**
 * The attempt result view for this scope, or null when nothing may be shown.
 *
 *  - The owner sees the view as stored (their own data).
 *  - Anyone else sees it only once the result is RELEASED.
 *  - The item-level review (question, the learner's answer, the key) is kept
 *    only with LEARNER_ASSESSMENT_DETAIL_VIEW; otherwise it is removed and
 *    the policy reads SCORES_ONLY, so a client renders a summary and never
 *    an empty review.
 */
export function shapeAttemptResultViewForScope<V extends ResultViewLike>(view: V, scope: LearnerReadScope): V | null {
  if (isOwnerScope(scope)) return view;
  if (!scope.permissions.includes('LEARNER_ASSESSMENT_SUMMARY_VIEW')) return null;
  if (!isReleasedResult(view.result)) return null;
  if (scope.permissions.includes('LEARNER_ASSESSMENT_DETAIL_VIEW')) return view;
  return { ...view, review: null, reviewPolicy: 'SCORES_ONLY' };
}
