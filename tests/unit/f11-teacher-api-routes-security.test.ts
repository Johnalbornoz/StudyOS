/**
 * F11-A -- negative security tests for the new Teacher read-model API
 * surface. Every learner/class-scoped route must (1) reject an
 * unauthenticated caller before ever calling the read model, and (2) a
 * TeacherAccessDeniedError from the read model must translate to 403,
 * never a 500 or a silent 200. The read model itself is mocked here --
 * its own authorization logic (canTeacherAccessLearner/canAccessClass,
 * F2) is exercised for real against real Postgres in the F11-A
 * certification run, not re-mocked here (mirrors F10's own division).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const verifyAuthMock = vi.fn();
vi.mock('@/lib/auth', () => ({ verifyAuth: () => verifyAuthMock() }));

const getOrCreateCanonicalUserMock = vi.fn();
vi.mock('@/lib/identity', () => ({ getOrCreateCanonicalUser: (...a: any[]) => getOrCreateCanonicalUserMock(...a) }));

const { TeacherAccessDeniedError } = vi.hoisted(() => ({
  TeacherAccessDeniedError: class TeacherAccessDeniedError extends Error {},
}));

const getTeacherAssignedClassesMock = vi.fn();
const getTeacherClassRosterMock = vi.fn();
const getTeacherStudentOverviewMock = vi.fn();
vi.mock('@/lib/teacher/read-model.service', () => ({
  TeacherAccessDeniedError,
  getTeacherAssignedClasses: (...a: any[]) => getTeacherAssignedClassesMock(...a),
  getTeacherClassRoster: (...a: any[]) => getTeacherClassRosterMock(...a),
  getTeacherStudentOverview: (...a: any[]) => getTeacherStudentOverviewMock(...a),
}));

import { GET as classesGET } from '@/app/api/teacher/classes/route';
import { GET as rosterGET } from '@/app/api/teacher/classes/[classId]/roster/route';
import { GET as overviewGET } from '@/app/api/teacher/students/[studentId]/overview/route';

const CLASS_ID = '22222222-2222-4222-8222-222222222222';
const STUDENT_ID = '11111111-1111-4111-8111-111111111111';

function urlReq(url: string) {
  return { url, nextUrl: new URL(url) } as any;
}
function withClassParams(classId: string) {
  return { params: Promise.resolve({ classId }) };
}
function withStudentParams(studentId: string) {
  return { params: Promise.resolve({ studentId }) };
}

const SCOPED_ROUTES: Array<{ name: string; call: () => Promise<any>; mock: ReturnType<typeof vi.fn> }> = [
  { name: 'roster', call: () => rosterGET(urlReq('https://studyus.test/x'), withClassParams(CLASS_ID)), mock: getTeacherClassRosterMock },
  { name: 'overview', call: () => overviewGET(urlReq('https://studyus.test/x'), withStudentParams(STUDENT_ID)), mock: getTeacherStudentOverviewMock },
];

beforeEach(() => {
  verifyAuthMock.mockReset().mockResolvedValue({ userId: 'clerk-teacher-1', email: 'teacher@studyus.test' });
  getOrCreateCanonicalUserMock.mockReset().mockResolvedValue({ id: 'actor-1' });
  getTeacherAssignedClassesMock.mockReset().mockResolvedValue([]);
  getTeacherClassRosterMock.mockReset().mockResolvedValue([]);
  getTeacherStudentOverviewMock.mockReset().mockResolvedValue({ studentId: STUDENT_ID });
});

describe('ANONYMOUS: every F11-A Teacher route denies before touching the read model', () => {
  it('classes list', async () => {
    verifyAuthMock.mockResolvedValue(null);
    const res: any = await classesGET(urlReq('https://studyus.test/api/teacher/classes'));
    expect(res.status).toBe(401);
    expect(getTeacherAssignedClassesMock).not.toHaveBeenCalled();
  });

  for (const route of SCOPED_ROUTES) {
    it(route.name, async () => {
      verifyAuthMock.mockResolvedValue(null);
      const res: any = await route.call();
      expect(res.status).toBe(401);
      expect(route.mock).not.toHaveBeenCalled();
    });
  }
});

describe('AUTHENTICATED but no valid Teacher relationship: every scoped route returns 403, never 500', () => {
  for (const route of SCOPED_ROUTES) {
    it(route.name, async () => {
      route.mock.mockRejectedValue(new TeacherAccessDeniedError('denied'));
      const res: any = await route.call();
      expect(res.status).toBe(403);
    });
  }
});

describe('AUTHENTICATED with access: routes resolve the actor and pass the route param through, never trusting it unchecked', () => {
  for (const route of SCOPED_ROUTES) {
    it(route.name, async () => {
      const res: any = await route.call();
      expect(res.status).toBe(200);
      const call = route.mock.mock.calls[0];
      expect(call[0]).toBe('actor-1');
    });
  }
});

describe('zero-class state', () => {
  it('classes list returns an empty array, not an error, for a teacher with no active assignments', async () => {
    getTeacherAssignedClassesMock.mockResolvedValue([]);
    const res: any = await classesGET(urlReq('https://studyus.test/api/teacher/classes'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.classes).toEqual([]);
  });
});
