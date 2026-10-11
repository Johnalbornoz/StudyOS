/**
 * L11 / EN-3 -- what a provider event may do (pure rules).
 * Administrator decisions and administrator-set grants are never changed by
 * a provider event; cancellations are honoured; only the preapproval the
 * subscription runs on can pause or cancel it.
 */
import { describe, it, expect } from 'vitest';
import { decideProviderEvent, encodeExternalReference, isPurchasable, parseExternalReference, type ProviderSubscriptionView } from '@/lib/entitlements/provider-events';

const NOW = new Date('2026-10-11T12:00:00Z');
const NEXT = '2026-11-11T12:00:00.000Z';
const STUDENT = '11111111-1111-4111-8111-111111111111';
const PAYER = '22222222-2222-4222-8222-222222222222';

const sub = (over: Partial<ProviderSubscriptionView> = {}): ProviderSubscriptionView => ({
  id: 'sub-1',
  status: 'unpaid',
  manuallySetByAdmin: false,
  providerSubscriptionId: null,
  currentPeriodEnd: null,
  ...over,
});
const pre = (status: string, over: Record<string, unknown> = {}) => ({ id: 'pre-1', status, nextPaymentDate: NEXT, ...over });

describe('external reference', () => {
  it('round-trips learner and payer', () => {
    expect(parseExternalReference(encodeExternalReference(STUDENT, PAYER))).toEqual({ studentId: STUDENT, payerUserId: PAYER });
  });
  it('accepts the earlier bare learner id (no payer to bind)', () => {
    expect(parseExternalReference(STUDENT)).toEqual({ studentId: STUDENT, payerUserId: null });
  });
  it.each([[null], [42], [''], ['not-a-uuid'], [`${STUDENT}:nope`], [`${STUDENT}:${PAYER}:extra`]])('rejects %p', (value) => {
    expect(parseExternalReference(value)).toBeNull();
  });
});

describe('administrator decisions are never changed by a provider event', () => {
  it.each(['suspended', 'disputed', 'refunded', 'payment_under_review'] as const)('%s stays, whatever the provider says', (status) => {
    for (const providerStatus of ['authorized', 'paused', 'cancelled', 'pending']) {
      expect(decideProviderEvent(sub({ status, providerSubscriptionId: 'pre-1' }), pre(providerStatus), NOW)).toEqual({ action: 'NONE', reason: 'ADMIN_LIFECYCLE', adoptProviderId: false });
    }
  });

  it('an administrator-set grant is not governed by the provider: no transition, no provider id adopted', () => {
    for (const status of ['active', 'unpaid', 'expired', 'past_due'] as const) {
      for (const providerStatus of ['authorized', 'paused', 'cancelled', 'pending']) {
        expect(decideProviderEvent(sub({ status, manuallySetByAdmin: true, providerSubscriptionId: 'pre-1' }), pre(providerStatus), NOW)).toEqual({
          action: 'NONE',
          reason: 'ADMIN_CONTROLLED',
          adoptProviderId: false,
        });
      }
    }
  });
});

describe('authorized', () => {
  it('activates an unpaid subscription and adopts the preapproval', () => {
    expect(decideProviderEvent(sub(), pre('authorized'), NOW)).toEqual({ action: 'TRANSITION', to: 'active', periodEnd: NEXT, adoptProviderId: true });
  });
  it('past_due -> active', () => {
    expect(decideProviderEvent(sub({ status: 'past_due' }), pre('authorized'), NOW)).toMatchObject({ action: 'TRANSITION', to: 'active' });
  });
  it('already active: nothing to transition', () => {
    expect(decideProviderEvent(sub({ status: 'active' }), pre('authorized'), NOW)).toEqual({ action: 'NONE', reason: 'ALREADY_APPLIED', adoptProviderId: true });
  });
  it.each(['expired', 'canceled', 'cancelled_at_period_end'] as const)('%s has no path to active in the state machine: skipped, never forced', (status) => {
    expect(decideProviderEvent(sub({ status }), pre('authorized'), NOW)).toEqual({ action: 'NONE', reason: 'INVALID_TRANSITION', adoptProviderId: false });
  });
  it('a pending preapproval (checkout started, nothing paid) changes nothing', () => {
    expect(decideProviderEvent(sub(), pre('pending'), NOW)).toEqual({ action: 'NONE', reason: 'NO_STATUS_CHANGE', adoptProviderId: false });
  });
});

describe('cancellation is honoured', () => {
  const running = { status: 'active' as const, providerSubscriptionId: 'pre-1' };
  it('active: access ends at the end of the paid period', () => {
    expect(decideProviderEvent(sub(running), pre('cancelled'), NOW)).toEqual({ action: 'TRANSITION', to: 'cancelled_at_period_end', periodEnd: NEXT, adoptProviderId: false });
  });
  it('active with no period from the provider: falls back to the stored period, else ends now', () => {
    expect(decideProviderEvent(sub({ ...running, currentPeriodEnd: NEXT }), pre('cancelled', { nextPaymentDate: null }), NOW)).toMatchObject({ periodEnd: NEXT });
    expect(decideProviderEvent(sub(running), pre('cancelled', { nextPaymentDate: '2026-01-01T00:00:00Z' }), NOW)).toMatchObject({ to: 'cancelled_at_period_end', periodEnd: NOW.toISOString() });
  });
  it.each(['past_due', 'reactivated'] as const)('%s: ends now', (status) => {
    expect(decideProviderEvent(sub({ status, providerSubscriptionId: 'pre-1' }), pre('cancelled'), NOW)).toEqual({ action: 'TRANSITION', to: 'expired', periodEnd: null, adoptProviderId: false });
  });
  it('a cancelled preapproval that is NOT the one the subscription runs on cannot cancel it', () => {
    expect(decideProviderEvent(sub({ status: 'active', providerSubscriptionId: 'pre-OTHER' }), pre('cancelled'), NOW)).toMatchObject({ action: 'NONE', reason: 'NOT_CURRENT_PREAPPROVAL' });
    expect(decideProviderEvent(sub({ status: 'active', providerSubscriptionId: null }), pre('cancelled'), NOW)).toMatchObject({ action: 'NONE', reason: 'NOT_CURRENT_PREAPPROVAL' });
  });
  it('paused: active -> past_due, only for the current preapproval', () => {
    expect(decideProviderEvent(sub(running), pre('paused'), NOW)).toEqual({ action: 'TRANSITION', to: 'past_due', periodEnd: null, adoptProviderId: false });
    expect(decideProviderEvent(sub({ status: 'active', providerSubscriptionId: 'pre-OTHER' }), pre('paused'), NOW)).toMatchObject({ action: 'NONE' });
  });
});

describe('isPurchasable: a checkout is only started when a payment could activate the subscription', () => {
  it('unpaid and past_due paid rows are purchasable', () => {
    expect(isPurchasable({ status: 'unpaid', manuallySetByAdmin: false })).toBe(true);
    expect(isPurchasable({ status: 'past_due', manuallySetByAdmin: false })).toBe(true);
  });
  it.each(['suspended', 'disputed', 'refunded', 'payment_under_review', 'active', 'expired', 'canceled', 'cancelled_at_period_end'] as const)('%s is not', (status) => {
    expect(isPurchasable({ status, manuallySetByAdmin: false })).toBe(false);
  });
  it('an administrator-set row is not, whatever its status', () => {
    expect(isPurchasable({ status: 'unpaid', manuallySetByAdmin: true })).toBe(false);
    expect(isPurchasable({ status: 'active', manuallySetByAdmin: true })).toBe(false);
  });
});
