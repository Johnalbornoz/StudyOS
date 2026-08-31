import { describe, it, expect } from 'vitest';
import {
  masteryToPercent,
  formatMasteryPercent,
  formatMasteryDelta,
  dimensionToPercent,
  formatDimensionPercent,
  toMasteryScore,
  tryMasteryScore,
  averageMasteryScore,
  InvalidMasteryScoreError,
} from '@/lib/mastery-format';

describe('masteryToPercent -- canonical 0-100 mastery_records.mastery_score scale (forensic audit, not a 0.0-1.0 fraction)', () => {
  it('0 -> 0', () => {
    expect(masteryToPercent(toMasteryScore(0))).toBe(0);
  });
  it('0.49 -> 0 (rounds to nearest whole percent)', () => {
    expect(masteryToPercent(toMasteryScore(0.49))).toBe(0);
  });
  it('the exact reported production value, 0.658199 -> 1, NOT 66 (0.658199 is already ~0.66 percentage points, not a 0.658 fraction)', () => {
    expect(masteryToPercent(toMasteryScore(0.658199))).toBe(1);
  });
  it('a real live-DB value, 1.65 -> 2', () => {
    expect(masteryToPercent(toMasteryScore(1.65))).toBe(2);
  });
  it('a real live-DB value, 5.30 -> 5', () => {
    expect(masteryToPercent(toMasteryScore(5.3))).toBe(5);
  });
  it('65.82 -> 66', () => {
    expect(masteryToPercent(toMasteryScore(65.82))).toBe(66);
  });
  it('85 -> 85', () => {
    expect(masteryToPercent(toMasteryScore(85))).toBe(85);
  });
  it('100 -> 100', () => {
    expect(masteryToPercent(toMasteryScore(100))).toBe(100);
  });
  it('null/undefined -> null, never 0 (unknown is not the same claim as zero)', () => {
    expect(masteryToPercent(null)).toBeNull();
    expect(masteryToPercent(undefined)).toBeNull();
  });
});

describe('toMasteryScore -- validates the real [0, 100] domain, never clamps, never guesses, never multiplies', () => {
  it('accepts every value genuinely in [0, 100], including small "just started" values', () => {
    expect(() => toMasteryScore(0)).not.toThrow();
    expect(() => toMasteryScore(0.658)).not.toThrow();
    expect(() => toMasteryScore(1.65)).not.toThrow();
    expect(() => toMasteryScore(5.3)).not.toThrow();
    expect(() => toMasteryScore(50)).not.toThrow();
    expect(() => toMasteryScore(85)).not.toThrow();
    expect(() => toMasteryScore(100)).not.toThrow();
  });

  it('a valid low mastery score like 1.65 or 5.30 is NOT rejected -- these are real values on the real scale, not corruption', () => {
    expect(toMasteryScore(1.65)).toBeCloseTo(1.65);
    expect(toMasteryScore(5.3)).toBeCloseTo(5.3);
  });

  it('rejects a value genuinely outside [0, 100]', () => {
    expect(() => toMasteryScore(100.1)).toThrow(InvalidMasteryScoreError);
    expect(() => toMasteryScore(150)).toThrow(InvalidMasteryScoreError);
    expect(() => toMasteryScore(-0.1)).toThrow(InvalidMasteryScoreError);
  });

  it('rejects non-finite input', () => {
    expect(() => toMasteryScore(NaN)).toThrow(InvalidMasteryScoreError);
    expect(() => toMasteryScore(Infinity)).toThrow(InvalidMasteryScoreError);
  });

  it('never silently clamps an out-of-range value into range', () => {
    let threw = false;
    try {
      toMasteryScore(150);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});

describe('tryMasteryScore -- same validation, but degrades to null (unknown) instead of throwing, for live read boundaries', () => {
  it('returns the score for a valid value, including small real values', () => {
    expect(tryMasteryScore(0.658199)).toBeCloseTo(0.658199);
    expect(tryMasteryScore(1.65)).toBeCloseTo(1.65);
    expect(tryMasteryScore(5.3)).toBeCloseTo(5.3);
  });
  it('returns null for null/undefined input', () => {
    expect(tryMasteryScore(null)).toBeNull();
    expect(tryMasteryScore(undefined)).toBeNull();
  });
  it('returns null (not a thrown error, not a clamped/guessed value) for a genuinely out-of-range input', () => {
    expect(tryMasteryScore(150)).toBeNull();
    expect(tryMasteryScore(-5)).toBeNull();
  });
  it('parses a numeric string (the shape mastery_records.mastery_score actually arrives in from pg)', () => {
    expect(tryMasteryScore('1.65')).toBeCloseTo(1.65);
  });
});

describe('formatMasteryPercent', () => {
  it('formats a known value with a trailing %, rounded, never multiplied', () => {
    expect(formatMasteryPercent(toMasteryScore(1.65))).toBe('2%');
    expect(formatMasteryPercent(toMasteryScore(5.3))).toBe('5%');
  });
  it('formats unknown as an em dash, not "0%"', () => {
    expect(formatMasteryPercent(null)).toBe('—');
  });
});

describe('formatMasteryDelta -- the production Results screen: 0 -> 0.658199 must show 0% -> 1% (+1), NOT 0% -> 66% (+66)', () => {
  it('old=0, new=0.658199 -> "+1"', () => {
    expect(formatMasteryDelta(toMasteryScore(0), toMasteryScore(0.658199))).toBe('+1');
  });
  it('never independently rounds each endpoint out of sync with what is displayed', () => {
    const oldScore = toMasteryScore(1.2);
    const newScore = toMasteryScore(1.65);
    // old rounds to 1%, new rounds to 2% -- delta shown must be +1 to match.
    expect(formatMasteryDelta(oldScore, newScore)).toBe('+1');
  });
  it('a negative delta is prefixed correctly, not double-signed', () => {
    expect(formatMasteryDelta(toMasteryScore(80), toMasteryScore(50))).toBe('-30');
  });
  it('treats a missing endpoint as 0 rather than throwing', () => {
    expect(formatMasteryDelta(null, toMasteryScore(50))).toBe('+50');
  });
});

describe('averageMasteryScore -- averages RAW values and rounds once at the end, per the forensic audit\'s worked example', () => {
  it('[1.65, 5.30] averages to 3.475 raw, displaying as 3% -- not round(2)+round(5) averaged to 4%', () => {
    const avg = averageMasteryScore([toMasteryScore(1.65), toMasteryScore(5.3)]);
    expect(avg).toBeCloseTo(3.475, 3);
    expect(masteryToPercent(avg)).toBe(3);
  });

  it('never produces a value outside [0, 100] for valid inputs -- mathematically bounded', () => {
    const avg = averageMasteryScore([toMasteryScore(20), toMasteryScore(70), toMasteryScore(100)]);
    expect(avg!).toBeGreaterThanOrEqual(0);
    expect(avg!).toBeLessThanOrEqual(100);
    expect(masteryToPercent(avg)).toBe(63);
  });

  it('empty input -> null, not 0 and not NaN', () => {
    expect(averageMasteryScore([])).toBeNull();
  });
});

describe('the double-conversion regression is now structurally impossible: no function in this module multiplies by 100', () => {
  it('masteryToPercent never multiplies -- verified across the full valid domain', () => {
    for (const raw of [0, 0.658199, 1.65, 5.3, 50, 65.82, 85, 100]) {
      expect(masteryToPercent(toMasteryScore(raw))).toBe(Math.round(raw));
    }
  });
});

describe('dimensionToPercent / formatDimensionPercent -- the separate Knowledge State scale, never mixed with mastery_records', () => {
  it('passes an in-range 0-100 value through, rounded', () => {
    expect(dimensionToPercent(70.4)).toBe(70);
  });
  it('clamps out-of-range values into 0-100', () => {
    expect(dimensionToPercent(150)).toBe(100);
    expect(dimensionToPercent(-5)).toBe(0);
  });
  it('null (insufficient evidence) is never coerced to 0', () => {
    expect(dimensionToPercent(null)).toBeNull();
    expect(formatDimensionPercent(null, 'Por validar')).toBe('Por validar');
  });
  it('a real 0 score is still shown as "0%", distinct from null', () => {
    expect(formatDimensionPercent(0, 'Por validar')).toBe('0%');
  });
});
