/**
 * Phase 1D Steps 4/5/6/23: normalizeResponseTiming is the single source
 * of truth for turning two client-supplied timestamps into a trusted-
 * enough duration + quality label. Every branch must fail open -- never
 * throw, always return a normal ResponseTiming value -- since a bad
 * timestamp must never be able to block the actual learning
 * interaction it's attached to.
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeResponseTiming,
  toResponseTimingEntries,
  withBehaviorMetadata,
  MAX_VALID_RESPONSE_TIME_MS,
} from '@/lib/algorithms/response-timing';

describe('normalizeResponseTiming', () => {
  it('VALID: a normal, positive duration', () => {
    const result = normalizeResponseTiming({
      questionPresentedAt: '2026-08-31T10:00:00.000Z',
      answerSubmittedAt: '2026-08-31T10:00:42.300Z',
    });
    expect(result).toEqual({ responseTimeMs: 42300, quality: 'VALID' });
  });

  it('MISSING: both timestamps absent', () => {
    expect(normalizeResponseTiming({})).toEqual({ responseTimeMs: null, quality: 'MISSING' });
  });

  it('MISSING: only presentedAt missing', () => {
    expect(normalizeResponseTiming({ answerSubmittedAt: '2026-08-31T10:00:42.300Z' })).toEqual({
      responseTimeMs: null,
      quality: 'MISSING',
    });
  });

  it('MISSING: only submittedAt missing', () => {
    expect(normalizeResponseTiming({ questionPresentedAt: '2026-08-31T10:00:00.000Z' })).toEqual({
      responseTimeMs: null,
      quality: 'MISSING',
    });
  });

  it('MISSING: explicit null values (not just undefined)', () => {
    expect(normalizeResponseTiming({ questionPresentedAt: null, answerSubmittedAt: null })).toEqual({
      responseTimeMs: null,
      quality: 'MISSING',
    });
  });

  it('MISSING: empty-string timestamps (falsy, same as absent)', () => {
    expect(normalizeResponseTiming({ questionPresentedAt: '', answerSubmittedAt: '' })).toEqual({
      responseTimeMs: null,
      quality: 'MISSING',
    });
  });

  it('INVALID: non-date garbage string', () => {
    expect(
      normalizeResponseTiming({ questionPresentedAt: 'not-a-date', answerSubmittedAt: '2026-08-31T10:00:42.300Z' })
    ).toEqual({ responseTimeMs: null, quality: 'INVALID' });
  });

  it('INVALID: NaN-like input on both sides', () => {
    expect(normalizeResponseTiming({ questionPresentedAt: 'NaN', answerSubmittedAt: 'also garbage' })).toEqual({
      responseTimeMs: null,
      quality: 'INVALID',
    });
  });

  it('CLOCK_SKEW: submitted before presented (negative duration)', () => {
    expect(
      normalizeResponseTiming({ questionPresentedAt: '2026-08-31T10:00:42.300Z', answerSubmittedAt: '2026-08-31T10:00:00.000Z' })
    ).toEqual({ responseTimeMs: null, quality: 'CLOCK_SKEW' });
  });

  it('CLOCK_SKEW: presentation timestamp is far in the future relative to submission', () => {
    const result = normalizeResponseTiming({
      questionPresentedAt: '2099-01-01T00:00:00.000Z',
      answerSubmittedAt: '2026-08-31T10:00:00.000Z',
    });
    expect(result.quality).toBe('CLOCK_SKEW');
    expect(result.responseTimeMs).toBeNull();
  });

  it('OUTLIER: duration far beyond the generous ceiling is kept, not clamped into a normal-looking value', () => {
    const presented = new Date('2026-08-31T00:00:00.000Z');
    const submitted = new Date(presented.getTime() + MAX_VALID_RESPONSE_TIME_MS + 60_000); // 1 minute over the ceiling
    const result = normalizeResponseTiming({
      questionPresentedAt: presented.toISOString(),
      answerSubmittedAt: submitted.toISOString(),
    });
    expect(result.quality).toBe('OUTLIER');
    expect(result.responseTimeMs).toBe(MAX_VALID_RESPONSE_TIME_MS + 60_000);
  });

  it('OUTLIER: an implausibly huge (far-future submission) duration', () => {
    const result = normalizeResponseTiming({
      questionPresentedAt: '2026-08-31T00:00:00.000Z',
      answerSubmittedAt: '2099-01-01T00:00:00.000Z',
    });
    expect(result.quality).toBe('OUTLIER');
    expect(result.responseTimeMs).toBeGreaterThan(MAX_VALID_RESPONSE_TIME_MS);
  });

  it('VALID: exactly at the ceiling is still valid (boundary is inclusive)', () => {
    const presented = new Date('2026-08-31T00:00:00.000Z');
    const submitted = new Date(presented.getTime() + MAX_VALID_RESPONSE_TIME_MS);
    const result = normalizeResponseTiming({
      questionPresentedAt: presented.toISOString(),
      answerSubmittedAt: submitted.toISOString(),
    });
    expect(result).toEqual({ responseTimeMs: MAX_VALID_RESPONSE_TIME_MS, quality: 'VALID' });
  });

  it('VALID: a zero-duration answer (student submitted instantly) is valid, not treated as missing/invalid', () => {
    const result = normalizeResponseTiming({
      questionPresentedAt: '2026-08-31T10:00:00.000Z',
      answerSubmittedAt: '2026-08-31T10:00:00.000Z',
    });
    expect(result).toEqual({ responseTimeMs: 0, quality: 'VALID' });
  });

  it('never throws on adversarial input shapes', () => {
    const adversarialInputs = [
      { questionPresentedAt: '{}', answerSubmittedAt: '[]' },
      { questionPresentedAt: '0'.repeat(10000), answerSubmittedAt: '2026-08-31T10:00:00.000Z' },
      { questionPresentedAt: 'Infinity', answerSubmittedAt: '-Infinity' },
      { questionPresentedAt: '<script>alert(1)</script>', answerSubmittedAt: '2026-08-31T10:00:00.000Z' },
    ];
    for (const input of adversarialInputs) {
      expect(() => normalizeResponseTiming(input)).not.toThrow();
      const result = normalizeResponseTiming(input);
      expect(['VALID', 'MISSING', 'INVALID', 'CLOCK_SKEW', 'OUTLIER']).toContain(result.quality);
    }
  });
});

describe('toResponseTimingEntries', () => {
  it('drops MISSING samples entirely -- no null-filled placeholder entry', () => {
    const entries = toResponseTimingEntries([{ timing: { responseTimeMs: null, quality: 'MISSING' } }]);
    expect(entries).toEqual([]);
  });

  it('keeps VALID/INVALID/CLOCK_SKEW/OUTLIER samples, tagging each with its quality', () => {
    const entries = toResponseTimingEntries([
      { timing: { responseTimeMs: 5000, quality: 'VALID' }, questionIndex: 0 },
      { timing: { responseTimeMs: null, quality: 'INVALID' }, questionIndex: 1 },
      { timing: { responseTimeMs: null, quality: 'CLOCK_SKEW' }, questionIndex: 2 },
      { timing: { responseTimeMs: 999999999, quality: 'OUTLIER' }, questionIndex: 3 },
    ]);
    expect(entries).toEqual([
      { responseTimeMs: 5000, timingQuality: 'VALID', questionIndex: 0 },
      { responseTimeMs: null, timingQuality: 'INVALID', questionIndex: 1 },
      { responseTimeMs: null, timingQuality: 'CLOCK_SKEW', questionIndex: 2 },
      { responseTimeMs: 999999999, timingQuality: 'OUTLIER', questionIndex: 3 },
    ]);
  });

  it('omits questionIndex entirely for single-item writers that never pass one', () => {
    const entries = toResponseTimingEntries([{ timing: { responseTimeMs: 1000, quality: 'VALID' } }]);
    expect(entries).toEqual([{ responseTimeMs: 1000, timingQuality: 'VALID' }]);
    expect(entries[0]).not.toHaveProperty('questionIndex');
  });
});

describe('withBehaviorMetadata', () => {
  it('adds nothing at all when there are no usable entries -- byte-identical metadata to pre-Phase-1D behavior', () => {
    const metadata = { activityType: 'quiz', evidenceMode: 'PRACTICE' };
    const merged = withBehaviorMetadata(metadata, []);
    expect(merged).toEqual(metadata);
    expect(merged).not.toHaveProperty('behavior');
  });

  it('additively appends behavior.responseTimes without touching any other key', () => {
    const metadata = { activityType: 'quiz', aiExecution: { aiExecutionId: 'exec-1' } };
    const merged = withBehaviorMetadata(metadata, [{ responseTimeMs: 4200, timingQuality: 'VALID' }]);
    expect(merged).toEqual({
      activityType: 'quiz',
      aiExecution: { aiExecutionId: 'exec-1' },
      behavior: { responseTimes: [{ responseTimeMs: 4200, timingQuality: 'VALID' }] },
    });
  });
});
