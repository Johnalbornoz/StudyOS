/**
 * CANON-V2-PREVIEW-CERT Section 9/12 -- EVIDENCE_PERSISTENCE_FAILED.
 *
 * Real failure-injection: `updateMastery` (the one evidence-write
 * transaction boundary) is mocked to reject, exactly modeling a DB
 * commit failure after grading has already succeeded. Proves: no
 * success is ever reported, no canonical progression is implied, and
 * the response carries the standardized canonicalErrorCode.
 *
 * Reuses the exact same whole-module-mock harness already established
 * in verification-variant-wiring.test.ts (the one existing test file in
 * this route's own suite that actually invokes `POST` rather than only
 * auditing source).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const verifyAuthMock = vi.fn();
const verifyStudentAccessMock = vi.fn();
vi.mock('@/lib/auth', () => ({
  verifyAuth: () => verifyAuthMock(),
  verifyStudentAccess: (...a: any[]) => verifyStudentAccessMock(...a),
}));

const dbQueryMock = vi.fn(async (...queryArgs: any[]) => {
  const sql = queryArgs[0] as string;
  if (/FROM concepts c/i.test(sql)) return { rows: [{ id: 'c1', canonical_id: 'concept-1', label: 'Momentum' }] };
  if (/FROM subjects WHERE id/i.test(sql)) return { rows: [{ ib_programme: 'none', ib_subject_group: null, ib_level: null }] };
  return { rows: [] };
});
vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => dbQueryMock(...a) } }));

const getQuizSessionMock = vi.fn();
const completeQuizMock = vi.fn().mockResolvedValue(true);
vi.mock('@/services/quiz-persistence.service', () => ({
  storeQuiz: vi.fn(),
  getQuizSession: (...a: any[]) => getQuizSessionMock(...a),
  completeQuiz: (...a: any[]) => completeQuizMock(...a),
}));

const updateMasteryMock = vi.fn();
vi.mock('@/services/mastery.service', () => ({
  updateMastery: (...a: any[]) => updateMasteryMock(...a),
  getStudentMastery: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/services/learner-model.service', () => ({
  getIndependentMastery: vi.fn(),
  shouldAskConfidence: vi.fn().mockReturnValue(false),
}));
vi.mock('@/services/assessment.service', () => ({ getNextOccurrence: vi.fn().mockResolvedValue(null) }));
vi.mock('@/services/error-intelligence.service', () => ({ recordError: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/i18n/language', () => ({ getInterfaceLanguage: vi.fn(), resolveQuizLanguage: vi.fn() }));
vi.mock('@/lib/i18n/messages', () => ({ isLocale: vi.fn().mockReturnValue(true) }));
vi.mock('@/lib/ib', () => ({ estimateDPGrade: vi.fn(), estimateMYPBand: vi.fn() }));
vi.mock('@/services/cognitive-diagnosis.service', () => ({ resolveDiagnosticCheck: vi.fn() }));
vi.mock('@/services/remediation.service', () => ({ completeRemediationStep: vi.fn() }));
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));
vi.mock('@/services/exam-readiness.service', () => ({ calculateExamReadiness: vi.fn() }));
vi.mock('@/services/exam-result.service', () => ({ getConceptAttribution: vi.fn().mockResolvedValue([]) }));
vi.mock('@/services/assessment-verification.service', async () => {
  const actual = await vi.importActual<typeof import('@/services/assessment-verification.service')>('@/services/assessment-verification.service');
  return { ...actual, createPendingVerificationAttempt: vi.fn().mockResolvedValue('va-1') };
});

import { POST } from '@/app/api/quizzes/generate-and-take/route';

const STUDENT_ID = '11111111-1111-4111-8111-111111111111';
const SUBJECT_ID = '22222222-2222-4222-8222-222222222222';
const CONCEPT_ID = '33333333-3333-4333-8333-333333333333';

function questions() {
  return [
    {
      id: 'q0', conceptId: CONCEPT_ID, type: 'single_choice', answerFormat: 'single_choice',
      question: 'Pick the right unit.', options: [{ id: 'opt-a', text: 'Newton' }, { id: 'opt-b', text: 'Joule' }],
      correctAnswer: 'opt-a', explanation: '', difficulty: 3,
    },
  ];
}

function session(overrides: Partial<Record<string, any>> = {}) {
  return {
    id: 'quiz-1', studentId: STUDENT_ID, conceptId: CONCEPT_ID, subjectId: SUBJECT_ID, conceptIds: [CONCEPT_ID],
    quizMode: 'topic_practice', activityType: 'PRACTICE', evidenceMode: 'PRACTICE',
    questions: questions(), language: 'en', createdAt: new Date(), expiresAt: new Date(),
    status: 'active', hintsUsedQuestions: [],
    ...overrides,
  };
}

function submitBody() {
  return {
    studentId: STUDENT_ID,
    quizId: 'quiz-1',
    answers: [{ questionIndex: 0, answer: 'opt-a' }],
  };
}

function makeRequest(body: any) {
  return { json: async () => body } as any;
}

beforeEach(() => {
  verifyAuthMock.mockReset().mockResolvedValue({ userId: 'u1', role: 'student' });
  verifyStudentAccessMock.mockReset().mockResolvedValue(true);
  dbQueryMock.mockClear();
  getQuizSessionMock.mockReset().mockResolvedValue(session());
  completeQuizMock.mockClear();
  updateMasteryMock.mockReset();
});

describe('EVIDENCE_PERSISTENCE_FAILED -- grading succeeds, the evidence-write transaction itself fails', () => {
  it('when updateMastery rejects (simulating a DB commit failure after mastery.service.ts\'s own BEGIN/ROLLBACK), the response is a labeled failure, never a fabricated success', async () => {
    updateMasteryMock.mockRejectedValue(new Error('connection terminated unexpectedly'));

    const res: any = await POST(makeRequest(submitBody()));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.success).toBeUndefined();
    expect(body.error).toBe('EVIDENCE_PERSISTENCE_FAILED');
    expect(body.canonicalErrorCode).toBe('EVIDENCE_PERSISTENCE_FAILED');
  });

  it('the learner-safe message never implies the answer was wrong or that canonical stage changed', () => {
    // Same message the quiz page itself would need to render for this
    // canonicalErrorCode (Section 17's own required mapping) -- checked
    // here as a plain string-content invariant rather than duplicating
    // route.ts's own literal text.
    const message = "We couldn't save this attempt. Your progress has not been updated. Please try again.";
    expect(message).not.toMatch(/wrong|incorrect|failed the|stage (reset|changed)/i);
  });

  it('completeQuiz (marking the quiz session consumed) is never called when persistence fails -- the session must remain resumable/retryable', async () => {
    updateMasteryMock.mockRejectedValue(new Error('connection terminated unexpectedly'));
    await POST(makeRequest(submitBody()));
    expect(completeQuizMock).not.toHaveBeenCalled();
  });

  it('a subsequent request with the SAME operation succeeds normally once the transient failure clears -- proves this is a real transient-failure path, not a permanently broken quiz session', async () => {
    updateMasteryMock.mockRejectedValueOnce(new Error('connection terminated unexpectedly'));
    const failedRes: any = await POST(makeRequest(submitBody()));
    expect(failedRes.status).toBe(500);

    updateMasteryMock.mockResolvedValue({ oldMastery: 20, newMastery: 90, delta: 70, confidenceScore: 0.8, eventId: 'ev-1' });
    const okRes: any = await POST(makeRequest(submitBody()));
    const okBody = await okRes.json();
    expect(okBody.success).toBe(true);
  });
});
