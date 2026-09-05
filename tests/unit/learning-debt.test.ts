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

  // Step 6J-B1: null daysSinceLastSuccess/forgettingRisk (no genuine
  // Phase 6 concept_memory_state row yet) must evaluate as NOT SATISFIED
  // -- never fabricated as 0 days, Infinity, or a "worst case" 100% risk.
  describe('NULL RETENTION PROOF / NULL FORGETTING RISK (Section 11) -- never fabricated, never satisfied', () => {
    it('null daysSinceLastSuccess -> retentionProof.met is false, not true (would have been true under the old Infinity sentinel)', () => {
      const r = computeDebtResolutionCriteria(90, [95, 90, 85], null, 10);
      expect(r.retentionProof.met).toBe(false);
      expect(r.retentionProof.daysSinceLastSuccess).toBeNull();
      expect(r.allMet).toBe(false);
    });

    it('null forgettingRisk -> lowForgettingRisk.met is false, not true (would have been true under the old fabricated-100 fallback only if inverted incorrectly, but must never be treated as "satisfied" either way)', () => {
      const r = computeDebtResolutionCriteria(90, [95, 90, 85], 20, null);
      expect(r.lowForgettingRisk.met).toBe(false);
      expect(r.lowForgettingRisk.current).toBeNull();
      expect(r.allMet).toBe(false);
    });

    it('both null -> debt never resolves purely from missing Phase 6 data, even with perfect mastery/scores', () => {
      const r = computeDebtResolutionCriteria(100, [100, 100, 100], null, null);
      expect(r.masteryAbove85.met).toBe(true);
      expect(r.recentScoresAbove80.met).toBe(true);
      expect(r.retentionProof.met).toBe(false);
      expect(r.lowForgettingRisk.met).toBe(false);
      expect(r.allMet).toBe(false);
    });
  });
});
