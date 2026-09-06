/**
 * STUDYUS PHASE 6 -- CLOSEOUT C1 (decision-engine performance hardening).
 *
 * Proves the bounded-concurrency refactor of
 * adaptive-learning-orchestrator.service.ts::loadLearningSignals is an
 * IO-scheduling change ONLY:
 *
 *   A. the per-concept read tasks actually overlap, but never more than
 *      LEARNING_SIGNAL_CONCURRENCY at once (bounded fan-out, not Promise.all);
 *   B. results are consumed in the ORIGINAL input order even when the
 *      underlying reads resolve out of order;
 *   C. getIndependentMastery and getAssessmentStateForConcept are each
 *      still called exactly once per concept -- no duplicate reads, no
 *      dropped reads;
 *   D. the per-diagnosis getLearningUnlockValue reads also overlap, and
 *      each diagnosis keeps its OWN unlock value (the keyed-by-id
 *      gather did not scramble the pairing);
 *   E. getTeachingIntentForConcept still triggers exactly ONE full
 *      signal load (one getLearningDecisions), never one per concept.
 *
 * Plus Step 16: a rejected concept read still rejects the whole call
 * (no silent swallow). Node env, leaf readers fully mocked, clock
 * frozen -- same deterministic harness shape used to capture the
 * before/after decision-equivalence snapshots.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { mapWithConcurrency } from '@/lib/bounded-concurrency';

const ORCH_SRC = readFileSync(
  join(process.cwd(), 'src/services/adaptive-learning-orchestrator.service.ts'),
  'utf-8',
);
const HELPER_SRC = readFileSync(join(process.cwd(), 'src/lib/bounded-concurrency.ts'), 'utf-8');

/** The documented operational bound. Kept in lock-step with the source
 *  by the guard test below so a value change can never slip past. */
const EXPECTED_CONCURRENCY = 4;

// --------------------------------------------------------------------------
// A + B: the mechanism itself (mapWithConcurrency), in isolation.
// --------------------------------------------------------------------------
describe('Closeout C1 -- mapWithConcurrency mechanism', () => {
  it('A. overlaps work but never exceeds the limit', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    await mapWithConcurrency(Array.from({ length: 16 }, (_, i) => i), EXPECTED_CONCURRENCY, async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 8));
      inFlight -= 1;
    });
    expect(maxInFlight).toBeGreaterThan(1);
    expect(maxInFlight).toBeLessThanOrEqual(EXPECTED_CONCURRENCY);
  });

  it('B. returns results in INPUT order despite out-of-order completion', async () => {
    const completionOrder: number[] = [];
    const results = await mapWithConcurrency([0, 1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      // later items finish first
      await new Promise((r) => setTimeout(r, (8 - n) * 6));
      completionOrder.push(n);
      return n * 10;
    });
    expect(results).toEqual([0, 10, 20, 30, 40, 50, 60, 70]);
    expect(completionOrder).not.toEqual([0, 1, 2, 3, 4, 5, 6, 7]); // proved it raced
  });

  it('rejects with the first worker error (no swallow) -- Step 16 mechanism', async () => {
    const boom = new Error('read failed');
    await expect(
      mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
        await new Promise((r) => setTimeout(r, n === 3 ? 1 : 20));
        if (n === 3) throw boom;
        return n;
      }),
    ).rejects.toBe(boom);
  });

  it('preserves a 1:1 mapping (each index handled exactly once)', async () => {
    const seen = new Map<number, number>();
    await mapWithConcurrency(Array.from({ length: 30 }, (_, i) => i), 4, async (item, index) => {
      seen.set(index, (seen.get(index) ?? 0) + 1);
      await new Promise((r) => setTimeout(r, (index % 5) * 2));
      return item;
    });
    expect(seen.size).toBe(30);
    expect([...seen.values()].every((c) => c === 1)).toBe(true);
  });
});

// --------------------------------------------------------------------------
// C + D + E + Step 16: the orchestrator read path, leaves mocked.
// --------------------------------------------------------------------------
const SUBJECT = 'subj-1';
const FIXED = new Date('2026-09-06T12:00:00.000Z');

const state = vi.hoisted(() => ({
  n: 1 as number,
  independentMasteryCalls: [] as string[],
  assessmentStateCalls: [] as string[],
  unlockCalls: [] as string[],
  assessmentInFlight: 0,
  assessmentMaxInFlight: 0,
  unlockInFlight: 0,
  unlockMaxInFlight: 0,
  memorySignalLoads: 0,
  subjectStateLoads: 0,
  rejectConceptId: null as string | null,
}));

function conceptIds(n: number) {
  return Array.from({ length: n }, (_, i) => `c${String(i).padStart(3, '0')}`);
}
function ksFor(id: string, i: number) {
  const masteryState = (['LEARNING', 'DEVELOPING', 'PROVISIONAL_MASTERY', 'VALIDATED_MASTERY', 'AT_RISK'] as const)[i % 5];
  const validationReadiness = (['INSUFFICIENT_EVIDENCE', 'WAITING_FOR_RETENTION', 'TRANSFER_REQUIRED', 'READY'] as const)[i % 4];
  return {
    studentId: 'stu-1', conceptId: id, subjectId: SUBJECT,
    masteryState, understandingScore: i % 3 === 0 ? 50 : 85,
    independenceScore: null, applicationScore: null, retentionScore: null, transferScore: null,
    activeMisconceptionCount: i % 7 === 0 ? 1 : 0, criticalMisconceptionCount: i % 11 === 0 ? 1 : 0,
    recurringMisconceptionCount: 0, evidenceCount: 5, independentEvidenceCount: 2,
    firstEvidenceAt: '2026-08-01T00:00:00.000Z', lastEvidenceAt: '2026-09-01T00:00:00.000Z',
    validationReadiness, stateReason: null, projectionVersion: 1, masteryPolicyVersion: 1,
    updatedAt: '2026-09-01T00:00:00.000Z',
  };
}

// Two CONFIRMED (unremediated) diagnoses + one DIAGNOSIS_REQUIRED.
// Each CONFIRMED candidate gets a DISTINCT unlock score/blockedCount so
// a scrambled pairing would be caught.
const DIAGNOSES = [
  { id: 'dx-1', state: 'CONFIRMED', candidateConceptId: 'c001', targetConceptId: 'c002', subjectId: SUBJECT },
  { id: 'dx-2', state: 'DIAGNOSIS_REQUIRED', candidateConceptId: 'c003', targetConceptId: 'c003', subjectId: SUBJECT },
  { id: 'dx-3', state: 'CONFIRMED', candidateConceptId: 'c004', targetConceptId: 'c004', subjectId: SUBJECT },
] as const;
const UNLOCK_BY_CONCEPT: Record<string, { score: number; blockedCount: number }> = {
  c001: { score: 30, blockedCount: 3 },
  c004: { score: 11, blockedCount: 1 },
};

vi.mock('@/lib/db', () => ({
  db: {
    query: vi.fn(async (sql: string) => {
      if (/FROM subjects WHERE student_id/i.test(sql)) return { rows: [{ id: SUBJECT }] };
      return { rows: [] };
    }),
  },
}));
vi.mock('@/services/knowledge-state.service', async (orig) => {
  const actual: any = await orig();
  return {
    ...actual,
    getActiveMasteryPolicy: vi.fn(async () => ({
      version: 1, minimumUnderstanding: 70, minimumIndependence: 80, minimumApplication: 75,
      minimumRetention: 75, minimumTransfer: 70, requiresTransfer: true, maximumCriticalMisconceptions: 0,
      minimumEvidenceCount: 3, minimumIndependentEvidenceCount: 2, validationWindowDays: 14,
    })),
    getSubjectKnowledgeState: vi.fn(async (_s: string, subjectId: string) => {
      state.subjectStateLoads += 1;
      return conceptIds(state.n).map((id, i) => ksFor(id, i)).filter((k) => k.subjectId === subjectId);
    }),
  };
});
vi.mock('@/services/learning-scheduler.service', () => ({ getDueItems: vi.fn(async () => []) }));
vi.mock('@/services/remediation.service', () => ({ getActiveRemediationsWithLabels: vi.fn(async () => []) }));
vi.mock('@/services/cognitive-diagnosis.service', () => ({
  getActiveDiagnoses: vi.fn(async () => DIAGNOSES.map((d) => ({ ...d }))),
}));
vi.mock('@/services/concept-graph.service', () => ({
  getLearningUnlockValue: vi.fn(async (conceptId: string) => {
    state.unlockCalls.push(conceptId);
    state.unlockInFlight += 1;
    state.unlockMaxInFlight = Math.max(state.unlockMaxInFlight, state.unlockInFlight);
    await new Promise((r) => setTimeout(r, conceptId === 'c001' ? 24 : 6)); // out-of-order
    state.unlockInFlight -= 1;
    return UNLOCK_BY_CONCEPT[conceptId] ?? { score: 5, blockedCount: 1 };
  }),
}));
vi.mock('@/services/misconception.service', () => ({ getRecurringMisconceptions: vi.fn(async () => []) }));
vi.mock('@/services/learning-debt.service', () => ({ getActiveDebts: vi.fn(async () => []) }));
vi.mock('@/services/external-assessment.service', () => ({ getCalibrationConflicts: vi.fn(async () => []) }));
vi.mock('@/services/assessment.service', () => ({ getUpcomingForStudent: vi.fn(async () => []) }));
vi.mock('@/services/mastery.service', () => ({
  // EVERY concept gets a non-null mastery_score => getIndependentMastery
  // must be called exactly once per concept.
  getStudentMastery: vi.fn(async () =>
    conceptIds(state.n).map((id, i) => ({ concept_id: id, mastery_score: 60 + (i % 40) }))),
}));
vi.mock('@/services/learner-model.service', () => ({
  getIndependentMastery: vi.fn(async (_s: string, conceptId: string) => {
    state.independentMasteryCalls.push(conceptId);
    await new Promise((r) => setTimeout(r, (parseInt(conceptId.slice(1), 10) % 3) * 5));
    return 30 + (parseInt(conceptId.slice(1), 10) % 20);
  }),
}));
vi.mock('@/services/assessment-verification.service', () => ({
  getAssessmentStateForConcept: vi.fn(async (_s: string, conceptId: string) => {
    if (state.rejectConceptId === conceptId) throw new Error(`assessment read failed for ${conceptId}`);
    state.assessmentStateCalls.push(conceptId);
    state.assessmentInFlight += 1;
    state.assessmentMaxInFlight = Math.max(state.assessmentMaxInFlight, state.assessmentInFlight);
    // reverse-ordered delays: later concepts resolve first
    await new Promise((r) => setTimeout(r, (state.n - parseInt(conceptId.slice(1), 10)) * 2 + 2));
    state.assessmentInFlight -= 1;
    const i = parseInt(conceptId.slice(1), 10);
    return {
      hasPendingVerification: i % 6 === 0,
      pendingVerification: i % 6 === 0
        ? { verificationAttemptId: `va-${conceptId}`, quizSessionId: `qs-${conceptId}`, createdAt: '2026-09-01T00:00:00.000Z' }
        : null,
      lastIndependentEvidence: i % 4 === 0 ? null : { timestamp: '2026-09-01T00:00:00.000Z' },
      lastFormalEvidence: null, lastVerification: null,
      cognitiveDemand: { latestObservedLevel: null, observedLevels: [], sampleSize: 0, lastObservedAt: null },
    };
  }),
}));
vi.mock('@/services/memory-read.service', () => ({
  getPhase4MemorySignalsForStudent: vi.fn(async () => {
    state.memorySignalLoads += 1;
    const m = new Map<string, any>();
    conceptIds(state.n).forEach((id, i) => {
      m.set(id, {
        nextReviewAt: i % 3 === 0 ? '2026-09-04T00:00:00.000Z' : i % 3 === 1 ? '2026-09-20T00:00:00.000Z' : null,
        retentionDue: i % 3 === 0, daysOverdue: i % 3 === 0 ? 2 : null,
        retrievabilityNow: i % 2 === 0 ? 40 : 80, forgettingRisk: i % 2 === 0 ? 60 : 20,
        memoryStatus: 'DEVELOPING', lastSuccessfulRetentionAt: '2026-08-20T00:00:00.000Z',
        memoryStability: 'DEVELOPING', predictionConfidence: 'MEDIUM', policyVersion: 1,
      });
    });
    return m;
  }),
}));
// For invariant E only -- keep the teaching/twin layer inert.
vi.mock('@/lib/learner-twin', () => ({ getDecisionContext: vi.fn(async () => null) }));
vi.mock('@/lib/audit', () => ({ recordDecisionEvent: vi.fn(async () => {}) }));

function resetState(n: number) {
  state.n = n;
  state.independentMasteryCalls = [];
  state.assessmentStateCalls = [];
  state.unlockCalls = [];
  state.assessmentInFlight = 0;
  state.assessmentMaxInFlight = 0;
  state.unlockInFlight = 0;
  state.unlockMaxInFlight = 0;
  state.memorySignalLoads = 0;
  state.subjectStateLoads = 0;
  state.rejectConceptId = null;
}

describe('Closeout C1 -- orchestrator read path', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(FIXED);
    vi.clearAllMocks();
  });
  afterAll(() => vi.useRealTimers());

  it('A. per-concept read tasks overlap, bounded by LEARNING_SIGNAL_CONCURRENCY', async () => {
    resetState(14);
    const { getLearningDecisions } = await import('@/services/adaptive-learning-orchestrator.service');
    await getLearningDecisions('stu-1', 'en');
    expect(state.assessmentMaxInFlight).toBeGreaterThan(1);
    expect(state.assessmentMaxInFlight).toBeLessThanOrEqual(EXPECTED_CONCURRENCY);
  });

  it('C. getIndependentMastery & getAssessmentStateForConcept each called exactly once per concept', async () => {
    const N = 12;
    resetState(N);
    const { getLearningDecisions } = await import('@/services/adaptive-learning-orchestrator.service');
    await getLearningDecisions('stu-1', 'en');

    const ids = conceptIds(N);
    expect([...state.independentMasteryCalls].sort()).toEqual([...ids].sort());
    expect([...state.assessmentStateCalls].sort()).toEqual([...ids].sort());
    // no duplicates
    expect(new Set(state.independentMasteryCalls).size).toBe(N);
    expect(new Set(state.assessmentStateCalls).size).toBe(N);
  });

  it('B. decision output is order-stable across runs despite out-of-order reads', async () => {
    resetState(20);
    const { getLearningDecisions } = await import('@/services/adaptive-learning-orchestrator.service');
    const first = await getLearningDecisions('stu-1', 'en');
    resetState(20);
    const second = await getLearningDecisions('stu-1', 'en');
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('D. diagnosis unlock reads overlap AND each diagnosis keeps its own unlock value', async () => {
    resetState(6);
    const { getLearningDecisions } = await import('@/services/adaptive-learning-orchestrator.service');
    const decisions = await getLearningDecisions('stu-1', 'en');

    // both CONFIRMED, unremediated diagnoses were read; the
    // DIAGNOSIS_REQUIRED one never hits getLearningUnlockValue
    expect([...state.unlockCalls].sort()).toEqual(['c001', 'c004']);
    expect(state.unlockMaxInFlight).toBe(2); // the two reads raced

    // the emitted PREREQUISITE_GAP facts carry the RIGHT unlock value
    // for the RIGHT concept (keyed gather preserved the pairing)
    const gapFacts = decisions
      .flatMap((d) => d.signals ?? [])
      .filter((s: any) => s.type === 'PREREQUISITE_GAP');
    const byConcept = new Map(gapFacts.map((s: any) => [s.conceptId, s.metadata]));
    expect(byConcept.get('c001')).toMatchObject({ unlockValue: 30, blockedConceptCount: 3 });
    expect(byConcept.get('c004')).toMatchObject({ unlockValue: 11, blockedConceptCount: 1 });
  });

  it('E. getTeachingIntentForConcept triggers exactly ONE full signal load', async () => {
    resetState(8);
    const mod = await import('@/services/adaptive-teaching.service');
    await mod.getTeachingIntentForConcept('stu-1', 'c002');
    expect(state.memorySignalLoads).toBe(1);
    expect(state.subjectStateLoads).toBe(1);
  });

  it('Step 16. a rejected concept read rejects the whole call (no silent swallow)', async () => {
    resetState(10);
    state.rejectConceptId = 'c005';
    const { getLearningDecisions } = await import('@/services/adaptive-learning-orchestrator.service');
    await expect(getLearningDecisions('stu-1', 'en')).rejects.toThrow(/assessment read failed for c005/);
  });
});

// --------------------------------------------------------------------------
// Guards: the change stayed an IO-scheduling change.
// --------------------------------------------------------------------------
describe('Closeout C1 -- guards', () => {
  it('LEARNING_SIGNAL_CONCURRENCY is the documented fixed value, not configurable', () => {
    expect(ORCH_SRC).toMatch(/const LEARNING_SIGNAL_CONCURRENCY = 4;/);
    // never wired to env / policy / request input
    expect(ORCH_SRC).not.toMatch(/LEARNING_SIGNAL_CONCURRENCY\s*=\s*(Number\()?process\.env/);
    expect(ORCH_SRC).not.toMatch(/export\s+(const\s+)?LEARNING_SIGNAL_CONCURRENCY/);
  });

  it('the read path fans out via mapWithConcurrency, not an unbounded Promise.all over concepts', () => {
    expect(ORCH_SRC).toMatch(/mapWithConcurrency\(\s*conceptReadInputs,\s*LEARNING_SIGNAL_CONCURRENCY/);
    expect(ORCH_SRC).toMatch(/mapWithConcurrency\(\s*confirmedUnremediatedDiagnoses,\s*LEARNING_SIGNAL_CONCURRENCY/);
  });

  it('no cache / memoization / TTL was introduced in the helper or the read path', () => {
    for (const src of [HELPER_SRC, ORCH_SRC]) {
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(code).not.toMatch(/\b(memoize|lru|LRU|Redis|redis|setTimeout\(\s*\(\)\s*=>\s*cache)/);
    }
  });

  it('the concurrency helper has no retry / timeout / error-swallow', () => {
    const code = HELPER_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/retry|retries|setTimeout|AbortController|\.catch\(\s*\(\)\s*=>/);
  });
});
