/**
 * F7 -- negative security tests for the minimal admin assessment API and
 * the learner-facing exam-profiles route. Every admin route must reject
 * unauthenticated/non-admin callers; the learner route must reject
 * unauthenticated/unauthorized callers via F2's canAccessLearner.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const authMock = vi.fn();
const currentUserMock = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({ auth: () => authMock(), currentUser: () => currentUserMock() }));

const isAdminEmailMock = vi.fn();
vi.mock('@/services/admin.service', () => ({ isAdminEmail: (...a: any[]) => isAdminEmailMock(...a) }));

const dbQueryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => dbQueryMock(...a) } }));

const createExamDefinitionMock = vi.fn();
const createExamVersionMock = vi.fn();
const publishExamVersionMock = vi.fn();
const getExamVersionMock = vi.fn();
vi.mock('@/lib/assessment/exam-definition.service', () => ({
  createExamDefinition: (...a: any[]) => createExamDefinitionMock(...a),
  createExamVersion: (...a: any[]) => createExamVersionMock(...a),
  publishExamVersion: (...a: any[]) => publishExamVersionMock(...a),
  getExamVersion: (...a: any[]) => getExamVersionMock(...a),
}));

const canFullMockBeOfferedMock = vi.fn();
vi.mock('@/lib/assessment/full-mock-guard.service', () => ({ canFullMockBeOffered: (...a: any[]) => canFullMockBeOfferedMock(...a) }));

const createInstitutionExamPolicyMock = vi.fn();
const listPoliciesForExamVersionMock = vi.fn();
const verifyPolicyMock = vi.fn();
vi.mock('@/lib/assessment/institution-policy.service', () => ({
  createInstitutionExamPolicy: (...a: any[]) => createInstitutionExamPolicyMock(...a),
  listPoliciesForExamVersion: (...a: any[]) => listPoliciesForExamVersionMock(...a),
  verifyPolicy: (...a: any[]) => verifyPolicyMock(...a),
}));

const verifyAuthMock = vi.fn();
vi.mock('@/lib/auth', () => ({ verifyAuth: () => verifyAuthMock() }));
const getOrCreateCanonicalUserMock = vi.fn();
vi.mock('@/lib/identity', () => ({ getOrCreateCanonicalUser: (...a: any[]) => getOrCreateCanonicalUserMock(...a) }));
const canAccessLearnerMock = vi.fn();
vi.mock('@/lib/authorization', () => ({ canAccessLearner: (...a: any[]) => canAccessLearnerMock(...a) }));
const createStudentExamProfileMock = vi.fn();
vi.mock('@/lib/assessment/student-exam-profile.service', () => ({ createStudentExamProfile: (...a: any[]) => createStudentExamProfileMock(...a) }));

import { GET as examDefinitionsGET, POST as examDefinitionsPOST } from '@/app/api/admin/assessment/exam-definitions/route';
import { GET as examVersionsGET, POST as examVersionsPOST } from '@/app/api/admin/assessment/exam-versions/route';
import { POST as transitionPOST } from '@/app/api/admin/assessment/exam-versions/transition/route';
import { GET as fullMockGuardGET } from '@/app/api/admin/assessment/full-mock-guard/route';
import { GET as policiesGET, POST as policiesPOST } from '@/app/api/admin/assessment/institution-policies/route';
import { POST as verifyPOST } from '@/app/api/admin/assessment/institution-policies/verify/route';
import { GET as examProfilesGET, POST as examProfilesPOST } from '@/app/api/exam-profiles/route';

function urlReq(url: string) {
  return { url } as any;
}
function jsonReq(body: any) {
  return { json: async () => body } as any;
}

const VALID_ID = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  authMock.mockReset().mockResolvedValue({ userId: 'clerk-admin' });
  currentUserMock.mockReset().mockResolvedValue({ emailAddresses: [{ emailAddress: 'admin@studyus.test' }] });
  isAdminEmailMock.mockReset().mockReturnValue(true);
  dbQueryMock.mockReset().mockResolvedValue({ rows: [] });
  createExamDefinitionMock.mockReset().mockResolvedValue({ id: 'ed1' });
  createExamVersionMock.mockReset().mockResolvedValue({ id: 'ev1' });
  publishExamVersionMock.mockReset().mockResolvedValue({ id: 'ev1', status: 'PUBLISHED' });
  canFullMockBeOfferedMock.mockReset().mockResolvedValue({ ready: false, reasons: [], miniMockObjectiveIds: [] });
  createInstitutionExamPolicyMock.mockReset().mockResolvedValue({ id: 'pol1' });
  listPoliciesForExamVersionMock.mockReset().mockResolvedValue([]);
  verifyPolicyMock.mockReset().mockResolvedValue({ id: 'pol1', verificationStatus: 'VERIFIED' });
  verifyAuthMock.mockReset().mockResolvedValue({ userId: 'clerk-1', email: null });
  getOrCreateCanonicalUserMock.mockReset().mockResolvedValue({ id: 'actor-1' });
  canAccessLearnerMock.mockReset().mockResolvedValue(true);
  createStudentExamProfileMock.mockReset().mockResolvedValue({ id: 'profile-1' });
});

const ADMIN_ROUTES: Array<{ name: string; call: () => Promise<any> }> = [
  { name: 'exam-definitions GET', call: () => examDefinitionsGET() },
  { name: 'exam-definitions POST', call: () => examDefinitionsPOST(jsonReq({ name: 'PAA', examFamily: 'ADMISSION_EXAM' })) },
  { name: 'exam-versions GET', call: () => examVersionsGET(urlReq(`https://studyus.test/api/admin/assessment/exam-versions?examDefinitionId=${VALID_ID}`)) },
  { name: 'exam-versions POST', call: () => examVersionsPOST(jsonReq({ examDefinitionId: VALID_ID, versionLabel: '2024' })) },
  { name: 'exam-versions transition POST', call: () => transitionPOST(jsonReq({ examVersionId: VALID_ID, action: 'PUBLISH' })) },
  { name: 'full-mock-guard GET', call: () => fullMockGuardGET(urlReq(`https://studyus.test/api/admin/assessment/full-mock-guard?examVersionId=${VALID_ID}`)) },
  { name: 'institution-policies GET', call: () => policiesGET(urlReq(`https://studyus.test/api/admin/assessment/institution-policies?examVersionId=${VALID_ID}`)) },
  { name: 'institution-policies POST', call: () => policiesPOST(jsonReq({ institutionId: VALID_ID, examDefinitionId: VALID_ID })) },
  { name: 'institution-policies verify POST', call: () => verifyPOST(jsonReq({ policyId: VALID_ID, thresholdRules: { min: 300 } })) },
];

describe('ANONYMOUS: every F7 admin assessment route denies before touching the service layer', () => {
  for (const route of ADMIN_ROUTES) {
    it(route.name, async () => {
      authMock.mockResolvedValue({ userId: null });
      const res: any = await route.call();
      expect(res.status).toBe(401);
      expect(createExamDefinitionMock).not.toHaveBeenCalled();
      expect(publishExamVersionMock).not.toHaveBeenCalled();
      expect(verifyPolicyMock).not.toHaveBeenCalled();
    });
  }
});

describe('AUTHENTICATED, NON-ADMIN: every F7 admin assessment route still denies', () => {
  for (const route of ADMIN_ROUTES) {
    it(route.name, async () => {
      isAdminEmailMock.mockReturnValue(false);
      const res: any = await route.call();
      expect(res.status).toBe(403);
      expect(createExamDefinitionMock).not.toHaveBeenCalled();
      expect(verifyPolicyMock).not.toHaveBeenCalled();
    });
  }
});

describe('F7 learner-facing exam-profiles route', () => {
  it('ANONYMOUS: GET denies with 401', async () => {
    verifyAuthMock.mockResolvedValue(null);
    const res: any = await examProfilesGET(urlReq(`https://studyus.test/api/exam-profiles?studentId=${VALID_ID}`));
    expect(res.status).toBe(401);
    expect(canAccessLearnerMock).not.toHaveBeenCalled();
  });

  it('ANONYMOUS: POST denies with 401', async () => {
    verifyAuthMock.mockResolvedValue(null);
    const res: any = await examProfilesPOST(jsonReq({ studentId: VALID_ID, examDefinitionId: VALID_ID }));
    expect(res.status).toBe(401);
    expect(createStudentExamProfileMock).not.toHaveBeenCalled();
  });

  it('AUTHENTICATED but not authorized for this learner: GET denies with 403', async () => {
    canAccessLearnerMock.mockResolvedValue(false);
    const res: any = await examProfilesGET(urlReq(`https://studyus.test/api/exam-profiles?studentId=${VALID_ID}`));
    expect(res.status).toBe(403);
  });

  it('AUTHENTICATED and authorized: GET succeeds', async () => {
    const res: any = await examProfilesGET(urlReq(`https://studyus.test/api/exam-profiles?studentId=${VALID_ID}`));
    expect(res.status ?? 200).not.toBe(401);
    expect(res.status ?? 200).not.toBe(403);
    expect(canAccessLearnerMock).toHaveBeenCalledWith('actor-1', VALID_ID, 'LEARNER_PROFILE_VIEW');
  });
});

describe('admin caller: routes validate input and surface errors correctly', () => {
  it('exam-versions GET without examDefinitionId is 400', async () => {
    const res: any = await examVersionsGET(urlReq('https://studyus.test/api/admin/assessment/exam-versions'));
    expect(res.status).toBe(400);
  });

  it('a failed publish transition surfaces as 409, not 500', async () => {
    publishExamVersionMock.mockRejectedValue(new Error('only a DRAFT exam version may be published'));
    const res: any = await transitionPOST(jsonReq({ examVersionId: VALID_ID, action: 'PUBLISH' }));
    expect(res.status).toBe(409);
  });
});
