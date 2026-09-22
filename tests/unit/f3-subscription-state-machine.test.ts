/**
 * F3 / §9/AC-F3-16 -- the subscription state machine allows exactly
 * the listed transitions and rejects every arbitrary jump.
 *
 * Extended by the Professional Admin Console's "Membresías y pagos"
 * redesign with 3 new statuses (`payment_under_review`, `disputed`,
 * `refunded`) and 8 new edges, including a new direct admin-initiated
 * `active -> suspended` path (distinct from the pre-existing
 * `past_due -> suspended` one), plus 3 more edges added for §15
 * "Expiración efectiva" (`active|past_due|reactivated -> expired`, the
 * lazy-reconciliation paths an admin grant past its own
 * `grant_expires_at` needs) -- see `subscription-state-machine.ts`.
 * The original 8 edges are unchanged; this test now covers the full
 * 11x11 = 121 combinations over all 11 statuses.
 */
import { describe, it, expect } from 'vitest';
import { isValidTransition, assertValidTransition, InvalidSubscriptionTransitionError } from '@/lib/entitlements/subscription-state-machine';
import type { SubscriptionStatus } from '@/lib/entitlements/types';

const ALL_STATUSES: SubscriptionStatus[] = [
  'unpaid', 'active', 'past_due', 'canceled', 'suspended', 'reactivated', 'cancelled_at_period_end', 'expired',
  'payment_under_review', 'disputed', 'refunded',
];

const ALLOWED: Array<[SubscriptionStatus, SubscriptionStatus]> = [
  ['unpaid', 'active'],
  ['active', 'past_due'],
  ['past_due', 'active'],
  ['past_due', 'suspended'],
  ['suspended', 'reactivated'],
  ['reactivated', 'active'],
  ['active', 'cancelled_at_period_end'],
  ['cancelled_at_period_end', 'expired'],
  ['unpaid', 'payment_under_review'],
  ['payment_under_review', 'active'],
  ['payment_under_review', 'unpaid'],
  ['active', 'disputed'],
  ['disputed', 'active'],
  ['disputed', 'refunded'],
  ['active', 'refunded'],
  ['active', 'suspended'],
  ['active', 'expired'],
  ['past_due', 'expired'],
  ['reactivated', 'expired'],
];

describe('isValidTransition -- exactly the allowed set', () => {
  it.each(ALLOWED)('ALLOWS %s -> %s', (from, to) => {
    expect(isValidTransition(from, to)).toBe(true);
  });

  it('rejects every pair not explicitly listed (exhaustive over all 11x11=121 combinations)', () => {
    const allowedSet = new Set(ALLOWED.map(([f, t]) => `${f}->${t}`));
    let checked = 0;
    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        const expected = allowedSet.has(`${from}->${to}`);
        expect(isValidTransition(from, to)).toBe(expected);
        checked++;
      }
    }
    expect(checked).toBe(121);
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
