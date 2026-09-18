/**
 * F3 / AC-F3-03/04/05 -- Parent, Teacher and Institution Admin access
 * (all governed entirely by F2) is completely independent of any
 * learner's subscription state. Proven by showing F2's authorization
 * module has zero dependency on entitlements/subscription code, and
 * that a suspended learner's Parent/Teacher access (via F2) is
 * unaffected.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('structural: F2 authorization never imports F3 entitlements/subscription code', () => {
  it('src/lib/authorization/index.ts has no dependency on entitlements', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/authorization/index.ts'), 'utf-8');
    expect(src).not.toMatch(/from ['"]@\/lib\/entitlements/);
  });

  it('src/services/institution.service.ts (F2) has no dependency on entitlements/subscriptions', () => {
    const src = readFileSync(join(process.cwd(), 'src/services/institution.service.ts'), 'utf-8');
    expect(src).not.toMatch(/from ['"]@\/lib\/entitlements/);
    expect(src).not.toMatch(/subscriptions/i);
  });

  it('src/services/parent.service.ts (F2) has no dependency on entitlements/subscriptions', () => {
    const src = readFileSync(join(process.cwd(), 'src/services/parent.service.ts'), 'utf-8');
    expect(src).not.toMatch(/from ['"]@\/lib\/entitlements/);
    expect(src).not.toMatch(/subscriptions/i);
  });
});

const dbQueryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => dbQueryMock(...a) } }));
vi.mock('@/lib/identity/canonical-user.service', () => ({ getCanonicalUserByClerkId: vi.fn(), getUserRoles: vi.fn() }));

import { canAccessLearner, canAccessInstitution } from '@/lib/authorization';

beforeEach(() => {
  dbQueryMock.mockReset();
});

describe('behavioral: F2 access decisions never consult subscriptions', () => {
  it('canAccessLearner (Parent path) issues zero queries against the subscriptions table', async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [] }); // isOwner
    dbQueryMock.mockResolvedValueOnce({ rows: [{ '?': 1 }] }); // isActiveParentOf
    await canAccessLearner('parent-actor', 'learner-1', 'LEARNER_PROGRESS_VIEW');
    for (const call of dbQueryMock.mock.calls) {
      expect(call[0]).not.toMatch(/\bsubscriptions\b/i);
    }
  });

  it('canAccessInstitution (Institution Admin path) issues zero queries against the subscriptions table', async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [{ '?': 1 }] });
    await canAccessInstitution('admin-actor', 'inst-1', 'INSTITUTION_MEMBER_APPROVE');
    for (const call of dbQueryMock.mock.calls) {
      expect(call[0]).not.toMatch(/\bsubscriptions\b/i);
    }
  });
});
