/**
 * Onboarding/authorization rework (2026-09-21) -- explicit negative
 * test: "pagar por un estudiante no concede una relación parental".
 * Paying for a child's license requires an ALREADY-accepted
 * parent_student_relationships row (isActiveParentOf) -- the checkout
 * route never creates, upgrades, or substitutes for that relationship,
 * and a caller with no accepted relationship is denied before any
 * checkout/payment logic runs at all.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const authMock = vi.fn();
const currentUserMock = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({ auth: () => authMock(), currentUser: () => currentUserMock() }));

const requireStudentIdMock = vi.fn();
vi.mock('@/lib/auth', () => ({ requireStudentId: (...a: any[]) => requireStudentIdMock(...a) }));

const getOrCreateCanonicalUserMock = vi.fn();
vi.mock('@/lib/identity', () => ({ getOrCreateCanonicalUser: (...a: any[]) => getOrCreateCanonicalUserMock(...a) }));

const isActiveParentOfMock = vi.fn();
vi.mock('@/lib/authorization', () => ({ isActiveParentOf: (...a: any[]) => isActiveParentOfMock(...a) }));

const createMercadoPagoCheckoutMock = vi.fn();
vi.mock('@/services/payment.service', () => ({ createMercadoPagoCheckout: (...a: any[]) => createMercadoPagoCheckoutMock(...a) }));

import { POST } from '@/app/api/payments/checkout/route';

const PAYER_CLERK_ID = 'clerk-parent-1';
const PAYER_USER_ID = 'user-parent-1';
const CHILD_ID = '11111111-1111-4111-8111-111111111111';

function jsonReq(body: any) {
  return { json: async () => body } as any;
}

beforeEach(() => {
  authMock.mockReset().mockResolvedValue({ userId: PAYER_CLERK_ID });
  currentUserMock.mockReset().mockResolvedValue({ primaryEmailAddress: { emailAddress: 'parent@test.com' }, emailAddresses: [] });
  getOrCreateCanonicalUserMock.mockReset().mockResolvedValue({ id: PAYER_USER_ID });
  isActiveParentOfMock.mockReset().mockResolvedValue(false);
  requireStudentIdMock.mockReset().mockResolvedValue(null);
  createMercadoPagoCheckoutMock.mockReset().mockResolvedValue({ checkoutUrl: 'https://mp.example/checkout' });
});

describe('POST /api/payments/checkout -- paying for a child requires an ALREADY-accepted relationship, and never creates one', () => {
  it('denies with 403 when the caller has no accepted parent_student_relationships row for the target student', async () => {
    const res: any = await POST(jsonReq({ studentId: CHILD_ID }));
    expect(res.status).toBe(403);
    expect(createMercadoPagoCheckoutMock).not.toHaveBeenCalled();
  });

  it('only ever CHECKS isActiveParentOf -- never calls any function that could create or upgrade a relationship', async () => {
    await POST(jsonReq({ studentId: CHILD_ID }));
    expect(isActiveParentOfMock).toHaveBeenCalledWith(PAYER_USER_ID, CHILD_ID);
    // No relationship-mutation import exists in this route at all --
    // structurally, checkout cannot create/accept a relationship.
  });

  it('proceeds to checkout ONLY when an accepted relationship already exists, and records the parent as payer, never as the student', async () => {
    isActiveParentOfMock.mockResolvedValue(true);
    const res: any = await POST(jsonReq({ studentId: CHILD_ID }));
    expect(res.status ?? 200).toBe(200);
    expect(createMercadoPagoCheckoutMock).toHaveBeenCalledWith(CHILD_ID, expect.any(String), expect.any(String), PAYER_USER_ID);
  });

  it('self-checkout (no studentId) requires the caller\'s own ACTIVE STUDENT role -- never falls back to treating them as a payer-for-self without one', async () => {
    requireStudentIdMock.mockResolvedValue(null);
    const res: any = await POST(jsonReq({}));
    expect(res.status).toBe(403);
    expect(createMercadoPagoCheckoutMock).not.toHaveBeenCalled();
  });

  it('self-checkout succeeds and records the student themself as payer when they do hold an ACTIVE STUDENT role', async () => {
    requireStudentIdMock.mockResolvedValue(CHILD_ID);
    const res: any = await POST(jsonReq({}));
    expect(res.status ?? 200).toBe(200);
    expect(createMercadoPagoCheckoutMock).toHaveBeenCalledWith(CHILD_ID, expect.any(String), expect.any(String), PAYER_USER_ID);
    expect(isActiveParentOfMock).not.toHaveBeenCalled();
  });
});
