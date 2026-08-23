import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ db: { query: vi.fn() } }));

import { computeDebtResolutionCriteria } from '@/services/learning-debt.service';

describe('computeDebtResolutionCriteria', () => {
  it('is not resolved when nothing qualifies', () => {
    const r = computeDebtResolutionCriteria(10, [], 0, 100);
    expect(r.allMet).toBe(false);
    expect(r.masteryAbove85.met).toBe(false);
    expect(r.recentScoresAbove80.met).toBe(false);
    expect(r.recentScoresAbove80.current).toBeNull();
  });

  it('requires mastery strictly above 85', () => {
    const r = computeDebtResolutionCriteria(85, [90, 90, 90], 20, 10);
    expect(r.masteryAbove85.met).toBe(false); // exactly 85 does not qualify
    expect(r.allMet).toBe(false);
  });

  it('requires at least 3 recent scores, not fewer', () => {
    const r = computeDebtResolutionCriteria(90, [100, 100], 20, 10);
    expect(r.recentScoresAbove80.met).toBe(false);
    expect(r.recentScoresAbove80.sampleCount).toBe(2);
  });

  it('requires the average of the last 3 strictly above 80', () => {
    const exactlyEighty = computeDebtResolutionCriteria(90, [80, 80, 80], 20, 10);
    expect(exactlyEighty.recentScoresAbove80.met).toBe(false);
    const aboveEighty = computeDebtResolutionCriteria(90, [90, 90, 90], 20, 10);
    expect(aboveEighty.recentScoresAbove80.met).toBe(true);
  });

  it('requires more than 14 days since the last success (same-day evidence never resolves)', () => {
    const today = computeDebtResolutionCriteria(90, [90, 90, 90], 0, 5);
    expect(today.retentionProof.met).toBe(false);
    expect(today.allMet).toBe(false);
    const twoWeeksLater = computeDebtResolutionCriteria(90, [90, 90, 90], 15, 5);
    expect(twoWeeksLater.retentionProof.met).toBe(true);
  });

  it('requires forgetting risk strictly below 20', () => {
    const r = computeDebtResolutionCriteria(90, [90, 90, 90], 20, 20);
    expect(r.lowForgettingRisk.met).toBe(false);
  });

  it('resolves only when all four criteria are met at once', () => {
    const r = computeDebtResolutionCriteria(90, [95, 90, 85], 20, 10);
    expect(r.masteryAbove85.met).toBe(true);
    expect(r.recentScoresAbove80.met).toBe(true);
    expect(r.retentionProof.met).toBe(true);
    expect(r.lowForgettingRisk.met).toBe(true);
    expect(r.allMet).toBe(true);
  });
});
