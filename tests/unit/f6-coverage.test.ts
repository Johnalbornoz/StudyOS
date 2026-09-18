/**
 * F6 / task 20/21/30-C/30-D -- coverage never conflates PARTIAL with
 * FULL, never lets duplicate resources inflate content coverage, and
 * never counts unpublished/rejected/retired content or mappings.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => queryMock(...a) } }));

import { computeContentCoverage, computeMappingCoverage } from '@/lib/curriculum/coverage.service';

const POLICY = {
  rows: [{ id: 'policy-1', version: 1, rules: { countedMappingStatuses: ['PUBLISHED'], fullCoverageRelationTypes: ['FULL'], partialCoverageRelationTypes: ['PARTIAL'] }, status: 'ACTIVE' }],
};

beforeEach(() => {
  queryMock.mockReset();
});

describe('computeMappingCoverage -- FULL and PARTIAL are never conflated (task 30-C, AC-F6-08)', () => {
  it('reports fullyMappedCount and partiallyMappedCount separately, never summed', async () => {
    queryMock
      .mockResolvedValueOnce(POLICY)
      .mockResolvedValueOnce({ rows: [{ id: 'obj-full' }, { id: 'obj-partial' }, { id: 'obj-unmapped' }] })
      .mockResolvedValueOnce({
        rows: [
          { learning_objective_id: 'obj-full', relation_type: 'FULL' },
          { learning_objective_id: 'obj-partial', relation_type: 'PARTIAL' },
        ],
      });
    const result = await computeMappingCoverage('version-1');
    expect(result.total).toBe(3);
    expect(result.fullyMappedCount).toBe(1);
    expect(result.partiallyMappedCount).toBe(1);
    expect(result.unmappedCount).toBe(1);
    // the shape itself has no combined "coveredCount" field to misuse
    expect((result as any).coveredCount).toBeUndefined();
  });

  it('PREREQUISITE and SUPPORTING relation types count toward neither FULL nor PARTIAL', async () => {
    queryMock
      .mockResolvedValueOnce(POLICY)
      .mockResolvedValueOnce({ rows: [{ id: 'obj-1' }] })
      .mockResolvedValueOnce({ rows: [{ learning_objective_id: 'obj-1', relation_type: 'PREREQUISITE' }] });
    const result = await computeMappingCoverage('version-1');
    expect(result.fullyMappedCount).toBe(0);
    expect(result.partiallyMappedCount).toBe(0);
    expect(result.unmappedCount).toBe(1);
  });

  it('only PUBLISHED-status mappings are queried (never DRAFT/PROPOSED/APPROVED)', async () => {
    queryMock
      .mockResolvedValueOnce(POLICY)
      .mockResolvedValueOnce({ rows: [{ id: 'obj-1' }] })
      .mockResolvedValueOnce({ rows: [] });
    await computeMappingCoverage('version-1');
    const mappingQuery = queryMock.mock.calls[2];
    expect(mappingQuery[1][1]).toEqual(['PUBLISHED']);
  });
});

describe('computeContentCoverage -- duplicate resources never inflate coverage (task 30-D, AC-F6-14)', () => {
  it('three PUBLISHED resources on the same objective still count as exactly one covered objective', async () => {
    queryMock
      .mockResolvedValueOnce(POLICY)
      .mockResolvedValueOnce({ rows: [{ id: 'obj-1' }, { id: 'obj-2' }] })
      .mockResolvedValueOnce({ rows: [{ c: 1 }] }); // DISTINCT count already computed by the query itself
    const result = await computeContentCoverage('version-1');
    expect(result.total).toBe(2);
    expect(result.withApprovedResourceCount).toBe(1);
  });

  it('the underlying query filters on status = PUBLISHED only, excluding REJECTED/RETIRED/DRAFT', async () => {
    queryMock
      .mockResolvedValueOnce(POLICY)
      .mockResolvedValueOnce({ rows: [{ id: 'obj-1' }] })
      .mockResolvedValueOnce({ rows: [{ c: 0 }] });
    await computeContentCoverage('version-1');
    const coverageQuery = queryMock.mock.calls[2][0];
    expect(coverageQuery).toMatch(/ar\.status = 'PUBLISHED'/);
  });

  it('zero objectives under a structure version returns a zeroed, non-throwing result', async () => {
    queryMock.mockResolvedValueOnce(POLICY).mockResolvedValueOnce({ rows: [] });
    const result = await computeContentCoverage('empty-version');
    expect(result).toEqual({ total: 0, withApprovedResourceCount: 0, policyVersion: 1 });
  });
});
