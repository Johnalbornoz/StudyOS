/**
 * Phase 8 -- Step 8E1: the post-commit orchestration trigger is
 * FAIL-SOFT, never creates a first plan, and only maintains an
 * already-ACTIVE plan.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const dbQueryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => dbQueryMock(...a) } }));
const warnMock = vi.fn();
vi.mock('@/lib/observability/operational-log', () => ({ logOperationalWarning: (...a: any[]) => warnMock(...a) }));
const maintainMock = vi.fn();
vi.mock('@/services/learning-plan-maintenance.service', () => ({ maintainLearningPlan: (...a: any[]) => maintainMock(...a) }));

import { notifyLearningOrchestrationChange } from '@/services/learning-plan-orchestration-trigger';

beforeEach(() => { dbQueryMock.mockReset(); warnMock.mockReset(); maintainMock.mockReset(); });

describe('8E1 -- notifyLearningOrchestrationChange', () => {
  it('no ACTIVE plan -> no-op, never calls maintain (a background trigger never creates a first plan)', async () => {
    dbQueryMock.mockResolvedValue({ rows: [], rowCount: 0 });
    await notifyLearningOrchestrationChange('s1', 'EVIDENCE_APPLIED');
    expect(maintainMock).not.toHaveBeenCalled();
  });

  it('ACTIVE plan -> calls maintainLearningPlan', async () => {
    dbQueryMock.mockResolvedValue({ rows: [{ '?column?': 1 }], rowCount: 1 });
    maintainMock.mockResolvedValue({ maintained: true, completed: 0, expired: 0 });
    await notifyLearningOrchestrationChange('s1', 'EVIDENCE_APPLIED');
    expect(maintainMock).toHaveBeenCalledWith('s1', expect.any(Date));
  });

  it('a maintenance failure is logged and SWALLOWED -- never throws (cognitive write stays committed)', async () => {
    dbQueryMock.mockResolvedValue({ rows: [{ '?column?': 1 }], rowCount: 1 });
    maintainMock.mockRejectedValue(new Error('boom'));
    await expect(notifyLearningOrchestrationChange('s1', 'EVIDENCE_APPLIED')).resolves.toBeUndefined();
    expect(warnMock).toHaveBeenCalledWith(expect.objectContaining({ subsystem: 'phase8-orchestrator', operation: 'notifyLearningOrchestrationChange' }));
  });

  it('a DB failure on the active-plan probe is also swallowed', async () => {
    dbQueryMock.mockRejectedValue(new Error('db down'));
    await expect(notifyLearningOrchestrationChange('s1', 'ASSESSMENT_CHANGED')).resolves.toBeUndefined();
    expect(warnMock).toHaveBeenCalled();
  });
});
