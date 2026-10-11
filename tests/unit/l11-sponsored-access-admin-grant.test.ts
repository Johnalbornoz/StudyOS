/**
 * L11 / EN-1 -- release ruling: for Stage and the initial pilot,
 * institution-sponsored access is an explicit per-student administrative
 * grant (source INSTITUTIONAL_LICENSE). There is no seat model.
 *
 * Pins what that procedure relies on in the entitlement layer:
 *  - a grant gives LEARNING_FULL_ACCESS to the Student only, until its expiry;
 *  - the grant ending (expiry, revocation) removes access on the next request;
 *  - neither the Student, a payer, nor a payment provider can undo it.
 */
import { describe, it, expect } from 'vitest';
import { decideLearningAccess } from '@/lib/entitlements/learning-access';
import { decideSelfReactivation } from '@/lib/entitlements/self-reactivation';
import { readFileSync } from 'fs';
import { join } from 'path';
import { decideConfirmedPayment, decideProviderEvent, isPurchasable } from '@/lib/entitlements/provider-events';
import { isValidTransition } from '@/lib/entitlements/subscription-state-machine';
import type { SubscriptionRecord } from '@/lib/entitlements/types';

const NOW = new Date('2026-10-11T12:00:00Z');
const grant = (over: Partial<SubscriptionRecord> = {}): SubscriptionRecord => ({
  id: 'sub-1',
  studentId: 'student-1',
  status: 'active',
  plan: null,
  payerUserId: null,
  currentPeriodEnd: null,
  manuallySetByAdmin: true,
  grantExpiresAt: '2026-10-25T00:00:00.000Z',
  ...over,
});
const NO_FACTS = { lastSuspension: null, lastSucceededPaymentAt: null };

describe('a sponsored Student is licensed by the grant alone', () => {
  it('licensed until the grant expires, with no payment and no seat', () => {
    expect(decideLearningAccess(grant(), true, NOW)).toMatchObject({ licensed: true, source: 'ADMIN_GRANT', validUntil: '2026-10-25T00:00:00.000Z' });
  });
  it('the grant never licenses anyone but the Student (a coordinator, teacher or parent acting on them)', () => {
    expect(decideLearningAccess(grant(), false, NOW)).toMatchObject({ licensed: false, reason: 'NOT_OWNER' });
  });
  it('past its expiry the grant gives nothing, even if the row still says active', () => {
    expect(decideLearningAccess(grant(), true, new Date('2026-10-25T00:00:01Z'))).toMatchObject({ licensed: false, reason: 'PERIOD_ENDED' });
  });
  it('an unsponsored Student of the same institution stays unlicensed (grants are per student)', () => {
    expect(decideLearningAccess({ ...grant(), id: '', status: 'unpaid', manuallySetByAdmin: false, grantExpiresAt: null }, true, NOW)).toMatchObject({ licensed: false, reason: 'NO_LICENSE' });
  });
});

describe('ending sponsorship is final for everyone but an administrator', () => {
  const revoked = grant({ status: 'suspended' });
  it('revoked: no access', () => {
    expect(decideLearningAccess(revoked, true, NOW).licensed).toBe(false);
  });
  it('the Student cannot reactivate it (L4-R1)', () => {
    expect(decideSelfReactivation(revoked, NO_FACTS, NOW)).toEqual({ allowed: false, reason: 'ADMIN_CONTROLLED' });
    expect(decideSelfReactivation(grant({ status: 'suspended', manuallySetByAdmin: false }), { lastSuspension: { actorUserId: 'admin-1', occurredAt: '2026-10-10T00:00:00Z' }, lastSucceededPaymentAt: '2026-10-11T00:00:00Z' }, NOW)).toEqual({
      allowed: false,
      reason: 'ADMIN_SUSPENDED',
    });
  });
  it('a payment provider event cannot restore or alter it', () => {
    const view = { id: 'sub-1', status: 'suspended' as const, manuallySetByAdmin: true, providerSubscriptionId: 'pre-1', currentPeriodEnd: null };
    expect(decideProviderEvent(view, { id: 'pre-1', status: 'authorized', nextPaymentDate: null }, NOW).action).toBe('NONE');
    expect(isPurchasable(view)).toBe(false);
  });
});

describe('operating the procedure', () => {
  it('a first grant (unpaid -> active) and an extension before expiry (active stays active) are possible', () => {
    expect(isValidTransition('unpaid', 'active')).toBe(true);
    // grantAdminLicense on an already-active row skips the transition and rewrites the expiry.
    expect(isValidTransition('active', 'active')).toBe(false);
  });
  it('L11-R1: an EXPIRED grant can be granted again by an administrator (expired -> active), through the same gate as any grant', () => {
    expect(isValidTransition('expired', 'active')).toBe(true);
    const service = readFileSync(join(process.cwd(), 'src/services/membership-admin.service.ts'), 'utf-8');
    const grantFn = service.slice(service.indexOf('export async function grantAdminLicense'), service.indexOf('export async function revokeLicenseGrant'));
    expect(grantFn).toMatch(/isValidTransition\(before\.status, targetStatus\)/);
    expect(grantFn).toMatch(/throw new InvalidMembershipTransitionError/);
  });
  it('L11-R1: expiry is not self-renewable -- the Student (or payer) cannot reactivate an expired entitlement', () => {
    for (const manuallySetByAdmin of [true, false]) {
      expect(decideSelfReactivation(grant({ status: 'expired', manuallySetByAdmin }), { lastSuspension: null, lastSucceededPaymentAt: '2026-10-11T11:00:00Z' }, NOW)).toEqual({ allowed: false, reason: 'NOT_REACTIVATABLE' });
    }
  });
  it('L11-R1: a REVOKED or SUSPENDED grant has no renewal path: not re-grantable through the state machine, not purchasable, not payable', () => {
    expect(isValidTransition('suspended', 'active')).toBe(false);
    expect(isPurchasable({ status: 'suspended', manuallySetByAdmin: true })).toBe(false);
    expect(decideConfirmedPayment({ status: 'suspended', manuallySetByAdmin: true }, { approvedAt: '2026-10-11T11:00:00Z', entitlementEndedAt: null })).toEqual({ action: 'NONE', reason: 'ADMIN_LIFECYCLE' });
  });
});
