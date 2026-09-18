/**
 * F2 -- the central authorization service. Covers the negative
 * security matrix from the task's §20 at the unit level (mocked db);
 * real-Postgres coverage lives in
 * scripts/operations/f2-authorization-migration-cert.sh.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const dbQueryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => dbQueryMock(...a) } }));

const getCanonicalUserByClerkIdMock = vi.fn();
vi.mock('@/lib/identity/canonical-user.service', () => ({
  getCanonicalUserByClerkId: (...a: any[]) => getCanonicalUserByClerkIdMock(...a),
  getUserRoles: vi.fn(),
}));

import {
  canAccessLearner,
  canTeacherAccessLearner,
  canAccessInstitution,
  canAccessClass,
  canTeacherAccessStudentByClerkId,
} from '@/lib/authorization';

beforeEach(() => {
  dbQueryMock.mockReset();
  getCanonicalUserByClerkIdMock.mockReset();
});

describe('canAccessLearner -- STUDENT (owner)', () => {
  it('ALLOW: the learner accessing their own record', async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [{ '?': 1 }] }); // isOwner
    expect(await canAccessLearner('actor-1', 'learner-1', 'LEARNER_PROGRESS_VIEW')).toBe(true);
  });

  it('DENY: a different learner (not owner, no relationship, no assignment)', async () => {
    dbQueryMock.mockResolvedValue({ rows: [] }); // every check fails
    expect(await canAccessLearner('actor-1', 'other-learner', 'LEARNER_PROGRESS_VIEW')).toBe(false);
  });
});

describe('canAccessLearner -- PARENT', () => {
  it('DENY: no relationship at all', async () => {
    dbQueryMock.mockResolvedValue({ rows: [] });
    expect(await canAccessLearner('actor-1', 'learner-1', 'LEARNER_PROGRESS_VIEW')).toBe(false);
  });

  it('DENY: PENDING relationship (the query itself only ever matches accepted, so a pending row simply does not match)', async () => {
    // isOwner fails, isActiveParentOf's own WHERE status='accepted' means a pending row never matches -- simulate by returning empty.
    dbQueryMock.mockResolvedValueOnce({ rows: [] }); // isOwner
    dbQueryMock.mockResolvedValueOnce({ rows: [] }); // isActiveParentOf (pending doesn't match 'accepted')
    dbQueryMock.mockResolvedValueOnce({ rows: [] }); // teacher check
    expect(await canAccessLearner('actor-1', 'learner-1', 'LEARNER_PROGRESS_VIEW')).toBe(false);
  });

  it('ALLOW (permitted reads only): ACTIVE (accepted) relationship', async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [] }); // isOwner
    dbQueryMock.mockResolvedValueOnce({ rows: [{ '?': 1 }] }); // isActiveParentOf
    expect(await canAccessLearner('actor-1', 'learner-1', 'LEARNER_PROGRESS_VIEW')).toBe(true);
  });

  it('DENY: REJECTED relationship (never matches accepted)', async () => {
    dbQueryMock.mockResolvedValue({ rows: [] });
    expect(await canAccessLearner('actor-1', 'learner-1', 'LEARNER_PROGRESS_VIEW')).toBe(false);
  });

  it('DENY: REVOKED relationship -- access removed immediately', async () => {
    dbQueryMock.mockResolvedValue({ rows: [] }); // revoked never matches status='accepted'
    expect(await canAccessLearner('actor-1', 'learner-1', 'LEARNER_PROGRESS_VIEW')).toBe(false);
  });

  it('a Parent never satisfies LEARNER_INTERVENTION_CREATE (not in PARENT_PERMISSIONS)', async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [] }); // isOwner
    dbQueryMock.mockResolvedValueOnce({ rows: [{ '?': 1 }] }); // isActiveParentOf would be true...
    // ...but the permission gate itself excludes PARENT from this permission, so the query is never even run:
    expect(await canAccessLearner('actor-1', 'learner-1', 'LEARNER_INTERVENTION_CREATE')).toBe(false);
  });
});

describe('canTeacherAccessLearner / canAccessLearner -- TEACHER', () => {
  it('DENY: role only, no membership/assignment/enrollment row at all', async () => {
    dbQueryMock.mockResolvedValue({ rows: [] });
    expect(await canTeacherAccessLearner('actor-1', 'learner-1')).toBe(false);
  });

  it('DENY: the single JOIN query requires membership+assignment+enrollment simultaneously -- any missing link fails the whole query, never partially authorizes', async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [] }); // the one JOINed query
    expect(await canTeacherAccessLearner('actor-1', 'learner-1')).toBe(false);
  });

  it('ALLOW (scoped): matching APPROVED membership + ACTIVE assignment + ACTIVE enrollment', async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [{ '?': 1 }] });
    expect(await canTeacherAccessLearner('actor-1', 'learner-1')).toBe(true);
  });

  it('canAccessLearner ALLOW via teacher path when owner/parent both fail', async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [] }); // isOwner
    dbQueryMock.mockResolvedValueOnce({ rows: [] }); // isActiveParentOf
    dbQueryMock.mockResolvedValueOnce({ rows: [{ '?': 1 }] }); // canTeacherAccessLearner
    expect(await canAccessLearner('actor-1', 'learner-1', 'LEARNER_PROGRESS_VIEW')).toBe(true);
  });

  it('canTeacherAccessStudentByClerkId: DENY when the Clerk id has no canonical user yet', async () => {
    getCanonicalUserByClerkIdMock.mockResolvedValue(null);
    expect(await canTeacherAccessStudentByClerkId('clerk-unknown', 'learner-1')).toBe(false);
    expect(dbQueryMock).not.toHaveBeenCalled();
  });

  it('canTeacherAccessStudentByClerkId: resolves Clerk id to canonical user, then delegates', async () => {
    getCanonicalUserByClerkIdMock.mockResolvedValue({ id: 'actor-1', clerkId: 'clerk-1', email: null, status: 'ACTIVE', activeWorkspace: null });
    dbQueryMock.mockResolvedValueOnce({ rows: [{ '?': 1 }] });
    expect(await canTeacherAccessStudentByClerkId('clerk-1', 'learner-1')).toBe(true);
  });
});

describe('canAccessInstitution', () => {
  it('DENY: a different institution than the one the admin is approved for', async () => {
    dbQueryMock.mockResolvedValue({ rows: [] });
    expect(await canAccessInstitution('actor-1', 'other-institution', 'INSTITUTION_MEMBER_APPROVE')).toBe(false);
  });

  it('ALLOW: APPROVED INSTITUTION_ADMIN membership for THIS institution', async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [{ '?': 1 }] });
    expect(await canAccessInstitution('actor-1', 'inst-1', 'INSTITUTION_MEMBER_APPROVE')).toBe(true);
  });

  it('DENY: PENDING institution_admin membership never satisfies (query only matches APPROVED)', async () => {
    dbQueryMock.mockResolvedValue({ rows: [] });
    expect(await canAccessInstitution('actor-1', 'inst-1', 'TEACHER_ASSIGNMENT_MANAGE')).toBe(false);
  });

  it('ANONYMOUS-equivalent: a DB error resolves to false, never throws', async () => {
    dbQueryMock.mockRejectedValue(new Error('connection lost'));
    expect(await canAccessInstitution('actor-1', 'inst-1', 'INSTITUTION_MEMBER_APPROVE')).toBe(false);
  });
});

describe('canAccessClass', () => {
  it('DENY: class does not exist', async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [] }); // classRow lookup
    expect(await canAccessClass('actor-1', 'nonexistent-class', 'TEACHER_ASSIGNMENT_MANAGE')).toBe(false);
  });

  it('ALLOW: institution admin of the class\'s own institution', async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [{ institution_id: 'inst-1', grade_id: 'grade-1' }] }); // classRow
    dbQueryMock.mockResolvedValueOnce({ rows: [{ '?': 1 }] }); // canAccessInstitution
    expect(await canAccessClass('actor-1', 'class-1', 'TEACHER_ASSIGNMENT_MANAGE')).toBe(true);
  });

  it('DENY: teacher with an assignment for a DIFFERENT class', async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [{ institution_id: 'inst-1', grade_id: 'grade-1' }] }); // classRow
    dbQueryMock.mockResolvedValueOnce({ rows: [] }); // canAccessInstitution -> false
    dbQueryMock.mockResolvedValueOnce({ rows: [] }); // teacher assignment query -> no match for this class
    expect(await canAccessClass('actor-1', 'class-1', 'TEACHER_ASSIGNMENT_MANAGE')).toBe(false);
  });
});
