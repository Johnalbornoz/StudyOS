/**
 * `/api/study-plan/generate` -- Phase 8 Step 8G1 compatibility shim.
 * GET returns the canonical ACTIVE plan in the legacy shape; POST runs
 * the canonical rebuild and returns the same. Neither writes a legacy
 * `study_plans` row. Student isolation still holds at the boundary.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const verifyAuthMock = vi.fn();
const verifyStudentAccessMock = vi.fn();
vi.mock('@/lib/auth', () => ({
  verifyAuth: () => verifyAuthMock(),
  verifyStudentAccess: (...a: any[]) => verifyStudentAccessMock(...a),
}));

const getInterfaceLanguageMock = vi.fn();
vi.mock('@/lib/i18n/language', () => ({ getInterfaceLanguage: (...a: any[]) => getInterfaceLanguageMock(...a) }));

const rebuildLearningPlanMock = vi.fn();
vi.mock('@/services/learning-orchestration.service', () => ({
  rebuildLearningPlan: (...a: any[]) => rebuildLearningPlanMock(...a),
}));

const getLegacyShapedCanonicalPlanMock = vi.fn();
vi.mock('@/services/legacy-study-plan-compat', () => ({
  getLegacyShapedCanonicalPlan: (...a: any[]) => getLegacyShapedCanonicalPlanMock(...a),
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

const shaped = {
  planId: 'canon-1',
  plan: { startDate: '2026-01-01T00:00:00.000Z', endDate: '2026-01-14T00:00:00.000Z', sessions: [], totalStudyMinutes: 0, subjectsInPlan: [], criticalConceptsCount: 0, canonical: true },
};

beforeEach(() => {
  verifyAuthMock.mockReset().mockResolvedValue({ userId: 'clerk-a', role: 'student' });
  verifyStudentAccessMock.mockReset().mockResolvedValue(true);
  getInterfaceLanguageMock.mockReset().mockResolvedValue('en');
  rebuildLearningPlanMock.mockReset().mockResolvedValue({ planResult: { planId: 'canon-1' } });
  getLegacyShapedCanonicalPlanMock.mockReset().mockResolvedValue(shaped);
});

describe('8G1. /api/study-plan/generate is a canonical compatibility shim', () => {
  it('GET returns the canonical plan in the legacy shape, WITHOUT rebuilding', async () => {
    const res: any = await GET(getRequest({ studentId: STUDENT_A }));
    expect(res.status ?? 200).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.plan.canonical).toBe(true);
    expect(rebuildLearningPlanMock).not.toHaveBeenCalled();
  });

  it('POST runs the canonical rebuild then returns the legacy shape; no legacy write', async () => {
    const res: any = await POST(postRequest({ studentId: STUDENT_A, daysAhead: 7, dailyMinutes: 90 }));
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.planId).toBe('canon-1');
    expect(rebuildLearningPlanMock).toHaveBeenCalledWith(STUDENT_A, expect.objectContaining({ preferredLanguage: 'en' }));
  });
});

describe('8G1. Student isolation holds at the route boundary', () => {
  it('GET 403s on cross-student access, never reaching the service', async () => {
    verifyStudentAccessMock.mockResolvedValue(false);
    const res: any = await GET(getRequest({ studentId: STUDENT_B }));
    expect(res.status).toBe(403);
    expect(getLegacyShapedCanonicalPlanMock).not.toHaveBeenCalled();
  });

  it('POST 403s on cross-student access, never reaching the planner', async () => {
    verifyStudentAccessMock.mockResolvedValue(false);
    const res: any = await POST(postRequest({ studentId: STUDENT_B }));
    expect(res.status).toBe(403);
    expect(rebuildLearningPlanMock).not.toHaveBeenCalled();
  });

  it('verifyStudentAccess is called with the exact authenticated userId and requested studentId', async () => {
    await GET(getRequest({ studentId: STUDENT_A }));
    expect(verifyStudentAccessMock).toHaveBeenCalledWith('clerk-a', STUDENT_A, 'student');
  });
});
