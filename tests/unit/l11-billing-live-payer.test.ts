/**
 * L11 / EN-3 -- billing routes: a registered payer keeps billing rights only
 * while the relationship that let them pay is still accepted. The learner
 * always keeps their own.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth', () => ({ verifyAuth: vi.fn().mockResolvedValue({ userId: 'clerk-1', email: null, role: 'student' }) }));
vi.mock('@/lib/identity', () => ({ getOrCreateCanonicalUser: vi.fn().mockResolvedValue({ id: 'actor-1' }) }));
vi.mock('@/lib/db', () => ({ db: { query: vi.fn().mockResolvedValue({ rows: [] }) } }));

const isOwnerMock = vi.fn();
const isActiveParentOfMock = vi.fn();
vi.mock('@/lib/authorization', () => ({ isOwner: (...a: any[]) => isOwnerMock(...a), isActiveParentOf: (...a: any[]) => isActiveParentOfMock(...a) }));

const transitionMock = vi.fn();
vi.mock('@/lib/entitlements', () => ({
  // F3 says yes: the actor IS the registered payer of this subscription.
  canUseCapability: vi.fn().mockResolvedValue(true),
  getSubscription: vi.fn().mockResolvedValue({ id: 'sub-1', studentId: 'learner-1', status: 'past_due', plan: 'MONTHLY', payerUserId: 'actor-1', currentPeriodEnd: null, manuallySetByAdmin: false, grantExpiresAt: null }),
  transitionSubscriptionStatus: (...a: any[]) => transitionMock(...a),
  InvalidSubscriptionTransitionError: class extends Error {},
}));

import { GET as subscriptionGET } from '@/app/api/billing/subscription/route';
import { POST as reactivatePOST } from '@/app/api/billing/reactivate/route';

const STUDENT = '11111111-1111-4111-8111-111111111111';
const get = () => subscriptionGET({ url: `https://studyus.test/api/billing/subscription?studentId=${STUDENT}` } as any);
const post = () => reactivatePOST({ json: async () => ({ studentId: STUDENT }) } as any);

beforeEach(() => {
  isOwnerMock.mockReset().mockResolvedValue(false);
  isActiveParentOfMock.mockReset().mockResolvedValue(false);
  transitionMock.mockReset().mockResolvedValue(undefined);
});

describe('registered payer whose relationship ended (student unlinked)', () => {
  it('can no longer read the subscription', async () => {
    expect((await get()).status).toBe(403);
  });
  it('can no longer reactivate it, and nothing is written', async () => {
    expect((await post()).status).toBe(403);
    expect(transitionMock).not.toHaveBeenCalled();
  });
});

describe('registered payer with a live relationship', () => {
  beforeEach(() => isActiveParentOfMock.mockResolvedValue(true));
  it('reads the subscription', async () => {
    expect((await get()).status).toBe(200);
  });
  it('reactivates a past_due paid subscription', async () => {
    expect((await post()).status).toBe(200);
    expect(transitionMock).toHaveBeenCalledWith(STUDENT, 'active');
  });
});

describe('the learner', () => {
  it('always manages their own billing, with no parent relationship consulted', async () => {
    isOwnerMock.mockResolvedValue(true);
    expect((await get()).status).toBe(200);
    expect(isActiveParentOfMock).not.toHaveBeenCalled();
  });
});
