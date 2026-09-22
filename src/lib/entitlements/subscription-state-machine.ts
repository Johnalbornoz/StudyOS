import type { SubscriptionStatus } from './types';

/**
 * F3 / §9 -- the ONLY allowed transitions, exactly the list the task
 * itself enumerates. Any pair not listed here is rejected
 * (AC-F3-16) -- there is no default/fallback path that lets an
 * unrecognized transition through. `canceled` (the pre-existing
 * immediate-cancellation terminal) has no outgoing transitions here by
 * design -- it is not part of the new lifecycle's forward path.
 */
const ALLOWED_TRANSITIONS: ReadonlyArray<[SubscriptionStatus, SubscriptionStatus]> = [
  ['unpaid', 'active'],
  ['active', 'past_due'],
  ['past_due', 'active'],
  ['past_due', 'suspended'],
  ['suspended', 'reactivated'],
  ['reactivated', 'active'],
  ['active', 'cancelled_at_period_end'],
  ['cancelled_at_period_end', 'expired'],
  // Admin Console (2026-09-21) -- manual-approval and dispute/refund
  // lifecycle. `active -> suspended` is a direct admin action
  // ("Suspender membresía"), distinct from the pre-existing
  // past_due-triggered path -- an admin can suspend a membership
  // immediately regardless of payment status, for reasons other than
  // non-payment (fraud review, policy violation, user request).
  ['unpaid', 'payment_under_review'],
  ['payment_under_review', 'active'],
  ['payment_under_review', 'unpaid'],
  ['active', 'disputed'],
  ['disputed', 'active'],
  ['disputed', 'refunded'],
  ['active', 'refunded'],
  ['active', 'suspended'],
  // §15 "Expiración efectiva" -- the lazy reconciliation edges. An
  // admin-granted license (manually_set_by_admin=true) past its own
  // grant_expires_at loses access on the FIRST request that checks it
  // (getEffectiveSubscription, subscription.service.ts), regardless of
  // whether a cron ever runs -- these 3 edges are exactly the statuses
  // PAID_ACCESS_STATUSES recognizes as "still consuming premium", so
  // every one of them needs its own path to `expired`. Disjoint from
  // `cancelled_at_period_end -> expired` (a real cancellation), which
  // this never substitutes.
  ['active', 'expired'],
  ['past_due', 'expired'],
  ['reactivated', 'expired'],
];

export function isValidTransition(from: SubscriptionStatus, to: SubscriptionStatus): boolean {
  if (from === to) return false;
  return ALLOWED_TRANSITIONS.some(([f, t]) => f === from && t === to);
}

export class InvalidSubscriptionTransitionError extends Error {
  constructor(
    public readonly from: SubscriptionStatus,
    public readonly to: SubscriptionStatus
  ) {
    super(`Invalid subscription transition: ${from} -> ${to}`);
    this.name = 'InvalidSubscriptionTransitionError';
  }
}

/** Throws InvalidSubscriptionTransitionError rather than silently allowing an arbitrary jump. */
export function assertValidTransition(from: SubscriptionStatus, to: SubscriptionStatus): void {
  if (!isValidTransition(from, to)) {
    throw new InvalidSubscriptionTransitionError(from, to);
  }
}
