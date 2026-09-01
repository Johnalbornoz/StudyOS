/**
 * Phase 1E Step 29: Persistence / Recovery fixtures -- failure ->
 * return -> success, failure -> no return, repeated failure, no
 * failure episodes.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { computePersistence } from '@/lib/learner-twin/metrics/persistence';

function evidence(...results: string[]) {
  return results.map((result, i) => ({ result, timestamp: `2026-08-${String(i + 1).padStart(2, '0')}T10:00:00.000Z` }));
}

describe('computePersistence (pure)', () => {
  it('failure -> return -> success: one episode, returned, recovered, no longer unresolved', () => {
    const result = computePersistence(evidence('incorrect', 'incorrect', 'correct'));
    expect(result.failureEpisodeCount).toBe(1);
    expect(result.returnAfterFailureCount).toBe(1);
    expect(result.recoveryAfterFailureCount).toBe(1);
    expect(result.unresolvedFailureCount).toBe(0);
    expect(result.currentConsecutiveFailureStreak).toBe(0);
  });

  it('failure -> no return: one episode, never returned, unresolved', () => {
    const result = computePersistence(evidence('correct', 'incorrect', 'incorrect'));
    expect(result.failureEpisodeCount).toBe(1);
    expect(result.returnAfterFailureCount).toBe(0);
    expect(result.recoveryAfterFailureCount).toBe(0);
    expect(result.unresolvedFailureCount).toBe(1);
    expect(result.currentConsecutiveFailureStreak).toBe(2);
  });

  it('repeated failure: multiple distinct episodes separated by a non-incorrect result', () => {
    const result = computePersistence(evidence('incorrect', 'incorrect', 'correct', 'incorrect', 'partial', 'incorrect'));
    expect(result.failureEpisodeCount).toBe(3);
    expect(result.recoveryAfterFailureCount).toBe(1); // only the first episode is followed by a later 'correct'
    expect(result.currentConsecutiveFailureStreak).toBe(1); // trailing single incorrect
  });

  it('no failure episodes: all correct/partial evidence -> zeros across the board, not fabricated', () => {
    const result = computePersistence(evidence('correct', 'partial', 'correct'));
    expect(result.failureEpisodeCount).toBe(0);
    expect(result.returnAfterFailureCount).toBe(0);
    expect(result.recoveryAfterFailureCount).toBe(0);
    expect(result.unresolvedFailureCount).toBe(0);
    expect(result.currentConsecutiveFailureStreak).toBe(0);
  });

  it('a correct result eventually after a failure counts as recovery even if not immediately next', () => {
    const result = computePersistence(evidence('incorrect', 'partial', 'partial', 'correct'));
    expect(result.recoveryAfterFailureCount).toBe(1);
  });

  it('never produces a personality/motivation label -- only counts', () => {
    const result = computePersistence(evidence('incorrect', 'correct'));
    expect(Object.keys(result)).toEqual([
      'failureEpisodeCount',
      'returnAfterFailureCount',
      'recoveryAfterFailureCount',
      'unresolvedFailureCount',
      'currentConsecutiveFailureStreak',
      'quality',
    ]);
  });
});

describe('readPersistence', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.doUnmock('@/lib/db');
  });

  it('zero evidence -> INSUFFICIENT_EVIDENCE', async () => {
    vi.resetModules();
    const query = vi.fn(async () => ({ rows: [] }));
    vi.doMock('@/lib/db', () => ({ db: { query } }));
    const { readPersistence } = await import('@/lib/learner-twin/metrics/persistence');
    const result = await readPersistence('student-1', 'concept-1');
    expect(result.available).toBe(false);
    if (!result.available) expect(result.reason).toBe('INSUFFICIENT_EVIDENCE');
  });
});
