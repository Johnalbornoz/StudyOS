import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...args: any[]) => queryMock(...args) } }));

const getConceptsAtRiskMock = vi.fn();
const getInterventionRequiredConceptsMock = vi.fn();
const getValidationDeadlinesMock = vi.fn();
vi.mock('@/services/validation-cycle.service', () => ({
  getConceptsAtRisk: (...a: any[]) => getConceptsAtRiskMock(...a),
  getInterventionRequiredConcepts: (...a: any[]) => getInterventionRequiredConceptsMock(...a),
  getValidationDeadlines: (...a: any[]) => getValidationDeadlinesMock(...a),
}));

const getUpcomingForStudentMock = vi.fn();
vi.mock('@/services/assessment.service', () => ({ getUpcomingForStudent: (...a: any[]) => getUpcomingForStudentMock(...a) }));

import { getDueItems } from '@/services/learning-scheduler.service';

function daysFromNow(n: number): string {
  return new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString();
}

beforeEach(() => {
  queryMock.mockReset();
  getConceptsAtRiskMock.mockReset().mockResolvedValue([]);
  getInterventionRequiredConceptsMock.mockReset().mockResolvedValue([]);
  getValidationDeadlinesMock.mockReset().mockResolvedValue([]);
  getUpcomingForStudentMock.mockReset().mockResolvedValue([]);
  queryMock.mockResolvedValue({ rows: [] });
});

describe('Phase 3 Pre-flight -- Learning Scheduling Clock', () => {
  it('surfaces AT_RISK and INTERVENTION_REQUIRED concepts by reusing 2.2B directly, never re-deriving them', async () => {
    getConceptsAtRiskMock.mockResolvedValue([{ conceptId: 'c1', subjectId: 'subj1' }]);
    getInterventionRequiredConceptsMock.mockResolvedValue([{ conceptId: 'c2', subjectId: 'subj1' }]);

    const items = await getDueItems('s1');
    expect(items).toContainEqual({ type: 'AT_RISK_CONCEPT', conceptId: 'c1', subjectId: 'subj1', dueAt: null, urgency: 'MEDIUM' });
    expect(items).toContainEqual({ type: 'INTERVENTION_REQUIRED_CONCEPT', conceptId: 'c2', subjectId: 'subj1', dueAt: null, urgency: 'HIGH' });
  });

  it('classifies a validation deadline already in the past as OVERDUE/CRITICAL, and one further out is omitted entirely', async () => {
    getValidationDeadlinesMock.mockResolvedValue([
      { conceptId: 'overdue', validationDeadline: daysFromNow(-2) },
      { conceptId: 'far-future', validationDeadline: daysFromNow(30) },
      { conceptId: 'soon', validationDeadline: daysFromNow(1) },
    ]);

    const items = await getDueItems('s1', { approachingWithinDays: 7 });
    const overdue = items.find((i) => i.conceptId === 'overdue');
    const soon = items.find((i) => i.conceptId === 'soon');
    const farFuture = items.find((i) => i.conceptId === 'far-future');

    expect(overdue).toMatchObject({ type: 'VALIDATION_DEADLINE_OVERDUE', urgency: 'CRITICAL' });
    expect(soon).toMatchObject({ type: 'VALIDATION_DEADLINE_APPROACHING', urgency: 'HIGH' });
    expect(farFuture).toBeUndefined();
  });

  it('surfaces an approaching exam by reusing assessment.service.getUpcomingForStudent, not a new query', async () => {
    getUpcomingForStudentMock.mockResolvedValue([
      { id: 'occ-1', subjectId: 'subj1', scheduledDate: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10), daysUntil: 2, status: 'scheduled', topics: [], examReadiness: null, ruleId: null, isRecurring: false },
    ]);
    const items = await getDueItems('s1');
    const examItem = items.find((i) => i.type === 'EXAM_APPROACHING');
    expect(examItem).toMatchObject({ occurrenceId: 'occ-1', subjectId: 'subj1', urgency: 'CRITICAL' });
  });

  it('never decides priority: two overlapping signals for the same concept both surface as separate items rather than being collapsed/ranked', async () => {
    getConceptsAtRiskMock.mockResolvedValue([{ conceptId: 'c1', subjectId: 'subj1' }]);
    getValidationDeadlinesMock.mockResolvedValue([{ conceptId: 'c1', validationDeadline: daysFromNow(-1) }]);

    const items = await getDueItems('s1');
    const forC1 = items.filter((i) => i.conceptId === 'c1');
    expect(forC1.length).toBe(2);
    expect(new Set(forC1.map((i) => i.type))).toEqual(new Set(['AT_RISK_CONCEPT', 'VALIDATION_DEADLINE_OVERDUE']));
  });

  it('is student-isolated: the studentId is forwarded to every underlying source, never queried globally', async () => {
    await getDueItems('only-this-student');
    expect(getConceptsAtRiskMock).toHaveBeenCalledWith('only-this-student');
    expect(getInterventionRequiredConceptsMock).toHaveBeenCalledWith('only-this-student');
    expect(getValidationDeadlinesMock).toHaveBeenCalledWith('only-this-student');
    expect(getUpcomingForStudentMock).toHaveBeenCalledWith('only-this-student');
    const retentionCall = queryMock.mock.calls.find(([sql]) => /mastery_records/i.test(sql));
    expect(retentionCall?.[1][0]).toBe('only-this-student');
    const remediationCall = queryMock.mock.calls.find(([sql]) => /remediation_paths/i.test(sql));
    expect(remediationCall?.[1][0]).toBe('only-this-student');
  });
});
