/**
 * Phase 7 -- Step 7C3: historical Transfer State backfill.
 *
 * In-memory fake DB (learning_evidence TRANSFER rows + concept_transfer_state
 * + backfill_runs). Covers: dry-run zero writes, write insert/update/
 * skip, second-run idempotency, resume == uninterrupted, race with a
 * concurrent live write (no regression), same-model equivalence with
 * the live projector, score cross-check, legacy depth ceiling.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- fake DB -------------------------------------------------------
type Evi = { id: string; student_id: string; concept_id: string; source_type: string; timestamp: string; result: string; metadata: any };

function makeFake(evidence: Evi[]) {
  const cts = new Map<string, any>(); // key `${s}|${c}` -> row
  const runs = new Map<string, any>();
  let runSeq = 0;
  const key = (s: string, c: string) => `${s}|${c}`;

  async function handle(sql: string, params: any[] = []): Promise<{ rows: any[]; rowCount: number }> {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(s)) return { rows: [], rowCount: 0 };

    if (s.startsWith('SELECT DISTINCT student_id, concept_id FROM learning_evidence')) {
      const [studentFilter, limit, curS, curC] = params;
      let pairs = Array.from(new Set(evidence.filter((e) => e.source_type === 'TRANSFER').map((e) => key(e.student_id, e.concept_id)))).map((k) => {
        const [student_id, concept_id] = k.split('|');
        return { student_id, concept_id };
      });
      if (studentFilter) pairs = pairs.filter((p) => p.student_id === studentFilter);
      pairs.sort((a, b) => (a.student_id + a.concept_id).localeCompare(b.student_id + b.concept_id));
      if (curS) pairs = pairs.filter((p) => a_gt(p.student_id, p.concept_id, curS, curC));
      return { rows: pairs.slice(0, limit), rowCount: Math.min(pairs.length, limit) };
    }

    if (s.startsWith('INSERT INTO backfill_runs')) {
      const id = `run-${++runSeq}`;
      runs.set(id, { id, kind: 'TRANSFER_STATE', status: 'RUNNING', dry_run: params[0], metrics: JSON.parse(params[2]), cursor_student_id: null, cursor_concept_id: null });
      return { rows: [{ id }], rowCount: 1 };
    }
    if (s.startsWith('SELECT metrics, cursor_student_id, cursor_concept_id, status FROM backfill_runs')) {
      const r = runs.get(params[0]);
      return { rows: r ? [{ metrics: r.metrics, cursor_student_id: r.cursor_student_id, cursor_concept_id: r.cursor_concept_id, status: r.status }] : [], rowCount: r ? 1 : 0 };
    }
    if (s.startsWith('UPDATE backfill_runs SET metrics')) {
      const r = runs.get(params[0]);
      if (r) { r.metrics = JSON.parse(params[1]); r.cursor_student_id = params[2]; r.cursor_concept_id = params[3]; r.status = params[4]; }
      return { rows: [], rowCount: 0 };
    }
    if (s.startsWith('UPDATE backfill_runs SET status')) return { rows: [], rowCount: 0 };
    if (s.startsWith('SELECT * FROM backfill_runs')) {
      const r = runs.get(params[0]);
      return { rows: r ? [r] : [], rowCount: r ? 1 : 0 };
    }

    if (s.startsWith('SELECT id, timestamp, result, metadata FROM learning_evidence')) {
      const [sid, cid] = params;
      const rows = evidence
        .filter((e) => e.student_id === sid && e.concept_id === cid && e.source_type === 'TRANSFER')
        .sort((x, y) => (x.timestamp < y.timestamp ? -1 : x.timestamp > y.timestamp ? 1 : x.id < y.id ? -1 : 1))
        .map((e) => ({ id: e.id, timestamp: e.timestamp, result: e.result, metadata: e.metadata }));
      return { rows, rowCount: rows.length };
    }

    if (s.includes('FROM concept_transfer_state')) {
      const [sid, cid] = params;
      const row = cts.get(key(sid, cid));
      return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
    }

    if (s.startsWith('INSERT INTO concept_transfer_state')) {
      const [sid, cid, score, near, mid, far, dims, lastAt, lastDist, depth, pv] = params;
      const k = key(sid, cid);
      const exists = cts.has(k);
      const row = {
        student_id: sid, concept_id: cid,
        demonstrated_transfer_score: score, near_transfer_success_count: near, mid_transfer_success_count: mid, far_transfer_success_count: far,
        distinct_novelty_dimensions_ok: dims, last_successful_transfer_at: lastAt, last_successful_transfer_distance: lastDist,
        transfer_depth: depth, policy_version: pv, updated_at: new Date().toISOString(),
      };
      if (/ON CONFLICT \(student_id, concept_id\) DO NOTHING/.test(s)) {
        if (exists) return { rows: [], rowCount: 0 };
        cts.set(k, row);
        return { rows: [{ student_id: sid }], rowCount: 1 };
      }
      // ON CONFLICT DO UPDATE
      cts.set(k, row);
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`unmocked SQL: ${s}`);
  }

  const query = vi.fn((sql: string, params?: any[]) => handle(sql, params));
  const db = { query, connect: async () => ({ query: (sql: string, p?: any[]) => handle(sql, p), release: () => {} }), end: async () => {} };
  return { db, cts, runs, query };
}
function a_gt(s: string, c: string, cs: string, cc: string) {
  return s > cs || (s === cs && c > cc);
}

// ---- fixtures ----------------------------------------------------
const FP = 'c'.repeat(64);
let ei = 0;
function tEvi(student: string, concept: string, o: Partial<Evi> & { d?: string; assisted?: boolean; ts?: string } = {}): Evi {
  ei += 1;
  return {
    id: `e${String(ei).padStart(4, '0')}`,
    student_id: student, concept_id: concept, source_type: 'TRANSFER',
    timestamp: o.ts ?? `2026-08-0${1 + (ei % 8)}T00:0${ei % 6}:00.000Z`,
    result: o.result ?? 'correct',
    metadata: o.metadata ?? { transferDistance: o.d ?? 'FAR', assisted: o.assisted ?? false, transferTaskId: `task-${ei}`, promptFingerprint: FP, sourceConceptId: concept },
  };
}

const S1 = '11111111-1111-4111-8111-111111111111';
const S2 = '22222222-2222-4222-8222-222222222222';
const C1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const C2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

let mod: typeof import('@/services/transfer-backfill.service');
let projectorMod: typeof import('@/services/transfer-projector.service');
beforeEach(() => { ei = 0; });

async function load(db: any) {
  vi.resetModules();
  vi.doMock('@/lib/db', () => ({ db }));
  mod = await import('@/services/transfer-backfill.service');
  projectorMod = await import('@/services/transfer-projector.service');
}

describe('7C3 -- discovery + dry-run', () => {
  it('DRY RUN: discovers every distinct TRANSFER pair, proposes state, writes ZERO concept_transfer_state rows', async () => {
    const evi = [tEvi(S1, C1, { d: 'FAR' }), tEvi(S1, C2, { d: 'MID' }), tEvi(S2, C1, { result: 'incorrect' })];
    const f = makeFake(evi);
    await load(f.db);
    const r = await mod.runTransferStateBackfill(); // dryRun default
    expect(r.done).toBe(true);
    expect(r.metrics.pairsScanned).toBe(3);
    expect(r.metrics.proposedInserts).toBe(3);
    expect(r.metrics.proposedUpdates).toBe(0);
    expect(r.metrics.failedPairs).toBe(0);
    expect(r.metrics.scoreMismatches).toBe(0);
    // legacy: never GENERALIZED/ROBUST, mid/far counts 0
    expect(r.metrics.depthCounts.GENERALIZED).toBe(0);
    expect(r.metrics.depthCounts.ROBUST).toBe(0);
    expect(r.metrics.midSuccessCountTotal).toBe(0);
    expect(r.metrics.farSuccessCountTotal).toBe(0);
    expect(r.metrics.nonEmptyNoveltyStateRows).toBe(0);
    expect(f.cts.size).toBe(0); // NO writes
    expect(f.query.mock.calls.some((c: any[]) => /INSERT INTO concept_transfer_state/.test(String(c[0])))).toBe(false);
  });
});

describe('7C3 -- write mode', () => {
  it('inserts one row per pair; second run is a pure semantic no-op (idempotent)', async () => {
    const evi = [tEvi(S1, C1, { d: 'FAR' }), tEvi(S1, C1, { d: 'MID', ts: '2026-08-05T00:00:00.000Z' }), tEvi(S2, C2, { result: 'partial' })];
    const f = makeFake(evi);
    await load(f.db);

    const first = await mod.runTransferStateBackfill({ dryRun: false });
    expect(first.metrics.rowsWritten).toBe(2);
    expect(first.metrics.failedPairs).toBe(0);
    expect(f.cts.size).toBe(2);
    for (const row of f.cts.values()) {
      expect(row.transfer_depth === 'NONE' || row.transfer_depth === 'NEAR_DEMONSTRATED').toBe(true);
      expect(row.mid_transfer_success_count).toBe(0);
      expect(row.far_transfer_success_count).toBe(0);
      expect(row.distinct_novelty_dimensions_ok).toEqual([]);
      expect(row.policy_version).toBe(2); // 7G1: TRANSFER_POLICY_VERSION bumped 1 -> 2
      expect(row.last_successful_transfer_distance === null || row.last_successful_transfer_distance === 'NEAR').toBe(true);
    }

    const second = await mod.runTransferStateBackfill({ dryRun: false });
    expect(second.metrics.rowsWritten).toBe(0);
    expect(second.metrics.semanticNoops).toBe(2);
    expect(second.metrics.failedPairs).toBe(0);
  });

  it('backfill output deep-equals the live projector for the same final history', async () => {
    const evi = [tEvi(S1, C1, { d: 'FAR' }), tEvi(S1, C1, { d: 'MID', ts: '2026-08-06T00:00:00.000Z' }), tEvi(S1, C1, { result: 'incorrect', ts: '2026-08-07T00:00:00.000Z' })];
    const f = makeFake(evi);
    await load(f.db);
    await mod.runTransferStateBackfill({ dryRun: false });
    const backfilled = f.cts.get(`${S1}|${C1}`);

    // live projector against the same history (currentEvidenceId = latest id)
    const f2 = makeFake(evi);
    await load(f2.db);
    const conn = await f2.db.connect();
    await projectorMod.projectConceptTransferState(conn as any, S1, C1, evi[evi.length - 1].id);
    const live = f2.cts.get(`${S1}|${C1}`);

    for (const k of ['demonstrated_transfer_score', 'near_transfer_success_count', 'mid_transfer_success_count', 'far_transfer_success_count', 'transfer_depth', 'policy_version', 'last_successful_transfer_distance']) {
      expect(backfilled[k]).toEqual(live[k]);
    }
  });

  it('updates a stale existing row, skips a semantically-equal one', async () => {
    const evi = [tEvi(S1, C1, { d: 'FAR' })];
    const f = makeFake(evi);
    // pre-seed a stale row (wrong depth / score)
    f.cts.set(`${S1}|${C1}`, {
      student_id: S1, concept_id: C1, demonstrated_transfer_score: 5,
      near_transfer_success_count: 0, mid_transfer_success_count: 0, far_transfer_success_count: 0,
      distinct_novelty_dimensions_ok: [], last_successful_transfer_at: null, last_successful_transfer_distance: null,
      transfer_depth: 'NONE', policy_version: 1, updated_at: 'x',
    });
    await load(f.db);
    const r = await mod.runTransferStateBackfill({ dryRun: false });
    expect(r.metrics.rowsWritten).toBe(1);
    expect(f.cts.get(`${S1}|${C1}`).transfer_depth).toBe('NEAR_DEMONSTRATED');

    const r2 = await mod.runTransferStateBackfill({ dryRun: false });
    expect(r2.metrics.rowsWritten).toBe(0);
    expect(r2.metrics.semanticNoops).toBe(1);
  });
});

describe('7C3 -- resume', () => {
  it('interrupted (batchSize=1) then resumed == uninterrupted full run', async () => {
    const evi = [tEvi(S1, C1, { d: 'FAR' }), tEvi(S1, C2, { d: 'MID' }), tEvi(S2, C1, { d: 'NEAR' })];

    const fFull = makeFake(evi);
    await load(fFull.db);
    await mod.runTransferStateBackfill({ dryRun: false, batchSize: 100 });
    const full = new Map(Array.from(fFull.cts.entries()).map(([k, v]) => [k, { d: v.transfer_depth, s: v.demonstrated_transfer_score }]));

    const fStep = makeFake(evi);
    await load(fStep.db);
    let res = await mod.runTransferStateBackfill({ dryRun: false, batchSize: 1 });
    while (!res.done) res = await mod.runTransferStateBackfill({ dryRun: false, batchSize: 1, runId: res.runId });
    const stepped = new Map(Array.from(fStep.cts.entries()).map(([k, v]) => [k, { d: v.transfer_depth, s: v.demonstrated_transfer_score }]));

    expect(stepped).toEqual(full);
    expect(fStep.cts.size).toBe(3);
  });
});

describe('7C3 -- concurrency: a live write during backfill is not regressed', () => {
  it('new evidence appears mid-run; backfill final state == replay of the complete latest history', async () => {
    const evi = [tEvi(S1, C1, { d: 'FAR' })];
    const f = makeFake(evi);
    await load(f.db);

    // backfill pair 1
    await mod.runTransferStateBackfill({ dryRun: false });
    const afterFirst = f.cts.get(`${S1}|${C1}`).transfer_depth;
    expect(afterFirst).toBe('NEAR_DEMONSTRATED');

    // a concurrent live Transfer submission adds a new row + the live
    // projector advances state
    evi.push(tEvi(S1, C1, { d: 'MID', ts: '2026-08-09T00:00:00.000Z' }));
    const conn = await f.db.connect();
    await projectorMod.projectConceptTransferState(conn as any, S1, C1, evi[evi.length - 1].id);
    const liveState = { ...f.cts.get(`${S1}|${C1}`) };

    // backfill re-runs (write mode) -- must not regress: it re-reads
    // the full history (now 2 rows) and writes a consistent state
    const r = await mod.runTransferStateBackfill({ dryRun: false });
    const finalRow = f.cts.get(`${S1}|${C1}`);
    // consistent with a full replay: near count reflects BOTH successes
    expect(finalRow.near_transfer_success_count).toBe(2);
    expect(finalRow.transfer_depth).toBe('NEAR_DEMONSTRATED');
    expect(finalRow.demonstrated_transfer_score).toBe(liveState.demonstrated_transfer_score);
    expect(r.metrics.failedPairs).toBe(0);
  });
});
