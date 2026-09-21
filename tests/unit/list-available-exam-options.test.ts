import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...args: any[]) => queryMock(...args) } }));

import { listAvailableExamOptions } from '@/lib/assessment/exam-definition.service';

describe('listAvailableExamOptions', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('returns the exam by name and version label once an ACTIVE definition has a PUBLISHED version', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          exam_definition_id: 'def-1',
          exam_definition_name: 'PAA Mathematics (Pilot)',
          exam_family: 'PAA',
          purpose: 'Pilot configuration / non-official fixture',
          exam_version_id: 'ver-1',
          version_label: 'Pilot 2026 v1',
        },
      ],
    });

    const options = await listAvailableExamOptions();

    expect(options).toEqual([
      {
        examDefinitionId: 'def-1',
        examDefinitionName: 'PAA Mathematics (Pilot)',
        examFamily: 'PAA',
        purpose: 'Pilot configuration / non-official fixture',
        examVersionId: 'ver-1',
        versionLabel: 'Pilot 2026 v1',
      },
    ]);
  });

  it('only queries ACTIVE definitions joined to PUBLISHED versions -- never DRAFT/RETIRED/SUPERSEDED', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await listAvailableExamOptions();

    const sql = String(queryMock.mock.calls[0][0]);
    expect(sql).toMatch(/d\.status = 'ACTIVE'/);
    expect(sql).toMatch(/v\.status = 'PUBLISHED'/);
  });

  it('returns an empty list when the catalog is genuinely empty (the real observed Preview state)', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    const options = await listAvailableExamOptions();
    expect(options).toEqual([]);
  });
});
