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

const recordDecisionEventMock = vi.fn();
vi.mock('@/lib/audit', () => ({ recordDecisionEvent: (...a: any[]) => recordDecisionEventMock(...a) }));

import { POST, GET } from '@/app/api/quizzes/verify/route';

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
  resolveVerificationAttemptMock.mockReset().mockResolvedValue(true);
  submitQualifiedAssessmentEvidenceMock.mockReset().mockResolvedValue({ oldMastery: 50, newMastery: 55, delta: 5 });
  recordDecisionEventMock.mockReset().mockResolvedValue(undefined);
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

// --- Phase 3C.4: same-question verification fallback must not produce false independent validation ---
describe('Phase 3C.4 -- verification confidence must not reward a same-question re-ask as fresh independent confirmation', () => {
  it('a CONFIRMED outcome on a same-question fallback (variantEquivalenceConfidence null) leaves Assessment Confidence unchanged', async () => {
    getQuizSessionMock.mockResolvedValue(session());
    // null variantEquivalenceConfidence is exactly the persisted signal
    // that generateQuestionVariant failed and the verification question
    // fell back to the identical original question.
    getPendingVerificationAttemptMock.mockResolvedValue(pending({ assessmentConfidenceBefore: 60, variantEquivalenceConfidence: null }));
    gradeStructuredAnswerMock.mockReturnValue({ correct: true, score: 1, feedback: '' });

    const res: any = await POST(makeRequest({ studentId: STUDENT_ID, quizId: 'quiz-1', conceptId: CONCEPT_ID, answer: 'b' }));
    const body = await res.json();

    expect(body.data.outcome).toBe('CONFIRMED');
    // No fresh-confirmation boost -- a same-question re-ask proves nothing
    // new, so confidence must not move at all (mirrors the INCONCLUSIVE case).
    expect(body.data.assessmentConfidenceAfter).toBe(body.data.assessmentConfidenceBefore);
  });

  it('a CONFIRMED outcome on a genuinely fresh, equivalence-checked variant still receives the confidence boost', async () => {
    getQuizSessionMock.mockResolvedValue(session());
    getPendingVerificationAttemptMock.mockResolvedValue(pending({ assessmentConfidenceBefore: 60, variantEquivalenceConfidence: 0.92 }));
    gradeStructuredAnswerMock.mockReturnValue({ correct: true, score: 1, feedback: '' });

    const res: any = await POST(makeRequest({ studentId: STUDENT_ID, quizId: 'quiz-1', conceptId: CONCEPT_ID, answer: 'b' }));
    const body = await res.json();

    expect(body.data.outcome).toBe('CONFIRMED');
    expect(body.data.assessmentConfidenceAfter).toBeGreaterThan(body.data.assessmentConfidenceBefore);
  });

  it('a CONTRADICTED outcome on a same-question fallback still applies the full penalty -- freshness never weakens a contradiction', async () => {
    getQuizSessionMock.mockResolvedValue(session());
    getPendingVerificationAttemptMock.mockResolvedValue(pending({ assessmentConfidenceBefore: 75, variantEquivalenceConfidence: null }));
    gradeStructuredAnswerMock.mockReturnValue({ correct: false, score: 0, feedback: '' });

    const res: any = await POST(makeRequest({ studentId: STUDENT_ID, quizId: 'quiz-1', conceptId: CONCEPT_ID, answer: 'wrong' }));
    const body = await res.json();

    expect(body.data.outcome).toBe('CONTRADICTED');
    expect(body.data.assessmentConfidenceAfter).toBeLessThan(body.data.assessmentConfidenceBefore);
  });

  it('a fresh variant CONFIRMED passes the pending attempt\'s own variantEquivalenceConfidence and cognitiveLevel through to the resulting SOLO_VERIFICATION evidence, for auditability', async () => {
    getQuizSessionMock.mockResolvedValue(session());
    getPendingVerificationAttemptMock.mockResolvedValue(pending({ variantEquivalenceConfidence: 0.87 }));
    gradeStructuredAnswerMock.mockReturnValue({ correct: true, score: 1, feedback: '' });

    await POST(makeRequest({ studentId: STUDENT_ID, quizId: 'quiz-1', conceptId: CONCEPT_ID, answer: 'b' }));

    expect(submitQualifiedAssessmentEvidenceMock).toHaveBeenCalledTimes(1);
    const evidenceInput = submitQualifiedAssessmentEvidenceMock.mock.calls[0][0];
    expect(evidenceInput.variantEquivalenceConfidence).toBe(0.87);
  });
});

// --- Phase 3-R Finding 1: same-question fallback must not produce QUALIFIED cognitive verification evidence ---
describe('Phase 3-R Finding 1 -- a same-question fallback verification never produces SOLO_VERIFICATION cognitive evidence, regardless of outcome', () => {
  it('same-question CONFIRMED: the attempt still resolves, but submitQualifiedAssessmentEvidence is never called and mastery is null', async () => {
    getQuizSessionMock.mockResolvedValue(session());
    getPendingVerificationAttemptMock.mockResolvedValue(pending({ variantEquivalenceConfidence: null }));
    gradeStructuredAnswerMock.mockReturnValue({ correct: true, score: 1, feedback: '' });

    const res: any = await POST(makeRequest({ studentId: STUDENT_ID, quizId: 'quiz-1', conceptId: CONCEPT_ID, answer: 'b' }));
    const body = await res.json();

    expect(body.data.outcome).toBe('CONFIRMED');
    expect(body.data.wasFreshQuestion).toBe(false);
    expect(body.data.qualifiesAsCognitiveEvidence).toBe(false);
    expect(body.data.mastery).toBeNull();
    // The attempt itself still resolves (Assessment outcome/confidence
    // are real, persisted facts) -- only the COGNITIVE EVIDENCE write
    // is skipped.
    expect(resolveVerificationAttemptMock).toHaveBeenCalledTimes(1);
    expect(submitQualifiedAssessmentEvidenceMock).not.toHaveBeenCalled();
  });

  it('same-question CONTRADICTED: still no cognitive evidence, even though Assessment Confidence legitimately drops', async () => {
    getQuizSessionMock.mockResolvedValue(session());
    getPendingVerificationAttemptMock.mockResolvedValue(pending({ assessmentConfidenceBefore: 75, variantEquivalenceConfidence: null }));
    gradeStructuredAnswerMock.mockReturnValue({ correct: false, score: 0, feedback: '' });

    const res: any = await POST(makeRequest({ studentId: STUDENT_ID, quizId: 'quiz-1', conceptId: CONCEPT_ID, answer: 'wrong' }));
    const body = await res.json();

    expect(body.data.outcome).toBe('CONTRADICTED');
    // ASSESSMENT RELIABILITY SIGNAL: confidence still legitimately drops.
    expect(body.data.assessmentConfidenceAfter).toBeLessThan(body.data.assessmentConfidenceBefore);
    // COGNITIVE PERFORMANCE EVIDENCE: none produced regardless.
    expect(body.data.mastery).toBeNull();
    expect(submitQualifiedAssessmentEvidenceMock).not.toHaveBeenCalled();
  });

  it('same-question INCONCLUSIVE: no cognitive evidence', async () => {
    getQuizSessionMock.mockResolvedValue(session());
    getPendingVerificationAttemptMock.mockResolvedValue(pending({ originalScorePercent: 85, variantEquivalenceConfidence: null }));
    // 60% is neither "strong" (>=70) nor "weak" (<50) -- interpretVerificationOutcome falls through to INCONCLUSIVE.
    gradeStructuredAnswerMock.mockReturnValue({ correct: false, score: 0.6, feedback: '' });

    const res: any = await POST(makeRequest({ studentId: STUDENT_ID, quizId: 'quiz-1', conceptId: CONCEPT_ID, answer: 'b' }));
    const body = await res.json();

    expect(body.data.outcome).toBe('INCONCLUSIVE');
    expect(body.data.mastery).toBeNull();
    expect(submitQualifiedAssessmentEvidenceMock).not.toHaveBeenCalled();
  });

  it('fresh equivalent CONFIRMED: current high-trust verification evidence behavior preserved -- submitQualifiedAssessmentEvidence IS called and mastery reflects it', async () => {
    getQuizSessionMock.mockResolvedValue(session());
    getPendingVerificationAttemptMock.mockResolvedValue(pending({ variantEquivalenceConfidence: 0.95 }));
    gradeStructuredAnswerMock.mockReturnValue({ correct: true, score: 1, feedback: '' });

    const res: any = await POST(makeRequest({ studentId: STUDENT_ID, quizId: 'quiz-1', conceptId: CONCEPT_ID, answer: 'b' }));
    const body = await res.json();

    expect(body.data.outcome).toBe('CONFIRMED');
    expect(body.data.wasFreshQuestion).toBe(true);
    expect(body.data.qualifiesAsCognitiveEvidence).toBe(true);
    expect(body.data.mastery).toEqual({ previous: 50, current: 55, delta: 5 });
    expect(submitQualifiedAssessmentEvidenceMock).toHaveBeenCalledTimes(1);
  });

  it('the VERIFICATION_RESOLVED decision event still records outcome/wasFreshQuestion/qualifiesAsCognitiveEvidence for a same-question attempt, preserving auditability', async () => {
    getQuizSessionMock.mockResolvedValue(session());
    getPendingVerificationAttemptMock.mockResolvedValue(pending({ variantEquivalenceConfidence: null }));
    gradeStructuredAnswerMock.mockReturnValue({ correct: true, score: 1, feedback: '' });

    await POST(makeRequest({ studentId: STUDENT_ID, quizId: 'quiz-1', conceptId: CONCEPT_ID, answer: 'b' }));

    expect(recordDecisionEventMock).toHaveBeenCalledTimes(1);
    const call = recordDecisionEventMock.mock.calls[0][0];
    expect(call.reasonDetails).toEqual({ wasFreshQuestion: false, qualifiesAsCognitiveEvidence: false });
  });
});

// --- Phase 3-R release-blocking test list items 5-7, 17: direct, individually-named traceability ---
describe('Phase 3-R -- required release-blocking checks (direct traceability to the remediation spec\'s numbered list)', () => {
  it('#5 same-question fallback cannot increase Mastery -- updateMastery is never reached (submitQualifiedAssessmentEvidence, its only caller, is never invoked)', async () => {
    getQuizSessionMock.mockResolvedValue(session());
    getPendingVerificationAttemptMock.mockResolvedValue(pending({ variantEquivalenceConfidence: null }));
    gradeStructuredAnswerMock.mockReturnValue({ correct: true, score: 1, feedback: '' });

    await POST(makeRequest({ studentId: STUDENT_ID, quizId: 'quiz-1', conceptId: CONCEPT_ID, answer: 'b' }));

    // submitQualifiedAssessmentEvidence is this route's ONLY path to
    // updateMastery (the sole Mastery-mutating function) -- proving it
    // was never called is a direct, structural proof Mastery could not
    // have moved, not an inference from a side effect.
    expect(submitQualifiedAssessmentEvidenceMock).not.toHaveBeenCalled();
  });

  it('#6 same-question fallback cannot contribute Independence evidence -- no SOLO learning_evidence row is written for this attempt at all', async () => {
    getQuizSessionMock.mockResolvedValue(session());
    getPendingVerificationAttemptMock.mockResolvedValue(pending({ variantEquivalenceConfidence: null }));
    gradeStructuredAnswerMock.mockReturnValue({ correct: true, score: 1, feedback: '' });

    await POST(makeRequest({ studentId: STUDENT_ID, quizId: 'quiz-1', conceptId: CONCEPT_ID, answer: 'b' }));

    // Independence evidence is itself derived from learning_evidence rows
    // with learning_mode='SOLO' (stamped only inside
    // submitQualifiedAssessmentEvidence) -- with that call never made,
    // no such row exists for this attempt to contribute to Independence.
    expect(submitQualifiedAssessmentEvidenceMock).not.toHaveBeenCalled();
  });

  it('#7 same-question fallback cannot resolve an ACTIVE misconception -- updateMastery\'s misconception-resolution check never runs for this attempt', async () => {
    getQuizSessionMock.mockResolvedValue(session());
    getPendingVerificationAttemptMock.mockResolvedValue(pending({ variantEquivalenceConfidence: null }));
    gradeStructuredAnswerMock.mockReturnValue({ correct: true, score: 1, feedback: '' });

    await POST(makeRequest({ studentId: STUDENT_ID, quizId: 'quiz-1', conceptId: CONCEPT_ID, answer: 'b' }));

    // isMisconceptionResolutionEvidence's SOLO_VERIFICATION branch (mastery.service.ts,
    // via updateMastery) only ever runs on evidence that was actually
    // submitted -- submitQualifiedAssessmentEvidence is the only call
    // that could produce such a row for this attempt, and it never ran.
    expect(submitQualifiedAssessmentEvidenceMock).not.toHaveBeenCalled();
  });

  it('#17 verification replay stays exactly-once: a second request for an already-resolved attempt gets NO_PENDING_VERIFICATION, never a second evidence application', async () => {
    getQuizSessionMock.mockResolvedValue(session());
    // First request resolves the pending attempt.
    getPendingVerificationAttemptMock.mockResolvedValueOnce(pending({ variantEquivalenceConfidence: 0.9 }));
    gradeStructuredAnswerMock.mockReturnValue({ correct: true, score: 1, feedback: '' });
    const first: any = await POST(makeRequest({ studentId: STUDENT_ID, quizId: 'quiz-1', conceptId: CONCEPT_ID, answer: 'b' }));
    const firstBody = await first.json();
    expect(firstBody.success).toBe(true);
    expect(submitQualifiedAssessmentEvidenceMock).toHaveBeenCalledTimes(1);

    // A replay (network retry, double-click) -- the real
    // getPendingVerificationAttempt would now find no row with
    // outcome IS NULL for this attempt (it was just resolved), so the
    // mock reflects that by resolving to null on the second call.
    getPendingVerificationAttemptMock.mockResolvedValueOnce(null);
    const second: any = await POST(makeRequest({ studentId: STUDENT_ID, quizId: 'quiz-1', conceptId: CONCEPT_ID, answer: 'b' }));
    expect(second.status).toBe(404);
    // Still exactly one evidence-producing call total, across both requests.
    expect(submitQualifiedAssessmentEvidenceMock).toHaveBeenCalledTimes(1);
  });
});

// --- Phase 4-R: GET /api/quizzes/verify -- the resume-continuation read path ---
function makeGetRequest(params: Record<string, string>) {
  const qs = new URLSearchParams(params).toString();
  return { url: `https://studyus.pro/api/quizzes/verify?${qs}` } as any;
}

describe('Phase 4-R -- GET /api/quizzes/verify: the smallest continuation path for a SOLO_VERIFY launch', () => {
  it('a genuinely pending attempt returns its question and id, via the exact same certified lookup POST already uses', async () => {
    getQuizSessionMock.mockResolvedValue(session());
    getPendingVerificationAttemptMock.mockResolvedValue(pending({ id: 'va-1', conceptId: CONCEPT_ID, verificationQuestion: { id: 'vq-1', answerFormat: 'text' } }));

    const res: any = await GET(makeGetRequest({ studentId: STUDENT_ID, quizId: 'quiz-1', conceptId: CONCEPT_ID }));
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.pending).toEqual({ verificationAttemptId: 'va-1', conceptId: CONCEPT_ID, question: { id: 'vq-1', answerFormat: 'text' } });
  });

  it('an already-resolved (or never-existed) attempt returns { pending: null }, never an error -- Finding 9 safe-state handling', async () => {
    getQuizSessionMock.mockResolvedValue(session());
    getPendingVerificationAttemptMock.mockResolvedValue(null);

    const res: any = await GET(makeGetRequest({ studentId: STUDENT_ID, quizId: 'quiz-1', conceptId: CONCEPT_ID }));
    const body = await res.json();

    expect(res.status ?? 200).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.pending).toBeNull();
  });

  it('rejects a request for another student\'s quiz session -- foreign attempt access blocked', async () => {
    getQuizSessionMock.mockResolvedValue(session({ studentId: 'someone-else' }));
    const res: any = await GET(makeGetRequest({ studentId: STUDENT_ID, quizId: 'quiz-1', conceptId: CONCEPT_ID }));
    expect(res.status).toBe(404);
    expect(getPendingVerificationAttemptMock).not.toHaveBeenCalled();
  });

  it('requires studentId/quizId/conceptId -- rejects an incomplete request before touching any service', async () => {
    const res: any = await GET(makeGetRequest({ studentId: STUDENT_ID }));
    expect(res.status).toBe(400);
    expect(getQuizSessionMock).not.toHaveBeenCalled();
  });

  it('unauthenticated requests are rejected before any lookup', async () => {
    verifyAuthMock.mockResolvedValueOnce(null);
    const res: any = await GET(makeGetRequest({ studentId: STUDENT_ID, quizId: 'quiz-1', conceptId: CONCEPT_ID }));
    expect(res.status).toBe(401);
    expect(getQuizSessionMock).not.toHaveBeenCalled();
  });

  it('never writes anything -- no submitQualifiedAssessmentEvidence, no resolveVerificationAttempt call from a GET', async () => {
    getQuizSessionMock.mockResolvedValue(session());
    getPendingVerificationAttemptMock.mockResolvedValue(pending({ id: 'va-1', conceptId: CONCEPT_ID }));
    await GET(makeGetRequest({ studentId: STUDENT_ID, quizId: 'quiz-1', conceptId: CONCEPT_ID }));
    expect(submitQualifiedAssessmentEvidenceMock).not.toHaveBeenCalled();
    expect(resolveVerificationAttemptMock).not.toHaveBeenCalled();
  });
});
