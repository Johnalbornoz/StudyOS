import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ db: { query: vi.fn() } }));

import { computeTransferScore, type TransferEvidenceRow } from '@/services/transfer.service';
import { rubricScorePercent, type RubricResult } from '@/services/explain-defend.service';

function row(overrides: Partial<TransferEvidenceRow>): TransferEvidenceRow {
  return { transferDistance: 'NEAR', result: 'correct', assisted: false, timestamp: new Date(), ...overrides };
}

describe('computeTransferScore', () => {
  it('is null with no evidence', () => {
    expect(computeTransferScore([])).toBeNull();
  });

  it('is 100 for a single independent correct NEAR transfer', () => {
    expect(computeTransferScore([row({})])).toBe(100);
  });

  it('is 0 for a single incorrect transfer', () => {
    expect(computeTransferScore([row({ result: 'incorrect' })])).toBe(0);
  });

  it('weighs a correct MID transfer above a correct NEAR one when mixed with incorrect attempts', () => {
    const nearHeavy = computeTransferScore([row({ transferDistance: 'NEAR', result: 'correct' }), row({ transferDistance: 'NEAR', result: 'incorrect' })]);
    const midHeavy = computeTransferScore([row({ transferDistance: 'MID', result: 'correct' }), row({ transferDistance: 'NEAR', result: 'incorrect' })]);
    expect(midHeavy as number).toBeGreaterThan(nearHeavy as number);
  });

  it('discounts an assisted success relative to an independent one', () => {
    const independent = computeTransferScore([row({ result: 'correct', assisted: false }), row({ result: 'incorrect' })]);
    const assisted = computeTransferScore([row({ result: 'correct', assisted: true }), row({ result: 'incorrect' })]);
    expect(assisted as number).toBeLessThan(independent as number);
  });

  it('only considers the 10 most recent rows', () => {
    const oldBad = Array.from({ length: 15 }, (_, i) => row({ result: 'incorrect', timestamp: new Date(2020, 0, i + 1) }));
    const recentGood = Array.from({ length: 10 }, (_, i) => row({ result: 'correct', timestamp: new Date(2026, 0, i + 1) }));
    expect(computeTransferScore([...oldBad, ...recentGood])).toBe(100);
  });
});

describe('rubricScorePercent', () => {
  function rubric(overrides: Partial<RubricResult>): RubricResult {
    return { conceptAccuracy: 0, reasoning: 0, completeness: 0, misconceptionDetected: false, misconceptionDescription: null, feedback: '', ...overrides };
  }

  it('is 100 for a perfect rubric', () => {
    expect(rubricScorePercent(rubric({ conceptAccuracy: 4, reasoning: 4, completeness: 4 }))).toBe(100);
  });

  it('is 0 for a zeroed rubric', () => {
    expect(rubricScorePercent(rubric({}))).toBe(0);
  });

  it('averages the three dimensions proportionally', () => {
    expect(rubricScorePercent(rubric({ conceptAccuracy: 2, reasoning: 2, completeness: 2 }))).toBe(50);
  });
});
