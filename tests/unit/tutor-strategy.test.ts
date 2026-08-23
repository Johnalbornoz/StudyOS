import { describe, it, expect } from 'vitest';
import { selectTutorStrategy, type StrategyInputs } from '@/services/tutor-strategy.service';

function inputs(overrides: Partial<StrategyInputs>): StrategyInputs {
  return {
    masteryScore: 80,
    retention: 80,
    independentMastery: 80,
    confidenceCalibrationLabel: 'WELL_CALIBRATED',
    transferScore: 80,
    hasRecurringMisconception: false,
    ...overrides,
  };
}

describe('selectTutorStrategy', () => {
  it('low mastery -> SCAFFOLD', () => {
    expect(selectTutorStrategy(inputs({ masteryScore: 30 }))).toBe('SCAFFOLD');
  });

  it('low retention (mastery otherwise fine) -> RETRIEVAL', () => {
    expect(selectTutorStrategy(inputs({ masteryScore: 80, retention: 30 }))).toBe('RETRIEVAL');
  });

  it('high confidence + wrong (overconfident) -> SOCRATIC', () => {
    expect(selectTutorStrategy(inputs({ confidenceCalibrationLabel: 'OVERCONFIDENT' }))).toBe('SOCRATIC');
  });

  it('low independence relative to mastery -> SCAFFOLD (reduced-scaffolding family)', () => {
    expect(selectTutorStrategy(inputs({ masteryScore: 85, retention: 85, independentMastery: 40 }))).toBe('SCAFFOLD');
  });

  it('high mastery + low transfer -> TRANSFER', () => {
    expect(selectTutorStrategy(inputs({ masteryScore: 85, retention: 85, independentMastery: 85, transferScore: 30 }))).toBe('TRANSFER');
  });

  it('recurring misconception -> CONTRAST (overrides everything else)', () => {
    expect(selectTutorStrategy(inputs({ masteryScore: 20, hasRecurringMisconception: true }))).toBe('CONTRAST');
  });

  it('everything strong -> CHALLENGE', () => {
    expect(selectTutorStrategy(inputs({ masteryScore: 90, retention: 90, independentMastery: 90, transferScore: 90 }))).toBe('CHALLENGE');
  });

  it('falls back to EXPLAIN when nothing else applies', () => {
    expect(selectTutorStrategy(inputs({ masteryScore: 65, retention: 65, independentMastery: 60, transferScore: null }))).toBe('EXPLAIN');
  });
});
