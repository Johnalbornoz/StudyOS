/**
 * L10 SHARED FOUNDATION -- SF-1 (guard hardening), SF-2 (one resolver), SF-3 (teacher guard status),
 * SF-4 (learner-data scope, D-1 ruling), SF-5 (workspace page guard), SF-6 (verified email).
 *
 * The guards are exercised against a mocked database: these tests pin WHAT each guard asks the database
 * (the predicates that make revocation and suspension bite) and the pure decisions around them. The same
 * guards run against a real Postgres in scripts/l10-ephemeral-db-test.sh.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const h = vi.hoisted(() => ({ query: vi.fn(), currentUser: vi.fn(), auth: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => h.query(...a), connect: vi.fn() } }));
vi.mock('@clerk/nextjs/server', () => ({ auth: () => h.auth(), currentUser: () => h.currentUser(), clerkClient: vi.fn() }));

import { verifyStudentAccess, requireStudentId, requireParentProfileId, getOrCreateStudentId, resolveClerkIdentity } from '@/lib/auth';
import { ownStudentId } from '@/lib/exam-core/route-auth';
import { activeRoleSql, STUDENT_OWNER_MATCH_SQL } from '@/lib/identity/access-predicates';
import { isOwner, isActiveParentOf, canTeacherAccessLearner, isCoordinatorOfLearner, canAccessInstitution, canAccessClass, canAccessLearner, resolveLearnerReadScope } from '@/lib/authorization';
import { LEARNER_READ_SCOPE, INSTITUTION_ADMIN_PERMISSIONS, TEACHER_CLASS_PERMISSIONS } from '@/lib/authorization/permissions';
import { decideAccountGate, isAccountGatedApiPath, evaluateAccountGate } from '@/lib/identity/account-status-gate';
import { decideWorkspacePageGuard, workspaceRequiredForPath } from '@/lib/identity/workspace-page-guard';
import { resolveVerifiedPrimaryEmail } from '@/lib/identity/verified-email';
import { resolveVerifiedPrimaryEmail as adminResolver } from '@/lib/admin/admin-identity';
import { isTeacherOfClass } from '@/lib/teacher/class-assignment.service';
import { verifyParentAccess } from '@/services/parent.service';

const sqls = () => h.query.mock.calls.map((c) => String(c[0]).replace(/\s+/g, ' '));
const ROLE = (role: string) => new RegExp(`au\\.status = 'ACTIVE' AND NOT au\\.is_system AND ar\\.role = '${role}' AND ar\\.status = 'ACTIVE'`);

beforeEach(() => {
  h.query.mockReset().mockResolvedValue({ rows: [{ ok: 1 }], rowCount: 1 });
  h.currentUser.mockReset();
  h.auth.mockReset();
});

describe('SF-1: every guard requires an ACTIVE account and the ACTIVE role of its surface', () => {
  const cases: Array<[string, () => Promise<unknown>, string]> = [
    ['verifyStudentAccess', () => verifyStudentAccess('clerk_1', 'stu-1'), 'STUDENT'],
    ['isOwner', () => isOwner('user-1', 'stu-1'), 'STUDENT'],
    ['ownStudentId', () => ownStudentId('user-1'), 'STUDENT'],
    ['isActiveParentOf', () => isActiveParentOf('user-1', 'stu-1'), 'PARENT'],
    ['verifyParentAccess', () => verifyParentAccess('parent-1', 'stu-1'), 'PARENT'],
    ['canTeacherAccessLearner', () => canTeacherAccessLearner('user-1', 'stu-1'), 'TEACHER'],
    ['isTeacherOfClass', () => isTeacherOfClass('user-1', 'class-1'), 'TEACHER'],
    ['canAccessInstitution', () => canAccessInstitution('user-1', 'inst-1', 'INSTITUTION_MEMBER_APPROVE'), 'INSTITUTION_ADMIN'],
    ['isCoordinatorOfLearner', () => isCoordinatorOfLearner('user-1', 'stu-1'), 'INSTITUTION_ADMIN'],
  ];
  for (const [name, call, role] of cases) {
    it(`${name} joins users.status and an ACTIVE ${role} role in its own query`, async () => {
      await call();
      expect(sqls().some((s) => ROLE(role).test(s))).toBe(true);
    });
  }

  it('the role predicate is emitted from a fixed literal table, never from input', () => {
    expect(activeRoleSql('$1', 'PARENT').replace(/\s+/g, ' ')).toMatch(ROLE('PARENT'));
    expect(activeRoleSql('$1', 'NOT_A_ROLE' as any)).toContain('ar.role = undefined'); // an unknown role can never match a row
  });

  it('a guard denies when the database returns no row (revoked role / suspended account / no relationship)', async () => {
    h.query.mockResolvedValue({ rows: [], rowCount: 0 });
    expect(await verifyStudentAccess('clerk_1', 'stu-1')).toBe(false);
    expect(await isOwner('user-1', 'stu-1')).toBe(false);
    expect(await isActiveParentOf('user-1', 'stu-1')).toBe(false);
    expect(await canTeacherAccessLearner('user-1', 'stu-1')).toBe(false);
    expect(await canAccessInstitution('user-1', 'inst-1', 'INSTITUTION_MEMBER_APPROVE')).toBe(false);
    expect(await ownStudentId('user-1')).toBeNull();
  });

  it('every guard fails closed when the database throws', async () => {
    h.query.mockRejectedValue(new Error('db down'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await verifyStudentAccess('clerk_1', 'stu-1')).toBe(false);
    expect(await isOwner('user-1', 'stu-1')).toBe(false);
    expect(await isActiveParentOf('user-1', 'stu-1')).toBe(false);
    expect(await canTeacherAccessLearner('user-1', 'stu-1')).toBe(false);
    expect(await canAccessInstitution('user-1', 'inst-1', 'TEACHER_ASSIGNMENT_MANAGE')).toBe(false);
    expect(await canAccessClass('user-1', 'class-1', 'TEACHER_ASSIGNMENT_MANAGE')).toBe(false);
    err.mockRestore();
  });

  it('requireStudentId / requireParentProfileId return null for a non-ACTIVE account before any role lookup', async () => {
    h.query.mockResolvedValue({ rows: [{ id: 'user-1', clerk_id: 'clerk_1', email: null, status: 'SUSPENDED', active_workspace: null }] });
    expect(await requireStudentId('clerk_1')).toBeNull();
    expect(await requireParentProfileId('clerk_1')).toBeNull();
    expect(sqls().some((s) => /FROM user_roles/.test(s))).toBe(false);
  });

  it('getOrCreateStudentId refuses an existing learner whose access is not active, and provisions nothing', async () => {
    h.query.mockResolvedValueOnce({ rows: [{ student_id: 'stu-1', user_id: 'user-1', access_active: false }] });
    await expect(getOrCreateStudentId('clerk_1')).rejects.toThrow('STUDENT_ROLE_REQUIRED');
    expect(h.query).toHaveBeenCalledTimes(1);
  });
});

describe('SF-1: account status gate (proxy)', () => {
  it('only an ACTIVE account, or an identity with no account row yet, is allowed', () => {
    expect(decideAccountGate('ACTIVE')).toEqual({ allow: true });
    expect(decideAccountGate(null)).toEqual({ allow: true });
    for (const s of ['SUSPENDED', 'ARCHIVED', 'anything-else']) expect(decideAccountGate(s)).toEqual({ allow: false, status: 403, error: 'ACCOUNT_NOT_ACTIVE' });
  });

  it('fails CLOSED (503) when the status cannot be read', async () => {
    h.query.mockRejectedValue(new Error('db down'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await evaluateAccountGate('clerk_1')).toEqual({ allow: false, status: 503, error: 'ACCOUNT_STATUS_UNAVAILABLE' });
    err.mockRestore();
  });

  it('gates every API path except webhooks, internal, health and version', () => {
    for (const p of ['/api/student/context', '/api/parent/learners/x/overview', '/api/admin/users', '/api/teacher/classes', '/api/exams/instances']) expect(isAccountGatedApiPath(p)).toBe(true);
    for (const p of ['/api/webhooks/clerk', '/api/webhooks/mercadopago', '/api/internal/generation-worker', '/api/health', '/api/version', '/dashboard/today', '/apix']) expect(isAccountGatedApiPath(p)).toBe(false);
  });

  it('the proxy applies the gate to API requests and the workspace guard to dashboard pages', () => {
    const src = readFileSync(join(process.cwd(), 'src/proxy.ts'), 'utf8');
    expect(src).toMatch(/isAccountGatedApiPath\(pathname\)/);
    expect(src).toMatch(/evaluateAccountGate\(session\.userId\)/);
    expect(src).toMatch(/decideWorkspacePageGuard\(pathname, state\)/);
  });
});

describe('SF-2: one definition of "this account owns this learner"', () => {
  it('the learning family and the exam family issue the same ownership join', async () => {
    await verifyStudentAccess('clerk_1', 'stu-1');
    await isOwner('user-1', 'stu-1');
    await ownStudentId('user-1');
    const match = STUDENT_OWNER_MATCH_SQL.replace(/\s+/g, ' ');
    expect(sqls().filter((s) => s.includes(match))).toHaveLength(3);
    expect(match).toBe('(s.user_id = u.id OR (s.user_id IS NULL AND s.clerk_id = u.clerk_id))');
  });

  it('no guard resolves a learner by students.clerk_id or students.user_id on its own any more', () => {
    const auth = readFileSync(join(process.cwd(), 'src/lib/auth.ts'), 'utf8');
    const routeAuth = readFileSync(join(process.cwd(), 'src/lib/exam-core/route-auth.ts'), 'utf8');
    const authorization = readFileSync(join(process.cwd(), 'src/lib/authorization/index.ts'), 'utf8');
    expect(auth).not.toMatch(/FROM students WHERE clerk_id = \$1/);
    expect(routeAuth).not.toMatch(/FROM students WHERE user_id/);
    expect(authorization).not.toMatch(/FROM students WHERE id = \$1 AND user_id = \$2/);
  });
});

describe('SF-3: teacher access requires an ACTIVE institution and a class that is not archived', () => {
  it('canTeacherAccessLearner', async () => {
    await canTeacherAccessLearner('user-1', 'stu-1');
    expect(sqls()[0]).toMatch(/JOIN institutions i ON i\.id = im\.institution_id AND i\.status = 'ACTIVE'/);
    expect(sqls()[0]).toMatch(/JOIN classes c ON c\.id = ce\.class_id AND c\.status = 'ACTIVE'/);
  });

  it('isTeacherOfClass (TEACHER_CLASS_SQL)', async () => {
    await isTeacherOfClass('user-1', 'class-1');
    expect(sqls()[0]).toMatch(/JOIN institutions ti ON ti\.id = im\.institution_id AND ti\.status = 'ACTIVE'/);
    expect(sqls()[0]).toMatch(/c\.status = 'ACTIVE'/);
  });

  it('canAccessClass: the teacher branch is refused for an archived class without asking further; the coordinator branch is not', async () => {
    h.query.mockImplementation(async (sql: string) => {
      if (/FROM classes WHERE id = \$1/.test(sql)) return { rows: [{ institution_id: 'inst-1', grade_id: null, status: 'ARCHIVED' }] };
      return { rows: [] }; // not a coordinator
    });
    expect(await canAccessClass('teacher-1', 'class-1', 'TEACHER_ASSIGNMENT_MANAGE')).toBe(false);
    expect(sqls().some((s) => /FROM teacher_assignments/.test(s))).toBe(false);

    h.query.mockImplementation(async (sql: string) => {
      if (/FROM classes WHERE id = \$1/.test(sql)) return { rows: [{ institution_id: 'inst-1', grade_id: null, status: 'ARCHIVED' }] };
      return { rows: [{ ok: 1 }] }; // an approved coordinator
    });
    expect(await canAccessClass('coord-1', 'class-1', 'TEACHER_ASSIGNMENT_MANAGE')).toBe(true);
  });

  it('canAccessClass teacher branch joins the institution status', async () => {
    h.query.mockImplementation(async (sql: string) => {
      if (/FROM classes WHERE id = \$1/.test(sql)) return { rows: [{ institution_id: 'inst-1', grade_id: null, status: 'ACTIVE' }] };
      if (/FROM teacher_assignments/.test(sql)) return { rows: [{ ok: 1 }] };
      return { rows: [] };
    });
    expect(await canAccessClass('teacher-1', 'class-1', 'TEACHER_ASSIGNMENT_MANAGE')).toBe(true);
    expect(sqls().find((s) => /FROM teacher_assignments/.test(s))).toMatch(/JOIN institutions i ON i\.id = im\.institution_id AND i\.status = 'ACTIVE'/);
  });
});

describe('SF-4: D-1 visibility ruling', () => {
  it('the scope table is exactly the ruling', () => {
    expect(LEARNER_READ_SCOPE.OWNER).toEqual(expect.arrayContaining(['LEARNER_ASSESSMENT_DETAIL_VIEW', 'LEARNER_INTERVENTION_CREATE']));
    // PARENT: progress / gaps / released summaries; no raw item-level answers
    expect([...LEARNER_READ_SCOPE.PARENT].sort()).toEqual(['LEARNER_ASSESSMENT_SUMMARY_VIEW', 'LEARNER_GAPS_VIEW', 'LEARNER_PROFILE_VIEW', 'LEARNER_PROGRESS_VIEW']);
    // TEACHER: per-student gaps and assessment detail
    expect(LEARNER_READ_SCOPE.TEACHER).toEqual(expect.arrayContaining(['LEARNER_GAPS_VIEW', 'LEARNER_ASSESSMENT_DETAIL_VIEW']));
    // COORDINATOR: summary/gaps + released results; no raw item-level detail; the whole-learner routes stay closed
    expect([...LEARNER_READ_SCOPE.COORDINATOR].sort()).toEqual(['LEARNER_ASSESSMENT_SUMMARY_VIEW', 'LEARNER_GAPS_VIEW']);
    for (const r of ['PARENT', 'TEACHER', 'COORDINATOR'] as const) expect(LEARNER_READ_SCOPE[r]).not.toContain('LEARNER_INTERVENTION_CREATE');
  });

  const only = (relationship: 'owner' | 'parent' | 'teacher' | 'coordinator' | 'none') => {
    h.query.mockImplementation(async (sql: string) => {
      const s = sql.replace(/\s+/g, ' ');
      const is =
        /FROM parent_student_relationships/.test(s) ? 'parent'
        : /FROM teacher_assignments/.test(s) ? 'teacher'
        : /membership_role = 'INSTITUTION_ADMIN'/.test(s) ? 'coordinator'
        : /FROM students s JOIN users u/.test(s) ? 'owner'
        : 'other';
      return { rows: is === relationship ? [{ ok: 1 }] : [] };
    });
  };

  it('a parent reads summaries and gaps, never item-level detail', async () => {
    only('parent');
    expect(await canAccessLearner('u', 's', 'LEARNER_ASSESSMENT_SUMMARY_VIEW')).toBe(true);
    expect(await canAccessLearner('u', 's', 'LEARNER_GAPS_VIEW')).toBe(true);
    expect(await canAccessLearner('u', 's', 'LEARNER_ASSESSMENT_DETAIL_VIEW')).toBe(false);
    expect(await canAccessLearner('u', 's', 'LEARNER_INTERVENTION_CREATE')).toBe(false);
  });

  it('a teacher reads assessment detail', async () => {
    only('teacher');
    expect(await canAccessLearner('u', 's', 'LEARNER_ASSESSMENT_DETAIL_VIEW')).toBe(true);
  });

  it('a coordinator reads summaries and gaps only -- no detail, and not the older whole-learner routes', async () => {
    only('coordinator');
    expect(await canAccessLearner('u', 's', 'LEARNER_GAPS_VIEW')).toBe(true);
    expect(await canAccessLearner('u', 's', 'LEARNER_ASSESSMENT_SUMMARY_VIEW')).toBe(true);
    expect(await canAccessLearner('u', 's', 'LEARNER_ASSESSMENT_DETAIL_VIEW')).toBe(false);
    expect(await canAccessLearner('u', 's', 'LEARNER_PROGRESS_VIEW')).toBe(false);
    expect(await canAccessLearner('u', 's', 'LEARNER_PROFILE_VIEW')).toBe(false);
    expect((await resolveLearnerReadScope('u', 's')).relationships).toEqual(['COORDINATOR']);
  });

  it('no relationship => empty scope', async () => {
    only('none');
    expect(await resolveLearnerReadScope('u', 's')).toEqual({ relationships: [], permissions: [] });
  });

  it('the institution permission argument is honoured', async () => {
    expect(await canAccessInstitution('u', 'i', 'NOT_A_PERMISSION' as any)).toBe(false);
    expect(h.query).not.toHaveBeenCalled(); // refused before any lookup
    expect(TEACHER_CLASS_PERMISSIONS).not.toContain('INSTITUTION_MEMBER_APPROVE');
    expect(TEACHER_CLASS_PERMISSIONS).not.toContain('INSTITUTION_INTELLIGENCE_VIEW');
    expect(TEACHER_CLASS_PERMISSIONS).toEqual(['TEACHER_ASSIGNMENT_MANAGE']);
    expect(INSTITUTION_ADMIN_PERMISSIONS).toContain('INSTITUTION_INTELLIGENCE_VIEW');
  });

  it('a class teacher cannot pass canAccessClass with a permission teachers do not hold', async () => {
    h.query.mockImplementation(async (sql: string) => {
      if (/FROM classes WHERE id = \$1/.test(sql)) return { rows: [{ institution_id: 'inst-1', grade_id: null, status: 'ACTIVE' }] };
      if (/FROM teacher_assignments/.test(sql)) return { rows: [{ ok: 1 }] };
      return { rows: [] };
    });
    expect(await canAccessClass('teacher-1', 'class-1', 'INSTITUTION_MEMBER_APPROVE')).toBe(false);
    expect(await canAccessClass('teacher-1', 'class-1', 'INSTITUTION_INTELLIGENCE_VIEW')).toBe(false);
    expect(await canAccessClass('teacher-1', 'class-1', 'TEACHER_ASSIGNMENT_MANAGE')).toBe(true);
  });

  // Result shaping under the D-1 final rulings is covered in l10-r1-rulings.test.ts.

  it('the three shaped routes resolve the scope instead of the old whole-learner check', () => {
    for (const r of ['simulation/attempts/[id]/route.ts', 'simulation/attempts/[id]/result/route.ts', 'teaching/interventions/[id]/route.ts']) {
      const src = readFileSync(join(process.cwd(), 'src/app/api', r), 'utf8');
      expect(src).toMatch(/resolveLearnerReadScope\(/);
      expect(src).not.toMatch(/canAccessLearner\(/);
    }
  });
});

describe('SF-5: workspace page guard', () => {
  const state = (roles: any[], stored: any = null, accountStatus = 'ACTIVE') => ({ roles, storedWorkspace: stored, accountStatus });

  it('maps a dashboard page to its workspace', () => {
    expect(workspaceRequiredForPath('/dashboard/teacher/classes/1')).toBe('TEACHER');
    expect(workspaceRequiredForPath('/dashboard/parent')).toBe('PARENT');
    expect(workspaceRequiredForPath('/dashboard/institution/abc/students')).toBe('INSTITUTION');
    expect(workspaceRequiredForPath('/dashboard/today')).toBe('STUDENT');
    expect(workspaceRequiredForPath('/dashboard/teachers-lounge')).toBe('STUDENT'); // prefix match is by segment
    for (const p of ['/dashboard', '/dashboard/notifications', '/dashboard/admin/users', '/role-select', '/account/change-password']) expect(workspaceRequiredForPath(p)).toBeNull();
  });

  it('a Student is redirected from every other workspace to the Student home', () => {
    for (const p of ['/dashboard/teacher', '/dashboard/parent', '/dashboard/institution', '/dashboard/teacher/classes/1/roster']) {
      expect(decideWorkspacePageGuard(p, state(['STUDENT']))).toBe('/dashboard/today');
    }
    expect(decideWorkspacePageGuard('/dashboard/today', state(['STUDENT']))).toBeNull();
  });

  it('a Parent on a Student page is redirected to the Parent home (no error boundary)', () => {
    expect(decideWorkspacePageGuard('/dashboard/today', state(['PARENT']))).toBe('/dashboard/parent');
    expect(decideWorkspacePageGuard('/dashboard/profile', state(['PARENT']))).toBe('/dashboard/parent');
    expect(decideWorkspacePageGuard('/dashboard/parent', state(['PARENT']))).toBeNull();
  });

  it('a Teacher who also coordinates may enter institution pages; one who does not is sent home', () => {
    expect(decideWorkspacePageGuard('/dashboard/institution/x', state(['TEACHER', 'INSTITUTION_ADMIN']))).toBeNull();
    expect(decideWorkspacePageGuard('/dashboard/institution/x', state(['TEACHER']))).toBe('/dashboard/teacher');
  });

  it('a capability-only account lands on its capability home', () => {
    expect(decideWorkspacePageGuard('/dashboard/today', state(['INSTITUTION_ADMIN']))).toBe('/dashboard/institution');
  });

  it('a non-ACTIVE account is sent to the suspended page from every dashboard page', () => {
    for (const p of ['/dashboard', '/dashboard/today', '/dashboard/admin/users', '/dashboard/notifications']) {
      expect(decideWorkspacePageGuard(p, state(['STUDENT'], null, 'SUSPENDED'))).toBe('/account-suspended');
    }
  });

  it('never decides for an account with no row; an account with no ACTIVE role is sent to role selection before a workspace page renders (L10-R1)', () => {
    expect(decideWorkspacePageGuard('/dashboard/teacher', null)).toBeNull();
    for (const p of ['/dashboard/teacher', '/dashboard/today', '/dashboard/profile', '/dashboard/parent']) expect(decideWorkspacePageGuard(p, state([]))).toBe('/role-select');
    expect(decideWorkspacePageGuard('/dashboard', state([]))).toBeNull(); // the entry page resolves it itself
    expect(decideWorkspacePageGuard('/dashboard/notifications', state([]))).toBeNull();
  });

  it('shared and admin pages are never redirected by workspace', () => {
    expect(decideWorkspacePageGuard('/dashboard/notifications', state(['PARENT']))).toBeNull();
    expect(decideWorkspacePageGuard('/dashboard/admin/users', state(['STUDENT']))).toBeNull(); // each admin page keeps requireStudyUSAdmin
    expect(decideWorkspacePageGuard('/dashboard', state(['PARENT']))).toBeNull();
  });
});

describe('SF-6: invitations are matched on the verified primary email only', () => {
  const verified = { primaryEmailAddressId: 'p', emailAddresses: [{ id: 'x', emailAddress: 'added@evil.test', verification: { status: 'verified' } }, { id: 'p', emailAddress: ' Me@Home.test ', verification: { status: 'verified' } }] };
  const unverified = { primaryEmailAddressId: 'p', emailAddresses: [{ id: 'p', emailAddress: 'me@home.test', verification: { status: 'unverified' } }] };

  it('one resolver, shared by the admin module', () => {
    expect(adminResolver).toBe(resolveVerifiedPrimaryEmail);
    expect(resolveVerifiedPrimaryEmail(verified)).toBe('me@home.test');
    expect(resolveVerifiedPrimaryEmail(unverified)).toBeNull();
    expect(resolveVerifiedPrimaryEmail({ emailAddresses: [{ id: 'a', emailAddress: 'first@index.test', verification: { status: 'verified' } }] })).toBeNull(); // never index 0
  });

  it('resolveClerkIdentity no longer falls back to emailAddresses[0], and reports the verified email separately', async () => {
    h.currentUser.mockResolvedValue({ id: 'clerk_1', firstName: 'A', lastName: 'B', primaryEmailAddress: null, ...unverified });
    expect(await resolveClerkIdentity('clerk_1')).toEqual({ email: null, name: 'A B', verifiedEmail: null });
    h.currentUser.mockResolvedValue({ id: 'clerk_1', firstName: 'A', lastName: 'B', primaryEmailAddress: { emailAddress: 'me@home.test' }, ...verified });
    expect((await resolveClerkIdentity('clerk_1')).verifiedEmail).toBe('me@home.test');
  });

  it('POST /api/parent/invitations/[id]/respond: an unverified primary email is 403 and writes nothing', async () => {
    h.auth.mockResolvedValue({ userId: 'clerk_1' });
    h.currentUser.mockResolvedValue({ id: 'clerk_1', primaryEmailAddress: { emailAddress: 'me@home.test' }, ...unverified });
    const { POST } = await import('@/app/api/parent/invitations/[id]/respond/route');
    const res: any = await (POST as any)(new Request('https://t.test/x', { method: 'POST', body: JSON.stringify({ decision: 'accept' }) }), { params: Promise.resolve({ id: 'inv-1' }) });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('EMAIL_NOT_VERIFIED');
    expect(h.query).not.toHaveBeenCalled(); // no role, no profile, no relationship row
  });

  it('GET /api/parent/invitations: an unverified primary email lists nothing and queries nothing', async () => {
    h.auth.mockResolvedValue({ userId: 'clerk_1' });
    h.currentUser.mockResolvedValue({ id: 'clerk_1', primaryEmailAddress: { emailAddress: 'me@home.test' }, ...unverified });
    const { GET } = await import('@/app/api/parent/invitations/route');
    const res: any = await (GET as any)();
    expect((await res.json()).data.invitations).toEqual([]);
    expect(h.query).not.toHaveBeenCalled();
  });

  it('POST /api/coordinator-invitations/accept: an unverified primary email is 403 before the token is even looked up', async () => {
    h.auth.mockResolvedValue({ userId: 'clerk_1', sessionClaims: {} });
    h.currentUser.mockResolvedValue({ id: 'clerk_1', primaryEmailAddress: { emailAddress: 'me@home.test' }, ...unverified });
    const { POST } = await import('@/app/api/coordinator-invitations/accept/route');
    const res: any = await (POST as any)(new Request('https://t.test/x', { method: 'POST', body: JSON.stringify({ token: 'x'.repeat(43) }) }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('EMAIL_NOT_VERIFIED');
    expect(sqls().some((s) => /institution_admin_invitations|institution_memberships/.test(s))).toBe(false);
  });

  it('the three invitation routes contain no emailAddresses[0] read', () => {
    for (const r of ['parent/invitations/route.ts', 'parent/invitations/[id]/respond/route.ts', 'coordinator-invitations/accept/route.ts']) {
      const code = readFileSync(join(process.cwd(), 'src/app/api', r), 'utf8').replace(/^\s*\/\/.*$/gm, '');
      expect(code).not.toMatch(/emailAddresses\s*(\?\.)?\s*\[\s*0\s*\]/);
    }
  });
});
