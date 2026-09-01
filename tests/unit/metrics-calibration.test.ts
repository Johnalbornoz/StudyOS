/**
 * Phase 1E Step 29: Aggregate Confidence Calibration fixtures --
 * qualifying concepts, thin coverage, conflicting calibration across
 * concepts.
 */
import { describe, it, expect } from 'vitest';
import { computeAggregateCalibration } from '@/lib/learner-twin/metrics/calibration';

function rows(conceptId: string, pairs: Array<[string, string]>) {
  return pairs.map(([confidence, result]) => ({ concept_id: conceptId, confidence_before_answer: confidence as any, result }));
}

describe('computeAggregateCalibration', () => {
  it('qualifying concepts (>= 3 samples each) produce a real median score and label distribution', () => {
    const allRows = [
      ...rows('c1', [
        ['VERY_SURE', 'correct'],
        ['VERY_SURE', 'correct'],
        ['VERY_SURE', 'correct'],
      ]), // well calibrated, high score
      ...rows('c2', [
        ['VERY_SURE', 'incorrect'],
        ['VERY_SURE', 'incorrect'],
        ['VERY_SURE', 'partial'],
      ]), // overconfident
    ];
    const result = computeAggregateCalibration(allRows);
    expect(result.available).toBe(true);
    if (result.available) {
      expect(result.value.qualifyingConceptCount).toBe(2);
      expect(result.value.medianCalibrationScore).not.toBeNull();
      expect(result.value.labelDistribution.WELL_CALIBRATED + result.value.labelDistribution.OVERCONFIDENT).toBe(2);
    }
  });

  it('thin coverage (fewer than the minimum qualifying concepts) -> INSUFFICIENT_EVIDENCE, never a one-concept aggregate', () => {
    const allRows = rows('c1', [
      ['VERY_SURE', 'correct'],
      ['VERY_SURE', 'correct'],
      ['VERY_SURE', 'correct'],
    ]); // only 1 qualifying concept
    const result = computeAggregateCalibration(allRows);
    expect(result.available).toBe(false);
    if (!result.available) expect(result.reason).toBe('INSUFFICIENT_EVIDENCE');
  });

  it('a concept below the atomic function\'s own minimum-sample threshold does not count as qualifying', () => {
    const allRows = [
      ...rows('c1', [
        ['VERY_SURE', 'correct'],
        ['VERY_SURE', 'correct'],
      ]), // only 2 samples -- below CALIBRATION_MIN_SAMPLES=3
      ...rows('c2', [
        ['VERY_SURE', 'correct'],
        ['VERY_SURE', 'correct'],
        ['VERY_SURE', 'correct'],
      ]),
      ...rows('c3', [
        ['NOT_SURE', 'incorrect'],
        ['NOT_SURE', 'incorrect'],
        ['NOT_SURE', 'incorrect'],
      ]),
    ];
    const result = computeAggregateCalibration(allRows);
    expect(result.available).toBe(true);
    if (result.available) {
      expect(result.value.qualifyingConceptCount).toBe(2); // c1 excluded
      expect(result.value.totalRelevantConceptCount).toBe(3); // c1 still counted here
    }
  });

  it('conflicting calibration across concepts (one overconfident, one underconfident) -- distribution honestly shows both, no single fabricated direction label', () => {
    const allRows = [
      ...rows('c1', [
        ['VERY_SURE', 'incorrect'],
        ['VERY_SURE', 'incorrect'],
        ['VERY_SURE', 'incorrect'],
      ]), // overconfident
      ...rows('c2', [
        ['NOT_SURE', 'correct'],
        ['NOT_SURE', 'correct'],
        ['NOT_SURE', 'correct'],
      ]), // underconfident
    ];
    const result = computeAggregateCalibration(allRows);
    expect(result.available).toBe(true);
    if (result.available) {
      expect(result.value.labelDistribution.OVERCONFIDENT).toBe(1);
      expect(result.value.labelDistribution.UNDERCONFIDENT).toBe(1);
      // No single aggregate direction is fabricated -- both are visible.
    }
  });

  it('zero confidence-tagged rows -> INSUFFICIENT_EVIDENCE', () => {
    const result = computeAggregateCalibration([]);
    expect(result.available).toBe(false);
  });
});
