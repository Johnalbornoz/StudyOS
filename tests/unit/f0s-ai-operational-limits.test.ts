/**
 * F0-S / RR-01 / RR-10 -- global AI call-volume containment.
 * Exercises `reserveAICall`/`aiVolumeLimits` directly against a mocked
 * `db`, independent of the `NODE_ENV==='test'` guard in gateway.ts
 * (which only decides whether `executeAI` calls this module at all,
 * never how this module itself behaves).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const dbQueryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => dbQueryMock(...a) } }));

import { reserveAICall, aiVolumeLimits } from '@/lib/ai/operational-limits';
import { AIExecutionError } from '@/lib/ai/errors';

beforeEach(() => {
  dbQueryMock.mockReset();
});

describe('aiVolumeLimits', () => {
  it('defaults to conservative, non-unlimited ceilings when unset', () => {
    const limits = aiVolumeLimits({});
    expect(limits.perMinute).toBeGreaterThan(0);
    expect(limits.perDay).toBeGreaterThan(0);
    expect(Number.isFinite(limits.perMinute)).toBe(true);
    expect(Number.isFinite(limits.perDay)).toBe(true);
  });

  it('reads explicit, valid overrides from the env bag', () => {
    const limits = aiVolumeLimits({ AI_MAX_CALLS_PER_MINUTE: '5', AI_MAX_CALLS_PER_DAY: '100' });
    expect(limits).toEqual({ perMinute: 5, perDay: 100 });
  });

  it('rejects a non-numeric or out-of-range override rather than silently ignoring it', () => {
    expect(() => aiVolumeLimits({ AI_MAX_CALLS_PER_MINUTE: 'not-a-number' })).toThrow(AIExecutionError);
    expect(() => aiVolumeLimits({ AI_MAX_CALLS_PER_MINUTE: '0' })).toThrow(AIExecutionError);
  });
});

describe('reserveAICall -- fails closed', () => {
  it('resolves when the reservation UPDATE returns exactly one row (a slot was available)', async () => {
    dbQueryMock.mockResolvedValue({ rowCount: 1, rows: [{ id: true }] });
    await expect(reserveAICall()).resolves.toBeUndefined();
  });

  it('throws RATE_LIMIT when the reservation UPDATE matches no row (ceiling already reached)', async () => {
    dbQueryMock.mockResolvedValue({ rowCount: 0, rows: [] });
    await expect(reserveAICall()).rejects.toMatchObject({ code: 'RATE_LIMIT' });
  });

  it('throws CONFIGURATION_ERROR (never resolves silently) when the database call itself fails -- e.g. the migration has not been applied yet', async () => {
    dbQueryMock.mockRejectedValue(new Error('relation "ai_global_limits" does not exist'));
    await expect(reserveAICall()).rejects.toMatchObject({ code: 'CONFIGURATION_ERROR' });
  });

  it('a failed reservation never returns a success value -- the caller cannot mistake a blocked call for an allowed one', async () => {
    dbQueryMock.mockRejectedValue(new Error('connection refused'));
    let threw = false;
    try {
      await reserveAICall();
    } catch (err) {
      threw = true;
      expect(err).toBeInstanceOf(AIExecutionError);
    }
    expect(threw).toBe(true);
  });
});
