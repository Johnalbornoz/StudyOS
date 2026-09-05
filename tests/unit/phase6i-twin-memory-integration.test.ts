/**
 * STUDYUS PHASE 6 -- RETENTION & MEMORY ENGINE
 * Step 6I: Digital Learning Twin memory integration -- test matrix.
 *
 * Covers: cross-surface consistency (Twin vs Phase 4 raw signal, same
 * fixed state/time), null/cold-start representation (no fallback, no
 * fabricated zero), subject-aggregate denominator semantics, and
 * overview coarse counts. Uses the pure readers.ts functions directly
 * (toMemorySignal/toRetentionSignal/aggregateSubjectMemorySummary/
 * aggregateMemoryOverview) plus memory-read.service.ts's two batch/
 * single readers against a shared fake DbExecutor -- no real database.
 */
import { describe, it, expect } from 'vitest';
import {
  getPhase4MemorySignalsForStudent,
  getTwinMemorySignal,
  getTwinMemorySignalsForStudent,
} from '@/services/memory-read.service';
import {
  toMemorySignal,
  toRetentionSignal,
  aggregateSubjectMemorySummary,
  aggregateMemoryOverview,
} from '@/lib/learner-twin/readers';
import type { TwinMemorySignal } from '@/services/memory-read.service';
import type { DbExecutor } from '@/lib/db';

const DAY = 24 * 60 * 60 * 1000;
const BASE = '2026-01-01T00:00:00.000Z';
const iso = (offsetDays: number) => new Date(new Date(BASE).getTime() + offsetDays * DAY).toISOString();
const NOW = new Date(new Date(BASE).getTime() + 90 * DAY); // fixed "now" for every test -- no hidden Date.now()

function memoryRow(overrides: Record<string, unknown> = {}) {
  return {
    concept_id: 'c1',
    policy_version: 1,
    initial_competence_anchor_at: null,
    last_qualified_attempt_at: null,
    last_successful_retention_at: null,
    last_unsuccessful_retention_at: null,
    demonstrated_retention_score: null,
    retention_evidence_count: 0,
    consecutive_qualifying_successes: 0,
    memory_stability: 'UNSTABLE',
    memory_status: 'NOT_ESTABLISHED',
    next_review_at: null,
    ...overrides,
  };
}

/** A minimal fake DbExecutor: single-row (2 params) or batch (1 param) concept_memory_state reads, both from the SAME `rows` fixture. */
function makeFakeClient(rows: ReturnType<typeof memoryRow>[]): DbExecutor {
  return {
    query: (async (_sql: string, params: any[] = []) => {
      if (params.length === 2) {
        const [, conceptId] = params;
        const row = rows.find((r) => r.concept_id === conceptId);
        return { rows: row ? [row] : [] };
      }
      return { rows };
    }) as any,
  };
}

describe('CROSS-SURFACE CONSISTENCY (Section 26)', () => {
  it('Phase 4 raw signal and Twin single-concept signal agree exactly on nextReviewAt/retrievabilityNow/forgettingRisk/memoryStatus for the same fixed state/time', async () => {
    const row = memoryRow({
      initial_competence_anchor_at: iso(-90),
      last_successful_retention_at: iso(-60),
      consecutive_qualifying_successes: 2,
      memory_stability: 'DEVELOPING',
      memory_status: 'DEVELOPING',
      next_review_at: iso(-1), // overdue as of NOW
    });
    const client = makeFakeClient([row]);

    const phase4Map = await getPhase4MemorySignalsForStudent(client, 's1', NOW);
    const twinSignal = await getTwinMemorySignal(client, 's1', 'c1', NOW);
    const phase4Signal = phase4Map.get('c1')!;

    expect(twinSignal).not.toBeNull();
    expect(twinSignal!.nextReviewAt).toBe(phase4Signal.nextReviewAt);
    expect(twinSignal!.retrievabilityNow).toBe(phase4Signal.retrievabilityNow);
    expect(twinSignal!.forgettingRisk).toBe(phase4Signal.forgettingRisk);
    expect(twinSignal!.memoryStatus).toBe(phase4Signal.memoryStatus);
    expect(twinSignal!.retentionDue).toBe(phase4Signal.retentionDue);
    expect(twinSignal!.daysOverdue).toBe(phase4Signal.daysOverdue);
  });

  it('the batch Twin reader and the single-concept Twin reader agree exactly for the same concept/time', async () => {
    const row = memoryRow({
      initial_competence_anchor_at: iso(-30),
      last_successful_retention_at: iso(-5),
      consecutive_qualifying_successes: 3,
      memory_stability: 'STABLE',
      memory_status: 'STABLE',
      next_review_at: iso(20),
    });
    const client = makeFakeClient([row]);

    const single = await getTwinMemorySignal(client, 's1', 'c1', NOW);
    const batch = await getTwinMemorySignalsForStudent(client, 's1', NOW);

    expect(single).toEqual(batch.get('c1'));
  });
});

describe('NULL / COLD-START REPRESENTATION (Section 27, no fallback, no fabricated zero)', () => {
  it('NO MEMORY STATE: Twin represents memory as unavailable, never retention=0/forgettingRisk=0', async () => {
    const client = makeFakeClient([]); // zero rows anywhere
    const signal = await getTwinMemorySignal(client, 's1', 'c1', NOW);
    expect(signal).toBeNull();

    const memory = toMemorySignal(signal);
    expect(memory.demonstratedRetentionScore).toBeNull();
    expect(memory.forgettingRisk).toBeNull();
    expect(memory.retrievabilityNow).toBeNull();
    expect(memory.nextReviewAt).toBeNull();
    expect(memory.memoryStatus).toBe('NOT_ESTABLISHED');
    expect(memory.policyVersion).toBeNull();
  });

  it('ANCHOR ONLY: memoryStatus=WAITING_FOR_RETENTION, demonstratedRetentionScore=null, retrievability may exist with LOW predictionConfidence, nextReviewAt exists', async () => {
    const row = memoryRow({
      initial_competence_anchor_at: iso(-10),
      memory_status: 'WAITING_FOR_RETENTION',
      next_review_at: iso(-7),
    });
    const client = makeFakeClient([row]);
    const signal = await getTwinMemorySignal(client, 's1', 'c1', NOW);
    const memory = toMemorySignal(signal);

    expect(memory.memoryStatus).toBe('WAITING_FOR_RETENTION');
    expect(memory.demonstratedRetentionScore).toBeNull();
    expect(memory.nextReviewAt).not.toBeNull();
    expect(memory.retrievabilityNow).not.toBeNull(); // anchor-based prediction exists
    expect(memory.predictionConfidence).toBe('LOW'); // no successful proof yet -- UNSTABLE
  });

  it('FIRST SUCCESS: DEVELOPING status, numeric demonstratedRetentionScore', async () => {
    const row = memoryRow({
      initial_competence_anchor_at: iso(-10),
      last_successful_retention_at: iso(-7),
      demonstrated_retention_score: 88,
      retention_evidence_count: 1,
      consecutive_qualifying_successes: 1,
      memory_stability: 'DEVELOPING',
      memory_status: 'DEVELOPING',
      next_review_at: iso(4),
    });
    const client = makeFakeClient([row]);
    const signal = await getTwinMemorySignal(client, 's1', 'c1', NOW);
    const memory = toMemorySignal(signal);

    expect(memory.memoryStatus).toBe('DEVELOPING');
    expect(memory.demonstratedRetentionScore).toBe(88);
  });

  it('STABLE: stable values across the board', async () => {
    const row = memoryRow({
      initial_competence_anchor_at: iso(-60),
      last_successful_retention_at: iso(-2),
      demonstrated_retention_score: 95,
      retention_evidence_count: 3,
      consecutive_qualifying_successes: 3,
      memory_stability: 'STABLE',
      memory_status: 'STABLE',
      next_review_at: iso(120), // 30 days after NOW (NOW = BASE + 90 days) -- genuinely not due yet
    });
    const client = makeFakeClient([row]);
    const signal = await getTwinMemorySignal(client, 's1', 'c1', NOW);
    const memory = toMemorySignal(signal);

    expect(memory.memoryStatus).toBe('STABLE');
    expect(memory.memoryStability).toBe('STABLE');
    expect(memory.demonstratedRetentionScore).toBe(95);
    expect(memory.retentionDue).toBe(false);
  });

  it('AT_RISK: status AT_RISK, historic demonstrated score retained, prediction kept separate', async () => {
    const row = memoryRow({
      initial_competence_anchor_at: iso(-60),
      last_successful_retention_at: iso(-40),
      last_unsuccessful_retention_at: iso(-2),
      demonstrated_retention_score: 42,
      retention_evidence_count: 2,
      consecutive_qualifying_successes: 0,
      memory_stability: 'UNSTABLE',
      memory_status: 'AT_RISK',
      next_review_at: iso(-1),
    });
    const client = makeFakeClient([row]);
    const signal = await getTwinMemorySignal(client, 's1', 'c1', NOW);
    const memory = toMemorySignal(signal);

    expect(memory.memoryStatus).toBe('AT_RISK');
    expect(memory.demonstratedRetentionScore).toBe(42); // the historic evidence-backed score is retained, not erased by the recent failure
    expect(memory.forgettingRisk).not.toBeNull(); // a separate, predicted signal
    expect(memory.retentionDue).toBe(true);
  });
});

describe('toRetentionSignal (Section 7/10/13): no legacy fallback, one canonical source', () => {
  it('null memorySignal -> forgettingRisk/nextReviewAt both null, retentionScore untouched', () => {
    const signal = toRetentionSignal(null, 77, null);
    expect(signal.retentionScore).toBe(77); // KS dimension, independent of memory availability
    expect(signal.forgettingRisk).toBeNull();
    expect(signal.nextReviewAt).toBeNull();
  });

  it('forgettingRisk/nextReviewAt map exactly from the Phase 6 memory signal, never a raw last-practiced timestamp (lastRetrievalAt was removed entirely in Step 6J-B2 -- zero readers anywhere)', () => {
    const memorySignal: TwinMemorySignal = {
      demonstratedRetentionScore: 90,
      retentionEvidenceCount: 2,
      memoryStatus: 'STABLE',
      memoryStability: 'STABLE',
      consecutiveQualifyingSuccesses: 2,
      initialCompetenceAnchorAt: iso(-30),
      lastQualifiedAttemptAt: iso(-2),
      lastSuccessfulRetentionAt: iso(-2),
      lastUnsuccessfulRetentionAt: null,
      nextReviewAt: iso(10),
      retentionDue: false,
      daysOverdue: null,
      retrievabilityNow: 95,
      forgettingRisk: 5,
      predictionConfidence: 'HIGH',
      policyVersion: 1,
    };
    const signal = toRetentionSignal(null, 90, memorySignal);
    expect(signal.forgettingRisk).toBe(5);
    expect(signal.nextReviewAt).toBe(iso(10));
  });
});

describe('KS RETENTION MIRROR vs PHASE 6 (Section 17)', () => {
  it('when both exist and are current, retention.retentionScore (KS mirror) equals memory.demonstratedRetentionScore (Phase 6), but each is read from its own independent source', () => {
    const memorySignal: TwinMemorySignal = {
      demonstratedRetentionScore: 88,
      retentionEvidenceCount: 2,
      memoryStatus: 'DEVELOPING',
      memoryStability: 'DEVELOPING',
      consecutiveQualifyingSuccesses: 1,
      initialCompetenceAnchorAt: iso(-10),
      lastQualifiedAttemptAt: iso(-3),
      lastSuccessfulRetentionAt: iso(-3),
      lastUnsuccessfulRetentionAt: null,
      nextReviewAt: iso(4),
      retentionDue: false,
      daysOverdue: null,
      retrievabilityNow: 90,
      forgettingRisk: 10,
      predictionConfidence: 'MEDIUM',
      policyVersion: 1,
    };
    // retentionDimension (3rd arg) simulates concept_knowledge_state.
    // retention_score, which Step 6G already mirrors verbatim from
    // Phase 6's demonstratedRetentionScore on every live recalculation --
    // here both happen to be 88, proving Twin exposes the SAME number
    // through two independently-read fields, never re-deriving one from
    // the other (memory.demonstratedRetentionScore comes only from
    // memorySignal; retention.retentionScore comes only from the KS
    // dimension parameter -- toRetentionSignal never reads memorySignal
    // for this field).
    const retention = toRetentionSignal(null, 88, memorySignal);
    const memory = toMemorySignal(memorySignal);
    expect(retention.retentionScore).toBe(memory.demonstratedRetentionScore);
    expect(retention.retentionScore).toBe(88);
  });
});

describe('SUBJECT AGGREGATE DENOMINATOR SEMANTICS (Section 5/28)', () => {
  function fakeSignal(overrides: Partial<TwinMemorySignal>): TwinMemorySignal {
    return {
      demonstratedRetentionScore: null,
      retentionEvidenceCount: 0,
      memoryStatus: 'NOT_ESTABLISHED',
      memoryStability: 'UNSTABLE',
      consecutiveQualifyingSuccesses: 0,
      initialCompetenceAnchorAt: null,
      lastQualifiedAttemptAt: null,
      lastSuccessfulRetentionAt: null,
      lastUnsuccessfulRetentionAt: null,
      nextReviewAt: null,
      retentionDue: false,
      daysOverdue: null,
      retrievabilityNow: null,
      forgettingRisk: null,
      predictionConfidence: 'LOW',
      policyVersion: 1,
      ...overrides,
    };
  }

  it('3 concepts (scores 80, 100, null): average is 90, never 60 -- null excluded from both sum and denominator', () => {
    const signals = [
      fakeSignal({ demonstratedRetentionScore: 80, memoryStatus: 'DEVELOPING' }),
      fakeSignal({ demonstratedRetentionScore: 100, memoryStatus: 'STABLE' }),
      fakeSignal({ demonstratedRetentionScore: null, memoryStatus: 'WAITING_FOR_RETENTION' }),
    ];
    const summary = aggregateSubjectMemorySummary(signals);
    expect(summary.avgDemonstratedRetentionScore).toBe(90);
    expect(summary.avgDemonstratedRetentionScore).not.toBe(60);
    expect(summary.conceptsWithMemoryState).toBe(3);
  });

  it('a concept with no concept_memory_state row at all is absent from the signals array entirely -- never silently treated as zero', () => {
    // Simulates a subject with 5 concepts total but only 2 having any
    // canonical memory state yet -- the caller passes only the 2 real signals.
    const signals = [fakeSignal({ demonstratedRetentionScore: 60 }), fakeSignal({ demonstratedRetentionScore: 80 })];
    const summary = aggregateSubjectMemorySummary(signals);
    expect(summary.avgDemonstratedRetentionScore).toBe(70);
    expect(summary.conceptsWithMemoryState).toBe(2); // NOT 5 -- the denominator is honest about what it actually averaged
  });

  it('status counts distinguish unknown/waiting/developing/stable/at-risk/due', () => {
    const signals = [
      fakeSignal({ memoryStatus: 'NOT_ESTABLISHED' }),
      fakeSignal({ memoryStatus: 'WAITING_FOR_RETENTION' }),
      fakeSignal({ memoryStatus: 'DEVELOPING' }),
      fakeSignal({ memoryStatus: 'STABLE' }),
      fakeSignal({ memoryStatus: 'AT_RISK' }),
      fakeSignal({ memoryStatus: 'STABLE', retentionDue: true }),
    ];
    const summary = aggregateSubjectMemorySummary(signals);
    expect(summary.notEstablishedCount).toBe(1);
    expect(summary.waitingForRetentionCount).toBe(1);
    expect(summary.developingConceptsCount).toBe(1);
    expect(summary.stableConceptsCount).toBe(2);
    expect(summary.conceptsAtRiskCount).toBe(1);
    expect(summary.conceptsDueCount).toBe(1);
  });

  it('aggregateMemoryOverview reports transparent counts only, never a fabricated global score', () => {
    const signals = [
      fakeSignal({ memoryStatus: 'STABLE' }),
      fakeSignal({ memoryStatus: 'AT_RISK', retentionDue: true }),
      fakeSignal({ memoryStatus: 'WAITING_FOR_RETENTION' }),
    ];
    const overview = aggregateMemoryOverview(signals);
    expect(overview).toEqual({
      conceptsDueCount: 1,
      conceptsAtRiskCount: 1,
      stableConceptsCount: 1,
      waitingForRetentionCount: 1,
      totalConceptsWithMemoryState: 3,
    });
    expect(overview).not.toHaveProperty('memoryScore');
  });
});
