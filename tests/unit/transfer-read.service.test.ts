/**
 * Phase 7 -- Step 7E1: transfer-read.service::getPhase4TransferSignalsForStudent.
 *
 * ONE batched concept_transfer_state read -> advisory Phase4TransferSignals.
 * Deterministic derivations (NEAR_TRANSFER_GAP / FAR_TRANSFER_GAP /
 * TRANSFER_FRAGILE) from the persisted row alone. Absent row -> absent
 * from the Map (never a zeroed signal).
 */
import { describe, it, expect, vi } from 'vitest';
import { getPhase4TransferSignalsForStudent } from '@/services/transfer-read.service';
import { TRANSFER_FRAGILE_SCORE_THRESHOLD } from '@/lib/adaptive-learning-policy';

const S = 'stu-1';

function row(o: Record<string, any> = {}) {
  return {
    concept_id: o.concept_id ?? 'c-1',
    transfer_depth: 'NONE',
    near_transfer_success_count: 0,
    mid_transfer_success_count: 0,
    far_transfer_success_count: 0,
    demonstrated_transfer_score: null,
    last_successful_transfer_at: null,
    last_successful_transfer_distance: null,
    distinct_novelty_dimensions_ok: [],
    policy_version: 1,
    ...o,
  };
}

function client(rows: any[]) {
  const query = vi.fn((..._args: any[]) => Promise.resolve({ rows }));
  return { client: { query } as any, query };
}

describe('7E1 -- getPhase4TransferSignalsForStudent', () => {
  it('issues exactly one batched query scoped to the student', async () => {
    const { client: c, query } = client([]);
    await getPhase4TransferSignalsForStudent(c, S);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toMatch(/FROM concept_transfer_state WHERE student_id = \$1/);
    expect(query.mock.calls[0][1]).toEqual([S]);
  });

  it('a concept with no row is simply absent from the Map', async () => {
    const { client: c } = client([]);
    const map = await getPhase4TransferSignalsForStudent(c, S);
    expect(map.size).toBe(0);
    expect(map.get('c-1')).toBeUndefined();
  });

  it('NONE depth -> nearTransferGap only', async () => {
    const { client: c } = client([row({ transfer_depth: 'NONE', near_transfer_success_count: 0 })]);
    const sig = (await getPhase4TransferSignalsForStudent(c, S)).get('c-1')!;
    expect(sig.nearTransferGap).toBe(true);
    expect(sig.farTransferGap).toBe(false);
    expect(sig.transferFragile).toBe(false);
  });

  it('NEAR_DEMONSTRATED with zero far successes -> farTransferGap', async () => {
    const { client: c } = client([row({ transfer_depth: 'NEAR_DEMONSTRATED', near_transfer_success_count: 2, far_transfer_success_count: 0 })]);
    const sig = (await getPhase4TransferSignalsForStudent(c, S)).get('c-1')!;
    expect(sig.nearTransferGap).toBe(false);
    expect(sig.farTransferGap).toBe(true);
  });

  it('NEAR_DEMONSTRATED with a far success -> no farTransferGap', async () => {
    const { client: c } = client([row({ transfer_depth: 'NEAR_DEMONSTRATED', far_transfer_success_count: 1 })]);
    expect((await getPhase4TransferSignalsForStudent(c, S)).get('c-1')!.farTransferGap).toBe(false);
  });

  it('GENERALIZED -> neither near nor far gap', async () => {
    const { client: c } = client([row({ transfer_depth: 'GENERALIZED', far_transfer_success_count: 1 })]);
    const sig = (await getPhase4TransferSignalsForStudent(c, S)).get('c-1')!;
    expect(sig.nearTransferGap).toBe(false);
    expect(sig.farTransferGap).toBe(false);
  });

  it('transferFragile: demonstrated depth but rolling score below threshold', async () => {
    const { client: c } = client([
      row({ transfer_depth: 'NEAR_DEMONSTRATED', demonstrated_transfer_score: TRANSFER_FRAGILE_SCORE_THRESHOLD - 1 }),
    ]);
    expect((await getPhase4TransferSignalsForStudent(c, S)).get('c-1')!.transferFragile).toBe(true);
  });

  it('NOT fragile at exactly the threshold, or with a null score, or at NONE depth', async () => {
    const { client: c1 } = client([row({ transfer_depth: 'NEAR_DEMONSTRATED', demonstrated_transfer_score: TRANSFER_FRAGILE_SCORE_THRESHOLD })]);
    expect((await getPhase4TransferSignalsForStudent(c1, S)).get('c-1')!.transferFragile).toBe(false);
    const { client: c2 } = client([row({ transfer_depth: 'GENERALIZED', demonstrated_transfer_score: null })]);
    expect((await getPhase4TransferSignalsForStudent(c2, S)).get('c-1')!.transferFragile).toBe(false);
    const { client: c3 } = client([row({ transfer_depth: 'NONE', demonstrated_transfer_score: 10 })]);
    expect((await getPhase4TransferSignalsForStudent(c3, S)).get('c-1')!.transferFragile).toBe(false);
  });

  it('maps every row and preserves the raw counts / depth', async () => {
    const { client: c } = client([
      row({ concept_id: 'a', transfer_depth: 'NONE' }),
      row({ concept_id: 'b', transfer_depth: 'GENERALIZED', mid_transfer_success_count: 3, distinct_novelty_dimensions_ok: ['STRATEGY', 'CONSTRAINT'] }),
    ]);
    const map = await getPhase4TransferSignalsForStudent(c, S);
    expect(map.size).toBe(2);
    expect(map.get('b')!.midTransferSuccessCount).toBe(3);
    expect(map.get('b')!.distinctNoveltyDimensionsOk).toEqual(['STRATEGY', 'CONSTRAINT']);
    expect(map.get('b')!.transferDepth).toBe('GENERALIZED');
  });
});
