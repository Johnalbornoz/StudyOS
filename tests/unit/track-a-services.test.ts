/**
 * Track A (Roles E2E) -- service-level invariants of the new role behavior:
 * consent-first parent requests without an existence oracle, consent-based
 * class enrollment, tenant-guarded institution structure, teacher scope
 * rules, class assignments that never bypass per-learner authorization,
 * and the workspace-scoped notification inbox.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const dbQueryMock = vi.fn();
const dbConnectMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => dbQueryMock(...a), connect: () => dbConnectMock() } }));

const notifyUserMock = vi.fn();
vi.mock('@/lib/notifications/role-notifications.service', async (orig) => {
  const actual: any = await orig();
  return { ...actual, notifyUser: (...a: any[]) => notifyUserMock(...a) };
});

vi.mock('@/services/mastery.service', () => ({ getStudentMastery: vi.fn(async () => []) }));
vi.mock('@/services/learning-debt.service', () => ({ getActiveDebts: vi.fn(async () => []) }));
vi.mock('@/services/assessment.service', () => ({ getUpcomingForStudent: vi.fn(async () => []) }));

import { requestChildLink, respondToRequest, getLinkedChildren, MAX_PENDING_PARENT_REQUESTS } from '@/services/parent.service';
import {
  inviteStudentToClass,
  respondToClassInvitation,
  endClassEnrollment,
  createClass,
  createTeacherAssignment,
  requestTeacherMembership,
  revokeMembership,
  InstitutionNotAvailableError,
} from '@/services/institution.service';

type Responder = (sql: string, params: unknown[]) => { rows: any[]; rowCount?: number } | undefined;
function respond(fn: Responder) {
  dbQueryMock.mockImplementation(async (sql: string, params: unknown[]) => fn(sql, params) ?? { rows: [], rowCount: 0 });
}
const sqls = () => dbQueryMock.mock.calls.map((c) => String(c[0]));

beforeEach(() => {
  dbQueryMock.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
  dbConnectMock.mockReset();
  notifyUserMock.mockReset().mockResolvedValue('n1');
});

describe('Parent-initiated request (A2) -- consent first, no account-existence oracle', () => {
  it('an email that matches no Student writes nothing and returns the same outcome as a match', async () => {
    respond((sql) => (sql.includes('COUNT(*)::int AS n') ? { rows: [{ n: 0 }] } : undefined));
    expect(await requestChildLink('parent-1', 'nobody@example.com')).toBe('SUBMITTED');
    expect(sqls().some((s) => s.includes('INSERT INTO parent_student_relationships'))).toBe(false);
    expect(notifyUserMock).not.toHaveBeenCalled();
  });

  it('a match creates a PENDING relationship (never accepted) and notifies the Student in the STUDENT workspace', async () => {
    respond((sql) => {
      if (sql.includes('COUNT(*)::int AS n')) return { rows: [{ n: 0 }] };
      if (sql.includes('FROM students s')) return { rows: [{ student_id: 'stu-1', user_id: 'u-stu' }] };
      if (sql.includes('FROM profiles WHERE id')) return { rows: [{ user_id: 'u-par', full_name: 'Pilar' }] };
      if (sql.includes('INSERT INTO parent_student_relationships')) return { rows: [{ status: 'pending' }], rowCount: 1 };
      return undefined;
    });
    expect(await requestChildLink('parent-1', 'Kid@Example.com ')).toBe('SUBMITTED');
    const insert = sqls().find((s) => s.includes('INSERT INTO parent_student_relationships'))!;
    expect(insert).toMatch(/'pending'/);
    expect(insert).not.toMatch(/'accepted'/);
    expect(insert).toMatch(/WHERE parent_student_relationships\.status IN \('declined', 'revoked'\)/);
    expect(notifyUserMock).toHaveBeenCalledWith(expect.objectContaining({ recipientUserId: 'u-stu', workspace: 'STUDENT', type: 'PARENT_LINK_REQUEST' }));
  });

  it('only an identity with an ACTIVE STUDENT role (and an ACTIVE account) can be matched, by normalized email', async () => {
    respond((sql) => (sql.includes('COUNT(*)::int AS n') ? { rows: [{ n: 0 }] } : undefined));
    await requestChildLink('parent-1', '  Kid@Example.com ');
    const lookup = dbQueryMock.mock.calls.find((c) => String(c[0]).includes('FROM students s'))!;
    expect(String(lookup[0])).toMatch(/r\.role = 'STUDENT' AND r\.status = 'ACTIVE'/);
    expect(String(lookup[0])).toMatch(/u\.status = 'ACTIVE'/);
    expect(lookup[1]).toEqual(['kid@example.com']);
  });

  it('a parent can never be linked to themselves', async () => {
    respond((sql) => {
      if (sql.includes('COUNT(*)::int AS n')) return { rows: [{ n: 0 }] };
      if (sql.includes('FROM students s')) return { rows: [{ student_id: 'stu-1', user_id: 'same-user' }] };
      if (sql.includes('FROM profiles WHERE id')) return { rows: [{ user_id: 'same-user', full_name: 'Me' }] };
      return undefined;
    });
    expect(await requestChildLink('parent-1', 'me@example.com')).toBe('SUBMITTED');
    expect(sqls().some((s) => s.includes('INSERT INTO parent_student_relationships'))).toBe(false);
  });

  it(`at most ${MAX_PENDING_PARENT_REQUESTS} outstanding requests per parent`, async () => {
    respond((sql) => (sql.includes('COUNT(*)::int AS n') ? { rows: [{ n: MAX_PENDING_PARENT_REQUESTS }] } : undefined));
    expect(await requestChildLink('parent-1', 'kid@example.com')).toBe('RATE_LIMITED');
    expect(sqls().some((s) => s.includes('FROM students s'))).toBe(false);
  });

  it('the parent child list exposes ACCEPTED relationships only (pending never reveals the child)', async () => {
    await getLinkedChildren('parent-1');
    expect(sqls()[0]).toMatch(/psr\.status = 'accepted'/);
    expect(sqls()[0]).not.toMatch(/!= 'declined'/);
  });

  it('respond: nothing pending -> false and no notification; a decline notifies the parent without naming the child', async () => {
    respond(() => ({ rows: [], rowCount: 0 }));
    expect(await respondToRequest('stu-1', 'par-1', true)).toBe(false);
    expect(notifyUserMock).not.toHaveBeenCalled();

    respond((sql) => {
      if (sql.includes('UPDATE parent_student_relationships')) return { rows: [{ parent_id: 'par-1' }], rowCount: 1 };
      if (sql.includes('FROM students WHERE id')) return { rows: [{ name: 'Sofía', email: 's@example.com' }] };
      if (sql.includes('FROM profiles WHERE id')) return { rows: [{ user_id: 'u-par' }] };
      return undefined;
    });
    expect(await respondToRequest('stu-1', 'par-1', false)).toBe(true);
    expect(notifyUserMock).toHaveBeenCalledWith(expect.objectContaining({ recipientUserId: 'u-par', workspace: 'PARENT', type: 'PARENT_LINK_DECLINED', payload: {} }));
    const update = sqls().find((s) => s.includes('UPDATE parent_student_relationships'))!;
    expect(update).toMatch(/WHERE student_id = \$2 AND parent_id = \$3 AND status = 'pending'/);
  });
});

describe('Consent-based class enrollment (A4)', () => {
  const classRow = { id: 'class-1', name: 'Mate 10A', grade_id: null, grade_name: null };

  it('refuses a class that is not in the caller\'s institution', async () => {
    respond(() => ({ rows: [] }));
    await expect(inviteStudentToClass('inst-A', 'class-of-B', 's@example.com', 'admin-1')).rejects.toThrow('CLASS_NOT_IN_INSTITUTION');
    expect(String(dbQueryMock.mock.calls[0][0])).toMatch(/c\.institution_id = \$2/);
  });

  it('no Student account -> NO_STUDENT_ACCOUNT and no write', async () => {
    respond((sql) => (sql.includes('FROM classes c LEFT JOIN grades') ? { rows: [classRow] } : undefined));
    expect(await inviteStudentToClass('inst-A', 'class-1', 'x@example.com', 'admin-1')).toEqual({ outcome: 'NO_STUDENT_ACCOUNT' });
    expect(sqls().some((s) => s.includes('INSERT INTO class_enrollments'))).toBe(false);
  });

  it('an invitation is written PENDING (grants nothing until the Student accepts)', async () => {
    respond((sql) => {
      if (sql.includes('FROM classes c LEFT JOIN grades')) return { rows: [classRow] };
      if (sql.includes('FROM students s')) return { rows: [{ student_id: 'stu-1', user_id: 'u-stu' }] };
      if (sql.includes('INSERT INTO class_enrollments')) return { rows: [{ id: 'enr-1' }] };
      return undefined;
    });
    expect(await inviteStudentToClass('inst-A', 'class-1', 's@example.com', 'admin-1')).toEqual({ outcome: 'INVITED', enrollmentId: 'enr-1', studentUserId: 'u-stu' });
    const insert = sqls().find((s) => s.includes('INSERT INTO class_enrollments'))!;
    expect(insert).toMatch(/'PENDING'/);
    expect(insert).toMatch(/WHERE class_enrollments\.status IN \('DECLINED', 'ENDED'\)/);
  });

  it('an ACTIVE enrollment is never re-invited or reset', async () => {
    respond((sql) => {
      if (sql.includes('FROM classes c LEFT JOIN grades')) return { rows: [classRow] };
      if (sql.includes('FROM students s')) return { rows: [{ student_id: 'stu-1', user_id: 'u-stu' }] };
      if (sql.includes('SELECT id, status FROM class_enrollments')) return { rows: [{ id: 'enr-1', status: 'ACTIVE' }] };
      return undefined;
    });
    expect(await inviteStudentToClass('inst-A', 'class-1', 's@example.com', 'admin-1')).toEqual({ outcome: 'ALREADY_ACTIVE' });
    expect(sqls().some((s) => s.includes('INSERT INTO class_enrollments'))).toBe(false);
  });

  it('only the invited Student can respond, and only to a PENDING invitation', async () => {
    await respondToClassInvitation('stu-1', 'enr-1', true);
    const update = sqls()[0];
    expect(update).toMatch(/ce\.student_id = \$2 AND ce\.status = 'PENDING'/);
    expect(dbQueryMock.mock.calls[0][1]).toEqual(['enr-1', 'stu-1', 'ACTIVE']);
    await respondToClassInvitation('stu-1', 'enr-1', false);
    expect(dbQueryMock.mock.calls[1][1]).toEqual(['enr-1', 'stu-1', 'DECLINED']);
  });

  it('removal is soft (ENDED + ended_at) and scoped to the class AND the institution', async () => {
    await endClassEnrollment('inst-A', 'class-1', 'enr-1');
    expect(sqls()[0]).toMatch(/SET status = 'ENDED', ended_at = NOW\(\)/);
    expect(sqls()[0]).toMatch(/c\.institution_id = \$3/);
    expect(sqls()[0]).not.toMatch(/DELETE/);
  });
});

describe('Institution structure and teacher scope are tenant-guarded (A4)', () => {
  it('a class can never be filed under another institution\'s grade', async () => {
    respond(() => ({ rows: [] }));
    await expect(createClass('inst-A', 'grade-of-B', 'X')).rejects.toThrow('SCOPE_OUTSIDE_INSTITUTION');
    expect(sqls()[0]).toMatch(/g\.institution_id = \$1::uuid/);
  });

  it('a teacher scope must name a grade or a class', async () => {
    respond((sql) => (sql.includes("membership_role = 'TEACHER' AND status = 'APPROVED'") ? { rows: [{ '?': 1 }] } : undefined));
    await expect(createTeacherAssignment('m-1', {})).rejects.toThrow('SCOPE_REQUIRED');
    expect(sqls().some((s) => s.includes('INSERT INTO teacher_assignments'))).toBe(false);
  });

  it('a membership request into an unknown or inactive institution is refused (no FK 500)', async () => {
    respond(() => ({ rows: [] }));
    await expect(requestTeacherMembership('inst-x', 'u1')).rejects.toBeInstanceOf(InstitutionNotAvailableError);
    expect(sqls()[0]).toMatch(/FROM institutions i WHERE i\.id = \$1 AND i\.status = 'ACTIVE'/);
  });

  it('a REJECTED/REVOKED teacher may ask again (back to PENDING); APPROVED/PENDING rows are untouched', async () => {
    respond((sql) => (sql.includes('INSERT INTO institution_memberships') ? { rows: [{ id: 'm1', institution_id: 'i', user_id: 'u', membership_role: 'TEACHER', status: 'PENDING' }] } : undefined));
    const m = await requestTeacherMembership('inst-1', 'u1');
    expect(m.newlyPending).toBe(true);
    expect(sqls()[0]).toMatch(/WHERE institution_memberships\.status IN \('REJECTED', 'REVOKED'\)/);
  });

  it('the teacher console can only revoke TEACHER memberships (never an admin\'s)', async () => {
    const client = { query: vi.fn(async (sql: string) => (sql.includes('UPDATE institution_memberships') ? { rows: [], rowCount: 0 } : { rows: [] })), release: vi.fn() };
    dbConnectMock.mockResolvedValue(client);
    expect(await revokeMembership('m-admin', 'actor')).toBe(false);
    const update = client.query.mock.calls.map((c) => String(c[0])).find((s) => s.includes('UPDATE institution_memberships'))!;
    expect(update).toMatch(/membership_role = 'TEACHER'/);
  });
});
