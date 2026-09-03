import { describe, it, expect, vi, beforeEach } from 'vitest';

const getLearningDecisionsMock = vi.fn();
vi.mock('@/services/adaptive-learning-orchestrator.service', () => ({
  getLearningDecisions: (...a: any[]) => getLearningDecisionsMock(...a),
}));

import { getDailyLearningPlan } from '@/services/learning-execution-scheduler.service';
import type { LearningDecision, LearningSignal } from '@/lib/adaptive-learning-policy';

const STUDENT = 's1';

function sig(): LearningSignal {
  return { type: 'LOW_UNDERSTANDING', source: 'test', conceptId: 'c1', subjectId: 'subj1', metadata: {} };
}

function decision(overrides: Partial<LearningDecision> = {}): LearningDecision {
  const primarySignal = sig();
  return {
    actionConceptId: 'c1', subjectId: 'subj1', targetConceptIds: [], signals: [primarySignal], primarySignal,
    learningState: 'DEVELOPING', targetDimension: 'UNDERSTANDING', activityType: 'PRACTICE', pedagogicalPriority: 'MEDIUM',
    temporalUrgency: null, priorityScore: 1000, reasonCode: primarySignal.type, facts: [], dueAt: null, policyVersion: 3, ...overrides,
  };
}

beforeEach(() => {
  getLearningDecisionsMock.mockReset().mockResolvedValue([]);
});

describe('getDailyLearningPlan (IO layer)', () => {
  it('forwards the exact studentId and preferredLanguage to getLearningDecisions', async () => {
    await getDailyLearningPlan(STUDENT, { preferredLanguage: 'es' });
    expect(getLearningDecisionsMock).toHaveBeenCalledWith(STUDENT, 'es');
  });

  it('defaults availableMinutes to a fixed product default when not supplied', async () => {
    getLearningDecisionsMock.mockResolvedValue([decision({ activityType: 'PRACTICE' })]); // 10 min
    const plan = await getDailyLearningPlan(STUDENT);
    expect(plan.availableMinutes).toBeGreaterThanOrEqual(10);
    expect(plan.items).toHaveLength(1);
  });

  it('respects an explicit availableMinutes override', async () => {
    getLearningDecisionsMock.mockResolvedValue([decision({ activityType: 'MOCK_EXAM' })]); // 30 min
    const plan = await getDailyLearningPlan(STUDENT, { availableMinutes: 5 });
    expect(plan.availableMinutes).toBe(5);
    expect(plan.items).toEqual([]);
    expect(plan.deferred).toHaveLength(1);
  });

  it('never reorders what getLearningDecisions already returned as Phase 3C\'s ranking', async () => {
    const first = decision({ actionConceptId: 'first', priorityScore: 9000 });
    const second = decision({ actionConceptId: 'second', priorityScore: 100 });
    getLearningDecisionsMock.mockResolvedValue([first, second]);
    const plan = await getDailyLearningPlan(STUDENT, { availableMinutes: 60 });
    expect(plan.items.map((i) => i.decision.actionConceptId)).toEqual(['first', 'second']);
  });

  it('is empty, not an error, when there are no decisions at all', async () => {
    getLearningDecisionsMock.mockResolvedValue([]);
    const plan = await getDailyLearningPlan(STUDENT);
    expect(plan.items).toEqual([]);
    expect(plan.deferred).toEqual([]);
  });
});
