/**
 * STUDYUS PHASE 6 -- RETENTION & MEMORY ENGINE
 * Step 6J-B1: migrate remaining live legacy memory consumers -- test
 * matrix for the new canonical read boundary
 * (getCanonicalMemorySignal/getCanonicalMemorySignalsForStudent) and
 * cross-surface consistency with the Phase 4 and Twin readers built in
 * Steps 6H-B/6I. Uses a shared fake DbExecutor -- no real database.
 */
import { describe, it, expect } from 'vitest';
import {
  getCanonicalMemorySignal,
  getCanonicalMemorySignalsForStudent,
  getPhase4MemorySignalsForStudent,
  getTwinMemorySignal,
} from '@/services/memory-read.service';
import type { DbExecutor } from '@/lib/db';

const DAY = 24 * 60 * 60 * 1000;
const BASE = '2026-01-01T00:00:00.000Z';
const iso = (offsetDays: number) => new Date(new Date(BASE).getTime() + offsetDays * DAY).toISOString();
const NOW = new Date(new Date(BASE).getTime() + 90 * DAY);

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

describe('CANONICAL MEMORY SIGNAL -- no priority/activity/rank fields', () => {
  it('CanonicalMemorySignal exposes only the neutral predictive slice', async () => {
    const row = memoryRow({
      initial_competence_anchor_at: iso(-30),
      last_successful_retention_at: iso(-5),
      consecutive_qualifying_successes: 2,
      memory_stability: 'DEVELOPING',
      memory_status: 'DEVELOPING',
      next_review_at: iso(10),
    });
    const client = makeFakeClient([row]);
    const signal = await getCanonicalMemorySignal(client, 's1', 'c1', NOW);
    expect(signal).not.toBeNull();
    expect(Object.keys(signal!).sort()).toEqual(
      ['retrievabilityNow', 'forgettingRisk', 'lastSuccessfulRetentionAt', 'memoryStatus', 'predictionConfidence', 'policyVersion'].sort()
    );
  });

  it('missing concept_memory_state row returns null -- no fallback, no fabricated zero', async () => {
    const client = makeFakeClient([]);
    const signal = await getCanonicalMemorySignal(client, 's1', 'c1', NOW);
    expect(signal).toBeNull();
  });
});

describe('CROSS-SURFACE CONSISTENCY (Section 22) -- one canonical formula everywhere', () => {
  it('getCanonicalMemorySignal, getPhase4MemorySignalsForStudent, and getTwinMemorySignal agree exactly for the same fixed state/time', async () => {
    const row = memoryRow({
      initial_competence_anchor_at: iso(-90),
      last_successful_retention_at: iso(-60),
      consecutive_qualifying_successes: 2,
      memory_stability: 'DEVELOPING',
      memory_status: 'DEVELOPING',
      next_review_at: iso(-1),
    });
    const client = makeFakeClient([row]);

    const canonical = await getCanonicalMemorySignal(client, 's1', 'c1', NOW);
    const phase4Map = await getPhase4MemorySignalsForStudent(client, 's1', NOW);
    const twin = await getTwinMemorySignal(client, 's1', 'c1', NOW);
    const phase4 = phase4Map.get('c1')!;

    expect(canonical!.forgettingRisk).toBe(phase4.forgettingRisk);
    expect(canonical!.forgettingRisk).toBe(twin!.forgettingRisk);
    expect(canonical!.retrievabilityNow).toBe(phase4.retrievabilityNow);
    expect(canonical!.retrievabilityNow).toBe(twin!.retrievabilityNow);
    expect(canonical!.memoryStatus).toBe(phase4.memoryStatus);
    expect(canonical!.memoryStatus).toBe(twin!.memoryStatus);
    expect(canonical!.lastSuccessfulRetentionAt).toBe(twin!.lastSuccessfulRetentionAt);
  });

  it('the batch and single-concept canonical readers agree exactly for the same concept', async () => {
    const row = memoryRow({
      initial_competence_anchor_at: iso(-20),
      last_successful_retention_at: iso(-3),
      consecutive_qualifying_successes: 3,
      memory_stability: 'STABLE',
      memory_status: 'STABLE',
      next_review_at: iso(40),
    });
    const client = makeFakeClient([row]);
    const single = await getCanonicalMemorySignal(client, 's1', 'c1', NOW);
    const batch = await getCanonicalMemorySignalsForStudent(client, 's1', NOW);
    expect(single).toEqual(batch.get('c1'));
  });
});

describe('EXPECTED SEMANTIC DIFFERENCE (Section 23) -- legacy vs Phase 6 authority', () => {
  it('a concept with an old/absent Phase 6 successful-retention proof reports predictionConfidence=LOW and lastSuccessfulRetentionAt=null, regardless of what a legacy mastery_records-based signal would have said', async () => {
    // Simulates: legacy mastery_records.last_practiced is recent and
    // confidence is high (a real, live scenario this test does not need
    // to construct here, since the legacy formula is untouched and
    // lives entirely outside memory-read.service.ts) -- but Phase 6 has
    // never recorded a genuine QUALIFIED retention success for this
    // concept (anchor only, no successful proof yet).
    const row = memoryRow({
      initial_competence_anchor_at: iso(-45),
      last_successful_retention_at: null, // no genuine retention proof, however recent legacy "practice" might have been
      memory_status: 'WAITING_FOR_RETENTION',
      next_review_at: iso(-42),
    });
    const client = makeFakeClient([row]);
    const signal = await getCanonicalMemorySignal(client, 's1', 'c1', NOW);

    expect(signal!.lastSuccessfulRetentionAt).toBeNull();
    expect(signal!.predictionConfidence).toBe('LOW');
    // A real, numeric forgettingRisk still exists (anchor-based
    // prediction) -- this is NOT the same as "no signal at all"; it is
    // simply LOW-confidence, which Learning Debt/Subject/Topic must
    // still treat as a real (if uncertain) Phase 6 number, never as
    // "assume worst case" or "assume best case".
    expect(typeof signal!.forgettingRisk).toBe('number');
  });
});
