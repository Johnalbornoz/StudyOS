/**
 * F2 -- integration-style negative security tests for the new
 * institution/membership/assignment/learner-summary routes. Covers
 * anonymous denial, cross-institution denial, unapproved-membership
 * denial, and manipulated-id handling.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const verifyAuthMock = vi.fn();
vi.mock('@/lib/auth', () => ({ verifyAuth: () => verifyAuthMock() }));

const getOrCreateCanonicalUserMock = vi.fn();
vi.mock('@/lib/identity', () => ({ getOrCreateCanonicalUser: (...a: any[]) => getOrCreateCanonicalUserMock(...a) }));

const canAccessInstitutionMock = vi.fn();
const canAccessLearnerMock = vi.fn();
vi.mock('@/lib/authorization', () => ({
  canAccessInstitution: (...a: any[]) => canAccessInstitutionMock(...a),
  canAccessLearner: (...a: any[]) => canAccessLearnerMock(...a),
}));

const dbQueryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => dbQueryMock(...a) } }));

const listPendingMembershipsMock = vi.fn();
const decideMembershipMock = vi.fn();
const revokeMembershipMock = vi.fn();
const createTeacherAssignmentMock = vi.fn();
const endTeacherAssignmentMock = vi.fn();
const requestTeacherMembershipMock = vi.fn();
vi.mock('@/services/institution.service', () => ({
  listPendingMemberships: (...a: any[]) => listPendingMembershipsMock(...a),
  decideMembership: (...a: any[]) => decideMembershipMock(...a),
  revokeMembership: (...a: any[]) => revokeMembershipMock(...a),
  createTeacherAssignment: (...a: any[]) => createTeacherAssignmentMock(...a),
  endTeacherAssignment: (...a: any[]) => endTeacherAssignmentMock(...a),
  requestTeacherMembership: (...a: any[]) => requestTeacherMembershipMock(...a),
  getMembershipStatus: vi.fn().mockResolvedValue(null),
}));

const getChildOverviewMock = vi.fn();
vi.mock('@/services/parent.service', () => ({ getChildOverview: (...a: any[]) => getChildOverviewMock(...a) }));

import { GET as pendingGET } from '@/app/api/institutions/[id]/memberships/pending/route';
import { POST as decidePOST } from '@/app/api/institutions/[id]/memberships/[membershipId]/decide/route';
import { POST as revokePOST } from '@/app/api/institutions/[id]/memberships/[membershipId]/revoke/route';
import { POST as assignmentsPOST } from '@/app/api/institutions/[id]/assignments/route';
import { GET as summaryGET } from '@/app/api/learners/[id]/summary/route';

function req(body?: any) {
  return { json: async () => body ?? {} } as any;
}

const ACTOR = { id: 'actor-1', clerkId: 'clerk-1', email: null, status: 'ACTIVE' as const, activeWorkspace: null };

beforeEach(() => {
  verifyAuthMock.mockReset().mockResolvedValue({ userId: 'clerk-1', email: null, role: 'teacher' });
  getOrCreateCanonicalUserMock.mockReset().mockResolvedValue(ACTOR);
  canAccessInstitutionMock.mockReset().mockResolvedValue(false);
  canAccessLearnerMock.mockReset().mockResolvedValue(false);
  dbQueryMock.mockReset().mockResolvedValue({ rows: [] });
  listPendingMembershipsMock.mockReset().mockResolvedValue([]);
  decideMembershipMock.mockReset().mockResolvedValue(true);
  revokeMembershipMock.mockReset().mockResolvedValue(true);
  createTeacherAssignmentMock.mockReset().mockResolvedValue({ id: 'a1', status: 'ACTIVE' });
  endTeacherAssignmentMock.mockReset().mockResolvedValue(true);
  getChildOverviewMock.mockReset().mockResolvedValue({});
});

describe('ANONYMOUS: every F2 route denies before touching authorization/data', () => {
  it('pending memberships list', async () => {
    verifyAuthMock.mockResolvedValue(null);
    const res: any = await pendingGET(req(), { params: Promise.resolve({ id: 'inst-1' }) });
    expect(res.status).toBe(401);
    expect(canAccessInstitutionMock).not.toHaveBeenCalled();
  });

  it('learner summary', async () => {
    verifyAuthMock.mockResolvedValue(null);
    const res: any = await summaryGET(req(), { params: Promise.resolve({ id: 'learner-1' }) });
    expect(res.status).toBe(401);
    expect(canAccessLearnerMock).not.toHaveBeenCalled();
  });
});

describe('CROSS-INSTITUTION: an admin of institution A cannot act on institution B', () => {
  it('cannot list institution B\'s pending memberships', async () => {
    canAccessInstitutionMock.mockResolvedValue(false); // actor is not an approved admin of institution B
    const res: any = await pendingGET(req(), { params: Promise.resolve({ id: 'institution-B' }) });
    expect(res.status).toBe(403);
    expect(listPendingMembershipsMock).not.toHaveBeenCalled();
  });

  it('cannot decide a membership under institution B', async () => {
    canAccessInstitutionMock.mockResolvedValue(false);
    const res: any = await decidePOST(req({ decision: 'APPROVED' }), { params: Promise.resolve({ id: 'institution-B', membershipId: 'm1' }) });
    expect(res.status).toBe(403);
    expect(decideMembershipMock).not.toHaveBeenCalled();
  });

  it('MANIPULATED membershipId: a membershipId that does not actually belong to the URL\'s institution is rejected even for an otherwise-authorized admin', async () => {
    canAccessInstitutionMock.mockResolvedValue(true); // admin IS approved for institution-A...
    dbQueryMock.mockResolvedValue({ rows: [] }); // ...but membershipId m1 does not belong to institution-A
    const res: any = await decidePOST(req({ decision: 'APPROVED' }), { params: Promise.resolve({ id: 'institution-A', membershipId: 'm1-belongs-to-other-institution' }) });
    expect(res.status).toBe(404);
    expect(decideMembershipMock).not.toHaveBeenCalled();
  });
});

describe('TEACHER: approved membership alone does not grant assignment-management (that requires admin)', () => {
  it('a teacher (not an institution admin) cannot create an assignment for themself', async () => {
    canAccessInstitutionMock.mockResolvedValue(false); // TEACHER_ASSIGNMENT_MANAGE requires INSTITUTION_ADMIN, not TEACHER
    const res: any = await assignmentsPOST(req({ institutionMembershipId: 'm1', classId: 'c1' }), { params: Promise.resolve({ id: 'inst-1' }) });
    expect(res.status).toBe(403);
    expect(createTeacherAssignmentMock).not.toHaveBeenCalled();
  });
});

describe('MEMBERSHIP REVOCATION preserves access-removal without deletion (route-level)', () => {
  it('revoking a membership under a different institution is denied', async () => {
    canAccessInstitutionMock.mockResolvedValue(false);
    const res: any = await revokePOST(req(), { params: Promise.resolve({ id: 'institution-B', membershipId: 'm1' }) });
    expect(res.status).toBe(403);
    expect(revokeMembershipMock).not.toHaveBeenCalled();
  });

  it('a legitimate revoke by the correct institution\'s admin succeeds', async () => {
    canAccessInstitutionMock.mockResolvedValue(true);
    dbQueryMock.mockResolvedValue({ rows: [{ '?': 1 }] }); // membership belongs to this institution
    const res: any = await revokePOST(req(), { params: Promise.resolve({ id: 'inst-1', membershipId: 'm1' }) });
    expect(res.status ?? 200).toBe(200);
    expect(revokeMembershipMock).toHaveBeenCalledWith('m1', 'actor-1');
  });
});

describe('LEARNER SUMMARY: relationship-based access, denies without leaking learner existence', () => {
  it('DENY: no qualifying relationship/assignment', async () => {
    canAccessLearnerMock.mockResolvedValue(false);
    const res: any = await summaryGET(req(), { params: Promise.resolve({ id: 'learner-1' }) });
    expect(res.status).toBe(403);
    expect(getChildOverviewMock).not.toHaveBeenCalled();
    const body = await res.json();
    expect(JSON.stringify(body)).not.toMatch(/learner-1/);
  });

  it('ALLOW: a qualifying relationship (parent or teacher, decided entirely by the central service)', async () => {
    canAccessLearnerMock.mockResolvedValue(true);
    const res: any = await summaryGET(req(), { params: Promise.resolve({ id: 'learner-1' }) });
    expect(res.status ?? 200).toBe(200);
    expect(canAccessLearnerMock).toHaveBeenCalledWith('actor-1', 'learner-1', 'LEARNER_PROGRESS_VIEW');
  });
});
