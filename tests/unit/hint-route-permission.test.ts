import { describe, it, expect, vi, beforeEach } from 'vitest';

const verifyAuthMock = vi.fn();
const verifyStudentAccessMock = vi.fn();
vi.mock('@/lib/auth', () => ({
  verifyAuth: () => verifyAuthMock(),
  verifyStudentAccess: (...a: any[]) => verifyStudentAccessMock(...a),
}));

const getQuizSessionMock = vi.fn();
const recordHintUsedMock = vi.fn();
vi.mock('@/services/quiz-persistence.service', () => ({
  getQuizSession: (...a: any[]) => getQuizSessionMock(...a),
  recordHintUsed: (...a: any[]) => recordHintUsedMock(...a),
}));

const generateQuestionHintMock = vi.fn();
vi.mock('@/services/quiz-generation.service', () => ({ generateQuestionHint: (...a: any[]) => generateQuestionHintMock(...a) }));

import { POST } from '@/app/api/quizzes/hint/route';

function makeRequest(body: any) {
  return { json: async () => body } as any;
}

function session(overrides: Partial<Record<string, any>> = {}) {
  return {
    id: 'quiz-1', studentId: '11111111-1111-4111-8111-111111111111', conceptId: 'c1', subjectId: 'subj1', conceptIds: ['c1'],
    quizMode: 'topic_practice', activityType: 'PRACTICE', evidenceMode: 'PRACTICE',
    questions: [{ id: 'q1' }], language: 'en', createdAt: new Date(), expiresAt: new Date(),
    status: 'active', hintsUsedQuestions: [],
    ...overrides,
  };
}

beforeEach(() => {
  verifyAuthMock.mockReset().mockResolvedValue({ userId: 'u1', role: 'student' });
  verifyStudentAccessMock.mockReset().mockResolvedValue(true);
  getQuizSessionMock.mockReset();
  recordHintUsedMock.mockReset().mockResolvedValue(undefined);
  generateQuestionHintMock.mockReset().mockResolvedValue(['hint text']);
});

describe('Phase 3A -- server rejects unauthorized AI features regardless of client-claimed mode', () => {
  it('allows a hint request for a PRACTICE (topic_practice) attempt', async () => {
    getQuizSessionMock.mockResolvedValue(session());
    const res: any = await POST(makeRequest({ studentId: '11111111-1111-4111-8111-111111111111', quizId: 'quiz-1', questionIndex: 0 }));
    expect(res.status ?? 200).not.toBe(403);
  });

  it('denies a hint request for an INDEPENDENT (quick_check / Solo Check) attempt', async () => {
    getQuizSessionMock.mockResolvedValue(session({ quizMode: 'quick_check', activityType: 'SOLO_CHECK', evidenceMode: 'INDEPENDENT' }));
    const res: any = await POST(makeRequest({ studentId: '11111111-1111-4111-8111-111111111111', quizId: 'quiz-1', questionIndex: 0 }));
    expect(res.status).toBe(403);
    expect(generateQuestionHintMock).not.toHaveBeenCalled();
  });

  it('denies a hint request for an INDEPENDENT (retention_check) attempt', async () => {
    getQuizSessionMock.mockResolvedValue(session({ quizMode: 'retention_check', activityType: 'RETENTION_CHECK', evidenceMode: 'INDEPENDENT' }));
    const res: any = await POST(makeRequest({ studentId: '11111111-1111-4111-8111-111111111111', quizId: 'quiz-1', questionIndex: 0 }));
    expect(res.status).toBe(403);
  });

  it('denies a hint request for an ASSESSMENT (cumulative_assessment) attempt', async () => {
    getQuizSessionMock.mockResolvedValue(session({ quizMode: 'cumulative_assessment', activityType: 'CUMULATIVE_ASSESSMENT', evidenceMode: 'ASSESSMENT' }));
    const res: any = await POST(makeRequest({ studentId: '11111111-1111-4111-8111-111111111111', quizId: 'quiz-1', questionIndex: 0 }));
    expect(res.status).toBe(403);
  });

  it('allows a hint request for a PRACTICE (review) attempt', async () => {
    getQuizSessionMock.mockResolvedValue(session({ quizMode: 'review', activityType: 'REVIEW', evidenceMode: 'PRACTICE' }));
    const res: any = await POST(makeRequest({ studentId: '11111111-1111-4111-8111-111111111111', quizId: 'quiz-1', questionIndex: 0 }));
    expect(res.status ?? 200).not.toBe(403);
  });

  it('a denied request never records hint usage -- no partial side effect from a rejected AI feature', async () => {
    getQuizSessionMock.mockResolvedValue(session({ quizMode: 'quick_check', activityType: 'SOLO_CHECK', evidenceMode: 'INDEPENDENT' }));
    await POST(makeRequest({ studentId: '11111111-1111-4111-8111-111111111111', quizId: 'quiz-1', questionIndex: 0 }));
    expect(recordHintUsedMock).not.toHaveBeenCalled();
  });
});
