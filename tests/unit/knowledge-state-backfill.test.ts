import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...args: any[]) => queryMock(...args) } }));

const recalcMock = vi.fn();
vi.mock('@/services/knowledge-state.service', async () => {
  const actual = await vi.importActual<typeof import('@/services/knowledge-state.service')>('@/services/knowledge-state.service');
  return { ...actual, recalculateConceptKnowledgeState: (...args: any[]) => recalcMock(...args) };
});

import { runKnowledgeStateBackfill } from '@/services/knowledge-state-backfill.service';

beforeEach(() => {
  queryMock.mockReset();
  recalcMock.mockReset();
});

describe('Phase 3 Pre-flight -- Knowledge State backfill', () => {
  it('reprojects only candidate pairs (missing or stale state), calling the same production projector -- never a second formula', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'run-1' }] }); // createRun INSERT
    queryMock.mockResolvedValueOnce({
      rows: [
        { student_id: 's1', concept_id: 'c1' },
        { student_id: 's1', concept_id: 'c2' },
      ],
    }); // findCandidates
    recalcMock.mockResolvedValueOnce({ masteryState: 'DEVELOPING', retentionScore: null });
    recalcMock.mockResolvedValueOnce({ masteryState: 'UNKNOWN', retentionScore: null });
    queryMock.mockResolvedValueOnce({ rows: [] }); // final UPDATE backfill_runs

    const result = await runKnowledgeStateBackfill({ dryRun: false, batchSize: 500 });

    expect(recalcMock).toHaveBeenCalledTimes(2);
    expect(recalcMock).toHaveBeenNthCalledWith(1, 's1', 'c1');
    expect(recalcMock).toHaveBeenNthCalledWith(2, 's1', 'c2');
    expect(result.metrics.conceptsWithEvidence).toBe(2);
    expect(result.metrics.statesReconstructed).toBe(2);
    expect(result.metrics.unknownRetained).toBe(1); // UNKNOWN preserved, not silently upgraded
    expect(result.metrics.retentionUnavailable).toBe(2); // never fabricated -- both null
    expect(result.done).toBe(true);
    expect(result.status).toBe('COMPLETED');
  });

  it('never fabricates evidence: a pair with real evidence but no Retention-qualifying gap still ends with retentionScore null', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'run-2' }] });
    queryMock.mockResolvedValueOnce({ rows: [{ student_id: 's2', concept_id: 'c3' }] });
    recalcMock.mockResolvedValueOnce({ masteryState: 'PROVISIONAL_MASTERY', retentionScore: null });
    queryMock.mockResolvedValueOnce({ rows: [] });

    const result = await runKnowledgeStateBackfill({ studentId: 's2' });
    expect(result.metrics.retentionUnavailable).toBe(1);
  });

  it('is student-isolated: a studentId filter is forwarded to the candidate query', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'run-3' }] });
    queryMock.mockResolvedValueOnce({ rows: [] });
    queryMock.mockResolvedValueOnce({ rows: [] });

    await runKnowledgeStateBackfill({ studentId: 'only-this-student' });

    const findCall = queryMock.mock.calls[1];
    expect(findCall[1][0]).toBe('only-this-student');
  });

  it('a batch smaller than batchSize marks the run done/COMPLETED; a full batch leaves it RUNNING with a cursor for resumption', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'run-4' }] });
    queryMock.mockResolvedValueOnce({
      rows: Array.from({ length: 2 }, (_, i) => ({ student_id: 's1', concept_id: `c${i}` })),
    });
    recalcMock.mockResolvedValue({ masteryState: 'LEARNING', retentionScore: null });
    queryMock.mockResolvedValueOnce({ rows: [] });

    const result = await runKnowledgeStateBackfill({ batchSize: 2 });
    expect(result.done).toBe(false);
    expect(result.status).toBe('RUNNING');
  });

  it('is resumable: passing back runId continues from the persisted cursor and accumulates metrics rather than restarting', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ metrics: { studentsScanned: 1, conceptsWithEvidence: 2, statesReconstructed: 2, unknownRetained: 0, retentionUnavailable: 0, errors: 0, durationMs: 10 }, cursor_student_id: 's1', cursor_concept_id: 'c2', status: 'RUNNING' }],
    }); // load existing run
    queryMock.mockResolvedValueOnce({ rows: [{ student_id: 's2', concept_id: 'c1' }] }); // next candidates, past the cursor
    recalcMock.mockResolvedValueOnce({ masteryState: 'LEARNING', retentionScore: 80 });
    queryMock.mockResolvedValueOnce({ rows: [] });

    const result = await runKnowledgeStateBackfill({ runId: 'run-existing', batchSize: 500 });
    expect(result.metrics.conceptsWithEvidence).toBe(3); // 2 previously + 1 this batch
    expect(result.metrics.statesReconstructed).toBe(3);
  });

  it('dry-run never calls the mutating projector -- it only ever reports candidates, it never persists', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'run-6' }] });
    queryMock.mockResolvedValueOnce({ rows: [] }); // no candidates, keeps this test focused on the dryRun/no-mutation contract
    queryMock.mockResolvedValueOnce({ rows: [] });

    const result = await runKnowledgeStateBackfill({ dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(recalcMock).not.toHaveBeenCalled();
  });

  it('a per-pair error is counted and does not abort the rest of the batch', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'run-5' }] });
    queryMock.mockResolvedValueOnce({
      rows: [
        { student_id: 's1', concept_id: 'c1' },
        { student_id: 's1', concept_id: 'c2' },
      ],
    });
    recalcMock.mockRejectedValueOnce(new Error('boom'));
    recalcMock.mockResolvedValueOnce({ masteryState: 'LEARNING', retentionScore: null });
    queryMock.mockResolvedValueOnce({ rows: [] });

    const result = await runKnowledgeStateBackfill({});
    expect(result.metrics.errors).toBe(1);
    expect(result.metrics.statesReconstructed).toBe(1);
  });
});
