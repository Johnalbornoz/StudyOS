/**
 * STUDYUS PHASE 6 -- RETENTION & MEMORY ENGINE
 * Step 6F: unit tests for src/services/memory-backfill.service.ts
 * against a lightweight, in-memory fake DbExecutor covering
 * learning_evidence, concept_memory_state, and backfill_runs -- no
 * real database. decision_events is deliberately NOT modeled as a
 * writable table here: any query touching it throws, which is how
 * "backfill never fabricates historical decision_events" is proven.
 * Likewise mastery_records / concept_knowledge_state / validation_cycles
 * are not modeled -- any query touching them would throw too, proving
 * backfill never touches them.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runMemoryStateBackfill, getMemoryBackfillRun } from '@/services/memory-backfill.service';
import type { DbExecutor } from '@/lib/db';

const DAY = 24 * 60 * 60 * 1000;
const BASE = '2026-01-01T00:00:00.000Z';
const iso = (offsetDays: number) => new Date(new Date(BASE).getTime() + offsetDays * DAY).toISOString();

interface FakeEvidenceRow {
  id: string;
  student_id: string;
  concept_id: string;
  activity_type: string | null;
  result: 'correct' | 'incorrect' | 'partial';
  score_percent: number | null;
  timestamp: string;
  ai_assistance_type: string;
  hints_used: number;
  operation_key: string | null;
  difficulty: number | null;
  metadata: Record<string, unknown> | null;
}

function evidenceRow(
  studentId: string,
  conceptId: string,
  id: string,
  daysOffset: number,
  overrides: Partial<FakeEvidenceRow> = {}
): FakeEvidenceRow {
  return {
    id,
    student_id: studentId,
    concept_id: conceptId,
    activity_type: 'quiz',
    result: 'correct',
    score_percent: 100,
    timestamp: iso(daysOffset),
    ai_assistance_type: 'NONE',
    hints_used: 0,
    operation_key: `op-${id}`,
    difficulty: 3,
    metadata: { activityType: 'RETENTION_CHECK' },
    ...overrides,
  };
}

/** A minimal, deterministic fake DbExecutor modeling learning_evidence, concept_memory_state, and backfill_runs only. */
function makeFakeDb(evidenceRows: FakeEvidenceRow[]) {
  const memoryStates = new Map<string, Record<string, unknown>>();
  const backfillRuns = new Map<string, any>();
  let nextRunId = 1;
  const calls: string[] = [];

  const key = (s: string, c: string) => `${s}|${c}`;

  const query = (async (sql: string, params: any[] = []) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    calls.push(s);

    if (s.startsWith('SELECT DISTINCT student_id, concept_id FROM learning_evidence')) {
      const [studentFilter, limit, cursorStudent, cursorConcept] = params;
      const pairs = Array.from(
        new Map(evidenceRows.map((r) => [key(r.student_id, r.concept_id), { student_id: r.student_id, concept_id: r.concept_id }])).values()
      );
      pairs.sort((a, b) => (a.student_id === b.student_id ? a.concept_id.localeCompare(b.concept_id) : a.student_id.localeCompare(b.student_id)));
      let filtered = studentFilter ? pairs.filter((p) => p.student_id === studentFilter) : pairs;
      if (cursorStudent) {
        filtered = filtered.filter((p) => p.student_id > cursorStudent || (p.student_id === cursorStudent && p.concept_id > cursorConcept));
      }
      return { rows: filtered.slice(0, limit) };
    }
    if (s.startsWith('SELECT id, student_id, concept_id, activity_type') && s.includes('FROM learning_evidence')) {
      const [studentId, conceptId] = params;
      return { rows: evidenceRows.filter((r) => r.student_id === studentId && r.concept_id === conceptId) };
    }
    if (s.startsWith('SELECT') && s.includes('FROM concept_memory_state')) {
      const [studentId, conceptId] = params;
      const row = memoryStates.get(key(studentId, conceptId));
      return { rows: row ? [row] : [] };
    }
    if (s.startsWith('INSERT INTO concept_memory_state')) {
      const [studentId, conceptId, ...rest] = params;
      memoryStates.set(key(studentId, conceptId), {
        policy_version: rest[0],
        initial_competence_anchor_at: rest[1],
        last_qualified_attempt_at: rest[2],
        last_successful_retention_at: rest[3],
        last_unsuccessful_retention_at: rest[4],
        demonstrated_retention_score: rest[5],
        retention_evidence_count: rest[6],
        consecutive_qualifying_successes: rest[7],
        memory_stability: rest[8],
        memory_status: rest[9],
        next_review_at: rest[10],
      });
      return { rows: [] };
    }
    if (s.startsWith('UPDATE concept_memory_state')) {
      const [studentId, conceptId, ...rest] = params;
      memoryStates.set(key(studentId, conceptId), {
        policy_version: rest[0],
        initial_competence_anchor_at: rest[1],
        last_qualified_attempt_at: rest[2],
        last_successful_retention_at: rest[3],
        last_unsuccessful_retention_at: rest[4],
        demonstrated_retention_score: rest[5],
        retention_evidence_count: rest[6],
        consecutive_qualifying_successes: rest[7],
        memory_stability: rest[8],
        memory_status: rest[9],
        next_review_at: rest[10],
      });
      return { rows: [] };
    }
    if (s.startsWith('INSERT INTO backfill_runs')) {
      const [dryRun, studentFilter, metricsJson] = params;
      const id = `run-${nextRunId++}`;
      backfillRuns.set(id, {
        id,
        kind: 'MEMORY_STATE',
        status: 'RUNNING',
        dry_run: dryRun,
        student_filter: studentFilter,
        metrics: JSON.parse(metricsJson),
        cursor_student_id: null,
        cursor_concept_id: null,
      });
      return { rows: [{ id }] };
    }
    if (s.startsWith('SELECT metrics, cursor_student_id, cursor_concept_id, status FROM backfill_runs')) {
      const [id] = params;
      const row = backfillRuns.get(id);
      return { rows: row ? [row] : [] };
    }
    if (s.startsWith('UPDATE backfill_runs SET')) {
      const [id, metricsJson, cursorStudentId, cursorConceptId, status] = params;
      const row = backfillRuns.get(id);
      if (row) {
        row.metrics = JSON.parse(metricsJson);
        row.cursor_student_id = cursorStudentId;
        row.cursor_concept_id = cursorConceptId;
        row.status = status;
      }
      return { rows: [] };
    }
    if (s.startsWith('SELECT * FROM backfill_runs')) {
      const [id] = params;
      const row = backfillRuns.get(id);
      return { rows: row ? [row] : [] };
    }
    throw new Error(`Unmocked query in memory-backfill test fake: ${s}`);
  }) as unknown as DbExecutor['query'];

  return { query, calls, getMemoryState: (s: string, c: string) => memoryStates.get(key(s, c)), memoryStates, backfillRuns };
}

// The backfill service imports the global `db` pool directly (matching
// knowledge-state-backfill.service.ts's own convention), so we mock
// '@/lib/db' to redirect its `query` to whichever fake is active.
let activeFake: ReturnType<typeof makeFakeDb>;
vi.mock('@/lib/db', async () => {
  const actual = await vi.importActual<typeof import('@/lib/db')>('@/lib/db');
  return {
    ...actual,
    db: { query: (...args: any[]) => (activeFake.query as any)(...args) },
  };
});

beforeEach(() => {
  activeFake = undefined as any;
});

describe('DRY_RUN DEFAULT', () => {
  it('dryRun defaults to true when omitted -- zero concept_memory_state writes', async () => {
    activeFake = makeFakeDb([evidenceRow('s1', 'c1', 'e1', 0), evidenceRow('s1', 'c1', 'e2', 3, { score_percent: 90 })]);
    const result = await runMemoryStateBackfill({});
    expect(result.dryRun).toBe(true);
    expect(activeFake.calls.some((c) => c.startsWith('INSERT INTO concept_memory_state'))).toBe(false);
    expect(activeFake.calls.some((c) => c.startsWith('UPDATE concept_memory_state'))).toBe(false);
    expect(activeFake.memoryStates.size).toBe(0);
    expect(result.metrics.pairsScanned).toBe(1);
    expect(result.metrics.statusCounts.DEVELOPING).toBe(1);
  });

  it('never issues a decision_events write in dry-run mode', async () => {
    activeFake = makeFakeDb([evidenceRow('s1', 'c1', 'e1', 0)]);
    await runMemoryStateBackfill({});
    expect(activeFake.calls.some((c) => c.includes('decision_events'))).toBe(false);
  });
});

describe('WRITE MODE', () => {
  it('populates concept_memory_state matching the dry-run prediction, with zero decision_events', async () => {
    const rows = [evidenceRow('s1', 'c1', 'e1', 0), evidenceRow('s1', 'c1', 'e2', 3, { score_percent: 90 })];

    activeFake = makeFakeDb(rows);
    const dryRun = await runMemoryStateBackfill({ dryRun: true });

    activeFake = makeFakeDb(rows);
    const write = await runMemoryStateBackfill({ dryRun: false });

    expect(write.dryRun).toBe(false);
    expect(write.metrics.statusCounts).toEqual(dryRun.metrics.statusCounts);
    expect(write.metrics.anchorsEstablished).toBe(dryRun.metrics.anchorsEstablished);
    expect(write.metrics.rowsWritten).toBe(1);
    expect(activeFake.getMemoryState('s1', 'c1')?.memory_status).toBe('DEVELOPING');
    expect(activeFake.calls.some((c) => c.includes('decision_events'))).toBe(false);
  });

  it('second WRITE run over the same evidence is semantically idempotent -- no additional writes', async () => {
    const rows = [evidenceRow('s1', 'c1', 'e1', 0), evidenceRow('s1', 'c1', 'e2', 3, { score_percent: 90 })];
    activeFake = makeFakeDb(rows);

    const first = await runMemoryStateBackfill({ dryRun: false });
    expect(first.metrics.rowsWritten).toBe(1);
    const stateAfterFirst = { ...activeFake.getMemoryState('s1', 'c1') };

    activeFake.calls.length = 0;
    const second = await runMemoryStateBackfill({ dryRun: false });
    expect(second.metrics.rowsWritten).toBe(0); // nothing changed -- no UPDATE, no re-INSERT
    expect(activeFake.calls.some((c) => c.startsWith('INSERT INTO concept_memory_state'))).toBe(false);
    expect(activeFake.calls.some((c) => c.startsWith('UPDATE concept_memory_state'))).toBe(false);
    expect(activeFake.getMemoryState('s1', 'c1')).toEqual(stateAfterFirst);
  });

  it('never touches learning_evidence, mastery_records, concept_knowledge_state, or validation_cycles as writes', async () => {
    activeFake = makeFakeDb([evidenceRow('s1', 'c1', 'e1', 0)]);
    await runMemoryStateBackfill({ dryRun: false });
    const forbiddenWritePatterns = [
      /INSERT INTO learning_evidence/,
      /UPDATE learning_evidence/,
      /DELETE FROM learning_evidence/,
      /mastery_records/,
      /concept_knowledge_state/,
      /validation_cycles/,
    ];
    for (const call of activeFake.calls) {
      for (const pattern of forbiddenWritePatterns) {
        expect(call).not.toMatch(pattern);
      }
    }
  });
});

describe('RESUMABILITY', () => {
  it('stopping and resuming with a small batch size yields the same final state as one full pass', async () => {
    const rows = [
      evidenceRow('s1', 'c1', 'e1', 0),
      evidenceRow('s1', 'c1', 'e2', 3, { score_percent: 90 }),
      evidenceRow('s1', 'c2', 'e3', 0),
      evidenceRow('s2', 'c1', 'e4', 0, { result: 'incorrect', score_percent: 20 }),
    ];

    // Single-pass reference run.
    activeFake = makeFakeDb(rows);
    await runMemoryStateBackfill({ dryRun: false, batchSize: 500 });
    const referenceStates = new Map(activeFake.memoryStates);

    // Batched, resumed run (batchSize=1 forces 3+ calls).
    activeFake = makeFakeDb(rows);
    let result = await runMemoryStateBackfill({ dryRun: false, batchSize: 1 });
    let iterations = 1;
    while (!result.done && iterations < 20) {
      result = await runMemoryStateBackfill({ dryRun: false, batchSize: 1, runId: result.runId });
      iterations++;
    }
    expect(result.done).toBe(true);
    expect(activeFake.memoryStates.size).toBe(referenceStates.size);
    for (const [pairKey, state] of referenceStates) {
      expect(activeFake.memoryStates.get(pairKey)).toEqual(state);
    }

    const run = await getMemoryBackfillRun(result.runId);
    expect(run.status).toBe('COMPLETED');
  });
});

describe('INVALID EVIDENCE FAILS CLOSED', () => {
  it('invalid rows are excluded from qualification, counted in diagnostics, never crash the batch', async () => {
    activeFake = makeFakeDb([
      evidenceRow('s1', 'c1', 'bad1', -10, { metadata: null }),
      evidenceRow('s1', 'c1', 'bad2', -5, { metadata: { activityType: 'NOT_A_REAL_TYPE' } }),
      evidenceRow('s1', 'c1', 'e1', 0),
      evidenceRow('s1', 'c1', 'e2', 3, { score_percent: 92 }),
    ]);
    const result = await runMemoryStateBackfill({});
    expect(result.metrics.errors).toBe(0);
    expect(result.metrics.totalEvidenceRows).toBe(4);
    expect(result.metrics.invalidEvidenceRows).toBe(2);
    expect(result.metrics.validEvidenceRows).toBe(2);
    expect(result.metrics.invalidReasonCounts.MISSING_METADATA_ACTIVITY_TYPE).toBe(1);
    expect(result.metrics.invalidReasonCounts.UNKNOWN_ACTIVITY_TYPE).toBe(1);
    expect(result.metrics.statusCounts.DEVELOPING).toBe(1);
  });

  it('a pair with evidence but zero usable Phase 6 evidence resolves to NOT_ESTABLISHED, not an error', async () => {
    activeFake = makeFakeDb([evidenceRow('s1', 'c1', 'e1', 0, { metadata: { activityType: 'PRACTICE' } })]);
    const result = await runMemoryStateBackfill({});
    expect(result.metrics.errors).toBe(0);
    expect(result.metrics.statusCounts.NOT_ESTABLISHED).toBe(1);
  });
});

describe('MULTI-PAIR DISTRIBUTION', () => {
  it('aggregates statusCounts and anchorsEstablished correctly across several pairs', async () => {
    activeFake = makeFakeDb([
      evidenceRow('s1', 'c1', 'e1', 0), // anchor only -> WAITING_FOR_RETENTION
      evidenceRow('s1', 'c2', 'e2', 0, { metadata: { activityType: 'PRACTICE' } }), // -> NOT_ESTABLISHED
      evidenceRow('s2', 'c1', 'e3', 0),
      evidenceRow('s2', 'c1', 'e4', 3, { score_percent: 95 }), // -> DEVELOPING
    ]);
    const result = await runMemoryStateBackfill({});
    expect(result.metrics.pairsScanned).toBe(3);
    expect(result.metrics.studentsScanned).toBe(2);
    expect(result.metrics.statusCounts.WAITING_FOR_RETENTION).toBe(1);
    expect(result.metrics.statusCounts.NOT_ESTABLISHED).toBe(1);
    expect(result.metrics.statusCounts.DEVELOPING).toBe(1);
    expect(result.metrics.anchorsEstablished).toBe(2); // c1 pairs both got an anchor; c2 (PRACTICE-only) did not
  });
});
