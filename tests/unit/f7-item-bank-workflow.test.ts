/**
 * F7 / task 24/INV-F7-14 -- approved item status is its OWN independent
 * workflow, never inherited from F6 mapping approval; creator cannot
 * self-approve.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => queryMock(...a) } }));

import { approveApprovedItem, createApprovedItem, publishApprovedItem } from '@/lib/assessment/item-bank.service';

beforeEach(() => {
  queryMock.mockReset();
});

describe('approveApprovedItem -- creator cannot self-approve', () => {
  it('denies when the reviewer is the item creator', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ created_by: 'user-1' }] });
    await expect(approveApprovedItem('user-1', 'item-1')).rejects.toThrow(/creator != reviewer/);
    expect(queryMock).toHaveBeenCalledTimes(1); // only the created_by check ran, no UPDATE
  });

  it('allows a different reviewer', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ created_by: 'user-1' }] })
      .mockResolvedValueOnce({ rows: [{ status: 'PROPOSED' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'item-1', status: 'APPROVED' }] });
    const item = await approveApprovedItem('user-2', 'item-1');
    expect(item.status).toBe('APPROVED');
  });
});

describe('createApprovedItem -- an approved F6 concept mapping does not auto-approve any item', () => {
  it('every new item starts DRAFT regardless of the objective\'s own mapping status', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'item-1', status: 'DRAFT', learning_objective_id: 'obj-1', question_type: 'multiple_choice', content: {}, created_by: 'user-1' }] });
    const item = await createApprovedItem('user-1', { learningObjectiveId: 'obj-1', questionType: 'multiple_choice', content: { question: 'x' } });
    expect(item.status).toBe('DRAFT');
    const insertSql = queryMock.mock.calls[0][0];
    expect(insertSql).not.toMatch(/objective_concept_mappings/);
  });
});

describe('publishApprovedItem', () => {
  it('only publishes from APPROVED', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ status: 'DRAFT' }] });
    await expect(publishApprovedItem('item-1')).rejects.toThrow();
  });
});
