/**
 * Professional Admin Console -- "Membresías y pagos". Covers the
 * task's own required test list for this domain (numbered here to
 * match that list). Route-level access control (unauthenticated, each
 * role, rate limiting) is NOT re-tested per membership route: every
 * `/api/admin/memberships/**` route is gated by the same
 * `guardAdminUsersRoute` chokepoint already proven exhaustively in
 * admin-users-routes.test.ts (cases 1-6) -- that coverage applies
 * identically here since nothing in this domain bypasses the gate.
 *
 * Every mutating function below now also computes `isSelfApproval`
 * (an extra `SELECT user_id FROM students WHERE id = $1` at the end,
 * mocked here with `{ user_id: 'someone-else' }` for the normal,
 * non-self case) -- see `admin-self-approval.test.ts` for the
 * self-approval-specific cases (STUDYUS_ADMIN administering their own
 * membership, marked `SELF_APPROVED_BY_SYSTEM_ADMIN` in the audit).
 * "Vencimiento automático" (an admin grant expiring lazily on its own,
 * without a cron) is covered in
 * `tests/unit/f3-effective-entitlement.test.ts`, not here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const dbQueryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => dbQueryMock(...a) } }));

const recordAdminActionMock = vi.fn();
vi.mock('@/lib/admin/audit', () => ({ recordAdminAction: (...a: any[]) => recordAdminActionMock(...a) }));

import {
  approveManualPayment,
  grantAdminLicense,
  revokeLicenseGrant,
  suspendMembership,
  reactivateMembership,
  cancelMembership,
  recordRefundOrDispute,
  reconcileMembership,
  detectMembershipInconsistencies,
  MissingExpirationError,
  DuplicateReferenceError,
} from '@/services/membership-admin.service';

const ACTOR = 'admin-1';
const STUDENT_ID = 'student-A';
const SUBSCRIPTION_ID = 'sub-1';

function subscriptionRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: SUBSCRIPTION_ID,
    student_id: STUDENT_ID,
    status: 'unpaid',
    plan: null,
    payer_user_id: null,
    current_period_end: null,
    manually_set_by_admin: false,
    ...overrides,
  };
}

beforeEach(() => {
  dbQueryMock.mockReset();
  recordAdminActionMock.mockReset();
});

describe('1/4/5: approveManualPayment activates the license for the selected beneficiary, never the payer', () => {
  it('a valid manual payment for a student paid for by a parent activates the CHILD subscription, not one belonging to the payer', async () => {
    const PARENT_PAYER_ID = 'parent-user-9';
    dbQueryMock
      .mockResolvedValueOnce({ rows: [{ id: SUBSCRIPTION_ID }] }) // ensureSubscriptionRow
      .mockResolvedValueOnce({ rows: [subscriptionRow({ status: 'unpaid' })] }) // getSubscription (before)
      .mockResolvedValueOnce({ rows: [] }) // INSERT INTO payments
      .mockResolvedValueOnce({ rows: [subscriptionRow({ status: 'unpaid' })] }) // getSubscription inside transitionSubscriptionStatus
      .mockResolvedValueOnce({ rows: [] }) // INSERT/UPDATE subscriptions (status -> active)
      .mockResolvedValueOnce({ rows: [] }) // UPDATE subscriptions SET plan/source/current_period_end/granted_by_user_id
      .mockResolvedValueOnce({ rows: [] }) // INSERT INTO subscription_events
      .mockResolvedValueOnce({ rows: [{ user_id: 'someone-else' }] }); // isSelfApproval (SELECT user_id FROM students)

    const result = await approveManualPayment(ACTOR, {
      studentId: STUDENT_ID,
      plan: 'MONTHLY',
      amountCents: 5000,
      currency: 'USD',
      occurredAt: new Date().toISOString(),
      reference: 'txn-001',
      method: 'transferencia',
      validUntil: new Date(Date.now() + 30 * 86400000).toISOString(),
      payerUserId: PARENT_PAYER_ID,
    });

    expect(result.subscriptionId).toBe(SUBSCRIPTION_ID);

    const paymentInsertCall = dbQueryMock.mock.calls.find((c) => String(c[0]).includes('INSERT INTO payments'))!;
    expect(paymentInsertCall[1][0]).toBe(SUBSCRIPTION_ID); // subscription_id -- the child's, not the parent's
    expect(paymentInsertCall[1][1]).toBe(PARENT_PAYER_ID); // payer_user_id recorded, but access is not granted to them

    const updateCall = dbQueryMock.mock.calls.find((c) => String(c[0]).includes('UPDATE subscriptions SET plan'))!;
    expect(updateCall[1][4]).toBe(SUBSCRIPTION_ID); // still targets the beneficiary's subscription row
  });
});

describe('2: DuplicateReferenceError -- rejects a manual approval reusing a reference already recorded', () => {
  it('a unique-violation from the payments table (23505) surfaces as DuplicateReferenceError, never a silent success', async () => {
    dbQueryMock
      .mockResolvedValueOnce({ rows: [{ id: SUBSCRIPTION_ID }] }) // ensureSubscriptionRow
      .mockResolvedValueOnce({ rows: [subscriptionRow({ status: 'unpaid' })] }) // getSubscription (before)
      .mockRejectedValueOnce(Object.assign(new Error('duplicate key'), { code: '23505' })); // INSERT INTO payments

    await expect(
      approveManualPayment(ACTOR, {
        studentId: STUDENT_ID,
        plan: 'MONTHLY',
        amountCents: 5000,
        currency: 'USD',
        occurredAt: new Date().toISOString(),
        reference: 'txn-dup',
        method: 'transferencia',
        validUntil: new Date(Date.now() + 30 * 86400000).toISOString(),
      })
    ).rejects.toThrow(DuplicateReferenceError);
  });
});

describe('6/7: a payment never grants a role and never creates a parent-child relationship', () => {
  it('every db.query issued by approveManualPayment touches only subscriptions/payments/subscription_events -- never user_roles or parent_student_relationships', async () => {
    dbQueryMock
      .mockResolvedValueOnce({ rows: [{ id: SUBSCRIPTION_ID }] })
      .mockResolvedValueOnce({ rows: [subscriptionRow({ status: 'unpaid' })] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [subscriptionRow({ status: 'unpaid' })] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ user_id: 'someone-else' }] }); // isSelfApproval

    await approveManualPayment(ACTOR, {
      studentId: STUDENT_ID,
      plan: 'MONTHLY',
      amountCents: 5000,
      currency: 'USD',
      occurredAt: new Date().toISOString(),
      reference: 'txn-002',
      method: 'transferencia',
      validUntil: new Date(Date.now() + 30 * 86400000).toISOString(),
      payerUserId: 'parent-user-9',
    });

    const sql = dbQueryMock.mock.calls.map((c) => String(c[0]));
    expect(sql.some((s) => /user_roles/i.test(s))).toBe(false);
    expect(sql.some((s) => /parent_student_relationships/i.test(s))).toBe(false);
  });
});

describe('8/10: suspendMembership cuts premium access without ever touching the user account itself', () => {
  it('transitions the subscription to suspended and never queries the users table (distinct from suspending the user account)', async () => {
    dbQueryMock
      .mockResolvedValueOnce({ rows: [subscriptionRow({ status: 'active' })] }) // getSubscription (before)
      .mockResolvedValueOnce({ rows: [subscriptionRow({ status: 'active' })] }) // getSubscription inside transitionSubscriptionStatus
      .mockResolvedValueOnce({ rows: [] }) // INSERT/UPDATE subscriptions -> suspended
      .mockResolvedValueOnce({ rows: [{ id: SUBSCRIPTION_ID }] }) // SELECT id FROM subscriptions WHERE student_id
      .mockResolvedValueOnce({ rows: [] }) // INSERT INTO subscription_events
      .mockResolvedValueOnce({ rows: [{ user_id: 'someone-else' }] }); // isSelfApproval

    await suspendMembership(ACTOR, STUDENT_ID, 'pago no confirmado');

    const sql = dbQueryMock.mock.calls.map((c) => String(c[0]));
    expect(sql.some((s) => /FROM users\b/i.test(s) || /UPDATE\s+users\b/i.test(s))).toBe(false);
    expect(recordAdminActionMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'MEMBERSHIP_SUSPENDED', reason: 'pago no confirmado' }));
  });
});

describe('11: reactivateMembership restores only the entitlement, chaining the certified suspended -> reactivated -> active path', () => {
  it('never touches user_roles/profiles and audits MEMBERSHIP_REACTIVATED', async () => {
    dbQueryMock
      .mockResolvedValueOnce({ rows: [subscriptionRow({ status: 'suspended' })] }) // getSubscription (before)
      .mockResolvedValueOnce({ rows: [subscriptionRow({ status: 'suspended' })] }) // getSubscription inside transition #1 (-> reactivated)
      .mockResolvedValueOnce({ rows: [] }) // INSERT/UPDATE subscriptions -> reactivated
      .mockResolvedValueOnce({ rows: [subscriptionRow({ status: 'reactivated' })] }) // getSubscription inside transition #2 (-> active)
      .mockResolvedValueOnce({ rows: [] }) // INSERT/UPDATE subscriptions -> active
      .mockResolvedValueOnce({ rows: [{ id: SUBSCRIPTION_ID }] }) // SELECT id FROM subscriptions WHERE student_id
      .mockResolvedValueOnce({ rows: [] }) // INSERT INTO subscription_events
      .mockResolvedValueOnce({ rows: [{ user_id: 'someone-else' }] }); // isSelfApproval

    await reactivateMembership(ACTOR, STUDENT_ID, 'pago confirmado por el banco');

    const sql = dbQueryMock.mock.calls.map((c) => String(c[0]));
    expect(sql.some((s) => /user_roles|profiles/i.test(s))).toBe(false);
    expect(recordAdminActionMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'MEMBERSHIP_REACTIVATED' }));
  });

  it('refuses to reactivate a membership that is not currently suspended', async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [subscriptionRow({ status: 'active' })] });
    await expect(reactivateMembership(ACTOR, STUDENT_ID, 'motivo')).rejects.toThrow();
  });
});

describe('12: cancelMembership respects the effective date -- moves to cancelled_at_period_end, never an immediate cutoff', () => {
  it('transitions to cancelled_at_period_end, not an immediate "canceled"', async () => {
    dbQueryMock
      .mockResolvedValueOnce({ rows: [subscriptionRow({ status: 'active' })] })
      .mockResolvedValueOnce({ rows: [subscriptionRow({ status: 'active' })] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: SUBSCRIPTION_ID }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ user_id: 'someone-else' }] }); // isSelfApproval

    await cancelMembership(ACTOR, STUDENT_ID, 'solicitado por el estudiante');

    const transitionInsert = dbQueryMock.mock.calls.find((c) => String(c[0]).includes('ON CONFLICT (student_id) DO UPDATE'));
    expect(transitionInsert![1][1]).toBe('cancelled_at_period_end');
  });
});

describe('14: recordRefundOrDispute updates access per policy and marks the underlying payment', () => {
  it('a refund transitions the subscription to refunded and flips the matching SUCCEEDED payment to REFUNDED', async () => {
    dbQueryMock
      .mockResolvedValueOnce({ rows: [subscriptionRow({ status: 'active' })] }) // getSubscription (before)
      .mockResolvedValueOnce({ rows: [subscriptionRow({ status: 'active' })] }) // getSubscription inside transition
      .mockResolvedValueOnce({ rows: [] }) // INSERT/UPDATE subscriptions -> refunded
      .mockResolvedValueOnce({ rows: [{ id: SUBSCRIPTION_ID }] }) // SELECT id FROM subscriptions WHERE student_id
      .mockResolvedValueOnce({ rows: [] }) // UPDATE payments SET status = 'REFUNDED'
      .mockResolvedValueOnce({ rows: [] }) // INSERT INTO subscription_events
      .mockResolvedValueOnce({ rows: [{ user_id: 'someone-else' }] }); // isSelfApproval

    await recordRefundOrDispute(ACTOR, STUDENT_ID, 'REFUND', 'reembolso solicitado y confirmado por el banco');

    const paymentsUpdate = dbQueryMock.mock.calls.find((c) => String(c[0]).includes('UPDATE payments SET status'))!;
    expect(paymentsUpdate[1][0]).toBe('REFUNDED');
    expect(recordAdminActionMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'REFUND_DISPUTE_RECORDED', newState: { type: 'REFUND', newStatus: 'refunded' } }));
  });
});

describe('15: grantAdminLicense refuses any grant without an explicit expiration date', () => {
  it('throws MissingExpirationError before issuing a single query when expiresAt is empty', async () => {
    await expect(
      grantAdminLicense(ACTOR, { studentId: STUDENT_ID, reason: 'beca', expiresAt: '' })
    ).rejects.toThrow(MissingExpirationError);
    expect(dbQueryMock).not.toHaveBeenCalled();
  });

  it('a grant with an expiration date activates the license and records it', async () => {
    dbQueryMock
      .mockResolvedValueOnce({ rows: [{ id: SUBSCRIPTION_ID }] }) // ensureSubscriptionRow
      .mockResolvedValueOnce({ rows: [subscriptionRow({ status: 'unpaid' })] }) // getSubscription (before)
      .mockResolvedValueOnce({ rows: [subscriptionRow({ status: 'unpaid' })] }) // getSubscription inside transition
      .mockResolvedValueOnce({ rows: [] }) // INSERT/UPDATE subscriptions -> active
      .mockResolvedValueOnce({ rows: [] }) // UPDATE subscriptions SET manually_set_by_admin ...
      .mockResolvedValueOnce({ rows: [] }) // INSERT INTO subscription_events
      .mockResolvedValueOnce({ rows: [{ user_id: 'someone-else' }] }); // isSelfApproval

    const expiresAt = new Date(Date.now() + 90 * 86400000).toISOString();
    const result = await grantAdminLicense(ACTOR, { studentId: STUDENT_ID, reason: 'beca de mérito', expiresAt });
    expect(result.subscriptionId).toBe(SUBSCRIPTION_ID);
    expect(recordAdminActionMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'LICENSE_GRANTED', newState: { expiresAt, newStatus: 'active' } }));
  });
});

describe('revokeLicenseGrant reverses an administrative grant before its expiration', () => {
  it('suspends the subscription and audits LICENSE_REVOKED', async () => {
    dbQueryMock
      .mockResolvedValueOnce({ rows: [subscriptionRow({ status: 'active', manually_set_by_admin: true })] })
      .mockResolvedValueOnce({ rows: [subscriptionRow({ status: 'active' })] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: SUBSCRIPTION_ID }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ user_id: 'someone-else' }] }); // isSelfApproval

    await revokeLicenseGrant(ACTOR, STUDENT_ID, 'beca finalizada anticipadamente');
    expect(recordAdminActionMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'LICENSE_REVOKED' }));
  });
});

describe('20: audit records for a payment approval never carry more than plan/amount/currency -- no card or account data exists in this schema', () => {
  it('PAYMENT_APPROVED newState is exactly {plan, amountCents, currency}', async () => {
    dbQueryMock
      .mockResolvedValueOnce({ rows: [{ id: SUBSCRIPTION_ID }] })
      .mockResolvedValueOnce({ rows: [subscriptionRow({ status: 'unpaid' })] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [subscriptionRow({ status: 'unpaid' })] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ user_id: 'someone-else' }] }); // isSelfApproval

    await approveManualPayment(ACTOR, {
      studentId: STUDENT_ID,
      plan: 'ANNUAL',
      amountCents: 120000,
      currency: 'USD',
      occurredAt: new Date().toISOString(),
      reference: 'txn-audit-1',
      method: 'transferencia',
      evidenceReference: 'https://internal/evidence/1',
      notes: 'confirmado por contabilidad',
      validUntil: new Date(Date.now() + 365 * 86400000).toISOString(),
    });

    const call = recordAdminActionMock.mock.calls.find((c) => c[0].action === 'PAYMENT_APPROVED')![0];
    expect(call.newState).toEqual({ plan: 'ANNUAL', amountCents: 120000, currency: 'USD', newStatus: 'active' });
  });
});

describe('21: reconcileMembership never performs an automatic repair -- it only records that a human reviewed the state', () => {
  it('issues zero db.query calls and only writes the audit trail', async () => {
    await reconcileMembership(ACTOR, SUBSCRIPTION_ID);
    expect(dbQueryMock).not.toHaveBeenCalled();
    expect(recordAdminActionMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'MEMBERSHIP_RECONCILED', targetId: SUBSCRIPTION_ID }));
  });
});

describe('detectMembershipInconsistencies -- a bounded, real set of checks, never a fabricated repair', () => {
  it('surfaces each of the 4 documented finding types when their query returns rows', async () => {
    dbQueryMock
      .mockResolvedValueOnce({ rows: [{ id: 'sub-a', student_id: 'student-a' }] }) // stale parent grants
      .mockResolvedValueOnce({ rows: [{ id: 'sub-b', student_id: 'student-b' }] }) // expired grant still active
      .mockResolvedValueOnce({ rows: [{ id: 'sub-c', student_id: 'student-c' }] }) // active without source
      .mockResolvedValueOnce({ rows: [{ id: 'sub-d', student_id: 'student-d' }] }); // refunded but active

    const findings = await detectMembershipInconsistencies();
    const types = findings.map((f) => f.type);
    expect(types).toEqual([
      'PARENT_PAYER_WITHOUT_ACTIVE_RELATIONSHIP',
      'GRANT_EXPIRED_STILL_ACTIVE',
      'ACTIVE_WITHOUT_SOURCE',
      'REFUNDED_PAYMENT_STILL_ACTIVE',
    ]);
  });

  it('returns no findings when every check comes back empty', async () => {
    dbQueryMock.mockResolvedValue({ rows: [] });
    const findings = await detectMembershipInconsistencies();
    expect(findings).toEqual([]);
  });
});
