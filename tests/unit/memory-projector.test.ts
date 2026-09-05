/**
 * STUDYUS PHASE 6 -- RETENTION & MEMORY ENGINE
 * Step 6E: unit tests for src/services/memory-projector.service.ts
 * against a lightweight, in-memory fake DbExecutor -- no real database,
 * no mocked module boundaries around the real projector/pure model
 * (only @/lib/db's actual pool is never touched, since a fake client
 * object is always passed explicitly, exactly like the real
 * updateMastery integration will).
 *
 * decision_events persistence is enabled for this file only (the
 * codebase's own supported test escape hatch -- see
 * src/lib/audit/decision-events.ts) so the "no duplicate audit event"
 * assertions are meaningful.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { setDecisionEventPersistenceForTests } from '@/lib/audit';
import { projectConceptMemoryState } from '@/services/memory-projector.service';
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
  id: string,
  daysOffset: number,
  overrides: Partial<FakeEvidenceRow> = {}
): FakeEvidenceRow {
  return {
    id,
    student_id: 's1',
    concept_id: 'c1',
    activity_type: 'quiz', // the unreliable top-level column, matching real production shape
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

/** A minimal, deterministic fake DbExecutor covering exactly the SQL shapes memory-projector.service.ts issues. */
function makeFakeClient(evidenceRows: FakeEvidenceRow[], existingMemoryStateRow: Record<string, unknown> | null = null) {
  let currentRow = existingMemoryStateRow;
  const decisionEvents: Array<{ decisionType: string; reasonCode: string | null }> = [];
  const calls: string[] = [];

  const query = vi.fn(async (sql: string, params: any[] = []) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    calls.push(s);

    if (s.startsWith('SELECT') && s.includes('FROM learning_evidence')) {
      return { rows: evidenceRows };
    }
    if (s.startsWith('SELECT') && s.includes('FROM concept_memory_state')) {
      return { rows: currentRow ? [currentRow] : [] };
    }
    if (s.startsWith('INSERT INTO concept_memory_state')) {
      currentRow = {
        policy_version: params[2],
        initial_competence_anchor_at: params[3],
        last_qualified_attempt_at: params[4],
        last_successful_retention_at: params[5],
        last_unsuccessful_retention_at: params[6],
        demonstrated_retention_score: params[7],
        retention_evidence_count: params[8],
        consecutive_qualifying_successes: params[9],
        memory_stability: params[10],
        memory_status: params[11],
        next_review_at: params[12],
      };
      return { rows: [] };
    }
    if (s.startsWith('UPDATE concept_memory_state')) {
      currentRow = {
        policy_version: params[2],
        initial_competence_anchor_at: params[3],
        last_qualified_attempt_at: params[4],
        last_successful_retention_at: params[5],
        last_unsuccessful_retention_at: params[6],
        demonstrated_retention_score: params[7],
        retention_evidence_count: params[8],
        consecutive_qualifying_successes: params[9],
        memory_stability: params[10],
        memory_status: params[11],
        next_review_at: params[12],
      };
      return { rows: [] };
    }
    if (s.startsWith('INSERT INTO decision_events')) {
      decisionEvents.push({ decisionType: params[0], reasonCode: params[10] ?? null });
      return { rows: [] };
    }
    throw new Error(`Unmocked query in memory-projector test fake: ${s}`);
  });

  return { query: query as unknown as DbExecutor['query'], calls, decisionEvents, getCurrentRow: () => currentRow };
}

beforeAll(() => setDecisionEventPersistenceForTests(true));
afterAll(() => setDecisionEventPersistenceForTests(false));

describe('PROJECTOR EMPTY STATE', () => {
  it('one non-memory/practice evidence row -> concept_memory_state NOT_ESTABLISHED, inserted', async () => {
    const client = makeFakeClient([evidenceRow('e1', 0, { metadata: { activityType: 'PRACTICE' } })]);
    const result = await projectConceptMemoryState(client, 's1', 'c1');
    expect(result.state.memoryStatus).toBe('NOT_ESTABLISHED');
    expect(result.stateChanged).toBe(true); // no prior row existed -- a first NOT_ESTABLISHED row IS inserted
    expect(client.calls.some((c) => c.startsWith('INSERT INTO concept_memory_state'))).toBe(true);
  });
});

describe('ANCHOR', () => {
  it('new qualifying anchor evidence -> WAITING_FOR_RETENTION, nextReviewAt +3d', async () => {
    const client = makeFakeClient([evidenceRow('e1', 0)]);
    const result = await projectConceptMemoryState(client, 's1', 'c1');
    expect(result.state.memoryStatus).toBe('WAITING_FOR_RETENTION');
    expect(result.state.nextReviewAt).toBe(iso(3));
    expect(result.diagnostics.qualifiedRetentionAttemptCount).toBe(0);
  });
});

describe('EARLY ATTEMPT', () => {
  it('anchor + retention attempt before 3d -> no qualified attempt increment', async () => {
    const client = makeFakeClient([evidenceRow('e1', 0), evidenceRow('e2', 2)]);
    const result = await projectConceptMemoryState(client, 's1', 'c1');
    expect(result.diagnostics.qualifiedRetentionAttemptCount).toBe(0);
    expect(result.state.memoryStatus).toBe('WAITING_FOR_RETENTION');
  });
});

describe('SUCCESS', () => {
  it('qualified success -> DEVELOPING, correct timestamps/streak/score/review', async () => {
    const client = makeFakeClient([evidenceRow('e1', 0), evidenceRow('e2', 3, { score_percent: 88 })]);
    const result = await projectConceptMemoryState(client, 's1', 'c1');
    expect(result.state.memoryStatus).toBe('DEVELOPING');
    expect(result.state.consecutiveQualifyingSuccesses).toBe(1);
    expect(result.state.lastSuccessfulRetentionAt).toBe(iso(3));
    expect(result.state.demonstratedRetentionScore).toBe(88);
    expect(result.state.nextReviewAt).toBe(iso(3 + 4));
    expect(result.diagnostics.qualifiedRetentionAttemptCount).toBe(1);
  });
});

describe('PARTIAL', () => {
  it('-> AT_RISK, unsuccessful timestamp set, success timestamp preserved, +3d review', async () => {
    const client = makeFakeClient([evidenceRow('e1', 0), evidenceRow('e2', 3, { result: 'partial', score_percent: 55 })]);
    const result = await projectConceptMemoryState(client, 's1', 'c1');
    expect(result.state.memoryStatus).toBe('AT_RISK');
    expect(result.state.lastUnsuccessfulRetentionAt).toBe(iso(3));
    expect(result.state.lastSuccessfulRetentionAt).toBeNull();
    expect(result.state.nextReviewAt).toBe(iso(3 + 3));
  });
});

describe('FAILURE', () => {
  it('same structural state transition as PARTIAL', async () => {
    const client = makeFakeClient([evidenceRow('e1', 0), evidenceRow('e2', 3, { result: 'incorrect', score_percent: 15 })]);
    const result = await projectConceptMemoryState(client, 's1', 'c1');
    expect(result.state.memoryStatus).toBe('AT_RISK');
    expect(result.state.lastUnsuccessfulRetentionAt).toBe(iso(3));
    expect(result.state.lastSuccessfulRetentionAt).toBeNull();
    expect(result.state.nextReviewAt).toBe(iso(3 + 3));
  });
});

describe('RECOVERY', () => {
  it('failure followed after minimum gap by success -> DEVELOPING, streak 1', async () => {
    const client = makeFakeClient([
      evidenceRow('e1', 0),
      evidenceRow('e2', 3, { result: 'incorrect', score_percent: 10 }),
      evidenceRow('e3', 6, { result: 'correct', score_percent: 90 }),
    ]);
    const result = await projectConceptMemoryState(client, 's1', 'c1');
    expect(result.state.memoryStatus).toBe('DEVELOPING');
    expect(result.state.consecutiveQualifyingSuccesses).toBe(1);
  });
});

describe('RAW ACTIVITY SOURCE', () => {
  it('top-level activity_type cannot affect qualification -- only metadata.activityType matters', async () => {
    const client = makeFakeClient([
      evidenceRow('e1', 0, { activity_type: 'RETENTION_CHECK', metadata: { activityType: 'PRACTICE' } }), // top-level says RETENTION_CHECK, real (metadata) says PRACTICE
      evidenceRow('e2', 3, { activity_type: 'quiz', metadata: { activityType: 'RETENTION_CHECK' } }),
    ]);
    const result = await projectConceptMemoryState(client, 's1', 'c1');
    // e1 is really PRACTICE (per metadata) -> cannot set the anchor, despite its misleading top-level column.
    // Therefore e2 (the real RETENTION_CHECK) becomes the ANCHOR event itself, not a qualified attempt yet.
    expect(result.state.memoryStatus).toBe('WAITING_FOR_RETENTION');
    expect(result.state.initialCompetenceAnchorAt).toBe(iso(3));
  });
});

describe('INVALID METADATA', () => {
  it('invalid historical row is ignored/fails closed -- valid evidence still projects correctly, diagnostics count the invalid row', async () => {
    const client = makeFakeClient([
      evidenceRow('bad1', -10, { metadata: null }), // missing metadata.activityType
      evidenceRow('bad2', -5, { metadata: { activityType: 'NOT_A_REAL_TYPE' } }), // unknown
      evidenceRow('e1', 0),
      evidenceRow('e2', 3, { score_percent: 92 }),
    ]);
    const result = await projectConceptMemoryState(client, 's1', 'c1');
    expect(result.state.memoryStatus).toBe('DEVELOPING'); // valid evidence still projects correctly
    expect(result.diagnostics.totalEvidenceRows).toBe(4);
    expect(result.diagnostics.invalidMemoryEvidenceRows).toBe(2);
    expect(result.diagnostics.validMemoryEvidenceRows).toBe(2);
    expect(result.diagnostics.invalidReasonCounts.MISSING_METADATA_ACTIVITY_TYPE).toBe(1);
    expect(result.diagnostics.invalidReasonCounts.UNKNOWN_ACTIVITY_TYPE).toBe(1);
  });
});

describe('NO-CHANGE', () => {
  it('unrelated evidence that leaves state identical -> no UPDATE, no duplicate audit event', async () => {
    const client = makeFakeClient([evidenceRow('e1', 0)]);
    const first = await projectConceptMemoryState(client, 's1', 'c1');
    expect(first.stateChanged).toBe(true);
    expect(client.decisionEvents).toHaveLength(1);

    // Re-project with the EXACT same evidence set (simulating an
    // unrelated concurrent projection, or a defensive re-run) --
    // nothing new happened, so nothing should change or re-audit.
    client.calls.length = 0;
    const second = await projectConceptMemoryState(client, 's1', 'c1');
    expect(second.stateChanged).toBe(false);
    expect(second.state).toEqual(first.state);
    expect(client.calls.some((c) => c.startsWith('UPDATE concept_memory_state'))).toBe(false);
    expect(client.calls.some((c) => c.startsWith('INSERT INTO concept_memory_state'))).toBe(false);
    expect(client.decisionEvents).toHaveLength(1); // still just the one from the first projection -- no duplicate
  });
});

describe('IDEMPOTENCY', () => {
  it('the same canonical evidence set replayed twice produces the exact same semantic state', async () => {
    const rows = [evidenceRow('e1', 0), evidenceRow('e2', 3, { score_percent: 90 }), evidenceRow('e3', 7, { score_percent: 95 })];
    const clientA = makeFakeClient(rows);
    const clientB = makeFakeClient(rows);
    const resultA = await projectConceptMemoryState(clientA, 's1', 'c1');
    const resultB = await projectConceptMemoryState(clientB, 's1', 'c1');
    expect(resultA.state).toEqual(resultB.state);
  });
});
