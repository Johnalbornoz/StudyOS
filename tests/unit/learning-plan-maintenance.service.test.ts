/**
 * Phase 8 -- Step 8E1: explicit daily maintenance -- reconcile
 * completion, expire passed items, roll the horizon (same ACTIVE plan
 * id), minimal-diff rebuild. Idempotent.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getHorizonMock = vi.fn();
const applyStatusMock = vi.fn();
const rebuildMock = vi.fn();
vi.mock('@/services/learning-plan-read.service', () => ({ getLearningPlanHorizon: (...a: any[]) => getHorizonMock(...a) }));
vi.mock('@/services/learning-plan-projector.service', () => ({ applyPlanItemStatusChanges: (...a: any[]) => applyStatusMock(...a) }));
vi.mock('@/services/learning-orchestration.service', () => ({ rebuildLearningPlan: (...a: any[]) => rebuildMock(...a) }));

const dbQueryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => dbQueryMock(...a) } }));

import { maintainLearningPlan } from '@/services/learning-plan-maintenance.service';

const NOW = new Date('2026-09-10T12:00:00.000Z');
const plan = { id: 'p1', timezone: 'UTC', horizonStart: '2026-09-06', horizonEnd: '2026-09-19' };
const liveItem = (o: Record<string, any> = {}) => ({ id: 'i1', conceptId: 'c1', scheduledDate: '2026-09-08', status: 'PLANNED', ...o });

beforeEach(() => {
  getHorizonMock.mockReset(); applyStatusMock.mockReset().mockResolvedValue({ updated: 0 }); rebuildMock.mockReset();
  dbQueryMock.mockReset().mockResolvedValue({ rows: [] });
  rebuildMock.mockResolvedValue({ planResult: { planId: 'p1', planAction: 'RETAINED', diff: { added: 0, unchanged: 1, superseded: 0 }, stateChanged: false } });
});

describe('8E1 -- maintainLearningPlan', () => {
  it('NO_ACTIVE_PLAN -> does nothing, never rebuilds', async () => {
    getHorizonMock.mockResolvedValue(null);
    const r = await maintainLearningPlan('s1', NOW);
    expect(r).toMatchObject({ maintained: false, reason: 'NO_ACTIVE_PLAN' });
    expect(rebuildMock).not.toHaveBeenCalled();
  });

  it('marks a completed item COMPLETED (from canonical evidence) and expires a passed item, then rolls the horizon', async () => {
    getHorizonMock.mockResolvedValue({ plan, items: [liveItem({ id: 'done', conceptId: 'cd', scheduledDate: '2026-09-08' }), liveItem({ id: 'missed', conceptId: 'cm', scheduledDate: '2026-09-07' })] });
    dbQueryMock.mockResolvedValue({ rows: [{ concept_id: 'cd', d: '2026-09-09' }] }); // evidence for cd only
    const r = await maintainLearningPlan('s1', NOW);
    expect(r.maintained).toBe(true);
    expect(r.completed).toBe(1);
    expect(r.expired).toBe(1);
    expect(applyStatusMock).toHaveBeenCalledWith('s1', expect.arrayContaining([
      { itemId: 'done', status: 'COMPLETED' },
      { itemId: 'missed', status: 'EXPIRED' },
    ]), undefined);
    expect(rebuildMock).toHaveBeenCalledWith('s1', { now: NOW }, expect.anything());
  });

  it('a clean plan (nothing completed / expired) -> 0 status changes, still rolls (rebuild is a no-op)', async () => {
    getHorizonMock.mockResolvedValue({ plan, items: [liveItem({ scheduledDate: '2026-09-12' })] });
    dbQueryMock.mockResolvedValue({ rows: [] });
    const r = await maintainLearningPlan('s1', NOW);
    expect(r.completed).toBe(0);
    expect(r.expired).toBe(0);
    expect(applyStatusMock).toHaveBeenCalledWith('s1', [], undefined);
    expect(r.rebuild?.planResult.stateChanged).toBe(false);
  });
});
