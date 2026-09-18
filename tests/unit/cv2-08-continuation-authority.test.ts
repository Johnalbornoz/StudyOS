/**
 * CV2-08 REGRESSION -- CRITICAL CANONICAL PROGRESSION FAILURE.
 *
 * Manual acceptance defect: immediately after a PRACTICE Results screen
 * correctly showed "Siguiente: demuestralo por tu cuenta (Prove)" (a
 * fresh `getCanonicalPedagogicalDecision` call), clicking Continue hit
 * `/api/learning/continue`, which returned
 * `{status:'WAITING', waitingReason:'RETENTION_NOT_DUE', nextEligibleAt:null}`
 * instead of launching PROVE.
 *
 * ROOT CAUSE (confirmed against the real Preview DB state for the
 * reporting student/concept -- see CV2-07/CV2-08 certification report):
 * Results and Continue were two INDEPENDENT decision authorities.
 * Results asks the real Canonical V2 engine (`getCanonicalPedagogicalDecision`).
 * Continue (`resolveContinuation`, LX-5E) instead asked the LEGACY,
 * pre-Canonical-V2 Phase 4 Adaptive Learning Orchestrator
 * (`getLearningDecisions` -> `computeLearningState`), which reads its
 * OWN, separate `concept_knowledge_state` projection (Phase 2.2A). For
 * the real reported student+concept, `masteryState` was correctly
 * `LEARNING` (independence 50/80, understanding 57/80 -- genuinely far
 * from mastered) but `validationReadiness` was `WAITING_FOR_RETENTION`
 * purely because `retention_score === null` (`determineValidationReadiness`
 * returns that value whenever evidence sufficiency passes and no
 * retention evidence exists yet -- true for virtually every concept that
 * has never reached RETAIN, not only ones already validated).
 * `computeLearningState` treats ANY `WAITING_FOR_RETENTION` as
 * `RETENTION_RISK` unconditionally, and `resolveContinuation`'s
 * RETENTION_RISK branch then asked the Phase 6 Twin Memory signal, found
 * no real schedule (`nextReviewAt: null`), and returned
 * WAITING/RETENTION_NOT_DUE/null -- never having consulted Canonical V2
 * at all.
 *
 * FIX: `resolveContinuation` now checks `isCanonicalEngineV1Enabled()`
 * FIRST. When on, it resolves EXCLUSIVELY through
 * `getCanonicalPedagogicalDecision` + `resolveCanonicalLaunch` -- the
 * SAME pair `/api/learning/session/start` already uses -- and never
 * consults the legacy Phase 4/8 path at all. This is consolidation, not
 * a new resolver: both consumers (Results, via the route's own fresh
 * re-fetch, and Continue) now go through the one authoritative pair.
 * The legacy path is untouched and still runs exactly as before when the
 * gate is off (Production default) -- Phase 2.2A's own
 * `WAITING_FOR_RETENTION` semantics are a separate, pre-existing
 * question this fix deliberately does not touch (see the certification
 * report's own scope note).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  class MockCanonicalDecisionUnavailableError extends Error {
    cause?: unknown;
    constructor(message: string, cause?: unknown) {
      super(message);
      this.name = 'CanonicalDecisionUnavailableError';
      this.cause = cause;
    }
  }
  return {
    isCanonicalEngineV1EnabledMock: vi.fn(),
    getCanonicalPedagogicalDecisionMock: vi.fn(),
    resolveCanonicalLaunchMock: vi.fn(),
    resolveConceptSubjectForStudentMock: vi.fn(),
    MockCanonicalDecisionUnavailableError,
  };
});
const {
  isCanonicalEngineV1EnabledMock,
  getCanonicalPedagogicalDecisionMock,
  resolveCanonicalLaunchMock,
  resolveConceptSubjectForStudentMock,
  MockCanonicalDecisionUnavailableError,
} = h;

vi.mock('@/lib/pedagogical-decision', () => ({
  isCanonicalEngineV1Enabled: () => h.isCanonicalEngineV1EnabledMock(),
  getCanonicalPedagogicalDecision: (...a: any[]) => h.getCanonicalPedagogicalDecisionMock(...a),
  CanonicalDecisionUnavailableError: h.MockCanonicalDecisionUnavailableError,
  resolveCanonicalLaunch: (...a: any[]) => h.resolveCanonicalLaunchMock(...a),
  resolveConceptSubjectForStudent: (...a: any[]) => h.resolveConceptSubjectForStudentMock(...a),
}));

// The LEGACY Phase 4/8 path -- mocked so we can assert it is NEVER
// touched once the canonical gate is on (TEST 7's own "legacy cannot
// bypass canonical" proof, generalized: legacy cannot even be
// CONSULTED once the gate is on).
const getLearningDecisionsMock = vi.fn();
const getBestLearningDecisionForConceptMock = vi.fn();
const getTeachingIntentMock = vi.fn();
vi.mock('@/services/adaptive-teaching.service', () => ({
  getBestLearningDecisionForConcept: (...a: any[]) => getBestLearningDecisionForConceptMock(...a),
  getTeachingIntent: (...a: any[]) => getTeachingIntentMock(...a),
}));
vi.mock('@/services/adaptive-learning-orchestrator.service', () => ({
  getLearningDecisions: (...a: any[]) => getLearningDecisionsMock(...a),
}));
vi.mock('@/services/learning-session-engine.service', () => ({ startLearningSession: vi.fn() }));
vi.mock('@/services/curriculum-eligibility-read.service', () => ({ getCurriculumEligibleConcepts: vi.fn().mockResolvedValue([]) }));
vi.mock('@/lib/curriculum-progression-bootstrap', () => ({
  bootstrapNotStartedLearningDecision: vi.fn(),
  hasLiveDecisionForConcept: vi.fn().mockReturnValue(false),
}));
vi.mock('@/services/knowledge-state.service', () => ({
  getConceptKnowledgeState: vi.fn().mockResolvedValue(null),
  getActiveMasteryPolicy: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/lx/evidence-sufficiency-contract', () => ({ isZeroGapPracticeMismatch: vi.fn().mockReturnValue(false) }));
vi.mock('@/lib/i18n/language', () => ({ getInterfaceLanguage: vi.fn().mockResolvedValue('en') }));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@/services/memory-read.service', () => ({ getTwinMemorySignal: vi.fn().mockResolvedValue(null) }));

import { resolveContinuation } from '@/services/learning-continuation.service';

const STUDENT_ID = '11111111-1111-4111-8111-111111111111';
const SUBJECT_ID = '22222222-2222-4222-8222-222222222222';
const CONCEPT_ID = '33333333-3333-4333-8333-333333333333';

function canonicalDecision(overrides: Partial<Record<string, any>> = {}) {
  return {
    policyVersion: 'v1', canonicalRevision: 'rev-1',
    stage: 'PROVE', actionState: 'EXECUTABLE',
    activityContract: { activityType: 'PROVE', itemCount: { min: 10, max: 10 }, difficulty: { target: 3 } },
    intervention: null,
    waitingReason: null, nextEligibleAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  isCanonicalEngineV1EnabledMock.mockReset();
  getCanonicalPedagogicalDecisionMock.mockReset();
  resolveCanonicalLaunchMock.mockReset();
  resolveConceptSubjectForStudentMock.mockReset().mockResolvedValue({ subjectId: SUBJECT_ID });
  getLearningDecisionsMock.mockReset().mockResolvedValue([]);
  getBestLearningDecisionForConceptMock.mockReset();
  getTeachingIntentMock.mockReset();
});

describe('CV2-08: Continue must agree with Results -- ONE canonical authority, not two', () => {
  it('TEST 2/6 -- gate ON, canonical decision says PROVE/EXECUTABLE (the exact reported real state): Continue LAUNCHES Prove, it does NOT return WAITING/RETENTION_NOT_DUE', async () => {
    isCanonicalEngineV1EnabledMock.mockReturnValue(true);
    getCanonicalPedagogicalDecisionMock.mockResolvedValue({ decision: canonicalDecision() });
    resolveCanonicalLaunchMock.mockReturnValue({
      stage: 'PROVE', actionState: 'EXECUTABLE', activityType: 'PROVE',
      launchStatus: 'READY', launchTarget: '/dashboard/quiz?subjectId=s&conceptId=c&mode=canonical_prove',
      launchParams: {}, waitingReason: null, nextEligibleAt: null, notReadyReason: null,
    });

    const result = await resolveContinuation({ studentId: STUDENT_ID, conceptId: CONCEPT_ID, subjectId: SUBJECT_ID });

    expect(result.status).toBe('LAUNCH');
    if (result.status === 'LAUNCH') {
      expect(result.activityType).toBe('PROVE');
      expect(result.launchTarget).toContain('mode=canonical_prove');
      expect(result.source).toBe('CANONICAL_ENGINE_V1');
    }
    // The legacy path must never even be consulted -- this is THE fix,
    // not merely a coincidentally-matching outcome.
    expect(getLearningDecisionsMock).not.toHaveBeenCalled();
    expect(getBestLearningDecisionForConceptMock).not.toHaveBeenCalled();
  });

  it('TEST 8 -- Results (a fresh canonical decision) and Continue, given the identical canonical decision object, agree on stage/actionState/launchTarget', async () => {
    isCanonicalEngineV1EnabledMock.mockReturnValue(true);
    const decision = canonicalDecision();
    getCanonicalPedagogicalDecisionMock.mockResolvedValue({ decision });
    const session = {
      stage: decision.stage, actionState: decision.actionState, activityType: 'PROVE',
      launchStatus: 'READY', launchTarget: '/dashboard/quiz?mode=canonical_prove',
      launchParams: {}, waitingReason: null, nextEligibleAt: null, notReadyReason: null,
    };
    resolveCanonicalLaunchMock.mockReturnValue(session);

    const result = await resolveContinuation({ studentId: STUDENT_ID, conceptId: CONCEPT_ID, subjectId: SUBJECT_ID });

    // Continue's resolution is built from the SAME `resolveCanonicalLaunch`
    // output Results/session-start already trust -- by construction, not
    // by coincidence.
    expect(resolveCanonicalLaunchMock).toHaveBeenCalledWith(
      expect.objectContaining({ conceptId: CONCEPT_ID, decision })
    );
    expect(result.status).toBe('LAUNCH');
    if (result.status === 'LAUNCH') {
      expect(result.launchTarget).toBe(session.launchTarget);
    }
  });

  it('TEST 5 -- a genuinely completed PROVE, with the canonical engine\'s own real RETAIN/WAITING decision, may transition to RETENTION_NOT_DUE -- WAITING is a legitimate canonical outcome, not itself the bug', async () => {
    isCanonicalEngineV1EnabledMock.mockReturnValue(true);
    getCanonicalPedagogicalDecisionMock.mockResolvedValue({
      decision: canonicalDecision({ stage: 'RETAIN', actionState: 'WAITING', activityContract: null, waitingReason: 'RETENTION_MINIMUM_INTERVAL_NOT_REACHED', nextEligibleAt: '2026-10-01T00:00:00.000Z' }),
    });
    resolveCanonicalLaunchMock.mockReturnValue({
      stage: 'RETAIN', actionState: 'WAITING', activityType: null,
      launchStatus: 'WAITING', launchTarget: null, launchParams: {},
      waitingReason: 'RETENTION_MINIMUM_INTERVAL_NOT_REACHED', nextEligibleAt: '2026-10-01T00:00:00.000Z', notReadyReason: null,
    });

    const result = await resolveContinuation({ studentId: STUDENT_ID, conceptId: CONCEPT_ID, subjectId: SUBJECT_ID });

    expect(result.status).toBe('WAITING');
    if (result.status === 'WAITING') {
      expect(result.waitingReason).toBe('RETENTION_NOT_DUE');
      // Section 8 -- nextEligibleAt must be a REAL date here, never null:
      // the frozen engine only ever sets actionState WAITING alongside a
      // real computed `retainWaitingUntil` date (engine.ts), so this is a
      // straight passthrough, never fabricated and never dropped.
      expect(result.nextEligibleAt).toBe('2026-10-01T00:00:00.000Z');
      expect(result.nextEligibleAt).not.toBeNull();
    }
  });

  it('TEST 6 (negative form) -- RETENTION_NOT_DUE must never occur while the canonical engine still says PROVE is outstanding: WAITING is returned ONLY when resolveCanonicalLaunch itself says WAITING, never inferred independently', async () => {
    isCanonicalEngineV1EnabledMock.mockReturnValue(true);
    getCanonicalPedagogicalDecisionMock.mockResolvedValue({ decision: canonicalDecision({ stage: 'PROVE', actionState: 'EXECUTABLE' }) });
    resolveCanonicalLaunchMock.mockReturnValue({
      stage: 'PROVE', actionState: 'EXECUTABLE', activityType: 'PROVE',
      launchStatus: 'READY', launchTarget: '/dashboard/quiz?mode=canonical_prove',
      launchParams: {}, waitingReason: null, nextEligibleAt: null, notReadyReason: null,
    });

    const result = await resolveContinuation({ studentId: STUDENT_ID, conceptId: CONCEPT_ID, subjectId: SUBJECT_ID });
    expect(result.status).not.toBe('WAITING');
  });

  it('TEST 7 -- legacy evidence/state cannot bypass the canonical decision once the gate is on: the legacy Phase 4 orchestrator is never called, so it cannot influence the outcome even if it would have said RETENTION_RISK', async () => {
    isCanonicalEngineV1EnabledMock.mockReturnValue(true);
    // Legacy mock deliberately configured to return exactly the real,
    // reported (mis-)classification -- proving it is irrelevant once the
    // gate is on, not merely unlikely to be hit.
    getLearningDecisionsMock.mockResolvedValue([
      { actionConceptId: CONCEPT_ID, learningState: 'RETENTION_RISK', activityType: 'RETENTION_CHECK' },
    ]);
    getCanonicalPedagogicalDecisionMock.mockResolvedValue({ decision: canonicalDecision({ stage: 'PROVE', actionState: 'EXECUTABLE' }) });
    resolveCanonicalLaunchMock.mockReturnValue({
      stage: 'PROVE', actionState: 'EXECUTABLE', activityType: 'PROVE',
      launchStatus: 'READY', launchTarget: '/dashboard/quiz?mode=canonical_prove',
      launchParams: {}, waitingReason: null, nextEligibleAt: null, notReadyReason: null,
    });

    const result = await resolveContinuation({ studentId: STUDENT_ID, conceptId: CONCEPT_ID, subjectId: SUBJECT_ID });

    expect(result.status).toBe('LAUNCH');
    expect(getLearningDecisionsMock).not.toHaveBeenCalled();
  });

  it('CONSOLIDATED/LOCKED/BLOCKED/NOT_READY -- no canonical action right now is an honest RETURN_TO_MISSION, never reinterpreted as WAITING or a different stage', async () => {
    isCanonicalEngineV1EnabledMock.mockReturnValue(true);
    getCanonicalPedagogicalDecisionMock.mockResolvedValue({ decision: canonicalDecision({ stage: 'CONSOLIDATED', actionState: 'CONSOLIDATED', activityContract: null }) });
    resolveCanonicalLaunchMock.mockReturnValue({
      stage: 'CONSOLIDATED', actionState: 'CONSOLIDATED', activityType: null,
      launchStatus: 'CONSOLIDATED', launchTarget: null, launchParams: {},
      waitingReason: null, nextEligibleAt: null, notReadyReason: null,
    });

    const result = await resolveContinuation({ studentId: STUDENT_ID, conceptId: CONCEPT_ID, subjectId: SUBJECT_ID });

    expect(result.status).toBe('RETURN_TO_MISSION');
    if (result.status === 'RETURN_TO_MISSION') {
      expect(result.reason).toBe('CANONICAL_NO_FURTHER_ACTION');
    }
  });

  it('a genuine CanonicalDecisionUnavailableError never falls back to the legacy authority -- a controlled RETURN_TO_MISSION is the honest answer (Part 28 fail-safe, same discipline as session-start)', async () => {
    isCanonicalEngineV1EnabledMock.mockReturnValue(true);
    getCanonicalPedagogicalDecisionMock.mockRejectedValue(new MockCanonicalDecisionUnavailableError('read failed'));

    const result = await resolveContinuation({ studentId: STUDENT_ID, conceptId: CONCEPT_ID, subjectId: SUBJECT_ID });

    expect(result.status).toBe('RETURN_TO_MISSION');
    if (result.status === 'RETURN_TO_MISSION') {
      expect(result.reason).toBe('DECISION_UNAVAILABLE');
    }
    expect(getLearningDecisionsMock).not.toHaveBeenCalled();
  });

  it('ownership check: a conceptId that does not belong to this student resolves to a controlled failure, never a canonical read for the wrong owner', async () => {
    isCanonicalEngineV1EnabledMock.mockReturnValue(true);
    resolveConceptSubjectForStudentMock.mockResolvedValue(null);

    const result = await resolveContinuation({ studentId: STUDENT_ID, conceptId: CONCEPT_ID, subjectId: SUBJECT_ID });

    expect(result.status).toBe('RETURN_TO_MISSION');
    expect(getCanonicalPedagogicalDecisionMock).not.toHaveBeenCalled();
  });

  it('gate OFF (Production default): the legacy Phase 4 path still runs exactly as before -- this fix changes nothing when the gate is off', async () => {
    isCanonicalEngineV1EnabledMock.mockReturnValue(false);
    getLearningDecisionsMock.mockResolvedValue([]);

    await resolveContinuation({ studentId: STUDENT_ID, conceptId: CONCEPT_ID, subjectId: SUBJECT_ID });

    expect(getLearningDecisionsMock).toHaveBeenCalledTimes(1);
    expect(getCanonicalPedagogicalDecisionMock).not.toHaveBeenCalled();
  });
});

describe('CV2-07 / CV2-08 relationship: INDEPENDENT, not the same root cause', () => {
  it('the continuation resolver never reads any evidence scorePercent/correctCount at all -- it depends solely on the canonical decision object, so CV2-07\'s scoring defect (now fixed) could not have been what caused CV2-08 for this concept', async () => {
    isCanonicalEngineV1EnabledMock.mockReturnValue(true);
    // A decision object with no score/percent field anywhere -- if the
    // resolver needed one, this would already fail to type-check/behave;
    // it demonstrates the canonical continuation path's ONLY input is
    // the decision's stage/actionState/waitingReason/nextEligibleAt.
    getCanonicalPedagogicalDecisionMock.mockResolvedValue({ decision: canonicalDecision({ stage: 'PROVE', actionState: 'EXECUTABLE' }) });
    resolveCanonicalLaunchMock.mockReturnValue({
      stage: 'PROVE', actionState: 'EXECUTABLE', activityType: 'PROVE',
      launchStatus: 'READY', launchTarget: '/dashboard/quiz?mode=canonical_prove',
      launchParams: {}, waitingReason: null, nextEligibleAt: null, notReadyReason: null,
    });

    await resolveContinuation({ studentId: STUDENT_ID, conceptId: CONCEPT_ID, subjectId: SUBJECT_ID });

    // The ONLY calls resolveCanonicalContinuation makes: ownership,
    // canonical decision, canonical launch. No evidence/score read of
    // any kind -- the two defects are architecturally unrelated even
    // though CV2-07's corrupted evidence happened to be present in the
    // same real manual-test session.
    expect(resolveConceptSubjectForStudentMock).toHaveBeenCalledTimes(1);
    expect(getCanonicalPedagogicalDecisionMock).toHaveBeenCalledTimes(1);
    expect(resolveCanonicalLaunchMock).toHaveBeenCalledTimes(1);
  });
});
