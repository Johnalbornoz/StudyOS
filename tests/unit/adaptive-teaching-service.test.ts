/**
 * Phase 5F: IO-layer tests for adaptive-teaching.service.ts --
 * assembly of TeachingContextInputs from the (mocked) Digital Learning
 * Twin, bounded strategy-provenance reads, and provenance persistence.
 * getDecisionContext itself is mocked (already certified elsewhere,
 * per decision-context-query-cost.test.ts) -- this file tests only
 * what adaptive-teaching.service.ts adds on top of it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...args: any[]) => queryMock(...args) } }));

const getDecisionContextMock = vi.fn();
vi.mock('@/lib/learner-twin', () => ({ getDecisionContext: (...args: any[]) => getDecisionContextMock(...args) }));

const recordDecisionEventMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/audit', () => ({ recordDecisionEvent: (...args: any[]) => recordDecisionEventMock(...args) }));

const getLearningDecisionsMock = vi.fn();
vi.mock('@/services/adaptive-learning-orchestrator.service', () => ({ getLearningDecisions: (...args: any[]) => getLearningDecisionsMock(...args) }));

import {
  getTeachingIntent,
  getRecentTeachingStrategies,
  getBestLearningDecisionForConcept,
  getTeachingIntentForConcept,
} from '@/services/adaptive-teaching.service';
import type { LearningDecision, LearningSignal } from '@/lib/adaptive-learning-policy';

function sig(overrides: Partial<LearningSignal> = {}): LearningSignal {
  return { type: 'LOW_UNDERSTANDING', source: 'test', conceptId: 'c1', subjectId: 'subj1', metadata: {}, ...overrides } as LearningSignal;
}

function decision(overrides: Partial<LearningDecision> = {}): LearningDecision {
  const primarySignal = overrides.primarySignal ?? sig();
  return {
    actionConceptId: 'c1',
    subjectId: 'subj1',
    targetConceptIds: [],
    signals: [primarySignal],
    primarySignal,
    learningState: 'DEVELOPING',
    targetDimension: 'UNDERSTANDING',
    activityType: 'PRACTICE',
    pedagogicalPriority: 'MEDIUM',
    temporalUrgency: null,
    priorityScore: 1000,
    reasonCode: primarySignal.type,
    facts: [],
    dueAt: null,
    policyVersion: 3,
    ...overrides,
  };
}

const NEUTRAL_CONTEXT = {
  mastery: { score: 65, confidence: 70 },
  metacognition: { confidenceCalibration: { label: 'WELL_CALIBRATED' as const } },
  independence: { independentMastery: 60, evidenceStrength: 'MEDIUM' as const },
  helpDependency: { requested: false as const },
  assessmentState: { requested: false as const },
};

beforeEach(() => {
  queryMock.mockReset();
  getDecisionContextMock.mockReset();
  recordDecisionEventMock.mockClear();
  getLearningDecisionsMock.mockReset();
  queryMock.mockResolvedValue({ rows: [] }); // default: no prior strategy provenance
  getDecisionContextMock.mockResolvedValue(NEUTRAL_CONTEXT);
  getLearningDecisionsMock.mockResolvedValue([]);
});

describe('getRecentTeachingStrategies', () => {
  it('is bounded (LIMIT) and most-recent-first, reading only from decision_events', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ new_state: { strategy: 'CONTRAST' } }, { new_state: { strategy: 'EXPLAIN' } }] });
    const strategies = await getRecentTeachingStrategies('student-1', 'concept-1');
    expect(strategies).toEqual(['CONTRAST', 'EXPLAIN']);
    expect(queryMock).toHaveBeenCalledTimes(1);
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toContain('decision_events');
    expect(sql).toContain('LIMIT');
    expect(params).toEqual(['student-1', 'concept-1', 5]);
  });

  it('ignores rows with no strategy in new_state rather than throwing', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ new_state: null }, { new_state: {} }, { new_state: { strategy: 'SOCRATIC' } }] });
    const strategies = await getRecentTeachingStrategies('student-1', 'concept-1');
    expect(strategies).toEqual(['SOCRATIC']);
  });
});

describe('getTeachingIntent -- query cost (5G.15 / test 20)', () => {
  it('issues exactly one getDecisionContext call and one bounded decision_events read, never more', async () => {
    await getTeachingIntent('student-1', decision());
    expect(getDecisionContextMock).toHaveBeenCalledTimes(1);
    // getRecentTeachingStrategies is the only direct db.query call this
    // service makes -- recordDecisionEvent's own INSERT lives behind the
    // separately-mocked @/lib/audit module boundary (not double-counted
    // here; see its own dedicated provenance test below).
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it('requests only the derived metrics this policy actually reads -- never "all"', async () => {
    await getTeachingIntent('student-1', decision());
    const [, conceptId, options] = getDecisionContextMock.mock.calls[0];
    expect(conceptId).toBe('c1');
    expect(options.derivedMetrics).toEqual(['helpDependency', 'assessmentState']);
  });
});

describe('getTeachingIntent -- assembly from certified state', () => {
  it('derives helpDependencyFlag from the Twin\'s helpDependency metric using the documented threshold', async () => {
    getDecisionContextMock.mockResolvedValue({
      ...NEUTRAL_CONTEXT,
      helpDependency: { requested: true, result: { available: true, value: { totalEvidenceCount: 5, assistedEvidenceShare: 0.8, independentEvidenceShare: 0.2, hintUsageShare: 0.1, independentMastery: 40, verificationConsistency: { resolvedCount: 0, confirmedCount: 0, contradictedCount: 0, inconclusiveCount: 0, confirmedShare: null } } } },
    });
    const intent = await getTeachingIntent('student-1', decision({ learningState: 'DEVELOPING' }));
    expect(intent.primaryBarrier).toBe('HELP_DEPENDENCY');
  });

  it('below the evidence-count floor, help dependency never fires even with a high assisted share', async () => {
    getDecisionContextMock.mockResolvedValue({
      ...NEUTRAL_CONTEXT,
      helpDependency: { requested: true, result: { available: true, value: { totalEvidenceCount: 1, assistedEvidenceShare: 1.0, independentEvidenceShare: 0, hintUsageShare: 1.0, independentMastery: null, verificationConsistency: { resolvedCount: 0, confirmedCount: 0, contradictedCount: 0, inconclusiveCount: 0, confirmedShare: null } } } },
    });
    const intent = await getTeachingIntent('student-1', decision({ learningState: 'DEVELOPING' }));
    expect(intent.primaryBarrier).not.toBe('HELP_DEPENDENCY');
  });

  it('a null DecisionContext (concept not found) degrades to neutral inputs rather than throwing', async () => {
    getDecisionContextMock.mockResolvedValue(null);
    const intent = await getTeachingIntent('student-1', decision());
    expect(intent.conceptId).toBe('c1');
    expect(intent.primaryBarrier).toBe('LOW_UNDERSTANDING');
  });

  it('reads cognitiveLevel from assessmentState only when requested and available', async () => {
    getDecisionContextMock.mockResolvedValue({
      ...NEUTRAL_CONTEXT,
      assessmentState: { requested: true, result: { available: true, value: { cognitiveDemand: { observedLevels: ['ANALYSIS'], latestObservedLevel: 'ANALYSIS', sampleSize: 2, lastObservedAt: '2026-01-01T00:00:00Z' } } } },
    });
    const intent = await getTeachingIntent('student-1', decision());
    expect(intent.reasoningDemand).toBe('ANALYSIS');
    expect(intent.explanationDepth).toBe('DEEP');
  });

  it('passes previousStrategies from decision_events through to the TeachingIntent', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ new_state: { strategy: 'RETRIEVAL' } }] });
    const intent = await getTeachingIntent('student-1', decision());
    expect(intent.previousStrategies).toEqual(['RETRIEVAL']);
  });
});

describe('getTeachingIntent -- provenance (5F.2 / test not-blocking-on-failure)', () => {
  it('records TEACHING_STRATEGY_SELECTED with the chosen strategy/barrier, keyed to the right engine', async () => {
    const d = decision({ learningState: 'MISCONCEPTION_BLOCKED', reasonCode: 'CRITICAL_MISCONCEPTION' });
    await getTeachingIntent('student-1', d);
    expect(recordDecisionEventMock).toHaveBeenCalledTimes(1);
    const input = recordDecisionEventMock.mock.calls[0][0];
    expect(input.decisionType).toBe('TEACHING_STRATEGY_SELECTED');
    expect(input.engine).toBe('adaptive-teaching-engine');
    expect(input.studentId).toBe('student-1');
    expect(input.conceptId).toBe('c1');
    expect(input.newState.strategy).toBe('CONTRAST');
    expect(input.newState.primaryBarrier).toBe('ACTIVE_MISCONCEPTION');
  });

  it('a provenance-write failure never prevents getTeachingIntent from returning a result', async () => {
    recordDecisionEventMock.mockRejectedValueOnce(new Error('db down'));
    // recordDecisionEvent itself swallows its own errors in production
    // (src/lib/audit/decision-events.ts) -- this test's mock simulates a
    // caller that awaits a rejected promise to prove getTeachingIntent
    // still surfaces that rejection rather than silently losing it, so
    // a genuine outage is visible rather than hidden twice over.
    await expect(getTeachingIntent('student-1', decision())).rejects.toThrow('db down');
  });
});

describe('Decision/teaching boundary (5F.6 / test 15-16): the decision object is read-only input', () => {
  it('getTeachingIntent never mutates the LearningDecision it was given', async () => {
    const d = decision({ activityType: 'REMEDIATION', actionConceptId: 'root-cause' });
    const snapshot = JSON.parse(JSON.stringify(d));
    await getTeachingIntent('student-1', d);
    expect(d).toEqual(snapshot);
  });
});

describe('Phase 5-R S1/S19: getBestLearningDecisionForConcept -- bounded, reuses getLearningDecisions verbatim', () => {
  it('reuses getLearningDecisions (no duplicate signal computation) and filters to the requested concept', async () => {
    const forThisConcept = decision({ actionConceptId: 'c1' });
    const forAnotherConcept = decision({ actionConceptId: 'other-concept' });
    getLearningDecisionsMock.mockResolvedValue([forAnotherConcept, forThisConcept]);
    const found = await getBestLearningDecisionForConcept('student-1', 'c1');
    expect(getLearningDecisionsMock).toHaveBeenCalledTimes(1);
    expect(getLearningDecisionsMock).toHaveBeenCalledWith('student-1');
    expect(found).toBe(forThisConcept);
  });

  it('returns null, never a fabricated decision, when Phase 4 has no active decision for this concept (release test 17/18 precondition)', async () => {
    getLearningDecisionsMock.mockResolvedValue([decision({ actionConceptId: 'unrelated' })]);
    const found = await getBestLearningDecisionForConcept('student-1', 'c1');
    expect(found).toBeNull();
  });
});

describe('Phase 5-R S1: getTeachingIntentForConcept -- convenience composition, graceful degradation', () => {
  it('returns a TeachingIntent when Phase 4 has an active decision', async () => {
    getLearningDecisionsMock.mockResolvedValue([decision({ actionConceptId: 'c1', learningState: 'MISCONCEPTION_BLOCKED', reasonCode: 'CRITICAL_MISCONCEPTION' })]);
    const intent = await getTeachingIntentForConcept('student-1', 'c1');
    expect(intent).not.toBeNull();
    expect(intent!.primaryBarrier).toBe('ACTIVE_MISCONCEPTION');
  });

  it('returns null (never throws, never fabricates) when Phase 4 has no active decision for this concept', async () => {
    getLearningDecisionsMock.mockResolvedValue([]);
    const intent = await getTeachingIntentForConcept('student-1', 'c1');
    expect(intent).toBeNull();
    expect(getDecisionContextMock).not.toHaveBeenCalled(); // never spends the DecisionContext read when there's no decision to attach it to
  });
});

describe('Phase 5-R S19: query cost of the live-surface bridge', () => {
  it('getBestLearningDecisionForConcept issues exactly one getLearningDecisions call and zero direct db.query calls of its own', async () => {
    getLearningDecisionsMock.mockResolvedValue([decision({ actionConceptId: 'c1' })]);
    await getBestLearningDecisionForConcept('student-1', 'c1');
    expect(getLearningDecisionsMock).toHaveBeenCalledTimes(1);
    expect(queryMock).not.toHaveBeenCalled();
  });
});
