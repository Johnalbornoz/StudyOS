/**
 * Phase 1E Step 29: Learning Velocity fixtures -- reaches provisional,
 * reaches validated, never reaches a milestone, already mastered before
 * temporal history began, large inactivity gap.
 */
import { describe, it, expect } from 'vitest';
import { computeLearningVelocity, aggregateLearningVelocity } from '@/lib/learner-twin/metrics/learning-velocity';
import { metricAvailable, metricUnavailable, type LearningVelocitySummary, type MetricResult } from '@/lib/learner-twin/metrics/types';

describe('computeLearningVelocity (pure)', () => {
  it('reaches provisional mastery -- calendarDays/activeStudyDays computed from real decision_events timing', () => {
    const result = computeLearningVelocity(
      '2026-08-01T10:00:00.000Z',
      ['2026-08-01', '2026-08-03', '2026-08-05', '2026-08-08'],
      '2026-08-08T09:00:00.000Z', // provisional reached
      undefined, // validated not reached
      'PROVISIONAL_MASTERY'
    );
    expect(result.provisionalMastery).toEqual({ reached: true, historyComplete: true, at: '2026-08-08T09:00:00.000Z' });
    expect(result.calendarDaysToProvisional).toBe(7);
    expect(result.activeStudyDaysToProvisional).toBe(4);
    expect(result.validatedMastery).toEqual({ reached: false, historyComplete: false, at: null });
    expect(result.calendarDaysToValidated).toBeNull();
  });

  it('reaches validated mastery -- both milestones distinct, never collapsed into one', () => {
    const result = computeLearningVelocity(
      '2026-08-01T10:00:00.000Z',
      ['2026-08-01', '2026-08-05', '2026-08-10', '2026-08-20'],
      '2026-08-05T10:00:00.000Z',
      '2026-08-20T10:00:00.000Z',
      'VALIDATED_MASTERY'
    );
    expect(result.provisionalMastery.at).toBe('2026-08-05T10:00:00.000Z');
    expect(result.validatedMastery.at).toBe('2026-08-20T10:00:00.000Z');
    expect(result.calendarDaysToProvisional).toBe(4);
    expect(result.calendarDaysToValidated).toBe(19);
    expect(result.calendarDaysToProvisional).not.toBe(result.calendarDaysToValidated);
  });

  it('never reaches any milestone -- both reached:false, current state below PROVISIONAL_MASTERY', () => {
    const result = computeLearningVelocity('2026-08-01T10:00:00.000Z', ['2026-08-01', '2026-08-02'], undefined, undefined, 'DEVELOPING');
    expect(result.provisionalMastery).toEqual({ reached: false, historyComplete: false, at: null });
    expect(result.validatedMastery).toEqual({ reached: false, historyComplete: false, at: null });
    expect(result.calendarDaysToProvisional).toBeNull();
  });

  it('already mastered before Phase 0E2 temporal history began (Step 6): current state implies the milestone, but no decision_events row exists -- historyComplete:false, NEVER estimated', () => {
    const result = computeLearningVelocity(
      '2026-01-01T10:00:00.000Z', // evidence predates the audit trail by months
      ['2026-01-01', '2026-01-05'],
      undefined, // no recorded transition event
      undefined,
      'VALIDATED_MASTERY' // but current state is already validated
    );
    expect(result.provisionalMastery).toEqual({ reached: true, historyComplete: false, at: null });
    expect(result.validatedMastery).toEqual({ reached: true, historyComplete: false, at: null });
    // No date was estimated or backfilled for either milestone.
    expect(result.calendarDaysToProvisional).toBeNull();
    expect(result.calendarDaysToValidated).toBeNull();
    expect(result.activeStudyDaysToProvisional).toBeNull();
    expect(result.activeStudyDaysToValidated).toBeNull();
  });

  it('large inactivity gap is reported honestly, not smoothed away', () => {
    const result = computeLearningVelocity('2026-06-01T10:00:00.000Z', ['2026-06-01', '2026-06-02', '2026-08-30'], undefined, undefined, 'DEVELOPING');
    expect(result.longestInactiveGapDays).toBe(89);
  });

  it('longestInactiveGapDays is null with fewer than 2 distinct active-study dates', () => {
    const result = computeLearningVelocity('2026-08-01T10:00:00.000Z', ['2026-08-01'], undefined, undefined, 'LEARNING');
    expect(result.longestInactiveGapDays).toBeNull();
  });
});

describe('aggregateLearningVelocity (Step 8): median across concepts, never a naive mean, coverage always visible', () => {
  function available(v: Partial<LearningVelocitySummary>): MetricResult<LearningVelocitySummary> {
    return metricAvailable({
      firstEvidenceAt: '2026-08-01T00:00:00.000Z',
      provisionalMastery: { reached: false, historyComplete: false, at: null },
      validatedMastery: { reached: false, historyComplete: false, at: null },
      calendarDaysToProvisional: null,
      activeStudyDaysToProvisional: null,
      calendarDaysToValidated: null,
      activeStudyDaysToValidated: null,
      longestInactiveGapDays: null,
      quality: { sourceType: 'DETERMINISTIC_DERIVATION', sampleSize: 1, lastUpdatedAt: null, modelVersion: 'v1' },
      ...v,
    });
  }

  it('one extreme long-duration concept does not distort the aggregate the way a mean would', () => {
    const perConcept = new Map<string, MetricResult<LearningVelocitySummary>>([
      ['c1', available({ provisionalMastery: { reached: true, historyComplete: true, at: 'x' }, calendarDaysToProvisional: 3 })],
      ['c2', available({ provisionalMastery: { reached: true, historyComplete: true, at: 'x' }, calendarDaysToProvisional: 5 })],
      ['c3', available({ provisionalMastery: { reached: true, historyComplete: true, at: 'x' }, calendarDaysToProvisional: 400 })], // extreme outlier
    ]);
    const aggregate = aggregateLearningVelocity(perConcept);
    // Median (5) is unaffected by the outlier; a naive mean (136) would be wildly skewed.
    expect(aggregate.medianCalendarDaysToProvisional).toBe(5);
    expect(aggregate.qualifyingConceptCount).toBe(3);
    expect(aggregate.totalConceptCount).toBe(3);
  });

  it('reports coverage honestly -- a concept with insufficient evidence is excluded from the median but counted in totalConceptCount', () => {
    const perConcept = new Map<string, MetricResult<LearningVelocitySummary>>([
      ['c1', available({ provisionalMastery: { reached: true, historyComplete: true, at: 'x' }, calendarDaysToProvisional: 10 })],
      ['c2', metricUnavailable('INSUFFICIENT_EVIDENCE', 'no evidence')],
    ]);
    const aggregate = aggregateLearningVelocity(perConcept);
    expect(aggregate.medianCalendarDaysToProvisional).toBe(10);
    expect(aggregate.qualifyingConceptCount).toBe(1);
    expect(aggregate.totalConceptCount).toBe(2);
  });

  it('empty input -> all medians null, zero coverage, never a fabricated 0', () => {
    const aggregate = aggregateLearningVelocity(new Map());
    expect(aggregate.medianCalendarDaysToProvisional).toBeNull();
    expect(aggregate.qualifyingConceptCount).toBe(0);
    expect(aggregate.totalConceptCount).toBe(0);
  });
});
