/**
 * Track A -- Teacher E2E readiness, route level: the Teacher's class
 * enrollment routes (invite / withdraw / remove only in classes they TEACH),
 * the learner-view and attention routes, the admin's class-subject link
 * and the assignment route's error mapping. Services are mocked; what is
 * under test is each route's own gate and that a denied call writes nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const verifyAuthMock = vi.fn();
vi.mock('@/lib/auth', () => ({ verifyAuth: () => verifyAuthMock() }));
vi.mock('@/lib/identity', () => ({ getOrCreateCanonicalUser: vi.fn(async () => ({ id: 'actor-1' })) }));
const canAccessInstitutionMock = vi.fn();
vi.mock('@/lib/authorization', () => ({ canAccessInstitution: (...a: any[]) => canAccessInstitutionMock(...a) }));

const getTeacherClassMock = vi.fn();
const publishMock = vi.fn();
vi.mock('@/lib/teacher/class-assignment.service', async () => {
  class TeacherClassAccessDeniedError extends Error {}
  class NoLearnersToAssignError extends Error {}
  class InvalidClassAssignmentError extends Error {
    constructor(public readonly code: string) {
      super(code);
    }
  }
  return {
    getTeacherClass: (...a: any[]) => getTeacherClassMock(...a),
    isTeacherOfClass: vi.fn(async () => false),
    publishClassAssignment: (...a: any[]) => publishMock(...a),
    listClassAssignments: vi.fn(async () => []),
    listAssignableConceptsForClass: vi.fn(async () => ({ concepts: [], activeLearners: 0, subjectLinked: true })),
    TeacherClassAccessDeniedError,
    NoLearnersToAssignError,
    InvalidClassAssignmentError,
  };
});
const inviteMock = vi.fn();
vi.mock('@/lib/institution/class-invitations', () => ({ inviteToClassAndNotify: (...a: any[]) => inviteMock(...a) }));
const endEnrollmentMock = vi.fn();
const setClassSubjectMock = vi.fn();
vi.mock('@/services/institution.service', () => ({
  listClassRosterForInstitution: vi.fn(async () => []),
  endClassEnrollment: (...a: any[]) => endEnrollmentMock(...a),
  setClassSubject: (...a: any[]) => setClassSubjectMock(...a),
}));
const learnerViewMock = vi.fn();
const attentionMock = vi.fn();
vi.mock('@/lib/teacher/learner-view.service', () => {
  class TeacherLearnerAccessDeniedError extends Error {}
  return {
    getTeacherLearnerView: (...a: any[]) => learnerViewMock(...a),
    listClassLearnerAttention: (...a: any[]) => attentionMock(...a),
    TeacherLearnerAccessDeniedError,
  };
});

import { GET as enrollGET, POST as enrollPOST } from '@/app/api/teacher/classes/[classId]/enrollments/route';
import { POST as endPOST } from '@/app/api/teacher/classes/[classId]/enrollments/[enrollmentId]/end/route';
import { GET as learnerGET } from '@/app/api/teacher/classes/[classId]/students/[studentId]/route';
import { GET as attentionGET } from '@/app/api/teacher/classes/[classId]/attention/route';
import { PATCH as classPATCH } from '@/app/api/institutions/[id]/classes/[classId]/route';
import { POST as assignmentsPOST } from '@/app/api/teacher/classes/[classId]/assignments/route';
import * as classService from '@/lib/teacher/class-assignment.service';
import * as learnerView from '@/lib/teacher/learner-view.service';

const req = (body?: unknown) => ({ json: async () => body ?? {} }) as any;
const p = <T,>(v: T) => ({ params: Promise.resolve(v) });
const INST = '11111111-1111-4111-8111-111111111111';
const CLASS = '22222222-2222-4222-8222-222222222222';
const ENR = '33333333-3333-4333-8333-333333333333';
const STUDENT = '44444444-4444-4444-8444-444444444444';
const SUBJ = '55555555-5555-4555-8555-555555555555';
const KLASS = { id: CLASS, name: 'Matemáticas 3A', institutionId: INST, institutionName: 'A', gradeName: '3º', subjectId: SUBJ, subjectName: 'Mathematics' };

beforeEach(() => {
  verifyAuthMock.mockReset().mockResolvedValue({ userId: 'clerk-1', email: 'a@example.com' });
  canAccessInstitutionMock.mockReset().mockResolvedValue(true);
  getTeacherClassMock.mockReset().mockResolvedValue(KLASS);
  inviteMock.mockReset().mockResolvedValue({ outcome: 'INVITED', enrollmentId: ENR, studentUserId: 'u-s' });
  endEnrollmentMock.mockReset().mockResolvedValue(true);
  setClassSubjectMock.mockReset().mockResolvedValue(true);
  learnerViewMock.mockReset().mockResolvedValue({});
  attentionMock.mockReset().mockResolvedValue({ klass: KLASS, learners: [] });
  publishMock.mockReset();
});

describe('Teacher invites to their OWN class only (TEACHER_STUDENT_ENROLLMENT)', () => {
  it('unauthenticated → 401, nothing invited', async () => {
    verifyAuthMock.mockResolvedValue(null);
    expect((await enrollPOST(req({ email: 's@x.com' }), p({ classId: CLASS }))).status).toBe(401);
    expect(inviteMock).not.toHaveBeenCalled();
  });

  it('a teacher who does not teach the class (pending, other class, institution admin) → 403, nothing invited', async () => {
    getTeacherClassMock.mockResolvedValue(null);
    expect((await enrollPOST(req({ email: 's@x.com' }), p({ classId: CLASS }))).status).toBe(403);
    expect((await enrollGET(req(), p({ classId: CLASS }))).status).toBe(403);
    expect(inviteMock).not.toHaveBeenCalled();
  });

  it('the class\'s teacher invites into THAT class of THAT institution (never a client-supplied institution)', async () => {
    const res = await enrollPOST(req({ email: 'sofia@x.com', institutionId: 'spoofed' }), p({ classId: CLASS }));
    expect(res.status).toBe(201);
    expect(inviteMock).toHaveBeenCalledWith(INST, KLASS, 'sofia@x.com', 'actor-1');
  });

  it('idempotent: an existing pending / active enrollment is 200 with its outcome, not a duplicate', async () => {
    inviteMock.mockResolvedValue({ outcome: 'ALREADY_ACTIVE' });
    const res = await enrollPOST(req({ email: 'sofia@x.com' }), p({ classId: CLASS }));
    expect(res.status).toBe(200);
    expect((await res.json()).data.outcome).toBe('ALREADY_ACTIVE');
  });

  it('an email without a Student account → 404', async () => {
    inviteMock.mockResolvedValue({ outcome: 'NO_STUDENT_ACCOUNT' });
    expect((await enrollPOST(req({ email: 'nobody@x.com' }), p({ classId: CLASS }))).status).toBe(404);
  });

  it('remove / withdraw: only in the teacher\'s class; a foreign enrollment id is 404', async () => {
    endEnrollmentMock.mockResolvedValue(false);
    expect((await endPOST(req(), p({ classId: CLASS, enrollmentId: ENR }))).status).toBe(404);
    expect(endEnrollmentMock).toHaveBeenCalledWith(INST, CLASS, ENR);
    getTeacherClassMock.mockResolvedValue(null);
    endEnrollmentMock.mockClear();
    expect((await endPOST(req(), p({ classId: CLASS, enrollmentId: ENR }))).status).toBe(403);
    expect(endEnrollmentMock).not.toHaveBeenCalled();
  });

  it('malformed ids never reach the database', async () => {
    expect((await enrollPOST(req({ email: 's@x.com' }), p({ classId: 'not-a-uuid' }))).status).toBe(403);
    expect(getTeacherClassMock).not.toHaveBeenCalled();
  });
});

describe('Teacher learner view routes (TEACHER_LEARNER_VISIBILITY)', () => {
  it('denied learner / class → 403 with no data', async () => {
    learnerViewMock.mockRejectedValue(new (learnerView as any).TeacherLearnerAccessDeniedError());
    const res = await learnerGET(req(), p({ classId: CLASS, studentId: STUDENT }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'FORBIDDEN' });
    attentionMock.mockRejectedValue(new (learnerView as any).TeacherLearnerAccessDeniedError());
    expect((await attentionGET(req(), p({ classId: CLASS }))).status).toBe(403);
  });

  it('allowed → the view for exactly (actor, class, learner)', async () => {
    expect((await learnerGET(req(), p({ classId: CLASS, studentId: STUDENT }))).status).toBe(200);
    expect(learnerViewMock).toHaveBeenCalledWith('actor-1', CLASS, STUDENT);
  });
});

describe('Institution admin links the class subject', () => {
  it('not an admin of THIS institution (e.g. the teacher) → 403, nothing changed', async () => {
    canAccessInstitutionMock.mockResolvedValue(false);
    expect((await classPATCH(req({ canonicalSubjectId: SUBJ }), p({ id: INST, classId: CLASS }))).status).toBe(403);
    expect(setClassSubjectMock).not.toHaveBeenCalled();
  });

  it('inactive subject → 422; foreign class → 404', async () => {
    setClassSubjectMock.mockRejectedValueOnce(new Error('SUBJECT_NOT_AVAILABLE'));
    expect((await classPATCH(req({ canonicalSubjectId: SUBJ }), p({ id: INST, classId: CLASS }))).status).toBe(422);
    setClassSubjectMock.mockResolvedValueOnce(false);
    expect((await classPATCH(req({ canonicalSubjectId: SUBJ }), p({ id: INST, classId: CLASS }))).status).toBe(404);
  });
});

describe('Assignment route maps invalid requests to 422 with the reason', () => {
  it.each(['CLASS_SUBJECT_REQUIRED', 'CONCEPT_NOT_IN_CLASS_SUBJECT', 'RECIPIENT_NOT_IN_CLASS', 'INVALID_DATES'])('%s → 422', async (code) => {
    publishMock.mockRejectedValue(new (classService as any).InvalidClassAssignmentError(code));
    const res = await assignmentsPOST(req({ canonicalConceptId: SUBJ }), p({ classId: CLASS }));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe(code);
  });

  it('selected recipients and dates are forwarded as given', async () => {
    publishMock.mockResolvedValue({ assignmentGroupId: 'g', assigned: [], skipped: [] });
    await assignmentsPOST(req({ canonicalConceptId: SUBJ, title: 'Repaso', startsAt: '2026-10-02T00:00:00.000Z', studentIds: [STUDENT] }), p({ classId: CLASS }));
    expect(publishMock).toHaveBeenCalledWith('actor-1', expect.objectContaining({ classId: CLASS, title: 'Repaso', studentIds: [STUDENT], startsAt: '2026-10-02T00:00:00.000Z' }));
  });
});
