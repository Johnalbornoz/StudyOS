import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...args: any[]) => queryMock(...args) } }));

const getLearningDecisionsMock = vi.fn();
vi.mock('@/services/adaptive-learning-orchestrator.service', () => ({
  getLearningDecisions: (...a: any[]) => getLearningDecisionsMock(...a),
}));

import { getLearningOSSnapshot, loadConceptLabels } from '@/services/learning-os-snapshot.service';
import type { LearningDecision, LearningSignal } from '@/lib/adaptive-learning-policy';

const STUDENT = 's1';

function sig(overrides: Partial<LearningSignal> = {}): LearningSignal {
  return { type: 'LOW_UNDERSTANDING', source: 'test', conceptId: 'c1', subjectId: 'subj1', metadata: {}, ...overrides };
}

function decision(overrides: Partial<LearningDecision> = {}): LearningDecision {
  const primarySignal = overrides.primarySignal ?? sig();
  return {
    actionConceptId: 'c1', subjectId: 'subj1', targetConceptIds: [], signals: [primarySignal], primarySignal,
    learningState: 'DEVELOPING', targetDimension: 'UNDERSTANDING', activityType: 'PRACTICE', pedagogicalPriority: 'MEDIUM',
    temporalUrgency: null, priorityScore: 1000, reasonCode: primarySignal.type, facts: [], dueAt: null, policyVersion: 3, ...overrides,
  };
}

beforeEach(() => {
  queryMock.mockReset().mockResolvedValue({ rows: [] });
  getLearningDecisionsMock.mockReset().mockResolvedValue([]);
});

describe('1. One snapshot calls getLearningDecisions exactly once', () => {
  it('a single getLearningOSSnapshot call triggers exactly one getLearningDecisions call', async () => {
    await getLearningOSSnapshot(STUDENT, { preferredLanguage: 'en' });
    expect(getLearningDecisionsMock).toHaveBeenCalledTimes(1);
    expect(getLearningDecisionsMock).toHaveBeenCalledWith(STUDENT, 'en');
  });
});

describe('2. Daily plan is built from those exact decisions', () => {
  it('dailyPlan.items reference the SAME decision objects returned by getLearningDecisions', async () => {
    const d = decision({ actionConceptId: 'exact-decision' });
    getLearningDecisionsMock.mockResolvedValue([d]);
    const snapshot = await getLearningOSSnapshot(STUDENT, { availableMinutes: 60 });
    expect(snapshot.dailyPlan.items[0].decision).toBe(d);
    expect(snapshot.decisions[0]).toBe(d);
  });
});

describe('3 & 4. Snapshot does not independently score/rank -- Phase 3C rank remains the only ordering source', () => {
  it('3. the snapshot service source has no priority band/scoring logic of its own', () => {
    const source = readFileSync(join(process.cwd(), 'src/services/learning-os-snapshot.service.ts'), 'utf-8');
    expect(source).not.toMatch(/const BAND\s*=|function dominantSignal|priorityScore\s*[:=]\s*\d/);
  });

  it('4. ordering is delegated to Phase 3D\'s buildDailyLearningPlan, which itself re-applies Phase 3C\'s rankLearningDecisions -- never a duplicate', () => {
    const source = readFileSync(join(process.cwd(), 'src/services/learning-os-snapshot.service.ts'), 'utf-8');
    expect(source).toMatch(/buildDailyLearningPlan/);
    expect(source).not.toMatch(/function rankLearningDecisions|function buildDailyLearningPlan/); // imported, never redefined
  });

  it('a lower-priorityScore decision never sorts ahead of a higher one in the snapshot\'s dailyPlan', async () => {
    const high = decision({ actionConceptId: 'high', priorityScore: 9000 });
    const low = decision({ actionConceptId: 'low', priorityScore: 100 });
    getLearningDecisionsMock.mockResolvedValue([low, high]); // deliberately out of order
    const snapshot = await getLearningOSSnapshot(STUDENT, { availableMinutes: 60 });
    expect(snapshot.dailyPlan.items.map((i) => i.decision.actionConceptId)).toEqual(['high', 'low']);
  });
});

describe('5. No DB/LLM decision logic in the snapshot beyond IO composition', () => {
  it('the snapshot module has no AI/LLM import', () => {
    const source = readFileSync(join(process.cwd(), 'src/services/learning-os-snapshot.service.ts'), 'utf-8');
    expect(source).not.toMatch(/openai|anthropic|generateText|generateObject/i);
  });

  it('the only DB query in this file is the read-only, batch concept-label lookup -- no writes', () => {
    const source = readFileSync(join(process.cwd(), 'src/services/learning-os-snapshot.service.ts'), 'utf-8');
    expect(source).not.toMatch(/INSERT INTO|UPDATE |DELETE FROM/i);
  });
});

describe('6. Same snapshot input -> deterministic product model', () => {
  it('calling twice with identical decisions/now produces a deep-equal dailyPlan/nextExecutableItem', async () => {
    const decisions = [decision({ actionConceptId: 'a', priorityScore: 500 }), decision({ actionConceptId: 'b', priorityScore: 200 })];
    getLearningDecisionsMock.mockResolvedValue(decisions);
    const now = new Date('2026-01-01T00:00:00Z');
    const snap1 = await getLearningOSSnapshot(STUDENT, { availableMinutes: 60, now });
    const snap2 = await getLearningOSSnapshot(STUDENT, { availableMinutes: 60, now });
    expect(snap1.dailyPlan).toEqual(snap2.dailyPlan);
    expect(snap1.nextExecutableItem).toEqual(snap2.nextExecutableItem);
  });
});

describe('loadConceptLabels: batch, read-only, never fabricates', () => {
  it('issues exactly one query for many concept ids, deduplicated', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'c1', canonical_id: 'c1', label: 'Momentum', subject_name: 'Physics' }] });
    const labels = await loadConceptLabels(['c1', 'c1', 'c1'], 'en');
    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(queryMock.mock.calls[0][1][0]).toEqual(['c1']);
    expect(labels.get('c1')).toEqual({ label: 'Momentum', canonicalId: 'c1', subjectName: 'Physics' });
  });

  it('returns an empty map, no query at all, for an empty concept list', async () => {
    const labels = await loadConceptLabels([], 'en');
    expect(labels.size).toBe(0);
    expect(queryMock).not.toHaveBeenCalled();
  });
});

describe('nextExecutableItem matches the daily plan\'s own first item', () => {
  it('is the same object as dailyPlan.items[0]', async () => {
    const d = decision({ actionConceptId: 'top' });
    getLearningDecisionsMock.mockResolvedValue([d]);
    const snapshot = await getLearningOSSnapshot(STUDENT, { availableMinutes: 60 });
    expect(snapshot.nextExecutableItem).toBe(snapshot.dailyPlan.items[0]);
  });

  it('is null when nothing fits/exists', async () => {
    getLearningDecisionsMock.mockResolvedValue([]);
    const snapshot = await getLearningOSSnapshot(STUDENT);
    expect(snapshot.nextExecutableItem).toBeNull();
  });
});
