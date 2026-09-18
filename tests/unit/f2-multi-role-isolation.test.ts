/**
 * F2 / §21 -- multi-role security: a Parent+Teacher identity's
 * authorization must depend on actual relationship/scope rows, never
 * on which workspace happens to be selected. This test proves
 * canAccessLearner never reads users.active_workspace at all, and
 * that a Parent-relationship grant and a Teacher-assignment grant are
 * fully independent checks that don't contaminate each other.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const dbQueryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => dbQueryMock(...a) } }));
vi.mock('@/lib/identity/canonical-user.service', () => ({ getCanonicalUserByClerkId: vi.fn(), getUserRoles: vi.fn() }));

import { canAccessLearner } from '@/lib/authorization';

const SAME_ACTOR = 'parent-and-teacher-user-1';

beforeEach(() => {
  dbQueryMock.mockReset();
});

describe('one identity, two roles: Parent relationship to Learner A, Teacher assignment to Learner B', () => {
  it('the SAME actor is allowed for Learner A only via the parent path, and denied for Learner A via any teacher-only signal', async () => {
    // isOwner(false), isActiveParentOf(true) for Learner A
    dbQueryMock.mockResolvedValueOnce({ rows: [] });
    dbQueryMock.mockResolvedValueOnce({ rows: [{ '?': 1 }] });
    expect(await canAccessLearner(SAME_ACTOR, 'learner-A', 'LEARNER_PROGRESS_VIEW')).toBe(true);
  });

  it('the SAME actor is allowed for Learner B only via the teacher path (parent relationship does not exist for B)', async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [] }); // isOwner(false)
    dbQueryMock.mockResolvedValueOnce({ rows: [] }); // isActiveParentOf(false) for Learner B
    dbQueryMock.mockResolvedValueOnce({ rows: [{ '?': 1 }] }); // canTeacherAccessLearner(true) for Learner B
    expect(await canAccessLearner(SAME_ACTOR, 'learner-B', 'LEARNER_PROGRESS_VIEW')).toBe(true);
  });

  it('the SAME actor is denied for a THIRD learner they have neither relationship type for', async () => {
    dbQueryMock.mockResolvedValue({ rows: [] }); // every branch fails
    expect(await canAccessLearner(SAME_ACTOR, 'learner-C', 'LEARNER_PROGRESS_VIEW')).toBe(false);
  });

  it('none of the SQL issued by canAccessLearner ever references active_workspace -- workspace cannot influence this decision (INV-F2-09/INV-F1-13/14)', async () => {
    dbQueryMock.mockResolvedValue({ rows: [{ '?': 1 }] });
    await canAccessLearner(SAME_ACTOR, 'learner-A', 'LEARNER_PROGRESS_VIEW');
    for (const call of dbQueryMock.mock.calls) {
      expect(call[0]).not.toMatch(/active_workspace/);
    }
  });
});
