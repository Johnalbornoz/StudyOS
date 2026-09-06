/**
 * Phase 8 -- Step 8E1: pre-launch revalidation. A stale persisted
 * `intended_activity_type` is NEVER forced -- Phase 4's live decision
 * always wins.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getBestMock = vi.fn();
const getDecisionsMock = vi.fn();
const startSessionMock = vi.fn();
const getItemMock = vi.fn();

vi.mock('@/services/adaptive-teaching.service', () => ({ getBestLearningDecisionForConcept: (...a: any[]) => getBestMock(...a) }));
vi.mock('@/services/adaptive-learning-orchestrator.service', () => ({ getLearningDecisions: (...a: any[]) => getDecisionsMock(...a) }));
vi.mock('@/services/learning-session-engine.service', () => ({ startLearningSession: (...a: any[]) => startSessionMock(...a) }));
vi.mock('@/services/learning-plan-read.service', () => ({ getLearningPlanItem: (...a: any[]) => getItemMock(...a) }));

const dbQueryMock = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => dbQueryMock(...a) } }));

import { revalidateLearningPlanItem } from '@/services/learning-plan-revalidation.service';

const STU = 'stu-1';
const item = (o: Record<string, any> = {}) => ({
  id: 'i1', planId: 'p1', studentId: STU, subjectId: 'sub1', conceptId: 'c1', scheduledDate: '2026-09-08',
  timeWindow: null, intendedActivityType: 'PRACTICE', reasonCode: 'CURRICULUM_PROGRESSION', source: 'PHASE4_DECISION',
  priorityAtPlanTime: 1000, estimatedMinutes: 10, status: 'PLANNED', orchestrationPolicyVersion: 1, operationKey: 'k1',
  provenance: {}, supersededByItemId: null, createdAt: 'x', updatedAt: 'x', ...o,
});
const decision = (o: Record<string, any> = {}) => ({ actionConceptId: 'c1', subjectId: 'sub1', activityType: 'PRACTICE', priorityScore: 1000, learningState: 'DEVELOPING', ...o });

beforeEach(() => {
  getBestMock.mockReset(); getDecisionsMock.mockReset(); startSessionMock.mockReset(); getItemMock.mockReset();
  dbQueryMock.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
  startSessionMock.mockResolvedValue({ launchStatus: 'READY', launchTarget: '/dashboard/quiz?x' });
});

describe('8E1 -- revalidateLearningPlanItem', () => {
  it('item not found -> NO_LONGER_NEEDED, nothing to launch', async () => {
    getItemMock.mockResolvedValue(null);
    const r = await revalidateLearningPlanItem(STU, 'gone', '2026-09-08');
    expect(r).toMatchObject({ outcome: 'NO_LONGER_NEEDED', decision: null, launch: null });
  });

  it('already COMPLETED -> COMPLETE_ALREADY', async () => {
    getItemMock.mockResolvedValue(item({ status: 'COMPLETED' }));
    expect((await revalidateLearningPlanItem(STU, 'i1', '2026-09-08')).outcome).toBe('COMPLETE_ALREADY');
  });

  it('canonical evidence since the scheduled date -> COMPLETE_ALREADY (opening a page never does this)', async () => {
    getItemMock.mockResolvedValue(item());
    dbQueryMock.mockResolvedValue({ rows: [{ '?column?': 1 }], rowCount: 1 });
    const r = await revalidateLearningPlanItem(STU, 'i1', '2026-09-08');
    expect(r.outcome).toBe('COMPLETE_ALREADY');
    expect(startSessionMock).not.toHaveBeenCalled();
  });

  it('Phase 4 live decision matches the hint -> STILL_VALID, launches Phase 4 decision', async () => {
    getItemMock.mockResolvedValue(item({ intendedActivityType: 'PRACTICE' }));
    getBestMock.mockResolvedValue(decision({ activityType: 'PRACTICE' }));
    const r = await revalidateLearningPlanItem(STU, 'i1', '2026-09-08');
    expect(r.outcome).toBe('STILL_VALID');
    expect(startSessionMock).toHaveBeenCalledWith({ studentId: STU, learningDecision: expect.objectContaining({ activityType: 'PRACTICE' }) });
  });

  it('Phase 4 now wants a DIFFERENT activity -> REPLACE, launches Phase 4 (stale hint never forced)', async () => {
    getItemMock.mockResolvedValue(item({ intendedActivityType: 'PRACTICE' }));
    getBestMock.mockResolvedValue(decision({ activityType: 'REMEDIATION' }));
    const r = await revalidateLearningPlanItem(STU, 'i1', '2026-09-08');
    expect(r.outcome).toBe('REPLACE');
    expect(r.decision?.activityType).toBe('REMEDIATION');
    expect(startSessionMock).toHaveBeenCalledWith({ studentId: STU, learningDecision: expect.objectContaining({ activityType: 'REMEDIATION' }) });
  });

  it('a curriculum bootstrap item that Phase 4 now has a REAL decision for -> SUPERSEDE', async () => {
    getItemMock.mockResolvedValue(item({ source: 'CURRICULUM_PROGRESSION', intendedActivityType: 'PRACTICE' }));
    getBestMock.mockResolvedValue(decision({ activityType: 'REMEDIATION', priorityScore: 8000 }));
    const r = await revalidateLearningPlanItem(STU, 'i1', '2026-09-08');
    expect(r.outcome).toBe('SUPERSEDE');
  });

  it('no live Phase 4 decision, non-curriculum item -> NO_LONGER_NEEDED', async () => {
    getItemMock.mockResolvedValue(item({ source: 'PHASE4_DECISION' }));
    getBestMock.mockResolvedValue(null);
    const r = await revalidateLearningPlanItem(STU, 'i1', '2026-09-08');
    expect(r).toMatchObject({ outcome: 'NO_LONGER_NEEDED', decision: null, launch: null });
  });

  it('no live Phase 4 decision, curriculum item -> STILL_VALID via the canonical NOT_STARTED bootstrap (PRACTICE)', async () => {
    getItemMock.mockResolvedValue(item({ source: 'CURRICULUM_PROGRESSION', conceptId: 'newc' }));
    getBestMock.mockResolvedValue(null);
    const r = await revalidateLearningPlanItem(STU, 'i1', '2026-09-08');
    expect(r.outcome).toBe('STILL_VALID');
    expect(r.decision).toMatchObject({ activityType: 'PRACTICE', learningState: 'NOT_STARTED', priorityScore: 0 });
    expect(startSessionMock).toHaveBeenCalled();
  });

  it('subject-level MOCK item: STILL_VALID iff Phase 4 emits a matching MOCK decision for the subject', async () => {
    getItemMock.mockResolvedValue(item({ conceptId: null, intendedActivityType: 'MOCK_EXAM', subjectId: 'sM' }));
    getDecisionsMock.mockResolvedValue([decision({ subjectId: 'sM', activityType: 'MOCK_EXAM' })]);
    expect((await revalidateLearningPlanItem(STU, 'i1', '2026-09-08')).outcome).toBe('STILL_VALID');
    getDecisionsMock.mockResolvedValue([]);
    expect((await revalidateLearningPlanItem(STU, 'i1', '2026-09-08')).outcome).toBe('NO_LONGER_NEEDED');
  });
});
