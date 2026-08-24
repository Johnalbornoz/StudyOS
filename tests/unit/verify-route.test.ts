import { describe, it, expect, vi, beforeEach } from 'vitest';

const verifyAuthMock = vi.fn();
const verifyStudentAccessMock = vi.fn();
vi.mock('@/lib/auth', () => ({
  verifyAuth: () => verifyAuthMock(),
  verifyStudentAccess: (...a: any[]) => verifyStudentAccessMock(...a),
}));

const getQuizSessionMock = vi.fn();
vi.mock('@/services/quiz-persistence.service', () => ({ getQuizSession: (...a: any[]) => getQuizSessionMock(...a) }));

const gradeAnswerMock = vi.fn();
const gradeStructuredAnswerMock = vi.fn();
vi.mock('@/services/quiz-generation.service', () => ({
  gradeAnswer: (...a: any[]) => gradeAnswerMock(...a),
  gradeStructuredAnswer: (...a: any[]) => gradeStructuredAnswerMock(...a),
}));

const getPendingVerificationAttemptMock = vi.fn();
const resolveVerificationAttemptMock = vi.fn();
const submitQualifiedAssessmentEvidenceMock = vi.fn();
vi.mock('@/services/assessment-verification.service', async () => {
  const actual = await vi.importActual<typeof import('@/services/assessment-verification.service')>('@/services/assessment-verification.service');
  return {
    ...actual, // interpretVerificationOutcome / recalculateConfidenceAfterVerification run for real (pure, already unit-tested)
    getPendingVerificationAttempt: (...a: any[]) => getPendingVerificationAttemptMock(...a),
    resolveVerificationAttempt: (...a: any[]) => resolveVerificationAttemptMock(...a),
    submitQualifiedAssessmentEvidence: (...a: any[]) => submitQualifiedAssessmentEvidenceMock(...a),
  };
});

import { POST } from '@/app/api/quizzes/verify/route';

const STUDENT_ID = '11111111-1111-4111-8111-111111111111';
const CONCEPT_ID = '22222222-2222-4222-8222-222222222222';

function makeRequest(body: any) {
  return { json: async () => body } as any;
}

function session(overrides: Partial<Record<string, any>> = {}) {
  return {
    id: 'quiz-1', studentId: STUDENT_ID, subjectId: 'subj1', activityType: 'CUMULATIVE_ASSESSMENT', evidenceMode: 'ASSESSMENT',
    ...overrides,
  };
}

function pending(overrides: Partial<Record<string, any>> = {}) {
  return {
    id: 'va-1', quizSessionId: 'quiz-1', studentId: STUDENT_ID, conceptId: CONCEPT_ID,
    verificationQuestion: { id: 'vq-1', conceptId: CONCEPT_ID, answerFormat: 'single_choice', correctAnswer: 'b', difficulty: 3 },
    originalScorePercent: 85, assessmentConfidenceBefore: 60,
    ...overrides,
  };
}

beforeEach(() => {
  verifyAuthMock.mockReset().mockResolvedValue({ userId: 'u1', role: 'student' });
  verifyStudentAccessMock.mockReset().mockResolvedValue(true);
  getQuizSessionMock.mockReset();
  gradeAnswerMock.mockReset();
  gradeStructuredAnswerMock.mockReset();
  getPendingVerificationAttemptMock.mockReset();
  resolveVerificationAttemptMock.mockReset().mockResolvedValue(undefined);
  submitQualifiedAssessmentEvidenceMock.mockReset().mockResolvedValue({ oldMastery: 50, newMastery: 55, delta: 5 });
});

describe('Phase 3B -- POST /api/quizzes/verify: server remains authoritative', () => {
  it('grades a verification answer, computes outcome/confidence server-side, and records it', async () => {
    getQuizSessionMock.mockResolvedValue(session());
    getPendingVerificationAttemptMock.mockResolvedValue(pending());
    gradeStructuredAnswerMock.mockReturnValue({ correct: true, score: 1, feedback: '' });

    const res: any = await POST(makeRequest({ studentId: STUDENT_ID, quizId: 'quiz-1', conceptId: CONCEPT_ID, answer: 'b' }));
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.outcome).toBe('CONFIRMED'); // original 85 (strong) + verification 100 (strong)
    expect(body.data.assessmentConfidenceAfter).toBeGreaterThan(body.data.assessmentConfidenceBefore);
    expect(resolveVerificationAttemptMock).toHaveBeenCalledTimes(1);
    expect(submitQualifiedAssessmentEvidenceMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a request for another student\'s quiz session (ownership check)', async () => {
    getQuizSessionMock.mockResolvedValue(session({ studentId: 'someone-else' }));
    const res: any = await POST(makeRequest({ studentId: STUDENT_ID, quizId: 'quiz-1', conceptId: CONCEPT_ID, answer: 'b' }));
    expect(res.status).toBe(404);
    expect(getPendingVerificationAttemptMock).not.toHaveBeenCalled();
  });

  it('rejects verification for a non-ASSESSMENT attempt -- Evidence Mode is read from the persisted session, never trusted from the request', async () => {
    getQuizSessionMock.mockResolvedValue(session({ evidenceMode: 'PRACTICE' }));
    const res: any = await POST(makeRequest({ studentId: STUDENT_ID, quizId: 'quiz-1', conceptId: CONCEPT_ID, answer: 'b' }));
    expect(res.status).toBe(403);
  });

  it('404s when there is no pending verification for this concept -- never fabricates one', async () => {
    getQuizSessionMock.mockResolvedValue(session());
    getPendingVerificationAttemptMock.mockResolvedValue(null);
    const res: any = await POST(makeRequest({ studentId: STUDENT_ID, quizId: 'quiz-1', conceptId: CONCEPT_ID, answer: 'b' }));
    expect(res.status).toBe(404);
  });

  it('a client-supplied confidence value in the request body is ignored -- the response confidence is always server-computed', async () => {
    getQuizSessionMock.mockResolvedValue(session());
    getPendingVerificationAttemptMock.mockResolvedValue(pending({ assessmentConfidenceBefore: 40 }));
    gradeStructuredAnswerMock.mockReturnValue({ correct: false, score: 0, feedback: '' });

    const res: any = await POST(
      makeRequest({ studentId: STUDENT_ID, quizId: 'quiz-1', conceptId: CONCEPT_ID, answer: 'wrong', assessmentConfidence: 100 })
    );
    const body = await res.json();
    // 100 was never accepted -- the server derives its own value from the
    // real "before" (40) and the real outcome of this grading.
    expect(body.data.assessmentConfidenceAfter).not.toBe(100);
  });

  it('rejects invalid input (missing required fields) before touching any service', async () => {
    const res: any = await POST(makeRequest({ studentId: STUDENT_ID }));
    expect(res.status).toBe(400);
    expect(getQuizSessionMock).not.toHaveBeenCalled();
  });
});
