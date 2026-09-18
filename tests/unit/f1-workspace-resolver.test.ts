/**
 * F1 -- the single canonical workspace resolver. Covers
 * AC-F1-10/11/12: workspaces derive from roles through one authority,
 * invalid selection fails closed, and workspace switching is scoped
 * to a UI-context column only (asserted by inspecting exactly what
 * SQL setActiveWorkspace issues).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const dbQueryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => dbQueryMock(...a) } }));

import { resolveAvailableWorkspaces, resolveDefaultWorkspace, getActiveWorkspace, setActiveWorkspace } from '@/lib/identity';

function rolesRow(roles: string[]) {
  return { rows: roles.map((role) => ({ role, status: 'ACTIVE', granted_via: 'BACKFILL' })) };
}

beforeEach(() => {
  dbQueryMock.mockReset();
});

describe('resolveAvailableWorkspaces', () => {
  it('a Student-only user gets exactly [STUDENT]', async () => {
    dbQueryMock.mockResolvedValueOnce(rolesRow(['STUDENT']));
    expect(await resolveAvailableWorkspaces('u1')).toEqual(['STUDENT']);
  });

  it('Parent + Teacher yields both workspaces, in fixed priority order', async () => {
    dbQueryMock.mockResolvedValueOnce(rolesRow(['TEACHER', 'PARENT']));
    expect(await resolveAvailableWorkspaces('u1')).toEqual(['PARENT', 'TEACHER']);
  });

  it('Teacher + Institution Admin yields TEACHER + INSTITUTION', async () => {
    dbQueryMock.mockResolvedValueOnce(rolesRow(['TEACHER', 'INSTITUTION_ADMIN']));
    expect(await resolveAvailableWorkspaces('u1')).toEqual(['TEACHER', 'INSTITUTION']);
  });

  it('a user with zero active roles gets zero workspaces', async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [] });
    expect(await resolveAvailableWorkspaces('u1')).toEqual([]);
  });
});

describe('resolveDefaultWorkspace', () => {
  it('prefers STUDENT over any other available workspace', async () => {
    dbQueryMock.mockResolvedValueOnce(rolesRow(['PARENT', 'STUDENT', 'TEACHER']));
    expect(await resolveDefaultWorkspace('u1')).toBe('STUDENT');
  });

  it('returns null for a user with no roles yet (post-signup, pre-role-selection)', async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [] });
    expect(await resolveDefaultWorkspace('u1')).toBeNull();
  });
});

describe('setActiveWorkspace -- fails closed', () => {
  it('rejects (and writes nothing) a workspace not in the user\'s available set', async () => {
    dbQueryMock.mockResolvedValueOnce(rolesRow(['STUDENT'])); // resolveAvailableWorkspaces
    const ok = await setActiveWorkspace('u1', 'ADMIN');
    expect(ok).toBe(false);
    expect(dbQueryMock).toHaveBeenCalledTimes(1); // only the read, never an UPDATE
  });

  it('accepts a workspace that IS available and writes only users.active_workspace', async () => {
    dbQueryMock.mockResolvedValueOnce(rolesRow(['STUDENT', 'PARENT']));
    dbQueryMock.mockResolvedValueOnce({ rows: [] }); // UPDATE
    const ok = await setActiveWorkspace('u1', 'PARENT');
    expect(ok).toBe(true);
    expect(dbQueryMock).toHaveBeenCalledTimes(2);
    const updateSql = dbQueryMock.mock.calls[1][0];
    expect(updateSql).toMatch(/UPDATE users SET active_workspace/);
    // INV-F1-13/14: the write touches ONLY the users table -- never any
    // resource-authorization table.
    expect(updateSql).not.toMatch(/students|subjects|learning_evidence|mastery_records/i);
  });

  it('a privilege-escalation attempt (requesting ADMIN with only STUDENT role) is denied identically to any other unavailable workspace -- no special-cased error', async () => {
    dbQueryMock.mockResolvedValueOnce(rolesRow(['STUDENT']));
    expect(await setActiveWorkspace('attacker-user', 'ADMIN')).toBe(false);
  });
});

describe('getActiveWorkspace', () => {
  it('returns null when no workspace has ever been set', async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [{ active_workspace: null }] });
    expect(await getActiveWorkspace('u1')).toBeNull();
  });
});
