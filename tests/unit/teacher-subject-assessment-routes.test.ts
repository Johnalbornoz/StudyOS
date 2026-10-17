/**
 * Overnight 2026-10-16 -- teacher-assigned subject Test / Mock: route authorization and isolation (rule AO).
 * Routes: services mocked, what is under test is each route's own gate and error mapping. Services: the authorization
 * order (nothing read or written for an actor who is not the owner / the class's teacher / the learner's teacher).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const verifyAuthMock = vi.fn();
const requireStudentIdMock = vi.fn();
vi.mock('@/lib/auth', () => ({ verifyAuth: () => verifyAuthMock(), requireStudentId: (...a: any[]) => requireStudentIdMock(...a) }));
vi.mock('@/lib/identity', () => ({ getOrCreateCanonicalUser: vi.fn(async () => ({ id: 'actor-1' })) }));
const ownStudentIdMock = vi.fn();
vi.mock('@/lib/exam-core/route-auth', () => ({ ownStudentId: (...a: any[]) => ownStudentIdMock(...a) }));
const licenceMock = vi.fn();
vi.mock('@/lib/entitlements/learning-gate', () => ({ learningLicenceRequiredUnlessOpenAttemptForActor: (...a: any[]) => licenceMock(...a) }));
const isOwnerMock = vi.fn();
const canTeacherAccessLearnerMock = vi.fn();
vi.mock('@/lib/authorization', () => ({ isOwner: (...a: any[]) => isOwnerMock(...a), canTeacherAccessLearner: (...a: any[]) => canTeacherAccessLearnerMock(...a) }));
const dbQueryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => dbQueryMock(...a) } }));
const heartbeatMock = vi.fn();
vi.mock('@/services/subject-assessment.service', () => ({ heartbeatSubjectAssessmentSession: (...a: any[]) => heartbeatMock(...a) }));

const svc = {
  getSubjectAssessmentComposerContext: vi.fn(),
  listClassSubjectAssessmentAssignments: vi.fn(),
  publishSubjectAssessmentAssignment: vi.fn(),
  previewSubjectAssessmentAssignment: vi.fn(),
  getSubjectAssessmentGroupResults: vi.fn(),
  getSubjectAssessmentStudentResult: vi.fn(),
  listStudentSubjectAssignments: vi.fn(),
  startSubjectAssignmentAttempt: vi.fn(),
};
vi.mock('@/lib/teacher/subject-assessment-assignment.service', () => {
  class SubjectAssignmentError extends Error {
    constructor(public readonly code: string, public readonly status = 422) { super(code); }
  }
  return {
    SubjectAssignmentError,
    getSubjectAssessmentComposerContext: (...a: any[]) => svc.getSubjectAssessmentComposerContext(...a),
    listClassSubjectAssessmentAssignments: (...a: any[]) => svc.listClassSubjectAssessmentAssignments(...a),
    publishSubjectAssessmentAssignment: (...a: any[]) => svc.publishSubjectAssessmentAssignment(...a),
    previewSubjectAssessmentAssignment: (...a: any[]) => svc.previewSubjectAssessmentAssignment(...a),
    getSubjectAssessmentGroupResults: (...a: any[]) => svc.getSubjectAssessmentGroupResults(...a),
    getSubjectAssessmentStudentResult: (...a: any[]) => svc.getSubjectAssessmentStudentResult(...a),
    listStudentSubjectAssignments: (...a: any[]) => svc.listStudentSubjectAssignments(...a),
    startSubjectAssignmentAttempt: (...a: any[]) => svc.startSubjectAssignmentAttempt(...a),
  };
});
vi.mock('@/lib/teacher/class-assignment.service', () => {
  class TeacherClassAccessDeniedError extends Error {}
  class NoLearnersToAssignError extends Error {}
  class InvalidClassAssignmentError extends Error {
    constructor(public readonly code: string) { super(code); }
  }
  return { TeacherClassAccessDeniedError, NoLearnersToAssignError, InvalidClassAssignmentError };
});

import { GET as listGET, POST as publishPOST } from '@/app/api/teacher/classes/[classId]/subject-assessments/route';
import { POST as previewPOST } from '@/app/api/teacher/classes/[classId]/subject-assessments/preview/route';
import { GET as groupGET } from '@/app/api/teacher/classes/[classId]/subject-assessments/[groupId]/route';
import { GET as drillGET } from '@/app/api/teacher/classes/[classId]/subject-assessments/[groupId]/students/[studentId]/route';
import { GET as studentListGET } from '@/app/api/student/subject-assessment-assignments/route';
import { POST as attemptPOST } from '@/app/api/student/subject-assessment-assignments/[interventionId]/attempts/route';
import { POST as heartbeatPOST } from '@/app/api/quizzes/session/[quizId]/heartbeat/route';
import { TeacherClassAccessDeniedError } from '@/lib/teacher/class-assignment.service';
import { SubjectAssignmentError } from '@/lib/teacher/subject-assessment-assignment.service';

const CLASS = '22222222-2222-4222-8222-222222222222';
const GROUP = '33333333-3333-4333-8333-333333333333';
const STUDENT = '44444444-4444-4444-8444-444444444444';
const IV = '55555555-5555-4555-8555-555555555555';
const C1 = '66666666-6666-4666-8666-666666666666';
const p = <T,>(v: T) => ({ params: Promise.resolve(v) });
const req = (body?: unknown, url = 'http://x/api') => ({ json: async () => body ?? {}, nextUrl: new URL(url), url }) as any;
const draft = { kind: 'TEST', conceptIds: [C1], difficulty: 'BASICO', startDate: '2026-10-17', endDate: '2026-10-18', maxAttempts: 2, timing: { timed: false, durationMinutes: null } };

beforeEach(() => {
  verifyAuthMock.mockReset().mockResolvedValue({ userId: 'clerk-1', email: 'a@example.com' });
  requireStudentIdMock.mockReset().mockResolvedValue(STUDENT);
  ownStudentIdMock.mockReset().mockResolvedValue(STUDENT);
  licenceMock.mockReset().mockResolvedValue(null);
  isOwnerMock.mockReset().mockResolvedValue(true);
  canTeacherAccessLearnerMock.mockReset().mockResolvedValue(true);
  dbQueryMock.mockReset().mockResolvedValue({ rows: [] });
  heartbeatMock.mockReset().mockResolvedValue({ ok: true, data: { alive: true, state: 'ACTIVE' } });
  for (const f of Object.values(svc)) f.mockReset();
});

describe('teacher routes', () => {
  it('unauthenticated -> 401; non-uuid ids -> 403; nothing called', async () => {
    verifyAuthMock.mockResolvedValue(null);
    expect((await listGET(req(), p({ classId: CLASS }))).status).toBe(401);
    expect((await publishPOST(req(draft), p({ classId: CLASS }))).status).toBe(401);
    verifyAuthMock.mockResolvedValue({ userId: 'c', email: null });
    expect((await groupGET(req(), p({ classId: 'nope', groupId: GROUP }))).status).toBe(403);
    expect((await drillGET(req(), p({ classId: CLASS, groupId: GROUP, studentId: 'x' }))).status).toBe(403);
    expect(svc.getSubjectAssessmentGroupResults).not.toHaveBeenCalled();
    expect(svc.getSubjectAssessmentStudentResult).not.toHaveBeenCalled();
  });

  it('a teacher who does not teach the class -> 403 on every route', async () => {
    const deny = async () => { throw new TeacherClassAccessDeniedError('x'); };
    svc.getSubjectAssessmentComposerContext.mockImplementation(deny);
    svc.listClassSubjectAssessmentAssignments.mockImplementation(deny);
    svc.publishSubjectAssessmentAssignment.mockImplementation(deny);
    svc.previewSubjectAssessmentAssignment.mockImplementation(deny);
    svc.getSubjectAssessmentGroupResults.mockImplementation(deny);
    svc.getSubjectAssessmentStudentResult.mockImplementation(deny);
    expect((await listGET(req(), p({ classId: CLASS }))).status).toBe(403);
    expect((await publishPOST(req(draft), p({ classId: CLASS }))).status).toBe(403);
    expect((await previewPOST(req(draft), p({ classId: CLASS }))).status).toBe(403);
    expect((await groupGET(req(), p({ classId: CLASS, groupId: GROUP }))).status).toBe(403);
    expect((await drillGET(req(), p({ classId: CLASS, groupId: GROUP, studentId: STUDENT }))).status).toBe(403);
  });

  it('the class comes from the path, never the body; the body is validated (difficulty taxonomy, dates only)', async () => {
    svc.publishSubjectAssessmentAssignment.mockResolvedValue({ assignmentGroupId: GROUP });
    const r = await publishPOST(req({ ...draft, classId: '99999999-9999-4999-8999-999999999999' }), p({ classId: CLASS }));
    expect(r.status).toBe(201);
    expect(svc.publishSubjectAssessmentAssignment.mock.calls[0][1].classId).toBe(CLASS);
    expect((await publishPOST(req({ ...draft, difficulty: 'EXTREMO' }), p({ classId: CLASS }))).status).toBe(400);
    expect((await publishPOST(req({ ...draft, startDate: '2026-10-17T10:00:00Z' }), p({ classId: CLASS }))).status).toBe(400);
    expect((await publishPOST(req({ ...draft, conceptIds: [] }), p({ classId: CLASS }))).status).toBe(400);
    expect(svc.publishSubjectAssessmentAssignment).toHaveBeenCalledTimes(1);
  });

  it('TIMEZONE_AUTHORITY_BLOCKER is answered as 409 with its code', async () => {
    svc.publishSubjectAssessmentAssignment.mockRejectedValue(new SubjectAssignmentError('TIMEZONE_AUTHORITY_BLOCKER', 409));
    const r = await publishPOST(req(draft), p({ classId: CLASS }));
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: 'TIMEZONE_AUTHORITY_BLOCKER' });
  });

  it('a student who is not a recipient of the group -> 404 (no hint)', async () => {
    svc.getSubjectAssessmentStudentResult.mockRejectedValue(new SubjectAssignmentError('NOT_FOUND', 404));
    expect((await drillGET(req(), p({ classId: CLASS, groupId: GROUP, studentId: STUDENT }))).status).toBe(404);
  });
});

describe('student routes', () => {
  it('the list is always the actor\'s own (studentId resolved server-side; no Student -> 403)', async () => {
    svc.listStudentSubjectAssignments.mockResolvedValue([]);
    expect((await studentListGET(req(undefined, `http://x/api?studentId=${STUDENT}`))).status).toBe(200);
    expect(svc.listStudentSubjectAssignments).toHaveBeenCalledWith(STUDENT);
    requireStudentIdMock.mockResolvedValue(null);
    expect((await studentListGET(req())).status).toBe(403);
  });

  it('start / resume: no Student account -> 403; a non-owner (service FORBIDDEN) -> 403; licence only when nothing is open', async () => {
    ownStudentIdMock.mockResolvedValue(null);
    expect((await attemptPOST(req(), p({ interventionId: IV }))).status).toBe(403);
    ownStudentIdMock.mockResolvedValue(STUDENT);
    svc.startSubjectAssignmentAttempt.mockRejectedValue(new SubjectAssignmentError('FORBIDDEN', 403));
    expect((await attemptPOST(req(), p({ interventionId: IV }))).status).toBe(403);
    expect(licenceMock).toHaveBeenLastCalledWith('actor-1', STUDENT, false);
    dbQueryMock.mockResolvedValue({ rows: [{ '?': 1 }] });
    svc.startSubjectAssignmentAttempt.mockResolvedValue({ outcome: 'RESUMED', quizId: 'q1' });
    expect((await attemptPOST(req(), p({ interventionId: IV }))).status).toBe(200);
    expect(licenceMock).toHaveBeenLastCalledWith('actor-1', STUDENT, true);
    // the open-attempt probe is scoped to the actor's own Student
    expect(dbQueryMock.mock.calls.at(-1)![1]).toEqual([STUDENT, IV]);
  });

  it('a window refusal is a 409 with its code (closed / exhausted / not open yet)', async () => {
    for (const code of ['WINDOW_CLOSED', 'ATTEMPTS_EXHAUSTED', 'NOT_OPEN_YET', 'WINDOW_CLOSED_AFTER_EXIT']) {
      svc.startSubjectAssignmentAttempt.mockRejectedValueOnce(new SubjectAssignmentError(code, 409));
      const r = await attemptPOST(req(), p({ interventionId: IV }));
      expect(r.status).toBe(409);
      expect((await r.json()).error).toBe(code);
    }
  });

  it('heartbeat: owner only (another student\'s attempt -> 403, the service is never called)', async () => {
    isOwnerMock.mockResolvedValue(false);
    expect((await heartbeatPOST(req({ studentId: STUDENT }), p({ quizId: 'q1' }))).status).toBe(403);
    expect(heartbeatMock).not.toHaveBeenCalled();
    isOwnerMock.mockResolvedValue(true);
    expect((await heartbeatPOST(req({ studentId: STUDENT }), p({ quizId: 'q1' }))).status).toBe(200);
    expect(heartbeatMock).toHaveBeenCalledWith(STUDENT, 'q1');
  });
});
