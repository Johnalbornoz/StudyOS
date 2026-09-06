/**
 * Phase 7 -- Step 7C2: transfer-projector.service DB behavior.
 *
 * Mock client only (the caller's transaction connection). Asserts: one
 * unbounded canonical history query (ORDER BY timestamp ASC, id ASC),
 * a state read, an UPSERT with ON CONFLICT(student_id, concept_id),
 * semantic-noop write suppression, current-row strictness -> throw,
 * and that legacy production-shaped evidence never yields depth above
 * NEAR_DEMONSTRATED.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { projectConceptTransferState } from '@/services/transfer-projector.service';
import { setDecisionEventPersistenceForTests } from '@/lib/audit';

const FP = 'b'.repeat(64);
const S = 'stu-1';
const C = 'concept-1';

function meta(o: Record<string, unknown> = {}) {
  return { transferDistance: 'MID', assisted: false, transferTaskId: 'task-1', promptFingerprint: FP, sourceConceptId: C, ...o };
}
/** Certified (7D-shaped) evidence metadata. */
function certifiedMeta(o: Record<string, unknown> = {}) {
  return meta({ noveltyValidationPassed: true, noveltyDimensions: ['STRATEGY'], taskFamilyId: 'fam-1', ...o });
}

/** A mock client whose TRANSFER-history SELECT returns `history` and whose
 *  concept_transfer_state SELECT returns `existing` (0 or 1 row). */
function mockClient(history: any[], existing: any[] = []) {
  const calls: Array<{ sql: string; params: any[] }> = [];
  const query = vi.fn(async (sql: string, params: any[] = []) => {
    calls.push({ sql, params });
    const s = sql.replace(/\s+/g, ' ').trim();
    if (s.startsWith('SELECT id, timestamp, result, metadata FROM learning_evidence')) return { rows: history };
    if (s.includes('FROM concept_transfer_state')) return { rows: existing };
    if (s.startsWith('INSERT INTO concept_transfer_state')) return { rows: [] };
    if (s.startsWith('INSERT INTO decision_events')) return { rows: [] };
    throw new Error(`unmocked query: ${s}`);
  });
  return { client: { query } as any, calls, query };
}
const decisionEvents = (calls: Array<{ sql: string; params?: any[] }>) =>
  calls
    .filter((c) => /INSERT INTO decision_events/.test(c.sql))
    .map((c) => {
      const p = c.params!;
      // column order: decision_type, engine, engine_version, student_id, subject_id, concept_id, source_event_type, source_event_id, previous_state, new_state, reason_code, reason_details, ai_execution_id, metadata
      return {
        decisionType: p[0],
        engine: p[1],
        engineVersion: p[2],
        conceptId: p[5],
        sourceEventType: p[6],
        sourceEventId: p[7],
        previousState: p[8] ? JSON.parse(p[8]) : null,
        newState: p[9] ? JSON.parse(p[9]) : null,
        reasonCode: p[10],
      };
    });
const upserts = (calls: Array<{ sql: string; params?: any[] }>) => calls.filter((c) => /INSERT INTO concept_transfer_state/.test(c.sql));

describe('7C2 -- projector canonical read', () => {
  it('one unbounded history query, ordered by (timestamp ASC, id ASC), scoped to TRANSFER', async () => {
    const { client, calls } = mockClient([{ id: 'e1', timestamp: '2026-09-01T00:00:00Z', result: 'correct', metadata: meta() }]);
    await projectConceptTransferState(client, S, C, 'e1');
    const hist = calls.find((c) => /FROM learning_evidence/.test(c.sql))!;
    expect(hist.sql).toMatch(/source_type = 'TRANSFER'/);
    expect(hist.sql).toMatch(/ORDER BY timestamp ASC, id ASC/);
    expect(hist.sql).not.toMatch(/LIMIT/i);
    expect(hist.params).toEqual([S, C]);
  });
});

describe('7C2 -- projector UPSERT', () => {
  it('inserts concept_transfer_state via ON CONFLICT(student_id, concept_id) DO UPDATE when state changed', async () => {
    const { client, calls } = mockClient([{ id: 'e1', timestamp: '2026-09-01T00:00:00Z', result: 'correct', metadata: meta({ transferDistance: 'FAR' }) }]);
    const res = await projectConceptTransferState(client, S, C, 'e1');
    expect(res.stateChanged).toBe(true);
    const up = upserts(calls);
    expect(up).toHaveLength(1);
    expect(up[0].sql).toMatch(/ON CONFLICT \(student_id, concept_id\) DO UPDATE SET/);
    expect(up[0].sql).toMatch(/updated_at\s+=\s+NOW\(\)/);
  });

  it('legacy FAR-labelled production evidence -> persists transfer_depth NEAR_DEMONSTRATED, near count 1, distance NEAR', async () => {
    const { client, calls } = mockClient([{ id: 'e1', timestamp: '2026-09-01T00:00:00Z', result: 'correct', metadata: meta({ transferDistance: 'FAR' }) }]);
    await projectConceptTransferState(client, S, C, 'e1');
    const p = upserts(calls)[0].params!;
    // params order: student, concept, score, near, mid, far, dims[], lastAt, lastDist, depth, policyVersion
    expect(p[3]).toBe(1); // near
    expect([p[4], p[5]]).toEqual([0, 0]); // mid, far
    expect(p[6]).toEqual([]); // distinct novelty dims
    expect(p[8]).toBe('NEAR'); // last_successful_transfer_distance
    expect(p[9]).toBe('NEAR_DEMONSTRATED'); // transfer_depth
    expect(p[10]).toBe(2); // policy_version (7G1: bumped 1->2)
  });

  it('semantic no-op: replayed state == persisted state -> NO write', async () => {
    const history = [{ id: 'e1', timestamp: '2026-09-01T00:00:00Z', result: 'correct', metadata: meta({ transferDistance: 'MID' }) }];
    const existing = [{
      demonstrated_transfer_score: 100,
      near_transfer_success_count: 1, mid_transfer_success_count: 0, far_transfer_success_count: 0,
      distinct_novelty_dimensions_ok: [],
      last_successful_transfer_at: '2026-09-01T00:00:00.000Z',
      last_successful_transfer_distance: 'NEAR',
      transfer_depth: 'NEAR_DEMONSTRATED',
      policy_version: 2,
    }];
    const { client, calls } = mockClient(history, existing);
    const res = await projectConceptTransferState(client, S, C, 'e1');
    expect(res.stateChanged).toBe(false);
    expect(upserts(calls)).toHaveLength(0);
  });

  it('current row invariant violation -> throws (transaction will roll back)', async () => {
    const { client } = mockClient([
      { id: 'e1', timestamp: '2026-09-01T00:00:00Z', result: 'correct', metadata: meta({ promptFingerprint: 'not-canonical' }) },
    ]);
    await expect(projectConceptTransferState(client, S, C, 'e1')).rejects.toThrow(/INVALID_CURRENT_TRANSFER_EVIDENCE/);
  });

  it('historical malformed row is tolerated; only the CURRENT row is strict', async () => {
    const { client, calls } = mockClient([
      { id: 'old', timestamp: '2026-08-01T00:00:00Z', result: 'correct', metadata: { transferDistance: 'BOGUS' } }, // legacy, tolerated
      { id: 'e2', timestamp: '2026-09-01T00:00:00Z', result: 'correct', metadata: meta() }, // current, valid
    ]);
    const res = await projectConceptTransferState(client, S, C, 'e2');
    expect(res.state.transferDepth).toBe('NEAR_DEMONSTRATED'); // 2 legacy-style successes
    expect(res.state.nearTransferSuccessCount).toBe(2);
    expect(upserts(calls)).toHaveLength(1);
  });
});

describe('7D3 -- projector audit events (transfer-engine)', () => {
  beforeEach(() => setDecisionEventPersistenceForTests(true));
  afterEach(() => setDecisionEventPersistenceForTests(false));

  it('certified independent SUCCESS from NONE -> TRANSFER_EVIDENCE_QUALIFIED + TRANSFER_DEPTH_ADVANCED, engine transfer-engine v1', async () => {
    const { client, calls } = mockClient([
      { id: 'e1', timestamp: '2026-09-01T00:00:00Z', result: 'correct', metadata: certifiedMeta() },
    ]);
    await projectConceptTransferState(client, S, C, 'e1');
    const ev = decisionEvents(calls);
    expect(ev.map((e) => e.decisionType).sort()).toEqual(['TRANSFER_DEPTH_ADVANCED', 'TRANSFER_EVIDENCE_QUALIFIED']);
    for (const e of ev) {
      expect(e.engine).toBe('transfer-engine');
      expect(e.engineVersion).toBe('2'); // 7G1: engineVersion == TRANSFER_POLICY_VERSION
      expect(e.conceptId).toBe(C);
    }
    const qualified = ev.find((e) => e.decisionType === 'TRANSFER_EVIDENCE_QUALIFIED')!;
    expect(qualified.sourceEventType).toBe('learning_evidence');
    expect(qualified.sourceEventId).toBe('e1');
    const advanced = ev.find((e) => e.decisionType === 'TRANSFER_DEPTH_ADVANCED')!;
    expect(advanced.previousState).toEqual({ transferDepth: 'NONE' });
    expect(advanced.newState.transferDepth).not.toBe('NONE');
  });

  it('skipAudit -> emits nothing even on a real transition', async () => {
    const { client, calls } = mockClient([
      { id: 'e1', timestamp: '2026-09-01T00:00:00Z', result: 'correct', metadata: certifiedMeta() },
    ]);
    await projectConceptTransferState(client, S, C, 'e1', { skipAudit: true });
    expect(decisionEvents(calls)).toHaveLength(0);
    expect(upserts(calls)).toHaveLength(1); // state still written
  });

  it('backfill-style call (currentEvidenceId = null) -> emits nothing', async () => {
    const { client, calls } = mockClient([
      { id: 'e1', timestamp: '2026-09-01T00:00:00Z', result: 'correct', metadata: certifiedMeta() },
    ]);
    await projectConceptTransferState(client, S, C, null);
    expect(decisionEvents(calls)).toHaveLength(0);
  });

  it('legacy (non-certified) current SUCCESS -> NO TRANSFER_EVIDENCE_QUALIFIED, but TRANSFER_DEPTH_ADVANCED for the NONE->NEAR_DEMONSTRATED move', async () => {
    const { client, calls } = mockClient([
      { id: 'e1', timestamp: '2026-09-01T00:00:00Z', result: 'correct', metadata: meta({ transferDistance: 'MID' }) }, // no noveltyValidationPassed
    ]);
    await projectConceptTransferState(client, S, C, 'e1');
    const types = decisionEvents(calls).map((e) => e.decisionType);
    expect(types).toEqual(['TRANSFER_DEPTH_ADVANCED']);
  });

  it('a further certified NEAR success at an already-reached depth -> QUALIFIED only, no DEPTH_ADVANCED', async () => {
    const existing = [{
      demonstrated_transfer_score: 100,
      near_transfer_success_count: 1, mid_transfer_success_count: 0, far_transfer_success_count: 0,
      distinct_novelty_dimensions_ok: ['STRATEGY'],
      last_successful_transfer_at: '2026-09-01T00:00:00.000Z',
      last_successful_transfer_distance: 'NEAR',
      transfer_depth: 'NEAR_DEMONSTRATED',
      policy_version: 2,
    }];
    const { client, calls } = mockClient(
      [
        { id: 'e0', timestamp: '2026-09-01T00:00:00Z', result: 'correct', metadata: certifiedMeta({ transferDistance: 'NEAR', noveltyDimensions: ['CONTEXT'] }) },
        { id: 'e1', timestamp: '2026-09-02T00:00:00Z', result: 'correct', metadata: certifiedMeta({ transferDistance: 'NEAR', noveltyDimensions: ['CONTEXT'] }) },
      ],
      existing,
    );
    await projectConceptTransferState(client, S, C, 'e1');
    const types = decisionEvents(calls).map((e) => e.decisionType);
    expect(types).toEqual(['TRANSFER_EVIDENCE_QUALIFIED']);
  });

  it('current row is a FAILURE -> no audit events (and typically no state change)', async () => {
    const { client, calls } = mockClient([
      { id: 'e1', timestamp: '2026-09-01T00:00:00Z', result: 'incorrect', metadata: certifiedMeta() },
    ]);
    await projectConceptTransferState(client, S, C, 'e1');
    expect(decisionEvents(calls)).toHaveLength(0);
  });
});
