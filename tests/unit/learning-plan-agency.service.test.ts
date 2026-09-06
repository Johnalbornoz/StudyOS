/**
 * Phase 8 -- Step 8F1: learner-agency mutations (reschedule / skip /
 * extra practice). The 8B read boundary and the SOLE writer are mocked;
 * these assert the agency rules and that every write goes through the
 * projector with a correctly-shaped proposal.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => queryMock(...a) }, query: (...a: any[]) => queryMock(...a) }));

const getLearningPlanHorizon = vi.fn();
const getLearningPlanItem = vi.fn();
vi.mock('@/services/learning-plan-read.service', () => ({
  getLearningPlanHorizon: (...a: any[]) => getLearningPlanHorizon(...a),
  getLearningPlanItem: (...a: any[]) => getLearningPlanItem(...a),
}));

const projectLearningPlan = vi.fn();
const applyPlanItemStatusChanges = vi.fn();
vi.mock('@/services/learning-plan-projector.service', () => ({
  projectLearningPlan: (...a: any[]) => projectLearningPlan(...a),
  applyPlanItemStatusChanges: (...a: any[]) => applyPlanItemStatusChanges(...a),
}));

import {
  rescheduleLearningPlanItem,
  skipLearningPlanItem,
  requestExtraPractice,
} from '@/services/learning-plan-agency.service';

const STU = '11111111-1111-1111-1111-111111111111';
const PLAN = {
  id: 'plan-1',
  orchestrationPolicyVersion: 1,
  horizonStart: '2026-09-06',
  horizonEnd: '2026-09-19',
  planningAnchorAt: '2026-09-06T00:00:00.000Z',
  timezone: 'UTC',
  timezoneAssumed: false,
  goalContext: {},
};

function item(over: Partial<any> = {}) {
  return {
    id: 'item-1',
    planId: 'plan-1',
    studentId: STU,
    subjectId: 'subj-1',
    conceptId: 'con-1',
    scheduledDate: '2026-09-10',
    timeWindow: null,
    intendedActivityType: 'PRACTICE',
    reasonCode: 'CURRICULUM_PROGRESSION',
    source: 'CURRICULUM_PROGRESSION',
    priorityAtPlanTime: 0,
    estimatedMinutes: 20,
    status: 'PLANNED',
    orchestrationPolicyVersion: 1,
    operationKey: 'LPI::v1::' + STU + '::con-1::CURRICULUM_PROGRESSION::2026-09-10',
    provenance: {},
    supersededByItemId: null,
    createdAt: '', updatedAt: '',
    ...over,
  };
}

beforeEach(() => {
  queryMock.mockReset();
  getLearningPlanHorizon.mockReset();
  getLearningPlanItem.mockReset();
  projectLearningPlan.mockReset().mockResolvedValue({ planId: 'plan-1', planAction: 'RETAINED', diff: { added: 1, unchanged: 1, superseded: 1 }, stateChanged: true });
  applyPlanItemStatusChanges.mockReset().mockResolvedValue({ updated: 1 });
});

describe('8F1 -- rescheduleLearningPlanItem', () => {
  it('rejects a malformed date before any read', async () => {
    const r = await rescheduleLearningPlanItem(STU, 'item-1', '10-09-2026', '2026-09-06');
    expect(r).toEqual({ ok: false, error: 'DATE_INVALID' });
    expect(getLearningPlanHorizon).not.toHaveBeenCalled();
  });

  it('NO_ACTIVE_PLAN when there is no horizon', async () => {
    getLearningPlanHorizon.mockResolvedValue(null);
    expect(await rescheduleLearningPlanItem(STU, 'item-1', '2026-09-12', '2026-09-06')).toEqual({ ok: false, error: 'NO_ACTIVE_PLAN' });
  });

  it('rejects a past date and an out-of-horizon date', async () => {
    getLearningPlanHorizon.mockResolvedValue({ plan: PLAN, items: [item()] });
    expect(await rescheduleLearningPlanItem(STU, 'item-1', '2026-09-05', '2026-09-06')).toEqual({ ok: false, error: 'DATE_IN_PAST' });
    expect(await rescheduleLearningPlanItem(STU, 'item-1', '2026-09-30', '2026-09-06')).toEqual({ ok: false, error: 'DATE_OUT_OF_HORIZON' });
  });

  it('ITEM_NOT_FOUND vs ITEM_NOT_RESCHEDULABLE', async () => {
    getLearningPlanHorizon.mockResolvedValue({ plan: PLAN, items: [item()] });
    getLearningPlanItem.mockResolvedValue(null);
    expect(await rescheduleLearningPlanItem(STU, 'ghost', '2026-09-12', '2026-09-06')).toEqual({ ok: false, error: 'ITEM_NOT_FOUND' });
    getLearningPlanItem.mockResolvedValue(item({ id: 'done', status: 'COMPLETED' }));
    expect(await rescheduleLearningPlanItem(STU, 'done', '2026-09-12', '2026-09-06')).toEqual({ ok: false, error: 'ITEM_NOT_RESCHEDULABLE' });
  });

  it('moves the target (new date + MANUAL_RESCHEDULE), keeps reasonCode, leaves the other item untouched', async () => {
    const other = item({ id: 'item-2', conceptId: 'con-2', scheduledDate: '2026-09-11', operationKey: 'LPI::v1::' + STU + '::con-2::CURRICULUM_PROGRESSION::2026-09-11' });
    getLearningPlanHorizon.mockResolvedValue({ plan: PLAN, items: [item(), other] });

    const r = await rescheduleLearningPlanItem(STU, 'item-1', '2026-09-12', '2026-09-06');
    expect(r).toEqual({ ok: true, outcome: 'RESCHEDULED', newDate: '2026-09-12', diff: { added: 1, unchanged: 1, superseded: 1 } });

    const proposed = projectLearningPlan.mock.calls[0][0].proposedItems;
    const moved = proposed.find((p: any) => p.conceptId === 'con-1');
    const untouched = proposed.find((p: any) => p.conceptId === 'con-2');
    expect(moved.scheduledDate).toBe('2026-09-12');
    expect(moved.source).toBe('MANUAL_RESCHEDULE');
    expect(moved.reasonCode).toBe('CURRICULUM_PROGRESSION');
    expect(moved.operationKey).toContain('::2026-09-12');
    expect(untouched.operationKey).toBe(other.operationKey); // unchanged -> diff keeps it
  });
});

describe('8F1 -- skipLearningPlanItem', () => {
  it('ITEM_NOT_FOUND / ITEM_NOT_LIVE', async () => {
    getLearningPlanItem.mockResolvedValue(null);
    expect(await skipLearningPlanItem(STU, 'x')).toEqual({ ok: false, error: 'ITEM_NOT_FOUND' });
    getLearningPlanItem.mockResolvedValue(item({ status: 'COMPLETED' }));
    expect(await skipLearningPlanItem(STU, 'x')).toEqual({ ok: false, error: 'ITEM_NOT_LIVE' });
  });

  it('refuses to skip an integrity obligation', async () => {
    getLearningPlanItem.mockResolvedValue(item({ reasonCode: 'RETENTION_DUE' }));
    expect(await skipLearningPlanItem(STU, 'item-1')).toEqual({ ok: false, error: 'SKIP_NOT_ALLOWED' });
    expect(applyPlanItemStatusChanges).not.toHaveBeenCalled();
  });

  it('skips a curriculum-progression item through the write boundary', async () => {
    getLearningPlanItem.mockResolvedValue(item({ reasonCode: 'CURRICULUM_PROGRESSION' }));
    const r = await skipLearningPlanItem(STU, 'item-1');
    expect(r).toEqual({ ok: true, outcome: 'SKIPPED' });
    expect(applyPlanItemStatusChanges).toHaveBeenCalledWith(STU, [{ itemId: 'item-1', status: 'SKIPPED' }], undefined);
  });
});

describe('8F1 -- requestExtraPractice', () => {
  it('NO_ACTIVE_PLAN when there is no horizon', async () => {
    getLearningPlanHorizon.mockResolvedValue(null);
    expect(await requestExtraPractice(STU, 'con-9', '2026-09-06')).toEqual({ ok: false, error: 'NO_ACTIVE_PLAN' });
  });

  it('CONCEPT_NOT_ELIGIBLE when the concept does not resolve to an active subject', async () => {
    getLearningPlanHorizon.mockResolvedValue({ plan: PLAN, items: [] });
    queryMock.mockResolvedValue({ rows: [] });
    expect(await requestExtraPractice(STU, 'con-9', '2026-09-06')).toEqual({ ok: false, error: 'CONCEPT_NOT_ELIGIBLE' });
  });

  it('ALREADY_PLANNED when a live item exists for the concept', async () => {
    getLearningPlanHorizon.mockResolvedValue({ plan: PLAN, items: [item({ conceptId: 'con-9' })] });
    queryMock.mockResolvedValue({ rows: [{ id: 'con-9', subject_id: 'subj-1' }] });
    expect(await requestExtraPractice(STU, 'con-9', '2026-09-06')).toEqual({ ok: true, outcome: 'ALREADY_PLANNED' });
    expect(projectLearningPlan).not.toHaveBeenCalled();
  });

  it('appends one LEARNER_REQUESTED PRACTICE item and projects', async () => {
    getLearningPlanHorizon.mockResolvedValue({ plan: PLAN, items: [item()] });
    queryMock.mockResolvedValue({ rows: [{ id: 'con-9', subject_id: 'subj-9' }] });

    const r = await requestExtraPractice(STU, 'con-9', '2026-09-06');
    expect(r).toEqual({ ok: true, outcome: 'ADDED', diff: { added: 1, unchanged: 1, superseded: 1 } });

    const proposed = projectLearningPlan.mock.calls[0][0].proposedItems;
    expect(proposed).toHaveLength(2);
    const added = proposed.find((p: any) => p.conceptId === 'con-9');
    expect(added.reasonCode).toBe('LEARNER_REQUESTED');
    expect(added.intendedActivityType).toBe('PRACTICE');
    expect(added.priorityAtPlanTime).toBe(0);
    expect(added.scheduledDate).toBe('2026-09-06');
  });
});
