/**
 * F11-C1 -- negative security tests for the Student execution API
 * surface. The orchestration service's own authorization logic
 * (isOwner) is exercised for real against real Postgres in the F11-C1
 * certification run (mirrors F10/F11-A/F11-B's own division).
 *
 * F11-C2 update: the route now calls the generic dispatcher
 * (`startTeacherInterventionExecution`) instead of the Concept-only
 * function directly (F11-C2 extends the same route to also dispatch
 * Skill executions) -- this file's mock target is renamed to match;
 * every assertion and the route's actual request/response contract are
 * otherwise unchanged.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const verifyAuthMock = vi.fn();
const getOrCreateStudentIdMock = vi.fn();
vi.mock('@/lib/auth', () => ({ verifyAuth: () => verifyAuthMock(), getOrCreateStudentId: (...a: any[]) => getOrCreateStudentIdMock(...a) }));

const getOrCreateCanonicalUserMock = vi.fn();
vi.mock('@/lib/identity', () => ({ getOrCreateCanonicalUser: (...a: any[]) => getOrCreateCanonicalUserMock(...a) }));

const { StudentInterventionAccessDeniedError, StudentInterventionNotFoundError, StudentInterventionNotStartableError } = vi.hoisted(() => ({
  StudentInterventionAccessDeniedError: class StudentInterventionAccessDeniedError extends Error {},
  StudentInterventionNotFoundError: class StudentInterventionNotFoundError extends Error {},
  StudentInterventionNotStartableError: class StudentInterventionNotStartableError extends Error {},
}));

const getStudentPendingTeacherInterventionsMock = vi.fn();
const startTeacherInterventionExecutionMock = vi.fn();
vi.mock('@/lib/student/teacher-intervention-execution.service', () => ({
  StudentInterventionAccessDeniedError,
  StudentInterventionNotFoundError,
  StudentInterventionNotStartableError,
  getStudentPendingTeacherInterventions: (...a: any[]) => getStudentPendingTeacherInterventionsMock(...a),
  startTeacherInterventionExecution: (...a: any[]) => startTeacherInterventionExecutionMock(...a),
}));

import { GET as listGET } from '@/app/api/student/teacher-interventions/route';
import { POST as startPOST } from '@/app/api/student/teacher-interventions/[id]/start/route';

const STUDENT_ID = '11111111-1111-4111-8111-111111111111';
const INTERVENTION_ID = '44444444-4444-4444-8444-444444444444';

function jsonReq(body: any) {
  return { json: async () => body } as any;
}
function urlReq() {
  return {} as any;
}
function withIdParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  verifyAuthMock.mockReset().mockResolvedValue({ userId: 'clerk-student-1', email: 'student@studyus.test' });
  getOrCreateStudentIdMock.mockReset().mockResolvedValue(STUDENT_ID);
  getOrCreateCanonicalUserMock.mockReset().mockResolvedValue({ id: 'actor-1' });
  getStudentPendingTeacherInterventionsMock.mockReset().mockResolvedValue([]);
  startTeacherInterventionExecutionMock.mockReset().mockResolvedValue({ outcome: 'STARTED', executionId: 'exec-1', executionReference: 'quiz-1' });
});

describe('ANONYMOUS: every F11-C1 route denies before touching the orchestration service', () => {
  it('list', async () => {
    verifyAuthMock.mockResolvedValue(null);
    const res: any = await listGET(urlReq());
    expect(res.status).toBe(401);
    expect(getStudentPendingTeacherInterventionsMock).not.toHaveBeenCalled();
  });

  it('start', async () => {
    verifyAuthMock.mockResolvedValue(null);
    const res: any = await startPOST(jsonReq({ idempotencyKey: 'k1' }), withIdParams(INTERVENTION_ID));
    expect(res.status).toBe(401);
    expect(startTeacherInterventionExecutionMock).not.toHaveBeenCalled();
  });
});

describe('AUTHENTICATED but denied by the orchestration service: 403/404/409, never 500', () => {
  it('start: FORBIDDEN', async () => {
    startTeacherInterventionExecutionMock.mockRejectedValue(new StudentInterventionAccessDeniedError('denied'));
    const res: any = await startPOST(jsonReq({ idempotencyKey: 'k1' }), withIdParams(INTERVENTION_ID));
    expect(res.status).toBe(403);
  });

  it('start: NOT_FOUND', async () => {
    startTeacherInterventionExecutionMock.mockRejectedValue(new StudentInterventionNotFoundError(INTERVENTION_ID));
    const res: any = await startPOST(jsonReq({ idempotencyKey: 'k1' }), withIdParams(INTERVENTION_ID));
    expect(res.status).toBe(404);
  });

  it('start: NOT_STARTABLE (cancelled/completed/expired)', async () => {
    startTeacherInterventionExecutionMock.mockRejectedValue(new StudentInterventionNotStartableError('not startable'));
    const res: any = await startPOST(jsonReq({ idempotencyKey: 'k1' }), withIdParams(INTERVENTION_ID));
    expect(res.status).toBe(409);
  });
});

describe('start: missing idempotencyKey is rejected before the orchestration service is called', () => {
  it('returns 400', async () => {
    const res: any = await startPOST(jsonReq({}), withIdParams(INTERVENTION_ID));
    expect(res.status).toBe(400);
    expect(startTeacherInterventionExecutionMock).not.toHaveBeenCalled();
  });
});

describe('AUTHENTICATED with access: routes resolve identity and pass params through unmodified', () => {
  it('list uses the SERVER-resolved studentId, never a client-supplied one', async () => {
    const res: any = await listGET(urlReq());
    expect(res.status).toBe(200);
    expect(getStudentPendingTeacherInterventionsMock).toHaveBeenCalledWith(STUDENT_ID);
  });

  it('start passes the resolved actor id, the route param id, and the idempotency key through', async () => {
    const res: any = await startPOST(jsonReq({ idempotencyKey: 'k1' }), withIdParams(INTERVENTION_ID));
    expect(res.status).toBe(200);
    expect(startTeacherInterventionExecutionMock).toHaveBeenCalledWith('actor-1', INTERVENTION_ID, 'k1');
  });
});

describe('NOT_EXECUTABLE_YET is a clean 200 domain result, never an error', () => {
  it('returns success:true with the NOT_EXECUTABLE_YET outcome', async () => {
    startTeacherInterventionExecutionMock.mockResolvedValue({ outcome: 'NOT_EXECUTABLE_YET', interventionType: 'SKILL_PRACTICE' });
    const res: any = await startPOST(jsonReq({ idempotencyKey: 'k1' }), withIdParams(INTERVENTION_ID));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.outcome).toBe('NOT_EXECUTABLE_YET');
  });
});
