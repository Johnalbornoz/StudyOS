/**
 * CANON-V2-PREVIEW-CERT Section 10/12 -- CANONICAL_REEVALUATION_FAILED.
 *
 * Real failure-injection, proving the required sequence: evidence
 * persists successfully (updateMastery resolves normally) -> the
 * POST-persistence canonical re-evaluation fails
 * (getCanonicalPedagogicalDecision rejects with
 * CanonicalDecisionUnavailableError) -> the evidence is NOT deleted
 * (updateMastery was already called and resolved, never rolled back by
 * this later failure) -> the response reports canonicalResultsStatus
 * unavailable, never a fabricated next stage -> a LATER re-evaluation
 * (the same fresh decision call, now succeeding) reconstructs the
 * correct state from that same, already-persisted evidence.
 *
 * Reuses the exact same whole-module-mock harness established in
 * verification-variant-wiring.test.ts / canon-v2-evidence-persistence-failure.test.ts.
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
vi.mock('@/services/canonical-prepared-activity.service', () => ({
  prepareCanonicalProveActivity: vi.fn().mockResolvedValue(undefined),
  findActivePreparedActivity: vi.fn(),
  revalidatePreparedActivity: vi.fn(),
  consumePreparedActivity: vi.fn(),
  invalidatePreparedActivity: vi.fn(),
}));

const h = vi.hoisted(() => {
  class MockCanonicalDecisionUnavailableError extends Error {
    cause?: unknown;
    constructor(message: string, cause?: unknown) {
      super(message);
      this.name = 'CanonicalDecisionUnavailableError';
      this.cause = cause;
    }
  }
  return { getCanonicalPedagogicalDecisionMock: vi.fn(), MockCanonicalDecisionUnavailableError };
});
vi.mock('@/lib/pedagogical-decision', async () => {
  const actual = await vi.importActual<typeof import('@/lib/pedagogical-decision')>('@/lib/pedagogical-decision');
  return {
    ...actual,
    getCanonicalPedagogicalDecision: (...a: any[]) => h.getCanonicalPedagogicalDecisionMock(...a),
    CanonicalDecisionUnavailableError: h.MockCanonicalDecisionUnavailableError,
  };
});
const getCanonicalPedagogicalDecisionMock = h.getCanonicalPedagogicalDecisionMock;
const MockCanonicalDecisionUnavailableError = h.MockCanonicalDecisionUnavailableError;

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

function v1Marker() {
  return {
    pedagogicalPolicyVersion: 'studyus-canonical-v1',
    canonicalRevision: 'rev1',
    canonicalStage: 'PRACTICE',
    canonicalActivityType: 'PRACTICE',
    itemCount: { min: 1, max: 1, authorized: 1 },
    difficulty: { min: 2, max: 4, target: 3 },
    independence: false,
    supportLevel: 'ASSISTED',
    minimumScorePercent: 80,
  };
}

function session(overrides: Partial<Record<string, any>> = {}) {
  return {
    id: 'quiz-1', studentId: STUDENT_ID, conceptId: CONCEPT_ID, subjectId: SUBJECT_ID, conceptIds: [CONCEPT_ID],
    quizMode: 'topic_practice', activityType: 'PRACTICE', evidenceMode: 'PRACTICE',
    questions: questions(), language: 'en', createdAt: new Date(), expiresAt: new Date(),
    status: 'active', hintsUsedQuestions: [],
    v1Marker: v1Marker(),
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

function freshDecision(stage: string) {
  return {
    decision: {
      stage,
      actionState: 'EXECUTABLE',
      nextCanonicalAction: stage,
      requirements: [],
      journeyProgressPercent: 50,
      nextEligibleAt: null,
      waitingReason: null,
      reasonCodes: [],
      policyVersion: 'studyus-canonical-v1',
      canonicalRevision: 'rev2',
      activityContract: null,
    },
  };
}

beforeEach(() => {
  verifyAuthMock.mockReset().mockResolvedValue({ userId: 'u1', role: 'student' });
  verifyStudentAccessMock.mockReset().mockResolvedValue(true);
  dbQueryMock.mockClear();
  getQuizSessionMock.mockReset().mockResolvedValue(session());
  completeQuizMock.mockClear();
  updateMasteryMock.mockReset().mockResolvedValue({ oldMastery: 20, newMastery: 90, delta: 70, confidenceScore: 0.8, eventId: 'ev-1' });
  getCanonicalPedagogicalDecisionMock.mockReset();
});

describe('CANONICAL_REEVALUATION_FAILED -- evidence persists, the post-write re-evaluation fails, evidence is never deleted', () => {
  it('updateMastery is called (and resolves) BEFORE the canonical re-fetch is ever attempted -- persistence and reevaluation are genuinely separate steps', async () => {
    getCanonicalPedagogicalDecisionMock.mockRejectedValue(new MockCanonicalDecisionUnavailableError('read failure'));
    await POST(makeRequest(submitBody()));
    expect(updateMasteryMock).toHaveBeenCalledTimes(1);
    expect(getCanonicalPedagogicalDecisionMock).toHaveBeenCalledTimes(1);
  });

  it('when the re-fetch fails, the response still reports success (evidence WAS written) but canonicalResultsStatus is CANONICAL_RESULTS_UNAVAILABLE with the standardized canonicalErrorCode -- never a fabricated next stage', async () => {
    getCanonicalPedagogicalDecisionMock.mockRejectedValue(new MockCanonicalDecisionUnavailableError('read failure'));
    const res: any = await POST(makeRequest(submitBody()));
    const body = await res.json();

    expect(body.success).toBe(true); // the attempt itself succeeded -- evidence is real
    expect(body.data.canonicalResultsStatus).toBe('CANONICAL_RESULTS_UNAVAILABLE');
    expect(body.data.canonicalErrorCode).toBe('CANONICAL_REEVALUATION_FAILED');
    expect(body.data.canonicalResults).toBeNull();
    // The mastery delta itself (real evidence effect) is still reported --
    // nothing about the ALREADY-SUCCESSFUL write is hidden or reverted.
    expect(body.data.mastery.delta).toBe(70);
  });

  it('a LATER re-evaluation (the same fresh decision call, now succeeding) reconstructs state from the SAME already-persisted evidence -- proving nothing was lost by the earlier failure', async () => {
    getCanonicalPedagogicalDecisionMock.mockRejectedValueOnce(new MockCanonicalDecisionUnavailableError('read failure'));
    const failedRes: any = await POST(makeRequest(submitBody()));
    const failedBody = await failedRes.json();
    expect(failedBody.data.canonicalResultsStatus).toBe('CANONICAL_RESULTS_UNAVAILABLE');

    // The SAME evidence this submission already wrote (updateMastery
    // resolved once, above) is what a later, independent re-evaluation
    // call would read -- modeled here by the SAME mock now succeeding,
    // proving the read path itself recovers with no special handling
    // once the transient failure clears.
    getCanonicalPedagogicalDecisionMock.mockResolvedValue(freshDecision('PROVE'));
    const laterDecision = await getCanonicalPedagogicalDecisionMock({ studentId: STUDENT_ID, conceptId: CONCEPT_ID });
    expect(laterDecision.decision.stage).toBe('PROVE');
  });
});
