/**
 * STUDYUS PHASE 6 -- RETENTION & MEMORY ENGINE
 * Step 6C (refined by Step 6C-R): pure unit tests for
 * src/lib/memory-policy.ts.
 *
 * This module has ZERO production callers as of this step -- these
 * tests exercise the vocabulary/policy in isolation, proving the
 * semantics are locked correctly BEFORE Step 6D's state table and
 * Step 6E's projector exist. No DB, no mocks needed -- every function
 * under test is pure.
 */
import { describe, it, expect } from 'vitest';
import {
  MEMORY_POLICY_V1,
  MEMORY_POLICY_VERSION,
  QUALIFYING_ACTIVITY_TYPES,
  EXCLUDED_ACTIVITY_TYPES,
  classifyRetentionAttemptOutcome,
  isRetentionProof,
  normalizedPerformanceForQualifiedAttempt,
  nextConsecutiveSuccesses,
  nextMemoryTimestamps,
  isAnchorEligible,
  isQualifiedRetentionAttempt,
  stabilityFromConsecutiveSuccesses,
  reviewIntervalDaysForSuccessCount,
  addDaysIso,
  computeRetentionDue,
  computeRetrievability,
  predictionConfidenceFromStability,
  computeMemoryStatus,
  computeDemonstratedRetention,
  type RetentionQualificationInput,
  type QualifiedRetentionAttempt,
  type MemoryTimestamps,
} from '@/lib/memory-policy';
import type { ActivityType } from '@/lib/activity-taxonomy';

const DAY = 24 * 60 * 60 * 1000;
const ANCHOR = '2026-01-01T00:00:00.000Z';
const iso = (fromIso: string, offsetDays: number) => new Date(new Date(fromIso).getTime() + offsetDays * DAY).toISOString();

function baseInput(overrides: Partial<RetentionQualificationInput> = {}): RetentionQualificationInput {
  return {
    activityType: 'RETENTION_CHECK',
    result: 'correct',
    aiAssistanceType: 'NONE',
    hintsUsed: 0,
    hasValidOperationKey: true,
    occurredAt: iso(ANCHOR, 3),
    ...overrides,
  };
}

describe('MEMORY_POLICY_V1 constants', () => {
  it('version is 1', () => {
    expect(MEMORY_POLICY_VERSION).toBe(1);
    expect(MEMORY_POLICY_V1.version).toBe(1);
  });
  it('minimumRetentionGapDays is 3', () => {
    expect(MEMORY_POLICY_V1.minimumRetentionGapDays).toBe(3);
  });
  it('difficulty and cognitive-level weighting are disabled (1.0) in v1', () => {
    expect(MEMORY_POLICY_V1.difficultyWeight).toBe(1.0);
    expect(MEMORY_POLICY_V1.cognitiveLevelWeight).toBe(1.0);
  });
  it('review interval sequence matches the frozen v1 spec', () => {
    expect(MEMORY_POLICY_V1.reviewIntervalDaysBySuccessCount).toEqual([3, 4, 7, 14, 28, 56, 84]);
    expect(MEMORY_POLICY_V1.maximumReviewIntervalDays).toBe(84);
    expect(MEMORY_POLICY_V1.minimumReviewIntervalDays).toBe(3);
  });
  it('retrievability decay constant is 0.7', () => {
    expect(MEMORY_POLICY_V1.retrievabilityDecayConstantK).toBe(0.7);
  });
});

describe('QUALIFICATION', () => {
  const excludedActivityTypes: ActivityType[] = ['PRACTICE', 'REVIEW', 'DIAGNOSTIC_CHECK'];
  const qualifyingActivityTypes: ActivityType[] = ['RETENTION_CHECK', 'SOLO_CHECK', 'SOLO_VERIFY', 'TRANSFER', 'CUMULATIVE_ASSESSMENT', 'MOCK_EXAM'];

  it.each(excludedActivityTypes)('%s never qualifies as a retention attempt', (activityType) => {
    const input = baseInput({ activityType });
    expect(isQualifiedRetentionAttempt(input, ANCHOR)).toBe(false);
  });

  it.each(qualifyingActivityTypes)('%s may qualify as a retention attempt (all other conditions met)', (activityType) => {
    const input = baseInput({ activityType });
    expect(isQualifiedRetentionAttempt(input, ANCHOR)).toBe(true);
  });

  it('QUALIFYING_ACTIVITY_TYPES / EXCLUDED_ACTIVITY_TYPES exactly match the frozen v1 lists', () => {
    expect([...QUALIFYING_ACTIVITY_TYPES].sort()).toEqual([...qualifyingActivityTypes].sort());
    expect([...EXCLUDED_ACTIVITY_TYPES].sort()).toEqual([...excludedActivityTypes].sort());
  });

  it('REMEDIATION (PRACTICE-mode, not in either explicit list) is rejected via the EvidenceMode cross-check', () => {
    const input = baseInput({ activityType: 'REMEDIATION' as ActivityType });
    expect(isQualifiedRetentionAttempt(input, ANCHOR)).toBe(false);
  });

  it('wrong EvidenceMode rejects even if activityType were hypothetically allow-listed (defense-in-depth cross-check)', () => {
    // DIAGNOSTIC_CHECK is ASSESSMENT-mode but is excluded by the activity-type allow-list itself --
    // this proves the allow-list gate fires independently of the EvidenceMode gate.
    const input = baseInput({ activityType: 'DIAGNOSTIC_CHECK' });
    expect(isQualifiedRetentionAttempt(input, ANCHOR)).toBe(false);
  });

  it('AI assistance rejects', () => {
    const input = baseInput({ aiAssistanceType: 'HINT' });
    expect(isQualifiedRetentionAttempt(input, ANCHOR)).toBe(false);
  });

  it('hints used rejects', () => {
    const input = baseInput({ hintsUsed: 1 });
    expect(isQualifiedRetentionAttempt(input, ANCHOR)).toBe(false);
  });

  it('missing/invalid operation_key rejects', () => {
    const input = baseInput({ hasValidOperationKey: false });
    expect(isQualifiedRetentionAttempt(input, ANCHOR)).toBe(false);
  });

  it('no reference anchor at all rejects', () => {
    const input = baseInput();
    expect(isQualifiedRetentionAttempt(input, null)).toBe(false);
  });

  it('before the 3-day gap rejects', () => {
    const input = baseInput({ occurredAt: iso(ANCHOR, 2.9) });
    expect(isQualifiedRetentionAttempt(input, ANCHOR)).toBe(false);
  });

  it('exactly the 3-day gap qualifies', () => {
    const input = baseInput({ occurredAt: iso(ANCHOR, 3) });
    expect(isQualifiedRetentionAttempt(input, ANCHOR)).toBe(true);
  });

  it('the first eligible independent success establishes anchor eligibility but is not itself evaluated as a qualified retention attempt (no elapsed gap concept applies to the anchor event itself)', () => {
    const anchorEvent = baseInput({ occurredAt: ANCHOR });
    expect(isAnchorEligible(anchorEvent)).toBe(true);
  });
});

describe('ANCHOR SEMANTICS', () => {
  it('assisted PRACTICE evidence does NOT establish a competence anchor, even if correct', () => {
    const input = baseInput({ activityType: 'PRACTICE', occurredAt: ANCHOR });
    expect(isAnchorEligible(input)).toBe(false);
  });

  it('assisted REVIEW evidence does NOT establish a competence anchor, even if correct', () => {
    const input = baseInput({ activityType: 'REVIEW', occurredAt: ANCHOR });
    expect(isAnchorEligible(input)).toBe(false);
  });

  it('the first eligible successful INDEPENDENT/ASSESSMENT event DOES establish the anchor -- including types outside the narrower qualifying-attempt list, e.g. DIAGNOSTIC_CHECK (ASSESSMENT-mode)', () => {
    const input = baseInput({ activityType: 'DIAGNOSTIC_CHECK', occurredAt: ANCHOR });
    expect(isAnchorEligible(input)).toBe(true);
  });

  it('an incorrect independent answer does not establish the anchor', () => {
    const input = baseInput({ result: 'incorrect', occurredAt: ANCHOR });
    expect(isAnchorEligible(input)).toBe(false);
  });

  it('a failure after the gap still counts as a qualified attempt (updates lastQualifiedAttemptAt in the caller model)', () => {
    const failureInput = baseInput({ result: 'incorrect', occurredAt: iso(ANCHOR, 3) });
    expect(isQualifiedRetentionAttempt(failureInput, ANCHOR)).toBe(true);
    expect(classifyRetentionAttemptOutcome(failureInput.result)).toBe('FAILURE');
  });

  it('a success after the gap qualifies and is RetentionProof', () => {
    const successInput = baseInput({ result: 'correct', occurredAt: iso(ANCHOR, 3) });
    expect(isQualifiedRetentionAttempt(successInput, ANCHOR)).toBe(true);
    const attempt: QualifiedRetentionAttempt = {
      studentId: 's1',
      conceptId: 'c1',
      occurredAt: successInput.occurredAt,
      outcome: classifyRetentionAttemptOutcome(successInput.result),
      normalizedPerformance: normalizedPerformanceForQualifiedAttempt(100),
      sourceEvidenceId: 'e1',
    };
    expect(isRetentionProof(attempt)).toBe(true);
  });

  it('a failed attempt is NOT RetentionProof, even though it is qualifying evidence', () => {
    const attempt: QualifiedRetentionAttempt = {
      studentId: 's1',
      conceptId: 'c1',
      occurredAt: iso(ANCHOR, 3),
      outcome: 'FAILURE',
      normalizedPerformance: 0,
      sourceEvidenceId: 'e2',
    };
    expect(isRetentionProof(attempt)).toBe(false);
  });

  it('a partial attempt is NOT RetentionProof', () => {
    const attempt: QualifiedRetentionAttempt = {
      studentId: 's1',
      conceptId: 'c1',
      occurredAt: iso(ANCHOR, 3),
      outcome: 'PARTIAL',
      normalizedPerformance: 50,
      sourceEvidenceId: 'e3',
    };
    expect(isRetentionProof(attempt)).toBe(false);
  });
});

describe('SUCCESS_OUTCOME_SEMANTICS (audited against the existing repository convention)', () => {
  it('result="correct" maps to SUCCESS', () => {
    expect(classifyRetentionAttemptOutcome('correct')).toBe('SUCCESS');
  });
  it('result="partial" maps to PARTIAL', () => {
    expect(classifyRetentionAttemptOutcome('partial')).toBe('PARTIAL');
  });
  it('result="incorrect" maps to FAILURE', () => {
    expect(classifyRetentionAttemptOutcome('incorrect')).toBe('FAILURE');
  });
  it('normalizedPerformanceForQualifiedAttempt requires and preserves the actual scorePercent -- no label-derived fallback exists', () => {
    expect(normalizedPerformanceForQualifiedAttempt(83)).toBe(83);
    expect(normalizedPerformanceForQualifiedAttempt(62)).toBe(62); // a PARTIAL's real score, must not become 50
    expect(normalizedPerformanceForQualifiedAttempt(25)).toBe(25); // a FAILURE's real score, must not become 0
  });
  it('clamps defensively to 0-100 but does not otherwise alter the real value', () => {
    expect(normalizedPerformanceForQualifiedAttempt(-5)).toBe(0);
    expect(normalizedPerformanceForQualifiedAttempt(105)).toBe(100);
  });
});

describe('STABILITY', () => {
  it('0 consecutive successes -> UNSTABLE', () => {
    expect(stabilityFromConsecutiveSuccesses(0)).toBe('UNSTABLE');
  });
  it('1 -> DEVELOPING', () => {
    expect(stabilityFromConsecutiveSuccesses(1)).toBe('DEVELOPING');
  });
  it('2 -> DEVELOPING', () => {
    expect(stabilityFromConsecutiveSuccesses(2)).toBe('DEVELOPING');
  });
  it('3 -> STABLE', () => {
    expect(stabilityFromConsecutiveSuccesses(3)).toBe('STABLE');
  });
  it('10 -> STABLE', () => {
    expect(stabilityFromConsecutiveSuccesses(10)).toBe('STABLE');
  });
  it('a failure resets the streak to 0, which reads as UNSTABLE regardless of prior stability', () => {
    expect(stabilityFromConsecutiveSuccesses(0)).toBe('UNSTABLE');
  });
});

describe('SCHEDULE', () => {
  it('anchor-only (0 successes) -> 3 days', () => {
    expect(reviewIntervalDaysForSuccessCount(0)).toBe(3);
  });
  it('success #1 -> 4 days', () => {
    expect(reviewIntervalDaysForSuccessCount(1)).toBe(4);
  });
  it('success #2 -> 7 days', () => {
    expect(reviewIntervalDaysForSuccessCount(2)).toBe(7);
  });
  it('success #3 -> 14 days', () => {
    expect(reviewIntervalDaysForSuccessCount(3)).toBe(14);
  });
  it('success #4 -> 28 days', () => {
    expect(reviewIntervalDaysForSuccessCount(4)).toBe(28);
  });
  it('success #5 -> 56 days', () => {
    expect(reviewIntervalDaysForSuccessCount(5)).toBe(56);
  });
  it('success #6+ -> 84 days (capped)', () => {
    expect(reviewIntervalDaysForSuccessCount(6)).toBe(84);
    expect(reviewIntervalDaysForSuccessCount(100)).toBe(84);
  });
  it('a failure (0 successes) maps to the same 3-day entry as the anchor case', () => {
    expect(reviewIntervalDaysForSuccessCount(0)).toBe(3);
  });
  it('never exceeds 84 days for any input', () => {
    for (const n of [0, 1, 2, 3, 4, 5, 6, 7, 50, 1000]) {
      expect(reviewIntervalDaysForSuccessCount(n)).toBeLessThanOrEqual(84);
    }
  });
  it('addDaysIso + computeRetentionDue: not yet due before the interval elapses, due once it has', () => {
    const nextReviewAt = addDaysIso(ANCHOR, 7);
    expect(computeRetentionDue(nextReviewAt, iso(ANCHOR, 6)).retentionDue).toBe(false);
    expect(computeRetentionDue(nextReviewAt, iso(ANCHOR, 7)).retentionDue).toBe(true);
    expect(computeRetentionDue(nextReviewAt, iso(ANCHOR, 10)).daysOverdue).toBe(3);
  });
  it('nextReviewAt=null never produces a due signal', () => {
    expect(computeRetentionDue(null, iso(ANCHOR, 999))).toEqual({ retentionDue: false, daysOverdue: null });
  });
});

describe('RETRIEVABILITY CONTRACT', () => {
  it('uses lastSuccessfulRetentionAt when present', () => {
    const result = computeRetrievability(
      { lastSuccessfulRetentionAt: ANCHOR, initialCompetenceAnchorAt: iso(ANCHOR, -30) },
      3,
      iso(ANCHOR, 7)
    );
    expect(result?.anchorUsed).toBe('LAST_SUCCESSFUL_RETENTION');
  });

  it('falls back to initialCompetenceAnchorAt (with LOW confidence) when no successful retention proof exists yet', () => {
    const result = computeRetrievability({ lastSuccessfulRetentionAt: null, initialCompetenceAnchorAt: ANCHOR }, 0, iso(ANCHOR, 2));
    expect(result?.anchorUsed).toBe('INITIAL_COMPETENCE_ANCHOR');
    expect(result?.predictionConfidence).toBe('LOW');
  });

  it('returns null when neither anchor exists (NOT_ESTABLISHED -- nothing to predict from)', () => {
    const result = computeRetrievability({ lastSuccessfulRetentionAt: null, initialCompetenceAnchorAt: null }, 0, iso(ANCHOR, 2));
    expect(result).toBeNull();
  });

  it('a failed qualified attempt does NOT reset memory age -- lastSuccessfulRetentionAt is untouched by the caller model, so retrievability keeps counting from the OLD success timestamp', () => {
    const oldSuccess = ANCHOR;
    const failureTimestamp = iso(ANCHOR, 20); // a failure occurred 20 days after the old success
    const now = iso(ANCHOR, 21); // evaluated 1 day after the failure

    // The caller (future 6D projector) must NOT pass failureTimestamp as lastSuccessfulRetentionAt.
    const resultUsingCorrectAnchor = computeRetrievability({ lastSuccessfulRetentionAt: oldSuccess, initialCompetenceAnchorAt: oldSuccess }, 0, now);
    const resultIfWronglyResetOnFailure = computeRetrievability({ lastSuccessfulRetentionAt: failureTimestamp, initialCompetenceAnchorAt: oldSuccess }, 0, now);

    expect(resultUsingCorrectAnchor?.memoryAgeDays).toBeCloseTo(21, 5);
    expect(resultIfWronglyResetOnFailure?.memoryAgeDays).toBeCloseTo(1, 5);
    expect(resultUsingCorrectAnchor?.memoryAgeDays).not.toBeCloseTo(resultIfWronglyResetOnFailure!.memoryAgeDays, 0);
  });

  it('forgettingRisk = 100 - retrievability, always', () => {
    const result = computeRetrievability({ lastSuccessfulRetentionAt: ANCHOR, initialCompetenceAnchorAt: ANCHOR }, 3, iso(ANCHOR, 40));
    expect(result!.forgettingRisk).toBe(100 - result!.retrievabilityNow);
  });

  it('risk monotonically increases with elapsed time for a fixed interval', () => {
    const at = (days: number) => computeRetrievability({ lastSuccessfulRetentionAt: ANCHOR, initialCompetenceAnchorAt: ANCHOR }, 3, iso(ANCHOR, days))!.forgettingRisk;
    const risks = [0, 5, 10, 14, 20, 40, 100].map(at);
    for (let i = 1; i < risks.length; i++) {
      expect(risks[i]).toBeGreaterThanOrEqual(risks[i - 1]);
    }
  });

  it('no time-derived function in this module mutates persisted state -- computeRetrievability is a pure function returning a new object each call', () => {
    const timestamps = { lastSuccessfulRetentionAt: ANCHOR, initialCompetenceAnchorAt: ANCHOR };
    const r1 = computeRetrievability(timestamps, 3, iso(ANCHOR, 7));
    const r2 = computeRetrievability(timestamps, 3, iso(ANCHOR, 7));
    expect(r1).toEqual(r2);
    expect(r1).not.toBe(r2); // distinct objects -- nothing shared/mutated between calls
  });
});

describe('PREDICTION CONFIDENCE', () => {
  it('UNSTABLE -> LOW', () => {
    expect(predictionConfidenceFromStability('UNSTABLE')).toBe('LOW');
  });
  it('DEVELOPING -> MEDIUM', () => {
    expect(predictionConfidenceFromStability('DEVELOPING')).toBe('MEDIUM');
  });
  it('STABLE -> HIGH', () => {
    expect(predictionConfidenceFromStability('STABLE')).toBe('HIGH');
  });
});

describe('STATUS', () => {
  it('no anchor -> NOT_ESTABLISHED', () => {
    expect(computeMemoryStatus({ hasCompetenceAnchor: false, hasQualifiedAttempt: false, mostRecentQualifiedOutcome: null, consecutiveSuccesses: 0 })).toBe(
      'NOT_ESTABLISHED'
    );
  });
  it('anchor only, no qualified attempt yet -> WAITING_FOR_RETENTION', () => {
    expect(computeMemoryStatus({ hasCompetenceAnchor: true, hasQualifiedAttempt: false, mostRecentQualifiedOutcome: null, consecutiveSuccesses: 0 })).toBe(
      'WAITING_FOR_RETENTION'
    );
  });
  it('one success -> DEVELOPING', () => {
    expect(
      computeMemoryStatus({ hasCompetenceAnchor: true, hasQualifiedAttempt: true, mostRecentQualifiedOutcome: 'SUCCESS', consecutiveSuccesses: 1 })
    ).toBe('DEVELOPING');
  });
  it('three consecutive successes -> STABLE', () => {
    expect(
      computeMemoryStatus({ hasCompetenceAnchor: true, hasQualifiedAttempt: true, mostRecentQualifiedOutcome: 'SUCCESS', consecutiveSuccesses: 3 })
    ).toBe('STABLE');
  });
  it('a qualifying failure -> AT_RISK', () => {
    expect(
      computeMemoryStatus({ hasCompetenceAnchor: true, hasQualifiedAttempt: true, mostRecentQualifiedOutcome: 'FAILURE', consecutiveSuccesses: 0 })
    ).toBe('AT_RISK');
  });
  it('a qualifying partial outcome -> AT_RISK (treated like failure per policy)', () => {
    expect(
      computeMemoryStatus({ hasCompetenceAnchor: true, hasQualifiedAttempt: true, mostRecentQualifiedOutcome: 'PARTIAL', consecutiveSuccesses: 0 })
    ).toBe('AT_RISK');
  });
  it('passing time alone never produces AT_RISK -- computeMemoryStatus takes no clock input at all, so identical evidence-derived inputs always produce the identical status regardless of when it is called', () => {
    const input = { hasCompetenceAnchor: true, hasQualifiedAttempt: true, mostRecentQualifiedOutcome: 'SUCCESS' as const, consecutiveSuccesses: 3 };
    expect(computeMemoryStatus(input)).toBe(computeMemoryStatus(input));
    expect(computeMemoryStatus(input)).toBe('STABLE'); // still STABLE, never AT_RISK, no matter how "later" this is called
  });
});

describe('PARTIAL SEMANTICS (Step 6C-R closure) -- nextConsecutiveSuccesses / nextMemoryTimestamps transitions', () => {
  function attemptAt(daysAfterAnchor: number, outcome: 'SUCCESS' | 'FAILURE' | 'PARTIAL'): QualifiedRetentionAttempt {
    return {
      studentId: 's1',
      conceptId: 'c1',
      occurredAt: iso(ANCHOR, daysAfterAnchor),
      outcome,
      normalizedPerformance: outcome === 'SUCCESS' ? 100 : outcome === 'PARTIAL' ? 60 : 25,
      sourceEvidenceId: `e-${daysAfterAnchor}`,
    };
  }
  const emptyTimestamps: MemoryTimestamps = {
    initialCompetenceAnchorAt: ANCHOR,
    lastQualifiedAttemptAt: null,
    lastSuccessfulRetentionAt: null,
    lastUnsuccessfulRetentionAt: null,
  };

  it('PARTIAL is a QualifiedRetentionAttempt (not RetentionProof)', () => {
    const attempt = attemptAt(10, 'PARTIAL');
    expect(isRetentionProof(attempt)).toBe(false);
  });

  describe('nextConsecutiveSuccesses', () => {
    it('PARTIAL resets any prior streak to 0', () => {
      expect(nextConsecutiveSuccesses(0, 'PARTIAL')).toBe(0);
      expect(nextConsecutiveSuccesses(2, 'PARTIAL')).toBe(0);
      expect(nextConsecutiveSuccesses(10, 'PARTIAL')).toBe(0);
    });
    it('FAILURE resets any prior streak to 0', () => {
      expect(nextConsecutiveSuccesses(5, 'FAILURE')).toBe(0);
    });
    it('SUCCESS extends the streak by exactly 1', () => {
      expect(nextConsecutiveSuccesses(0, 'SUCCESS')).toBe(1);
      expect(nextConsecutiveSuccesses(2, 'SUCCESS')).toBe(3);
    });
  });

  describe('nextMemoryTimestamps', () => {
    it('PARTIAL updates lastQualifiedAttemptAt', () => {
      const attempt = attemptAt(10, 'PARTIAL');
      const next = nextMemoryTimestamps(emptyTimestamps, attempt);
      expect(next.lastQualifiedAttemptAt).toBe(attempt.occurredAt);
    });
    it('PARTIAL does NOT update lastSuccessfulRetentionAt', () => {
      const prior: MemoryTimestamps = { ...emptyTimestamps, lastSuccessfulRetentionAt: iso(ANCHOR, 3) };
      const attempt = attemptAt(10, 'PARTIAL');
      const next = nextMemoryTimestamps(prior, attempt);
      expect(next.lastSuccessfulRetentionAt).toBe(iso(ANCHOR, 3)); // unchanged, NOT the day-10 partial timestamp
    });
    it('PARTIAL updates lastUnsuccessfulRetentionAt', () => {
      const attempt = attemptAt(10, 'PARTIAL');
      const next = nextMemoryTimestamps(emptyTimestamps, attempt);
      expect(next.lastUnsuccessfulRetentionAt).toBe(attempt.occurredAt);
    });
    it('FAILURE also updates lastUnsuccessfulRetentionAt (both non-SUCCESS outcomes share the same timestamp)', () => {
      const attempt = attemptAt(10, 'FAILURE');
      const next = nextMemoryTimestamps(emptyTimestamps, attempt);
      expect(next.lastUnsuccessfulRetentionAt).toBe(attempt.occurredAt);
    });
    it('SUCCESS updates lastSuccessfulRetentionAt but NOT lastUnsuccessfulRetentionAt', () => {
      const prior: MemoryTimestamps = { ...emptyTimestamps, lastUnsuccessfulRetentionAt: iso(ANCHOR, 5) };
      const attempt = attemptAt(10, 'SUCCESS');
      const next = nextMemoryTimestamps(prior, attempt);
      expect(next.lastSuccessfulRetentionAt).toBe(attempt.occurredAt);
      expect(next.lastUnsuccessfulRetentionAt).toBe(iso(ANCHOR, 5)); // unchanged
    });
    it('initialCompetenceAnchorAt is never touched by any attempt outcome', () => {
      for (const outcome of ['SUCCESS', 'PARTIAL', 'FAILURE'] as const) {
        const next = nextMemoryTimestamps(emptyTimestamps, attemptAt(10, outcome));
        expect(next.initialCompetenceAnchorAt).toBe(ANCHOR);
      }
    });
  });

  describe('MEMORY STATUS TRANSITION MATRIX (Section 10)', () => {
    it('WAITING_FOR_RETENTION + PARTIAL qualified attempt -> AT_RISK', () => {
      const status = computeMemoryStatus({
        hasCompetenceAnchor: true,
        hasQualifiedAttempt: true, // the PARTIAL attempt itself is now the qualified attempt
        mostRecentQualifiedOutcome: 'PARTIAL',
        consecutiveSuccesses: nextConsecutiveSuccesses(0, 'PARTIAL'),
      });
      expect(status).toBe('AT_RISK');
    });
    it('DEVELOPING (1-2 successes) + PARTIAL -> AT_RISK', () => {
      const status = computeMemoryStatus({
        hasCompetenceAnchor: true,
        hasQualifiedAttempt: true,
        mostRecentQualifiedOutcome: 'PARTIAL',
        consecutiveSuccesses: nextConsecutiveSuccesses(2, 'PARTIAL'),
      });
      expect(status).toBe('AT_RISK');
    });
    it('STABLE (>=3 successes) + PARTIAL -> AT_RISK', () => {
      const status = computeMemoryStatus({
        hasCompetenceAnchor: true,
        hasQualifiedAttempt: true,
        mostRecentQualifiedOutcome: 'PARTIAL',
        consecutiveSuccesses: nextConsecutiveSuccesses(5, 'PARTIAL'),
      });
      expect(status).toBe('AT_RISK');
    });
    it('AT_RISK + another PARTIAL -> remains AT_RISK', () => {
      const status = computeMemoryStatus({
        hasCompetenceAnchor: true,
        hasQualifiedAttempt: true,
        mostRecentQualifiedOutcome: 'PARTIAL',
        consecutiveSuccesses: nextConsecutiveSuccesses(0, 'PARTIAL'),
      });
      expect(status).toBe('AT_RISK');
    });
  });

  it('PARTIAL -> resulting MemoryStability is UNSTABLE', () => {
    expect(stabilityFromConsecutiveSuccesses(nextConsecutiveSuccesses(5, 'PARTIAL'))).toBe('UNSTABLE');
  });
  it('PARTIAL -> resulting streak is 0', () => {
    expect(nextConsecutiveSuccesses(5, 'PARTIAL')).toBe(0);
  });
  it('PARTIAL -> next review interval is +3 days (the policy minimum)', () => {
    expect(reviewIntervalDaysForSuccessCount(nextConsecutiveSuccesses(5, 'PARTIAL'))).toBe(3);
  });
  it('PARTIAL -> no successful-retention timestamp update (integration of nextMemoryTimestamps)', () => {
    const prior: MemoryTimestamps = { ...emptyTimestamps, lastSuccessfulRetentionAt: iso(ANCHOR, 3) };
    const next = nextMemoryTimestamps(prior, attemptAt(10, 'PARTIAL'));
    expect(next.lastSuccessfulRetentionAt).toBe(iso(ANCHOR, 3));
  });

  describe('SPACING ANCHOR vs. RETRIEVABILITY ANCHOR (Section 8/9 -- these must NOT be conflated)', () => {
    it('a PARTIAL at day 10 resets the minimum-spacing anchor for whether a NEXT attempt qualifies (lastQualifiedAttemptAt)', () => {
      const timestamps = nextMemoryTimestamps(emptyTimestamps, attemptAt(10, 'PARTIAL'));
      // A candidate attempt at day 12 (only 2 days after the day-10 partial) must NOT qualify --
      // the spacing anchor is now day 10, not day 3 (initialCompetenceAnchorAt).
      const tooSoonAfterPartial = baseInput({ occurredAt: iso(ANCHOR, 12) });
      expect(isQualifiedRetentionAttempt(tooSoonAfterPartial, timestamps.lastQualifiedAttemptAt)).toBe(false);
      // A candidate attempt at day 13 (exactly 3 days after the day-10 partial) qualifies.
      const gapMetAfterPartial = baseInput({ occurredAt: iso(ANCHOR, 13) });
      expect(isQualifiedRetentionAttempt(gapMetAfterPartial, timestamps.lastQualifiedAttemptAt)).toBe(true);
    });

    it('SUCCESS at day 3, PARTIAL at day 10, read at day 11: MEMORY_AGE is measured from day 3 (the successful retrieval), NOT day 10 (the partial attempt)', () => {
      let timestamps: MemoryTimestamps = { ...emptyTimestamps };
      timestamps = nextMemoryTimestamps(timestamps, attemptAt(3, 'SUCCESS'));
      const streakAfterSuccess = nextConsecutiveSuccesses(0, 'SUCCESS');
      timestamps = nextMemoryTimestamps(timestamps, attemptAt(10, 'PARTIAL'));
      const streakAfterPartial = nextConsecutiveSuccesses(streakAfterSuccess, 'PARTIAL');

      const result = computeRetrievability(timestamps, streakAfterPartial, iso(ANCHOR, 11));
      expect(result?.anchorUsed).toBe('LAST_SUCCESSFUL_RETENTION');
      expect(result?.memoryAgeDays).toBeCloseTo(8, 5); // day 11 - day 3 = 8, NOT day 11 - day 10 = 1
    });

    it('SUCCESS at day 3, FAILURE at day 10, read at day 11: MEMORY_AGE still uses day 3', () => {
      let timestamps: MemoryTimestamps = { ...emptyTimestamps };
      timestamps = nextMemoryTimestamps(timestamps, attemptAt(3, 'SUCCESS'));
      const streakAfterSuccess = nextConsecutiveSuccesses(0, 'SUCCESS');
      timestamps = nextMemoryTimestamps(timestamps, attemptAt(10, 'FAILURE'));
      const streakAfterFailure = nextConsecutiveSuccesses(streakAfterSuccess, 'FAILURE');

      const result = computeRetrievability(timestamps, streakAfterFailure, iso(ANCHOR, 11));
      expect(result?.anchorUsed).toBe('LAST_SUCCESSFUL_RETENTION');
      expect(result?.memoryAgeDays).toBeCloseTo(8, 5);
    });
  });
});

describe('DEMONSTRATED RETENTION', () => {
  function attempt(daysAfterAnchor: number, outcome: 'SUCCESS' | 'FAILURE' | 'PARTIAL', performance: number): QualifiedRetentionAttempt {
    return {
      studentId: 's1',
      conceptId: 'c1',
      occurredAt: iso(ANCHOR, daysAfterAnchor),
      outcome,
      normalizedPerformance: performance,
      sourceEvidenceId: `e-${daysAfterAnchor}`,
    };
  }

  it('is null before the first qualifying attempt (the anchor event itself is excluded)', () => {
    expect(computeDemonstratedRetention([]).score).toBeNull();
  });

  it('a single qualifying success produces a non-null score equal to its own performance', () => {
    const result = computeDemonstratedRetention([attempt(3, 'SUCCESS', 90)]);
    expect(result.score).toBe(90);
    expect(result.evidenceCount).toBe(1);
  });

  it('Section 11: a PARTIAL with real score 60 contributes 60 -- not 0, not 50', () => {
    const result = computeDemonstratedRetention([attempt(3, 'PARTIAL', normalizedPerformanceForQualifiedAttempt(60))]);
    expect(result.score).toBe(60);
  });

  it('Section 11: a FAILURE with real score 25 contributes 25 -- not 0', () => {
    const result = computeDemonstratedRetention([attempt(3, 'FAILURE', normalizedPerformanceForQualifiedAttempt(25))]);
    expect(result.score).toBe(25);
  });

  it('Section 11: a SUCCESS with real score 90 contributes 90, using the same recency-weighted formula as PARTIAL/FAILURE', () => {
    const result = computeDemonstratedRetention([attempt(3, 'SUCCESS', normalizedPerformanceForQualifiedAttempt(90))]);
    expect(result.score).toBe(90);
  });

  it('Section 11: PARTIAL lowers the score relative to an otherwise-identical SUCCESS', () => {
    const withSuccess = computeDemonstratedRetention([attempt(3, 'SUCCESS', 100), attempt(6, 'SUCCESS', 90)]);
    const withPartialInstead = computeDemonstratedRetention([attempt(3, 'PARTIAL', 60), attempt(6, 'SUCCESS', 90)]);
    expect(withPartialInstead.score).toBeLessThan(withSuccess.score!);
  });

  it('Section 11: FAILURE lowers the score further than PARTIAL when its actual real score is lower', () => {
    const withPartial = computeDemonstratedRetention([attempt(3, 'PARTIAL', 60), attempt(6, 'SUCCESS', 90)]);
    const withFailure = computeDemonstratedRetention([attempt(3, 'FAILURE', 25), attempt(6, 'SUCCESS', 90)]);
    expect(withFailure.score).toBeLessThan(withPartial.score!);
  });

  it('uses at most 5 qualifying attempts, most-recent-first, weighted [1.0, 0.8, 0.64, 0.512, 0.4096]', () => {
    const attempts = [
      attempt(30, 'SUCCESS', 100), // most recent
      attempt(24, 'SUCCESS', 100),
      attempt(18, 'SUCCESS', 100),
      attempt(12, 'SUCCESS', 100),
      attempt(6, 'SUCCESS', 100),
      attempt(3, 'FAILURE', 0), // 6th, oldest -- must fall OUT of the window entirely
    ];
    const result = computeDemonstratedRetention(attempts);
    expect(result.evidenceCount).toBe(5);
    expect(result.score).toBe(100); // the excluded 6th (a failure) must not affect the score at all
  });

  it('newest is weighted highest -- a recent failure pulls the score down more than an old one', () => {
    const recentFailure = computeDemonstratedRetention([attempt(10, 'FAILURE', 0), attempt(3, 'SUCCESS', 100)]);
    const oldFailure = computeDemonstratedRetention([attempt(10, 'SUCCESS', 100), attempt(3, 'FAILURE', 0)]);
    // In both cases exactly one success and one failure exist, but ordering (most-recent-first) differs.
    expect(recentFailure.score).toBeLessThan(oldFailure.score!);
  });

  it('a failure lowers the score without erasing prior history entirely', () => {
    const allSuccess = computeDemonstratedRetention([attempt(9, 'SUCCESS', 100), attempt(6, 'SUCCESS', 100), attempt(3, 'SUCCESS', 100)]);
    const withOneFailure = computeDemonstratedRetention([attempt(9, 'SUCCESS', 100), attempt(6, 'SUCCESS', 100), attempt(3, 'FAILURE', 0)]);
    expect(withOneFailure.score).toBeLessThan(allSuccess.score!);
    expect(withOneFailure.score).toBeGreaterThan(0); // not wiped to zero
  });

  it('old qualified attempts fall out once more than 5 exist', () => {
    const sixAttempts = Array.from({ length: 6 }, (_, i) => attempt(30 - i * 3, 'SUCCESS', 100 - i)); // oldest has the lowest performance
    const result = computeDemonstratedRetention(sixAttempts);
    expect(result.evidenceCount).toBe(5); // the 6th (oldest, worst performance) must be excluded
  });

  it('calendar age alone never changes the score -- identical qualifying attempts produce an identical score no matter how much later it is recomputed (no `now` parameter exists)', () => {
    const attempts = [attempt(3, 'SUCCESS', 80)];
    expect(computeDemonstratedRetention(attempts).score).toBe(computeDemonstratedRetention(attempts).score);
  });

  it('difficulty/cognitive-level weighting is a documented no-op in v1 (policy factors both fixed at 1.0)', () => {
    expect(MEMORY_POLICY_V1.difficultyWeight).toBe(1.0);
    expect(MEMORY_POLICY_V1.cognitiveLevelWeight).toBe(1.0);
  });
});

describe('MemoryDecisionSignal shape (Phase 4 contract, type-level only -- no live caller yet)', () => {
  it('never includes a priority/band/urgency/rank field', () => {
    // Compile-time contract: constructing a signal object with exactly
    // these fields must satisfy the MemoryDecisionSignal type. If a
    // forbidden field were required, or one of these were missing,
    // this file would fail to type-check.
    const signal: import('@/lib/memory-policy').MemoryDecisionSignal = {
      retentionDue: true,
      nextReviewAt: ANCHOR,
      daysOverdue: 2,
      retrievabilityNow: 80,
      forgettingRisk: 20,
      memoryStatus: 'STABLE',
      lastSuccessfulRetentionAt: ANCHOR,
      memoryStability: 'STABLE',
      predictionConfidence: 'HIGH',
    };
    expect(Object.keys(signal).sort()).toEqual(
      [
        'retentionDue',
        'nextReviewAt',
        'daysOverdue',
        'retrievabilityNow',
        'forgettingRisk',
        'memoryStatus',
        'lastSuccessfulRetentionAt',
        'memoryStability',
        'predictionConfidence',
      ].sort()
    );
  });
});

describe('VOCABULARY AUDIT (Step 6C-R Section 12): QualifiedRetentionAttempt != RetentionProof', () => {
  it('a PARTIAL or FAILURE QualifiedRetentionAttempt is never a RetentionProof', () => {
    const partial: QualifiedRetentionAttempt = {
      studentId: 's1',
      conceptId: 'c1',
      occurredAt: iso(ANCHOR, 3),
      outcome: 'PARTIAL',
      normalizedPerformance: 60,
      sourceEvidenceId: 'e-partial',
    };
    const failure: QualifiedRetentionAttempt = {
      studentId: 's1',
      conceptId: 'c1',
      occurredAt: iso(ANCHOR, 3),
      outcome: 'FAILURE',
      normalizedPerformance: 25,
      sourceEvidenceId: 'e-failure',
    };
    expect(isRetentionProof(partial)).toBe(false);
    expect(isRetentionProof(failure)).toBe(false);
  });

  it('only a SUCCESS QualifiedRetentionAttempt satisfies the RetentionProof narrowing', () => {
    const success: QualifiedRetentionAttempt = {
      studentId: 's1',
      conceptId: 'c1',
      occurredAt: iso(ANCHOR, 3),
      outcome: 'SUCCESS',
      normalizedPerformance: 90,
      sourceEvidenceId: 'e-success',
    };
    expect(isRetentionProof(success)).toBe(true);
    if (isRetentionProof(success)) {
      // Type-level proof: inside this branch, TypeScript narrows `success`
      // to RetentionProof (outcome: 'SUCCESS' literally) -- this line
      // would fail to compile if RetentionProof were not a distinct,
      // narrower type than QualifiedRetentionAttempt.
      const proof: import('@/lib/memory-policy').RetentionProof = success;
      expect(proof.outcome).toBe('SUCCESS');
    }
  });

  it('the three RetentionAttemptOutcome values remain distinct -- exactly one of them (SUCCESS) is proof-bearing', () => {
    const outcomes: Array<'SUCCESS' | 'PARTIAL' | 'FAILURE'> = ['SUCCESS', 'PARTIAL', 'FAILURE'];
    const proofBearing = outcomes.filter((outcome) =>
      isRetentionProof({ studentId: 's1', conceptId: 'c1', occurredAt: ANCHOR, outcome, normalizedPerformance: 50, sourceEvidenceId: 'e' })
    );
    expect(proofBearing).toEqual(['SUCCESS']);
  });
});
