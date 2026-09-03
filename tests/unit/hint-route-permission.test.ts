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

const getTeachingIntentForConceptMock = vi.fn();
vi.mock('@/services/adaptive-teaching.service', () => ({ getTeachingIntentForConcept: (...a: any[]) => getTeachingIntentForConceptMock(...a) }));

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
  getTeachingIntentForConceptMock.mockReset().mockResolvedValue(null);
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

  it('denies SOLO_VERIFY -- an evidence attempt never receives adaptive instructional hints (release test 9)', async () => {
    getQuizSessionMock.mockResolvedValue(session({ quizMode: 'cumulative_assessment', activityType: 'SOLO_VERIFY', evidenceMode: 'INDEPENDENT' }));
    const res: any = await POST(makeRequest({ studentId: '11111111-1111-4111-8111-111111111111', quizId: 'quiz-1', questionIndex: 0 }));
    expect(res.status).toBe(403);
    expect(getTeachingIntentForConceptMock).not.toHaveBeenCalled();
  });

  it('denies MOCK_EXAM (release test 10: no ASSESSMENT-mode adaptive help)', async () => {
    getQuizSessionMock.mockResolvedValue(session({ quizMode: 'exam_simulation', activityType: 'MOCK_EXAM', evidenceMode: 'ASSESSMENT' }));
    const res: any = await POST(makeRequest({ studentId: '11111111-1111-4111-8111-111111111111', quizId: 'quiz-1', questionIndex: 0 }));
    expect(res.status).toBe(403);
    expect(getTeachingIntentForConceptMock).not.toHaveBeenCalled();
  });

  it('a non-PRACTICE denial never even looks up a TeachingIntent -- the permission gate runs first, always', async () => {
    getQuizSessionMock.mockResolvedValue(session({ quizMode: 'quick_check', activityType: 'SOLO_CHECK', evidenceMode: 'INDEPENDENT' }));
    await POST(makeRequest({ studentId: '11111111-1111-4111-8111-111111111111', quizId: 'quiz-1', questionIndex: 0 }));
    expect(getTeachingIntentForConceptMock).not.toHaveBeenCalled();
  });
});

describe('Phase 5-R S2/S9 -- adaptive teaching reaches the live hint generator (release tests 1, 4, 6, 7, 12)', () => {
  it('passes a generationContext to generateQuestionHint when Phase 4 has an active decision for this concept', async () => {
    getTeachingIntentForConceptMock.mockResolvedValue({
      studentId: 's1', subjectId: 'subj1', conceptId: 'c1', activityType: 'PRACTICE', learningState: 'DEVELOPING', reasonCode: 'LOW_UNDERSTANDING',
      instructionalGoal: 'Build initial understanding.', targetKnowledgeDimension: 'UNDERSTANDING', primaryBarrier: 'LOW_UNDERSTANDING',
      misconceptionCodes: [], prerequisiteConceptIds: [], supportLevel: 'GUIDED', explanationDepth: 'STANDARD', reasoningDemand: null,
      strategy: 'EXPLAIN', avoidStrategies: [], previousStrategies: [], successCriteria: 'x', policyVersion: 1,
    });
    getQuizSessionMock.mockResolvedValue(session());
    await POST(makeRequest({ studentId: '11111111-1111-4111-8111-111111111111', quizId: 'quiz-1', questionIndex: 0 }));
    expect(getTeachingIntentForConceptMock).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', 'c1');
    const [, , generationContext] = generateQuestionHintMock.mock.calls[0];
    expect(generationContext).toMatchObject({ primaryBarrier: 'LOW_UNDERSTANDING', supportLevel: 'GUIDED', strategy: 'EXPLAIN' });
  });

  it('falls back to the pre-existing, unadapted hint generator when Phase 4 has no active decision for this concept', async () => {
    getTeachingIntentForConceptMock.mockResolvedValue(null);
    getQuizSessionMock.mockResolvedValue(session());
    await POST(makeRequest({ studentId: '11111111-1111-4111-8111-111111111111', quizId: 'quiz-1', questionIndex: 0 }));
    const [, , generationContext] = generateQuestionHintMock.mock.calls[0];
    expect(generationContext).toBeUndefined();
  });

  it('a failed TeachingIntent lookup degrades safely to the unadapted hint generator rather than failing the request', async () => {
    getTeachingIntentForConceptMock.mockRejectedValue(new Error('db down'));
    getQuizSessionMock.mockResolvedValue(session());
    const res: any = await POST(makeRequest({ studentId: '11111111-1111-4111-8111-111111111111', quizId: 'quiz-1', questionIndex: 0 }));
    expect(res.status ?? 200).not.toBe(500);
    expect(generateQuestionHintMock).toHaveBeenCalled();
  });
});

describe('Phase 5-R S10 -- deterministic stop condition (release test 19)', () => {
  it('a question that has already produced a hint returns control to the student instead of generating another one', async () => {
    getQuizSessionMock.mockResolvedValue(session({ hintsUsedQuestions: [0] }));
    const res: any = await POST(makeRequest({ studentId: '11111111-1111-4111-8111-111111111111', quizId: 'quiz-1', questionIndex: 0 }));
    const body = await res.json();
    expect(body.data.stopped).toBe(true);
    expect(body.data.reason).toBe('MAX_SUPPORT_REACHED');
    expect(generateQuestionHintMock).not.toHaveBeenCalled();
    expect(getTeachingIntentForConceptMock).not.toHaveBeenCalled();
  });

  it('a different question on the same session is unaffected by another question already having used its hint', async () => {
    getQuizSessionMock.mockResolvedValue(session({ hintsUsedQuestions: [0], questions: [{ id: 'q1' }, { id: 'q2' }] }));
    const res: any = await POST(makeRequest({ studentId: '11111111-1111-4111-8111-111111111111', quizId: 'quiz-1', questionIndex: 1 }));
    expect(res.status ?? 200).not.toBe(403);
    expect(generateQuestionHintMock).toHaveBeenCalled();
  });
});
