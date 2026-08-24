import { describe, it, expect } from 'vitest';
import {
  buildDailyLearningPlan,
  estimateActivityMinutes,
  selectExecutableNextAction,
} from '@/lib/learning-execution-policy';
import type { LearningDecision, LearningSignal } from '@/lib/adaptive-learning-policy';

const STUDENT = 's1';

function sig(overrides: Partial<LearningSignal> = {}): LearningSignal {
  return { type: 'LOW_UNDERSTANDING', source: 'test', conceptId: 'c1', subjectId: 'subj1', metadata: {}, ...overrides };
}

function decision(overrides: Partial<LearningDecision> = {}): LearningDecision {
  const primarySignal = overrides.primarySignal ?? sig();
  return {
    actionConceptId: 'c1',
    subjectId: 'subj1',
    targetConceptIds: [],
    signals: [primarySignal],
    primarySignal,
    targetDimension: 'UNDERSTANDING',
    activityType: 'PRACTICE',
    pedagogicalPriority: 'MEDIUM',
    temporalUrgency: null,
    priorityScore: 1000,
    facts: [],
    dueAt: null,
    ...overrides,
  };
}

describe('1. Ranked decisions preserve relative order when everything fits', () => {
  it('two decisions that both fit come back in Phase 3C priority order', () => {
    const first = decision({ actionConceptId: 'first', priorityScore: 9000, activityType: 'PRACTICE' });
    const second = decision({ actionConceptId: 'second', priorityScore: 8000, activityType: 'REVIEW' });
    const plan = buildDailyLearningPlan(STUDENT, [first, second], { availableMinutes: 60, now: new Date('2026-01-01T00:00:00Z') });
    expect(plan.items.map((i) => i.decision.actionConceptId)).toEqual(['first', 'second']);
    expect(plan.items.map((i) => i.sequence)).toEqual([1, 2]);
  });
});

describe('2. The scheduler never recalculates priority', () => {
  it('every item carries its original priorityScore/pedagogicalPriority unchanged', () => {
    const d = decision({ priorityScore: 12345, pedagogicalPriority: 'CRITICAL' });
    const plan = buildDailyLearningPlan(STUDENT, [d], { availableMinutes: 60, now: new Date() });
    expect(plan.items[0].decision.priorityScore).toBe(12345);
    expect(plan.items[0].decision.pedagogicalPriority).toBe('CRITICAL');
  });
});

describe('3. 30 available minutes: a 20-minute #1 and a 10-minute #2 both schedule in order', () => {
  it('schedules both, in Phase 3C order', () => {
    const first = decision({ actionConceptId: 'A', priorityScore: 9000, activityType: 'CUMULATIVE_ASSESSMENT' }); // 20 min
    const second = decision({ actionConceptId: 'B', priorityScore: 8000, activityType: 'PRACTICE' }); // 10 min
    const plan = buildDailyLearningPlan(STUDENT, [first, second], { availableMinutes: 30, now: new Date() });
    expect(plan.items.map((i) => i.decision.actionConceptId)).toEqual(['A', 'B']);
    expect(plan.items.every((i) => i.executionReason === 'FITS_IN_ORDER')).toBe(true);
    expect(plan.plannedMinutes).toBe(30);
    expect(plan.deferred).toEqual([]);
  });
});

describe('4. 10 available minutes: a 20-minute #1 and a 10-minute #2 -- #2 executes, #1 defers, #2 never becomes "higher priority"', () => {
  it('produces exactly this outcome', () => {
    const first = decision({ actionConceptId: 'A', priorityScore: 9000, activityType: 'CUMULATIVE_ASSESSMENT' }); // 20 min
    const second = decision({ actionConceptId: 'B', priorityScore: 8000, activityType: 'PRACTICE' }); // 10 min
    const plan = buildDailyLearningPlan(STUDENT, [first, second], { availableMinutes: 10, now: new Date() });

    expect(plan.items.map((i) => i.decision.actionConceptId)).toEqual(['B']);
    expect(plan.items[0].executionReason).toBe('FILLS_REMAINING_TIME');
    expect(plan.deferred.map((d) => d.decision.actionConceptId)).toEqual(['A']);
    expect(plan.deferred[0].reason).toBe('INSUFFICIENT_TIME');

    // B's own priorityScore is untouched and still lower than A's -- it
    // executed only because A could not physically fit, never because
    // the scheduler decided B was pedagogically more important.
    expect(plan.items[0].decision.priorityScore).toBe(8000);
    expect(plan.deferred[0].decision.priorityScore).toBe(9000);
    expect(plan.deferred[0].decision.priorityScore).toBeGreaterThan(plan.items[0].decision.priorityScore);
  });
});

describe('5. No available time: nothing planned, everything deferred', () => {
  it('produces zero items, all decisions deferred', () => {
    const a = decision({ actionConceptId: 'A' });
    const b = decision({ actionConceptId: 'B' });
    const plan = buildDailyLearningPlan(STUDENT, [a, b], { availableMinutes: 0, now: new Date() });
    expect(plan.items).toEqual([]);
    expect(plan.deferred).toHaveLength(2);
    expect(plan.deferred.every((d) => d.reason === 'INSUFFICIENT_TIME')).toBe(true);
    expect(plan.plannedMinutes).toBe(0);
  });
});

describe('6. Estimated durations are deterministic by ActivityType', () => {
  it('every ActivityType has a fixed, repeatable estimate', () => {
    const types: LearningDecision['activityType'][] = [
      'PRACTICE', 'REVIEW', 'SOLO_CHECK', 'DIAGNOSTIC_CHECK', 'REMEDIATION',
      'SOLO_VERIFY', 'TRANSFER', 'RETENTION_CHECK', 'CUMULATIVE_ASSESSMENT', 'MOCK_EXAM',
    ];
    for (const t of types) {
      const a = estimateActivityMinutes(t);
      const b = estimateActivityMinutes(t);
      expect(a).toBe(b);
      expect(a).toBeGreaterThan(0);
    }
  });
});

describe('7. Same inputs + same `now` -> byte-identical plan', () => {
  it('calling twice with identical arguments produces deep-equal plans', () => {
    const decisions = [decision({ actionConceptId: 'A', priorityScore: 100 }), decision({ actionConceptId: 'B', priorityScore: 50 })];
    const now = new Date('2026-03-01T12:00:00Z');
    const plan1 = buildDailyLearningPlan(STUDENT, decisions, { availableMinutes: 30, now });
    const plan2 = buildDailyLearningPlan(STUDENT, decisions, { availableMinutes: 30, now });
    expect(plan1).toEqual(plan2);
  });
});

describe('8. Input array order does not change the outcome when ranking metadata is the same', () => {
  it('reversing the input array produces the identical plan', () => {
    const a = decision({ actionConceptId: 'A', priorityScore: 9000 });
    const b = decision({ actionConceptId: 'B', priorityScore: 5000 });
    const now = new Date('2026-01-01T00:00:00Z');
    const plan1 = buildDailyLearningPlan(STUDENT, [a, b], { availableMinutes: 60, now });
    const plan2 = buildDailyLearningPlan(STUDENT, [b, a], { availableMinutes: 60, now });
    expect(plan1.items.map((i) => i.decision.actionConceptId)).toEqual(['A', 'B']);
    expect(plan2.items.map((i) => i.decision.actionConceptId)).toEqual(['A', 'B']);
  });
});

describe('9. dueAt/temporalUrgency affect feasibility/communication but never replace Phase 3C priority', () => {
  it('a lower-priority decision with an urgent dueAt still schedules after a higher-priority one when both fit', () => {
    const highPriority = decision({ actionConceptId: 'high', priorityScore: 9000, dueAt: null, temporalUrgency: null });
    const urgentButLowerPriority = decision({
      actionConceptId: 'urgent-low',
      priorityScore: 1000,
      dueAt: '2026-01-01T00:00:00Z',
      temporalUrgency: 'CRITICAL',
    });
    const plan = buildDailyLearningPlan(STUDENT, [highPriority, urgentButLowerPriority], { availableMinutes: 60, now: new Date() });
    expect(plan.items.map((i) => i.decision.actionConceptId)).toEqual(['high', 'urgent-low']);
    // temporalUrgency/dueAt survive unchanged on the item for the UI to communicate, but did not reorder it.
    expect(plan.items[1].decision.temporalUrgency).toBe('CRITICAL');
  });
});

describe('10. Active remediation execution retains remediationPathId', () => {
  it('a REMEDIATION decision keeps its remediationPathId through the plan', () => {
    const d = decision({ activityType: 'REMEDIATION', remediationPathId: 'rp-123' });
    const plan = buildDailyLearningPlan(STUDENT, [d], { availableMinutes: 60, now: new Date() });
    expect(plan.items[0].decision.remediationPathId).toBe('rp-123');
  });
});

describe('11. rootCause/actionConceptId survives unchanged', () => {
  it('actionConceptId and rootCauseConceptId are untouched by scheduling', () => {
    const d = decision({ actionConceptId: 'root-B', rootCauseConceptId: 'root-B', targetConceptIds: ['target-A'] });
    const plan = buildDailyLearningPlan(STUDENT, [d], { availableMinutes: 60, now: new Date() });
    expect(plan.items[0].decision.actionConceptId).toBe('root-B');
    expect(plan.items[0].decision.rootCauseConceptId).toBe('root-B');
    expect(plan.items[0].decision.targetConceptIds).toEqual(['target-A']);
  });
});

describe('Indivisibility: an item is never partially scheduled', () => {
  it('a decision either takes its full estimated time or is fully deferred -- never split', () => {
    const d = decision({ activityType: 'MOCK_EXAM' }); // 30 min
    const plan = buildDailyLearningPlan(STUDENT, [d], { availableMinutes: 15, now: new Date() });
    expect(plan.items).toEqual([]);
    expect(plan.deferred).toHaveLength(1);
    expect(plan.plannedMinutes).toBe(0);
  });
});

describe('selectExecutableNextAction', () => {
  it('returns the first item, or null with an empty plan', () => {
    const d = decision({ actionConceptId: 'only' });
    const plan = buildDailyLearningPlan(STUDENT, [d], { availableMinutes: 60, now: new Date() });
    expect(selectExecutableNextAction(plan)?.decision.actionConceptId).toBe('only');

    const emptyPlan = buildDailyLearningPlan(STUDENT, [], { availableMinutes: 60, now: new Date() });
    expect(selectExecutableNextAction(emptyPlan)).toBeNull();
  });
});
