/**
 * F10 -- negative security tests for the new Parent read-model API
 * surface. Every learner-scoped route must (1) reject an unauthenticated
 * caller before ever calling the read model, and (2) translate a
 * ParentAccessDeniedError from the read model into 403, never a 500 or
 * a silent 200. The read model itself is mocked here -- its own
 * authorization logic (canAccessLearner/F2) is exercised for real
 * against real Postgres in the F10 certification run, not re-mocked
 * here (mirrors F9's own division between route-contract unit tests
 * and real-Postgres authorization certification).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const verifyAuthMock = vi.fn();
vi.mock('@/lib/auth', () => ({ verifyAuth: () => verifyAuthMock() }));

const getOrCreateCanonicalUserMock = vi.fn();
vi.mock('@/lib/identity', () => ({ getOrCreateCanonicalUser: (...a: any[]) => getOrCreateCanonicalUserMock(...a) }));

const { ParentAccessDeniedError } = vi.hoisted(() => ({
  ParentAccessDeniedError: class ParentAccessDeniedError extends Error {},
}));

const getParentLearnersMock = vi.fn();
const getParentLearnerOverviewMock = vi.fn();
const getParentSubjectProgressMock = vi.fn();
const getParentRecentActivityMock = vi.fn();
const getParentExamPreparationMock = vi.fn();
const getParentAttentionAreasMock = vi.fn();
vi.mock('@/lib/parent/read-model.service', () => ({
  ParentAccessDeniedError,
  getParentLearners: (...a: any[]) => getParentLearnersMock(...a),
  getParentLearnerOverview: (...a: any[]) => getParentLearnerOverviewMock(...a),
  getParentSubjectProgress: (...a: any[]) => getParentSubjectProgressMock(...a),
  getParentRecentActivity: (...a: any[]) => getParentRecentActivityMock(...a),
  getParentExamPreparation: (...a: any[]) => getParentExamPreparationMock(...a),
  getParentAttentionAreas: (...a: any[]) => getParentAttentionAreasMock(...a),
}));

import { GET as learnersGET } from '@/app/api/parent/learners/route';
import { GET as overviewGET } from '@/app/api/parent/learners/[studentId]/overview/route';
import { GET as subjectsGET } from '@/app/api/parent/learners/[studentId]/subjects/route';
import { GET as activityGET } from '@/app/api/parent/learners/[studentId]/activity/route';
import { GET as examPrepGET } from '@/app/api/parent/learners/[studentId]/exam-prep/route';
import { GET as attentionGET } from '@/app/api/parent/learners/[studentId]/attention/route';

const STUDENT_ID = '11111111-1111-4111-8111-111111111111';

function urlReq(url: string) {
  return { url, nextUrl: new URL(url) } as any;
}
function withParams(studentId: string) {
  return { params: Promise.resolve({ studentId }) };
}

const LEARNER_SCOPED_ROUTES: Array<{ name: string; call: () => Promise<any>; mock: ReturnType<typeof vi.fn> }> = [
  { name: 'overview', call: () => overviewGET(urlReq(`https://studyus.test/x`), withParams(STUDENT_ID)), mock: getParentLearnerOverviewMock },
  { name: 'subjects', call: () => subjectsGET(urlReq(`https://studyus.test/x`), withParams(STUDENT_ID)), mock: getParentSubjectProgressMock },
  { name: 'activity', call: () => activityGET(urlReq(`https://studyus.test/x`), withParams(STUDENT_ID)), mock: getParentRecentActivityMock },
  { name: 'exam-prep', call: () => examPrepGET(urlReq(`https://studyus.test/x`), withParams(STUDENT_ID)), mock: getParentExamPreparationMock },
  { name: 'attention', call: () => attentionGET(urlReq(`https://studyus.test/x`), withParams(STUDENT_ID)), mock: getParentAttentionAreasMock },
];

beforeEach(() => {
  verifyAuthMock.mockReset().mockResolvedValue({ userId: 'clerk-parent-1', email: 'parent@studyus.test' });
  getOrCreateCanonicalUserMock.mockReset().mockResolvedValue({ id: 'actor-1' });
  getParentLearnersMock.mockReset().mockResolvedValue([]);
  getParentLearnerOverviewMock.mockReset().mockResolvedValue({ studentId: STUDENT_ID });
  getParentSubjectProgressMock.mockReset().mockResolvedValue([]);
  getParentRecentActivityMock.mockReset().mockResolvedValue([]);
  getParentExamPreparationMock.mockReset().mockResolvedValue(null);
  getParentAttentionAreasMock.mockReset().mockResolvedValue([]);
});

describe('ANONYMOUS: every F10 Parent route denies before touching the read model', () => {
  it('learners list', async () => {
    verifyAuthMock.mockResolvedValue(null);
    const res: any = await learnersGET(urlReq('https://studyus.test/api/parent/learners'));
    expect(res.status).toBe(401);
    expect(getParentLearnersMock).not.toHaveBeenCalled();
  });

  for (const route of LEARNER_SCOPED_ROUTES) {
    it(route.name, async () => {
      verifyAuthMock.mockResolvedValue(null);
      const res: any = await route.call();
      expect(res.status).toBe(401);
      expect(route.mock).not.toHaveBeenCalled();
    });
  }
});

describe('AUTHENTICATED but no accepted relationship: every F10 learner-scoped route returns 403, never 500', () => {
  for (const route of LEARNER_SCOPED_ROUTES) {
    it(route.name, async () => {
      route.mock.mockRejectedValue(new ParentAccessDeniedError('denied'));
      const res: any = await route.call();
      expect(res.status).toBe(403);
    });
  }
});

describe('AUTHENTICATED with access: every F10 learner-scoped route resolves the actor and passes studentId through, never trusting it unchecked', () => {
  for (const route of LEARNER_SCOPED_ROUTES) {
    it(route.name, async () => {
      const res: any = await route.call();
      expect(res.status).toBe(200);
      const call = route.mock.mock.calls[0];
      expect(call[0]).toBe('actor-1');
      expect(call[1]).toBe(STUDENT_ID);
    });
  }
});

describe('zero-child state', () => {
  it('learners list returns an empty array, not an error, for a parent with no accepted relationships', async () => {
    getParentLearnersMock.mockResolvedValue([]);
    const res: any = await learnersGET(urlReq('https://studyus.test/api/parent/learners'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.learners).toEqual([]);
  });
});
