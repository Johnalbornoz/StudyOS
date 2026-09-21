/**
 * F2 -- institution membership and teacher assignment state machines.
 * Covers AC-F2-07/08/09/10/12 at the unit level.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const dbQueryMock = vi.fn();
const dbConnectMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => dbQueryMock(...a), connect: () => dbConnectMock() } }));

import {
  requestTeacherMembership,
  decideMembership,
  revokeMembership,
  createTeacherAssignment,
  endTeacherAssignment,
  inviteInstitutionAdmin,
  listDecidedMemberships,
} from '@/services/institution.service';

beforeEach(() => {
  dbQueryMock.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
  dbConnectMock.mockReset();
});

describe('requestTeacherMembership -- always PENDING, never grants access by itself', () => {
  it('inserts with status PENDING', async () => {
    dbQueryMock.mockResolvedValue({ rows: [{ id: 'm1', institution_id: 'inst-1', user_id: 'u1', membership_role: 'TEACHER', status: 'PENDING' }] });
    const membership = await requestTeacherMembership('inst-1', 'u1');
    expect(membership.status).toBe('PENDING');
    expect(dbQueryMock.mock.calls[0][0]).toMatch(/'PENDING'/);
  });
});

describe('decideMembership -- only transitions an actually-PENDING row', () => {
  it('approves a pending membership', async () => {
    dbQueryMock.mockResolvedValue({ rows: [{ id: 'm1' }], rowCount: 1 });
    expect(await decideMembership('m1', 'admin-1', 'APPROVED')).toBe(true);
    expect(dbQueryMock.mock.calls[0][0]).toMatch(/status = 'PENDING'/);
  });

  it('is a no-op against an already-decided or revoked membership (never re-decides history)', async () => {
    dbQueryMock.mockResolvedValue({ rows: [], rowCount: 0 });
    expect(await decideMembership('m1', 'admin-1', 'APPROVED')).toBe(false);
  });
});

describe('listDecidedMemberships -- coordinator audit view, scoped to one institution, excludes PENDING', () => {
  it('scopes the query to the given institutionId and excludes PENDING rows', async () => {
    dbQueryMock.mockResolvedValue({
      rows: [{ id: 'm1', institution_id: 'inst-1', user_id: 'u1', membership_role: 'TEACHER', status: 'APPROVED', requested_at: null, reviewed_at: '2026-09-20T00:00:00Z', reviewed_by_user_id: 'admin-1', user_email: 'teacher@test.com' }],
    });
    const rows = await listDecidedMemberships('inst-1');
    expect(dbQueryMock.mock.calls[0][1]).toEqual(['inst-1']);
    expect(dbQueryMock.mock.calls[0][0]).toMatch(/status != 'PENDING'/);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'm1', institutionId: 'inst-1', status: 'APPROVED', userEmail: 'teacher@test.com' });
  });
});

describe('revokeMembership -- soft revoke + cascading soft-end of assignments, transactional', () => {
  it('revokes the membership and ends its active assignments inside one transaction, never a DELETE', async () => {
    const client = { query: vi.fn(), release: vi.fn() };
    client.query.mockImplementation((sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return Promise.resolve({});
      if (sql.includes('UPDATE institution_memberships')) return Promise.resolve({ rowCount: 1, rows: [{ id: 'm1' }] });
      if (sql.includes('UPDATE teacher_assignments')) return Promise.resolve({ rowCount: 2 });
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    dbConnectMock.mockResolvedValue(client);

    const ok = await revokeMembership('m1', 'admin-1');
    expect(ok).toBe(true);
    expect(client.query).toHaveBeenCalledWith('BEGIN');
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    const calls = client.query.mock.calls.map((c: any) => c[0]);
    expect(calls.some((sql: string) => sql.includes("UPDATE institution_memberships") && sql.includes("'REVOKED'"))).toBe(true);
    expect(calls.some((sql: string) => sql.includes('UPDATE teacher_assignments') && sql.includes("'ENDED'"))).toBe(true);
    expect(calls.every((sql: string) => !sql.includes('DELETE'))).toBe(true);
  });

  it('rolls back and returns false when the membership is not currently APPROVED', async () => {
    const client = { query: vi.fn(), release: vi.fn() };
    client.query.mockImplementation((sql: string) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return Promise.resolve({});
      if (sql.includes('UPDATE institution_memberships')) return Promise.resolve({ rowCount: 0, rows: [] });
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    dbConnectMock.mockResolvedValue(client);

    expect(await revokeMembership('m1', 'admin-1')).toBe(false);
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });
});

describe('createTeacherAssignment -- requires an already-APPROVED TEACHER membership', () => {
  it('throws MEMBERSHIP_NOT_APPROVED and creates nothing when the membership is not approved', async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [] }); // membership check fails
    await expect(createTeacherAssignment('m1', { classId: 'c1' })).rejects.toThrow('MEMBERSHIP_NOT_APPROVED');
    expect(dbQueryMock).toHaveBeenCalledTimes(1); // never reached the INSERT
  });

  it('creates an ACTIVE assignment once the membership is confirmed approved', async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [{ '?': 1 }] }); // membership approved
    dbQueryMock.mockResolvedValueOnce({
      rows: [{ id: 'a1', institution_membership_id: 'm1', grade_id: null, class_id: 'c1', subject_label: 'Math', status: 'ACTIVE' }],
    });
    const assignment = await createTeacherAssignment('m1', { classId: 'c1', subjectLabel: 'Math' });
    expect(assignment.status).toBe('ACTIVE');
  });
});

describe('endTeacherAssignment -- soft end only', () => {
  it('issues an UPDATE to ENDED, never a DELETE', async () => {
    dbQueryMock.mockResolvedValue({ rows: [{ id: 'a1' }], rowCount: 1 });
    expect(await endTeacherAssignment('a1')).toBe(true);
    const sql = dbQueryMock.mock.calls[0][0];
    expect(sql).toMatch(/UPDATE teacher_assignments/);
    expect(sql).toMatch(/'ENDED'/);
    expect(sql).not.toMatch(/DELETE/);
  });
});

describe('inviteInstitutionAdmin -- the ONLY path to an INSTITUTION_ADMIN grant', () => {
  it('writes both the F1 user_roles grant (granted_via INVITATION) and an already-APPROVED membership', async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [] }); // user_roles insert
    dbQueryMock.mockResolvedValueOnce({
      rows: [{ id: 'm1', institution_id: 'inst-1', user_id: 'u1', membership_role: 'INSTITUTION_ADMIN', status: 'APPROVED' }],
    });
    const membership = await inviteInstitutionAdmin('inst-1', 'u1');
    expect(membership.status).toBe('APPROVED');
    expect(dbQueryMock.mock.calls[0][0]).toMatch(/'INVITATION'/);
    expect(dbQueryMock.mock.calls[0][0]).toMatch(/'INSTITUTION_ADMIN'/);
  });
});
