/**
 * Professional Admin Console -- a STUDYUS_ADMIN administering their
 * OWN membership. Explicitly allowed by the task's own spec ("no se
 * exige obligatoriamente un segundo administrador"); what changes is
 * only the audit trail, never the authorization outcome. The server
 * always recomputes this from the real ownership of `studentId` --
 * never trusts a client-supplied flag.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const dbQueryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => dbQueryMock(...a) } }));

const recordAdminActionMock = vi.fn();
vi.mock('@/lib/admin/audit', () => ({ recordAdminAction: (...a: any[]) => recordAdminActionMock(...a) }));

import { approveManualPayment, suspendMembership, getMembershipDetail, searchStudentBeneficiaries } from '@/services/membership-admin.service';

const ADMIN_USER_ID = 'admin-1';
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

describe('a STUDYUS_ADMIN approving a payment for their own account is allowed, and marked in the audit', () => {
  it('approveManualPayment succeeds and marks SELF_APPROVED_BY_SYSTEM_ADMIN when the beneficiary student is owned by the acting admin', async () => {
    dbQueryMock
      .mockResolvedValueOnce({ rows: [{ id: SUBSCRIPTION_ID }] }) // ensureSubscriptionRow
      .mockResolvedValueOnce({ rows: [subscriptionRow({ status: 'unpaid' })] }) // getSubscription (before)
      .mockResolvedValueOnce({ rows: [] }) // INSERT INTO payments
      .mockResolvedValueOnce({ rows: [subscriptionRow({ status: 'unpaid' })] }) // getSubscription inside transition
      .mockResolvedValueOnce({ rows: [] }) // INSERT/UPDATE subscriptions -> active
      .mockResolvedValueOnce({ rows: [] }) // UPDATE subscriptions SET plan/source/...
      .mockResolvedValueOnce({ rows: [] }) // INSERT INTO subscription_events
      .mockResolvedValueOnce({ rows: [{ user_id: ADMIN_USER_ID }] }); // isSelfApproval -- the admin owns this student profile

    const result = await approveManualPayment(ADMIN_USER_ID, {
      studentId: STUDENT_ID,
      plan: 'MONTHLY',
      amountCents: 5000,
      currency: 'USD',
      occurredAt: new Date().toISOString(),
      reference: 'self-txn-1',
      method: 'transferencia',
      validUntil: new Date(Date.now() + 30 * 86400000).toISOString(),
    });

    expect(result.subscriptionId).toBe(SUBSCRIPTION_ID); // never blocked

    const call = recordAdminActionMock.mock.calls.find((c) => c[0].action === 'PAYMENT_APPROVED')![0];
    expect(call.newState.selfApproved).toBe(true);
    expect(call.newState.selfApprovalMarker).toBe('SELF_APPROVED_BY_SYSTEM_ADMIN');
    expect(call.previousState).toEqual({ status: 'unpaid' });
  });
});

describe('the same action for a DIFFERENT beneficiary is never marked as self-approved', () => {
  it('suspendMembership omits selfApproved entirely when the student belongs to someone else', async () => {
    dbQueryMock
      .mockResolvedValueOnce({ rows: [subscriptionRow({ status: 'active' })] }) // getSubscription (before)
      .mockResolvedValueOnce({ rows: [subscriptionRow({ status: 'active' })] }) // getSubscription inside transition
      .mockResolvedValueOnce({ rows: [] }) // INSERT/UPDATE subscriptions -> suspended
      .mockResolvedValueOnce({ rows: [{ id: SUBSCRIPTION_ID }] }) // SELECT id FROM subscriptions WHERE student_id
      .mockResolvedValueOnce({ rows: [] }) // INSERT INTO subscription_events
      .mockResolvedValueOnce({ rows: [{ user_id: 'a-different-user' }] }); // isSelfApproval -- NOT the admin

    await suspendMembership(ADMIN_USER_ID, STUDENT_ID, 'revisión de fraude');

    const call = recordAdminActionMock.mock.calls.find((c) => c[0].action === 'MEMBERSHIP_SUSPENDED')![0];
    expect(call.newState.selfApproved).toBeUndefined();
    expect(call.newState.selfApprovalMarker).toBeUndefined();
  });

  it('a student with no owning user (user_id NULL) is never treated as a self-approval', async () => {
    dbQueryMock
      .mockResolvedValueOnce({ rows: [subscriptionRow({ status: 'active' })] })
      .mockResolvedValueOnce({ rows: [subscriptionRow({ status: 'active' })] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: SUBSCRIPTION_ID }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ user_id: null }] }); // isSelfApproval -- unowned profile

    await suspendMembership(ADMIN_USER_ID, STUDENT_ID, 'motivo');
    const call = recordAdminActionMock.mock.calls.find((c) => c[0].action === 'MEMBERSHIP_SUSPENDED')![0];
    expect(call.newState.selfApproved).toBeUndefined();
  });
});

describe('getMembershipDetail computes isSelfApproval server-side for the viewer, never from a client claim', () => {
  it('isSelfApproval is true only when the viewer owns the beneficiary student', async () => {
    dbQueryMock
      .mockResolvedValueOnce({ rows: [{ id: SUBSCRIPTION_ID, student_id: STUDENT_ID, student_email: 'x@test.com', plan: 'MONTHLY', status: 'active', source: 'INDIVIDUAL_PAYMENT', payer_user_id: null, current_period_end: null, grant_expires_at: null, grant_reason: null, manually_set_by_admin: false, created_at: new Date() }] })
      .mockResolvedValueOnce({ rows: [] }) // timeline
      .mockResolvedValueOnce({ rows: [] }) // payments
      .mockResolvedValueOnce({ rows: [{ user_id: ADMIN_USER_ID }] }); // isSelfApproval

    const detail = await getMembershipDetail(SUBSCRIPTION_ID, ADMIN_USER_ID);
    expect(detail?.isSelfApproval).toBe(true);
  });

  it('isSelfApproval is false, and no self-approval query runs at all, when no viewer is provided', async () => {
    dbQueryMock
      .mockResolvedValueOnce({ rows: [{ id: SUBSCRIPTION_ID, student_id: STUDENT_ID, student_email: 'x@test.com', plan: 'MONTHLY', status: 'active', source: 'INDIVIDUAL_PAYMENT', payer_user_id: null, current_period_end: null, grant_expires_at: null, grant_reason: null, manually_set_by_admin: false, created_at: new Date() }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const detail = await getMembershipDetail(SUBSCRIPTION_ID);
    expect(detail?.isSelfApproval).toBe(false);
    expect(dbQueryMock).toHaveBeenCalledTimes(3); // no extra isSelfApproval query issued
  });
});

describe('searchStudentBeneficiaries exposes ownerUserId so the client can warn before submitting', () => {
  it('returns ownerUserId alongside each match, unmasked email included', async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [{ id: STUDENT_ID, email: 'full@test.com', user_id: ADMIN_USER_ID }] });
    const results = await searchStudentBeneficiaries('full@');
    expect(results).toEqual([{ studentId: STUDENT_ID, email: 'full@test.com', ownerUserId: ADMIN_USER_ID }]);
  });
});
