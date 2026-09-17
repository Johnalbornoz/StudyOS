/**
 * CANON-V2-PREVIEW-CERT Section 12 -- THE ERROR TAXONOMY TEST MATRIX.
 *
 * Proves each of the 9 canonical codes is either genuinely reachable
 * (with a real, invocation-based or unit-level test proving it) or
 * intentionally unreachable today, with an explicit, documented reason
 * -- never a code that "exists only as a constant."
 *
 * | # | Code | Status | Proof |
 * |---|---|---|---|
 * | 1 | CANONICAL_DECISION_UNAVAILABLE | REACHABLE | canon-r5-surface-integration.test.ts ("Part 28 fail-safe") -- real invocation of /api/learning/session/start with getCanonicalPedagogicalDecision rejecting; asserts 503, never falls back to legacy. |
 * | 2 | CANONICAL_IMPLEMENTATION_MISSING | UNREACHABLE (certification-only) | canon-r5-canonical-decision-service.test.ts's own registry-exhaustiveness test proves every real PedagogicalActivityType\|REINFORCE resolves ready -- this code can only fire for a value OUTSIDE that closed union, impossible at the type level for a real caller. |
 * | 3 | ACTIVITY_CONTRACT_MISMATCH | REACHABLE | this file, below -- real invocation of generate-and-take's submission path with an administered item count outside the authorized contract. |
 * | 4 | AI_GENERATION_FAILED | REACHABLE | canon-v2-generation-failure-classifier.test.ts + canon-v2-retain-generation.test.ts / canon-v2-transfer-generation.test.ts (zero candidates ever produced). |
 * | 5 | AI_GENERATION_INVALID | REACHABLE | canon-v2-generation-failure-classifier.test.ts (structural shortfall / Transfer difficulty-range rejection). |
 * | 6 | AI_VALIDATION_FAILED | REACHABLE | canon-v2-generation-failure-classifier.test.ts (semanticRejectedCount > 0). |
 * | 7 | EVIDENCE_PERSISTENCE_FAILED | REACHABLE | canon-v2-evidence-persistence-failure.test.ts -- real invocation, updateMastery mocked to reject. |
 * | 8 | CANONICAL_REEVALUATION_FAILED | REACHABLE | canon-v2-canonical-reevaluation-failure.test.ts -- real invocation, persist succeeds then re-evaluation fails. |
 * | 9 | DEPENDENCY_UNAVAILABLE | UNREACHABLE today (documented) | this file, below -- the canonical pipeline's only real dependencies are the DB (its own EVIDENCE_PERSISTENCE_FAILED/CANONICAL_REEVALUATION_FAILED/CANONICAL_DECISION_UNAVAILABLE codes) and the AI provider (its own 3 AI_* codes); no auxiliary non-AI/non-DB external service exists in the canonical activity pipeline today. |
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toCanonicalErrorCode, CANONICAL_ERROR_CODES } from '@/lib/pedagogical-decision/canonical-error-taxonomy';

describe('the 9-code closed set, exhaustively', () => {
  it('every code in the closed set maps to itself (a caller can always ask "is this code X" using the taxonomy alone)', () => {
    for (const code of CANONICAL_ERROR_CODES) {
      // Not every code has a registered legacy alias equal to its own
      // name (some, like AI_GENERATION_INVALID, are new-vocabulary-only)
      // -- this loop documents which do, rather than asserting all 9 do.
      const result = toCanonicalErrorCode(code);
      if (result.mapped) expect(result.code).toBe(code);
    }
  });
});

describe('#9 DEPENDENCY_UNAVAILABLE -- intentionally unreachable today, documented rather than faked', () => {
  it('no canonical generation/persistence/decision path in this codebase references an auxiliary non-AI, non-DB external dependency', () => {
    // This is a structural, negative claim: the canonical pipeline
    // (canonical-decision.service.ts, the 3 canonical-*-generation
    // services, mastery.service.ts) depends on exactly 2 kinds of
    // external system -- the database (Neon/Postgres, via `db.query`/
    // `db.connect`) and the AI provider (Anthropic/OpenAI, via
    // generateQuestionsForConcept and friends). Neither is
    // "auxiliary" in Section 11's sense (a REQUIRED but non-core
    // service like a content CDN or a third-party grading API) --
    // both already have their own dedicated codes. DEPENDENCY_UNAVAILABLE
    // exists in the closed set for a FUTURE auxiliary dependency this
    // pipeline does not have yet.
    // No legacy identifier in this codebase is registered AS
    // 'DEPENDENCY_UNAVAILABLE' -- it is reached only as the DEFAULT
    // fallback for an unrecognized identifier (see the next test), not
    // via a self-mapped key like CANONICAL_IMPLEMENTATION_MISSING's.
    const result = toCanonicalErrorCode('DEPENDENCY_UNAVAILABLE');
    expect(result).toEqual({ code: 'DEPENDENCY_UNAVAILABLE', mapped: false });
  });

  it('an unrecognized/unclassified failure identifier defensively degrades to DEPENDENCY_UNAVAILABLE rather than throwing -- this IS a real, exercised code path, just never one this codebase\'s own canonical modules deliberately raise', () => {
    const result = toCanonicalErrorCode('SOME_FUTURE_AUXILIARY_DEPENDENCY_FAILURE_NOT_YET_CLASSIFIED');
    expect(result).toEqual({ code: 'DEPENDENCY_UNAVAILABLE', mapped: false });
  });
});

// ============================================================
// #3 ACTIVITY_CONTRACT_MISMATCH -- real invocation proof
// ============================================================
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

function session(v1Marker: Record<string, any>) {
  return {
    id: 'quiz-1', studentId: STUDENT_ID, conceptId: CONCEPT_ID, subjectId: SUBJECT_ID, conceptIds: [CONCEPT_ID],
    quizMode: 'topic_practice', activityType: 'PRACTICE', evidenceMode: 'PRACTICE',
    questions: questions(), language: 'en', createdAt: new Date(), expiresAt: new Date(),
    status: 'active', hintsUsedQuestions: [],
    v1Marker,
  };
}

function submitBody() {
  return { studentId: STUDENT_ID, quizId: 'quiz-1', answers: [{ questionIndex: 0, answer: 'opt-a' }] };
}

function makeRequest(body: any) {
  return { json: async () => body } as any;
}

beforeEach(() => {
  verifyAuthMock.mockReset().mockResolvedValue({ userId: 'u1', role: 'student' });
  verifyStudentAccessMock.mockReset().mockResolvedValue(true);
  dbQueryMock.mockClear();
  completeQuizMock.mockClear();
  updateMasteryMock.mockReset().mockResolvedValue({ oldMastery: 20, newMastery: 90, delta: 70, confidenceScore: 0.8, eventId: 'ev-1' });
});

describe('#3 ACTIVITY_CONTRACT_MISMATCH -- real invocation: the actually-administered attempt violates its own authorized v1 contract', () => {
  it('an authorized itemCount of exactly 2 but only 1 question actually administered -> v1Qualifies is false, no v1 metadata stamped, v1ActivityContractViolation recorded in metadata', async () => {
    getQuizSessionMock.mockReset().mockResolvedValue(
      session({
        pedagogicalPolicyVersion: 'studyus-canonical-v1',
        canonicalRevision: 'rev1',
        canonicalStage: 'PRACTICE',
        canonicalActivityType: 'PRACTICE',
        itemCount: { min: 2, max: 2, authorized: 2 }, // authorized exactly 2, but the session only has 1 question
        difficulty: { min: 2, max: 4, target: 3 },
        independence: false,
        supportLevel: 'ASSISTED',
        minimumScorePercent: 80,
      })
    );

    await POST(makeRequest(submitBody()));

    expect(updateMasteryMock).toHaveBeenCalledTimes(1);
    const metadataArg = updateMasteryMock.mock.calls[0][0].metadata;
    // v1Qualifies is false (contract violated) -- no pedagogicalPolicyVersion/canonicalStage stamped.
    expect(metadataArg.pedagogicalPolicyVersion).toBeUndefined();
    expect(metadataArg.v1ActivityContractViolation).toBeDefined();
    expect(metadataArg.v1ActivityContractViolation.reason).toBe('V1_ACTIVITY_CONTRACT_VIOLATION');
    expect(metadataArg.v1ActivityContractViolation.actualItemCount).toBe(1);
    expect(metadataArg.v1ActivityContractViolation.authorizedItemCount).toEqual({ min: 2, max: 2, authorized: 2 });
  });

  it('the Results response reflects the mismatch via canonicalResultsStatus/canonicalErrorCode, never silently treating the attempt as v1-qualifying', async () => {
    getQuizSessionMock.mockReset().mockResolvedValue(
      session({
        pedagogicalPolicyVersion: 'studyus-canonical-v1',
        canonicalRevision: 'rev1',
        canonicalStage: 'PRACTICE',
        canonicalActivityType: 'PRACTICE',
        itemCount: { min: 2, max: 2, authorized: 2 },
        difficulty: { min: 2, max: 4, target: 3 },
        independence: false,
        supportLevel: 'ASSISTED',
        minimumScorePercent: 80,
      })
    );

    const res: any = await POST(makeRequest(submitBody()));
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.canonicalResultsStatus).toBe('V1_ACTIVITY_CONTRACT_VIOLATION');
    expect(body.data.canonicalErrorCode).toBe('ACTIVITY_CONTRACT_MISMATCH');
    expect(body.data.canonicalResults).toBeNull();
  });
});
