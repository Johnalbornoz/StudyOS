import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const getDailyLearningPlanMock = vi.fn();
vi.mock('@/services/learning-execution-scheduler.service', () => ({
  getDailyLearningPlan: (...a: any[]) => getDailyLearningPlanMock(...a),
}));

const startLearningSessionMock = vi.fn();
vi.mock('@/services/learning-session-engine.service', () => ({
  startLearningSession: (...a: any[]) => startLearningSessionMock(...a),
}));

import { getNextBestActionV3 } from '@/services/next-best-action-v3.service';
import type { LearningDecision, LearningSignal } from '@/lib/adaptive-learning-policy';

const STUDENT = 's1';

function sig(overrides: Partial<LearningSignal> = {}): LearningSignal {
  return { type: 'LOW_UNDERSTANDING', source: 'test', conceptId: 'c1', subjectId: 'subj1', metadata: { understandingScore: 40 }, ...overrides };
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
    temporalUrgency: 'HIGH',
    priorityScore: 1000,
    facts: [{ kind: 'lowUnderstanding', understandingScore: 40 }],
    remediationPathId: 'rp-1',
    diagnosisId: 'diag-1',
    occurrenceId: 'occ-1',
    dueAt: '2026-02-01T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  getDailyLearningPlanMock.mockReset();
  startLearningSessionMock.mockReset().mockResolvedValue({
    activityType: 'PRACTICE', evidenceMode: 'PRACTICE', actionConceptId: 'c1', subjectId: 'subj1',
    launchStatus: 'READY', launchTarget: '/dashboard/quiz?subjectId=subj1&conceptId=c1&mode=topic_practice', launchParams: {},
  });
});

describe('12. NBA v3 surfaces the first executable Phase 3D item', () => {
  it('returns the plan\'s first item, not a re-derived one', async () => {
    const top = decision({ actionConceptId: 'top-concept' });
    getDailyLearningPlanMock.mockResolvedValue({
      studentId: STUDENT, generatedAt: '2026-01-01T00:00:00Z', availableMinutes: 30, plannedMinutes: 10,
      items: [{ decision: top, sequence: 1, estimatedMinutes: 10, executionReason: 'FITS_IN_ORDER' }],
      deferred: [],
    });

    const result = await getNextBestActionV3(STUDENT);
    expect(result?.actionConceptId).toBe('top-concept');
    expect(result?.estimatedMinutes).toBe(10);
  });
});

describe('13. It returns Phase 3C facts/provenance unchanged', () => {
  it('facts, signals, and provenance IDs pass through byte-for-byte', async () => {
    const d = decision();
    getDailyLearningPlanMock.mockResolvedValue({
      studentId: STUDENT, generatedAt: '2026-01-01T00:00:00Z', availableMinutes: 30, plannedMinutes: 10,
      items: [{ decision: d, sequence: 1, estimatedMinutes: 10, executionReason: 'FITS_IN_ORDER' }],
      deferred: [],
    });

    const result = await getNextBestActionV3(STUDENT);
    expect(result?.facts).toEqual(d.facts);
    expect(result?.signals).toEqual(d.signals);
    expect(result?.primarySignal).toEqual(d.primarySignal);
    expect(result?.remediationPathId).toBe('rp-1');
    expect(result?.diagnosisId).toBe('diag-1');
    expect(result?.occurrenceId).toBe('occ-1');
  });
});

describe('14 & 15 & 16. No independent priority logic anywhere in NBA v3', () => {
  it('14: does not call nbaPriority', () => {
    const source = readFileSync(join(process.cwd(), 'src/services/next-best-action-v3.service.ts'), 'utf-8');
    expect(source).not.toMatch(/nbaPriority/);
  });
  it('15: does not call calculateConceptPriority', () => {
    const source = readFileSync(join(process.cwd(), 'src/services/next-best-action-v3.service.ts'), 'utf-8');
    expect(source).not.toMatch(/calculateConceptPriority/);
  });
  it('16: has no independent priority constants/bands', () => {
    const source = readFileSync(join(process.cwd(), 'src/services/next-best-action-v3.service.ts'), 'utf-8');
    expect(source).not.toMatch(/\bBAND\b|priorityScore\s*[:=]\s*\d|dominantSignal/);
  });
});

describe('17. Estimated minutes come from Phase 3D scheduler, not re-derived', () => {
  it('estimatedMinutes on the result is exactly the scheduler item\'s estimatedMinutes', async () => {
    const d = decision();
    getDailyLearningPlanMock.mockResolvedValue({
      studentId: STUDENT, generatedAt: '2026-01-01T00:00:00Z', availableMinutes: 30, plannedMinutes: 6,
      items: [{ decision: d, sequence: 1, estimatedMinutes: 6, executionReason: 'FITS_IN_ORDER' }],
      deferred: [],
    });
    const result = await getNextBestActionV3(STUDENT);
    expect(result?.estimatedMinutes).toBe(6);
  });
});

describe('18. No plan -> NBA v3 returns null cleanly', () => {
  it('an empty items list produces null, no error, no fabricated action', async () => {
    getDailyLearningPlanMock.mockResolvedValue({
      studentId: STUDENT, generatedAt: '2026-01-01T00:00:00Z', availableMinutes: 30, plannedMinutes: 0,
      items: [], deferred: [],
    });
    const result = await getNextBestActionV3(STUDENT);
    expect(result).toBeNull();
    expect(startLearningSessionMock).not.toHaveBeenCalled();
  });
});

describe('19. Structured Why This survives the localization boundary', () => {
  it('facts stay structured objects, never localized/prose strings, inside the service', async () => {
    const d = decision({ facts: [{ kind: 'learningDebt', severity: 3 }, { kind: 'examApproaching', daysUntil: 2 }] });
    getDailyLearningPlanMock.mockResolvedValue({
      studentId: STUDENT, generatedAt: '2026-01-01T00:00:00Z', availableMinutes: 30, plannedMinutes: 10,
      items: [{ decision: d, sequence: 1, estimatedMinutes: 10, executionReason: 'FITS_IN_ORDER' }],
      deferred: [],
    });
    const result = await getNextBestActionV3(STUDENT);
    expect(result?.facts).toEqual([{ kind: 'learningDebt', severity: 3 }, { kind: 'examApproaching', daysUntil: 2 }]);
    for (const fact of result?.facts ?? []) {
      expect(typeof fact.kind).toBe('string');
      expect(typeof fact).not.toBe('string'); // never collapsed into a rendered sentence
    }
  });
});

describe('sessionLaunch composition', () => {
  it('calls the Session Engine with the exact top decision, not a re-derived one', async () => {
    const d = decision({ actionConceptId: 'exact-one' });
    getDailyLearningPlanMock.mockResolvedValue({
      studentId: STUDENT, generatedAt: '2026-01-01T00:00:00Z', availableMinutes: 30, plannedMinutes: 10,
      items: [{ decision: d, sequence: 1, estimatedMinutes: 10, executionReason: 'FITS_IN_ORDER' }],
      deferred: [],
    });
    const result = await getNextBestActionV3(STUDENT);
    expect(startLearningSessionMock).toHaveBeenCalledWith({ studentId: STUDENT, learningDecision: d });
    expect(result?.sessionLaunch.launchStatus).toBe('READY');
  });
});
