/**
 * F7 / task 6/30/adversarial-L -- exam version publish atomically
 * supersedes the prior PUBLISHED version, never deletes it, never
 * leaves two PUBLISHED rows.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => queryMock(...a), connect: async () => ({ query: (...a: any[]) => queryMock(...a), release: () => {} }) } }));

import { publishExamVersion } from '@/lib/assessment/exam-definition.service';

beforeEach(() => {
  queryMock.mockReset();
});

describe('publishExamVersion', () => {
  it('supersedes the prior PUBLISHED version atomically before publishing the new one', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ exam_definition_id: 'def-1', status: 'DRAFT' }] }) // current status check
      .mockResolvedValueOnce({ rows: [] }) // supersede old PUBLISHED
      .mockResolvedValueOnce({ rows: [{ id: 'v2', exam_definition_id: 'def-1', status: 'PUBLISHED' }] }) // publish new
      .mockResolvedValueOnce({ rows: [] }); // COMMIT
    const version = await publishExamVersion('v2');
    expect(version.status).toBe('PUBLISHED');
    const supersedeCall = queryMock.mock.calls[2];
    expect(supersedeCall[0]).toMatch(/SET status = 'SUPERSEDED'/);
    expect(supersedeCall[0]).toMatch(/status = 'PUBLISHED'/);
  });

  it('refuses to publish a version that is not DRAFT', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ exam_definition_id: 'def-1', status: 'RETIRED' }] });
    await expect(publishExamVersion('v-retired')).rejects.toThrow();
    const rollbackCall = queryMock.mock.calls.find((c) => c[0] === 'ROLLBACK');
    expect(rollbackCall).toBeTruthy();
  });
});
