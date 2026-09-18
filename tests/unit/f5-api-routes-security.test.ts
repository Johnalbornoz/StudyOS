/**
 * F5 -- negative security tests for the minimal admin learner-state API
 * (task 38). Every route must reject unauthenticated and non-admin
 * callers before touching any state/evidence.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const authMock = vi.fn();
const currentUserMock = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({ auth: () => authMock(), currentUser: () => currentUserMock() }));

const isAdminEmailMock = vi.fn();
vi.mock('@/services/admin.service', () => ({ isAdminEmail: (...a: any[]) => isAdminEmailMock(...a) }));

const getSkillStateMock = vi.fn();
const explainSkillStateMock = vi.fn();
const projectSkillStateMock = vi.fn();
vi.mock('@/lib/learner-state/skill-state.service', () => ({
  getSkillState: (...a: any[]) => getSkillStateMock(...a),
  explainSkillState: (...a: any[]) => explainSkillStateMock(...a),
  projectSkillState: (...a: any[]) => projectSkillStateMock(...a),
}));

const getCompetencyStateMock = vi.fn();
const explainCompetencyStateMock = vi.fn();
const projectCompetencyStateMock = vi.fn();
vi.mock('@/lib/learner-state/competency-state.service', () => ({
  getCompetencyState: (...a: any[]) => getCompetencyStateMock(...a),
  explainCompetencyState: (...a: any[]) => explainCompetencyStateMock(...a),
  projectCompetencyState: (...a: any[]) => projectCompetencyStateMock(...a),
}));

const getTransferAnalyticsMock = vi.fn();
const projectTransferAnalyticsMock = vi.fn();
vi.mock('@/lib/learner-state/transfer-analytics.service', () => ({
  getTransferAnalytics: (...a: any[]) => getTransferAnalyticsMock(...a),
  projectTransferAnalytics: (...a: any[]) => projectTransferAnalyticsMock(...a),
}));

const explainKnowledgeStateMock = vi.fn();
vi.mock('@/lib/learner-state/knowledge-state-explain.service', () => ({
  explainKnowledgeState: (...a: any[]) => explainKnowledgeStateMock(...a),
}));

const getActivePolicyMock = vi.fn();
vi.mock('@/lib/learner-state/policy.service', () => ({ getActivePolicy: (...a: any[]) => getActivePolicyMock(...a) }));

import { GET as skillGET } from '@/app/api/admin/learner-state/skill/route';
import { GET as competencyGET } from '@/app/api/admin/learner-state/competency/route';
import { GET as transferGET } from '@/app/api/admin/learner-state/transfer/route';
import { GET as knowledgeGET } from '@/app/api/admin/learner-state/knowledge/route';
import { GET as policyGET } from '@/app/api/admin/learner-state/policy/route';
import { POST as replayPOST } from '@/app/api/admin/learner-state/replay/route';

function urlReq(url: string) {
  return { url } as any;
}
function jsonReq(body: any) {
  return { json: async () => body } as any;
}

const VALID_STUDENT = '11111111-1111-4111-8111-111111111111';
const VALID_TARGET = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  authMock.mockReset().mockResolvedValue({ userId: 'clerk-admin' });
  currentUserMock.mockReset().mockResolvedValue({ emailAddresses: [{ emailAddress: 'admin@studyus.test' }] });
  isAdminEmailMock.mockReset().mockReturnValue(true);
  getSkillStateMock.mockReset().mockResolvedValue(null);
  explainSkillStateMock.mockReset().mockResolvedValue({ state: 'NO_EVIDENCE', policyVersion: 1, evidence: [], insufficientBecause: null });
  projectSkillStateMock.mockReset().mockResolvedValue({ state: 'NO_EVIDENCE' });
  getCompetencyStateMock.mockReset().mockResolvedValue(null);
  explainCompetencyStateMock.mockReset().mockResolvedValue({ state: 'NO_EVIDENCE', policyVersion: 1, evidence: [], insufficientBecause: null });
  projectCompetencyStateMock.mockReset().mockResolvedValue({ state: 'NO_EVIDENCE' });
  getTransferAnalyticsMock.mockReset().mockResolvedValue(null);
  projectTransferAnalyticsMock.mockReset().mockResolvedValue({ distinctContextCount: 0 });
  explainKnowledgeStateMock.mockReset().mockResolvedValue({ currentState: null });
  getActivePolicyMock.mockReset().mockResolvedValue({ id: 'p1', dimension: 'SKILL', version: 1, rules: {}, status: 'ACTIVE' });
});

const ROUTES: Array<{ name: string; call: () => Promise<any> }> = [
  { name: 'skill GET', call: () => skillGET(urlReq(`https://studyus.test/api/admin/learner-state/skill?studentId=${VALID_STUDENT}&skillId=${VALID_TARGET}`)) },
  { name: 'competency GET', call: () => competencyGET(urlReq(`https://studyus.test/api/admin/learner-state/competency?studentId=${VALID_STUDENT}&competencyId=${VALID_TARGET}`)) },
  { name: 'transfer GET', call: () => transferGET(urlReq(`https://studyus.test/api/admin/learner-state/transfer?studentId=${VALID_STUDENT}&conceptId=${VALID_TARGET}`)) },
  { name: 'knowledge GET', call: () => knowledgeGET(urlReq(`https://studyus.test/api/admin/learner-state/knowledge?studentId=${VALID_STUDENT}&conceptId=${VALID_TARGET}`)) },
  { name: 'policy GET', call: () => policyGET(urlReq('https://studyus.test/api/admin/learner-state/policy?dimension=SKILL')) },
  { name: 'replay POST', call: () => replayPOST(jsonReq({ dimension: 'SKILL', studentId: VALID_STUDENT, targetId: VALID_TARGET })) },
];

describe('ANONYMOUS: every F5 admin learner-state route denies before touching state/evidence', () => {
  for (const route of ROUTES) {
    it(route.name, async () => {
      authMock.mockResolvedValue({ userId: null });
      const res: any = await route.call();
      expect(res.status).toBe(401);
      expect(getSkillStateMock).not.toHaveBeenCalled();
      expect(getCompetencyStateMock).not.toHaveBeenCalled();
      expect(getTransferAnalyticsMock).not.toHaveBeenCalled();
      expect(explainKnowledgeStateMock).not.toHaveBeenCalled();
      expect(getActivePolicyMock).not.toHaveBeenCalled();
      expect(projectSkillStateMock).not.toHaveBeenCalled();
    });
  }
});

describe('AUTHENTICATED, NON-ADMIN: every F5 admin learner-state route still denies', () => {
  for (const route of ROUTES) {
    it(route.name, async () => {
      isAdminEmailMock.mockReturnValue(false);
      const res: any = await route.call();
      expect(res.status).toBe(403);
      expect(getSkillStateMock).not.toHaveBeenCalled();
      expect(projectSkillStateMock).not.toHaveBeenCalled();
    });
  }
});

describe('admin caller: routes validate input before delegating to the service', () => {
  it('skill GET without skillId is 400, never reaches the service', async () => {
    const res: any = await skillGET(urlReq(`https://studyus.test/api/admin/learner-state/skill?studentId=${VALID_STUDENT}`));
    expect(res.status).toBe(400);
    expect(getSkillStateMock).not.toHaveBeenCalled();
  });

  it('policy GET with an invalid dimension is 400, never reaches the service', async () => {
    const res: any = await policyGET(urlReq('https://studyus.test/api/admin/learner-state/policy?dimension=KNOWLEDGE'));
    expect(res.status).toBe(400);
    expect(getActivePolicyMock).not.toHaveBeenCalled();
  });

  it('replay with a malformed body is 400, never reaches the service', async () => {
    const res: any = await replayPOST(jsonReq({ dimension: 'NOT_REAL', studentId: VALID_STUDENT, targetId: VALID_TARGET }));
    expect(res.status).toBe(400);
    expect(projectSkillStateMock).not.toHaveBeenCalled();
  });

  it('a valid replay request calls the correct dimension projector', async () => {
    const res: any = await replayPOST(jsonReq({ dimension: 'SKILL', studentId: VALID_STUDENT, targetId: VALID_TARGET }));
    expect(res.status ?? 200).not.toBe(400);
    expect(projectSkillStateMock).toHaveBeenCalledWith(VALID_STUDENT, VALID_TARGET);
    expect(projectCompetencyStateMock).not.toHaveBeenCalled();
    expect(projectTransferAnalyticsMock).not.toHaveBeenCalled();
  });
});
