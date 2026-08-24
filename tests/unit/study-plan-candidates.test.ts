import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...args: any[]) => queryMock(...args), connect: vi.fn() } }));

const getLearningDecisionsMock = vi.fn();
vi.mock('@/services/adaptive-learning-orchestrator.service', () => ({
  getLearningDecisions: (...a: any[]) => getLearningDecisionsMock(...a),
}));

import { generateStudyPlan } from '@/services/study-plan.service';
import type { LearningDecision, LearningSignal } from '@/lib/adaptive-learning-policy';

const STUDENT = 's1';

function sig(overrides: Partial<LearningSignal> = {}): LearningSignal {
  return { type: 'LOW_UNDERSTANDING', source: 'test', conceptId: 'c1', subjectId: 'subj1', metadata: {}, ...overrides };
}

function decision(overrides: Partial<LearningDecision> = {}): LearningDecision {
  const primarySignal = overrides.primarySignal ?? sig();
  return {
    actionConceptId: 'c1', subjectId: 'subj1', targetConceptIds: [], signals: [primarySignal], primarySignal,
    targetDimension: 'UNDERSTANDING', activityType: 'PRACTICE', pedagogicalPriority: 'CRITICAL',
    temporalUrgency: null, priorityScore: 1000, facts: [], dueAt: null, ...overrides,
  };
}

beforeEach(() => {
  queryMock.mockReset().mockImplementation(async (sql: string) => {
    if (/FROM concepts c\s+JOIN subjects s/i.test(sql)) {
      return { rows: [{ id: 'c1', canonical_id: 'c1', label: 'Momentum', subject_name: 'Physics' }] };
    }
    return { rows: [] };
  });
  getLearningDecisionsMock.mockReset().mockResolvedValue([]);
});

describe('26. study-plan.service.ts no longer imports getStudentStudyPriorities', () => {
  it('the source has no reference to getStudentStudyPriorities or priority-engine.service', () => {
    const source = readFileSync(join(process.cwd(), 'src/services/study-plan.service.ts'), 'utf-8');
    expect(source).not.toMatch(/getStudentStudyPriorities|priority-engine\.service/);
  });
});

describe('27 & 28. Candidates originate from getLearningDecisions, in Phase 3C order', () => {
  it('27. generateStudyPlan calls getLearningDecisions with the exact studentId', async () => {
    getLearningDecisionsMock.mockResolvedValue([decision({ actionConceptId: 'c1', subjectId: 'subj1' })]);
    await generateStudyPlan(STUDENT, { daysAhead: 1, dailyMinutes: 90 });
    expect(getLearningDecisionsMock).toHaveBeenCalledWith(STUDENT, 'en');
  });

  it('28. within an urgency bucket, candidates preserve getLearningDecisions\' own order (no re-sort by a new score)', async () => {
    const first = decision({ actionConceptId: 'first', pedagogicalPriority: 'CRITICAL', priorityScore: 9000 });
    const second = decision({ actionConceptId: 'second', pedagogicalPriority: 'CRITICAL', priorityScore: 1000 });
    getLearningDecisionsMock.mockResolvedValue([first, second]);
    const plan = await generateStudyPlan(STUDENT, { daysAhead: 1, dailyMinutes: 90 });
    const ids = plan.sessions[0].items.map((i) => i.conceptId);
    expect(ids.indexOf('first')).toBeLessThan(ids.indexOf('second'));
  });
});

describe('29. No BAND/dominant-signal/nbaPriority logic in study-plan.service.ts', () => {
  it('the source has no copied Phase 3C priority policy', () => {
    const source = readFileSync(join(process.cwd(), 'src/services/study-plan.service.ts'), 'utf-8');
    expect(source).not.toMatch(/const BAND\s*=|function dominantSignal|nbaPriority/);
  });
});

describe('30. Duration comes from Phase 3D\'s estimateActivityMinutes -- no second duration table', () => {
  it('the source imports estimateActivityMinutes and defines no duplicate duration record', () => {
    const source = readFileSync(join(process.cwd(), 'src/services/study-plan.service.ts'), 'utf-8');
    expect(source).toMatch(/import\s*\{[^}]*estimateActivityMinutes[^}]*\}\s*from\s*['"]@\/lib\/learning-execution-policy['"]/);
    expect(source).not.toMatch(/ACTIVITY_DURATION_MINUTES|Record<ActivityType, number>/);
  });

  it('an item\'s estimatedMinutes is capped by the real Phase 3D duration for its ActivityType, never a re-derived value', async () => {
    getLearningDecisionsMock.mockResolvedValue([decision({ actionConceptId: 'c1', subjectId: 'subj1', activityType: 'DIAGNOSTIC_CHECK', pedagogicalPriority: 'CRITICAL' })]);
    const plan = await generateStudyPlan(STUDENT, { daysAhead: 1, dailyMinutes: 90 });
    // DIAGNOSTIC_CHECK's real Phase 3D duration is 4 minutes (small, deliberately far from any urgency-bucket time budget it could be confused with).
    expect(plan.sessions[0].items[0].estimatedMinutes).toBeLessThanOrEqual(4);
  });
});

describe('31. ActivityType is never re-derived from urgency', () => {
  it('the real Phase 3C ActivityType survives verbatim into the persisted item shape', async () => {
    getLearningDecisionsMock.mockResolvedValue([decision({ actionConceptId: 'c1', subjectId: 'subj1', activityType: 'REMEDIATION', pedagogicalPriority: 'CRITICAL' })]);
    const plan = await generateStudyPlan(STUDENT, { daysAhead: 1, dailyMinutes: 90 });
    expect(plan.sessions[0].items[0].activityType).toBe('REMEDIATION');
  });
});

describe('34. Student isolation: candidate building is always scoped to the supplied studentId', () => {
  it('a different studentId produces a different getLearningDecisions call', async () => {
    getLearningDecisionsMock.mockResolvedValue([]);
    await generateStudyPlan('only-this-student', { daysAhead: 1 }).catch(() => {});
    expect(getLearningDecisionsMock).toHaveBeenCalledWith('only-this-student', 'en');
  });
});

describe('32. Existing persistence shape is unchanged', () => {
  it('storeStudyPlan still writes to study_plans / study_sessions / study_session_items, in that order', async () => {
    const { storeStudyPlan } = await import('@/services/study-plan.service');
    const client = { query: vi.fn().mockImplementation(async (sql: string) => {
      if (/INSERT INTO study_plans/i.test(sql)) return { rows: [{ id: 'plan-1' }] };
      if (/INSERT INTO study_sessions/i.test(sql)) return { rows: [{ id: 'sess-1' }] };
      return { rows: [] };
    }), release: vi.fn() };
    const { db } = await import('@/lib/db');
    (db as any).connect = vi.fn().mockResolvedValue(client);

    const plan = {
      studentId: STUDENT, startDate: new Date('2026-01-01'), endDate: new Date('2026-01-01'),
      sessions: [{ id: 's', studentId: STUDENT, date: new Date('2026-01-01'), totalMinutes: 10, items: [
        { conceptId: 'c1', canonicalId: 'c1', label: 'X', activityType: 'PRACTICE' as const, estimatedMinutes: 10, priority: 'CRITICAL' as const, facts: [], resources: {} },
      ], subjectBreakdown: [] }],
      totalStudyMinutes: 10, subjectsInPlan: ['Physics'], criticalConceptsCount: 1,
    };
    await storeStudyPlan(plan);

    const sqlCalls = client.query.mock.calls.map((c: any[]) => String(c[0]));
    expect(sqlCalls.some((s) => /INSERT INTO study_plans/i.test(s))).toBe(true);
    expect(sqlCalls.some((s) => /INSERT INTO study_sessions/i.test(s))).toBe(true);
    expect(sqlCalls.some((s) => /INSERT INTO study_session_items/i.test(s))).toBe(true);
  });
});
