/**
 * L10-R1 -- REVOKED / INACTIVE STUDENT => 403, NEVER 500 (release blocker).
 *
 * Canonical HTTP behaviour: authenticated user + inactive or revoked Student role => 403.
 *
 * How it is guaranteed, centrally (no Student call site was edited):
 *   API    Every Student API route reaches the learner through `requireStudentId` (null => 403) or
 *          `verifyStudentAccess` (false => 403). NO API route calls `getOrCreateStudentId`, the one
 *          function that THROWS for such an account. Asserted over the whole `src/app/api` tree.
 *          A non-ACTIVE account is refused earlier still, by the proxy's account gate (403).
 *   Pages  The 32 callers of `getOrCreateStudentId` are Server Component pages (and the dashboard
 *          layout). The proxy's workspace guard decides BEFORE any of them renders: an account without
 *          an ACTIVE Student role never reaches a Student page (it is redirected to its own workspace,
 *          or to role selection, which explains a revoked role); a non-ACTIVE account goes to the
 *          suspended page. So the throw is never reached by a request.
 *   Contract `StudentRoleRequiredError` carries status 403 and `authFailureOf` maps it, for any future
 *          caller that must turn it into a response.
 *
 * The world below is one account whose Student role and account status the tests flip, behind the REAL
 * guards (src/lib/auth.ts), two REAL Student routes and the REAL proxy.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const { w, h } = vi.hoisted(() => ({
  w: { account: 'ACTIVE', studentRole: 'ACTIVE' as 'ACTIVE' | 'REVOKED' | 'NONE', otherRoles: [] as string[] },
  h: { signedIn: true, services: { getActiveDebts: null as any, listInvitations: null as any } },
}));
const CLERK = 'clerk_kid';
const USER = 'user-kid';
const STUDENT = '11111111-1111-4111-8111-111111111111';

vi.mock('@clerk/nextjs/server', () => ({
  auth: async () => ({ userId: h.signedIn ? 'clerk_kid' : null, sessionClaims: {} }),
  currentUser: async () => null,
  clerkClient: vi.fn(),
  clerkMiddleware: (handler: any) => (request: any) => handler(async () => ({ userId: h.signedIn ? 'clerk_kid' : null }), request),
}));
vi.mock('@/lib/ai/request-metrics', () => ({ withAiRequestMetrics: (_: string, fn: any) => fn }));
vi.mock('@/services/learning-debt.service', () => ({ getActiveDebts: (...a: any[]) => h.services.getActiveDebts(...a) }));
vi.mock('@/services/parent.service', () => ({
  listInvitationsSentByStudent: (...a: any[]) => h.services.listInvitations(...a),
  inviteParentByEmail: vi.fn(),
  revokeInvitationByStudent: vi.fn(),
  ParentInvitationRefusedError: class extends Error {},
}));
vi.mock('@/lib/exam-journey/feature-flag', () => ({ isStudentJourneyUxEnabled: () => false }));
vi.mock('@/lib/db', () => {
  const activeRoles = () => [...(w.studentRole === 'ACTIVE' ? ['STUDENT'] : []), ...w.otherRoles];
  const query = async (sql: string, p: any[] = []) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    // proxy: account gate
    if (/^SELECT status FROM users WHERE clerk_id = \$1 AND NOT is_system/.test(s)) return { rows: [{ status: w.account }] };
    // proxy: dashboard gate state (one query for every dashboard page)
    if (/^SELECT u\.status, u\.active_workspace, s\.student_context_type,/.test(s)) {
      return { rows: [{ status: w.account, active_workspace: null, student_context_type: 'ACADEMIC', roles: activeRoles(), profile_completed: true, country_of_study: 'CO', school_year: '10', curriculum_type: 'national', academic_year: '2026', subject_count: 1, exam_target_count: 0, institutional_path_count: 0 }] };
    }
    // getOrCreateCanonicalUser
    if (/^SELECT id, clerk_id, email, status, active_workspace, password_change_required FROM users WHERE clerk_id = \$1/.test(s)) {
      return { rows: [{ id: 'user-kid', clerk_id: 'clerk_kid', email: 'kid@school.test', status: w.account, active_workspace: null, password_change_required: false }] };
    }
    // hasRole
    if (/^SELECT 1 FROM user_roles WHERE user_id = \$1 AND role = \$2 AND status = 'ACTIVE'/.test(s)) return { rows: activeRoles().includes(p[1]) ? [{ ok: 1 }] : [] };
    // the one student resolver (getOrCreateStudentId) and the ownership guard (verifyStudentAccess)
    const accessActive = w.account === 'ACTIVE' && w.studentRole === 'ACTIVE';
    if (/^SELECT s\.id AS student_id, u\.id AS user_id, EXISTS/.test(s)) return { rows: [{ student_id: '11111111-1111-4111-8111-111111111111', user_id: 'user-kid', access_active: accessActive }] };
    if (/^SELECT 1 FROM students s JOIN users u ON .* WHERE u\.clerk_id = \$1 AND s\.id = \$2 AND EXISTS/.test(s)) {
      const ok = accessActive && p[1] === '11111111-1111-4111-8111-111111111111';
      return { rows: ok ? [{ ok: 1 }] : [], rowCount: ok ? 1 : 0 };
    }
    if (/^INSERT INTO (profiles|student_profiles)|^UPDATE (students|profiles)/.test(s)) return { rows: [] };
    throw new Error(`unexpected SQL in fixture: ${s.slice(0, 120)}`);
  };
  return { db: { query, connect: vi.fn() }, query };
});

import { NextRequest } from 'next/server';
import proxy from '@/proxy';
import { getOrCreateStudentId, requireStudentId, verifyStudentAccess, StudentRoleRequiredError, authFailureOf } from '@/lib/auth';
import { GET as debtsGET } from '@/app/api/learning-debt/get-active/route';
import { GET as invitationsGET } from '@/app/api/student/parent-invitations/route';

const page = (path: string) => (proxy as any)(new NextRequest(new URL(path, 'https://app.test')));
const location = (res: any) => res.headers.get('location');
const STUDENT_PAGES = ['/dashboard/today', '/dashboard/profile', '/dashboard/plan', '/dashboard/subjects', '/dashboard/exam-prep', '/dashboard/billing', '/dashboard/learning-debt', '/dashboard/tutor'];

beforeEach(() => {
  w.account = 'ACTIVE';
  w.studentRole = 'ACTIVE';
  w.otherRoles = [];
  h.signedIn = true;
  h.services.getActiveDebts = vi.fn(async () => []);
  h.services.listInvitations = vi.fn(async () => []);
});

describe('baseline: an ACTIVE Student is served', () => {
  it('both kinds of Student API route answer 200, and Student pages are not redirected', async () => {
    expect(((await debtsGET(new NextRequest(`https://app.test/x?studentId=${STUDENT}`))) as any).status).toBe(200);
    expect(((await invitationsGET()) as any).status).toBe(200);
    for (const p of STUDENT_PAGES) expect(location(await page(p))).toBeNull();
    expect(await getOrCreateStudentId(CLERK)).toBe(STUDENT);
  });
});

describe('REVOKED Student role => 403 on the API, never 500', () => {
  beforeEach(() => {
    w.studentRole = 'REVOKED';
  });

  it('a verifyStudentAccess route: 403, and the service behind it is never called', async () => {
    const res: any = await debtsGET(new NextRequest(`https://app.test/x?studentId=${STUDENT}`));
    expect(res.status).toBe(403);
    expect(h.services.getActiveDebts).not.toHaveBeenCalled();
  });

  it('a requireStudentId route: 403, and the service behind it is never called', async () => {
    const res: any = await invitationsGET();
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('FORBIDDEN');
    expect(h.services.listInvitations).not.toHaveBeenCalled();
  });

  it('the two gates themselves deny without throwing', async () => {
    expect(await verifyStudentAccess(CLERK, STUDENT)).toBe(false);
    expect(await requireStudentId(CLERK)).toBeNull();
  });

  it('a role that was never granted behaves the same', async () => {
    w.studentRole = 'NONE';
    expect(((await debtsGET(new NextRequest(`https://app.test/x?studentId=${STUDENT}`))) as any).status).toBe(403);
    expect(((await invitationsGET()) as any).status).toBe(403);
  });
});

describe('INACTIVE account (suspended / archived) => 403 on the API, never 500', () => {
  for (const status of ['SUSPENDED', 'ARCHIVED']) {
    it(`${status}: the proxy refuses every API request with 403 before a route runs`, async () => {
      w.account = status;
      for (const path of ['/api/learning-debt/get-active', '/api/student/parent-invitations', '/api/student/context', '/api/exams/instances', '/api/quizzes/generate-and-take']) {
        const res: any = await page(path);
        expect(res.status).toBe(403);
        expect((await res.json()).error).toBe('ACCOUNT_NOT_ACTIVE');
      }
    });
    it(`${status}: and the routes' own gates answer 403 even without the proxy`, async () => {
      w.account = status;
      expect(((await debtsGET(new NextRequest(`https://app.test/x?studentId=${STUDENT}`))) as any).status).toBe(403);
      expect(((await invitationsGET()) as any).status).toBe(403);
    });
  }
});

describe('no API route can reach the throwing path', () => {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(n) ? [p] : []; });
  const root = process.cwd();
  const strip = (f: string) => readFileSync(f, 'utf8').replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');

  it('nothing under src/app/api calls getOrCreateStudentId', () => {
    const offenders = walk(join(root, 'src/app/api')).filter((f) => /\bgetOrCreateStudentId\b/.test(strip(f))).map((f) => f.slice(root.length + 1));
    expect(offenders).toEqual([]);
  });

  it('every other caller is a Server Component page or the dashboard layout, under the proxy guard -- or a role grant that has just made the role ACTIVE', () => {
    const callers = walk(join(root, 'src')).filter((f) => /\bgetOrCreateStudentId\s*\(/.test(strip(f))).map((f) => f.slice(root.length + 1)).sort();
    const pages = callers.filter((f) => f.startsWith('src/app/'));
    const other = callers.filter((f) => !f.startsWith('src/app/'));
    expect(other).toEqual(['src/lib/auth.ts', 'src/lib/identity/role-assignment.service.ts', 'src/services/user-admin.service.ts']);
    for (const f of pages) expect(f, f).toMatch(/\/(page|layout)\.tsx$/);
    // Every page caller is a dashboard page (guarded by the proxy) or the landing page, which catches the error.
    const outsideDashboard = pages.filter((f) => !f.startsWith('src/app/dashboard/'));
    expect(outsideDashboard).toEqual(['src/app/page.tsx']);
    // The one dashboard page OUTSIDE the workspace guard (admin pages keep their own guard) tolerates an admin who is not a Student.
    expect(strip(join(root, 'src/app/dashboard/admin/[studentId]/page.tsx'))).toMatch(/await getOrCreateStudentId\(user!\.id\)\.catch\(\(\) => null\)/);
    expect(pages.filter((f) => f.startsWith('src/app/dashboard/admin/'))).toEqual(['src/app/dashboard/admin/[studentId]/page.tsx']);
    expect(strip(join(root, 'src/app/page.tsx'))).toMatch(/try \{\s*const studentId = await getOrCreateStudentId\(userId\);[\s\S]*?\} catch \{/);
  });

  it('the error contract: StudentRoleRequiredError means 403', async () => {
    w.studentRole = 'REVOKED';
    const error = await getOrCreateStudentId(CLERK).then(() => null, (e) => e);
    expect(error).toBeInstanceOf(StudentRoleRequiredError);
    expect(authFailureOf(error)).toEqual({ status: 403, error: 'STUDENT_ROLE_REQUIRED' });
    expect(authFailureOf(new Error('db down'))).toBeNull(); // a real failure stays a failure
  });
});

describe('Student pages: an account without an ACTIVE Student role never reaches one (so none can fail with 500)', () => {
  it('revoked, no other role: every Student page redirects to role selection before rendering', async () => {
    w.studentRole = 'REVOKED';
    for (const p of STUDENT_PAGES) {
      const res: any = await page(p);
      expect(res.status).toBe(307);
      expect(location(res)).toBe('https://app.test/role-select');
    }
  });

  it('revoked, with another persona since (admin changed it): redirected to that workspace', async () => {
    w.studentRole = 'REVOKED';
    w.otherRoles = ['PARENT'];
    for (const p of STUDENT_PAGES) expect(location(await page(p))).toBe('https://app.test/dashboard/parent');
    expect(location(await page('/dashboard/parent'))).toBeNull();
  });

  it('suspended or archived: every dashboard page redirects to the suspended page', async () => {
    for (const status of ['SUSPENDED', 'ARCHIVED']) {
      w.account = status;
      for (const p of [...STUDENT_PAGES, '/dashboard', '/dashboard/notifications']) expect(location(await page(p))).toBe('https://app.test/account-suspended');
    }
  });

  it('not signed in: sign-in, as before', async () => {
    h.signedIn = false;
    expect(location(await page('/dashboard/today'))).toContain('/sign-in');
  });
});
