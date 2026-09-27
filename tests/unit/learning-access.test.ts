/**
 * One canonical learning-entitlement resolution shared by the demo banner,
 * Billing and every premium API (LEARNING_FULL_ACCESS).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const h = vi.hoisted(() => ({ dbQuery: vi.fn(), effective: vi.fn(), getSub: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { query: h.dbQuery } }));
vi.mock('@/lib/entitlements/subscription.service', () => ({
  getEffectiveSubscription: h.effective,
  getSubscription: h.getSub,
  ensureSubscription: vi.fn(),
  transitionSubscriptionStatus: vi.fn(),
}));

import { decideLearningAccess, resolveLearningAccess, billingDisplayStatus } from '@/lib/entitlements/learning-access';
import { canUseCapability } from '@/lib/entitlements';

const NOW = new Date('2026-09-27T12:00:00Z');
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');

function sub(over: Record<string, unknown> = {}): any {
  return { id: 'sub-1', studentId: 'st-1', status: 'active', plan: null, payerUserId: null, currentPeriodEnd: null, manuallySetByAdmin: false, grantExpiresAt: null, ...over };
}
const NONE = sub({ id: '', status: 'unpaid' });
const ADMIN_GRANT = sub({ manuallySetByAdmin: true, grantExpiresAt: '2027-01-01T00:52:00Z' });

describe('decideLearningAccess (pure)', () => {
  it('1. demo without a licence -> not licensed', () => {
    expect(decideLearningAccess(NONE, true, NOW)).toMatchObject({ licensed: false, reason: 'NO_LICENSE', source: 'NONE' });
  });

  it('2. active administrative licence -> licensed, source ADMIN_GRANT, valid until its expiry', () => {
    expect(decideLearningAccess(ADMIN_GRANT, true, NOW)).toEqual({
      licensed: true, reason: 'LICENSED', status: 'active', source: 'ADMIN_GRANT', validUntil: '2027-01-01T00:52:00Z',
    });
  });

  it('3. expired licence -> not licensed (grant past expiry, or already reconciled to expired)', () => {
    expect(decideLearningAccess(sub({ manuallySetByAdmin: true, grantExpiresAt: '2026-09-01T00:00:00Z' }), true, NOW)).toMatchObject({ licensed: false, reason: 'PERIOD_ENDED' });
    expect(decideLearningAccess(sub({ status: 'expired', manuallySetByAdmin: true, grantExpiresAt: '2026-09-01T00:00:00Z' }), true, NOW).licensed).toBe(false);
    expect(decideLearningAccess(sub({ status: 'cancelled_at_period_end', currentPeriodEnd: '2026-09-01T00:00:00Z' }), true, NOW)).toMatchObject({ licensed: false, reason: 'PERIOD_ENDED' });
  });

  it('4. a period that has not started to grant access (future end but non-paying status) -> not licensed', () => {
    // The model has no start date: access comes only from a paying status. A future period end alone never licenses.
    expect(decideLearningAccess(sub({ status: 'canceled', currentPeriodEnd: '2027-06-01T00:00:00Z' }), true, NOW).licensed).toBe(false);
    expect(decideLearningAccess(sub({ status: 'unpaid', currentPeriodEnd: '2027-06-01T00:00:00Z' }), true, NOW).licensed).toBe(false);
    expect(decideLearningAccess(sub({ status: 'payment_under_review' }), true, NOW).licensed).toBe(false);
  });

  it('5. active paid subscription -> licensed, source PAID; cancel-at-period-end stays licensed within the period', () => {
    expect(decideLearningAccess(sub({ currentPeriodEnd: '2026-10-27T00:00:00Z' }), true, NOW)).toMatchObject({ licensed: true, source: 'PAID' });
    expect(decideLearningAccess(sub({ status: 'cancelled_at_period_end', currentPeriodEnd: '2026-10-27T00:00:00Z' }), true, NOW).licensed).toBe(true);
  });

  it('8. ownership is never bypassed: an active licence does not license a non-owner', () => {
    expect(decideLearningAccess(ADMIN_GRANT, false, NOW)).toMatchObject({ licensed: false, reason: 'NOT_OWNER' });
  });
});

describe('6. banner, Billing and API return the same state', () => {
  beforeEach(() => {
    h.dbQuery.mockReset();
    h.effective.mockReset();
  });

  it('LEARNING_FULL_ACCESS (banner + every premium API) equals the canonical resolution, and Billing displays it', async () => {
    for (const [row, owner] of [[ADMIN_GRANT, true], [NONE, true], [ADMIN_GRANT, false]] as const) {
      h.effective.mockResolvedValue(row);
      h.dbQuery.mockResolvedValue({ rows: owner ? [{ '?column?': 1 }] : [] });
      const access = await resolveLearningAccess('user-1', 'st-1');
      const api = await canUseCapability('user-1', 'st-1', 'LEARNING_FULL_ACCESS');
      expect(api).toBe(access.licensed);
      // Billing shows "active/up to date" if and only if licensed
      expect(billingDisplayStatus(access) === 'active').toBe(access.licensed);
    }
  });

  it('a row that says active but is not linked to the learner is shown as demo, never "up to date"', () => {
    expect(billingDisplayStatus(decideLearningAccess(ADMIN_GRANT, false, NOW))).toBe('unpaid');
  });

  it('every surface consumes the same resolution (no independent rule)', () => {
    expect(read('src/app/dashboard/layout.tsx')).toMatch(/canUseCapability\(canonicalUser\.id, studentId, 'LEARNING_FULL_ACCESS'\)/);
    const billing = read('src/app/dashboard/billing/page.tsx');
    expect(billing).toMatch(/resolveLearningAccess\(actor\.id, studentId\)/);
    expect(billing).not.toMatch(/getSubscriptionStatus/);
    expect(read('src/lib/entitlements/index.ts')).toMatch(/return \(await resolveLearningAccess\(actorUserId, learnerId\)\)\.licensed;/);
    for (const route of ['src/app/api/learning/session/start/route.ts', 'src/app/api/quizzes/generate-and-take/route.ts', 'src/app/api/tutor/message/route.ts', 'src/app/api/exam-readiness/score/route.ts', 'src/app/api/simulation/attempts/route.ts']) {
      expect(read(route), route).toMatch(/'LEARNING_FULL_ACCESS'/);
    }
  });
});

describe('7. refresh / login does not change the result (no cached licence state server-side)', () => {
  it('the same inputs always resolve identically, on every request', async () => {
    h.effective.mockResolvedValue(ADMIN_GRANT);
    h.dbQuery.mockResolvedValue({ rows: [{ x: 1 }] });
    const a = await resolveLearningAccess('user-1', 'st-1');
    const b = await resolveLearningAccess('user-1', 'st-1');
    expect(a).toEqual(b);
    expect(h.effective).toHaveBeenCalledTimes(2); // read fresh each time
  });
});

describe('root cause -- Students are linked to their canonical user', () => {
  const auth = read('src/lib/auth.ts');

  it('provisioning links students.user_id and the Student profile, never overwriting an existing link', () => {
    expect(auth).toMatch(/INSERT INTO students \(clerk_id, email, name, user_id\)/);
    expect(auth).toMatch(/SELECT id FROM users WHERE clerk_id = \$1 AND NOT is_system/);
    expect(auth).toMatch(/user_id = COALESCE\(students\.user_id, EXCLUDED\.user_id\)/);
    expect(auth).toMatch(/INSERT INTO profiles \(id, user_type, full_name, user_id\)/);
  });

  it('existing unlinked rows are repaired with the exact-clerk_id rule, and a governed migration backfills them', () => {
    expect(auth).toMatch(/s\.user_id IS NULL AND u\.clerk_id = s\.clerk_id AND NOT u\.is_system/);
    const mig = read('database/migrations/20261014_1000_link_students_to_users.sql');
    expect(mig).toMatch(/WHERE s\.user_id IS NULL\s+AND u\.clerk_id = s\.clerk_id\s+AND NOT u\.is_system/);
    expect(mig).not.toMatch(/\b(DELETE|DROP|ALTER)\b/);
  });
});
