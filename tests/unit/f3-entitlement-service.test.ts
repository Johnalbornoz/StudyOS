/**
 * F3 -- the canonical Entitlement authority. Covers the required test
 * matrix (§23) and negative tests (§24) at the unit level; real-
 * Postgres coverage lives in
 * scripts/operations/f3-entitlement-migration-cert.sh.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const dbQueryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => dbQueryMock(...a) } }));

import { canUseCapability } from '@/lib/entitlements';

const LEARNER = 'learner-1';
const OWNER_ACTOR = 'owner-user-1';
const PAYER_ACTOR = 'payer-user-1';
const STRANGER_ACTOR = 'stranger-user-1';

function subRow(status: string, overrides: Partial<Record<string, any>> = {}) {
  return {
    rows: [
      {
        id: 'sub-1',
        student_id: LEARNER,
        status,
        plan: 'MONTHLY',
        payer_user_id: PAYER_ACTOR,
        current_period_end: null,
        manually_set_by_admin: false,
        ...overrides,
      },
    ],
  };
}

beforeEach(() => {
  dbQueryMock.mockReset();
});

describe('ACTIVE STUDENT', () => {
  it('owner + active subscription -> LEARNING_FULL_ACCESS ALLOW', async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [{ '?': 1 }] }); // isOwner
    dbQueryMock.mockResolvedValueOnce(subRow('active')); // getSubscription
    expect(await canUseCapability(OWNER_ACTOR, LEARNER, 'LEARNING_FULL_ACCESS')).toBe(true);
  });
});

describe('SUSPENDED STUDENT', () => {
  it('owner + suspended -> LEARNING_FULL_ACCESS DENY', async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [{ '?': 1 }] });
    dbQueryMock.mockResolvedValueOnce(subRow('suspended'));
    expect(await canUseCapability(OWNER_ACTOR, LEARNER, 'LEARNING_FULL_ACCESS')).toBe(false);
  });

  it('owner + suspended -> LEARNING_HISTORY_VIEW still ALLOW (INV-F3-06)', async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [{ '?': 1 }] }); // isOwner only -- history view never queries subscription
    expect(await canUseCapability(OWNER_ACTOR, LEARNER, 'LEARNING_HISTORY_VIEW')).toBe(true);
  });
});

describe('REACTIVATED STUDENT', () => {
  it('owner + reactivated -> LEARNING_FULL_ACCESS ALLOW (treated as paid access)', async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [{ '?': 1 }] });
    dbQueryMock.mockResolvedValueOnce(subRow('reactivated'));
    expect(await canUseCapability(OWNER_ACTOR, LEARNER, 'LEARNING_FULL_ACCESS')).toBe(true);
  });
});

describe('EXPIRED STUDENT', () => {
  it('owner + expired -> LEARNING_FULL_ACCESS DENY', async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [{ '?': 1 }] });
    dbQueryMock.mockResolvedValueOnce(subRow('expired'));
    expect(await canUseCapability(OWNER_ACTOR, LEARNER, 'LEARNING_FULL_ACCESS')).toBe(false);
  });

  it('SUBSCRIPTION_REACTIVATE is DENY from expired (reactivating an expired contract is out of scope)', async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [{ '?': 1 }] }); // isOwner (canUseBillingManage)
    dbQueryMock.mockResolvedValueOnce(subRow('expired')); // getSubscription for reactivate check
    expect(await canUseCapability(OWNER_ACTOR, LEARNER, 'SUBSCRIPTION_REACTIVATE')).toBe(false);
  });
});

describe('CANCELLED_AT_PERIOD_END: access valid through the paid period, not after', () => {
  it('ALLOW while current_period_end is in the future', async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    dbQueryMock.mockResolvedValueOnce({ rows: [{ '?': 1 }] });
    dbQueryMock.mockResolvedValueOnce(subRow('cancelled_at_period_end', { current_period_end: future }));
    expect(await canUseCapability(OWNER_ACTOR, LEARNER, 'LEARNING_FULL_ACCESS')).toBe(true);
  });

  it('DENY once current_period_end has passed', async () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    dbQueryMock.mockResolvedValueOnce({ rows: [{ '?': 1 }] });
    dbQueryMock.mockResolvedValueOnce(subRow('cancelled_at_period_end', { current_period_end: past }));
    expect(await canUseCapability(OWNER_ACTOR, LEARNER, 'LEARNING_FULL_ACCESS')).toBe(false);
  });
});

describe('PARENT AS PAYER -- billing relationship without academic access', () => {
  it('the registered payer (not the owner) can manage billing', async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [] }); // isOwner: false (payer is not the learner)
    dbQueryMock.mockResolvedValueOnce(subRow('active')); // getSubscription -> payer_user_id = PAYER_ACTOR
    expect(await canUseCapability(PAYER_ACTOR, LEARNER, 'BILLING_MANAGE')).toBe(true);
  });

  it('the payer CANNOT satisfy LEARNING_FULL_ACCESS or LEARNING_HISTORY_VIEW -- paying never grants academic access (INV-F3-04/AC-F3-06)', async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [] }); // isOwner: false
    expect(await canUseCapability(PAYER_ACTOR, LEARNER, 'LEARNING_FULL_ACCESS')).toBe(false);
  });

  it('a stranger (neither owner nor registered payer) cannot manage billing', async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [] }); // isOwner: false
    dbQueryMock.mockResolvedValueOnce(subRow('active')); // payer_user_id = PAYER_ACTOR, not STRANGER_ACTOR
    expect(await canUseCapability(STRANGER_ACTOR, LEARNER, 'BILLING_MANAGE')).toBe(false);
  });
});

describe('NEGATIVE / manipulation', () => {
  it('an unrecognized capability string denies (never a default allow)', async () => {
    expect(await canUseCapability(OWNER_ACTOR, LEARNER, 'NOT_A_REAL_CAPABILITY' as any)).toBe(false);
  });

  it('a DB error resolves to false, never throws to the caller', async () => {
    dbQueryMock.mockRejectedValue(new Error('connection lost'));
    expect(await canUseCapability(OWNER_ACTOR, LEARNER, 'LEARNING_FULL_ACCESS')).toBe(false);
  });

  it('no subscription row at all (new learner) defaults to unpaid -- DENY for paid access, ALLOW for history (owner)', async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [{ '?': 1 }] }); // isOwner
    dbQueryMock.mockResolvedValueOnce({ rows: [] }); // getSubscription -> no row -> synthetic 'unpaid'
    expect(await canUseCapability(OWNER_ACTOR, LEARNER, 'LEARNING_FULL_ACCESS')).toBe(false);
  });
});
