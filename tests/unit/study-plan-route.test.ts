import { describe, it, expect, vi, beforeEach } from 'vitest';

const verifyAuthMock = vi.fn();
const verifyStudentAccessMock = vi.fn();
vi.mock('@/lib/auth', () => ({
  verifyAuth: () => verifyAuthMock(),
  verifyStudentAccess: (...a: any[]) => verifyStudentAccessMock(...a),
}));

const getInterfaceLanguageMock = vi.fn();
vi.mock('@/lib/i18n/language', () => ({ getInterfaceLanguage: (...a: any[]) => getInterfaceLanguageMock(...a) }));

const generateStudyPlanMock = vi.fn();
const storeStudyPlanMock = vi.fn();
const getActiveStudyPlanMock = vi.fn();
vi.mock('@/services/study-plan.service', () => ({
  generateStudyPlan: (...a: any[]) => generateStudyPlanMock(...a),
  storeStudyPlan: (...a: any[]) => storeStudyPlanMock(...a),
  getActiveStudyPlan: (...a: any[]) => getActiveStudyPlanMock(...a),
}));

import { GET, POST } from '@/app/api/study-plan/generate/route';

const STUDENT_A = '11111111-1111-4111-8111-111111111111';
const STUDENT_B = '22222222-2222-4222-8222-222222222222';

function getRequest(params: Record<string, string>) {
  const qs = new URLSearchParams(params).toString();
  return { url: `http://localhost/api/study-plan/generate?${qs}` } as any;
}
function postRequest(body: any) {
  return { json: async () => body } as any;
}

function plan(overrides: Partial<Record<string, any>> = {}) {
  return {
    studentId: STUDENT_A, startDate: new Date('2026-01-01'), endDate: new Date('2026-01-07'),
    sessions: [], totalStudyMinutes: 0, subjectsInPlan: [], criticalConceptsCount: 0, ...overrides,
  };
}

beforeEach(() => {
  verifyAuthMock.mockReset().mockResolvedValue({ userId: 'clerk-a', role: 'student' });
  verifyStudentAccessMock.mockReset().mockResolvedValue(true);
  getInterfaceLanguageMock.mockReset().mockResolvedValue('en');
  generateStudyPlanMock.mockReset().mockResolvedValue(plan());
  storeStudyPlanMock.mockReset().mockResolvedValue('plan-1');
  getActiveStudyPlanMock.mockReset().mockResolvedValue(plan());
});

describe('33. Existing /api/study-plan/generate still works after the Phase 3E migration', () => {
  it('GET returns the active plan for an authorized student', async () => {
    const res: any = await GET(getRequest({ studentId: STUDENT_A }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.plan).toBeTruthy();
  });

  it('POST generates and stores a new plan for an authorized student', async () => {
    const res: any = await POST(postRequest({ studentId: STUDENT_A, daysAhead: 7, dailyMinutes: 90 }));
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.planId).toBe('plan-1');
    expect(generateStudyPlanMock).toHaveBeenCalledWith(STUDENT_A, expect.objectContaining({ daysAhead: 7, dailyMinutes: 90 }));
  });
});

describe('34. Student isolation holds at the route boundary', () => {
  it('GET 403s on cross-student access, never reaching the service', async () => {
    verifyStudentAccessMock.mockResolvedValue(false);
    const res: any = await GET(getRequest({ studentId: STUDENT_B }));
    expect(res.status).toBe(403);
    expect(getActiveStudyPlanMock).not.toHaveBeenCalled();
  });

  it('POST 403s on cross-student access, never reaching the service', async () => {
    verifyStudentAccessMock.mockResolvedValue(false);
    const res: any = await POST(postRequest({ studentId: STUDENT_B }));
    expect(res.status).toBe(403);
    expect(generateStudyPlanMock).not.toHaveBeenCalled();
  });

  it('verifyStudentAccess is called with the exact authenticated userId and requested studentId', async () => {
    await GET(getRequest({ studentId: STUDENT_A }));
    expect(verifyStudentAccessMock).toHaveBeenCalledWith('clerk-a', STUDENT_A, 'student');
  });
});
