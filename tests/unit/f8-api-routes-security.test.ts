/**
 * F8 -- negative security tests for the diagnostics/teaching API
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
vi.mock('@/lib/auth', () => ({ verifyAuth: () => verifyAuthMock() }));
const getOrCreateCanonicalUserMock = vi.fn();
vi.mock('@/lib/identity', () => ({ getOrCreateCanonicalUser: (...a: any[]) => getOrCreateCanonicalUserMock(...a) }));
const canAccessLearnerMock = vi.fn();
vi.mock('@/lib/authorization', () => ({ canAccessLearner: (...a: any[]) => canAccessLearnerMock(...a) }));
const canUseCapabilityMock = vi.fn();
vi.mock('@/lib/entitlements', () => ({ canUseCapability: (...a: any[]) => canUseCapabilityMock(...a) }));

const dbQueryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => dbQueryMock(...a), connect: vi.fn() } }));

const runDiagnosisMock = vi.fn();
vi.mock('@/lib/diagnostics/diagnosis.service', () => ({
  runDiagnosis: (...a: any[]) => runDiagnosisMock(...a),
  getDiagnosisById: (...a: any[]) => getDiagnosisByIdMock(...a),
  listDiagnosesForStudentConcept: (...a: any[]) => listDiagnosesMock(...a),
}));
const getDiagnosisByIdMock = vi.fn();
const listDiagnosesMock = vi.fn();

const explainDiagnosisMock = vi.fn();
vi.mock('@/lib/diagnostics/explain.service', () => ({ explainDiagnosis: (...a: any[]) => explainDiagnosisMock(...a) }));

const getActiveInterventionPolicyMock = vi.fn();
const createInterventionPolicyVersionMock = vi.fn();
vi.mock('@/lib/teaching/intervention-policy.service', () => ({
  getActiveInterventionPolicy: (...a: any[]) => getActiveInterventionPolicyMock(...a),
  createInterventionPolicyVersion: (...a: any[]) => createInterventionPolicyVersionMock(...a),
}));

const selectInterventionMock = vi.fn();
vi.mock('@/lib/teaching/intervention-selection.service', () => ({ selectIntervention: (...a: any[]) => selectInterventionMock(...a) }));

const resolveFrameworkForObjectiveMock = vi.fn();
const resolveFrameworkForStudentExamProfileMock = vi.fn();
vi.mock('@/lib/teaching/framework-context.service', () => ({
  resolveFrameworkForObjective: (...a: any[]) => resolveFrameworkForObjectiveMock(...a),
  resolveFrameworkForStudentExamProfile: (...a: any[]) => resolveFrameworkForStudentExamProfileMock(...a),
}));

const startInterventionSessionMock = vi.fn();
const getInterventionSessionMock = vi.fn();
const listAttemptsForSessionMock = vi.fn();
const recordInterventionAttemptMock = vi.fn();
vi.mock('@/lib/teaching/session.service', () => ({
  startInterventionSession: (...a: any[]) => startInterventionSessionMock(...a),
  getInterventionSession: (...a: any[]) => getInterventionSessionMock(...a),
  listAttemptsForSession: (...a: any[]) => listAttemptsForSessionMock(...a),
  recordInterventionAttempt: (...a: any[]) => recordInterventionAttemptMock(...a),
  ProveNotRecordableHereError: class ProveNotRecordableHereError extends Error {},
}));

const resolveTeachingContentGenerationContextMock = vi.fn();
const generateTeachingContentMock = vi.fn();
vi.mock('@/lib/teaching/ai-teaching-contract.service', () => ({
  resolveTeachingContentGenerationContext: (...a: any[]) => resolveTeachingContentGenerationContextMock(...a),
  generateTeachingContent: (...a: any[]) => generateTeachingContentMock(...a),
}));

const getActiveDiagnosticPolicyMock = vi.fn();
const createDiagnosticPolicyVersionMock = vi.fn();
vi.mock('@/lib/diagnostics/policy.service', () => ({
  getActiveDiagnosticPolicy: (...a: any[]) => getActiveDiagnosticPolicyMock(...a),
  createDiagnosticPolicyVersion: (...a: any[]) => createDiagnosticPolicyVersionMock(...a),
}));

const resolveCommandTermInterpretationMock = vi.fn();
const createCommandTermInterpretationMock = vi.fn();
const activateCommandTermInterpretationMock = vi.fn();
vi.mock('@/lib/teaching/command-term-teaching.service', () => ({
  resolveCommandTermInterpretation: (...a: any[]) => resolveCommandTermInterpretationMock(...a),
  createCommandTermInterpretation: (...a: any[]) => createCommandTermInterpretationMock(...a),
  activateCommandTermInterpretation: (...a: any[]) => activateCommandTermInterpretationMock(...a),
}));

import { POST as diagnosticsRunPOST } from '@/app/api/diagnostics/run/route';
import { GET as diagnosticsGET } from '@/app/api/diagnostics/route';
import { GET as explainGET } from '@/app/api/diagnostics/[id]/explain/route';
import { POST as interventionsPOST } from '@/app/api/teaching/interventions/route';
import { GET as interventionGET } from '@/app/api/teaching/interventions/[id]/route';
import { POST as attemptsPOST } from '@/app/api/teaching/interventions/[id]/attempts/route';
import { GET as adminDiagPolicyGET, POST as adminDiagPolicyPOST } from '@/app/api/admin/diagnostics/policy/route';
import { GET as adminInterventionPolicyGET, POST as adminInterventionPolicyPOST } from '@/app/api/admin/teaching/intervention-policy/route';
import { GET as adminCtiGET, POST as adminCtiPOST } from '@/app/api/admin/teaching/command-term-interpretations/route';
import { POST as adminCtiActivatePOST } from '@/app/api/admin/teaching/command-term-interpretations/activate/route';

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

  runDiagnosisMock.mockReset().mockResolvedValue({ id: 'diag-1', primaryGapType: 'KNOWLEDGE_GAP' });
  getDiagnosisByIdMock.mockReset().mockResolvedValue({ id: 'diag-1', studentId: VALID_ID, conceptId: VALID_ID, scope: {}, primaryGapType: 'KNOWLEDGE_GAP' });
  listDiagnosesMock.mockReset().mockResolvedValue([]);
  explainDiagnosisMock.mockReset().mockResolvedValue({ diagnosisId: 'diag-1' });

  getActiveInterventionPolicyMock.mockReset().mockResolvedValue({ id: 'pol-1', rules: { chains: { KNOWLEDGE_GAP: ['EXPLAIN'] }, insufficientEvidenceChain: ['GUIDED_PRACTICE'], mixedTieBreakPriority: [] } });
  createInterventionPolicyVersionMock.mockReset().mockResolvedValue({ id: 'pol-2' });
  selectInterventionMock.mockReset().mockReturnValue({ primary: 'EXPLAIN', chain: ['EXPLAIN'], rationale: [], gapTypeConsidered: 'KNOWLEDGE_GAP' });

  resolveFrameworkForObjectiveMock.mockReset().mockResolvedValue(null);
  resolveFrameworkForStudentExamProfileMock.mockReset().mockResolvedValue(null);

  startInterventionSessionMock.mockReset().mockResolvedValue({ id: 'session-1', studentId: VALID_ID, interventionType: 'EXPLAIN' });
  getInterventionSessionMock.mockReset().mockResolvedValue({ id: 'session-1', studentId: VALID_ID, interventionType: 'EXPLAIN', frameworkContext: null, gapType: 'KNOWLEDGE_GAP' });
  listAttemptsForSessionMock.mockReset().mockResolvedValue([]);
  recordInterventionAttemptMock.mockReset().mockResolvedValue({ id: 'attempt-1' });

  resolveTeachingContentGenerationContextMock.mockReset().mockResolvedValue({});
  generateTeachingContentMock.mockReset().mockResolvedValue({ blocked: false, payload: {} });

  getActiveDiagnosticPolicyMock.mockReset().mockResolvedValue({ id: 'dpol-1' });
  createDiagnosticPolicyVersionMock.mockReset().mockResolvedValue({ id: 'dpol-2' });

  resolveCommandTermInterpretationMock.mockReset().mockResolvedValue(null);
  createCommandTermInterpretationMock.mockReset().mockResolvedValue({ id: 'cti-1' });
  activateCommandTermInterpretationMock.mockReset().mockResolvedValue({ id: 'cti-1', status: 'ACTIVE' });
});

const LEARNER_ROUTES: Array<{ name: string; call: () => Promise<any> }> = [
  { name: 'diagnostics/run POST', call: () => diagnosticsRunPOST(jsonReq({ studentId: VALID_ID, conceptId: VALID_ID })) },
  { name: 'diagnostics GET', call: () => diagnosticsGET(urlReq(`https://studyus.test/api/diagnostics?studentId=${VALID_ID}&conceptId=${VALID_ID}`)) },
  { name: 'diagnostics explain GET', call: () => explainGET(urlReq('https://studyus.test/api/diagnostics/diag-1/explain'), withParams('diag-1')) },
  { name: 'interventions POST', call: () => interventionsPOST(jsonReq({ studentId: VALID_ID, diagnosisId: VALID_ID })) },
  { name: 'intervention session GET', call: () => interventionGET(urlReq('https://studyus.test/api/teaching/interventions/session-1'), withParams('session-1')) },
  { name: 'intervention attempts POST', call: () => attemptsPOST(jsonReq({ conceptId: VALID_ID, subjectId: VALID_ID, difficulty: 3, result: 'correct', scorePercent: 100 }), withParams('session-1')) },
];

describe('ANONYMOUS: every F8 learner-facing route denies before touching the service layer', () => {
  for (const route of LEARNER_ROUTES) {
    it(route.name, async () => {
      verifyAuthMock.mockResolvedValue(null);
      const res: any = await route.call();
      expect(res.status).toBe(401);
      expect(runDiagnosisMock).not.toHaveBeenCalled();
      expect(startInterventionSessionMock).not.toHaveBeenCalled();
      expect(recordInterventionAttemptMock).not.toHaveBeenCalled();
    });
  }
});

describe('AUTHENTICATED but canAccessLearner denies: every F8 learner-facing route still denies', () => {
  for (const route of LEARNER_ROUTES) {
    it(route.name, async () => {
      canAccessLearnerMock.mockResolvedValue(false);
      const res: any = await route.call();
      expect(res.status).toBe(403);
      expect(runDiagnosisMock).not.toHaveBeenCalled();
      expect(startInterventionSessionMock).not.toHaveBeenCalled();
      expect(recordInterventionAttemptMock).not.toHaveBeenCalled();
    });
  }
});

const ADMIN_ROUTES: Array<{ name: string; call: () => Promise<any> }> = [
  { name: 'admin diagnostics policy GET', call: () => adminDiagPolicyGET() },
  {
    name: 'admin diagnostics policy POST',
    call: () =>
      adminDiagPolicyPOST(
        jsonReq({
          knowledge: { minimumIndependentEvidenceCount: 4, minimumDistinctForms: 2, failureRateThreshold: 0.6 },
          skill: { minimumQualifyingEvidenceCount: 3, failureRateThreshold: 0.6 },
          technique: { minimumSimpleFormEvidenceCount: 3, minimumComplexFormEvidenceCount: 3, knowledgeSoundThreshold: 0.7, failureRateThreshold: 0.6 },
          speed: { minimumValidTimingSampleCount: 5, minimumCorrectnessBaseline: 0.7, latencyRatioThreshold: 1.5, expectedResponseTimeMsByDifficultyBand: { '1': 30000 } },
          mixedGapPriority: ['KNOWLEDGE_GAP'],
          confidence: { baseConfidenceAtMinimumEvidence: 0.55, confidenceGainPerExtraEvidenceItem: 0.05 },
        })
      ),
  },
  { name: 'admin intervention-policy GET', call: () => adminInterventionPolicyGET() },
  {
    name: 'admin intervention-policy POST',
    call: () =>
      adminInterventionPolicyPOST(
        jsonReq({ chains: { KNOWLEDGE_GAP: ['EXPLAIN'], SKILL_GAP: ['WORKED_EXAMPLE'], EXAM_TECHNIQUE_GAP: ['EXPLAIN'], SPEED_FLUENCY_GAP: ['INDEPENDENT_PRACTICE'] }, insufficientEvidenceChain: ['GUIDED_PRACTICE'], mixedTieBreakPriority: ['KNOWLEDGE_GAP'] })
      ),
  },
  { name: 'admin command-term-interpretations GET', call: () => adminCtiGET(urlReq(`https://studyus.test/api/admin/teaching/command-term-interpretations?commandTermId=${VALID_ID}`)) },
  { name: 'admin command-term-interpretations POST', call: () => adminCtiPOST(jsonReq({ commandTermId: VALID_ID, expectedStructure: 'x' })) },
  { name: 'admin command-term-interpretations activate POST', call: () => adminCtiActivatePOST(jsonReq({ interpretationId: VALID_ID })) },
];

describe('ANONYMOUS: every F8 admin route denies before touching the service layer', () => {
  for (const route of ADMIN_ROUTES) {
    it(route.name, async () => {
      authMock.mockResolvedValue({ userId: null });
      const res: any = await route.call();
      expect(res.status).toBe(401);
      expect(createDiagnosticPolicyVersionMock).not.toHaveBeenCalled();
      expect(createInterventionPolicyVersionMock).not.toHaveBeenCalled();
      expect(createCommandTermInterpretationMock).not.toHaveBeenCalled();
      expect(activateCommandTermInterpretationMock).not.toHaveBeenCalled();
    });
  }
});

describe('AUTHENTICATED, NON-ADMIN: every F8 admin route still denies', () => {
  for (const route of ADMIN_ROUTES) {
    it(route.name, async () => {
      isAdminEmailMock.mockReturnValue(false);
      const res: any = await route.call();
      expect(res.status).toBe(403);
      expect(createDiagnosticPolicyVersionMock).not.toHaveBeenCalled();
      expect(createInterventionPolicyVersionMock).not.toHaveBeenCalled();
      expect(createCommandTermInterpretationMock).not.toHaveBeenCalled();
      expect(activateCommandTermInterpretationMock).not.toHaveBeenCalled();
    });
  }
});

describe('case Q: Student A requests Student B diagnostic -> DENY', () => {
  it('explain route checks the DIAGNOSIS OWN studentId, not a caller-supplied one', async () => {
    getDiagnosisByIdMock.mockResolvedValue({ id: 'diag-1', studentId: 'student-b', conceptId: VALID_ID, scope: {}, primaryGapType: 'KNOWLEDGE_GAP' });
    canAccessLearnerMock.mockImplementation(async (_actor: string, learnerId: string) => learnerId !== 'student-b');
    const res: any = await explainGET(urlReq('https://studyus.test/api/diagnostics/diag-1/explain'), withParams('diag-1'));
    expect(res.status).toBe(403);
    expect(canAccessLearnerMock).toHaveBeenCalledWith('actor-1', 'student-b', 'LEARNER_PROGRESS_VIEW');
  });
});

describe('entitlement gating: AI content generation is skipped (not 500) when LEARNING_FULL_ACCESS is denied', () => {
  it('interventions POST returns a session with generationBlocked=ENTITLEMENT_REQUIRED, never a 500', async () => {
    canUseCapabilityMock.mockResolvedValue(false);
    const res: any = await interventionsPOST(jsonReq({ studentId: VALID_ID, diagnosisId: VALID_ID }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.generationBlocked).toBe('ENTITLEMENT_REQUIRED');
    expect(generateTeachingContentMock).not.toHaveBeenCalled();
  });
});
