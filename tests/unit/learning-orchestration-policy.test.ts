/**
 * Phase 8 -- Step 8A1: adversarial certification of the PURE
 * deterministic orchestration policy (src/lib/learning-orchestration-policy.ts).
 *
 * No DB, no AI, no network, no clock leak, no runtime wiring. Every
 * test builds an explicit input and asserts on the returned value.
 * ARCHITECTURAL INVARIANT under test: the policy never mutates its
 * inputs and never depends on Date.now() / Math.random().
 */
import { describe, it, expect } from 'vitest';
import {
  ORCHESTRATION_POLICY_VERSION,
  ORCHESTRATION_HORIZON_DAYS,
  ORCHESTRATION_MAX_ITEMS_PER_DAY,
  LEARNING_PLAN_STATUSES,
  LEARNING_PLAN_ITEM_STATUSES,
  ORCHESTRATION_SOURCES,
  ORCHESTRATION_REASON_CODES,
  getOrchestrationGoalTier,
  compareOrchestrationCandidates,
  orderOrchestrationCandidates,
  computeOrchestrationHorizon,
  isValidHorizonBound,
  addDaysToIsoDate,
  daysBetweenIsoDates,
  isValidIanaTimezone,
  allocateCandidatesToHorizon,
  buildLearningPlanItemOperationKey,
  diffLearningPlanItems,
  isItemFrozen,
  canReplaceFrozenItem,
  CHURN_BUDGET_IMPLEMENTED,
  isTerminalItemStatus,
  type OrchestrationCandidate,
  type DailyCapacityInput,
} from '@/lib/learning-orchestration-policy';

const S = '11111111-1111-4111-8111-111111111111';
const SUBJ = '22222222-2222-4222-8222-222222222222';

function cand(o: Partial<OrchestrationCandidate> = {}): OrchestrationCandidate {
  return {
    studentId: S,
    subjectId: SUBJ,
    conceptId: 'c-1',
    intendedActivityType: 'PRACTICE',
    reasonCode: 'CURRICULUM_PROGRESSION',
    source: 'CURRICULUM_PROGRESSION',
    phase4PriorityScore: null,
    hardDeadline: null,
    earliestDate: null,
    latestDate: null,
    estimatedMinutes: 10,
    ...o,
  };
}

function day(date: string, o: Partial<DailyCapacityInput> = {}): DailyCapacityInput {
  return { date, availableMinutes: 120, maxItems: ORCHESTRATION_MAX_ITEMS_PER_DAY, available: true, ...o };
}

// ---------------------------------------------------------------------

describe('8A1 -- version + taxonomy (exact, no drift)', () => {
  it('ORCHESTRATION_POLICY_VERSION is 1', () => {
    expect(ORCHESTRATION_POLICY_VERSION).toBe(1);
  });
  it('ORCHESTRATION_HORIZON_DAYS is 14', () => {
    expect(ORCHESTRATION_HORIZON_DAYS).toBe(14);
  });
  it('ORCHESTRATION_MAX_ITEMS_PER_DAY is 4 (new Phase 8 orchestration default)', () => {
    expect(ORCHESTRATION_MAX_ITEMS_PER_DAY).toBe(4);
  });
  it('plan statuses are exactly ACTIVE / SUPERSEDED', () => {
    expect([...LEARNING_PLAN_STATUSES]).toEqual(['ACTIVE', 'SUPERSEDED']);
  });
  it('plan-item statuses are exactly the 6 (no IN_PROGRESS/BLOCKED/PAUSED/FAILED)', () => {
    expect([...LEARNING_PLAN_ITEM_STATUSES]).toEqual(['PLANNED', 'READY', 'COMPLETED', 'SKIPPED', 'EXPIRED', 'SUPERSEDED']);
  });
  it('orchestration sources are exactly the 8', () => {
    expect([...ORCHESTRATION_SOURCES]).toEqual([
      'PHASE4_DECISION', 'RETENTION_WINDOW', 'TRANSFER_READINESS', 'ASSESSMENT_PREP',
      'CURRICULUM_PROGRESSION', 'REMEDIATION', 'PREREQUISITE', 'MANUAL_RESCHEDULE',
    ]);
  });
  it('reason codes are exactly the 10', () => {
    expect([...ORCHESTRATION_REASON_CODES].sort()).toEqual([
      'ASSESSMENT_APPROACHING', 'CURRICULUM_PROGRESSION', 'LEARNER_REQUESTED', 'LEARNING_DEBT',
      'MISCONCEPTION_BLOCK', 'PREREQUISITE_FIRST', 'REMEDIATION_REQUIRED', 'RETENTION_DUE',
      'TRANSFER_PROGRESSION', 'VERIFICATION_READY',
    ]);
  });
  it('every reason code maps to a goal tier 1..7', () => {
    for (const rc of ORCHESTRATION_REASON_CODES) {
      const t = getOrchestrationGoalTier(rc);
      expect(t).toBeGreaterThanOrEqual(1);
      expect(t).toBeLessThanOrEqual(7);
    }
  });
  it('goal tiers: blocker(1) < retention(2) < assessment(3) < verification(4) < transfer(5) < curriculum(6) < learner(7)', () => {
    expect(getOrchestrationGoalTier('MISCONCEPTION_BLOCK')).toBe(1);
    expect(getOrchestrationGoalTier('PREREQUISITE_FIRST')).toBe(1);
    expect(getOrchestrationGoalTier('REMEDIATION_REQUIRED')).toBe(1);
    expect(getOrchestrationGoalTier('LEARNING_DEBT')).toBe(1);
    expect(getOrchestrationGoalTier('RETENTION_DUE')).toBe(2);
    expect(getOrchestrationGoalTier('ASSESSMENT_APPROACHING')).toBe(3);
    expect(getOrchestrationGoalTier('VERIFICATION_READY')).toBe(4);
    expect(getOrchestrationGoalTier('TRANSFER_PROGRESSION')).toBe(5);
    expect(getOrchestrationGoalTier('CURRICULUM_PROGRESSION')).toBe(6);
    expect(getOrchestrationGoalTier('LEARNER_REQUESTED')).toBe(7);
  });
  it('CHURN_BUDGET_IMPLEMENTED is false in 8A1 (deferred, non-blocking)', () => {
    expect(CHURN_BUDGET_IMPLEMENTED).toBe(false);
  });
  it('terminal item statuses', () => {
    expect(isTerminalItemStatus('PLANNED')).toBe(false);
    expect(isTerminalItemStatus('READY')).toBe(false);
    for (const s of ['COMPLETED', 'SKIPPED', 'EXPIRED', 'SUPERSEDED'] as const) expect(isTerminalItemStatus(s)).toBe(true);
  });
});

describe('8A1 -- horizon (timezone-explicit, 14 calendar days inclusive)', () => {
  it('anchored at a fixed instant + timezone -> [localDate, localDate+13]', () => {
    // 2026-09-06T12:00:00Z is 2026-09-06 in America/Bogota (UTC-5).
    const r = computeOrchestrationHorizon(new Date('2026-09-06T12:00:00Z'), 'America/Bogota');
    expect(r.ok).toBe(true);
    expect(r.horizonStart).toBe('2026-09-06');
    expect(r.horizonEnd).toBe('2026-09-19');
    expect(daysBetweenIsoDates(r.horizonStart!, r.horizonEnd!)).toBe(13); // 14 days inclusive
  });
  it('respects the timezone for the local calendar date (late-UTC instant rolls the day in +TZ)', () => {
    // 2026-09-06T23:30:00Z is already 2026-09-07 in Asia/Tokyo (UTC+9).
    const r = computeOrchestrationHorizon(new Date('2026-09-06T23:30:00Z'), 'Asia/Tokyo');
    expect(r.horizonStart).toBe('2026-09-07');
    expect(r.horizonEnd).toBe('2026-09-20');
  });
  it('invalid timezone -> deterministic failure, no UTC fallback inside the pure fn', () => {
    const r = computeOrchestrationHorizon(new Date('2026-09-06T12:00:00Z'), 'Not/AZone');
    expect(r).toEqual({ ok: false, error: 'INVALID_TIMEZONE' });
  });
  it('invalid now -> deterministic failure', () => {
    expect(computeOrchestrationHorizon(new Date('nope'), 'UTC')).toEqual({ ok: false, error: 'INVALID_NOW' });
  });
  it('isValidHorizonBound accepts 1..14 days, rejects 15', () => {
    expect(isValidHorizonBound('2026-09-06', '2026-09-06')).toBe(true); // 1 day
    expect(isValidHorizonBound('2026-09-06', '2026-09-19')).toBe(true); // 14 days
    expect(isValidHorizonBound('2026-09-06', '2026-09-20')).toBe(false); // 15 days
    expect(isValidHorizonBound('2026-09-19', '2026-09-06')).toBe(false); // inverted
  });
  it('isValidIanaTimezone', () => {
    expect(isValidIanaTimezone('UTC')).toBe(true);
    expect(isValidIanaTimezone('America/Bogota')).toBe(true);
    expect(isValidIanaTimezone('Middle/Earth')).toBe(false);
  });
  it('addDaysToIsoDate is DST-safe date-only arithmetic', () => {
    expect(addDaysToIsoDate('2026-03-07', 3)).toBe('2026-03-10'); // spans a US DST change
    expect(addDaysToIsoDate('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('8A1 -- candidate ordering (deterministic total order; NO concept ranking)', () => {
  it('goal tier ASC dominates everything', () => {
    const blocker = cand({ reasonCode: 'MISCONCEPTION_BLOCK', phase4PriorityScore: 1 });
    const curriculum = cand({ reasonCode: 'CURRICULUM_PROGRESSION', phase4PriorityScore: 99999 });
    expect(orderOrchestrationCandidates([curriculum, blocker])[0]).toBe(blocker);
  });
  it('within a tier: sooner hard deadline first', () => {
    const a = cand({ reasonCode: 'ASSESSMENT_APPROACHING', hardDeadline: '2026-09-10', conceptId: 'a' });
    const b = cand({ reasonCode: 'ASSESSMENT_APPROACHING', hardDeadline: '2026-09-08', conceptId: 'b' });
    expect(orderOrchestrationCandidates([a, b])[0]).toBe(b);
  });
  it('same tier + same deadline: higher CARRIED Phase 4 priorityScore first (never recomputed)', () => {
    const lo = cand({ reasonCode: 'RETENTION_DUE', phase4PriorityScore: 10, conceptId: 'lo' });
    const hi = cand({ reasonCode: 'RETENTION_DUE', phase4PriorityScore: 90, conceptId: 'hi' });
    expect(orderOrchestrationCandidates([lo, hi])[0]).toBe(hi);
  });
  it('a missing Phase 4 score never outranks a present one', () => {
    const withScore = cand({ reasonCode: 'RETENTION_DUE', phase4PriorityScore: 1, conceptId: 'x' });
    const noScore = cand({ reasonCode: 'RETENTION_DUE', phase4PriorityScore: null, conceptId: 'a' });
    expect(orderOrchestrationCandidates([noScore, withScore])[0]).toBe(withScore);
  });
  it('final tie-break: conceptId ASC then candidateKey/reasonCode ASC (fully stable)', () => {
    const a = cand({ reasonCode: 'CURRICULUM_PROGRESSION', conceptId: 'aaa', phase4PriorityScore: 5 });
    const b = cand({ reasonCode: 'CURRICULUM_PROGRESSION', conceptId: 'bbb', phase4PriorityScore: 5 });
    expect(orderOrchestrationCandidates([b, a]).map((c) => c.conceptId)).toEqual(['aaa', 'bbb']);
    expect(compareOrchestrationCandidates(a, a)).toBe(0);
  });
  it('subject-level items (no conceptId) sort by subject: fallback deterministically', () => {
    const x = cand({ conceptId: null, subjectId: 's-a', reasonCode: 'ASSESSMENT_APPROACHING' });
    const y = cand({ conceptId: null, subjectId: 's-b', reasonCode: 'ASSESSMENT_APPROACHING' });
    expect(orderOrchestrationCandidates([y, x])[0]).toBe(x);
  });
});

describe('8A1 -- allocation', () => {
  const HS = '2026-09-06';
  const HE = '2026-09-19';
  const fullCap = Array.from({ length: 14 }, (_, i) => day(addDaysToIsoDate(HS, i)));

  it('capacity: 30 minutes, durations 15/10/10 -> first two fit, third deferred INSUFFICIENT_CAPACITY', () => {
    const cs = [
      cand({ conceptId: 'a', estimatedMinutes: 15 }),
      cand({ conceptId: 'b', estimatedMinutes: 10 }),
      cand({ conceptId: 'c', estimatedMinutes: 10 }),
    ];
    const r = allocateCandidatesToHorizon({
      candidates: cs,
      dailyCapacity: [day(HS, { availableMinutes: 30, maxItems: 10 }), ...fullCap.slice(1).map((d) => day(d.date, { available: false }))],
      horizonStart: HS,
      horizonEnd: HE,
      now: new Date('2026-09-06T12:00:00Z'),
      timezone: 'UTC',
    });
    expect(r.placed.map((p) => p.candidate.conceptId)).toEqual(['a', 'b']);
    expect(r.deferred).toEqual([{ candidate: cs[2], reason: 'INSUFFICIENT_CAPACITY' }]);
  });

  it('never schedules before earliestDate (retention window)', () => {
    const c = cand({ conceptId: 'ret', reasonCode: 'RETENTION_DUE', intendedActivityType: 'RETENTION_CHECK', earliestDate: '2026-09-09', estimatedMinutes: 6 });
    const r = allocateCandidatesToHorizon({
      candidates: [c], dailyCapacity: fullCap, horizonStart: HS, horizonEnd: HE,
      now: new Date('2026-09-06T12:00:00Z'), timezone: 'UTC',
    });
    expect(r.placed).toHaveLength(1);
    expect(r.placed[0].scheduledDate).toBe('2026-09-09');
  });

  it('never schedules after latestDate', () => {
    const c = cand({ conceptId: 'l', latestDate: '2026-09-07' });
    const r = allocateCandidatesToHorizon({
      candidates: [c],
      dailyCapacity: [day('2026-09-06', { available: false }), day('2026-09-07', { available: false }), ...fullCap.slice(2)],
      horizonStart: HS, horizonEnd: HE, now: new Date('2026-09-06T12:00:00Z'), timezone: 'UTC',
    });
    expect(r.placed).toHaveLength(0);
    expect(r.deferred[0].reason).toBe('INSUFFICIENT_CAPACITY');
  });

  it('hard deadline: prefers a slot before the deadline (Wednesday over Friday)', () => {
    // deadline Thu 2026-09-10; Wed 09-09 and Fri 09-11 both open.
    const c = cand({ conceptId: 'hd', reasonCode: 'ASSESSMENT_APPROACHING', hardDeadline: '2026-09-10', estimatedMinutes: 10 });
    const cap = [
      ...['2026-09-06', '2026-09-07', '2026-09-08'].map((d) => day(d, { available: false })),
      day('2026-09-09'),
      day('2026-09-10', { available: false }),
      day('2026-09-11'),
      ...fullCap.slice(6),
    ];
    const r = allocateCandidatesToHorizon({
      candidates: [c], dailyCapacity: cap, horizonStart: HS, horizonEnd: HE,
      now: new Date('2026-09-06T12:00:00Z'), timezone: 'UTC',
    });
    expect(r.placed[0].scheduledDate).toBe('2026-09-09');
  });

  it('hard deadline unsatisfiable: no capacity before the deadline -> deferred HARD_DEADLINE_UNSATISFIABLE, never a silent post-deadline slot', () => {
    const c = cand({ conceptId: 'hd', reasonCode: 'ASSESSMENT_APPROACHING', hardDeadline: '2026-09-08', estimatedMinutes: 10 });
    const cap = [
      day('2026-09-06', { available: false }),
      day('2026-09-07', { available: false }),
      day('2026-09-08', { available: false }),
      ...fullCap.slice(3), // capacity only AFTER the deadline
    ];
    const r = allocateCandidatesToHorizon({
      candidates: [c], dailyCapacity: cap, horizonStart: HS, horizonEnd: HE,
      now: new Date('2026-09-06T12:00:00Z'), timezone: 'UTC',
    });
    expect(r.placed).toHaveLength(0);
    expect(r.deferred).toEqual([{ candidate: c, reason: 'HARD_DEADLINE_UNSATISFIABLE' }]);
  });

  it('fixed commitment stays on its supplied date; a capacity conflict there is surfaced, never auto-moved', () => {
    const c = cand({ conceptId: null, subjectId: SUBJ, reasonCode: 'ASSESSMENT_APPROACHING', source: 'ASSESSMENT_PREP', intendedActivityType: 'MOCK_EXAM', fixed: true, earliestDate: '2026-09-11', estimatedMinutes: 30 });
    const conflictCap = [
      ...fullCap.slice(0, 5),
      day('2026-09-11', { availableMinutes: 5, maxItems: 4 }), // not enough minutes
      ...fullCap.slice(6),
    ];
    const r = allocateCandidatesToHorizon({
      candidates: [c], dailyCapacity: conflictCap, horizonStart: HS, horizonEnd: HE,
      now: new Date('2026-09-06T12:00:00Z'), timezone: 'UTC',
    });
    expect(r.placed).toHaveLength(0);
    expect(r.deferred).toEqual([{ candidate: c, reason: 'FIXED_SLOT_CONFLICT' }]);
  });

  it('fixed commitment with capacity lands exactly on its date', () => {
    const c = cand({ conceptId: null, reasonCode: 'ASSESSMENT_APPROACHING', source: 'ASSESSMENT_PREP', intendedActivityType: 'MOCK_EXAM', fixed: true, earliestDate: '2026-09-11', estimatedMinutes: 30 });
    const r = allocateCandidatesToHorizon({
      candidates: [c], dailyCapacity: fullCap, horizonStart: HS, horizonEnd: HE,
      now: new Date('2026-09-06T12:00:00Z'), timezone: 'UTC',
    });
    expect(r.placed).toEqual([{ candidate: c, scheduledDate: '2026-09-11', estimatedMinutes: 30, operationKey: expect.any(String) }]);
  });

  it('maxItems per day is honored (INPUT-overridable)', () => {
    const cs = Array.from({ length: 3 }, (_, i) => cand({ conceptId: `c${i}`, estimatedMinutes: 5 }));
    const r = allocateCandidatesToHorizon({
      candidates: cs,
      dailyCapacity: [day(HS, { availableMinutes: 999, maxItems: 2 }), ...fullCap.slice(1).map((d) => day(d.date, { available: false }))],
      horizonStart: HS, horizonEnd: HE, now: new Date('2026-09-06T12:00:00Z'), timezone: 'UTC',
    });
    expect(r.placed).toHaveLength(2);
    expect(r.deferred[0].reason).toBe('INSUFFICIENT_CAPACITY');
  });

  it('maxSubjectSwitches is an INPUT (no default cap): unset -> unlimited subjects/day', () => {
    const cs = Array.from({ length: 4 }, (_, i) => cand({ conceptId: `c${i}`, subjectId: `s${i}`, estimatedMinutes: 5 }));
    const r = allocateCandidatesToHorizon({
      candidates: cs,
      dailyCapacity: [day(HS, { availableMinutes: 999, maxItems: 99 }), ...fullCap.slice(1).map((d) => day(d.date, { available: false }))],
      horizonStart: HS, horizonEnd: HE, now: new Date('2026-09-06T12:00:00Z'), timezone: 'UTC',
    });
    expect(r.placed).toHaveLength(4); // no subject cap applied
    const r2 = allocateCandidatesToHorizon({
      candidates: cs,
      dailyCapacity: [day(HS, { availableMinutes: 999, maxItems: 99 }), ...fullCap.slice(1).map((d) => day(d.date, { available: false }))],
      horizonStart: HS, horizonEnd: HE, now: new Date('2026-09-06T12:00:00Z'), timezone: 'UTC',
      options: { maxSubjectSwitches: 1 },
    });
    expect(r2.placed).toHaveLength(2); // first subject + one switch
  });

  it('does not mutate its inputs', () => {
    const cs = [cand({ conceptId: 'a' }), cand({ conceptId: 'b' })];
    const cap = [day(HS), day(addDaysToIsoDate(HS, 1))];
    const capSnapshot = JSON.stringify(cap);
    const csSnapshot = JSON.stringify(cs);
    allocateCandidatesToHorizon({ candidates: cs, dailyCapacity: cap, horizonStart: HS, horizonEnd: HE, now: new Date('2026-09-06T12:00:00Z'), timezone: 'UTC' });
    expect(JSON.stringify(cap)).toBe(capSnapshot);
    expect(JSON.stringify(cs)).toBe(csSnapshot);
  });
});

describe('8A1 -- plan-item operation key (deterministic identity; provenance excluded)', () => {
  const base = { studentId: S, conceptId: 'c-1', subjectId: SUBJ, reasonCode: 'RETENTION_DUE' as const, scheduledDate: '2026-09-09', orchestrationPolicyVersion: 1 };
  it('same input -> same key', () => {
    expect(buildLearningPlanItemOperationKey(base)).toBe(buildLearningPlanItemOperationKey({ ...base }));
  });
  it('differs on student / concept / reason / date / policy version', () => {
    const k = buildLearningPlanItemOperationKey(base);
    expect(buildLearningPlanItemOperationKey({ ...base, studentId: 'other' })).not.toBe(k);
    expect(buildLearningPlanItemOperationKey({ ...base, conceptId: 'c-2' })).not.toBe(k);
    expect(buildLearningPlanItemOperationKey({ ...base, reasonCode: 'CURRICULUM_PROGRESSION' })).not.toBe(k);
    expect(buildLearningPlanItemOperationKey({ ...base, scheduledDate: '2026-09-10' })).not.toBe(k);
    expect(buildLearningPlanItemOperationKey({ ...base, orchestrationPolicyVersion: 2 })).not.toBe(k);
  });
  it('subject-level item (null concept) uses subject: fallback', () => {
    const k = buildLearningPlanItemOperationKey({ ...base, conceptId: null });
    expect(k).toContain(`subject:${SUBJ}`);
  });
  it('is a "::"-joined stable string, not JSON', () => {
    expect(buildLearningPlanItemOperationKey(base)).toBe(`LPI::v1::${S}::c-1::RETENTION_DUE::2026-09-09`);
  });
  it('rejects a segment containing the separator', () => {
    expect(() => buildLearningPlanItemOperationKey({ ...base, conceptId: 'a::b' })).toThrow(/must not contain/);
  });
});

describe('8A1 -- minimal-diff plan model', () => {
  const live = (operationKey: string) => ({ operationKey, status: 'PLANNED' as const });
  it('same key present in both -> UNCHANGED', () => {
    const d = diffLearningPlanItems([live('k1')], [{ operationKey: 'k1' }]);
    expect(d).toEqual([{ kind: 'UNCHANGED', operationKey: 'k1' }]);
  });
  it('key only in proposed -> ADDED', () => {
    const d = diffLearningPlanItems([], [{ operationKey: 'k2' }]);
    expect(d).toEqual([{ kind: 'ADDED', operationKey: 'k2' }]);
  });
  it('live key no longer proposed -> SUPERSEDED', () => {
    const d = diffLearningPlanItems([live('k3')], []);
    expect(d).toEqual([{ kind: 'SUPERSEDED', operationKey: 'k3' }]);
  });
  it('a MOVE (day1 -> day2) = SUPERSEDED(old) + ADDED(new), never a mutable MOVED', () => {
    const old = buildLearningPlanItemOperationKey({ studentId: S, conceptId: 'c', subjectId: SUBJ, reasonCode: 'RETENTION_DUE', scheduledDate: '2026-09-09', orchestrationPolicyVersion: 1 });
    const moved = buildLearningPlanItemOperationKey({ studentId: S, conceptId: 'c', subjectId: SUBJ, reasonCode: 'RETENTION_DUE', scheduledDate: '2026-09-10', orchestrationPolicyVersion: 1 });
    const d = diffLearningPlanItems([{ operationKey: old, status: 'PLANNED' }], [{ operationKey: moved }]);
    expect(d).toEqual([
      { kind: 'ADDED', operationKey: moved },
      { kind: 'SUPERSEDED', operationKey: old },
    ].sort((a, b) => (a.operationKey < b.operationKey ? -1 : 1)));
  });
  it('terminal items are never reopened or superseded again', () => {
    for (const status of ['COMPLETED', 'SKIPPED', 'EXPIRED', 'SUPERSEDED'] as const) {
      // not in proposal -> not re-SUPERSEDED
      expect(diffLearningPlanItems([{ operationKey: 'kt', status }], [])).toEqual([]);
      // matches a proposal key -> not re-ADDED / not UNCHANGED
      expect(diffLearningPlanItems([{ operationKey: 'kt', status }], [{ operationKey: 'kt' }])).toEqual([]);
    }
  });
  it('output is sorted by operationKey (stable replay)', () => {
    const d = diffLearningPlanItems([], [{ operationKey: 'z' }, { operationKey: 'a' }, { operationKey: 'm' }]);
    expect(d.map((e) => e.operationKey)).toEqual(['a', 'm', 'z']);
  });
});

describe('8A1 -- frozen near-term window', () => {
  const now = new Date('2026-09-06T12:00:00Z'); // 2026-09-06 in UTC
  it('an item scheduled today (or earlier) is frozen', () => {
    expect(isItemFrozen({ now, timezone: 'UTC', scheduledDate: '2026-09-06' })).toBe(true);
    expect(isItemFrozen({ now, timezone: 'UTC', scheduledDate: '2026-09-05' })).toBe(true);
  });
  it('an item scheduled tomorrow+ is not frozen', () => {
    expect(isItemFrozen({ now, timezone: 'UTC', scheduledDate: '2026-09-07' })).toBe(false);
  });
  it('timezone is explicit -- a +TZ learner sees "today" roll first', () => {
    const lateUtc = new Date('2026-09-06T23:30:00Z'); // already 09-07 in Tokyo
    expect(isItemFrozen({ now: lateUtc, timezone: 'Asia/Tokyo', scheduledDate: '2026-09-07' })).toBe(true);
    expect(isItemFrozen({ now: lateUtc, timezone: 'UTC', scheduledDate: '2026-09-07' })).toBe(false);
  });
  it('a frozen item is preserved by automatic replan; only criticalOverride or manualReschedule unlocks it', () => {
    expect(canReplaceFrozenItem(true)).toBe(false);
    expect(canReplaceFrozenItem(true, { criticalOverride: true })).toBe(true);
    expect(canReplaceFrozenItem(true, { manualReschedule: true })).toBe(true);
    expect(canReplaceFrozenItem(false)).toBe(true);
  });
});

describe('8A1 -- determinism + immutability + no clock/AI/DB', () => {
  it('shuffled candidate input, same snapshot -> byte-identical plan (100x)', () => {
    const cs = [
      cand({ conceptId: 'a', reasonCode: 'RETENTION_DUE', phase4PriorityScore: 5, estimatedMinutes: 6, earliestDate: '2026-09-08' }),
      cand({ conceptId: 'b', reasonCode: 'MISCONCEPTION_BLOCK', phase4PriorityScore: 1, estimatedMinutes: 8 }),
      cand({ conceptId: 'c', reasonCode: 'CURRICULUM_PROGRESSION', phase4PriorityScore: 50, estimatedMinutes: 10 }),
      cand({ conceptId: 'd', reasonCode: 'ASSESSMENT_APPROACHING', hardDeadline: '2026-09-12', phase4PriorityScore: 20, estimatedMinutes: 12 }),
    ];
    const cap = Array.from({ length: 14 }, (_, i) => day(addDaysToIsoDate('2026-09-06', i), { availableMinutes: 20, maxItems: 4 }));
    const inputs = () => ({
      candidates: [...cs], dailyCapacity: cap.map((d) => ({ ...d })),
      horizonStart: '2026-09-06', horizonEnd: '2026-09-19',
      now: new Date('2026-09-06T12:00:00Z'), timezone: 'UTC',
    });
    const first = JSON.stringify(allocateCandidatesToHorizon(inputs()));
    for (let i = 0; i < 100; i++) {
      const shuffled = [...cs].sort(() => (i % 2 ? 1 : -1));
      expect(JSON.stringify(allocateCandidatesToHorizon({ ...inputs(), candidates: shuffled }))).toBe(first);
    }
  });

  it('the policy source imports no DB / AI / Date.now / Math.random and never reimplements Phase 4', async () => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const raw = readFileSync(join(__dirname, '..', '..', 'src/lib/learning-orchestration-policy.ts'), 'utf8');
    // Strip block + line comments so doc-comment prose that NAMES the
    // forbidden Phase 4 functions (to say it never uses them) doesn't
    // trip the guard -- only real code is checked.
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/@\/lib\/db|from 'pg'|Date\.now\(\)|Math\.random\(\)/);
    expect(code).not.toMatch(/@\/lib\/ai|executeAI|callAnthropic|openai/i);
    // Phase 4 priority is CARRIED as a plain number input -- the policy
    // must not import from adaptive-learning-policy or define/call its
    // ranking primitives.
    expect(code).not.toMatch(/from '@\/lib\/adaptive-learning-policy'/);
    expect(code).not.toMatch(/\b(dominantSignal|selectActivityType|computeLearningState|rankLearningDecisions)\s*[({]/);
  });
});
