/**
 * Phase 7 -- Step 7B2: deterministic structural-duplicate guard.
 *
 * Pure tests for src/services/transfer-novelty.service.ts plus the
 * cross-check that an UNSEEN fingerprint is NOT full novelty
 * certification. No AI, no similarity, no fuzzy thresholds.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  TRANSFER_DUPLICATE_LOOKBACK,
  getRecentTransferFingerprints,
  isDuplicateTransferFingerprint,
  evaluateTransferNoveltyGuard,
  type RecentTransferFingerprint,
} from '@/services/transfer-novelty.service';
import { computeTransferPromptFingerprint } from '@/lib/transfer-task-identity';
import { qualifiesAsTransferEvidence, type TransferAttemptInput } from '@/lib/transfer-policy';

const HEX = (n: number) => n.toString(16).padStart(64, '0');
const FP_A = HEX(0xa);
const FP_B = HEX(0xb);
const TASK_1 = '11111111-1111-4111-8111-111111111111';
const TASK_2 = '22222222-2222-4222-8222-222222222222';

function recent(rows: Partial<RecentTransferFingerprint>[]): RecentTransferFingerprint[] {
  return rows.map((r) => ({
    promptFingerprint: r.promptFingerprint ?? FP_A,
    transferTaskId: r.transferTaskId ?? null,
    transferDistance: r.transferDistance ?? null,
    timestamp: r.timestamp ?? '2026-09-06T00:00:00.000Z',
  }));
}

describe('7B2 -- constant', () => {
  it('TRANSFER_DUPLICATE_LOOKBACK is a small bounded number', () => {
    expect(TRANSFER_DUPLICATE_LOOKBACK).toBeGreaterThan(0);
    expect(TRANSFER_DUPLICATE_LOOKBACK).toBeLessThanOrEqual(50);
  });
});

describe('7B2 -- isDuplicateTransferFingerprint (pure, exact match only)', () => {
  it('exact match -> duplicate, carries matched task id', () => {
    expect(
      isDuplicateTransferFingerprint({ candidateFingerprint: FP_A, recentFingerprints: recent([{ promptFingerprint: FP_A, transferTaskId: TASK_1 }]) }),
    ).toEqual({ duplicate: true, matchedTransferTaskId: TASK_1 });
  });
  it('no match -> not duplicate', () => {
    expect(isDuplicateTransferFingerprint({ candidateFingerprint: FP_B, recentFingerprints: recent([{ promptFingerprint: FP_A }]) })).toEqual({
      duplicate: false,
    });
  });
  it('malformed candidate fingerprint -> not duplicate (never throws)', () => {
    expect(isDuplicateTransferFingerprint({ candidateFingerprint: 'not-a-hash', recentFingerprints: recent([{ promptFingerprint: FP_A }]) })).toEqual({
      duplicate: false,
    });
  });
  it('excludeTransferTaskId skips the same task\'s own rows (idempotent resubmit)', () => {
    const rows = recent([{ promptFingerprint: FP_A, transferTaskId: TASK_1 }]);
    expect(isDuplicateTransferFingerprint({ candidateFingerprint: FP_A, recentFingerprints: rows, excludeTransferTaskId: TASK_1 })).toEqual({
      duplicate: false,
    });
    // a DIFFERENT task with the same fingerprint is still a duplicate
    expect(isDuplicateTransferFingerprint({ candidateFingerprint: FP_A, recentFingerprints: rows, excludeTransferTaskId: TASK_2 })).toEqual({
      duplicate: true,
      matchedTransferTaskId: TASK_1,
    });
  });
});

describe('7B2 -- evaluateTransferNoveltyGuard', () => {
  it('unseen -> eligible UNSEEN_FINGERPRINT', () => {
    expect(evaluateTransferNoveltyGuard({ candidateFingerprint: FP_B, recentFingerprints: recent([{ promptFingerprint: FP_A }]) })).toEqual({
      eligible: true,
      status: 'UNSEEN_FINGERPRINT',
    });
  });
  it('duplicate -> not eligible RECENT_DUPLICATE', () => {
    expect(
      evaluateTransferNoveltyGuard({ candidateFingerprint: FP_A, recentFingerprints: recent([{ promptFingerprint: FP_A, transferTaskId: TASK_1 }]) }),
    ).toEqual({ eligible: false, status: 'RECENT_DUPLICATE', matchedTransferTaskId: TASK_1 });
  });
});

describe('7B2 -- numeric-variant anti-memorization (core certification test)', () => {
  it('"...with 10 meters..." and "...with 42 meters..." collide -> candidate is a duplicate', () => {
    const historicalFp = computeTransferPromptFingerprint('Solve this problem with 10 meters of rope and a 5 kg mass.');
    const candidateFp = computeTransferPromptFingerprint('Solve this problem with 42 meters of rope and a 9 kg mass.');
    expect(candidateFp).toBe(historicalFp);
    expect(
      evaluateTransferNoveltyGuard({
        candidateFingerprint: candidateFp,
        recentFingerprints: recent([{ promptFingerprint: historicalFp, transferTaskId: TASK_1 }]),
      }).eligible,
    ).toBe(false);
  });
});

describe('7B2 -- meaningful lexical difference passes the STRUCTURAL gate only', () => {
  it('velocity vs acceleration -> different fingerprints -> eligible', () => {
    const historicalFp = computeTransferPromptFingerprint('A cyclist rounds a bend; compute the velocity at the apex.');
    const candidateFp = computeTransferPromptFingerprint('A cyclist rounds a bend; compute the acceleration at the apex.');
    expect(candidateFp).not.toBe(historicalFp);
    expect(evaluateTransferNoveltyGuard({ candidateFingerprint: candidateFp, recentFingerprints: recent([{ promptFingerprint: historicalFp }]) }).eligible).toBe(
      true,
    );
  });

  it('eligible (UNSEEN_FINGERPRINT) is NOT noveltyValidationPassed / full qualification', () => {
    // A structurally-unseen task that the 7A1 novelty pipeline has NOT
    // validated still does not qualify as transfer evidence.
    const attempt: TransferAttemptInput = {
      activityType: 'TRANSFER',
      evidenceMode: 'INDEPENDENT',
      aiAssisted: false,
      operationKeyValid: true,
      taskIdentityValid: true,
      duplicateFingerprint: false, // structurally unseen
      sameQuestionFallback: false,
      noveltyValidationPassed: false, // 7A1/7D validator has NOT run
      transferDistance: 'FAR',
      transferModality: 'STRUCTURAL',
      noveltyDimensions: ['CONSTRAINT'],
      targetConceptIds: [],
      targetConceptsIndependent: true,
      outcome: 'SUCCESS',
      attemptedAt: '2026-09-06T00:00:00.000Z',
    };
    const r = qualifiesAsTransferEvidence(attempt);
    expect(r.qualifies).toBe(false);
    expect(r.reasons).toContain('NOVELTY_NOT_VALIDATED');
  });
});

describe('7B2 -- getRecentTransferFingerprints (one bounded query, identity fields only)', () => {
  it('issues exactly one bounded query and returns only fingerprint identity data', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        { metadata: { promptFingerprint: FP_A, transferTaskId: TASK_1, transferDistance: 'MID', aiExecution: { secret: 1 } }, timestamp: 't1' },
        { metadata: { promptFingerprint: FP_B, transferTaskId: TASK_2 }, timestamp: 't2' },
      ],
    });
    const rows = await getRecentTransferFingerprints('stu-1', 'concept-1', TRANSFER_DUPLICATE_LOOKBACK, { query } as any);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/source_type = 'TRANSFER'/);
    expect(sql).toMatch(/ORDER BY timestamp DESC/);
    expect(sql).toMatch(/LIMIT \$3/);
    expect(params).toEqual(['stu-1', 'concept-1', TRANSFER_DUPLICATE_LOOKBACK]);
    expect(rows).toEqual([
      { promptFingerprint: FP_A, transferTaskId: TASK_1, transferDistance: 'MID', timestamp: 't1' },
      { promptFingerprint: FP_B, transferTaskId: TASK_2, transferDistance: null, timestamp: 't2' },
    ]);
    expect(JSON.stringify(rows)).not.toContain('secret');
  });

  it('legacy rows with no / malformed fingerprint are ignored, never crash', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        { metadata: null, timestamp: 't0' },
        { metadata: {}, timestamp: 't1' },
        { metadata: { promptFingerprint: 'SHORT' }, timestamp: 't2' },
        { metadata: { promptFingerprint: FP_A.toUpperCase() }, timestamp: 't3' }, // wrong case -> not canonical
        { metadata: { promptFingerprint: FP_A, transferTaskId: TASK_1 }, timestamp: 't4' },
      ],
    });
    const rows = await getRecentTransferFingerprints('s', 'c', 20, { query } as any);
    expect(rows).toEqual([{ promptFingerprint: FP_A, transferTaskId: TASK_1, transferDistance: null, timestamp: 't4' }]);
  });
});
