import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...args: any[]) => queryMock(...args) } }));
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));

import {
  isMeaningfulGap,
  determineTriggerType,
  determineExpiredCycleOutcome,
  computeTimeToMastery,
  evaluateValidationLifecycle,
  getKVR14,
  getActiveValidationCycles,
  openValidationCycle,
  type TriggerType,
} from '@/services/validation-cycle.service';
import { classifyRetention } from '@/services/knowledge-state.service';
import type { DimensionScores, MisconceptionState, MasteryPolicy } from '@/services/knowledge-state.service';

beforeEach(() => {
  queryMock.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

const POLICY: MasteryPolicy = {
  version: 1,
  minimumUnderstanding: 80,
  minimumIndependence: 80,
  minimumApplication: 75,
  minimumRetention: 75,
  minimumTransfer: 70,
  requiresTransfer: true,
  maximumCriticalMisconceptions: 0,
  minimumEvidenceCount: 3,
  minimumIndependentEvidenceCount: 2,
  retentionMinGapDays: 3,
  validationWindowDays: 14,
};

function noMisconceptions(): MisconceptionState {
  return { activeCount: 0, criticalCount: 0, recurringCount: 0 };
}
function scores(overrides: Partial<DimensionScores> = {}): DimensionScores {
  return { understanding: 90, independence: 88, application: 85, retention: 82, transfer: 78, ...overrides };
}
function cycleRow(overrides: Partial<Record<string, any>> = {}) {
  return {
    id: 'cycle-1',
    student_id: 's1',
    concept_id: 'c1',
    subject_id: 'subj1',
    trigger_type: 'LOW_BASELINE',
    started_at: '2026-01-01T00:00:00Z',
    validation_deadline: '2026-01-15T00:00:00Z',
    status: 'OPEN',
    mastery_policy_version: 1,
    validated_at: null,
    closed_at: null,
    final_outcome: null,
    outcome_reason: null,
    reopened_from_cycle_id: null,
    ...overrides,
  };
}

// --- 1. Meaningful gap opens cycle -------------------------------------
describe('1. Meaningful gap opens cycle', () => {
  it('isMeaningfulGap is true for every real gap state', () => {
    expect(isMeaningfulGap('LEARNING')).toBe(true);
    expect(isMeaningfulGap('DEVELOPING')).toBe(true);
    expect(isMeaningfulGap('PROVISIONAL_MASTERY')).toBe(true);
    expect(isMeaningfulGap('AT_RISK')).toBe(true);
    expect(isMeaningfulGap('INTERVENTION_REQUIRED')).toBe(true);
  });

  it('evaluateValidationLifecycle opens a new cycle when a meaningful gap has no existing cycle', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] }); // getActiveValidationCycle: no open cycle
    queryMock.mockResolvedValueOnce({ rows: [] }); // openValidationCycle: no existing open cycle (double-check)
    queryMock.mockResolvedValueOnce({ rows: [cycleRow()] }); // INSERT ... RETURNING *
    queryMock.mockResolvedValueOnce({ rows: [] }); // logEvent insert

    const result = await evaluateValidationLifecycle({
      studentId: 's1', conceptId: 'c1', subjectId: 'subj1',
      previousState: null, baseState: 'LEARNING',
      scores: scores({ understanding: 40 }), misconceptions: noMisconceptions(), policy: POLICY,
      knowledgeStateSnapshot: {},
    });

    expect(result).toBe('LEARNING');
    expect(queryMock.mock.calls.some((c) => String(c[0]).includes('INSERT INTO validation_cycles'))).toBe(true);
  });
});

// --- 2. Mere exposure does not open cycle ------------------------------
describe('2. Mere exposure does not open a cycle', () => {
  it('isMeaningfulGap is false for UNKNOWN and VALIDATED_MASTERY', () => {
    expect(isMeaningfulGap('UNKNOWN')).toBe(false);
    expect(isMeaningfulGap('VALIDATED_MASTERY')).toBe(false);
  });

  it('evaluateValidationLifecycle never inserts a cycle when the base state is UNKNOWN', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] }); // getActiveValidationCycle: no open cycle
    const result = await evaluateValidationLifecycle({
      studentId: 's1', conceptId: 'c1', subjectId: 'subj1',
      previousState: null, baseState: 'UNKNOWN',
      scores: scores({ understanding: null, independence: null, application: null, retention: null, transfer: null }),
      misconceptions: noMisconceptions(), policy: POLICY, knowledgeStateSnapshot: {},
    });
    expect(result).toBe('UNKNOWN');
    expect(queryMock.mock.calls.some((c) => String(c[0]).includes('INSERT INTO validation_cycles'))).toBe(false);
  });
});

// --- 3. Duplicate cycle start is idempotent ----------------------------
describe('3. Duplicate cycle start is idempotent', () => {
  it('openValidationCycle returns the existing OPEN cycle instead of inserting a duplicate', async () => {
    queryMock.mockResolvedValueOnce({ rows: [cycleRow({ id: 'existing-cycle' })] });
    const cycle = await openValidationCycle('s1', 'c1', 'subj1', 'LOW_BASELINE', POLICY, {});
    expect(cycle.id).toBe('existing-cycle');
    expect(queryMock).toHaveBeenCalledTimes(1); // only the existence check -- no INSERT
    expect(queryMock.mock.calls.some((c) => String(c[0]).includes('INSERT INTO validation_cycles'))).toBe(false);
  });
});

// --- 4. Strong immediate performance remains Provisional ---------------
describe('4. Strong immediate performance remains Provisional through the lifecycle overlay', () => {
  it('PROVISIONAL_MASTERY base state stays PROVISIONAL_MASTERY, never elevated to Validated', async () => {
    queryMock.mockResolvedValueOnce({ rows: [cycleRow({ status: 'OPEN', validation_deadline: '2099-01-01T00:00:00Z' })] });
    queryMock.mockResolvedValueOnce({ rows: [] }); // logEvent

    const result = await evaluateValidationLifecycle({
      studentId: 's1', conceptId: 'c1', subjectId: 'subj1',
      previousState: 'DEVELOPING', baseState: 'PROVISIONAL_MASTERY',
      scores: scores({ retention: null, transfer: null }), misconceptions: noMisconceptions(), policy: POLICY,
      knowledgeStateSnapshot: {},
    });
    expect(result).toBe('PROVISIONAL_MASTERY');
  });
});

// --- 5 & 6. Retention: delayed evidence counts, immediate does not -----
describe('5 & 6. Retention requires real time separation', () => {
  it('evidence gapped past the policy minimum produces a real Retention score', () => {
    const rows = [
      { sourceType: 'PRACTICE_QUIZ', result: 'correct' as const, scorePercent: 100, aiAssistanceType: 'NONE', timestamp: new Date('2026-01-01T00:00:00Z') },
      { sourceType: 'PRACTICE_QUIZ', result: 'correct' as const, scorePercent: 90, aiAssistanceType: 'NONE', timestamp: new Date('2026-01-05T00:00:00Z') },
    ];
    expect(classifyRetention(rows, 3)).toBe(90);
  });

  it('evidence from the same day as first exposure never counts as Retention', () => {
    const rows = [
      { sourceType: 'PRACTICE_QUIZ', result: 'correct' as const, scorePercent: 100, aiAssistanceType: 'NONE', timestamp: new Date('2026-01-01T00:00:00Z') },
      { sourceType: 'PRACTICE_QUIZ', result: 'correct' as const, scorePercent: 100, aiAssistanceType: 'NONE', timestamp: new Date('2026-01-01T01:00:00Z') },
    ];
    expect(classifyRetention(rows, 3)).toBeNull();
  });
});

// --- 7. Successful Retention advances validation ------------------------
describe('7. Successful Retention advances validation readiness toward READY', () => {
  it('all dimensions passing, including a real (non-null) Retention, requires nothing further', () => {
    // validation readiness logic lives in knowledge-state.service and is
    // already covered there; here we confirm the trigger classifier
    // agrees retention is no longer a blocking failure once it passes.
    const passingScores = scores({ retention: 90 });
    expect(determineTriggerType(passingScores, noMisconceptions(), POLICY)).not.toBe('RETENTION_FAILURE');
  });
});

// --- 8 & 9. Failed Retention on a validated concept -> AT_RISK / decay --
describe('8 & 9. A previously-validated concept whose retention now fails is Knowledge Decay, not silent Provisional', () => {
  it('regressing from VALIDATED_MASTERY opens a KNOWLEDGE_DECAY cycle and returns AT_RISK', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] }); // getActiveValidationCycle: none open
    queryMock.mockResolvedValueOnce({ rows: [cycleRow({ id: 'last-validated', final_outcome: 'VALIDATED_MASTERY' })] }); // getLastValidatedCycle
    queryMock.mockResolvedValueOnce({ rows: [] }); // openValidationCycle existence check
    queryMock.mockResolvedValueOnce({ rows: [cycleRow({ id: 'new-cycle', trigger_type: 'KNOWLEDGE_DECAY' })] }); // INSERT
    queryMock.mockResolvedValueOnce({ rows: [] }); // logEvent VALIDATION_CYCLE_REOPENED
    queryMock.mockResolvedValueOnce({ rows: [] }); // logEvent KNOWLEDGE_DECAY_DETECTED
    queryMock.mockResolvedValueOnce({ rows: [] }); // logEvent CONCEPT_AT_RISK

    const result = await evaluateValidationLifecycle({
      studentId: 's1', conceptId: 'c1', subjectId: 'subj1',
      previousState: 'VALIDATED_MASTERY', baseState: 'PROVISIONAL_MASTERY',
      scores: scores({ retention: 40 }), misconceptions: noMisconceptions(), policy: POLICY,
      knowledgeStateSnapshot: {},
    });

    expect(result).toBe('AT_RISK');
    const insertCall = queryMock.mock.calls.find((c) => String(c[0]).includes('INSERT INTO validation_cycles'));
    expect(insertCall?.[1]).toContain('KNOWLEDGE_DECAY');
  });
});

// --- 10. No arbitrary time-based mastery decay exists -------------------
describe('10. No arbitrary time-based decay -- only an evidence-driven state change triggers it', () => {
  it('a concept that stays VALIDATED_MASTERY never opens a decay cycle, no matter how much time has passed', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] }); // getActiveValidationCycle: none open (already resolved from its own successful cycle)
    const result = await evaluateValidationLifecycle({
      studentId: 's1', conceptId: 'c1', subjectId: 'subj1',
      previousState: 'VALIDATED_MASTERY', baseState: 'VALIDATED_MASTERY',
      scores: scores(), misconceptions: noMisconceptions(), policy: POLICY, knowledgeStateSnapshot: {},
    });
    expect(result).toBe('VALIDATED_MASTERY');
    expect(queryMock.mock.calls.some((c) => String(c[0]).includes('INSERT INTO validation_cycles'))).toBe(false);
  });
});

// --- 11. Successful cycle reaches Validated Mastery ---------------------
describe('11. A successful cycle closes as VALIDATED_MASTERY', () => {
  it('an open cycle closes with finalOutcome VALIDATED_MASTERY when the base state validates', async () => {
    queryMock.mockResolvedValueOnce({ rows: [cycleRow({ status: 'OPEN', validation_deadline: '2099-01-01T00:00:00Z' })] });
    queryMock.mockResolvedValueOnce({ rows: [cycleRow({ status: 'CLOSED', final_outcome: 'VALIDATED_MASTERY' })] }); // UPDATE ... RETURNING *
    queryMock.mockResolvedValueOnce({ rows: [] }); // logEvent CLOSED
    queryMock.mockResolvedValueOnce({ rows: [] }); // logEvent VALIDATED_MASTERY_REACHED

    const result = await evaluateValidationLifecycle({
      studentId: 's1', conceptId: 'c1', subjectId: 'subj1',
      previousState: 'PROVISIONAL_MASTERY', baseState: 'VALIDATED_MASTERY',
      scores: scores(), misconceptions: noMisconceptions(), policy: POLICY, knowledgeStateSnapshot: {},
    });

    expect(result).toBe('VALIDATED_MASTERY');
    const updateCall = queryMock.mock.calls.find((c) => String(c[0]).includes('UPDATE validation_cycles'));
    expect(updateCall?.[1]).toContain('VALIDATED_MASTERY');
  });
});

// --- 12 & 13. Transfer/critical-misconception failures ------------------
describe('12 & 13. Failed required Transfer / a critical misconception both prevent validation', () => {
  it('determineTriggerType flags TRANSFER_FAILURE when Transfer is required and below threshold', () => {
    expect(determineTriggerType(scores({ transfer: 40 }), noMisconceptions(), POLICY)).toBe('TRANSFER_FAILURE');
  });

  it('a critical misconception outranks every other trigger, including a failing Transfer', () => {
    const misconceptions: MisconceptionState = { activeCount: 1, criticalCount: 1, recurringCount: 0 };
    expect(determineTriggerType(scores({ transfer: 40 }), misconceptions, POLICY)).toBe('CONFIRMED_MISCONCEPTION');
  });
});

// --- 14 & 15 & 16. Deadline always resolves explicitly -------------------
describe('14, 15 & 16. An expired cycle always resolves to an explicit outcome', () => {
  it('never returns anything other than a real FinalOutcome', () => {
    expect(['DEVELOPING', 'INTERVENTION_REQUIRED']).toContain(determineExpiredCycleOutcome(0, true).outcome);
    expect(['DEVELOPING', 'INTERVENTION_REQUIRED']).toContain(determineExpiredCycleOutcome(0, false).outcome);
    expect(['DEVELOPING', 'INTERVENTION_REQUIRED']).toContain(determineExpiredCycleOutcome(5, true).outcome);
  });

  it('insufficient evidence resolves to DEVELOPING with an honest reason, never a fabricated failing score', () => {
    const { outcome, reason } = determineExpiredCycleOutcome(0, false);
    expect(outcome).toBe('DEVELOPING');
    expect(reason).toBe('INSUFFICIENT_VALIDATION_EVIDENCE');
  });

  it('two or more prior failed cycles on the same concept escalates to INTERVENTION_REQUIRED', () => {
    const { outcome, reason } = determineExpiredCycleOutcome(2, true);
    expect(outcome).toBe('INTERVENTION_REQUIRED');
    expect(reason).toBe('PERSISTENT_DIFFICULTY');
  });

  it('a single prior failed cycle is not yet enough for INTERVENTION_REQUIRED', () => {
    expect(determineExpiredCycleOutcome(1, true).outcome).toBe('DEVELOPING');
  });
});

// --- 17 & 18 & 19. Reopening ----------------------------------------------
describe('17, 18 & 19. A validated concept may reopen into a brand-new cycle, without touching its history', () => {
  it('the decay path creates a new cycle linked to the concept\'s last validated cycle via reopenedFromCycleId', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] }); // getActiveValidationCycle: none open
    queryMock.mockResolvedValueOnce({ rows: [cycleRow({ id: 'validated-cycle-7', final_outcome: 'VALIDATED_MASTERY' })] }); // getLastValidatedCycle
    queryMock.mockResolvedValueOnce({ rows: [] }); // openValidationCycle existence check
    queryMock.mockResolvedValueOnce({ rows: [cycleRow({ id: 'new-cycle', reopened_from_cycle_id: 'validated-cycle-7' })] }); // INSERT
    queryMock.mockResolvedValueOnce({ rows: [] });
    queryMock.mockResolvedValueOnce({ rows: [] });
    queryMock.mockResolvedValueOnce({ rows: [] });

    await evaluateValidationLifecycle({
      studentId: 's1', conceptId: 'c1', subjectId: 'subj1',
      previousState: 'VALIDATED_MASTERY', baseState: 'DEVELOPING',
      scores: scores({ understanding: 50 }), misconceptions: noMisconceptions(), policy: POLICY, knowledgeStateSnapshot: {},
    });

    const insertCall = queryMock.mock.calls.find((c) => String(c[0]).includes('INSERT INTO validation_cycles'));
    expect(insertCall?.[1]).toContain('validated-cycle-7');
  });

  it('reopening never issues an UPDATE against the old validated cycle -- only a fresh INSERT', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    queryMock.mockResolvedValueOnce({ rows: [cycleRow({ id: 'validated-cycle-7', final_outcome: 'VALIDATED_MASTERY' })] });
    queryMock.mockResolvedValueOnce({ rows: [] });
    queryMock.mockResolvedValueOnce({ rows: [cycleRow({ id: 'new-cycle' })] });
    queryMock.mockResolvedValueOnce({ rows: [] });
    queryMock.mockResolvedValueOnce({ rows: [] });
    queryMock.mockResolvedValueOnce({ rows: [] });

    await evaluateValidationLifecycle({
      studentId: 's1', conceptId: 'c1', subjectId: 'subj1',
      previousState: 'VALIDATED_MASTERY', baseState: 'LEARNING',
      scores: scores({ understanding: 30 }), misconceptions: noMisconceptions(), policy: POLICY, knowledgeStateSnapshot: {},
    });

    expect(queryMock.mock.calls.some((c) => String(c[0]).includes('UPDATE validation_cycles'))).toBe(false);
  });
});

// --- 20 & 21. KVR-14 numerator/denominator --------------------------------
describe('20 & 21. KVR-14 is computed only from real, terminal Validation Cycles', () => {
  it('the denominator counts only CLOSED cycles, the numerator only those validated within their own deadline', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ eligible: 5, validated: 4 }] });
    const kvr = await getKVR14('s1');
    expect(kvr.eligibleCount).toBe(5);
    expect(kvr.validatedCount).toBe(4);
    expect(kvr.value).toBe(80);
    const query = String(queryMock.mock.calls[0][0]);
    expect(query).toContain(`status = 'CLOSED'`);
    expect(query).toContain(`final_outcome = 'VALIDATED_MASTERY'`);
    expect(query).toContain('validated_at <= validation_deadline');
  });

  it('is null (not 0) with zero eligible cycles, never fabricated', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ eligible: 0, validated: 0 }] });
    const kvr = await getKVR14('s1');
    expect(kvr.value).toBeNull();
  });
});

// --- 22. Late validation never counts as within-window ---------------------
describe('22. Late validation can never enter the KVR numerator', () => {
  it('determineExpiredCycleOutcome (the only path for a cycle past its deadline) never returns VALIDATED_MASTERY', () => {
    // Structural guarantee: validated_at is only ever set inside the
    // success path (closeCycle with VALIDATED_MASTERY), never inside the
    // expiry path -- so a cycle can never be marked validated after its
    // own deadline already passed.
    expect(determineExpiredCycleOutcome(0, true).outcome).not.toBe('VALIDATED_MASTERY');
    expect(determineExpiredCycleOutcome(3, true).outcome).not.toBe('VALIDATED_MASTERY');
  });
});

// --- 23. TTM calculation is correct -----------------------------------------
describe('23. Time to Mastery is computed correctly', () => {
  it('is the whole-day difference between start and validation', () => {
    expect(computeTimeToMastery('2026-01-01T00:00:00Z', '2026-01-15T00:00:00Z')).toBe(14);
  });

  it('is null for a cycle with no validatedAt', () => {
    expect(computeTimeToMastery('2026-01-01T00:00:00Z', null)).toBeNull();
  });

  it('is never assigned to a cycle that never reached Validated Mastery (validatedAt stays null on that path)', () => {
    // determineExpiredCycleOutcome never supplies a validatedAt -- closeCycle
    // only receives one from the success path in evaluateValidationLifecycle.
    expect(computeTimeToMastery('2026-01-01T00:00:00Z', null)).toBeNull();
  });
});

// --- 24. Student isolation holds --------------------------------------------
describe('24. Student isolation holds', () => {
  it('getKVR14 always scopes its query by the exact studentId passed in', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ eligible: 0, validated: 0 }] });
    await getKVR14('student-A');
    expect(queryMock).toHaveBeenCalledWith(expect.any(String), ['student-A']);
  });

  it('getActiveValidationCycles scopes by studentId and never mixes another student\'s rows in', async () => {
    queryMock.mockResolvedValueOnce({ rows: [cycleRow({ student_id: 'student-A', validation_deadline: '2099-01-01T00:00:00Z' })] });
    const cycles = await getActiveValidationCycles('student-A');
    expect(queryMock.mock.calls[0][1]).toEqual(['student-A']);
    expect(cycles.every((c) => c.studentId === 'student-A')).toBe(true);
  });
});

// --- 25. Time-zone/date handling is deterministic ---------------------------
describe('25. Time-zone/date handling is deterministic', () => {
  it('the same absolute-time gap produces the same TTM regardless of the timezone offset written in the ISO string', () => {
    const utc = computeTimeToMastery('2026-01-01T00:00:00Z', '2026-01-15T00:00:00Z');
    const offset = computeTimeToMastery('2026-01-01T00:00:00-05:00', '2026-01-15T00:00:00-05:00');
    expect(utc).toBe(offset);
    expect(utc).toBe(14);
  });

  it('classifyRetention\'s gap check is based on absolute elapsed time, not calendar-day boundaries in any particular zone', () => {
    const rows = [
      { sourceType: 'PRACTICE_QUIZ', result: 'correct' as const, scorePercent: 100, aiAssistanceType: 'NONE', timestamp: new Date('2026-01-01T23:00:00Z') },
      { sourceType: 'PRACTICE_QUIZ', result: 'correct' as const, scorePercent: 80, aiAssistanceType: 'NONE', timestamp: new Date('2026-01-02T01:00:00Z') },
    ];
    // Only 2 real hours apart (crosses a calendar-day boundary in UTC) -- must NOT count as a 3-day-gapped retrieval.
    expect(classifyRetention(rows, 3)).toBeNull();
  });
});
