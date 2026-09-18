/**
 * PROD-02 REGRESSION -- Canonical V2 must be the SINGLE progression
 * authority; legacy `validationReadiness === 'WAITING_FOR_RETENTION'`
 * must never place a learner in RETAIN without a genuine qualifying
 * PROVE.
 *
 * CONFIRMED PRODUCTION INCIDENT (real evidence, see the certification
 * report): a concept with THREE PRACTICE_QUIZ evidence rows (83%, 50%,
 * 0%, all `metadata.activityType = PRACTICE`, `ai_assistance_type =
 * NONE`) and ZERO PROVE/SOLO evidence reached
 * `concept_knowledge_state.validation_readiness = 'WAITING_FOR_RETENTION'`
 * (Phase 2.2A's `determineValidationReadiness` returns this the moment
 * generic evidence sufficiency passes and no retention evidence exists
 * yet -- true for essentially any concept that has never reached
 * RETAIN, not only ones already mastered). The legacy pipeline
 * (`computeLearningState` -> `deriveLearnerJourneyStage`) then produced
 * RETENTION_RISK -> RETAIN, and learner-facing UI showed "Ya lo
 * demostraste por tu cuenta" despite PROVE never having occurred.
 *
 * Section 8 exercises the REAL, unmocked canonical engine directly
 * (never asserting a hardcoded PROVE/PRACTICE outcome -- the expected
 * stage is derived from the real 2-of-last-3 PRACTICE policy). Section
 * 9 exercises the cross-surface consistency requirement: given the same
 * canonical decision, `resolveCanonicalLaunch` (Results/session-start/
 * Continue) and `path-view.ts`'s new canonical-aware authority (My
 * Path/Subjects detail page) cannot disagree, and a legacy
 * `validationReadiness: 'WAITING_FOR_RETENTION'` passed alongside a
 * canonical PROVE/EXECUTABLE decision is never allowed to win.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  evaluateCanonicalLearningState,
  type RawEvidenceItem,
  type PedagogicalEngineInput,
} from '@/lib/pedagogical-engine';
import { resolveCanonicalLaunch } from '@/lib/pedagogical-decision/canonical-session-launch';
import type { CanonicalPedagogicalDecision } from '@/lib/pedagogical-engine';

function item(overrides: Partial<RawEvidenceItem>): RawEvidenceItem {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    activityType: 'PRACTICE',
    timestamp: '2026-01-01T00:00:00.000Z',
    itemCount: 3,
    correctCount: 3,
    scorePercent: 100,
    independent: false,
    difficulty: 3,
    hasCriticalMisconception: false,
    ...overrides,
  };
}

function learnCheckItem(ts: string, score = 90): RawEvidenceItem {
  return item({ activityType: 'LEARN_CHECK', timestamp: ts, itemCount: 5, correctCount: Math.round((score / 100) * 5), scorePercent: score, difficulty: 1.5, independent: false });
}

/** The exact reported PROD-02 evidence: 3 PRACTICE_QUIZ attempts, ai_assistance_type NONE (independent: false -- assistance-free, but NOT canonical INDEPENDENT evidence mode; PRACTICE does not require independence per policy either way), no PROVE/SOLO evidence at all. */
function prod02PracticeAttempts(): RawEvidenceItem[] {
  return [
    item({ activityType: 'PRACTICE', timestamp: '2026-01-01T00:00:00.000Z', scorePercent: 83, correctCount: 3, itemCount: 3, difficulty: 3, independent: false }),
    item({ activityType: 'PRACTICE', timestamp: '2026-01-02T00:00:00.000Z', scorePercent: 50, correctCount: 1, itemCount: 3, difficulty: 3, independent: false }),
    item({ activityType: 'PRACTICE', timestamp: '2026-01-03T00:00:00.000Z', scorePercent: 0, correctCount: 0, itemCount: 3, difficulty: 3, independent: false }),
  ];
}

function baseInput(overrides: Partial<PedagogicalEngineInput> = {}): PedagogicalEngineInput {
  return {
    conceptId: 'concept-1',
    studentId: 'student-1',
    now: '2026-01-04T00:00:00.000Z',
    evidence: [],
    activeCriticalMisconception: false,
    ...overrides,
  };
}

describe('SECTION 8 -- PROD-02 regression: PRACTICE 83/50/0, zero PROVE evidence, must never produce RETAIN/WAITING_FOR_RETENTION/RETENTION_RISK/PROVE-satisfied', () => {
  it('the real canonical engine, given the exact reported evidence (plus the LEARN prerequisite every real student would have), derives PRACTICE as the current stage -- NOT hardcoded, derived from the real 2-of-last-3 policy (only 1 of 3 attempts >=80%, so PRACTICE is still outstanding)', () => {
    const decision = evaluateCanonicalLearningState(
      baseInput({ evidence: [learnCheckItem('2025-12-31T00:00:00.000Z', 90), ...prod02PracticeAttempts()] }),
    );

    // Derived, not asserted a priori: confirm the actual policy inputs
    // this test relies on, so a future policy change makes this test
    // fail loudly instead of silently asserting the wrong thing.
    const practiceReq = decision.requirements.find((r) => r.stage === 'PRACTICE')!;
    expect(practiceReq.qualifyingEvidenceCount).toBe(1); // only the 83% attempt qualifies
    expect(practiceReq.status).not.toBe('SATISFIED'); // 1 of 3 is not "2 of last 3"

    expect(decision.stage).toBe('PRACTICE');
  });

  it('PROVE is never reported satisfied -- there is no PROVE evidence at all', () => {
    const decision = evaluateCanonicalLearningState(
      baseInput({ evidence: [learnCheckItem('2025-12-31T00:00:00.000Z', 90), ...prod02PracticeAttempts()] }),
    );
    const proveReq = decision.requirements.find((r) => r.stage === 'PROVE')!;
    expect(proveReq.status).not.toBe('SATISFIED');
    expect(decision.lastQualifyingProveAt).toBeNull(); // the canonical "demonstrated" fact -- never set without real PROVE evidence
  });

  it('RETAIN is LOCKED (never WAITING, never SATISFIED, never the reported stage) -- it structurally cannot be reached before PROVE', () => {
    const decision = evaluateCanonicalLearningState(
      baseInput({ evidence: [learnCheckItem('2025-12-31T00:00:00.000Z', 90), ...prod02PracticeAttempts()] }),
    );
    const retainReq = decision.requirements.find((r) => r.stage === 'RETAIN')!;
    expect(retainReq.status).toBe('LOCKED');
    expect(decision.stage).not.toBe('RETAIN');
    expect(decision.actionState).not.toBe('WAITING');
    expect(decision.waitingReason).toBeNull();
  });

  it('even with a HIGH-scoring first attempt (83%) that alone might look "sufficient" to a naive reading, the canonical engine still requires the real 2-of-3 window before advancing past PRACTICE -- proves this is the real policy, not a lenient approximation', () => {
    const decision = evaluateCanonicalLearningState(
      baseInput({
        now: '2026-01-02T00:00:00.000Z',
        evidence: [learnCheckItem('2025-12-31T00:00:00.000Z', 90), item({ activityType: 'PRACTICE', timestamp: '2026-01-01T00:00:00.000Z', scorePercent: 83, difficulty: 3 })],
      }),
    );
    expect(decision.stage).toBe('PRACTICE'); // 1 qualifying attempt is not yet 2 of 3
  });

  it('CONTROL -- a legitimate progression (qualifying PRACTICE x2, then a real qualifying PROVE) DOES correctly reach RETAIN, proving this suite is not simply asserting "never RETAIN" universally', () => {
    const decision = evaluateCanonicalLearningState(
      baseInput({
        now: '2026-01-03T01:00:00.000Z',
        evidence: [
          learnCheckItem('2025-12-31T00:00:00.000Z', 90),
          item({ activityType: 'PRACTICE', timestamp: '2026-01-01T00:00:00.000Z', scorePercent: 90, difficulty: 3 }),
          item({ activityType: 'PRACTICE', timestamp: '2026-01-01T01:00:00.000Z', scorePercent: 90, difficulty: 3 }),
          item({ activityType: 'PROVE', timestamp: '2026-01-02T00:00:00.000Z', itemCount: 10, correctCount: 9, scorePercent: 90, difficulty: 3.5, independent: true }),
        ],
      }),
    );
    expect(decision.stage).toBe('RETAIN');
    const proveReq = decision.requirements.find((r) => r.stage === 'PROVE')!;
    expect(proveReq.status).toBe('SATISFIED');
    expect(decision.lastQualifyingProveAt).toBe('2026-01-02T00:00:00.000Z');
  });
});

describe('SECTION 9 -- cross-surface consistency: the SAME canonical decision cannot produce contradictory learner-facing surfaces', () => {
  function proveExecutableDecision(): CanonicalPedagogicalDecision {
    return {
      policyVersion: 'studyus-canonical-v1', canonicalRevision: 'rev-1', conceptId: 'c1', studentId: 's1',
      stage: 'PROVE', currentStage: 'PROVE', actionState: 'EXECUTABLE', nextCanonicalAction: 'PROVE',
      requirements: [
        { stage: 'LEARN', status: 'SATISFIED', qualifyingEvidenceCount: 1, nonQualifyingEvidenceCount: 0, qualifyingEvidenceIds: [], nonQualifyingEvidenceIds: [], reasonCodes: [], waitingUntil: null, satisfactionBasis: 'V1_EVIDENCE' },
        { stage: 'PRACTICE', status: 'SATISFIED', qualifyingEvidenceCount: 2, nonQualifyingEvidenceCount: 0, qualifyingEvidenceIds: [], nonQualifyingEvidenceIds: [], reasonCodes: [], waitingUntil: null, satisfactionBasis: 'V1_EVIDENCE' },
        { stage: 'PROVE', status: 'UNRESOLVED', qualifyingEvidenceCount: 0, nonQualifyingEvidenceCount: 0, qualifyingEvidenceIds: [], nonQualifyingEvidenceIds: [], reasonCodes: [], waitingUntil: null, satisfactionBasis: null },
        { stage: 'RETAIN', status: 'LOCKED', qualifyingEvidenceCount: 0, nonQualifyingEvidenceCount: 0, qualifyingEvidenceIds: [], nonQualifyingEvidenceIds: [], reasonCodes: [], waitingUntil: null, satisfactionBasis: null },
        { stage: 'TRANSFER', status: 'LOCKED', qualifyingEvidenceCount: 0, nonQualifyingEvidenceCount: 0, qualifyingEvidenceIds: [], nonQualifyingEvidenceIds: [], reasonCodes: [], waitingUntil: null, satisfactionBasis: null },
      ],
      qualifiedEvidence: [],
      activityContract: { activityType: 'PROVE', itemCount: { min: 10, max: 10 }, difficulty: { target: 3.5, min: 3, max: 4, reasonCode: 'DEFAULT_STAGE_MIDPOINT' as any }, independence: true, supportLevel: 'NONE', minimumScorePercent: 80, evidenceContract: 'PROVE_INDEPENDENT_CHECK' as any },
      waitingReason: null, nextEligibleAt: null, intervention: null, rollback: null, reasonCodes: [],
      journeyProgressPercent: 55, computedAt: '2026-01-04T00:00:00.000Z', recognitionRejected: null,
      lastQualifyingProveAt: null,
    };
  }

  it('resolveCanonicalLaunch (Results/session-start/Continue\'s shared authority) reports PROVE READY, never RETAIN/WAITING', () => {
    const session = resolveCanonicalLaunch({ subjectId: 'subj1', conceptId: 'c1', decision: proveExecutableDecision() });
    expect(session.stage).toBe('PROVE');
    expect(session.launchStatus).toBe('READY');
    expect(session.launchTarget).toMatch(/mode=canonical_prove/);
    expect(session.launchStatus).not.toBe('WAITING');
  });

  it('path-view.ts\'s canonical-aware authority reports PROVE even when the LEGACY validationReadiness passed alongside it says WAITING_FOR_RETENTION -- legacy must never override', async () => {
    vi.resetModules();
    vi.doMock('@/lib/pedagogical-decision', () => ({
      isCanonicalEngineV1Enabled: () => true,
      getCanonicalPedagogicalDecision: async () => ({ decision: proveExecutableDecision() }),
      CanonicalDecisionUnavailableError: class extends Error {},
    }));
    const { resolveConceptJourneyResultAuthoritative } = await import('@/lib/lx/path-view');

    // The legacy knowledge-state input the real PROD-02 incident had --
    // WAITING_FOR_RETENTION despite zero PROVE evidence. Passed in
    // verbatim to prove it is IGNORED once the canonical gate is on.
    const legacyKsWithWaitingForRetention = {
      conceptId: 'c1', masteryState: 'LEARNING', validationReadiness: 'WAITING_FOR_RETENTION',
    } as any;

    const result = await resolveConceptJourneyResultAuthoritative('s1', 'c1', 'subj1', legacyKsWithWaitingForRetention, undefined);

    expect(result.stage).toBe('PROVE');
    expect(result.stage).not.toBe('RETAIN');

    vi.doUnmock('@/lib/pedagogical-decision');
    vi.resetModules();
  });

  it('a CanonicalDecisionUnavailableError degrades path-view.ts to the legacy result -- never a fabricated canonical-looking stage', async () => {
    vi.resetModules();
    class MockUnavailable extends Error {}
    vi.doMock('@/lib/pedagogical-decision', () => ({
      isCanonicalEngineV1Enabled: () => true,
      getCanonicalPedagogicalDecision: async () => { throw new MockUnavailable('read failed'); },
      CanonicalDecisionUnavailableError: MockUnavailable,
    }));
    const { resolveConceptJourneyResultAuthoritative } = await import('@/lib/lx/path-view');

    const legacyKs = { conceptId: 'c1', masteryState: 'VALIDATED_MASTERY', validationReadiness: 'READY' } as any;
    const decision = { learningState: 'RETENTION_RISK' } as any;
    const result = await resolveConceptJourneyResultAuthoritative('s1', 'c1', 'subj1', legacyKs, decision);

    // Falls back to the legacy computation exactly as it would have
    // before this fix -- honest degradation, not a crash, not a guess.
    expect(result.stage).toBe('RETAIN');

    vi.doUnmock('@/lib/pedagogical-decision');
    vi.resetModules();
  });

  it('gate OFF: path-view.ts\'s canonical-aware authority falls back to the legacy result unchanged (no behavior change for Production before activation)', async () => {
    vi.resetModules();
    vi.doMock('@/lib/pedagogical-decision', () => ({
      isCanonicalEngineV1Enabled: () => false,
      getCanonicalPedagogicalDecision: vi.fn(),
      CanonicalDecisionUnavailableError: class extends Error {},
    }));
    const { resolveConceptJourneyResultAuthoritative } = await import('@/lib/lx/path-view');
    const pd = await import('@/lib/pedagogical-decision');

    const legacyKs = { conceptId: 'c1', masteryState: 'LEARNING', validationReadiness: 'WAITING_FOR_RETENTION' } as any;
    const result = await resolveConceptJourneyResultAuthoritative('s1', 'c1', 'subj1', legacyKs, undefined);

    expect(pd.getCanonicalPedagogicalDecision).not.toHaveBeenCalled();
    expect(result.stage).toBe('RETAIN'); // legacy behavior, byte-identical to before this fix

    vi.doUnmock('@/lib/pedagogical-decision');
    vi.resetModules();
  });
});
