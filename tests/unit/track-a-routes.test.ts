/**
 * Track A (Roles E2E) -- route-level gates: authentication, role gates,
 * institution scoping, spoofed / malformed ids, and response shapes that
 * must not leak (no existence oracle). Services are mocked; what is under
 * test is the route's own decision.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const authMock = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({ auth: () => authMock(), currentUser: vi.fn(async () => null) }));

const verifyAuthMock = vi.fn();
const requireParentProfileIdMock = vi.fn();
const requireStudentIdMock = vi.fn();
vi.mock('@/lib/auth', () => ({
  verifyAuth: () => verifyAuthMock(),
  requireParentProfileId: (...a: any[]) => requireParentProfileIdMock(...a),
  requireStudentId: (...a: any[]) => requireStudentIdMock(...a),
}));

const ACTOR = { id: 'actor-1', clerkId: 'clerk-1', email: 'a@example.com', status: 'ACTIVE', activeWorkspace: null, passwordChangeRequired: false };
const assignSelfServiceRoleMock = vi.fn();
const setActiveWorkspaceMock = vi.fn();
const hasRoleMock = vi.fn();
vi.mock('@/lib/identity', () => ({
  getOrCreateCanonicalUser: vi.fn(async () => ACTOR),
  assignSelfServiceRole: (...a: any[]) => assignSelfServiceRoleMock(...a),
  setActiveWorkspace: (...a: any[]) => setActiveWorkspaceMock(...a),
  hasRole: (...a: any[]) => hasRoleMock(...a),
  workspaceForRole: (r: string) => (r === 'INSTITUTION_ADMIN' ? 'INSTITUTION' : r === 'STUDYUS_ADMIN' ? 'ADMIN' : r),
}));

const canAccessInstitutionMock = vi.fn();
vi.mock('@/lib/authorization', () => ({ canAccessInstitution: (...a: any[]) => canAccessInstitutionMock(...a) }));

const requestChildLinkMock = vi.fn();
vi.mock('@/services/parent.service', () => ({ requestChildLink: (...a: any[]) => requestChildLinkMock(...a) }));

const createClassMock = vi.fn();
const getClassInInstitutionMock = vi.fn();
const inviteStudentToClassMock = vi.fn();
const respondToClassInvitationMock = vi.fn();
const requestTeacherMembershipMock = vi.fn();
vi.mock('@/services/institution.service', () => ({
  createClass: (...a: any[]) => createClassMock(...a),
  listInstitutionClassesWithStaff: vi.fn(async () => []),
  getClassInInstitution: (...a: any[]) => getClassInInstitutionMock(...a),
  inviteStudentToClass: (...a: any[]) => inviteStudentToClassMock(...a),
  listClassRosterForInstitution: vi.fn(async () => []),
  getInstitutionById: vi.fn(async () => ({ id: 'inst-A', name: 'A', status: 'ACTIVE' })),
  respondToClassInvitation: (...a: any[]) => respondToClassInvitationMock(...a),
  requestTeacherMembership: (...a: any[]) => requestTeacherMembershipMock(...a),
  getMembershipStatus: vi.fn(async () => null),
  InstitutionNotAvailableError: class extends Error {},
}));

vi.mock('@/lib/notifications/role-notifications.service', () => ({ notifyUser: vi.fn(async () => 'n1'), notifyInstitutionAdmins: vi.fn(async () => 1) }));
vi.mock('@/lib/institution/membership-events', () => ({ onTeacherMembershipRequested: vi.fn(async () => {}) }));
vi.mock('@/lib/db', () => ({ db: { query: vi.fn(async () => ({ rows: [] })) } }));

const startMock = vi.fn();
vi.mock('@/lib/student/teacher-intervention-execution.service', async () => {
  class StudentInterventionAccessDeniedError extends Error {}
  class StudentInterventionNotFoundError extends Error {}
  class StudentInterventionNotStartableError extends Error {}
  class StudentInterventionGenerationFailedError extends Error {}
  return {
    startTeacherInterventionExecution: (...a: any[]) => startMock(...a),
    StudentInterventionAccessDeniedError,
    StudentInterventionNotFoundError,
    StudentInterventionNotStartableError,
    StudentInterventionGenerationFailedError,
  };
});
vi.mock('@/lib/observability/pilot-events', () => ({ logPilotEvent: vi.fn() }));

import { POST as childRequestPOST } from '@/app/api/parent/child-requests/route';
import { POST as roleSelectPOST } from '@/app/api/identity/roles/select/route';
import { POST as classesPOST } from '@/app/api/institutions/[id]/classes/route';
import { POST as enrollPOST } from '@/app/api/institutions/[id]/classes/[classId]/enrollments/route';
import { POST as invitationRespondPOST } from '@/app/api/student/class-invitations/[id]/respond/route';
import { POST as membershipPOST } from '@/app/api/institutions/[id]/membership/route';
import { POST as startPOST } from '@/app/api/student/teacher-interventions/[id]/start/route';
import * as executionModule from '@/lib/student/teacher-intervention-execution.service';

const req = (body?: unknown) => ({ json: async () => body ?? {} }) as any;
const p = <T,>(v: T) => ({ params: Promise.resolve(v) });
const INST = '11111111-1111-4111-8111-111111111111';
const CLASS = '22222222-2222-4222-8222-222222222222';
const ENR = '33333333-3333-4333-8333-333333333333';

beforeEach(() => {
  authMock.mockReset().mockResolvedValue({ userId: 'clerk-1' });
  verifyAuthMock.mockReset().mockResolvedValue({ userId: 'clerk-1', email: 'a@example.com', role: 'student' });
  requireParentProfileIdMock.mockReset().mockResolvedValue('parent-profile-1');
  requireStudentIdMock.mockReset().mockResolvedValue('student-1');
  assignSelfServiceRoleMock.mockReset().mockResolvedValue('GRANTED');
  setActiveWorkspaceMock.mockReset().mockResolvedValue(true);
  hasRoleMock.mockReset().mockResolvedValue(true);
  canAccessInstitutionMock.mockReset().mockResolvedValue(true);
  requestChildLinkMock.mockReset().mockResolvedValue('SUBMITTED');
  createClassMock.mockReset();
  getClassInInstitutionMock.mockReset().mockResolvedValue({ id: CLASS, name: 'Mate', gradeId: null, gradeName: null });
  inviteStudentToClassMock.mockReset();
  respondToClassInvitationMock.mockReset();
  requestTeacherMembershipMock.mockReset();
  startMock.mockReset();
});

describe('POST /api/parent/child-requests', () => {
  it('401 unauthenticated; 403 without an ACTIVE PARENT role (no request is ever made)', async () => {
    authMock.mockResolvedValue({ userId: null });
    expect((await childRequestPOST(req({ email: 'k@example.com' }))).status).toBe(401);
    authMock.mockResolvedValue({ userId: 'clerk-1' });
    requireParentProfileIdMock.mockResolvedValue(null);
    expect((await childRequestPOST(req({ email: 'k@example.com' }))).status).toBe(403);
    expect(requestChildLinkMock).not.toHaveBeenCalled();
  });

  it('the response body never depends on whether the email matched (no oracle)', async () => {
    const a = await childRequestPOST(req({ email: 'exists@example.com' }));
    const b = await childRequestPOST(req({ email: 'missing@example.com' }));
    expect(a.status).toBe(202);
    expect(await a.text()).toBe(await b.text());
  });

  it('429 when the parent has too many unanswered requests', async () => {
    requestChildLinkMock.mockResolvedValue('RATE_LIMITED');
    expect((await childRequestPOST(req({ email: 'k@example.com' }))).status).toBe(429);
  });
});

describe('POST /api/identity/roles/select -- explicit active workspace', () => {
  it('the role just added becomes the active workspace (never a silent jump to another one)', async () => {
    const res = await roleSelectPOST(req({ role: 'PARENT' }));
    expect(res.status).toBe(200);
    expect(setActiveWorkspaceMock).toHaveBeenCalledWith('actor-1', 'PARENT');
    expect((await res.json()).data.activeWorkspace).toBe('PARENT');
  });

  it('privileged roles are not self-service (400) and a revoked role is 409', async () => {
    expect((await roleSelectPOST(req({ role: 'INSTITUTION_ADMIN' }))).status).toBe(400);
    assignSelfServiceRoleMock.mockResolvedValue('REVOKED');
    expect((await roleSelectPOST(req({ role: 'TEACHER' }))).status).toBe(409);
    expect(setActiveWorkspaceMock).not.toHaveBeenCalled();
  });
});

describe('Institution admin routes', () => {
  it('403 for anyone who is not an APPROVED admin of THIS institution', async () => {
    canAccessInstitutionMock.mockResolvedValue(false);
    expect((await classesPOST(req({ name: 'X' }), p({ id: INST }))).status).toBe(403);
    expect(createClassMock).not.toHaveBeenCalled();
  });

  it('a grade of another institution -> 422 (never a cross-tenant class)', async () => {
    createClassMock.mockRejectedValue(new Error('SCOPE_OUTSIDE_INSTITUTION'));
    expect((await classesPOST(req({ name: 'X', gradeId: CLASS }), p({ id: INST }))).status).toBe(422);
  });

  it('malformed ids are a clean 404, never a DB cast error', async () => {
    expect((await enrollPOST(req({ email: 's@example.com' }), p({ id: INST, classId: 'not-a-uuid' }))).status).toBe(404);
    expect(canAccessInstitutionMock).not.toHaveBeenCalled();
  });

  it('a class id from another institution is 404 and nobody is invited', async () => {
    getClassInInstitutionMock.mockResolvedValue(null);
    expect((await enrollPOST(req({ email: 's@example.com' }), p({ id: INST, classId: CLASS }))).status).toBe(404);
    expect(inviteStudentToClassMock).not.toHaveBeenCalled();
  });
});

describe('Student consent and teacher membership', () => {
  it('a non-Student cannot answer class invitations; another student\'s invitation is 404', async () => {
    requireStudentIdMock.mockResolvedValue(null);
    expect((await invitationRespondPOST(req({ accept: true }), p({ id: ENR }))).status).toBe(403);
    requireStudentIdMock.mockResolvedValue('student-1');
    respondToClassInvitationMock.mockResolvedValue(null);
    expect((await invitationRespondPOST(req({ accept: true }), p({ id: ENR }))).status).toBe(404);
    expect(respondToClassInvitationMock).toHaveBeenCalledWith('student-1', ENR, true);
  });

  it('only an identity with the TEACHER role may ask to join an institution', async () => {
    hasRoleMock.mockResolvedValue(false);
    expect((await membershipPOST(req(), p({ id: INST }))).status).toBe(403);
    expect(requestTeacherMembershipMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/student/teacher-interventions/[id]/start', () => {
  it('a generation failure is a retryable 503 (nothing stored), never an empty activity', async () => {
    startMock.mockRejectedValue(new (executionModule as any).StudentInterventionGenerationFailedError());
    const res = await startPOST(req({ idempotencyKey: 'assignment:x' }), p({ id: 'x' }));
    expect(res.status).toBe(503);
    expect((await res.json()).retryable).toBe(true);
  });
});
