/**
 * F6 / task 14/15/16/30-E/30-G -- mapping editorial workflow: creator
 * cannot self-approve, AI cannot auto-publish, version replacement
 * retires the old PUBLISHED row atomically, direct retirement works.
 * hasEditorialRole is mocked directly so each test can focus purely on
 * mapping.service.ts's own SQL sequence and business rules.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => queryMock(...a), connect: async () => ({ query: (...a: any[]) => queryMock(...a), release: () => {} }) } }));

const hasEditorialRoleMock = vi.fn();
vi.mock('@/lib/curriculum/editorial.service', () => ({ hasEditorialRole: (...a: any[]) => hasEditorialRoleMock(...a) }));

import {
  approveMapping,
  createMapping,
  EditorialPermissionError,
  publishMapping,
  retireMapping,
  SelfApprovalError,
} from '@/lib/curriculum/mapping.service';

beforeEach(() => {
  queryMock.mockReset();
  hasEditorialRoleMock.mockReset();
});

describe('createMapping -- AI cannot auto-publish (INV-F6-11)', () => {
  it('an AI_SUGGESTED mapping is created as DRAFT, never PUBLISHED', async () => {
    hasEditorialRoleMock.mockResolvedValue(true);
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'm1', status: 'DRAFT', provenance: 'AI_SUGGESTED' }] });
    const mapping = await createMapping('CONCEPT', 'editor-1', {
      learningObjectiveId: 'obj-1', targetId: 'concept-1', relationType: 'FULL', provenance: 'AI_SUGGESTED', confidence: 0.9,
    });
    expect(mapping.status).toBe('DRAFT');
    const insertCall = queryMock.mock.calls[0];
    expect(insertCall[0]).toMatch(/'DRAFT'/);
    expect(insertCall[0]).not.toMatch(/'PUBLISHED'/);
  });

  it('requires an ACTIVE EDITOR grant, fails closed without one', async () => {
    hasEditorialRoleMock.mockResolvedValue(false);
    await expect(
      createMapping('CONCEPT', 'not-an-editor', { learningObjectiveId: 'obj-1', targetId: 'concept-1', relationType: 'FULL' })
    ).rejects.toThrow(EditorialPermissionError);
    expect(queryMock).not.toHaveBeenCalled();
  });
});

describe('approveMapping -- creator cannot self-approve (task 15, AC-F6-10)', () => {
  it('DENIES when actorUserId === created_by, before any UPDATE', async () => {
    hasEditorialRoleMock.mockResolvedValue(true);
    queryMock.mockResolvedValueOnce({ rows: [{ created_by: 'user-1', status: 'IN_REVIEW' }] });
    await expect(approveMapping('CONCEPT', 'user-1', 'mapping-1')).rejects.toThrow(SelfApprovalError);
    // only the SELECT ran -- no UPDATE was ever attempted
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it('ALLOWS when reviewer is a different user than the creator', async () => {
    hasEditorialRoleMock.mockResolvedValue(true);
    queryMock
      .mockResolvedValueOnce({ rows: [{ created_by: 'user-1', status: 'IN_REVIEW' }] })
      .mockResolvedValueOnce({ rows: [{ status: 'IN_REVIEW' }] }) // transition's own status re-check
      .mockResolvedValueOnce({ rows: [{ id: 'mapping-1', status: 'APPROVED' }] });
    const mapping = await approveMapping('CONCEPT', 'user-2', 'mapping-1');
    expect(mapping.status).toBe('APPROVED');
  });

  it('requires an ACTIVE REVIEWER grant', async () => {
    hasEditorialRoleMock.mockResolvedValue(false);
    await expect(approveMapping('CONCEPT', 'user-2', 'mapping-1')).rejects.toThrow(EditorialPermissionError);
    expect(queryMock).not.toHaveBeenCalled();
  });
});

describe('publishMapping -- version replacement retires the old PUBLISHED row atomically (task 12, INV-F6-09)', () => {
  it('retires the previous PUBLISHED mapping in the same group before publishing the new one', async () => {
    hasEditorialRoleMock.mockResolvedValue(true);
    queryMock
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ status: 'APPROVED', mapping_group_id: 'group-1' }] }) // current status check
      .mockResolvedValueOnce({ rows: [] }) // retire old PUBLISHED sibling
      .mockResolvedValueOnce({ rows: [{ id: 'mapping-2', status: 'PUBLISHED', mapping_group_id: 'group-1' }] }) // publish new
      .mockResolvedValueOnce({ rows: [] }); // COMMIT
    const mapping = await publishMapping('CONCEPT', 'publisher-1', 'mapping-2');
    expect(mapping.status).toBe('PUBLISHED');
    const retireCall = queryMock.mock.calls[2];
    expect(retireCall[0]).toMatch(/SET status = 'RETIRED'/);
    expect(retireCall[0]).toMatch(/status = 'PUBLISHED'/);
    expect(retireCall[0]).toMatch(/id <> \$2/);
  });

  it('rejects publishing a mapping that is not APPROVED', async () => {
    hasEditorialRoleMock.mockResolvedValue(true);
    queryMock
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ status: 'DRAFT', mapping_group_id: 'group-1' }] });
    await expect(publishMapping('CONCEPT', 'publisher-1', 'mapping-1')).rejects.toThrow();
    const rollbackCall = queryMock.mock.calls.find((c) => c[0] === 'ROLLBACK');
    expect(rollbackCall).toBeTruthy();
  });

  it('requires an ACTIVE PUBLISHER grant', async () => {
    hasEditorialRoleMock.mockResolvedValue(false);
    await expect(publishMapping('CONCEPT', 'not-a-publisher', 'mapping-1')).rejects.toThrow(EditorialPermissionError);
    expect(queryMock).not.toHaveBeenCalled();
  });
});

describe('retireMapping -- direct retirement without a replacement (task 30-G)', () => {
  it('transitions PUBLISHED -> RETIRED', async () => {
    hasEditorialRoleMock.mockResolvedValue(true);
    queryMock
      .mockResolvedValueOnce({ rows: [{ status: 'PUBLISHED' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'mapping-1', status: 'RETIRED' }] });
    const mapping = await retireMapping('CONCEPT', 'publisher-1', 'mapping-1');
    expect(mapping.status).toBe('RETIRED');
  });
});
