/**
 * STUDYUS PHASE 6 -- RETENTION & MEMORY ENGINE
 * Step 6D: pure unit tests for src/lib/algorithms/memory-model.ts
 * (normalization boundary, replay-based state projection, live-
 * derived signals).
 *
 * Zero production callers as of this step -- no DB, no mocks needed,
 * every function under test is pure.
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeMemoryEvidence,
  projectMemoryStateFromEvidence,
  computeLiveMemorySignals,
  type RawLearningEvidenceRow,
  type CanonicalMemoryEvidence,
} from '@/lib/algorithms/memory-model';
import { evidenceModeForActivity, type ActivityType } from '@/lib/activity-taxonomy';
import type { EvidenceResult } from '@/lib/algorithms/mastery';

const DAY = 24 * 60 * 60 * 1000;
const BASE = '2026-01-01T00:00:00.000Z';
const iso = (offsetDays: number) => new Date(new Date(BASE).getTime() + offsetDays * DAY).toISOString();

function rawEvidence(overrides: Partial<RawLearningEvidenceRow> = {}): RawLearningEvidenceRow {
  return {
    id: 'e-default',
    studentId: 's1',
    conceptId: 'c1',
    activityType: 'quiz', // the unreliable top-level column -- matches real production behavior (route.ts:819)
    result: 'correct',
    scorePercent: 100,
    aiAssistanceType: 'NONE',
    hintsUsed: 0,
    operationKey: 'op-key-1',
    timestamp: iso(0),
    metadata: { activityType: 'RETENTION_CHECK' },
    ...overrides,
  };
}

function canonicalEvidence(
  daysOffset: number,
  activityType: ActivityType,
  result: EvidenceResult,
  scorePercent: number,
  overrides: Partial<CanonicalMemoryEvidence> = {}
): CanonicalMemoryEvidence {
  return {
    evidenceId: `e-${daysOffset}-${activityType}-${result}`,
    studentId: 's1',
    conceptId: 'c1',
    activityType,
    evidenceMode: evidenceModeForActivity(activityType),
    result,
    scorePercent,
    aiAssistanceType: 'NONE',
    hintsUsed: 0,
    operationKey: `op-${daysOffset}`,
    timestamp: iso(daysOffset),
    ...overrides,
  };
}

describe('TEST MATRIX -- ACTIVITY SOURCE (Section 24): raw activity_type is ignored, metadata.activityType is authoritative', () => {
  it("activity_type='quiz', metadata.activityType='RETENTION_CHECK' -> RETENTION_CHECK", () => {
    const result = normalizeMemoryEvidence(rawEvidence({ activityType: 'quiz', metadata: { activityType: 'RETENTION_CHECK' } }));
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.evidence.activityType).toBe('RETENTION_CHECK');
  });

  it("activity_type='anything', metadata.activityType='SOLO_CHECK' -> SOLO_CHECK", () => {
    const result = normalizeMemoryEvidence(rawEvidence({ activityType: 'anything', metadata: { activityType: 'SOLO_CHECK' } }));
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.evidence.activityType).toBe('SOLO_CHECK');
  });

  it("activity_type='transfer' (lowercase, the real transfer/submit/route.ts bug), metadata.activityType='TRANSFER' -> TRANSFER", () => {
    const result = normalizeMemoryEvidence(rawEvidence({ activityType: 'transfer', metadata: { activityType: 'TRANSFER' } }));
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.evidence.activityType).toBe('TRANSFER');
  });

  it("activity_type='RETENTION_CHECK' (top-level, even though correctly-cased), metadata.activityType missing -> unusable", () => {
    const result = normalizeMemoryEvidence(rawEvidence({ activityType: 'RETENTION_CHECK', metadata: {} }));
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe('MISSING_METADATA_ACTIVITY_TYPE');
  });

  it('metadata is entirely null -> unusable', () => {
    const result = normalizeMemoryEvidence(rawEvidence({ activityType: 'RETENTION_CHECK', metadata: null }));
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe('MISSING_METADATA_ACTIVITY_TYPE');
  });

  it("metadata.activityType='NOT_A_REAL_ACTIVITY' -> unusable", () => {
    const result = normalizeMemoryEvidence(rawEvidence({ metadata: { activityType: 'NOT_A_REAL_ACTIVITY' } }));
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe('UNKNOWN_ACTIVITY_TYPE');
  });

  it('metadata EvidenceMode mismatch is completely ignored -- taxonomy always wins, so a false claim of independence can never create false retention proof', () => {
    // PRACTICE's canonical EvidenceMode is PRACTICE (assisted). The
    // metadata here falsely claims INDEPENDENT -- if that claim were
    // ever trusted, a PRACTICE row could look like real retention
    // evidence. It must not.
    const result = normalizeMemoryEvidence(rawEvidence({ metadata: { activityType: 'PRACTICE', evidenceMode: 'INDEPENDENT' } }));
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.evidence.activityType).toBe('PRACTICE');
      expect(result.evidence.evidenceMode).toBe('PRACTICE'); // the REAL taxonomy answer, never the metadata's false claim
    }
  });

  it('missing scorePercent -> unusable', () => {
    const result = normalizeMemoryEvidence(rawEvidence({ scorePercent: null }));
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe('MISSING_SCORE_PERCENT');
  });

  it('out-of-range scorePercent -> unusable', () => {
    expect(normalizeMemoryEvidence(rawEvidence({ scorePercent: -5 })).valid).toBe(false);
    expect(normalizeMemoryEvidence(rawEvidence({ scorePercent: 150 })).valid).toBe(false);
  });

  it('a valid row round-trips every other field unchanged', () => {
    const raw = rawEvidence({ id: 'ev-123', scorePercent: 62, aiAssistanceType: 'NONE', hintsUsed: 0, operationKey: 'op-xyz', timestamp: iso(5) });
    const result = normalizeMemoryEvidence(raw);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.evidence.evidenceId).toBe('ev-123');
      expect(result.evidence.scorePercent).toBe(62);
      expect(result.evidence.operationKey).toBe('op-xyz');
      expect(result.evidence.timestamp).toBe(iso(5));
    }
  });
});

describe('TEST MATRIX -- REPLAY (Section 21)', () => {
  it('EMPTY: [] -> NOT_ESTABLISHED', () => {
    const state = projectMemoryStateFromEvidence('s1', 'c1', []);
    expect(state.memoryStatus).toBe('NOT_ESTABLISHED');
    expect(state.memoryStability).toBe('UNSTABLE');
    expect(state.initialCompetenceAnchorAt).toBeNull();
    expect(state.lastQualifiedAttemptAt).toBeNull();
    expect(state.lastSuccessfulRetentionAt).toBeNull();
    expect(state.lastUnsuccessfulRetentionAt).toBeNull();
    expect(state.demonstratedRetentionScore).toBeNull();
    expect(state.retentionEvidenceCount).toBe(0);
    expect(state.consecutiveQualifyingSuccesses).toBe(0);
    expect(state.nextReviewAt).toBeNull();
  });

  it('PRACTICE ONLY: assisted practice rows -> NOT_ESTABLISHED (cannot set the anchor)', () => {
    const state = projectMemoryStateFromEvidence('s1', 'c1', [
      canonicalEvidence(0, 'PRACTICE', 'correct', 100),
      canonicalEvidence(1, 'REVIEW', 'correct', 100),
      canonicalEvidence(2, 'PRACTICE', 'correct', 100),
    ]);
    expect(state.memoryStatus).toBe('NOT_ESTABLISHED');
    expect(state.initialCompetenceAnchorAt).toBeNull();
  });

  it('ANCHOR: eligible independent success -> WAITING_FOR_RETENTION, nextReviewAt +3d, score null, count 0', () => {
    const state = projectMemoryStateFromEvidence('s1', 'c1', [canonicalEvidence(0, 'RETENTION_CHECK', 'correct', 100)]);
    expect(state.memoryStatus).toBe('WAITING_FOR_RETENTION');
    expect(state.initialCompetenceAnchorAt).toBe(iso(0));
    expect(state.nextReviewAt).toBe(iso(3));
    expect(state.demonstratedRetentionScore).toBeNull();
    expect(state.retentionEvidenceCount).toBe(0);
  });

  it('EARLY ATTEMPT: retention candidate at +2d -> does not qualify -> state unchanged from anchor-only', () => {
    const anchorOnly = projectMemoryStateFromEvidence('s1', 'c1', [canonicalEvidence(0, 'RETENTION_CHECK', 'correct', 100)]);
    const withEarlyCandidate = projectMemoryStateFromEvidence('s1', 'c1', [
      canonicalEvidence(0, 'RETENTION_CHECK', 'correct', 100),
      canonicalEvidence(2, 'RETENTION_CHECK', 'correct', 100),
    ]);
    expect(withEarlyCandidate).toEqual(anchorOnly);
  });

  it('EXACT GAP: candidate at exactly +3d -> qualifies', () => {
    const state = projectMemoryStateFromEvidence('s1', 'c1', [
      canonicalEvidence(0, 'RETENTION_CHECK', 'correct', 100),
      canonicalEvidence(3, 'RETENTION_CHECK', 'correct', 90),
    ]);
    expect(state.retentionEvidenceCount).toBe(1);
    expect(state.lastQualifiedAttemptAt).toBe(iso(3));
  });

  it('SUCCESS chain #1 -> #6: DEVELOPING/STABLE transitions, streak, score, and the frozen review-interval sequence', () => {
    const events = [
      canonicalEvidence(0, 'RETENTION_CHECK', 'correct', 100), // anchor
      canonicalEvidence(3, 'RETENTION_CHECK', 'correct', 90), // success #1
      canonicalEvidence(7, 'RETENTION_CHECK', 'correct', 90), // success #2 (+4d gap from day3)
      canonicalEvidence(14, 'RETENTION_CHECK', 'correct', 90), // success #3 (+7d gap from day7)
      canonicalEvidence(28, 'RETENTION_CHECK', 'correct', 90), // success #4 (+14d gap from day14)
      canonicalEvidence(56, 'RETENTION_CHECK', 'correct', 90), // success #5 (+28d gap from day28)
      canonicalEvidence(112, 'RETENTION_CHECK', 'correct', 90), // success #6 (+56d gap from day56)
    ];

    const after1 = projectMemoryStateFromEvidence('s1', 'c1', events.slice(0, 2));
    expect(after1.memoryStatus).toBe('DEVELOPING');
    expect(after1.consecutiveQualifyingSuccesses).toBe(1);
    expect(after1.demonstratedRetentionScore).toBe(90);
    expect(after1.nextReviewAt).toBe(iso(3 + 4));

    const after2 = projectMemoryStateFromEvidence('s1', 'c1', events.slice(0, 3));
    expect(after2.memoryStatus).toBe('DEVELOPING');
    expect(after2.consecutiveQualifyingSuccesses).toBe(2);
    expect(after2.nextReviewAt).toBe(iso(7 + 7));

    const after3 = projectMemoryStateFromEvidence('s1', 'c1', events.slice(0, 4));
    expect(after3.memoryStatus).toBe('STABLE');
    expect(after3.consecutiveQualifyingSuccesses).toBe(3);
    expect(after3.nextReviewAt).toBe(iso(14 + 14));

    const after6 = projectMemoryStateFromEvidence('s1', 'c1', events);
    expect(after6.memoryStatus).toBe('STABLE');
    expect(after6.consecutiveQualifyingSuccesses).toBe(6);
    expect(after6.nextReviewAt).toBe(iso(112 + 84)); // capped at the maximum, per the frozen [3,4,7,14,28,56,84] sequence
  });

  it('PARTIAL: AT_RISK, UNSTABLE, streak 0, unsuccessful timestamp updated, successful timestamp unchanged, next +3d', () => {
    const state = projectMemoryStateFromEvidence('s1', 'c1', [
      canonicalEvidence(0, 'RETENTION_CHECK', 'correct', 100), // anchor
      canonicalEvidence(3, 'RETENTION_CHECK', 'partial', 60),
    ]);
    expect(state.memoryStatus).toBe('AT_RISK');
    expect(state.memoryStability).toBe('UNSTABLE');
    expect(state.consecutiveQualifyingSuccesses).toBe(0);
    expect(state.lastUnsuccessfulRetentionAt).toBe(iso(3));
    expect(state.lastSuccessfulRetentionAt).toBeNull(); // never any success yet
    expect(state.nextReviewAt).toBe(iso(3 + 3));
    expect(state.demonstratedRetentionScore).toBe(60); // its own real score, not coerced
  });

  it('FAILURE: same structural effects as PARTIAL', () => {
    const state = projectMemoryStateFromEvidence('s1', 'c1', [
      canonicalEvidence(0, 'RETENTION_CHECK', 'correct', 100),
      canonicalEvidence(3, 'RETENTION_CHECK', 'incorrect', 25),
    ]);
    expect(state.memoryStatus).toBe('AT_RISK');
    expect(state.memoryStability).toBe('UNSTABLE');
    expect(state.consecutiveQualifyingSuccesses).toBe(0);
    expect(state.lastUnsuccessfulRetentionAt).toBe(iso(3));
    expect(state.lastSuccessfulRetentionAt).toBeNull();
    expect(state.nextReviewAt).toBe(iso(3 + 3));
    expect(state.demonstratedRetentionScore).toBe(25);
  });

  it('RECOVERY AFTER FAILURE: failure then a qualifying success after the required gap -> DEVELOPING, streak 1, successful timestamp updated, unsuccessful timestamp remains historical, next +4d', () => {
    const state = projectMemoryStateFromEvidence('s1', 'c1', [
      canonicalEvidence(0, 'RETENTION_CHECK', 'correct', 100), // anchor
      canonicalEvidence(3, 'RETENTION_CHECK', 'incorrect', 25), // failure
      canonicalEvidence(6, 'RETENTION_CHECK', 'correct', 95), // recovery success (gap from day3 = 3, meets minimum)
    ]);
    expect(state.memoryStatus).toBe('DEVELOPING');
    expect(state.consecutiveQualifyingSuccesses).toBe(1);
    expect(state.lastSuccessfulRetentionAt).toBe(iso(6));
    expect(state.lastUnsuccessfulRetentionAt).toBe(iso(3)); // remains historical, not erased by the later success
    expect(state.nextReviewAt).toBe(iso(6 + 4));
  });
});

describe('TEST MATRIX -- SPACING VS MEMORY AGE (Section 22): the two anchors must never be conflated', () => {
  // anchor@0, success@3 (streak1), partial@10 (streak resets 0, unsuccessful=day10)
  const withPartialAt10 = [
    canonicalEvidence(0, 'RETENTION_CHECK', 'correct', 100),
    canonicalEvidence(3, 'RETENTION_CHECK', 'correct', 90),
    canonicalEvidence(10, 'RETENTION_CHECK', 'partial', 60),
  ];

  it('qualification spacing anchor after the day-10 PARTIAL is day 10, NOT day 3', () => {
    const baseline = projectMemoryStateFromEvidence('s1', 'c1', withPartialAt10);
    const tooSoon = projectMemoryStateFromEvidence('s1', 'c1', [...withPartialAt10, canonicalEvidence(12, 'RETENTION_CHECK', 'correct', 100)]);
    const gapMet = projectMemoryStateFromEvidence('s1', 'c1', [...withPartialAt10, canonicalEvidence(13, 'RETENTION_CHECK', 'correct', 100)]);

    expect(tooSoon).toEqual(baseline); // day-12 candidate (gap=2 from day10) caused NO mutation at all
    expect(gapMet.lastQualifiedAttemptAt).toBe(iso(13)); // day-13 candidate (gap=3 from day10) DID qualify
    expect(gapMet.retentionEvidenceCount).toBe(baseline.retentionEvidenceCount + 1);
  });

  it('memory-age anchor at day 11 is day 3 (the successful retrieval), NOT day 10 (the partial attempt)', () => {
    const state = projectMemoryStateFromEvidence('s1', 'c1', withPartialAt10);
    const signals = computeLiveMemorySignals(state, iso(11));
    expect(signals.memoryAgeDays).toBeCloseTo(11 - 3, 5);
  });

  it('the same distinction holds for a FAILURE instead of a PARTIAL at day 10', () => {
    const withFailureAt10 = [
      canonicalEvidence(0, 'RETENTION_CHECK', 'correct', 100),
      canonicalEvidence(3, 'RETENTION_CHECK', 'correct', 90),
      canonicalEvidence(10, 'RETENTION_CHECK', 'incorrect', 20),
    ];
    const state = projectMemoryStateFromEvidence('s1', 'c1', withFailureAt10);
    expect(state.lastQualifiedAttemptAt).toBe(iso(10)); // spacing anchor moved to day 10
    const signals = computeLiveMemorySignals(state, iso(11));
    expect(signals.memoryAgeDays).toBeCloseTo(11 - 3, 5); // memory-age anchor still day 3
  });
});

describe('TEST MATRIX -- DEMONSTRATED RETENTION (Section 23)', () => {
  it('SUCCESS 90, PARTIAL 60, FAILURE 25: the projector reports the exact recency-weighted score using real scorePercent values', () => {
    const events = [
      canonicalEvidence(0, 'RETENTION_CHECK', 'correct', 100), // anchor
      canonicalEvidence(3, 'RETENTION_CHECK', 'correct', 90), // qualifying #1 (oldest of the 3)
      canonicalEvidence(6, 'RETENTION_CHECK', 'partial', 60), // qualifying #2
      canonicalEvidence(9, 'RETENTION_CHECK', 'incorrect', 25), // qualifying #3 (most recent)
    ];
    const state = projectMemoryStateFromEvidence('s1', 'c1', events);
    // Most-recent-first: [25 (w=1.0), 60 (w=0.8), 90 (w=0.64)]
    const expected = Math.round((1.0 * 25 + 0.8 * 60 + 0.64 * 90) / (1.0 + 0.8 + 0.64));
    expect(state.demonstratedRetentionScore).toBe(expected);
    expect(state.retentionEvidenceCount).toBe(3);
  });

  it('maximum 5 qualifying attempts are used; the 6th-oldest drops out entirely', () => {
    const events = [
      canonicalEvidence(0, 'RETENTION_CHECK', 'correct', 100), // anchor
      canonicalEvidence(3, 'RETENTION_CHECK', 'incorrect', 1), // oldest qualifying -- must be excluded once a 6th exists
      canonicalEvidence(6, 'RETENTION_CHECK', 'correct', 90),
      canonicalEvidence(9, 'RETENTION_CHECK', 'correct', 90),
      canonicalEvidence(12, 'RETENTION_CHECK', 'correct', 90),
      canonicalEvidence(15, 'RETENTION_CHECK', 'correct', 90),
      canonicalEvidence(18, 'RETENTION_CHECK', 'correct', 90), // 6th qualifying, most recent
    ];
    const state = projectMemoryStateFromEvidence('s1', 'c1', events);
    expect(state.retentionEvidenceCount).toBe(5);
    expect(state.demonstratedRetentionScore).toBe(90); // the excluded oldest (score=1) has zero influence
  });

  it('calendar time changing with identical evidence does NOT change demonstratedRetentionScore -- the projector takes no `now` input at all', () => {
    const events = [canonicalEvidence(0, 'RETENTION_CHECK', 'correct', 100), canonicalEvidence(3, 'RETENTION_CHECK', 'correct', 80)];
    const a = projectMemoryStateFromEvidence('s1', 'c1', events);
    const b = projectMemoryStateFromEvidence('s1', 'c1', events);
    expect(a).toEqual(b);
    expect(a.demonstratedRetentionScore).toBe(80);
  });
});

describe('TEST MATRIX -- DERIVED TIME SIGNALS (Section 25)', () => {
  const anchorState = projectMemoryStateFromEvidence('s1', 'c1', [canonicalEvidence(0, 'RETENTION_CHECK', 'correct', 100)]); // nextReviewAt = day 3

  it('retentionDue is false before nextReviewAt', () => {
    expect(computeLiveMemorySignals(anchorState, iso(2)).retentionDue).toBe(false);
  });

  it('retentionDue is true at exactly nextReviewAt', () => {
    expect(computeLiveMemorySignals(anchorState, iso(3)).retentionDue).toBe(true);
  });

  it('daysOverdue is deterministic', () => {
    expect(computeLiveMemorySignals(anchorState, iso(10)).daysOverdue).toBe(7);
  });

  it('retrievability monotonically decreases (forgettingRisk monotonically increases) with elapsed time for the same state', () => {
    const stableState = projectMemoryStateFromEvidence('s1', 'c1', [
      canonicalEvidence(0, 'RETENTION_CHECK', 'correct', 100),
      canonicalEvidence(3, 'RETENTION_CHECK', 'correct', 90),
      canonicalEvidence(7, 'RETENTION_CHECK', 'correct', 90),
      canonicalEvidence(14, 'RETENTION_CHECK', 'correct', 90),
    ]);
    const risks = [0, 5, 10, 20, 40, 100].map((d) => computeLiveMemorySignals(stableState, iso(14 + d)).forgettingRisk!);
    for (let i = 1; i < risks.length; i++) expect(risks[i]).toBeGreaterThanOrEqual(risks[i - 1]);
  });

  it('forgettingRisk = 100 - retrievability, always', () => {
    const signals = computeLiveMemorySignals(anchorState, iso(20));
    // anchorState has no successful retrieval yet, so retrievability falls back to the anchor -- still a valid prediction.
    if (signals.retrievabilityNow !== null) {
      expect(signals.forgettingRisk).toBe(100 - signals.retrievabilityNow);
    }
  });

  it('a FAILURE timestamp does not reset retrievability (memory age keeps counting from the last SUCCESS)', () => {
    const withFailure = projectMemoryStateFromEvidence('s1', 'c1', [
      canonicalEvidence(0, 'RETENTION_CHECK', 'correct', 100),
      canonicalEvidence(3, 'RETENTION_CHECK', 'correct', 90),
      canonicalEvidence(10, 'RETENTION_CHECK', 'incorrect', 20),
    ]);
    expect(computeLiveMemorySignals(withFailure, iso(11)).memoryAgeDays).toBeCloseTo(11 - 3, 5);
  });

  it('a PARTIAL timestamp does not reset retrievability', () => {
    const withPartial = projectMemoryStateFromEvidence('s1', 'c1', [
      canonicalEvidence(0, 'RETENTION_CHECK', 'correct', 100),
      canonicalEvidence(3, 'RETENTION_CHECK', 'correct', 90),
      canonicalEvidence(10, 'RETENTION_CHECK', 'partial', 60),
    ]);
    expect(computeLiveMemorySignals(withPartial, iso(11)).memoryAgeDays).toBeCloseTo(11 - 3, 5);
  });

  it('time alone never mutates MemoryState -- computeLiveMemorySignals is read-only over its `state` argument', () => {
    const before = JSON.stringify(anchorState);
    computeLiveMemorySignals(anchorState, iso(5));
    computeLiveMemorySignals(anchorState, iso(500));
    expect(JSON.stringify(anchorState)).toBe(before);
  });
});

describe('TEST MATRIX -- TOTAL ORDER (Step 6E Section 1)', () => {
  it('the same evidence set in randomized input order produces identical output', () => {
    const events = [
      canonicalEvidence(0, 'RETENTION_CHECK', 'correct', 100, { evidenceId: 'e-a' }),
      canonicalEvidence(3, 'RETENTION_CHECK', 'correct', 90, { evidenceId: 'e-b' }),
      canonicalEvidence(7, 'RETENTION_CHECK', 'partial', 60, { evidenceId: 'e-c' }),
      canonicalEvidence(11, 'RETENTION_CHECK', 'correct', 95, { evidenceId: 'e-d' }),
    ];
    const chronological = projectMemoryStateFromEvidence('s1', 'c1', events);
    const reversed = projectMemoryStateFromEvidence('s1', 'c1', [...events].reverse());
    const shuffled = projectMemoryStateFromEvidence('s1', 'c1', [events[2], events[0], events[3], events[1]]);

    expect(reversed).toEqual(chronological);
    expect(shuffled).toEqual(chronological);
  });

  it('rows sharing the exact same timestamp are ordered deterministically by evidenceId ASC, not by input array position', () => {
    const sameTimestamp = iso(3);
    // Two candidates at the identical instant, 3 days after the anchor --
    // both individually meet the minimum gap from the anchor, but only
    // whichever is processed FIRST (by the tiebreak) can become a
    // qualifying attempt: once it sets lastQualifiedAttemptAt to this
    // same instant, the second one's gap-from-that-instant is 0, so it
    // is correctly rejected as "too soon". Which one goes first must be
    // decided by evidenceId ASC, never by array position.
    const lowId = canonicalEvidence(3, 'RETENTION_CHECK', 'correct', 90, { evidenceId: 'aaa', timestamp: sameTimestamp });
    const highId = canonicalEvidence(3, 'RETENTION_CHECK', 'incorrect', 10, { evidenceId: 'zzz', timestamp: sameTimestamp });
    const anchor = canonicalEvidence(0, 'RETENTION_CHECK', 'correct', 100, { evidenceId: 'e-anchor' });

    const orderA = projectMemoryStateFromEvidence('s1', 'c1', [anchor, highId, lowId]); // input order: high then low
    const orderB = projectMemoryStateFromEvidence('s1', 'c1', [anchor, lowId, highId]); // input order: low then high

    // Both must resolve to processing 'aaa' (lower evidenceId) first,
    // regardless of which order they were passed in in the input array.
    expect(orderA).toEqual(orderB);
    expect(orderA.memoryStatus).toBe('DEVELOPING'); // 'aaa' (SUCCESS) won the tiebreak and became the qualifying attempt; 'zzz' was correctly rejected as too-soon
    expect(orderA.consecutiveQualifyingSuccesses).toBe(1);
  });
});
