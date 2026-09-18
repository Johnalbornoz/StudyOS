/**
 * F4 / task 7/8/18 -- the concept<->canonical correspondence layer must
 * never merge by name alone when the candidate set is ambiguous, must
 * record an explicit UNRESOLVED row rather than leaving a concept
 * unmapped, and must never block concept creation on any outcome.
 *
 * ensureCatalogMapping's real call sequence (both db.query and
 * client.query resolve through the same mock below, so order matters):
 *   1. getMappingForConcept (existence check)
 *   2. concept -> subject name lookup
 *   3. concept -> label lookup
 *   4. client.query('BEGIN')
 *   5. client.query(gen_random_uuid())
 *   6. candidate search
 *   7..N. status-dependent INSERT(s)
 *   N+1. client.query('COMMIT')
 *   N+2. final getMappingForConcept re-read
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({
  db: {
    query: (...args: any[]) => queryMock(...args),
    connect: async () => ({ query: (...args: any[]) => queryMock(...args), release: () => {} }),
  },
}));

import { ensureCatalogMapping, confirmMapping, getMappingForConcept } from '@/lib/catalog/mapping.service';

beforeEach(() => {
  queryMock.mockReset();
});

describe('ensureCatalogMapping -- zero/one/many candidate handling', () => {
  it('is a no-op (1 query) when a mapping already exists', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ id: 'm1', learner_concept_id: 'c1', canonical_concept_id: 'cc1', status: 'MATCHED', mapping_method: 'EXACT_LABEL_MATCH', reviewed_by: null, reviewed_at: null }],
    });
    const result = await ensureCatalogMapping('c1');
    expect(result.status).toBe('MATCHED');
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it('zero candidates -> UNRESOLVED, never left unmapped', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [] }) // 1. getMappingForConcept: none yet
      .mockResolvedValueOnce({ rows: [{ subject_name: 'Mathematics' }] }) // 2. concept -> subject
      .mockResolvedValueOnce({ rows: [{ label: 'Some Unmatched Concept' }] }) // 3. label lookup
      .mockResolvedValueOnce({ rows: [] }) // 4. BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 'new-mapping-id' }] }) // 5. gen_random_uuid()
      .mockResolvedValueOnce({ rows: [] }) // 6. candidate search -- zero results
      .mockResolvedValueOnce({ rows: [] }) // 7. INSERT concept_catalog_mapping (UNRESOLVED)
      .mockResolvedValueOnce({ rows: [] }) // 8. COMMIT
      .mockResolvedValueOnce({
        rows: [{ id: 'new-mapping-id', learner_concept_id: 'c2', canonical_concept_id: null, status: 'UNRESOLVED', mapping_method: null, reviewed_by: null, reviewed_at: null }],
      }); // 9. final re-read

    const result = await ensureCatalogMapping('c2');
    expect(result.status).toBe('UNRESOLVED');
    expect(result.canonicalConceptId).toBeNull();
    expect(queryMock).toHaveBeenCalledTimes(9);
  });

  it('exactly one candidate -> MATCHED, records the candidate for audit', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [] }) // 1. no existing mapping
      .mockResolvedValueOnce({ rows: [{ subject_name: 'Mathematics' }] }) // 2.
      .mockResolvedValueOnce({ rows: [{ label: 'Linear Functions' }] }) // 3.
      .mockResolvedValueOnce({ rows: [] }) // 4. BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 'new-mapping-id' }] }) // 5. gen_random_uuid
      .mockResolvedValueOnce({ rows: [{ id: 'canonical-linear-functions' }] }) // 6. exactly 1 candidate
      .mockResolvedValueOnce({ rows: [] }) // 7. INSERT mapping MATCHED
      .mockResolvedValueOnce({ rows: [] }) // 8. INSERT candidate audit row
      .mockResolvedValueOnce({ rows: [] }) // 9. COMMIT
      .mockResolvedValueOnce({
        rows: [{ id: 'new-mapping-id', learner_concept_id: 'c3', canonical_concept_id: 'canonical-linear-functions', status: 'MATCHED', mapping_method: 'EXACT_LABEL_MATCH', reviewed_by: null, reviewed_at: null }],
      }); // 10. final re-read

    const result = await ensureCatalogMapping('c3');
    expect(result.status).toBe('MATCHED');
    expect(result.canonicalConceptId).toBe('canonical-linear-functions');
    expect(result.mappingMethod).toBe('EXACT_LABEL_MATCH');
    const candidateInsertCall = queryMock.mock.calls.find((c) => String(c[0]).includes('concept_catalog_mapping_candidates'));
    expect(candidateInsertCall).toBeTruthy();
  });

  it('two or more candidates -> AMBIGUOUS, never auto-picks one (INV-F4-04)', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [] }) // 1.
      .mockResolvedValueOnce({ rows: [{ subject_name: 'Mathematics' }] }) // 2.
      .mockResolvedValueOnce({ rows: [{ label: 'Derivative Rules' }] }) // 3.
      .mockResolvedValueOnce({ rows: [] }) // 4. BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 'new-mapping-id' }] }) // 5. gen_random_uuid
      .mockResolvedValueOnce({ rows: [{ id: 'candidate-sl' }, { id: 'candidate-hl' }] }) // 6. 2 candidates -- same name, different scope
      .mockResolvedValueOnce({ rows: [] }) // 7. INSERT mapping AMBIGUOUS
      .mockResolvedValueOnce({ rows: [] }) // 8. candidate row 1
      .mockResolvedValueOnce({ rows: [] }) // 9. candidate row 2
      .mockResolvedValueOnce({ rows: [] }) // 10. COMMIT
      .mockResolvedValueOnce({
        rows: [{ id: 'new-mapping-id', learner_concept_id: 'c4', canonical_concept_id: null, status: 'AMBIGUOUS', mapping_method: null, reviewed_by: null, reviewed_at: null }],
      }); // 11. final re-read

    const result = await ensureCatalogMapping('c4');
    expect(result.status).toBe('AMBIGUOUS');
    expect(result.canonicalConceptId).toBeNull(); // never auto-picked
    const candidateInserts = queryMock.mock.calls.filter((c) => String(c[0]).includes('concept_catalog_mapping_candidates'));
    expect(candidateInserts).toHaveLength(2); // both candidates recorded for review
  });

  it('rolls back the transaction if any step fails, never leaving a partial mapping', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [] }) // 1.
      .mockResolvedValueOnce({ rows: [{ subject_name: 'Mathematics' }] }) // 2.
      .mockResolvedValueOnce({ rows: [{ label: 'Whatever' }] }) // 3.
      .mockResolvedValueOnce({ rows: [] }) // 4. BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 'new-mapping-id' }] }) // 5. gen_random_uuid
      .mockResolvedValueOnce({ rows: [] }) // 6. zero candidates
      .mockRejectedValueOnce(new Error('db exploded')); // 7. the INSERT fails

    await expect(ensureCatalogMapping('c5')).rejects.toThrow('db exploded');
    const rollbackCall = queryMock.mock.calls.find((c) => c[0] === 'ROLLBACK');
    expect(rollbackCall).toBeTruthy();
  });
});

describe('confirmMapping -- explicit human review, never automatic', () => {
  it('records status MATCHED, MANUAL_REVIEW method, and who confirmed it', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await confirmMapping('mapping-1', 'canonical-1', 'reviewer-user-1');
    expect(queryMock).toHaveBeenCalledTimes(1);
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/MANUAL_REVIEW/);
    expect(sql).toMatch(/status = 'MATCHED'/);
    expect(params).toEqual(['mapping-1', 'canonical-1', 'reviewer-user-1']);
  });
});

describe('getMappingForConcept', () => {
  it('returns null when no mapping row exists yet', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    const result = await getMappingForConcept('unknown-concept');
    expect(result).toBeNull();
  });
});
