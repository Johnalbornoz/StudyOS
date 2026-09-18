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
