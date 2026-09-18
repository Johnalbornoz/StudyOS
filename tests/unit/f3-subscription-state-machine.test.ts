/**
 * F3 / §9/AC-F3-16 -- the subscription state machine allows exactly
 * the 8 listed transitions and rejects every arbitrary jump.
 */
import { describe, it, expect } from 'vitest';
import { isValidTransition, assertValidTransition, InvalidSubscriptionTransitionError } from '@/lib/entitlements/subscription-state-machine';
import type { SubscriptionStatus } from '@/lib/entitlements/types';

const ALL_STATUSES: SubscriptionStatus[] = ['unpaid', 'active', 'past_due', 'canceled', 'suspended', 'reactivated', 'cancelled_at_period_end', 'expired'];

const ALLOWED: Array<[SubscriptionStatus, SubscriptionStatus]> = [
  ['unpaid', 'active'],
  ['active', 'past_due'],
  ['past_due', 'active'],
  ['past_due', 'suspended'],
  ['suspended', 'reactivated'],
  ['reactivated', 'active'],
  ['active', 'cancelled_at_period_end'],
  ['cancelled_at_period_end', 'expired'],
];

describe('isValidTransition -- exactly the allowed set', () => {
  it.each(ALLOWED)('ALLOWS %s -> %s', (from, to) => {
    expect(isValidTransition(from, to)).toBe(true);
  });

  it('rejects every pair not explicitly listed (exhaustive over all 8x8=64 combinations)', () => {
    const allowedSet = new Set(ALLOWED.map(([f, t]) => `${f}->${t}`));
    let checked = 0;
    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        const expected = allowedSet.has(`${from}->${to}`);
        expect(isValidTransition(from, to)).toBe(expected);
        checked++;
      }
    }
    expect(checked).toBe(64);
  });

  it('rejects a same-state "transition" (no-op is not a transition)', () => {
    expect(isValidTransition('active', 'active')).toBe(false);
  });

  it('rejects a jump that skips intermediate states (e.g. unpaid -> suspended)', () => {
    expect(isValidTransition('unpaid', 'suspended')).toBe(false);
  });

  it('rejects reviving an expired subscription directly to active', () => {
    expect(isValidTransition('expired', 'active')).toBe(false);
  });

  it('canceled (pre-existing immediate cancellation) has no outgoing transitions', () => {
    for (const to of ALL_STATUSES) {
      expect(isValidTransition('canceled', to)).toBe(false);
    }
  });
});

describe('assertValidTransition', () => {
  it('throws InvalidSubscriptionTransitionError for a rejected transition, never silently applies it', () => {
    expect(() => assertValidTransition('active', 'unpaid')).toThrow(InvalidSubscriptionTransitionError);
  });

  it('does not throw for an allowed transition', () => {
    expect(() => assertValidTransition('active', 'past_due')).not.toThrow();
  });
});
