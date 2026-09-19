/**
 * F11-B -- negative security tests for the Teacher Intervention API
 * surface. Every route must reject unauthenticated callers before
 * touching the domain service, and translate the service's own denial
 * errors into 403/404, never a 500 or a silent 200. The domain
 * service's own authorization logic is exercised for real against
 * real Postgres in the F11-B certification run (mirrors F10/F11-A's
 * own division between route-contract unit tests and real-Postgres
 * certification).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const verifyAuthMock = vi.fn();
vi.mock('@/lib/auth', () => ({ verifyAuth: () => verifyAuthMock() }));

const getOrCreateCanonicalUserMock = vi.fn();
vi.mock('@/lib/identity', () => ({ getOrCreateCanonicalUser: (...a: any[]) => getOrCreateCanonicalUserMock(...a) }));

const { TeacherInterventionAccessDeniedError, TeacherInterventionNotFoundError, TeacherInterventionInvalidTargetError } = vi.hoisted(() => ({
  TeacherInterventionAccessDeniedError: class TeacherInterventionAccessDeniedError extends Error {},
  TeacherInterventionNotFoundError: class TeacherInterventionNotFoundError extends Error {},
  TeacherInterventionInvalidTargetError: class TeacherInterventionInvalidTargetError extends Error {},
}));

const assignTeacherInterventionMock = vi.fn();
const listTeacherInterventionsForStudentMock = vi.fn();
const cancelTeacherInterventionMock = vi.fn();
vi.mock('@/lib/teacher/intervention.service', () => ({
  TeacherInterventionAccessDeniedError,
  TeacherInterventionNotFoundError,
  TeacherInterventionInvalidTargetError,
  assignTeacherIntervention: (...a: any[]) => assignTeacherInterventionMock(...a),
  listTeacherInterventionsForStudent: (...a: any[]) => listTeacherInterventionsForStudentMock(...a),
  cancelTeacherIntervention: (...a: any[]) => cancelTeacherInterventionMock(...a),
}));

import { POST as assignPOST } from '@/app/api/teacher/interventions/route';
import { GET as viewGET } from '@/app/api/teacher/students/[studentId]/interventions/route';
import { POST as cancelPOST } from '@/app/api/teacher/interventions/[id]/cancel/route';

const STUDENT_ID = '11111111-1111-4111-8111-111111111111';
const CLASS_ID = '22222222-2222-4222-8222-222222222222';
const CONCEPT_ID = '33333333-3333-4333-8333-333333333333';
const INTERVENTION_ID = '44444444-4444-4444-8444-444444444444';

const VALID_ASSIGN_BODY = {
  classId: CLASS_ID,
  studentId: STUDENT_ID,
  interventionType: 'CONCEPT_REINFORCEMENT',
  target: { targetType: 'CONCEPT', conceptId: CONCEPT_ID },
};

function jsonReq(body: any) {
  return { json: async () => body } as any;
}
function urlReq() {
  return {} as any;
}
function withStudentParams(studentId: string) {
  return { params: Promise.resolve({ studentId }) };
}
function withIdParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  verifyAuthMock.mockReset().mockResolvedValue({ userId: 'clerk-teacher-1', email: 'teacher@studyus.test' });
  getOrCreateCanonicalUserMock.mockReset().mockResolvedValue({ id: 'actor-1' });
  assignTeacherInterventionMock.mockReset().mockResolvedValue({ id: INTERVENTION_ID, studentId: STUDENT_ID, status: 'ASSIGNED' });
  listTeacherInterventionsForStudentMock.mockReset().mockResolvedValue([]);
  cancelTeacherInterventionMock.mockReset().mockResolvedValue({ id: INTERVENTION_ID, status: 'CANCELLED' });
});

describe('ANONYMOUS: every F11-B route denies before touching the domain service', () => {
  it('assign', async () => {
    verifyAuthMock.mockResolvedValue(null);
    const res: any = await assignPOST(jsonReq(VALID_ASSIGN_BODY));
    expect(res.status).toBe(401);
    expect(assignTeacherInterventionMock).not.toHaveBeenCalled();
  });

  it('view', async () => {
    verifyAuthMock.mockResolvedValue(null);
    const res: any = await viewGET(urlReq(), withStudentParams(STUDENT_ID));
    expect(res.status).toBe(401);
    expect(listTeacherInterventionsForStudentMock).not.toHaveBeenCalled();
  });

  it('cancel', async () => {
    verifyAuthMock.mockResolvedValue(null);
    const res: any = await cancelPOST(jsonReq({}), withIdParams(INTERVENTION_ID));
    expect(res.status).toBe(401);
    expect(cancelTeacherInterventionMock).not.toHaveBeenCalled();
  });
});

describe('AUTHENTICATED but denied by the domain service: 403, never 500', () => {
  it('assign', async () => {
    assignTeacherInterventionMock.mockRejectedValue(new TeacherInterventionAccessDeniedError('denied'));
    const res: any = await assignPOST(jsonReq(VALID_ASSIGN_BODY));
    expect(res.status).toBe(403);
  });

  it('view', async () => {
    listTeacherInterventionsForStudentMock.mockRejectedValue(new TeacherInterventionAccessDeniedError('denied'));
    const res: any = await viewGET(urlReq(), withStudentParams(STUDENT_ID));
    expect(res.status).toBe(403);
  });

  it('cancel', async () => {
    cancelTeacherInterventionMock.mockRejectedValue(new TeacherInterventionAccessDeniedError('denied'));
    const res: any = await cancelPOST(jsonReq({}), withIdParams(INTERVENTION_ID));
    expect(res.status).toBe(403);
  });
});

describe('cancel: NOT_FOUND for a nonexistent intervention id', () => {
  it('returns 404, not 403 or 500', async () => {
    cancelTeacherInterventionMock.mockRejectedValue(new TeacherInterventionNotFoundError(INTERVENTION_ID));
    const res: any = await cancelPOST(jsonReq({}), withIdParams(INTERVENTION_ID));
    expect(res.status).toBe(404);
  });
});

describe('assign: INVALID_TARGET for a well-formed but nonexistent target id', () => {
  it('returns 400, not a raw 500', async () => {
    assignTeacherInterventionMock.mockRejectedValue(new TeacherInterventionInvalidTargetError('CONCEPT'));
    const res: any = await assignPOST(jsonReq(VALID_ASSIGN_BODY));
    expect(res.status).toBe(400);
  });
});

describe('assign: malformed input rejected before the domain service is ever called', () => {
  it('missing required fields -> 400', async () => {
    const res: any = await assignPOST(jsonReq({ classId: CLASS_ID }));
    expect(res.status).toBe(400);
    expect(assignTeacherInterventionMock).not.toHaveBeenCalled();
  });

  it('an invalid target shape -> 400', async () => {
    const res: any = await assignPOST(jsonReq({ ...VALID_ASSIGN_BODY, target: { targetType: 'CONCEPT', skillId: CONCEPT_ID } }));
    expect(res.status).toBe(400);
    expect(assignTeacherInterventionMock).not.toHaveBeenCalled();
  });
});

describe('AUTHENTICATED with access: routes resolve the actor and pass params through unmodified', () => {
  it('assign', async () => {
    const res: any = await assignPOST(jsonReq(VALID_ASSIGN_BODY));
    expect(res.status).toBe(200);
    expect(assignTeacherInterventionMock).toHaveBeenCalledWith('actor-1', expect.objectContaining({ studentId: STUDENT_ID, classId: CLASS_ID }));
  });

  it('view', async () => {
    const res: any = await viewGET(urlReq(), withStudentParams(STUDENT_ID));
    expect(res.status).toBe(200);
    expect(listTeacherInterventionsForStudentMock).toHaveBeenCalledWith('actor-1', STUDENT_ID);
  });

  it('cancel', async () => {
    const res: any = await cancelPOST(jsonReq({ reason: 'no longer needed' }), withIdParams(INTERVENTION_ID));
    expect(res.status).toBe(200);
    expect(cancelTeacherInterventionMock).toHaveBeenCalledWith('actor-1', INTERVENTION_ID, 'no longer needed');
  });
});
