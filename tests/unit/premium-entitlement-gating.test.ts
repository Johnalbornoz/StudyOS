/**
 * Onboarding/authorization rework (2026-09-21) -- proves the remaining
 * newly-gated premium routes (not already covered by their own
 * dedicated test files) deny a Student with no active license,
 * server-side, before any AI generation or paid computation runs.
 * "Bloquear todas las funciones premium por servidor, no solo
 * ocultándolas en la interfaz."
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const clerkAuthMock = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({ auth: () => clerkAuthMock() }));

const verifyAuthMock = vi.fn();
const verifyStudentAccessMock = vi.fn();
const requireStudentIdMock = vi.fn();
vi.mock('@/lib/auth', () => ({
  verifyAuth: () => verifyAuthMock(),
  verifyStudentAccess: (...a: any[]) => verifyStudentAccessMock(...a),
  requireStudentId: (...a: any[]) => requireStudentIdMock(...a),
}));

const getOrCreateCanonicalUserMock = vi.fn();
vi.mock('@/lib/identity', () => ({ getOrCreateCanonicalUser: (...a: any[]) => getOrCreateCanonicalUserMock(...a) }));

const canUseCapabilityMock = vi.fn();
vi.mock('@/lib/entitlements', () => ({ canUseCapability: (...a: any[]) => canUseCapabilityMock(...a) }));

const verifyConversationOwnershipMock = vi.fn();
const sendMessageMock = vi.fn();
const createConversationMock = vi.fn();
const getConversationsMock = vi.fn();
vi.mock('@/services/tutor.service', () => ({
  verifyConversationOwnership: (...a: any[]) => verifyConversationOwnershipMock(...a),
  sendMessage: (...a: any[]) => sendMessageMock(...a),
  createConversation: (...a: any[]) => createConversationMock(...a),
  getConversations: (...a: any[]) => getConversationsMock(...a),
}));
vi.mock('@/lib/i18n/language', () => ({ getInterfaceLanguage: vi.fn(async () => 'es') }));

const generateQuestionMock = vi.fn();
vi.mock('@/services/ai.service', () => ({ generateQuestion: (...a: any[]) => generateQuestionMock(...a) }));

const calculateExamReadinessMock = vi.fn();
const getOverallExamReadinessMock = vi.fn();
vi.mock('@/services/exam-readiness.service', () => ({
  calculateExamReadiness: (...a: any[]) => calculateExamReadinessMock(...a),
  getOverallExamReadiness: (...a: any[]) => getOverallExamReadinessMock(...a),
}));
vi.mock('@/services/assessment.service', () => ({
  getNextOccurrence: vi.fn(async () => null),
  cacheReadinessScore: vi.fn(async () => undefined),
}));

const getDiagnosisMock = vi.fn();
const startRemediationMock = vi.fn();
vi.mock('@/services/cognitive-diagnosis.service', () => ({ getDiagnosis: (...a: any[]) => getDiagnosisMock(...a) }));
vi.mock('@/services/remediation.service', () => ({
  startRemediation: (...a: any[]) => startRemediationMock(...a),
  remediationStepHref: vi.fn(() => '/x'),
}));

const dbQueryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => dbQueryMock(...a) } }));

import { POST as tutorMessagePOST } from '@/app/api/tutor/message/route';
import { POST as tutorConversationsPOST } from '@/app/api/tutor/conversations/route';
import { POST as quizzesGeneratePOST } from '@/app/api/quizzes/generate/route';
import { GET as examReadinessGET } from '@/app/api/exam-readiness/score/route';
import { POST as remediationStartPOST } from '@/app/api/cognitive/remediation/start/route';

const STUDENT_ID = '11111111-1111-4111-8111-111111111111';
const CONVERSATION_ID = '22222222-2222-4222-8222-222222222222';
const DIAGNOSIS_ID = '33333333-3333-4333-8333-333333333333';

function jsonReq(body: any) {
  return { json: async () => body } as any;
}
function urlReq(qs: string) {
  return { url: `https://studyus.test/x?${qs}` } as any;
}

beforeEach(() => {
  clerkAuthMock.mockReset().mockResolvedValue({ userId: 'clerk-1' });
  verifyAuthMock.mockReset().mockResolvedValue({ userId: 'clerk-1', email: 's@test.com', role: 'student' });
  verifyStudentAccessMock.mockReset().mockResolvedValue(true);
  requireStudentIdMock.mockReset().mockResolvedValue(STUDENT_ID);
  getOrCreateCanonicalUserMock.mockReset().mockResolvedValue({ id: 'actor-1' });
  canUseCapabilityMock.mockReset().mockResolvedValue(true);
  verifyConversationOwnershipMock.mockReset().mockResolvedValue(true);
  sendMessageMock.mockReset().mockResolvedValue('reply');
  createConversationMock.mockReset().mockResolvedValue('conv-1');
  getConversationsMock.mockReset().mockResolvedValue([]);
  generateQuestionMock.mockReset().mockResolvedValue(JSON.stringify({ q: 'x' }));
  calculateExamReadinessMock.mockReset().mockResolvedValue({
    overallScore: 80, predictedExamScore: 80, confidence: 0.9,
    breakdown: { masteryScore: 1, retentionScore: 1, debtScore: 1, errorScore: 1 },
    areasOfConcern: [], recommendations: [],
  });
  getDiagnosisMock.mockReset().mockResolvedValue({ studentId: STUDENT_ID, state: 'CONFIRMED' });
  startRemediationMock.mockReset().mockResolvedValue({ steps: [{}], rootCauseConceptId: 'c1' });
  dbQueryMock.mockReset().mockResolvedValue({ rows: [] });
});

describe('Entitlement gate -- a Student with no active license is denied server-side, never reaching the paid action', () => {
  it('POST /api/tutor/message', async () => {
    canUseCapabilityMock.mockResolvedValue(false);
    const res: any = await tutorMessagePOST(jsonReq({ studentId: STUDENT_ID, conversationId: CONVERSATION_ID, message: 'hi' }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('ENTITLEMENT_REQUIRED');
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it('POST /api/tutor/conversations (starting a new conversation)', async () => {
    canUseCapabilityMock.mockResolvedValue(false);
    const res: any = await tutorConversationsPOST(jsonReq({ studentId: STUDENT_ID }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('ENTITLEMENT_REQUIRED');
    expect(createConversationMock).not.toHaveBeenCalled();
  });

  it('POST /api/quizzes/generate', async () => {
    canUseCapabilityMock.mockResolvedValue(false);
    const res: any = await quizzesGeneratePOST(jsonReq({ concept: 'Algebra' }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('ENTITLEMENT_REQUIRED');
    expect(generateQuestionMock).not.toHaveBeenCalled();
  });

  it('a Student with no active STUDENT role is denied before entitlement is even checked, on /api/quizzes/generate', async () => {
    requireStudentIdMock.mockResolvedValue(null);
    const res: any = await quizzesGeneratePOST(jsonReq({ concept: 'Algebra' }));
    expect(res.status).toBe(403);
    expect(canUseCapabilityMock).not.toHaveBeenCalled();
    expect(generateQuestionMock).not.toHaveBeenCalled();
  });

  it('GET /api/exam-readiness/score', async () => {
    canUseCapabilityMock.mockResolvedValue(false);
    const res: any = await examReadinessGET(urlReq(`studentId=${STUDENT_ID}&daysUntilExam=10`));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('ENTITLEMENT_REQUIRED');
    expect(calculateExamReadinessMock).not.toHaveBeenCalled();
    expect(getOverallExamReadinessMock).not.toHaveBeenCalled();
  });

  it('POST /api/cognitive/remediation/start', async () => {
    canUseCapabilityMock.mockResolvedValue(false);
    const res: any = await remediationStartPOST(jsonReq({ diagnosisId: DIAGNOSIS_ID }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('ENTITLEMENT_REQUIRED');
    expect(startRemediationMock).not.toHaveBeenCalled();
  });
});

describe('Entitlement gate -- a licensed Student is unaffected (regression guard, not just the denial path)', () => {
  it('POST /api/tutor/message succeeds when entitled', async () => {
    const res: any = await tutorMessagePOST(jsonReq({ studentId: STUDENT_ID, conversationId: CONVERSATION_ID, message: 'hi' }));
    expect(res.status ?? 200).toBe(200);
    expect(sendMessageMock).toHaveBeenCalled();
  });

  it('GET /api/tutor/conversations (viewing history) is never entitlement-gated, even when unlicensed', async () => {
    canUseCapabilityMock.mockResolvedValue(false);
    const { GET: tutorConversationsGET } = await import('@/app/api/tutor/conversations/route');
    const res: any = await tutorConversationsGET(urlReq(`studentId=${STUDENT_ID}`));
    expect(res.status ?? 200).not.toBe(403);
    expect(getConversationsMock).toHaveBeenCalled();
  });
});
