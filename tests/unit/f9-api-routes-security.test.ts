/**
 * F9 -- negative security tests for the readiness/simulation API
 * surface. Every route must reject unauthenticated callers; learner
 * routes must reject callers canAccessLearner denies; admin routes
 * must reject non-admins.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const authMock = vi.fn();
const currentUserMock = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({ auth: () => authMock(), currentUser: () => currentUserMock() }));

const isAdminEmailMock = vi.fn();
vi.mock('@/services/admin.service', () => ({ isAdminEmail: (...a: any[]) => isAdminEmailMock(...a) }));

const verifyAuthMock = vi.fn();
vi.mock('@/lib/auth', () => ({ verifyAuth: () => verifyAuthMock(), checkRateLimit: () => true }));
const getOrCreateCanonicalUserMock = vi.fn();
vi.mock('@/lib/identity', () => ({ getOrCreateCanonicalUser: (...a: any[]) => getOrCreateCanonicalUserMock(...a) }));
const canAccessLearnerMock = vi.fn();
vi.mock('@/lib/authorization', () => ({ canAccessLearner: (...a: any[]) => canAccessLearnerMock(...a) }));
const canUseCapabilityMock = vi.fn();
vi.mock('@/lib/entitlements', () => ({ canUseCapability: (...a: any[]) => canUseCapabilityMock(...a) }));

const dbQueryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => dbQueryMock(...a), connect: vi.fn() } }));

const computeReadinessSnapshotMock = vi.fn();
const getLatestReadinessSnapshotMock = vi.fn();
const listReadinessSnapshotsMock = vi.fn();
const getReadinessSnapshotByIdMock = vi.fn();
vi.mock('@/lib/readiness/readiness.service', () => ({
  computeReadinessSnapshot: (...a: any[]) => computeReadinessSnapshotMock(...a),
  getLatestReadinessSnapshot: (...a: any[]) => getLatestReadinessSnapshotMock(...a),
  listReadinessSnapshots: (...a: any[]) => listReadinessSnapshotsMock(...a),
  getReadinessSnapshotById: (...a: any[]) => getReadinessSnapshotByIdMock(...a),
}));

const getActiveReadinessPolicyMock = vi.fn();
const createReadinessPolicyVersionMock = vi.fn();
vi.mock('@/lib/readiness/policy.service', () => ({
  getActiveReadinessPolicy: (...a: any[]) => getActiveReadinessPolicyMock(...a),
  createReadinessPolicyVersion: (...a: any[]) => createReadinessPolicyVersionMock(...a),
}));

const createScoreConversionModelMock = vi.fn();
vi.mock('@/lib/readiness/score-projection.service', () => ({
  createScoreConversionModel: (...a: any[]) => createScoreConversionModelMock(...a),
  getScoreProjectionAvailability: vi.fn(),
}));

const getSimulationEligibilityMock = vi.fn();
vi.mock('@/lib/simulation/eligibility.service', () => ({ getSimulationEligibility: (...a: any[]) => getSimulationEligibilityMock(...a) }));

const startSimulationAttemptMock = vi.fn();
const getSimulationAttemptMock = vi.fn();
const pauseSimulationAttemptMock = vi.fn();
const resumeSimulationAttemptMock = vi.fn();
const completeSimulationAttemptMock = vi.fn();
vi.mock('@/lib/simulation/attempt.service', () => ({
  startSimulationAttempt: (...a: any[]) => startSimulationAttemptMock(...a),
  getSimulationAttempt: (...a: any[]) => getSimulationAttemptMock(...a),
  pauseSimulationAttempt: (...a: any[]) => pauseSimulationAttemptMock(...a),
  resumeSimulationAttempt: (...a: any[]) => resumeSimulationAttemptMock(...a),
  completeSimulationAttempt: (...a: any[]) => completeSimulationAttemptMock(...a),
}));

vi.mock('@/lib/simulation/plan.service', () => ({ TimingConfigurationError: class TimingConfigurationError extends Error {} }));

const recordSimulationItemResponseMock = vi.fn();
const getSimulationScoreSummaryMock = vi.fn();
vi.mock('@/lib/simulation/scoring.service', () => ({
  recordSimulationItemResponse: (...a: any[]) => recordSimulationItemResponseMock(...a),
  getSimulationScoreSummary: (...a: any[]) => getSimulationScoreSummaryMock(...a),
}));

const runPostExamDiagnosisMock = vi.fn();
vi.mock('@/lib/simulation/post-exam-diagnosis.service', () => ({ runPostExamDiagnosis: (...a: any[]) => runPostExamDiagnosisMock(...a) }));

const determineNextActionMock = vi.fn();
vi.mock('@/lib/simulation/next-action.service', () => ({ determineNextAction: (...a: any[]) => determineNextActionMock(...a) }));

import { POST as readinessComputePOST } from '@/app/api/readiness/compute/route';
import { GET as readinessGET } from '@/app/api/readiness/route';
import { GET as readinessByIdGET } from '@/app/api/readiness/[id]/route';
import { GET as eligibilityGET } from '@/app/api/simulation/eligibility/route';
import { POST as attemptsPOST } from '@/app/api/simulation/attempts/route';
import { GET as attemptGET } from '@/app/api/simulation/attempts/[id]/route';
import { POST as pausePOST } from '@/app/api/simulation/attempts/[id]/pause/route';
import { POST as resumePOST } from '@/app/api/simulation/attempts/[id]/resume/route';
import { POST as responsesPOST } from '@/app/api/simulation/attempts/[id]/responses/route';
import { POST as completePOST } from '@/app/api/simulation/attempts/[id]/complete/route';
import { GET as adminPolicyGET, POST as adminPolicyPOST } from '@/app/api/admin/readiness/policy/route';
import { GET as adminScoreModelsGET, POST as adminScoreModelsPOST } from '@/app/api/admin/readiness/score-conversion-models/route';

function urlReq(url: string) {
  return { url } as any;
}
function jsonReq(body: any) {
  return { json: async () => body } as any;
}
function withParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

const VALID_ID = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  authMock.mockReset().mockResolvedValue({ userId: 'clerk-admin' });
  currentUserMock.mockReset().mockResolvedValue({ emailAddresses: [{ emailAddress: 'admin@studyus.test' }] });
  isAdminEmailMock.mockReset().mockReturnValue(true);
  dbQueryMock.mockReset().mockResolvedValue({ rows: [] });

  verifyAuthMock.mockReset().mockResolvedValue({ userId: 'clerk-1', email: null });
  getOrCreateCanonicalUserMock.mockReset().mockResolvedValue({ id: 'actor-1' });
  canAccessLearnerMock.mockReset().mockResolvedValue(true);
  canUseCapabilityMock.mockReset().mockResolvedValue(true);

  computeReadinessSnapshotMock.mockReset().mockResolvedValue({ id: 'snap-1', studentId: VALID_ID });
  getLatestReadinessSnapshotMock.mockReset().mockResolvedValue({ id: 'snap-1' });
  listReadinessSnapshotsMock.mockReset().mockResolvedValue([]);
  getReadinessSnapshotByIdMock.mockReset().mockResolvedValue({ id: 'snap-1', studentId: VALID_ID });

  getActiveReadinessPolicyMock.mockReset().mockResolvedValue({ id: 'pol-1' });
  createReadinessPolicyVersionMock.mockReset().mockResolvedValue({ id: 'pol-2' });
  createScoreConversionModelMock.mockReset().mockResolvedValue({ id: 'scm-1' });

  getSimulationEligibilityMock.mockReset().mockResolvedValue({ simulationType: 'TOPIC_EXAM', eligible: true, reasons: [] });

  startSimulationAttemptMock.mockReset().mockResolvedValue({ examAttempt: { id: 'ea-1' }, simulationAttempt: { id: 'sa-1', studentId: VALID_ID }, planId: 'plan-1' });
  getSimulationAttemptMock.mockReset().mockResolvedValue({ id: 'sa-1', studentId: VALID_ID, status: 'ACTIVE', examAttemptId: 'ea-1', examVersionId: VALID_ID });
  pauseSimulationAttemptMock.mockReset().mockResolvedValue({ id: 'sa-1', status: 'PAUSED' });
  resumeSimulationAttemptMock.mockReset().mockResolvedValue({ id: 'sa-1', status: 'ACTIVE' });
  completeSimulationAttemptMock.mockReset().mockResolvedValue({ id: 'sa-1', status: 'COMPLETED' });

  recordSimulationItemResponseMock.mockReset().mockResolvedValue({ responseId: 'resp-1', evaluation: {}, evidenceWritten: true });
  getSimulationScoreSummaryMock.mockReset().mockResolvedValue({ rawScore: 1, maxScore: 1, byComponent: {} });
  runPostExamDiagnosisMock.mockReset().mockResolvedValue({ diagnoses: [], knowledgeGaps: [], skillGaps: [], examTechniqueGaps: [], speedFluencyGaps: [], insufficientEvidenceAreas: [] });
  determineNextActionMock.mockReset().mockResolvedValue({ action: 'CONTINUE_LEARNING', rationale: [], relatedGapDiagnosisIds: [] });
});

const LEARNER_ROUTES: Array<{ name: string; call: () => Promise<any> }> = [
  { name: 'readiness/compute POST', call: () => readinessComputePOST(jsonReq({ studentId: VALID_ID, examProfileId: VALID_ID, examVersionId: VALID_ID })) },
  { name: 'readiness GET', call: () => readinessGET(urlReq(`https://studyus.test/api/readiness?studentId=${VALID_ID}&examProfileId=${VALID_ID}`)) },
  { name: 'readiness/[id] GET', call: () => readinessByIdGET(urlReq('https://studyus.test/api/readiness/snap-1'), withParams('snap-1')) },
  { name: 'simulation/eligibility GET', call: () => eligibilityGET(urlReq(`https://studyus.test/api/simulation/eligibility?studentId=${VALID_ID}&examVersionId=${VALID_ID}&simulationType=TOPIC_EXAM`)) },
  {
    name: 'simulation/attempts POST',
    call: () =>
      attemptsPOST(
        jsonReq({ studentId: VALID_ID, examProfileId: VALID_ID, examVersionId: VALID_ID, simulationType: 'TOPIC_EXAM', timingMode: 'UNTIMED', language: 'en' })
      ),
  },
  { name: 'simulation/attempts/[id] GET', call: () => attemptGET(urlReq('https://studyus.test/api/simulation/attempts/sa-1'), withParams('sa-1')) },
  { name: 'simulation/attempts/[id]/pause POST', call: () => pausePOST(jsonReq({}), withParams('sa-1')) },
  { name: 'simulation/attempts/[id]/resume POST', call: () => resumePOST(jsonReq({}), withParams('sa-1')) },
  {
    name: 'simulation/attempts/[id]/responses POST',
    call: () => responsesPOST(jsonReq({ assessmentComponentId: VALID_ID, question: { answerFormat: 'single_choice' }, studentAnswer: 'A' }), withParams('sa-1')),
  },
  { name: 'simulation/attempts/[id]/complete POST', call: () => completePOST(jsonReq({}), withParams('sa-1')) },
];

describe('ANONYMOUS: every F9 learner-facing route denies before touching the service layer', () => {
  for (const route of LEARNER_ROUTES) {
    it(route.name, async () => {
      verifyAuthMock.mockResolvedValue(null);
      const res: any = await route.call();
      expect(res.status).toBe(401);
      expect(computeReadinessSnapshotMock).not.toHaveBeenCalled();
      expect(startSimulationAttemptMock).not.toHaveBeenCalled();
      expect(recordSimulationItemResponseMock).not.toHaveBeenCalled();
      expect(completeSimulationAttemptMock).not.toHaveBeenCalled();
    });
  }
});

describe('AUTHENTICATED but canAccessLearner denies: every F9 learner-facing route still denies', () => {
  for (const route of LEARNER_ROUTES) {
    it(route.name, async () => {
      canAccessLearnerMock.mockResolvedValue(false);
      const res: any = await route.call();
      expect(res.status).toBe(403);
      expect(computeReadinessSnapshotMock).not.toHaveBeenCalled();
      expect(startSimulationAttemptMock).not.toHaveBeenCalled();
      expect(recordSimulationItemResponseMock).not.toHaveBeenCalled();
      expect(completeSimulationAttemptMock).not.toHaveBeenCalled();
    });
  }
});

const ADMIN_ROUTES: Array<{ name: string; call: () => Promise<any> }> = [
  { name: 'admin readiness policy GET', call: () => adminPolicyGET() },
  {
    name: 'admin readiness policy POST',
    call: () =>
      adminPolicyPOST(
        jsonReq({
          gapBasedDimensions: { minimumDiagnosedTargetsForConfidentStatus: 2 },
          coverage: { minimumEvidencedFractionForEarlyPreparation: 0.2, minimumEvidencedFractionForSimulationReady: 0.6 },
          evidenceSufficiency: { minimumQualifyingEvidenceForSufficient: 15, minimumDistinctQuestionTypesForSufficient: 3, maxRecencyDaysForFresh: 30 },
          simulationPerformance: { minimumCompletedAttemptsForConfidentStatus: 1 },
        })
      ),
  },
  { name: 'admin score-conversion-models GET', call: () => adminScoreModelsGET(urlReq(`https://studyus.test/api/admin/readiness/score-conversion-models?examVersionId=${VALID_ID}`)) },
  { name: 'admin score-conversion-models POST', call: () => adminScoreModelsPOST(jsonReq({ examVersionId: VALID_ID, conversionTable: {}, minimumEvidenceCount: 10 })) },
];

describe('ANONYMOUS: every F9 admin route denies before touching the service layer', () => {
  for (const route of ADMIN_ROUTES) {
    it(route.name, async () => {
      authMock.mockResolvedValue({ userId: null });
      const res: any = await route.call();
      expect(res.status).toBe(401);
      expect(createReadinessPolicyVersionMock).not.toHaveBeenCalled();
      expect(createScoreConversionModelMock).not.toHaveBeenCalled();
    });
  }
});

describe('AUTHENTICATED, NON-ADMIN: every F9 admin route still denies', () => {
  for (const route of ADMIN_ROUTES) {
    it(route.name, async () => {
      isAdminEmailMock.mockReturnValue(false);
      const res: any = await route.call();
      expect(res.status).toBe(403);
      expect(createReadinessPolicyVersionMock).not.toHaveBeenCalled();
      expect(createScoreConversionModelMock).not.toHaveBeenCalled();
    });
  }
});

describe('case T: Student A requests Student B readiness/simulation -> DENY', () => {
  it('readiness/[id] GET checks the SNAPSHOT OWN studentId, not a caller-supplied one', async () => {
    getReadinessSnapshotByIdMock.mockResolvedValue({ id: 'snap-1', studentId: 'student-b' });
    canAccessLearnerMock.mockImplementation(async (_actor: string, learnerId: string) => learnerId !== 'student-b');
    const res: any = await readinessByIdGET(urlReq('https://studyus.test/api/readiness/snap-1'), withParams('snap-1'));
    expect(res.status).toBe(403);
    expect(canAccessLearnerMock).toHaveBeenCalledWith('actor-1', 'student-b', 'LEARNER_PROGRESS_VIEW');
  });

  it('simulation/attempts/[id] GET checks the ATTEMPT OWN studentId, not a caller-supplied one', async () => {
    getSimulationAttemptMock.mockResolvedValue({ id: 'sa-1', studentId: 'student-b', examAttemptId: 'ea-1' });
    canAccessLearnerMock.mockImplementation(async (_actor: string, learnerId: string) => learnerId !== 'student-b');
    const res: any = await attemptGET(urlReq('https://studyus.test/api/simulation/attempts/sa-1'), withParams('sa-1'));
    expect(res.status).toBe(403);
  });
});

describe('entitlement gating: starting a simulation attempt requires LEARNING_FULL_ACCESS', () => {
  it('attempts POST returns 403 ENTITLEMENT_REQUIRED, never a 500, when entitlement is denied', async () => {
    canUseCapabilityMock.mockResolvedValue(false);
    const res: any = await attemptsPOST(
      jsonReq({ studentId: VALID_ID, examProfileId: VALID_ID, examVersionId: VALID_ID, simulationType: 'TOPIC_EXAM', timingMode: 'UNTIMED', language: 'en' })
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('ENTITLEMENT_REQUIRED');
    expect(startSimulationAttemptMock).not.toHaveBeenCalled();
  });

  it('attempts POST returns 409 SIMULATION_NOT_ELIGIBLE when the eligibility check fails, never starting an attempt', async () => {
    getSimulationEligibilityMock.mockResolvedValue({ simulationType: 'FULL_MOCK', eligible: false, reasons: ['MANDATORY_DOMAIN_INCOMPLETE: Reading'] });
    const res: any = await attemptsPOST(
      jsonReq({ studentId: VALID_ID, examProfileId: VALID_ID, examVersionId: VALID_ID, simulationType: 'FULL_MOCK', timingMode: 'OFFICIAL_SIMULATION_TIMED', language: 'en' })
    );
    expect(res.status).toBe(409);
    expect(startSimulationAttemptMock).not.toHaveBeenCalled();
  });
});

describe('case M/54: finalization is idempotent-or-safely-rejected, never re-scored', () => {
  it('a second complete call on an already-completed attempt returns 409, never re-runs diagnosis/readiness', async () => {
    completeSimulationAttemptMock.mockRejectedValue(new Error('simulation attempt sa-1 could not be completed from its current status'));
    const res: any = await completePOST(jsonReq({}), withParams('sa-1'));
    expect(res.status).toBe(409);
    expect(runPostExamDiagnosisMock).not.toHaveBeenCalled();
    expect(determineNextActionMock).not.toHaveBeenCalled();
  });
});
