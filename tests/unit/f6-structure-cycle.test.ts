/**
 * F6 / task 9/30-J -- Structure Node parent-child cycle and orphan
 * prevention. Ports F4's canonical_concept_prerequisites cycle-detection
 * pattern; this test proves the port behaves identically.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => queryMock(...a), connect: async () => ({ query: (...a: any[]) => queryMock(...a), release: () => {} }) } }));

import { createStructureNode, setStructureNodeParent, StructureCycleError, StructureOrphanError } from '@/lib/curriculum/structure.service';

beforeEach(() => {
  queryMock.mockReset();
});

describe('createStructureNode -- orphan prevention', () => {
  it('rejects a parentId belonging to a different structure version', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ structure_version_id: 'other-version' }] });
    await expect(
      createStructureNode({ structureVersionId: 'version-1', parentId: 'node-in-other-version', nodeType: 'TOPIC', sourceLabel: 'X' })
    ).rejects.toThrow(StructureOrphanError);
  });

  it('rejects a parentId that does not exist at all', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await expect(
      createStructureNode({ structureVersionId: 'version-1', parentId: 'nonexistent', nodeType: 'TOPIC', sourceLabel: 'X' })
    ).rejects.toThrow(StructureOrphanError);
  });

  it('allows a root node (no parentId) without any extra query', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'node-1', structure_version_id: 'v1', parent_id: null, node_type: 'STRAND', source_label: 'Algebra', code: null, order_index: 0, description: null, status: 'ACTIVE' }] });
    const node = await createStructureNode({ structureVersionId: 'v1', nodeType: 'STRAND', sourceLabel: 'Algebra' });
    expect(node.parentId).toBeNull();
    expect(queryMock).toHaveBeenCalledTimes(1);
  });
});

describe('setStructureNodeParent -- cycle prevention', () => {
  it('rejects a direct self-parent', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ structure_version_id: 'v1' }] }) // node lookup
      .mockResolvedValueOnce({ rows: [{ structure_version_id: 'v1' }] }); // parent lookup
    await expect(setStructureNodeParent('node-A', 'node-A')).rejects.toThrow(StructureCycleError);
  });

  it('rejects re-parenting a node under its own descendant (A -> B -> C, then C becomes A\'s parent)', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ structure_version_id: 'v1' }] }) // node A lookup
      .mockResolvedValueOnce({ rows: [{ structure_version_id: 'v1' }] }) // proposed parent C lookup
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ x: 1 }] }); // cycle check: C is reachable from A
    await expect(setStructureNodeParent('node-A', 'node-C')).rejects.toThrow(StructureCycleError);
  });

  it('allows a genuinely new, non-cyclic parent', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ structure_version_id: 'v1' }] })
      .mockResolvedValueOnce({ rows: [{ structure_version_id: 'v1' }] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    await setStructureNodeParent('node-D', 'node-E');
    expect(queryMock).toHaveBeenCalledTimes(4);
    expect(queryMock.mock.calls[3][0]).toMatch(/UPDATE structure_nodes SET parent_id/);
  });

  it('rejects re-parenting under a node from a DIFFERENT structure version', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ structure_version_id: 'v1' }] })
      .mockResolvedValueOnce({ rows: [{ structure_version_id: 'v2' }] });
    await expect(setStructureNodeParent('node-F', 'node-in-v2')).rejects.toThrow(StructureOrphanError);
  });
});
