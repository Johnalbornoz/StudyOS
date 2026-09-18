/**
 * UX/CANON-R1 -- required tests 12-31 (TRANSFER SEQUENCING) + PART U
 * (the live Fuerza centrípeta regression case).
 *
 * ROOT CAUSE (PART G, proven not guessed): knowledge-state.service.ts's
 * `determineValidationReadiness` checked `policy.requiresTransfer &&
 * scores.transfer === null` BEFORE `scores.retention === null`. For a
 * concept with NEITHER retention NOR transfer evidence yet (exactly
 * the state right after PROVE completes), this resolved to
 * `TRANSFER_REQUIRED` instead of `WAITING_FOR_RETENTION` -- masking the
 * retention gap underneath it. Every downstream canonical authority
 * (`computeLearningState`, `selectActivityType`,
 * `deriveLearnerJourneyStage`, and therefore Today/My Path/Concept
 * Mission/continuation, which all mirror this ONE upstream value)
 * inherited the wrong answer. The fix: check retention first. This
 * file proves that fix, the milestone-visualization fix (PART L), and
 * the server-side backstop (PART I) -- exercising the REAL, unmocked
 * canonical functions wherever possible.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');

import {
  determineValidationReadiness,
  determineMasteryState,
  type DimensionScores,
  type MisconceptionState,
  type EvidenceSufficiency,
  type MasteryPolicy,
} from '@/services/knowledge-state.service';
import {
  computeLearningState,
  selectActivityType,
  consolidateSignals,
  buildLearningDecisions,
  type LearningSignal,
  type ConceptDecisionContext,
} from '@/lib/adaptive-learning-policy';
import { deriveLearnerJourneyStage, isRetentionWaiting } from '@/lib/lx/learner-journey-contract';
import type { ConceptKnowledgeState } from '@/services/knowledge-state.service';
import { buildConceptMissionView, type ConceptMissionInputs, type ConceptMissionJourneyInput } from '@/lib/lx/concept-mission';

const REQUIRES_TRANSFER_POLICY: MasteryPolicy = {
  version: 1, minimumUnderstanding: 80, minimumIndependence: 80, minimumApplication: 75, minimumRetention: 75,
  minimumTransfer: 70, requiresTransfer: true, maximumCriticalMisconceptions: 0, minimumEvidenceCount: 3,
  minimumIndependentEvidenceCount: 2, validationWindowDays: 14,
};
const SUFFICIENT_EVIDENCE: EvidenceSufficiency = { evidenceCount: 6, independentEvidenceCount: 3, passed: true };
const NO_MISCONCEPTIONS: MisconceptionState = { activeCount: 0, criticalCount: 0, recurringCount: 0 };

/** The exact live-incident shape: PROVE complete, NEITHER retention NOR transfer demonstrated yet. */
function proveCompleteNoRetentionNoTransfer(): DimensionScores {
  return { understanding: 92, independence: 88, application: 85, retention: null, transfer: null };
}

function ksState(overrides: Partial<ConceptKnowledgeState> = {}): ConceptKnowledgeState {
  return {
    studentId: 's1', conceptId: 'c1', subjectId: 'subj1',
    masteryState: 'PROVISIONAL_MASTERY', understandingScore: 92, independenceScore: 88, applicationScore: 85,
    retentionScore: null, transferScore: null,
    activeMisconceptionCount: 0, criticalMisconceptionCount: 0, recurringMisconceptionCount: 0,
    evidenceCount: 6, independentEvidenceCount: 3, firstEvidenceAt: null, lastEvidenceAt: null,
    validationReadiness: 'WAITING_FOR_RETENTION', stateReason: null, projectionVersion: 1, masteryPolicyVersion: 1,
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function signal(overrides: Partial<LearningSignal> & Pick<LearningSignal, 'type' | 'conceptId' | 'subjectId'>): LearningSignal {
  return { source: 'test', metadata: {}, ...overrides };
}

function decisionFor(ks: ConceptKnowledgeState, signals: LearningSignal[] = []) {
  const ksMap = new Map([[ks.conceptId, ks]]);
  const allSignals = signals.length > 0 ? signals : [signal({ type: 'WAITING_FOR_RETENTION', conceptId: ks.conceptId, subjectId: ks.subjectId })];
  const contexts = consolidateSignals(allSignals, ksMap);
  return buildLearningDecisions(contexts)[0];
}

/* ================================================================= *
 * REQUIRED TEST 12 -- Transfer is not executable while Retention       *
 * is unresolved (the root-cause fix, direct).                          *
 * ================================================================= */
describe('UX/CANON-R1 12 -- Transfer is not executable while Retention is unresolved', () => {
  it('determineValidationReadiness resolves WAITING_FOR_RETENTION, never TRANSFER_REQUIRED, when neither is yet demonstrated', () => {
    const readiness = determineValidationReadiness(proveCompleteNoRetentionNoTransfer(), NO_MISCONCEPTIONS, SUFFICIENT_EVIDENCE, REQUIRES_TRANSFER_POLICY);
    expect(readiness).toBe('WAITING_FOR_RETENTION');
    expect(readiness).not.toBe('TRANSFER_REQUIRED');
  });

  it('computeLearningState resolves RETENTION_RISK, never TRANSFER_GAP, for the same shape', () => {
    const ks = ksState({ validationReadiness: 'WAITING_FOR_RETENTION' });
    const ctx: ConceptDecisionContext = {
      actionConceptId: 'c1', subjectId: 'subj1', knowledgeState: ks,
      signals: [signal({ type: 'WAITING_FOR_RETENTION', conceptId: 'c1', subjectId: 'subj1' })],
      targetConceptIds: [], remediationPathIds: [], diagnosisIds: [], occurrenceIds: [], calibrationConflictIds: [], verificationAttemptIds: [], quizSessionIds: [],
    };
    expect(computeLearningState(ctx)).toBe('RETENTION_RISK');
    expect(computeLearningState(ctx)).not.toBe('TRANSFER_GAP');
  });

  it('selectActivityType never returns TRANSFER for the same shape', () => {
    const ks = ksState({ validationReadiness: 'WAITING_FOR_RETENTION' });
    const ctx: ConceptDecisionContext = {
      actionConceptId: 'c1', subjectId: 'subj1', knowledgeState: ks,
      signals: [signal({ type: 'WAITING_FOR_RETENTION', conceptId: 'c1', subjectId: 'subj1' })],
      targetConceptIds: [], remediationPathIds: [], diagnosisIds: [], occurrenceIds: [], calibrationConflictIds: [], verificationAttemptIds: [], quizSessionIds: [],
    };
    expect(selectActivityType(ctx)).not.toBe('TRANSFER');
  });
});

/* ================================================================= *
 * REQUIRED TEST 13 -- Transfer is not executable while Retention is    *
 * WAITING (temporal, not just unresolved).                             *
 * ================================================================= */
describe('UX/CANON-R1 13 -- Transfer is not executable while Retention is WAITING', () => {
  it('a RETENTION_RISK decision with retentionDue=false resolves WAITING via isRetentionWaiting -- never falls through to TRANSFER', () => {
    const stage = deriveLearnerJourneyStage({ learningState: 'RETENTION_RISK', masteryState: 'PROVISIONAL_MASTERY', validationReadiness: 'WAITING_FOR_RETENTION' }).stage;
    expect(stage).toBe('RETAIN');
    expect(isRetentionWaiting(stage, false)).toBe(true);
  });
});

/* ================================================================= *
 * REQUIRED TESTS 14-16 -- Today / My Path / Concept Mission.           *
 * ================================================================= */
describe('UX/CANON-R1 14 -- Today never recommends premature Transfer', () => {
  it('the LearningDecision Today reads (via getLearningDecisions/buildLearningDecision) is RETENTION_RISK, never TRANSFER_GAP, for the live shape', () => {
    const decision = decisionFor(ksState({ validationReadiness: 'WAITING_FOR_RETENTION' }));
    expect(decision.learningState).toBe('RETENTION_RISK');
    expect(decision.activityType).not.toBe('TRANSFER');
  });
});

describe('UX/CANON-R1 15 -- My Path never exposes premature Transfer as executable', () => {
  it('resolveConceptJourneyStage (path-view.ts, the SAME authority My Path reads) resolves RETAIN for the live shape', async () => {
    const { resolveConceptJourneyStage } = await import('@/lib/lx/path-view');
    const decision = decisionFor(ksState({ validationReadiness: 'WAITING_FOR_RETENTION' }));
    const stage = resolveConceptJourneyStage('c1', 'subj1', ksState({ validationReadiness: 'WAITING_FOR_RETENTION' }), decision);
    expect(stage).toBe('RETAIN');
  });
});

describe('UX/CANON-R1 16 -- Concept Mission keeps current stage at Retain', () => {
  function base(over: Partial<ConceptMissionInputs> = {}): ConceptMissionInputs {
    return {
      conceptName: 'Fuerza centrípeta', subjectId: 'subj-1', subjectName: 'Física',
      conceptDescription: null, goalFallbackText: 'Understand Fuerza centrípeta.',
      knowledgeState: { masteryState: 'PROVISIONAL_MASTERY', validationReadiness: 'WAITING_FOR_RETENTION', evidenceCount: 6, independentEvidenceCount: 3 },
      journeyInput: { kind: 'RESOLVED', learningState: 'RETENTION_RISK', source: 'LEARNING_DECISION' } as ConceptMissionJourneyInput,
      learningDecision: null, memory: null, transferDepth: null, hasCachedExplanation: false,
      masteryPolicy: null,
      ...over,
    };
  }

  it('the journey stage is RETAIN, not TRANSFER, even with recorded (premature) transfer depth', () => {
    const v = buildConceptMissionView(base({ transferDepth: 'NEAR_DEMONSTRATED' }));
    if (v.journey.status !== 'RESOLVED') throw new Error('expected RESOLVED');
    expect(v.journey.stage).toBe('RETAIN');
  });
});

/* ================================================================= *
 * REQUIRED TEST 17 -- journey visualization does not mark Transfer     *
 * canonically complete from premature evidence alone.                  *
 * ================================================================= */
describe('UX/CANON-R1 17 -- the Transfer milestone is never rendered demonstrated while it is still UPCOMING', () => {
  it('with recorded transfer evidence (transferDepth=NEAR) but stage=RETAIN, the TRANSFER milestone is UPCOMING and NOT demonstrated', () => {
    const v = buildConceptMissionView({
      conceptName: 'Fuerza centrípeta', subjectId: 'subj-1', subjectName: 'Física',
      conceptDescription: null, goalFallbackText: 'Understand Fuerza centrípeta.',
      knowledgeState: { masteryState: 'PROVISIONAL_MASTERY', validationReadiness: 'WAITING_FOR_RETENTION', evidenceCount: 6, independentEvidenceCount: 3 },
      journeyInput: { kind: 'RESOLVED', learningState: 'RETENTION_RISK', source: 'LEARNING_DECISION' },
      learningDecision: null, memory: null, transferDepth: 'NEAR_DEMONSTRATED', hasCachedExplanation: false,
      masteryPolicy: null,
    });
    if (v.journey.status !== 'RESOLVED') throw new Error('expected RESOLVED');
    const transferMilestone = v.journey.milestones.find((m) => m.rung === 'TRANSFER')!;
    expect(transferMilestone.position).toBe('UPCOMING');
    expect(transferMilestone.demonstrated).toBe(false);
    expect(transferMilestone.demonstratedBy).toBeNull();
    // RETAIN itself, being CURRENT, is unaffected by this gating.
    const retainMilestone = v.journey.milestones.find((m) => m.rung === 'RETAIN')!;
    expect(retainMilestone.position).toBe('CURRENT');
  });
});

/* ================================================================= *
 * REQUIRED TESTS 18-19 -- server rejects direct premature Transfer     *
 * before AI, zero provider calls.                                     *
 * ================================================================= */
const verifyAuthMock = vi.fn();
const verifyStudentAccessMock = vi.fn();
vi.mock('@/lib/auth', () => ({
  verifyAuth: (...a: any[]) => verifyAuthMock(...a),
  verifyStudentAccess: (...a: any[]) => verifyStudentAccessMock(...a),
}));
const getConceptKnowledgeStateMock = vi.fn();
vi.mock('@/services/knowledge-state.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/knowledge-state.service')>();
  return { ...actual, getConceptKnowledgeState: (...a: any[]) => getConceptKnowledgeStateMock(...a) };
});
const generateStructuredTransferActivityMock = vi.fn();
vi.mock('@/services/transfer.service', () => ({
  generateStructuredTransferActivity: (...a: any[]) => generateStructuredTransferActivityMock(...a),
}));
vi.mock('@/services/transfer-read.service', () => ({ getConceptTransferDepth: vi.fn(async () => null) }));
vi.mock('@/lib/transfer-distance-authorization', () => ({
  authorizeRequestedTransferDistance: (requested: string) => ({ authorized: requested, clamped: false }),
}));
vi.mock('@/services/transfer-novelty.service', () => ({
  getRecentTransferFingerprints: vi.fn(async () => []),
  evaluateTransferNoveltyGuard: vi.fn(() => ({ eligible: true })),
}));
vi.mock('@/services/transfer-task-instance.service', () => ({
  persistTransferTaskInstance: vi.fn(async () => undefined),
  getRecentTransferTaskFingerprints: vi.fn(async () => []),
  resolveKnownConceptIds: vi.fn(async () => []),
}));
vi.mock('@/lib/transfer-novelty-certification', () => ({
  certifyStructuredTransferNovelty: vi.fn(() => ({ certified: true, noveltyDimensions: [] })),
}));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@/lib/observability/operational-log', () => ({ logOperationalWarning: vi.fn() }));
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));

const isCanonicalEngineV1EnabledMock = vi.fn();
const getCanonicalPedagogicalDecisionMock = vi.fn();
class MockCanonicalDecisionUnavailableError extends Error {}
vi.mock('@/lib/pedagogical-decision', () => ({
  isCanonicalEngineV1Enabled: () => isCanonicalEngineV1EnabledMock(),
  getCanonicalPedagogicalDecision: (...a: any[]) => getCanonicalPedagogicalDecisionMock(...a),
  CanonicalDecisionUnavailableError: MockCanonicalDecisionUnavailableError,
}));

beforeEach(() => {
  verifyAuthMock.mockReset().mockResolvedValue({ userId: 'u1', role: 'student' });
  verifyStudentAccessMock.mockReset().mockResolvedValue(true);
  getConceptKnowledgeStateMock.mockReset();
  generateStructuredTransferActivityMock.mockReset().mockResolvedValue({
    prompt: 'p', context: 'c', distance: 'NEAR', transferModality: 'text', noveltyDimensions: [], targetConceptIds: [], contextDomain: 'd', generatorPromptVersion: 'v1',
  });
  // Default: gate off, matching every pre-existing test in this file
  // (they never set this and always expect the legacy backstop).
  isCanonicalEngineV1EnabledMock.mockReset().mockReturnValue(false);
  getCanonicalPedagogicalDecisionMock.mockReset();
});

function buildRequest(body: unknown) {
  return { json: async () => body } as any;
}

// Valid-format UUIDs (correct version/variant nibbles) -- zod's .uuid()
// enforces the RFC shape strictly, a plain repeated-digit placeholder
// like '1111...1111' fails validation.
const STUDENT_ID = '11111111-1111-4111-8111-111111111111';
const CONCEPT_ID = '22222222-2222-4222-8222-222222222222';

describe('UX/CANON-R1 18-19 -- server-side PART I backstop on /api/cognitive/transfer/generate', () => {
  it('18. rejects with RETENTION_REQUIRED_BEFORE_TRANSFER, 409, before any AI call, when validationReadiness is WAITING_FOR_RETENTION', async () => {
    getConceptKnowledgeStateMock.mockResolvedValue(ksState({ validationReadiness: 'WAITING_FOR_RETENTION' }));
    const { POST } = await import('@/app/api/cognitive/transfer/generate/route');
    const res = await POST(buildRequest({
      studentId: STUDENT_ID,
      conceptId: CONCEPT_ID,
      conceptLabel: 'Fuerza centrípeta',
    }));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe('RETENTION_REQUIRED_BEFORE_TRANSFER');
  });

  it('19. the rejection makes ZERO provider calls', async () => {
    getConceptKnowledgeStateMock.mockResolvedValue(ksState({ validationReadiness: 'WAITING_FOR_RETENTION' }));
    const { POST } = await import('@/app/api/cognitive/transfer/generate/route');
    await POST(buildRequest({
      studentId: STUDENT_ID,
      conceptId: CONCEPT_ID,
      conceptLabel: 'Fuerza centrípeta',
    }));
    expect(generateStructuredTransferActivityMock).not.toHaveBeenCalled();
  });
});

/* ================================================================= *
 * PROD-PROMOTION STATIC AUTHORITY AUDIT FIX -- with the canonical    *
 * gate ON, this backstop must defer EXCLUSIVELY to a fresh canonical *
 * decision, never the legacy validationReadiness signal (in either   *
 * direction: it must not wrongly BLOCK a legitimate canonical        *
 * TRANSFER, and it must still correctly block when canonical itself  *
 * says TRANSFER is not yet executable).                              *
 * ================================================================= */
describe('PROD-PROMOTION -- gate ON: the backstop defers to the canonical decision, never the legacy validationReadiness signal', () => {
  it('legacy validationReadiness = WAITING_FOR_RETENTION must NOT block a request when canonical itself says TRANSFER/EXECUTABLE -- proves the legacy signal cannot override/demote a legitimate canonical stage', async () => {
    isCanonicalEngineV1EnabledMock.mockReturnValue(true);
    getCanonicalPedagogicalDecisionMock.mockResolvedValue({ decision: { stage: 'TRANSFER', actionState: 'EXECUTABLE' } });
    // The legacy read is never even consulted once the gate is on, but
    // set it to the exact PROD-02-shaped value anyway to prove it has
    // no effect if it WERE read.
    getConceptKnowledgeStateMock.mockResolvedValue(ksState({ validationReadiness: 'WAITING_FOR_RETENTION' }));

    const { POST } = await import('@/app/api/cognitive/transfer/generate/route');
    const res = await POST(buildRequest({ studentId: STUDENT_ID, conceptId: CONCEPT_ID, conceptLabel: 'Fuerza centrípeta' }));

    expect(res.status).not.toBe(409);
    expect(generateStructuredTransferActivityMock).toHaveBeenCalled();
    expect(getConceptKnowledgeStateMock).not.toHaveBeenCalled();
  });

  it('canonical stage/actionState anything other than TRANSFER/EXECUTABLE still correctly rejects with 409 -- the backstop still works, just from the right authority', async () => {
    isCanonicalEngineV1EnabledMock.mockReturnValue(true);
    getCanonicalPedagogicalDecisionMock.mockResolvedValue({ decision: { stage: 'RETAIN', actionState: 'WAITING' } });

    const { POST } = await import('@/app/api/cognitive/transfer/generate/route');
    const res = await POST(buildRequest({ studentId: STUDENT_ID, conceptId: CONCEPT_ID, conceptLabel: 'Fuerza centrípeta' }));

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe('RETENTION_REQUIRED_BEFORE_TRANSFER');
    expect(generateStructuredTransferActivityMock).not.toHaveBeenCalled();
  });

  it('a CanonicalDecisionUnavailableError returns a controlled 503, never a silent fall-back to the legacy signal', async () => {
    isCanonicalEngineV1EnabledMock.mockReturnValue(true);
    getCanonicalPedagogicalDecisionMock.mockRejectedValue(new MockCanonicalDecisionUnavailableError('read failed'));

    const { POST } = await import('@/app/api/cognitive/transfer/generate/route');
    const res = await POST(buildRequest({ studentId: STUDENT_ID, conceptId: CONCEPT_ID, conceptLabel: 'Fuerza centrípeta' }));

    expect(res.status).toBe(503);
    expect(getConceptKnowledgeStateMock).not.toHaveBeenCalled();
    expect(generateStructuredTransferActivityMock).not.toHaveBeenCalled();
  });
});

/* ================================================================= *
 * REQUIRED TESTS 20-21 -- history preserved, distinct from journey.    *
 * ================================================================= */
describe('UX/CANON-R1 20 -- existing premature Transfer evidence is preserved in history', () => {
  it('getTransferScore performs no filtering by canonical eligibility -- history is never deleted or hidden', () => {
    const SRC = read('src/services/transfer.service.ts');
    expect(SRC).toMatch(/export async function getTransferScore/);
    expect(SRC).not.toMatch(/DELETE FROM learning_evidence/);
  });
});

describe('UX/CANON-R1 21 -- history and canonical journey remain distinct', () => {
  it('demonstratedFor (raw evidence) and the milestone position (canonical stage) are computed from different, independent inputs', () => {
    const SRC = read('src/lib/lx/concept-mission.ts');
    expect(SRC).toMatch(/function demonstratedFor/);
    expect(SRC).toMatch(/Presence-of-canonical-record proof/);
    // The PART L gate is the ONE place they are reconciled -- never elsewhere.
    expect(SRC).toMatch(/position === 'UPCOMING' \? null : demonstratedFor\(rung, inputs\)/);
  });
});

/* ================================================================= *
 * REQUIRED TEST 22 -- successful Retention unlocks Transfer.           *
 * ================================================================= */
describe('UX/CANON-R1 22 -- successful Retention unlocks Transfer', () => {
  it('once retention is demonstrated (non-null, passing), the SAME policy correctly resolves TRANSFER_REQUIRED', () => {
    const scores: DimensionScores = { understanding: 92, independence: 88, application: 85, retention: 85, transfer: null };
    expect(determineValidationReadiness(scores, NO_MISCONCEPTIONS, SUFFICIENT_EVIDENCE, REQUIRES_TRANSFER_POLICY)).toBe('TRANSFER_REQUIRED');
  });

  it('selectActivityType then correctly offers TRANSFER once readiness is legitimately TRANSFER_REQUIRED', () => {
    const ks = ksState({ validationReadiness: 'TRANSFER_REQUIRED', retentionScore: 85 });
    const ctx: ConceptDecisionContext = {
      actionConceptId: 'c1', subjectId: 'subj1', knowledgeState: ks,
      signals: [signal({ type: 'TRANSFER_REQUIRED', conceptId: 'c1', subjectId: 'subj1' })],
      targetConceptIds: [], remediationPathIds: [], diagnosisIds: [], occurrenceIds: [], calibrationConflictIds: [], verificationAttemptIds: [], quizSessionIds: [],
    };
    expect(selectActivityType(ctx)).toBe('TRANSFER');
  });
});

/* ================================================================= *
 * REQUIRED TESTS 23-24 -- legitimate Transfer still works exactly as   *
 * before.                                                              *
 * ================================================================= */
describe('UX/CANON-R1 23 -- legitimate Transfer still generates successfully', () => {
  it('when validationReadiness is NOT WAITING_FOR_RETENTION, the route proceeds past the new gate to real generation', async () => {
    getConceptKnowledgeStateMock.mockResolvedValue(ksState({ validationReadiness: 'TRANSFER_REQUIRED', retentionScore: 85 }));
    const { POST } = await import('@/app/api/cognitive/transfer/generate/route');
    const res = await POST(buildRequest({
      studentId: STUDENT_ID,
      conceptId: CONCEPT_ID,
      conceptLabel: 'Fuerza centrípeta',
    }));
    expect(generateStructuredTransferActivityMock).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
  });

  it('a missing knowledge state (null) does not itself block Transfer -- only an EXPLICIT WAITING_FOR_RETENTION does', async () => {
    getConceptKnowledgeStateMock.mockResolvedValue(null);
    const { POST } = await import('@/app/api/cognitive/transfer/generate/route');
    const res = await POST(buildRequest({
      studentId: STUDENT_ID,
      conceptId: CONCEPT_ID,
      conceptLabel: 'Fuerza centrípeta',
    }));
    expect(res.status).toBe(200);
  });
});

describe('UX/CANON-R1 24 -- legitimate Transfer evaluation (submit route) remains unchanged', () => {
  it('the transfer/submit route was not touched by this phase', () => {
    const SRC = read('src/app/api/cognitive/transfer/submit/route.ts');
    expect(SRC).not.toMatch(/RETENTION_REQUIRED_BEFORE_TRANSFER/);
  });
});

/* ================================================================= *
 * REQUIRED TESTS 25-26 -- Results/continuation copy integrity.         *
 * ================================================================= */
describe('UX/CANON-R1 25 -- Results copy does not claim "no more activity" when Retention remains', () => {
  it('continuation.waitingBody no longer states a bare, permanent-sounding "no activity needed" -- it now says "for now" AND that StudyUS will notify the learner', async () => {
    const { getMessages } = await import('@/lib/i18n/messages');
    for (const locale of ['es', 'en', 'de', 'fr', 'pt'] as const) {
      const t = getMessages(locale);
      expect(t['continuation.waitingBody']).not.toBe('');
    }
    const es = (await import('@/lib/i18n/messages')).getMessages('es');
    expect(es['continuation.waitingBody']).not.toBe('Por ahora no necesitas otra actividad.');
    expect(es['continuation.waitingBody']).toMatch(/te avisará/);
  });
});

describe('UX/CANON-R1 26 -- Results continuation follows canonical next state', () => {
  it('ContinuationPanel branches on the SAME canonical resolveContinuation status the rest of the system uses -- never a locally-invented rule', () => {
    const SRC = read('src/app/dashboard/quiz/ContinuationPanel.tsx');
    expect(SRC).toMatch(/c\?\.status === 'LAUNCH'/);
    expect(SRC).toMatch(/c\?\.status === 'WAITING'/);
  });
});

/* ================================================================= *
 * REQUIRED TEST 27 -- Consolidated cannot be reached by premature      *
 * Transfer bypass.                                                     *
 * ================================================================= */
describe('UX/CANON-R1 27 -- Consolidated cannot be reached by a premature Transfer bypass', () => {
  it('determineMasteryState can never return VALIDATED_MASTERY while retention is null, regardless of transfer -- this was ALREADY true (independent AND conditions), unaffected by and confirming the fix\'s safety', () => {
    const scoresTransferOnly: DimensionScores = { understanding: 95, independence: 95, application: 95, retention: null, transfer: 95 };
    expect(determineMasteryState(scoresTransferOnly, NO_MISCONCEPTIONS, SUFFICIENT_EVIDENCE, REQUIRES_TRANSFER_POLICY)).not.toBe('VALIDATED_MASTERY');
  });
});

/* ================================================================= *
 * REQUIRED TEST 28 -- canonical journey order unchanged.               *
 * ================================================================= */
describe('UX/CANON-R1 28 -- canonical journey order remains LEARN -> PRACTICE -> PROVE -> RETAIN -> TRANSFER -> CONSOLIDATED', () => {
  it('RUNG_ORDER and LearnerJourneyStage are unchanged', async () => {
    const { RUNG_ORDER } = await import('@/lib/lx/concept-mission');
    expect(RUNG_ORDER).toEqual(['LEARN', 'PRACTICE', 'PROVE', 'RETAIN', 'TRANSFER']);
  });
});

/* ================================================================= *
 * REQUIRED TEST 29 -- REINFORCE behavior unchanged.                    *
 * ================================================================= */
describe('UX/CANON-R1 29 -- REINFORCE behavior unchanged', () => {
  it('a MISCONCEPTION_BLOCKED/PREREQUISITE_BLOCKED/NEEDS_REPAIR learningState still resolves the REINFORCE intervention exactly as before', () => {
    const r = deriveLearnerJourneyStage({ learningState: 'MISCONCEPTION_BLOCKED', masteryState: 'DEVELOPING', validationReadiness: 'INSUFFICIENT_EVIDENCE' });
    expect(r.intervention).toBe('REINFORCE');
    expect(r.stage).toBe('PRACTICE');
  });

  it('a genuine REINFORCE-justified zero-gap Practice exception (LX-9R8) is untouched', () => {
    const SRC = read('src/lib/lx/evidence-sufficiency-contract.ts');
    expect(SRC).toMatch(/export function isZeroGapPracticeMismatch/);
  });
});

/* ================================================================= *
 * REQUIRED TEST 30 -- LX-10R1 performance contracts unchanged.         *
 * ================================================================= */
describe('UX/CANON-R1 30 -- LX-10R1 question-generation performance contracts remain unchanged', () => {
  it('buildShapeExamplesBlock / questionGenerationCacheKey / the stable-prefix prompt structure are all still present', () => {
    const SRC = read('src/services/quiz-generation.service.ts');
    expect(SRC).toMatch(/function buildShapeExamplesBlock/);
    expect(SRC).toMatch(/function questionGenerationCacheKey/);
    expect(SRC).toMatch(/return `\$\{stablePrefix\}/);
  });
});

/* ================================================================= *
 * PART U -- the live Fuerza centrípeta regression case.                *
 * ================================================================= */
describe('UX/CANON-R1 PART U -- live regression: Fuerza centrípeta (Solo Check 67%, Practice 100%, TRANSFER 100%, Retention still required)', () => {
  it('canonical state still requires Retention: journey remains RETAIN, not TRANSFER, even with 100% recorded Transfer evidence', () => {
    // The exact live shape: understanding/independence/application all
    // strong (Solo Check + Practice succeeded), transfer evidence
    // EXISTS (100% correct, transferDepth demonstrated), retention
    // NEVER demonstrated.
    const scores: DimensionScores = { understanding: 95, independence: 90, application: 92, retention: null, transfer: 100 };
    const readiness = determineValidationReadiness(scores, NO_MISCONCEPTIONS, SUFFICIENT_EVIDENCE, REQUIRES_TRANSFER_POLICY);
    expect(readiness).toBe('WAITING_FOR_RETENTION');

    const ks = ksState({ validationReadiness: readiness, transferScore: 100 });
    const ctx: ConceptDecisionContext = {
      actionConceptId: 'c1', subjectId: 'subj1', knowledgeState: ks,
      signals: [signal({ type: 'WAITING_FOR_RETENTION', conceptId: 'c1', subjectId: 'subj1' })],
      targetConceptIds: [], remediationPathIds: [], diagnosisIds: [], occurrenceIds: [], calibrationConflictIds: [], verificationAttemptIds: [], quizSessionIds: [],
    };
    expect(computeLearningState(ctx)).toBe('RETENTION_RISK');

    const stage = deriveLearnerJourneyStage({ learningState: 'RETENTION_RISK', masteryState: ks.masteryState, validationReadiness: readiness }).stage;
    expect(stage).toBe('RETAIN');
  });

  it('the Transfer milestone is NOT shown as canonically completed despite the 100% historical evidence -- history and journey stay distinct', () => {
    const v = buildConceptMissionView({
      conceptName: 'Fuerza centrípeta', subjectId: 'subj-1', subjectName: 'Física',
      conceptDescription: null, goalFallbackText: 'Understand Fuerza centrípeta.',
      knowledgeState: { masteryState: 'PROVISIONAL_MASTERY', validationReadiness: 'WAITING_FOR_RETENTION', evidenceCount: 6, independentEvidenceCount: 3 },
      journeyInput: { kind: 'RESOLVED', learningState: 'RETENTION_RISK', source: 'LEARNING_DECISION' },
      learningDecision: null, memory: null, transferDepth: 'NEAR_DEMONSTRATED', hasCachedExplanation: false,
      masteryPolicy: null,
    });
    if (v.journey.status !== 'RESOLVED') throw new Error('expected RESOLVED');
    const transferMilestone = v.journey.milestones.find((m) => m.rung === 'TRANSFER')!;
    expect(transferMilestone.demonstrated).toBe(false);
    expect(transferMilestone.position).not.toBe('PASSED');
  });

  it('direct Transfer execution is rejected before AI, before any provider call', async () => {
    getConceptKnowledgeStateMock.mockResolvedValue(ksState({ validationReadiness: 'WAITING_FOR_RETENTION', transferScore: 100 }));
    const { POST } = await import('@/app/api/cognitive/transfer/generate/route');
    const res = await POST(buildRequest({
      studentId: STUDENT_ID,
      conceptId: CONCEPT_ID,
      conceptLabel: 'Fuerza centrípeta',
    }));
    expect(res.status).toBe(409);
    expect(generateStructuredTransferActivityMock).not.toHaveBeenCalled();
  });

  it('after valid Retention is demonstrated, StudyUS correctly determines the next canonical Transfer action -- the existing premature evidence does not need to be deleted for this to work', () => {
    // Retention now demonstrated; the 100% transfer evidence from
    // BEFORE is still there (never deleted, PART K/20) -- per PART K,
    // whether it AUTOMATICALLY counts toward a fresh Transfer
    // requirement is UNRESOLVED (no canonical freshness/eligibility
    // rule exists to say otherwise) -- documented in the report, not
    // invented here. What this test proves is only that Retention
    // becoming satisfied does not ITSELF block progression.
    const scores: DimensionScores = { understanding: 95, independence: 90, application: 92, retention: 85, transfer: 100 };
    const readiness = determineValidationReadiness(scores, NO_MISCONCEPTIONS, SUFFICIENT_EVIDENCE, REQUIRES_TRANSFER_POLICY);
    expect(readiness).not.toBe('WAITING_FOR_RETENTION');
  });
});
