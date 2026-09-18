/**
 * F3 -- integration-style negative security tests for the new billing/
 * entitlement routes. Covers §24: manipulated ids, foreign-payer
 * requests, suspended-learner paid execution, unsupported status
 * claims.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const verifyAuthMock = vi.fn();
vi.mock('@/lib/auth', () => ({ verifyAuth: () => verifyAuthMock() }));

const getOrCreateCanonicalUserMock = vi.fn();
vi.mock('@/lib/identity', () => ({ getOrCreateCanonicalUser: (...a: any[]) => getOrCreateCanonicalUserMock(...a) }));

const canAccessLearnerMock = vi.fn();
vi.mock('@/lib/authorization', () => ({ canAccessLearner: (...a: any[]) => canAccessLearnerMock(...a) }));

const canUseCapabilityMock = vi.fn();
const getSubscriptionMock = vi.fn();
const transitionSubscriptionStatusMock = vi.fn();
const { FakeInvalidTransitionError } = vi.hoisted(() => ({
  FakeInvalidTransitionError: class extends Error {},
}));
vi.mock('@/lib/entitlements', () => ({
  canUseCapability: (...a: any[]) => canUseCapabilityMock(...a),
  getSubscription: (...a: any[]) => getSubscriptionMock(...a),
  transitionSubscriptionStatus: (...a: any[]) => transitionSubscriptionStatusMock(...a),
  InvalidSubscriptionTransitionError: FakeInvalidTransitionError,
}));

import { GET as subscriptionGET } from '@/app/api/billing/subscription/route';
import { POST as reactivatePOST } from '@/app/api/billing/reactivate/route';
import { GET as eligibilityGET } from '@/app/api/learning/session-eligibility/route';

function urlReq(url: string) {
  return { url } as any;
}
function jsonReq(body: any) {
  return { json: async () => body } as any;
}

const ACTOR = { id: 'actor-1', clerkId: 'clerk-1', email: null, status: 'ACTIVE' as const, activeWorkspace: null };

beforeEach(() => {
  verifyAuthMock.mockReset().mockResolvedValue({ userId: 'clerk-1', email: null, role: 'student' });
  getOrCreateCanonicalUserMock.mockReset().mockResolvedValue(ACTOR);
  canAccessLearnerMock.mockReset().mockResolvedValue(false);
  canUseCapabilityMock.mockReset().mockResolvedValue(false);
  getSubscriptionMock.mockReset().mockResolvedValue({ id: 'sub-1', studentId: 'learner-1', status: 'active', plan: 'MONTHLY', payerUserId: 'actor-1', currentPeriodEnd: null, manuallySetByAdmin: false });
  transitionSubscriptionStatusMock.mockReset().mockResolvedValue(undefined);
});

describe('ANONYMOUS: every F3 route denies before touching entitlements', () => {
  it('billing subscription view', async () => {
    verifyAuthMock.mockResolvedValue(null);
    const res: any = await subscriptionGET(urlReq('https://studyus.test/api/billing/subscription?studentId=learner-1'));
    expect(res.status).toBe(401);
    expect(canUseCapabilityMock).not.toHaveBeenCalled();
  });

  it('reactivate', async () => {
    verifyAuthMock.mockResolvedValue(null);
    const res: any = await reactivatePOST(jsonReq({ studentId: '11111111-1111-4111-8111-111111111111' }));
    expect(res.status).toBe(401);
    expect(transitionSubscriptionStatusMock).not.toHaveBeenCalled();
  });

  it('session eligibility', async () => {
    verifyAuthMock.mockResolvedValue(null);
    const res: any = await eligibilityGET(urlReq('https://studyus.test/api/learning/session-eligibility?studentId=learner-1'));
    expect(res.status).toBe(401);
  });
});

describe('FOREIGN PAYER: a stranger requesting billing details for a learner they neither own nor pay for', () => {
  it('is denied without confirming the learner exists', async () => {
    canUseCapabilityMock.mockResolvedValue(false);
    const res: any = await subscriptionGET(urlReq('https://studyus.test/api/billing/subscription?studentId=someone-elses-learner'));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toMatch(/someone-elses-learner/);
    expect(getSubscriptionMock).not.toHaveBeenCalled();
  });
});

describe('PAYER TRIES TO READ LEARNER ACADEMIC DATA: billing entitlement never implies F2 access', () => {
  it('session-eligibility for a payer-only actor (authorized=false from F2) is not eligible even if entitled', async () => {
    canAccessLearnerMock.mockResolvedValue(false); // F2: no academic relationship
    canUseCapabilityMock.mockResolvedValue(true); // F3: is the payer, so entitled for LEARNING_FULL_ACCESS query would be false really, but simulate entitled=true to prove the AND
    const res: any = await eligibilityGET(urlReq('https://studyus.test/api/learning/session-eligibility?studentId=learner-1'));
    const body = await res.json();
    expect(body.data.authorized).toBe(false);
    expect(body.data.eligible).toBe(false);
  });
});

describe('SUSPENDED LEARNER TRIES PAID EXECUTION', () => {
  it('session-eligibility is false when F3 denies even though F2 authorizes (owner)', async () => {
    canAccessLearnerMock.mockResolvedValue(true); // owner, F2 always allows
    canUseCapabilityMock.mockResolvedValue(false); // F3: suspended -> LEARNING_FULL_ACCESS denied
    const res: any = await eligibilityGET(urlReq('https://studyus.test/api/learning/session-eligibility?studentId=learner-1'));
    const body = await res.json();
    expect(body.data.authorized).toBe(true);
    expect(body.data.entitled).toBe(false);
    expect(body.data.eligible).toBe(false);
  });
});

describe('CLIENT CLAIMS ACTIVE STATUS / UNSUPPORTED TRANSITION', () => {
  it('reactivate ignores any client-supplied status claim -- only studentId is accepted by the schema', async () => {
    canUseCapabilityMock.mockResolvedValue(true);
    getSubscriptionMock.mockResolvedValue({ id: 'sub-1', studentId: '11111111-1111-4111-8111-111111111111', status: 'suspended', plan: 'MONTHLY', payerUserId: 'actor-1', currentPeriodEnd: null, manuallySetByAdmin: false });
    await reactivatePOST(jsonReq({ studentId: '11111111-1111-4111-8111-111111111111', status: 'active', subscriptionStatus: 'ACTIVE' } as any));
    // only ever transitions to the state-machine-derived next status, never a client-supplied one
    expect(transitionSubscriptionStatusMock).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', 'reactivated');
  });

  it('reactivate on a non-reactivatable status (e.g. active) is rejected with NOT_REACTIVATABLE, never silently no-ops as success', async () => {
    canUseCapabilityMock.mockResolvedValue(true);
    getSubscriptionMock.mockResolvedValue({ id: 'sub-1', studentId: '11111111-1111-4111-8111-111111111111', status: 'active', plan: 'MONTHLY', payerUserId: 'actor-1', currentPeriodEnd: null, manuallySetByAdmin: false });
    const res: any = await reactivatePOST(jsonReq({ studentId: '11111111-1111-4111-8111-111111111111' }));
    expect(res.status).toBe(409);
    expect(transitionSubscriptionStatusMock).not.toHaveBeenCalled();
  });

  it('an invalid transition rejected by the state machine surfaces as a controlled 409, never a 500', async () => {
    canUseCapabilityMock.mockResolvedValue(true);
    getSubscriptionMock.mockResolvedValue({ id: 'sub-1', studentId: '11111111-1111-4111-8111-111111111111', status: 'suspended', plan: 'MONTHLY', payerUserId: 'actor-1', currentPeriodEnd: null, manuallySetByAdmin: false });
    transitionSubscriptionStatusMock.mockRejectedValue(new FakeInvalidTransitionError('bad transition'));
    const res: any = await reactivatePOST(jsonReq({ studentId: '11111111-1111-4111-8111-111111111111' }));
    expect(res.status).toBe(409);
  });
});

describe('MANIPULATED studentId: malformed/non-uuid input rejected at the schema', () => {
  it('reactivate rejects a non-uuid studentId before touching any service', async () => {
    const res: any = await reactivatePOST(jsonReq({ studentId: 'not-a-uuid' }));
    expect(res.status).toBe(400);
    expect(canUseCapabilityMock).not.toHaveBeenCalled();
  });
});
