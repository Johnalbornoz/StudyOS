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

const generateQuestionVariantMock = vi.fn();
const gradeAnswerMock = vi.fn();
vi.mock('@/services/quiz-generation.service', async () => {
  const actual = await vi.importActual<typeof import('@/services/quiz-generation.service')>('@/services/quiz-generation.service');
  return {
    ...actual, // gradeStructuredAnswer, ANSWER_FORMAT_BY_TYPE etc. run for real (pure, deterministic)
    generateQuestionVariant: (...a: any[]) => generateQuestionVariantMock(...a),
    gradeAnswer: (...a: any[]) => gradeAnswerMock(...a),
  };
});

const createPendingVerificationAttemptMock = vi.fn().mockResolvedValue('va-1');
vi.mock('@/services/assessment-verification.service', async () => {
  const actual = await vi.importActual<typeof import('@/services/assessment-verification.service')>('@/services/assessment-verification.service');
  return {
    ...actual, // evaluateAssessmentEvidence, qualifyEvidence, selectMostAmbiguousQuestion etc. run for real
    createPendingVerificationAttempt: (...a: any[]) => createPendingVerificationAttemptMock(...a),
  };
});

import { POST } from '@/app/api/quizzes/generate-and-take/route';

const STUDENT_ID = '11111111-1111-4111-8111-111111111111';
const SUBJECT_ID = '22222222-2222-4222-8222-222222222222';
const CONCEPT_ID = '33333333-3333-4333-8333-333333333333';

// q0: single_choice, graded deterministically (confidence always 1) -- the
// "confident" question. q1: text, graded via the mocked gradeAnswer with a
// deliberately low confidence -- the genuinely ambiguous one.
function questions() {
  return [
    {
      id: 'q0', conceptId: CONCEPT_ID, type: 'single_choice', answerFormat: 'single_choice',
      question: 'Pick the right unit.', options: [{ id: 'opt-a', text: 'Newton' }, { id: 'opt-b', text: 'Joule' }],
      correctAnswer: 'opt-a', explanation: '', difficulty: 3,
    },
    {
      id: 'q1', conceptId: CONCEPT_ID, type: 'short_answer', answerFormat: 'text',
      question: 'Explain why momentum is conserved.', correctAnswer: 'Because no external force acts.',
      explanation: '', difficulty: 3,
    },
  ];
}

function session(overrides: Partial<Record<string, any>> = {}) {
  return {
    id: 'quiz-1', studentId: STUDENT_ID, conceptId: null, subjectId: SUBJECT_ID, conceptIds: [CONCEPT_ID],
    quizMode: 'cumulative_assessment', activityType: 'CUMULATIVE_ASSESSMENT', evidenceMode: 'ASSESSMENT',
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
      { questionIndex: 0, answer: 'opt-a' },
      { questionIndex: 1, answer: 'Newton\'s third law applies.' },
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
  updateMasteryMock.mockReset().mockResolvedValue({ oldMastery: 20, newMastery: 90, delta: 70, confidenceScore: 0.8, eventId: 'ev-1' });
  gradeAnswerMock.mockReset().mockResolvedValue({ correct: true, score: 1, feedback: '', confidence: 0.3, errorType: null, reasoningValid: true });
  generateQuestionVariantMock.mockReset();
  createPendingVerificationAttemptMock.mockClear();
});

describe('Phase 3B production fix -- verification generation goes through the single generation+equivalence authority', () => {
  it('1 & 6: verification generation uses the selected ambiguous original question (lowest grading confidence, not the first question in the bucket)', async () => {
    generateQuestionVariantMock.mockResolvedValue(null); // fallback path -- irrelevant to this assertion
    await POST(makeRequest(submitBody()));

    expect(generateQuestionVariantMock).toHaveBeenCalledTimes(1);
    const [sourceArg] = generateQuestionVariantMock.mock.calls[0];
    expect(sourceArg.id).toBe('q1'); // the text question (confidence 0.3), never q0 (confidence 1, asked first)
  });

  it('2: an accepted generated variant persists variantEquivalenceConfidence === contract.equivalenceConfidence', async () => {
    generateQuestionVariantMock.mockResolvedValue({
      variant: { id: 'variant-1', conceptId: CONCEPT_ID, type: 'short_answer', answerFormat: 'text', question: 'A different-angle question about momentum.', correctAnswer: 'x', explanation: '', difficulty: 3 },
      contract: { sourceQuestionId: 'q1', variantQuestionId: 'variant-1', conceptId: CONCEPT_ID, difficultyBand: 'medium', equivalenceConfidence: 0.92, equivalent: true, checks: {} as any },
    });

    await POST(makeRequest(submitBody()));

    expect(createPendingVerificationAttemptMock).toHaveBeenCalledTimes(1);
    const params = createPendingVerificationAttemptMock.mock.calls[0][0];
    expect(params.variantEquivalenceConfidence).toBe(0.92); // the exact production bug: this used to be NULL even when a real variant was used
  });

  it('3: the exact accepted variant is both persisted in verification_attempts AND returned to the client', async () => {
    generateQuestionVariantMock.mockResolvedValue({
      variant: { id: 'variant-1', conceptId: CONCEPT_ID, type: 'short_answer', answerFormat: 'text', question: 'A different-angle question about momentum.', correctAnswer: 'x', explanation: '', difficulty: 3 },
      contract: { sourceQuestionId: 'q1', variantQuestionId: 'variant-1', conceptId: CONCEPT_ID, difficultyBand: 'medium', equivalenceConfidence: 0.92, equivalent: true, checks: {} as any },
    });

    const res: any = await POST(makeRequest(submitBody()));
    const body = await res.json();

    const persistedQuestion = createPendingVerificationAttemptMock.mock.calls[0][0].verificationQuestion;
    const returnedQuestion = body.data.verificationNeeded[0].question;
    expect(persistedQuestion.id).toBe('variant-1');
    expect(returnedQuestion.question).toBe(persistedQuestion.question);
  });

  it('4 & 5: a non-equivalent/failed candidate is never accepted silently -- falls back to the original question with variantEquivalenceConfidence null (no variant was generated, so there is nothing to record)', async () => {
    generateQuestionVariantMock.mockResolvedValue(null); // generateQuestionVariant's own documented contract: null on any equivalence failure

    const res: any = await POST(makeRequest(submitBody()));
    const body = await res.json();

    const persistedParams = createPendingVerificationAttemptMock.mock.calls[0][0];
    expect(persistedParams.verificationQuestion.id).toBe('q1'); // the original question, not a fabricated substitute
    expect(persistedParams.variantEquivalenceConfidence).toBeNull(); // no generated variant -> no equivalence evaluation -> null, never a fabricated 1.0
    expect(body.data.verificationNeeded[0].question.question).toBe('Explain why momentum is conserved.');
  });

  it('7: PRACTICE (topic_practice) attempts never touch the verification/variant machinery at all', async () => {
    getQuizSessionMock.mockResolvedValue(
      session({ quizMode: 'topic_practice', activityType: 'PRACTICE', evidenceMode: 'PRACTICE', conceptId: CONCEPT_ID })
    );

    const res: any = await POST(makeRequest(submitBody()));
    const body = await res.json();

    expect(generateQuestionVariantMock).not.toHaveBeenCalled();
    expect(createPendingVerificationAttemptMock).not.toHaveBeenCalled();
    expect(body.data.verificationNeeded ?? []).toHaveLength(0);
  });

  it('7: INDEPENDENT (quick_check / Solo Check) attempts never touch the verification/variant machinery either', async () => {
    getQuizSessionMock.mockResolvedValue(
      session({ quizMode: 'quick_check', activityType: 'SOLO_CHECK', evidenceMode: 'INDEPENDENT', conceptId: CONCEPT_ID })
    );

    const res: any = await POST(makeRequest(submitBody()));
    const body = await res.json();

    expect(generateQuestionVariantMock).not.toHaveBeenCalled();
    expect(createPendingVerificationAttemptMock).not.toHaveBeenCalled();
    expect(body.data.verificationNeeded ?? []).toHaveLength(0);
  });
});
