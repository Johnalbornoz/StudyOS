/**
 * CV2-07 REGRESSION -- SCORING / EVALUATION INCONSISTENCY.
 *
 * Manual acceptance defect: a PRACTICE attempt graded
 *   Q1 correct, Q2 correct, Q3 CASI (correct: false, errorType:
 *   'INCOMPLETE', reasoningValid: true, partial `score`)
 * displayed "3 / 3 correctas, 100%" on the aggregate Results screen,
 * while the SAME attempt's review screen correctly showed Q3 as
 * CASI/incomplete with a chip-critical (not chip-good) styling.
 *
 * ROOT CAUSE (generate-and-take/route.ts): `correctCount`/`bucket.correct`
 * were computed from `gradeResult.score >= 0.5` -- a threshold on the
 * PARTIAL-CREDIT axis -- instead of `gradeResult.correct`, the grader's
 * own authoritative pass/fail verdict (the exact field the review
 * screen's chip already uses). An `errorType: 'INCOMPLETE'` answer can
 * legitimately clear a 0.5 score threshold while `correct` stays false,
 * producing the exact "CASI but counted as correct" contradiction.
 *
 * `conceptScore` (the persisted `learning_evidence.score_percent`) had
 * the same defect one level up: it averaged a COUNT of threshold-passes
 * rather than the actual per-question `score` values, defeating that
 * field's own documented intent ("the real score... a 15/15 (100%)
 * result moves mastery further than a single correct answer would").
 *
 * FIX: `correctCount`/`bucket.correct` now count `gradeResult.correct
 * === true` exclusively. `conceptScore` (and therefore the persisted
 * evidence's `scorePercent`/`result`) is now the mean of each
 * question's own continuous `gradeResult.score`, not a threshold-count
 * ratio.
 *
 * Harness reused verbatim from canon-v2-evidence-persistence-failure.test.ts
 * (the established whole-module-mock pattern for invoking this route's
 * real POST handler).
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
  if (/FROM concepts c/i.test(sql)) return { rows: [{ id: 'c1', canonical_id: 'concept-1', label: 'Radicacion de numeros enteros' }] };
  if (/FROM subjects WHERE id/i.test(sql)) return { rows: [{ ib_programme: 'none', ib_subject_group: null, ib_level: null }] };
  return { rows: [] };
});
vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => dbQueryMock(...a) } }));

const getQuizSessionMock = vi.fn();
const completeQuizMock = vi.fn().mockResolvedValue(true);
vi.mock('@/services/quiz-persistence.service', async () => {
  const actual = await vi.importActual<typeof import('@/services/quiz-persistence.service')>('@/services/quiz-persistence.service');
  return {
    ...actual,
    storeQuiz: vi.fn(),
    getQuizSession: (...a: any[]) => getQuizSessionMock(...a),
    completeQuiz: (...a: any[]) => completeQuizMock(...a),
  };
});

const updateMasteryMock = vi.fn().mockResolvedValue({ oldMastery: 20, newMastery: 40, delta: 20, confidenceScore: 0.8, eventId: 'ev-1' });
vi.mock('@/services/mastery.service', () => ({
  updateMastery: (...a: any[]) => updateMasteryMock(...a),
  getStudentMastery: vi.fn().mockResolvedValue([]),
}));

// Q1/Q2 = clean correct; Q3 = the exact CASI/INCOMPLETE shape from the
// manual test -- correct: false, a mid-range partial score, reasoningValid
// true (that's precisely what makes the review screen show "Casi"
// instead of "Incorrecto"), errorType 'INCOMPLETE'.
const gradeAnswerMock = vi.fn(async (question: any) => {
  const byIndex: Record<number, any> = {
    0: { correct: true, score: 1, feedback: 'Correct.', confidence: 1, errorType: null, reasoningValid: true },
    1: { correct: true, score: 1, feedback: 'Correct.', confidence: 1, errorType: null, reasoningValid: true },
    2: { correct: false, score: 0.6, feedback: 'Correcto hasta donde llega, pero sin terminar.', confidence: 0.9, errorType: 'INCOMPLETE', reasoningValid: true },
  };
  return byIndex[question.__idx];
});
vi.mock('@/services/quiz-generation.service', async () => {
  const actual = await vi.importActual<typeof import('@/services/quiz-generation.service')>('@/services/quiz-generation.service');
  return { ...actual, gradeAnswer: (q: any) => gradeAnswerMock(q) };
});

vi.mock('@/services/learner-model.service', () => ({
  getIndependentMastery: vi.fn(),
  shouldAskConfidence: vi.fn().mockReturnValue(false),
}));
vi.mock('@/services/assessment.service', () => ({ getNextOccurrence: vi.fn().mockResolvedValue(null) }));
vi.mock('@/services/error-intelligence.service', () => ({ recordError: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/i18n/language', () => ({ getInterfaceLanguage: vi.fn(), resolveQuizLanguage: vi.fn().mockReturnValue('en') }));
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
  return [0, 1, 2].map((i) => ({
    id: `q${i}`,
    __idx: i,
    conceptId: CONCEPT_ID,
    type: 'open_ended', // EXPLAIN kind -- the contract guard permits REASONING scoring, so the mocked grade passes through unmodified
    answerFormat: 'text',
    question: `Question ${i}`,
    correctAnswer: 'model answer',
    explanation: '',
    difficulty: 3,
  }));
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
    answers: [
      { questionIndex: 0, answer: 'a full correct answer' },
      { questionIndex: 1, answer: 'a full correct answer' },
      { questionIndex: 2, answer: 'an incomplete answer' },
    ],
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
  updateMasteryMock.mockClear();
  gradeAnswerMock.mockClear();
});

describe('CV2-07: aggregate scoring must agree with each question\'s own correct/incorrect verdict', () => {
  it('TEST 1 -- Correct, Correct, CASI/Partial must NOT report 3/3 (100%): the aggregate now matches the grader\'s own `correct` boolean, never a score threshold', async () => {
    const res: any = await POST(makeRequest(submitBody()));
    const body = await res.json();

    expect(body.success).toBe(true);
    // The exact reported defect: this must NOT be 3/3 or 100%.
    expect(body.data.results.correctCount).toBe(2);
    expect(body.data.results.incorrectCount).toBe(1);
    expect(body.data.results.totalQuestions).toBe(3);
    expect(body.data.results.score).toBe(Math.round((2 / 3) * 100));
    expect(body.data.results.score).not.toBe(100);
  });

  it('the per-question review still correctly classifies Q3 as CASI (correct: false, reasoningValid: true) -- unchanged, proves the fix did not touch per-question classification', async () => {
    const res: any = await POST(makeRequest(submitBody()));
    const body = await res.json();

    const q3 = body.data.review.find((r: any) => r.questionIndex === 2);
    expect(q3.correct).toBe(false);
    expect(q3.reasoningValid).toBe(true);
    expect(q3.errorType).toBe('INCOMPLETE');

    const q1 = body.data.review.find((r: any) => r.questionIndex === 0);
    expect(q1.correct).toBe(true);
  });

  it('the persisted evidence scorePercent reflects the REAL mean score (partial credit included), never the old threshold-count ratio', async () => {
    await POST(makeRequest(submitBody()));

    expect(updateMasteryMock).toHaveBeenCalledTimes(1);
    const call = updateMasteryMock.mock.calls[0][0];
    // Mean of [1, 1, 0.6] * 100, rounded -- NOT the old
    // count-of-thresholds ratio (which would have produced 100, since
    // all three scores individually cleared 0.5).
    const expectedMean = Math.round(((1 + 1 + 0.6) / 3) * 100);
    expect(call.evidence.scorePercent).toBe(expectedMean);
    expect(call.evidence.scorePercent).not.toBe(100);
  });

  it('a genuinely perfect PRACTICE (3/3 fully correct) still reports 100% -- the fix only corrects the CASI/partial case, it does not deflate a real perfect score', async () => {
    gradeAnswerMock.mockImplementation(async () => ({
      correct: true, score: 1, feedback: 'Correct.', confidence: 1, errorType: null, reasoningValid: true,
    }));
    const res: any = await POST(makeRequest(submitBody()));
    const body = await res.json();

    expect(body.data.results.correctCount).toBe(3);
    expect(body.data.results.score).toBe(100);
  });
});
