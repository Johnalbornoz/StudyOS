/**
 * F4 / task 13/22-M -- canonical prerequisite graph must reject any edge
 * that would create a cycle. Cycle detection is a recursive CTE
 * reachability check run before every insert (no native Postgres DAG
 * constraint exists).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const dbQueryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => dbQueryMock(...a) } }));

import { addCanonicalPrerequisite, PrerequisiteCycleError } from '@/lib/catalog/prerequisite.service';

beforeEach(() => {
  dbQueryMock.mockReset();
});

describe('addCanonicalPrerequisite -- cycle prevention', () => {
  it('rejects a direct self-loop without even querying the database', async () => {
    await expect(addCanonicalPrerequisite('A', 'A')).rejects.toThrow(PrerequisiteCycleError);
    expect(dbQueryMock).not.toHaveBeenCalled();
  });

  it('rejects an edge that would close a transitive cycle (A -> B -> C -> A)', async () => {
    // Proposing "A prerequisite-of C" when C is already (transitively)
    // a prerequisite of A (A->B->C already exists) would close the loop.
    // wouldCreateCycle(prereq=A, concept=C) checks: starting from A's
    // existing outgoing edges, is C already reachable? Simulate that A is
    // NOT reachable from itself via the existing graph in this call by
    // instead testing the actual closing edge: C -> A.
    dbQueryMock.mockResolvedValueOnce({ rowCount: 1, rows: [{ '?column?': 1 }] });
    await expect(addCanonicalPrerequisite('C', 'A')).rejects.toThrow(PrerequisiteCycleError);
    expect(dbQueryMock).toHaveBeenCalledTimes(1);
    expect(dbQueryMock.mock.calls[0][0]).toMatch(/WITH RECURSIVE reachable/);
  });

  it('allows a genuinely new, non-cyclic edge', async () => {
    dbQueryMock.mockResolvedValueOnce({ rowCount: 0, rows: [] }); // cycle check: not reachable
    dbQueryMock.mockResolvedValueOnce({ rows: [] }); // the actual insert
    await addCanonicalPrerequisite('D', 'E');
    expect(dbQueryMock).toHaveBeenCalledTimes(2);
    expect(dbQueryMock.mock.calls[1][0]).toMatch(/INSERT INTO canonical_concept_prerequisites/);
    expect(dbQueryMock.mock.calls[1][0]).toMatch(/ON CONFLICT DO NOTHING/);
  });

  it('never inserts when a cycle would be created', async () => {
    dbQueryMock.mockResolvedValueOnce({ rowCount: 1, rows: [{ x: 1 }] });
    await expect(addCanonicalPrerequisite('F', 'G')).rejects.toThrow();
    expect(dbQueryMock).toHaveBeenCalledTimes(1); // only the cycle check ran, never the insert
  });
});
