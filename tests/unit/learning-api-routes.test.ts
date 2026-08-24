import { describe, it, expect, vi, beforeEach } from 'vitest';

const verifyAuthMock = vi.fn();
const verifyStudentAccessMock = vi.fn();
vi.mock('@/lib/auth', () => ({
  verifyAuth: () => verifyAuthMock(),
  verifyStudentAccess: (...a: any[]) => verifyStudentAccessMock(...a),
}));

const getInterfaceLanguageMock = vi.fn();
vi.mock('@/lib/i18n/language', () => ({ getInterfaceLanguage: (...a: any[]) => getInterfaceLanguageMock(...a) }));

const getNextBestActionV3Mock = vi.fn();
vi.mock('@/services/next-best-action-v3.service', () => ({ getNextBestActionV3: (...a: any[]) => getNextBestActionV3Mock(...a) }));

const getDailyLearningPlanMock = vi.fn();
vi.mock('@/services/learning-execution-scheduler.service', () => ({ getDailyLearningPlan: (...a: any[]) => getDailyLearningPlanMock(...a) }));

const getLearningDecisionsMock = vi.fn();
vi.mock('@/services/adaptive-learning-orchestrator.service', () => ({ getLearningDecisions: (...a: any[]) => getLearningDecisionsMock(...a) }));

const startLearningSessionMock = vi.fn();
vi.mock('@/services/learning-session-engine.service', () => ({ startLearningSession: (...a: any[]) => startLearningSessionMock(...a) }));

import { GET as nextActionGET } from '@/app/api/learning/next-action/route';
import { GET as dailyPlanGET } from '@/app/api/learning/daily-plan/route';
import { POST as sessionStartPOST } from '@/app/api/learning/session/start/route';

const STUDENT_A = '11111111-1111-4111-8111-111111111111';
const STUDENT_B = '22222222-2222-4222-8222-222222222222';
const CONCEPT = '33333333-3333-4333-8333-333333333333';

function getRequest(path: string, params: Record<string, string>) {
  const qs = new URLSearchParams(params).toString();
  return { url: `http://localhost${path}?${qs}` } as any;
}

function postRequest(body: any) {
  return { json: async () => body } as any;
}

beforeEach(() => {
  verifyAuthMock.mockReset().mockResolvedValue({ userId: 'clerk-a', role: 'student' });
  verifyStudentAccessMock.mockReset().mockResolvedValue(true);
  getInterfaceLanguageMock.mockReset().mockResolvedValue('en');
  getNextBestActionV3Mock.mockReset().mockResolvedValue(null);
  getDailyLearningPlanMock.mockReset().mockResolvedValue({ studentId: STUDENT_A, generatedAt: '2026-01-01T00:00:00Z', availableMinutes: 30, plannedMinutes: 0, items: [], deferred: [] });
  getLearningDecisionsMock.mockReset().mockResolvedValue([]);
  startLearningSessionMock.mockReset().mockResolvedValue({ activityType: 'PRACTICE', evidenceMode: 'PRACTICE', actionConceptId: CONCEPT, subjectId: 'subj1', launchStatus: 'READY', launchTarget: '/dashboard/quiz', launchParams: {} });
});

describe('GET /api/learning/next-action', () => {
  it('401s when unauthenticated', async () => {
    verifyAuthMock.mockResolvedValue(null);
    const res: any = await nextActionGET(getRequest('/api/learning/next-action', { studentId: STUDENT_A }));
    expect(res.status).toBe(401);
  });

  it('400s when studentId is missing', async () => {
    const res: any = await nextActionGET(getRequest('/api/learning/next-action', {}));
    expect(res.status).toBe(400);
  });

  it('403s when the authenticated user cannot access the requested studentId (student isolation)', async () => {
    verifyStudentAccessMock.mockResolvedValue(false);
    const res: any = await nextActionGET(getRequest('/api/learning/next-action', { studentId: STUDENT_B }));
    expect(res.status).toBe(403);
    expect(verifyStudentAccessMock).toHaveBeenCalledWith('clerk-a', STUDENT_B, 'student');
    expect(getNextBestActionV3Mock).not.toHaveBeenCalled(); // never reaches the service on a denied check
  });

  it('200s and forwards the exact studentId when authorized', async () => {
    const res: any = await nextActionGET(getRequest('/api/learning/next-action', { studentId: STUDENT_A }));
    expect(res.status).toBe(200);
    expect(getNextBestActionV3Mock).toHaveBeenCalledWith(STUDENT_A, expect.objectContaining({ preferredLanguage: 'en' }));
  });

  it('rejects a non-numeric availableMinutes', async () => {
    const res: any = await nextActionGET(getRequest('/api/learning/next-action', { studentId: STUDENT_A, availableMinutes: 'not-a-number' }));
    expect(res.status).toBe(400);
  });
});

describe('GET /api/learning/daily-plan', () => {
  it('401s when unauthenticated', async () => {
    verifyAuthMock.mockResolvedValue(null);
    const res: any = await dailyPlanGET(getRequest('/api/learning/daily-plan', { studentId: STUDENT_A }));
    expect(res.status).toBe(401);
  });

  it('403s on cross-student access', async () => {
    verifyStudentAccessMock.mockResolvedValue(false);
    const res: any = await dailyPlanGET(getRequest('/api/learning/daily-plan', { studentId: STUDENT_B }));
    expect(res.status).toBe(403);
    expect(getDailyLearningPlanMock).not.toHaveBeenCalled();
  });

  it('200s and forwards studentId + availableMinutes when authorized', async () => {
    const res: any = await dailyPlanGET(getRequest('/api/learning/daily-plan', { studentId: STUDENT_A, availableMinutes: '15' }));
    expect(res.status).toBe(200);
    expect(getDailyLearningPlanMock).toHaveBeenCalledWith(STUDENT_A, expect.objectContaining({ availableMinutes: 15 }));
  });
});

describe('POST /api/learning/session/start', () => {
  it('401s when unauthenticated', async () => {
    verifyAuthMock.mockResolvedValue(null);
    const res: any = await sessionStartPOST(postRequest({ studentId: STUDENT_A, actionConceptId: CONCEPT }));
    expect(res.status).toBe(401);
  });

  it('400s on an invalid body (non-uuid studentId)', async () => {
    const res: any = await sessionStartPOST(postRequest({ studentId: 'not-a-uuid', actionConceptId: CONCEPT }));
    expect(res.status).toBe(400);
  });

  it('403s when the body studentId does not belong to the authenticated user -- a body override cannot defeat auth', async () => {
    verifyStudentAccessMock.mockResolvedValue(false);
    const res: any = await sessionStartPOST(postRequest({ studentId: STUDENT_B, actionConceptId: CONCEPT }));
    expect(res.status).toBe(403);
    expect(verifyStudentAccessMock).toHaveBeenCalledWith('clerk-a', STUDENT_B, 'student');
    expect(getLearningDecisionsMock).not.toHaveBeenCalled();
  });

  it('404s when no current decision exists for the given concept -- never fabricates a session', async () => {
    getLearningDecisionsMock.mockResolvedValue([]);
    const res: any = await sessionStartPOST(postRequest({ studentId: STUDENT_A, actionConceptId: CONCEPT }));
    expect(res.status).toBe(404);
    expect(startLearningSessionMock).not.toHaveBeenCalled();
  });

  it('200s and re-derives the decision server-side from a fresh getLearningDecisions call, never trusting a client-supplied decision', async () => {
    const decision = { actionConceptId: CONCEPT, subjectId: 'subj1', activityType: 'PRACTICE', priorityScore: 100 } as any;
    getLearningDecisionsMock.mockResolvedValue([decision]);
    const res: any = await sessionStartPOST(postRequest({ studentId: STUDENT_A, actionConceptId: CONCEPT }));
    expect(res.status).toBe(200);
    expect(getLearningDecisionsMock).toHaveBeenCalledWith(STUDENT_A, 'en');
    expect(startLearningSessionMock).toHaveBeenCalledWith({ studentId: STUDENT_A, learningDecision: decision });
  });
});

describe('Student isolation holds across all three routes', () => {
  it('every route calls verifyStudentAccess with the exact caller userId and requested studentId before touching any Phase 3D service', async () => {
    verifyStudentAccessMock.mockResolvedValue(true);
    await nextActionGET(getRequest('/api/learning/next-action', { studentId: STUDENT_A }));
    await dailyPlanGET(getRequest('/api/learning/daily-plan', { studentId: STUDENT_A }));
    await sessionStartPOST(postRequest({ studentId: STUDENT_A, actionConceptId: CONCEPT }));

    for (const call of verifyStudentAccessMock.mock.calls) {
      expect(call[0]).toBe('clerk-a');
      expect(call[1]).toBe(STUDENT_A);
    }
    expect(verifyStudentAccessMock).toHaveBeenCalledTimes(3);
  });
});
