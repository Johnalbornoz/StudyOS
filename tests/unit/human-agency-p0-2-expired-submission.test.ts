/**
 * Human Agency P0-2 -- an INDEPENDENT / ASSESSMENT attempt past its certified
 * expiry produces NO evidence. Acceptance 5-7 (route level, real POST,
 * whole-module-mock harness reused from canon-v2-evidence-persistence-failure)
 * plus the boundary contract: the submit predicate (`now() >= expires_at`) is
 * the exact complement of the cross-surface guard's "active" predicate
 * (`expires_at > NOW()`), so the Tutor reopening and an Independent submission
 * still being accepted can never overlap. The SQL boundary itself
 * (before / at / after on a real clock) is certified on ephemeral Postgres by
 * scripts/operations/human-agency-p0-cert.ts.
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
vi.mock('@/lib/i18n/messages', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/i18n/messages')>()), isLocale: vi.fn().mockReturnValue(true) }));
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
    status: 'active', hintsUsedQuestions: [], isExpired: false,
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
  updateMasteryMock.mockReset().mockResolvedValue({ duplicate: false, oldMastery: 0, newMastery: 10, delta: 10, knowledgeState: null });
});


const INDEPENDENT = { quizMode: 'quick_check', activityType: 'SOLO_CHECK', evidenceMode: 'INDEPENDENT' };
const ASSESSMENT = { quizMode: 'cumulative_assessment', activityType: 'CUMULATIVE_ASSESSMENT', evidenceMode: 'ASSESSMENT' };

describe('P0-2 acceptance 5-7: expired Independent submission', () => {
  it('5. a valid Independent submission BEFORE expiry is accepted and produces evidence', async () => {
    getQuizSessionMock.mockResolvedValue(session({ ...INDEPENDENT, isExpired: false }));
    const res: any = await POST(makeRequest(submitBody()));
    expect(res.status).not.toBe(410);
    expect(updateMasteryMock).toHaveBeenCalled();
  });

  it('6. the same submission AT/AFTER expiry is rejected server-side with 410 SESSION_EXPIRED (never accepted-and-downgraded)', async () => {
    getQuizSessionMock.mockResolvedValue(session({ ...INDEPENDENT, isExpired: true }));
    const res: any = await POST(makeRequest(submitBody()));
    const body = await res.json();
    expect(res.status).toBe(410);
    expect(body.error).toBe('SESSION_EXPIRED');
    expect(typeof body.message).toBe('string');
  });

  it('7. an expired attempt creates no independence evidence: no mastery write, no completion', async () => {
    getQuizSessionMock.mockResolvedValue(session({ ...INDEPENDENT, isExpired: true }));
    await POST(makeRequest(submitBody()));
    expect(updateMasteryMock).not.toHaveBeenCalled();
    expect(completeQuizMock).not.toHaveBeenCalled();
  });

  it('ASSESSMENT attempts follow the same rule', async () => {
    getQuizSessionMock.mockResolvedValue(session({ ...ASSESSMENT, isExpired: true }));
    const res: any = await POST(makeRequest(submitBody()));
    expect(res.status).toBe(410);
    expect(updateMasteryMock).not.toHaveBeenCalled();
  });

  it('PRACTICE is unchanged: an expired PRACTICE session is still graded (it never claimed independence)', async () => {
    getQuizSessionMock.mockResolvedValue(session({ isExpired: true }));
    const res: any = await POST(makeRequest(submitBody()));
    expect(res.status).not.toBe(410);
    expect(updateMasteryMock).toHaveBeenCalled();
  });

  it('an already-completed session still answers alreadySubmitted (idempotent retry is not turned into an expiry error)', async () => {
    getQuizSessionMock.mockResolvedValue(session({ ...INDEPENDENT, status: 'completed', isExpired: true }));
    const res: any = await POST(makeRequest(submitBody()));
    const body = await res.json();
    expect(body.alreadySubmitted).toBe(true);
  });
});

describe('P0-2 boundary contract: no overlap between "Tutor reopened" and "submission accepted as Independent"', () => {
  const { readFileSync } = require('fs');
  const persistence = readFileSync(require('path').join(process.cwd(), 'src/services/quiz-persistence.service.ts'), 'utf-8');
  it('the guard treats a session as restricting only while expires_at > NOW() (DB clock)', () => {
    expect(persistence).toMatch(/AND status = 'active'\s*AND expires_at > NOW\(\)/);
  });
  it('the submit reader marks it expired exactly when now() >= expires_at (DB clock) -- the complement', () => {
    expect(persistence).toMatch(/\(now\(\) >= expires_at\) AS is_expired/);
  });
});

describe('P0-2/P0-3 Student UX: an expired attempt is never offered as a retry loop', () => {
  it('SESSION_EXPIRED / TASK_EXPIRED / TASK_NOT_FOUND classify as EXPIRED (back to the concept), not a retryable server error', async () => {
    const { classifySubmitFailure } = await import('@/lib/experience/learning-session');
    for (const errorCode of ['SESSION_EXPIRED', 'TASK_EXPIRED', 'TASK_NOT_FOUND', 'QUIZ_NOT_FOUND']) {
      expect(classifySubmitFailure({ status: 410, errorCode })).toBe('EXPIRED');
    }
    expect(classifySubmitFailure({ status: 500, errorCode: 'INTERNAL_ERROR' })).toBe('SERVER');
  });
});
