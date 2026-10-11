/**
 * L4-R1 -- POST /api/billing/reactivate can no longer undo an administrator's
 * suspension / grant revocation, nor produce access with no entitlement basis.
 * The legitimate self-service cases (a paid subscription whose period is still
 * running, or paid again after a non-admin suspension; past_due -> active on a
 * paid row) are preserved.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const verifyAuthMock = vi.fn();
vi.mock('@/lib/auth', () => ({ verifyAuth: () => verifyAuthMock() }));
vi.mock('@/lib/identity', () => ({ getOrCreateCanonicalUser: vi.fn().mockResolvedValue({ id: 'actor-1' }) }));

const canUseCapabilityMock = vi.fn();
const getSubscriptionMock = vi.fn();
const transitionMock = vi.fn();
const { FakeInvalidTransitionError } = vi.hoisted(() => ({ FakeInvalidTransitionError: class extends Error {} }));
vi.mock('@/lib/entitlements', () => ({
  canUseCapability: (...a: any[]) => canUseCapabilityMock(...a),
  getSubscription: (...a: any[]) => getSubscriptionMock(...a),
  transitionSubscriptionStatus: (...a: any[]) => transitionMock(...a),
  InvalidSubscriptionTransitionError: FakeInvalidTransitionError,
}));

/** Fake DB: only what self-reactivation.ts (and, for the capability test, the entitlement service) reads. */
const state: { suspension: any; paidAt: string | null; fail: boolean; subscriptionRow: any; ownerUserId: string | null; writes: Array<{ sql: string; params: any[] }> } = {
  suspension: null,
  paidAt: null,
  fail: false,
  subscriptionRow: null,
  ownerUserId: null,
  writes: [],
};
vi.mock('@/lib/db', () => ({
  db: {
    query: async (sql: string, params: any[] = []) => {
      if (/^\s*(INSERT|UPDATE|DELETE)/i.test(sql)) {
        state.writes.push({ sql, params });
        return { rows: [], rowCount: 1 };
      }
      if (/FROM subscription_events/.test(sql)) {
        if (state.fail) throw new Error('db down');
        return { rows: state.suspension ? [state.suspension] : [] };
      }
      if (/FROM payments/.test(sql)) return { rows: [{ at: state.paidAt }] };
      if (/FROM subscriptions/.test(sql)) return { rows: state.subscriptionRow ? [state.subscriptionRow] : [] };
      if (/FROM students/.test(sql)) return { rows: state.ownerUserId && params[1] === state.ownerUserId ? [{}] : [] };
      return { rows: [] };
    },
  },
}));

import { POST } from '@/app/api/billing/reactivate/route';
import { decideSelfReactivation } from '@/lib/entitlements/self-reactivation';

const STUDENT = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-10-11T12:00:00Z');
const FUTURE = '2099-01-01T00:00:00.000Z';
const PAST = '2026-01-01T00:00:00.000Z';
const sub = (over: Record<string, unknown> = {}) => ({
  id: 'sub-1',
  studentId: STUDENT,
  status: 'suspended',
  plan: 'MONTHLY',
  payerUserId: 'actor-1',
  currentPeriodEnd: null,
  manuallySetByAdmin: false,
  grantExpiresAt: null,
  ...over,
}) as any;
const post = () => POST({ json: async () => ({ studentId: STUDENT }) } as any) as Promise<any>;

beforeEach(() => {
  verifyAuthMock.mockReset().mockResolvedValue({ userId: 'clerk-1', email: null, role: 'student' });
  canUseCapabilityMock.mockReset().mockResolvedValue(true);
  getSubscriptionMock.mockReset();
  transitionMock.mockReset().mockResolvedValue(undefined);
  Object.assign(state, { suspension: null, paidAt: null, fail: false, subscriptionRow: null, ownerUserId: null, writes: [] });
});

describe('decideSelfReactivation (pure)', () => {
  const none = { lastSuspension: null, lastSucceededPaymentAt: null };
  it('legitimate: a paid subscription suspended by the system whose period is still running', () => {
    expect(decideSelfReactivation(sub({ currentPeriodEnd: FUTURE }), none, NOW)).toEqual({ allowed: true, nextStatus: 'reactivated' });
    const system = { lastSuspension: { actorUserId: null, occurredAt: PAST }, lastSucceededPaymentAt: null };
    expect(decideSelfReactivation(sub({ currentPeriodEnd: FUTURE }), system, NOW)).toEqual({ allowed: true, nextStatus: 'reactivated' });
  });
  it('legitimate: paid again after a non-admin suspension', () => {
    const facts = { lastSuspension: { actorUserId: null, occurredAt: '2026-10-01T00:00:00Z' }, lastSucceededPaymentAt: '2026-10-05T00:00:00Z' };
    expect(decideSelfReactivation(sub(), facts, NOW)).toEqual({ allowed: true, nextStatus: 'reactivated' });
  });
  it('a payment made BEFORE the suspension is not a basis', () => {
    const facts = { lastSuspension: { actorUserId: null, occurredAt: '2026-10-05T00:00:00Z' }, lastSucceededPaymentAt: '2026-10-01T00:00:00Z' };
    expect(decideSelfReactivation(sub(), facts, NOW)).toEqual({ allowed: false, reason: 'NO_ENTITLEMENT_BASIS' });
  });
  it('legitimate: past_due -> active on a paid row is unchanged', () => {
    expect(decideSelfReactivation(sub({ status: 'past_due' }), none, NOW)).toEqual({ allowed: true, nextStatus: 'active' });
  });
  it('an administrator suspension is never self-reversed, even with a running paid period or a later payment', () => {
    const facts = { lastSuspension: { actorUserId: 'admin-1', occurredAt: '2026-10-01T00:00:00Z' }, lastSucceededPaymentAt: '2026-10-05T00:00:00Z' };
    expect(decideSelfReactivation(sub({ currentPeriodEnd: FUTURE }), facts, NOW)).toEqual({ allowed: false, reason: 'ADMIN_SUSPENDED' });
  });
  it('a revoked admin grant (or any admin-set row) is never self-reactivated, with or without an event row', () => {
    const revoked = sub({ manuallySetByAdmin: true, grantExpiresAt: FUTURE });
    expect(decideSelfReactivation(revoked, none, NOW)).toEqual({ allowed: false, reason: 'ADMIN_CONTROLLED' });
    expect(decideSelfReactivation(sub({ status: 'past_due', manuallySetByAdmin: true }), none, NOW)).toEqual({ allowed: false, reason: 'ADMIN_CONTROLLED' });
  });
  it('no entitlement basis => no access: suspended with no running period and no payment', () => {
    expect(decideSelfReactivation(sub(), none, NOW)).toEqual({ allowed: false, reason: 'NO_ENTITLEMENT_BASIS' });
    expect(decideSelfReactivation(sub({ currentPeriodEnd: PAST }), none, NOW)).toEqual({ allowed: false, reason: 'NO_ENTITLEMENT_BASIS' });
  });
  it('nothing else is reactivatable (no row, active, unpaid, expired, canceled, refunded)', () => {
    expect(decideSelfReactivation(sub({ id: '' }), none, NOW)).toEqual({ allowed: false, reason: 'NOT_REACTIVATABLE' });
    for (const status of ['active', 'unpaid', 'expired', 'canceled', 'refunded', 'disputed', 'cancelled_at_period_end', 'reactivated']) {
      expect(decideSelfReactivation(sub({ status, currentPeriodEnd: FUTURE }), none, NOW)).toEqual({ allowed: false, reason: 'NOT_REACTIVATABLE' });
    }
  });
});

describe('POST /api/billing/reactivate', () => {
  it('legitimate self-reactivation still works and is now recorded', async () => {
    getSubscriptionMock.mockResolvedValue(sub({ currentPeriodEnd: FUTURE }));
    const res = await post();
    expect(res.status).toBe(200);
    expect(transitionMock).toHaveBeenCalledWith(STUDENT, 'reactivated');
    expect(state.writes).toHaveLength(1);
    expect(state.writes[0].sql).toMatch(/INSERT INTO subscription_events/);
    expect(state.writes[0].params).toEqual(['sub-1', 'actor-1', 'suspended', 'reactivated']);
  });

  it('legitimate past_due -> active still works', async () => {
    getSubscriptionMock.mockResolvedValue(sub({ status: 'past_due' }));
    const res = await post();
    expect(res.status).toBe(200);
    expect(transitionMock).toHaveBeenCalledWith(STUDENT, 'active');
  });

  it('an admin suspension cannot be reversed', async () => {
    getSubscriptionMock.mockResolvedValue(sub({ currentPeriodEnd: FUTURE }));
    state.suspension = { actor_user_id: 'admin-1', occurred_at: '2026-10-01T00:00:00Z' };
    const res = await post();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'REACTIVATION_NOT_PERMITTED', reason: 'ADMIN_SUSPENDED' });
    expect(transitionMock).not.toHaveBeenCalled();
    expect(state.writes).toEqual([]);
  });

  it('an admin grant revocation cannot be reversed', async () => {
    // revokeLicenseGrant: status -> suspended, manually_set_by_admin stays true, grant not yet expired.
    getSubscriptionMock.mockResolvedValue(sub({ manuallySetByAdmin: true, grantExpiresAt: FUTURE }));
    state.suspension = { actor_user_id: 'admin-1', occurred_at: '2026-10-01T00:00:00Z' };
    const res = await post();
    expect(res.status).toBe(403);
    expect((await res.json()).reason).toBe('ADMIN_CONTROLLED');
    expect(transitionMock).not.toHaveBeenCalled();
    expect(state.writes).toEqual([]);
  });

  it('no valid entitlement basis cannot create access', async () => {
    getSubscriptionMock.mockResolvedValue(sub());
    const res = await post();
    expect(res.status).toBe(403);
    expect((await res.json()).reason).toBe('NO_ENTITLEMENT_BASIS');
    expect(transitionMock).not.toHaveBeenCalled();
  });

  it('fails closed when the suspension record cannot be read', async () => {
    getSubscriptionMock.mockResolvedValue(sub({ currentPeriodEnd: FUTURE }));
    state.fail = true;
    const res = await post();
    expect(res.status).toBe(403);
    expect(transitionMock).not.toHaveBeenCalled();
  });

  it('a non-reactivatable status is still a 409, and a non-owner is still a 403 before any lookup', async () => {
    getSubscriptionMock.mockResolvedValue(sub({ status: 'active' }));
    expect((await post()).status).toBe(409);
    canUseCapabilityMock.mockResolvedValue(false);
    getSubscriptionMock.mockClear();
    expect((await post()).status).toBe(403);
    expect(getSubscriptionMock).not.toHaveBeenCalled();
  });
});

describe('SUBSCRIPTION_REACTIVATE capability (what the Billing page is told) follows the same rule', () => {
  const row = (over: Record<string, unknown> = {}) => ({ id: 'sub-1', student_id: STUDENT, status: 'suspended', plan: 'MONTHLY', payer_user_id: 'actor-1', current_period_end: null, manually_set_by_admin: false, grant_expires_at: null, ...over });
  it('false for an admin-suspended or admin-set subscription; true for a paid one with a running period', async () => {
    const real = await vi.importActual<typeof import('@/lib/entitlements')>('@/lib/entitlements');
    state.ownerUserId = 'actor-1';

    state.subscriptionRow = row({ current_period_end: FUTURE });
    expect(await real.canUseCapability('actor-1', STUDENT, 'SUBSCRIPTION_REACTIVATE')).toBe(true);

    state.suspension = { actor_user_id: 'admin-1', occurred_at: '2026-10-01T00:00:00Z' };
    expect(await real.canUseCapability('actor-1', STUDENT, 'SUBSCRIPTION_REACTIVATE')).toBe(false);

    state.suspension = null;
    state.subscriptionRow = row({ manually_set_by_admin: true, grant_expires_at: FUTURE });
    expect(await real.canUseCapability('actor-1', STUDENT, 'SUBSCRIPTION_REACTIVATE')).toBe(false);

    state.subscriptionRow = row();
    expect(await real.canUseCapability('actor-1', STUDENT, 'SUBSCRIPTION_REACTIVATE')).toBe(false);
  });
});
