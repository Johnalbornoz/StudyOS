import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...args: any[]) => queryMock(...args) } }));
vi.mock('@/services/learner-model.service', () => ({ getLearnerConceptState: vi.fn() }));
vi.mock('@/services/cognitive-diagnosis.service', () => ({ getDiagnosis: vi.fn() }));

import { determineRemediationPattern } from '@/services/remediation.service';
import type { LearnerConceptState } from '@/services/learner-model.service';

beforeEach(() => {
  queryMock.mockReset();
});

function state(overrides: Partial<LearnerConceptState>): LearnerConceptState {
  return {
    masteryScore: 80,
    retention: 80,
    independentMastery: 80,
    evidenceStrength: 'HIGH',
    confidence: 80,
    confidenceCalibration: { score: 90, label: 'WELL_CALIBRATED', samples: 5 },
    ...overrides,
  };
}

describe('determineRemediationPattern', () => {
  it('is LOW_MASTERY with no evidence at all (treat as needing the full rebuild)', () => {
    expect(determineRemediationPattern(null)).toBe('LOW_MASTERY');
  });

  it('is LOW_MASTERY when mastery itself is weak', () => {
    expect(determineRemediationPattern(state({ masteryScore: 35 }))).toBe('LOW_MASTERY');
  });

  it('is OVERCONFIDENT when confidence calibration says so, even with decent mastery', () => {
    expect(
      determineRemediationPattern(state({ masteryScore: 70, confidenceCalibration: { score: 20, label: 'OVERCONFIDENT', samples: 5 } }))
    ).toBe('OVERCONFIDENT');
  });

  it('is LOW_RETENTION when mastery is fine but retention has decayed', () => {
    expect(determineRemediationPattern(state({ masteryScore: 75, retention: 30 }))).toBe('LOW_RETENTION');
  });

  it('is LOW_INDEPENDENCE when independent mastery lags well behind mastery', () => {
    expect(determineRemediationPattern(state({ masteryScore: 80, retention: 80, independentMastery: 40 }))).toBe('LOW_INDEPENDENCE');
  });

  it('is DEFAULT when every signal looks healthy', () => {
    expect(determineRemediationPattern(state({}))).toBe('DEFAULT');
  });

  it('mastery gap wins over other signals when multiple could apply', () => {
    expect(
      determineRemediationPattern(
        state({ masteryScore: 30, retention: 20, independentMastery: 10, confidenceCalibration: { score: 10, label: 'OVERCONFIDENT', samples: 5 } })
      )
    ).toBe('LOW_MASTERY');
  });
});
