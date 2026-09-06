/**
 * Phase 8 -- Step 8E1: PURE plan-item completion / expiry derivation.
 * Completion comes ONLY from canonical evidence -- never "a page opened".
 */
import { describe, it, expect } from 'vitest';
import { derivePlanItemStatus } from '@/lib/learning-plan-completion';

const item = (o: Partial<Parameters<typeof derivePlanItemStatus>[0]> = {}) => ({
  conceptId: 'c1',
  scheduledDate: '2026-09-08',
  status: 'PLANNED' as const,
  ...o,
});

describe('8E1 -- derivePlanItemStatus', () => {
  it('COMPLETED when concept evidence exists on/after the scheduled date', () => {
    expect(derivePlanItemStatus(item(), [{ conceptId: 'c1', date: '2026-09-08' }], '2026-09-08')).toBe('COMPLETED');
    expect(derivePlanItemStatus(item(), [{ conceptId: 'c1', date: '2026-09-10' }], '2026-09-11')).toBe('COMPLETED');
  });

  it('NOT completed by evidence for a different concept, or evidence BEFORE the scheduled date', () => {
    expect(derivePlanItemStatus(item(), [{ conceptId: 'other', date: '2026-09-08' }], '2026-09-08')).toBe('LIVE');
    expect(derivePlanItemStatus(item(), [{ conceptId: 'c1', date: '2026-09-07' }], '2026-09-08')).toBe('LIVE');
  });

  it('opening a page / generating a session leaves NO evidence -> stays LIVE, never COMPLETED', () => {
    expect(derivePlanItemStatus(item(), [], '2026-09-08')).toBe('LIVE');
  });

  it('EXPIRED when the window has fully passed with no completion evidence (orchestration fact, not a cognitive failure)', () => {
    expect(derivePlanItemStatus(item({ scheduledDate: '2026-09-06' }), [], '2026-09-09')).toBe('EXPIRED');
  });

  it('a due-today item with no evidence is still LIVE (not yet expired)', () => {
    expect(derivePlanItemStatus(item({ scheduledDate: '2026-09-09' }), [], '2026-09-09')).toBe('LIVE');
  });

  it('terminal items are never reopened or re-expired', () => {
    expect(derivePlanItemStatus(item({ status: 'COMPLETED' }), [], '2026-09-20')).toBe('COMPLETED');
    expect(derivePlanItemStatus(item({ status: 'SUPERSEDED' }), [{ conceptId: 'c1', date: '2026-09-20' }], '2026-09-20')).toBe('LIVE');
    expect(derivePlanItemStatus(item({ status: 'SKIPPED' }), [], '2026-09-20')).toBe('LIVE');
  });

  it('a subject-level item (null concept) is never auto-completed by evidence', () => {
    expect(derivePlanItemStatus(item({ conceptId: null, scheduledDate: '2026-09-09' }), [{ conceptId: 'anything', date: '2026-09-09' }], '2026-09-09')).toBe('LIVE');
  });
});
