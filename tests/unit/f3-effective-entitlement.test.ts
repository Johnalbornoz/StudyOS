/**
 * §15 "Expiración efectiva" -- an admin-granted license past its own
 * `grant_expires_at` must lose access on the FIRST request that checks
 * it, never waiting on a cron that may not exist. `getEffectiveSubscription`
 * (src/lib/entitlements/subscription.service.ts) is the authority every
 * premium check must go through -- proven here directly, and through
 * `canUseCapability` (the F3 entitlement gate every route actually
 * calls) to prove the wiring is real, not just available.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const dbQueryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => dbQueryMock(...a) } }));

import { getEffectiveSubscription } from '@/lib/entitlements/subscription.service';
import { canUseCapability } from '@/lib/entitlements';

const STUDENT_ID = 'student-1';
const SUBSCRIPTION_ID = 'sub-1';

function subRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: SUBSCRIPTION_ID,
    student_id: STUDENT_ID,
    status: 'active',
    plan: 'MONTHLY',
    payer_user_id: null,
    current_period_end: null,
    manually_set_by_admin: true,
    grant_expires_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  dbQueryMock.mockReset();
});

describe('getEffectiveSubscription -- lazy reconciliation of an expired admin grant', () => {
  it('an admin grant past its own expiration is reconciled to expired on THIS call, not left as active', async () => {
    const pastDate = new Date(Date.now() - 86400000).toISOString(); // yesterday
    dbQueryMock
      .mockResolvedValueOnce({ rows: [subRow({ status: 'active', grant_expires_at: pastDate })] }) // getSubscription
      .mockResolvedValueOnce({ rows: [subRow({ status: 'active', grant_expires_at: pastDate })] }) // getSubscription inside transitionSubscriptionStatus
      .mockResolvedValueOnce({ rows: [] }) // INSERT/UPDATE subscriptions -> expired
      .mockResolvedValueOnce({ rows: [] }); // INSERT INTO subscription_events

    const result = await getEffectiveSubscription(STUDENT_ID);
    expect(result.status).toBe('expired');

    const eventInsert = dbQueryMock.mock.calls.find((c) => String(c[0]).includes('INSERT INTO subscription_events'));
    expect(eventInsert).toBeDefined();
    expect(eventInsert![1]).toEqual([SUBSCRIPTION_ID, 'active']); // [subscriptionId, previousStatus] -- new_status/event_type/reason are inlined literals in this lazy-reconciliation INSERT
    expect(String(eventInsert![0])).toContain("'EXPIRED'");
    expect(String(eventInsert![0])).toContain("'expired'");
  });

  it('a second call finds it already expired and does nothing further -- idempotent, no duplicate reconciliation', async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [subRow({ status: 'expired', grant_expires_at: new Date(Date.now() - 86400000).toISOString() })] });
    const result = await getEffectiveSubscription(STUDENT_ID);
    expect(result.status).toBe('expired');
    expect(dbQueryMock).toHaveBeenCalledTimes(1); // only the initial getSubscription -- no further writes
  });

  it('an admin grant NOT yet past its expiration stays active, untouched', async () => {
    const futureDate = new Date(Date.now() + 86400000).toISOString();
    dbQueryMock.mockResolvedValueOnce({ rows: [subRow({ status: 'active', grant_expires_at: futureDate })] });
    const result = await getEffectiveSubscription(STUDENT_ID);
    expect(result.status).toBe('active');
    expect(dbQueryMock).toHaveBeenCalledTimes(1);
  });

  it('a real paid subscription (not an admin grant) is never touched by this reconciliation, regardless of dates', async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [subRow({ status: 'active', manually_set_by_admin: false, grant_expires_at: null })] });
    const result = await getEffectiveSubscription(STUDENT_ID);
    expect(result.status).toBe('active');
    expect(dbQueryMock).toHaveBeenCalledTimes(1);
  });

  it('an admin grant with no expiration date at all is left alone (should never happen -- grantAdminLicense enforces one -- but this must not crash or wrongly expire)', async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [subRow({ status: 'active', manually_set_by_admin: true, grant_expires_at: null })] });
    const result = await getEffectiveSubscription(STUDENT_ID);
    expect(result.status).toBe('active');
  });

  it('past_due and reactivated admin grants past expiration are also reconciled (all 3 PAID_ACCESS_STATUSES covered)', async () => {
    for (const status of ['past_due', 'reactivated'] as const) {
      dbQueryMock.mockReset();
      const pastDate = new Date(Date.now() - 86400000).toISOString();
      dbQueryMock
        .mockResolvedValueOnce({ rows: [subRow({ status, grant_expires_at: pastDate })] })
        .mockResolvedValueOnce({ rows: [subRow({ status, grant_expires_at: pastDate })] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const result = await getEffectiveSubscription(STUDENT_ID);
      expect(result.status).toBe('expired');
    }
  });
});

describe('canUseLearningFullAccess (via canUseCapability) uses the effective, reconciled entitlement -- an expired admin grant denies access on the same request', () => {
  it('owner + admin grant past expiration -> LEARNING_FULL_ACCESS DENY, even though the row still said active before this call', async () => {
    const pastDate = new Date(Date.now() - 86400000).toISOString();
    dbQueryMock
      .mockResolvedValueOnce({ rows: [{ '?': 1 }] }) // isOwner
      .mockResolvedValueOnce({ rows: [subRow({ status: 'active', grant_expires_at: pastDate })] }) // getSubscription
      .mockResolvedValueOnce({ rows: [subRow({ status: 'active', grant_expires_at: pastDate })] }) // getSubscription inside transition
      .mockResolvedValueOnce({ rows: [] }) // INSERT/UPDATE -> expired
      .mockResolvedValueOnce({ rows: [] }); // INSERT INTO subscription_events

    expect(await canUseCapability('owner-1', STUDENT_ID, 'LEARNING_FULL_ACCESS')).toBe(false);
  });

  it('owner + admin grant still within its expiration -> LEARNING_FULL_ACCESS ALLOW', async () => {
    const futureDate = new Date(Date.now() + 86400000).toISOString();
    dbQueryMock
      .mockResolvedValueOnce({ rows: [{ '?': 1 }] }) // isOwner
      .mockResolvedValueOnce({ rows: [subRow({ status: 'active', grant_expires_at: futureDate })] }); // getSubscription, no reconciliation needed

    expect(await canUseCapability('owner-1', STUDENT_ID, 'LEARNING_FULL_ACCESS')).toBe(true);
  });
});
