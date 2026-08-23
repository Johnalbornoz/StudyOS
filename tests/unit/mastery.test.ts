import { describe, it, expect } from 'vitest';
import { calculateMasteryDelta, type LearningEvidence } from '@/lib/algorithms/mastery';

function evidence(overrides: Partial<LearningEvidence>): LearningEvidence {
  return { result: 'correct', difficulty: 3, sourceType: 'PRACTICE_QUIZ', ...overrides };
}

describe('calculateMasteryDelta -- backward compatibility (no scorePercent/sampleSize)', () => {
  it('matches the original result-only behavior when scorePercent/sampleSize are omitted', () => {
    // 75%, PRACTICE_QUIZ, incorrect, difficulty 3: baseImpact -1*0.3=-0.3,
    // *difficultyMod 1.2=-0.36, *smoothing 0.85=-0.306 (verified against
    // the pre-refactor code directly, independent of this file's own stale
    // docstring example which had a since-corrected arithmetic error).
    const delta = calculateMasteryDelta(evidence({ result: 'incorrect', confidenceWeight: 1 }), 75);
    expect(delta).toBeCloseTo(-0.306, 3);
  });

  it('a bare correct/partial/incorrect result still respects the +/-3 cap for a single item', () => {
    const delta = calculateMasteryDelta(evidence({ result: 'correct', sourceType: 'REAL_SCHOOL_EXAM', confidenceWeight: 1 }), 50);
    expect(Math.abs(delta)).toBeLessThanOrEqual(3);
  });
});

describe('calculateMasteryDelta -- scorePercent replaces the coarse correct/partial/incorrect bucket', () => {
  it('a 100% score moves mastery further than a 70% score that both count as "correct"', () => {
    const strong = calculateMasteryDelta(evidence({ scorePercent: 100, sourceType: 'EXAM_SIMULATION' }), 50);
    const weak = calculateMasteryDelta(evidence({ scorePercent: 70, sourceType: 'EXAM_SIMULATION' }), 50);
    expect(strong).toBeGreaterThan(weak);
  });

  it('a 50% score is neutral (no impact either way)', () => {
    const delta = calculateMasteryDelta(evidence({ scorePercent: 50 }), 50);
    expect(delta).toBeCloseTo(0, 5);
  });

  it('a 0% score has the same magnitude as scorePercent 100 but negative', () => {
    const up = calculateMasteryDelta(evidence({ scorePercent: 100, sourceType: 'REAL_SCHOOL_EXAM', confidenceWeight: 1 }), 50);
    const down = calculateMasteryDelta(evidence({ scorePercent: 0, sourceType: 'REAL_SCHOOL_EXAM', confidenceWeight: 1 }), 50);
    expect(down).toBeCloseTo(-up, 5);
  });
});

describe('calculateMasteryDelta -- sample size scales the allowed impact and cap', () => {
  it('sampleSize 1 behaves exactly like before (multiplier 1)', () => {
    const withSize = calculateMasteryDelta(evidence({ scorePercent: 100, sampleSize: 1 }), 50);
    const without = calculateMasteryDelta(evidence({ scorePercent: 100 }), 50);
    expect(withSize).toBeCloseTo(without, 10);
  });

  it('a 15-question 100% result moves mastery meaningfully more than a 1-question 100% result', () => {
    const oneQuestion = calculateMasteryDelta(evidence({ scorePercent: 100, sampleSize: 1, sourceType: 'CUMULATIVE_ASSESSMENT' }), 10);
    const fifteenQuestions = calculateMasteryDelta(evidence({ scorePercent: 100, sampleSize: 15, sourceType: 'CUMULATIVE_ASSESSMENT' }), 10);
    expect(fifteenQuestions).toBeGreaterThan(oneQuestion * 2);
  });

  it('the sample-size multiplier is capped (diminishing returns), not unbounded', () => {
    const fifteen = calculateMasteryDelta(evidence({ scorePercent: 100, sampleSize: 15, sourceType: 'CUMULATIVE_ASSESSMENT' }), 10);
    const oneThousand = calculateMasteryDelta(evidence({ scorePercent: 100, sampleSize: 1000, sourceType: 'CUMULATIVE_ASSESSMENT' }), 10);
    // multiplier caps at 5x regardless of how large sampleSize gets
    expect(oneThousand).toBeCloseTo(fifteen * (5 / (1 + Math.log2(15))), 1);
  });

  it('never exceeds the scaled cap even for an extreme score', () => {
    const delta = calculateMasteryDelta(evidence({ scorePercent: 100, sampleSize: 20, sourceType: 'REAL_SCHOOL_EXAM', confidenceWeight: 1, difficulty: 5 }), 10);
    const sampleSizeFactor = Math.min(5, 1 + Math.log2(20));
    expect(Math.abs(delta)).toBeLessThanOrEqual(3 * sampleSizeFactor + 1e-9);
  });
});

describe('calculateMasteryDelta -- boundary diminishing returns still apply', () => {
  it('positive impact shrinks when already above 80% mastery', () => {
    const belowBoundary = calculateMasteryDelta(evidence({ scorePercent: 100, sampleSize: 5 }), 70);
    const aboveBoundary = calculateMasteryDelta(evidence({ scorePercent: 100, sampleSize: 5 }), 85);
    expect(aboveBoundary).toBeLessThan(belowBoundary);
  });
});
