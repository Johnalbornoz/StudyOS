/**
 * A01-LOGIC-03 -- admin-only accounts never enter Student onboarding.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  class RedirectSignal extends Error {
    constructor(public destination: string) {
      super(`NEXT_REDIRECT:${destination}`);
    }
  }
  return {
    RedirectSignal,
    redirectMock: vi.fn((to: string) => {
      throw new RedirectSignal(to);
    }),
    authMock: vi.fn(),
    currentUserMock: vi.fn(),
    getOrCreateCanonicalUserMock: vi.fn(),
    availableMock: vi.fn(),
    storedMock: vi.fn(),
    defaultMock: vi.fn(),
    bootstrapMock: vi.fn(),
    getOrCreateStudentIdMock: vi.fn(),
    queryMock: vi.fn(),
  };
});

vi.mock('next/navigation', () => ({ redirect: h.redirectMock }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('@clerk/nextjs/server', () => ({ auth: () => h.authMock(), currentUser: () => h.currentUserMock() }));
vi.mock('@/lib/identity/canonical-user.service', () => ({ getOrCreateCanonicalUser: (...a: any[]) => h.getOrCreateCanonicalUserMock(...a) }));
vi.mock('@/lib/identity/workspace.service', () => ({
  resolveAvailableWorkspaces: (...a: any[]) => h.availableMock(...a),
  getActiveWorkspace: (...a: any[]) => h.storedMock(...a),
  resolveDefaultWorkspace: (...a: any[]) => h.defaultMock(...a),
}));
vi.mock('@/lib/admin/authorization', () => ({ bootstrapStudyUSAdminIfEligible: (...a: any[]) => h.bootstrapMock(...a) }));
vi.mock('@/lib/auth', () => ({ getOrCreateStudentId: (...a: any[]) => h.getOrCreateStudentIdMock(...a) }));
vi.mock('@/lib/db', () => ({ query: (...a: any[]) => h.queryMock(...a), db: { query: (...a: any[]) => h.queryMock(...a) } }));
vi.mock('@/lib/i18n/language', () => ({ getInterfaceLanguage: vi.fn(async () => 'es') }));

import { decideWorkspaceEntry, WORKSPACE_HOME, ROLE_SELECT_PATH } from '@/lib/identity/workspace-entry';
import { ADMIN_HOME } from '@/lib/admin/sections';
import Home from '@/app/page';
import OnboardingPage from '@/app/dashboard/onboarding/page';

/** Simulates F1 state: roles held (after the allowlist grant) and the stored workspace. */
function actor(opts: { email: string; roles: Array<'STUDENT' | 'PARENT' | 'ADMIN'>; stored?: 'STUDENT' | 'ADMIN' | null; allowlisted?: boolean }) {
  h.currentUserMock.mockResolvedValue({ primaryEmailAddress: { emailAddress: opts.email }, emailAddresses: [] });
  h.getOrCreateCanonicalUserMock.mockResolvedValue({ id: 'user-1', status: 'ACTIVE' });
  const roles = [...opts.roles];
  h.bootstrapMock.mockImplementation(async () => {
    if (opts.allowlisted && !roles.includes('ADMIN')) roles.push('ADMIN');
  });
  const order = ['STUDENT', 'PARENT', 'ADMIN'];
  h.availableMock.mockImplementation(async () => order.filter((w) => roles.includes(w as any)));
  h.defaultMock.mockImplementation(async () => order.find((w) => roles.includes(w as any)) ?? null);
  h.storedMock.mockResolvedValue(opts.stored ?? null);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.authMock.mockResolvedValue({ userId: 'clerk-user-1' });
  h.getOrCreateStudentIdMock.mockResolvedValue('student-1');
  h.queryMock.mockResolvedValue({ rows: [] });
});

describe('decideWorkspaceEntry (pure)', () => {
  it('admin-only -> Admin Overview; student -> Student; zero roles -> role selection; parent -> parent home', () => {
    expect(decideWorkspaceEntry({ available: ['ADMIN'], stored: null, defaultWorkspace: 'ADMIN' })).toEqual({ kind: 'REDIRECT', to: ADMIN_HOME });
    expect(decideWorkspaceEntry({ available: ['STUDENT'], stored: null, defaultWorkspace: 'STUDENT' })).toEqual({ kind: 'STUDENT' });
    expect(decideWorkspaceEntry({ available: [], stored: null, defaultWorkspace: null })).toEqual({ kind: 'REDIRECT', to: ROLE_SELECT_PATH });
    expect(decideWorkspaceEntry({ available: ['PARENT'], stored: null, defaultWorkspace: 'PARENT' })).toEqual({ kind: 'REDIRECT', to: WORKSPACE_HOME.PARENT });
  });

  it('a stale stored workspace is ignored in favour of the default', () => {
    expect(decideWorkspaceEntry({ available: ['ADMIN'], stored: 'STUDENT', defaultWorkspace: 'ADMIN' })).toEqual({ kind: 'REDIRECT', to: ADMIN_HOME });
  });
});

describe('A01-LOGIC-03 -- routing', () => {
  it('1. allowlisted admin sign-up: STUDYUS_ADMIN is granted and "/" lands on Admin Overview', async () => {
    actor({ email: 'john@jalbornoz.com', roles: [], allowlisted: true });
    await expect(Home()).rejects.toThrow(h.RedirectSignal);
    expect(h.bootstrapMock).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-1' }), 'john@jalbornoz.com');
    expect(h.redirectMock).toHaveBeenCalledWith('/dashboard/admin/overview');
  });

  it('2. admin-only opening /dashboard/onboarding is redirected to Admin Overview', async () => {
    actor({ email: 'john@jalbornoz.com', roles: ['ADMIN'] });
    await expect(OnboardingPage()).rejects.toThrow(h.RedirectSignal);
    expect(h.redirectMock).toHaveBeenCalledWith('/dashboard/admin/overview');
  });

  it('3. admin-only never provisions a student/profile (no getOrCreateStudentId, no subjects read)', async () => {
    actor({ email: 'john@jalbornoz.com', roles: [], allowlisted: true });
    await expect(Home()).rejects.toThrow(h.RedirectSignal);
    await expect(OnboardingPage()).rejects.toThrow(h.RedirectSignal);
    expect(h.getOrCreateStudentIdMock).not.toHaveBeenCalled();
    expect(h.queryMock).not.toHaveBeenCalled();
  });

  it('4. a normal Student with no subject still goes to, and sees, Student onboarding', async () => {
    actor({ email: 'ana@example.com', roles: ['STUDENT'] });
    await expect(Home()).rejects.toThrow(h.RedirectSignal);
    expect(h.redirectMock).toHaveBeenLastCalledWith('/dashboard/onboarding');

    h.redirectMock.mockClear();
    const page: any = await OnboardingPage();
    expect(h.redirectMock).not.toHaveBeenCalled();
    expect(h.getOrCreateStudentIdMock).toHaveBeenCalledWith('clerk-user-1');
    expect(page).toBeTruthy();
  });

  // Track A product amendment: STUDYUS_ADMIN is a capability next to the ONE
  // persona. Student entry pages always serve the persona (a stored ADMIN
  // context never displaces it); the console is reached by its own route.
  it('5. Student persona + admin capability: Student entry pages serve the Student, whatever context was stored', async () => {
    actor({ email: 'john@jalbornoz.com', roles: ['STUDENT', 'ADMIN'], stored: 'STUDENT' });
    const page: any = await OnboardingPage();
    expect(page).toBeTruthy();
    expect(h.getOrCreateStudentIdMock).toHaveBeenCalled();

    vi.clearAllMocks();
    h.authMock.mockResolvedValue({ userId: 'clerk-user-1' });
    h.queryMock.mockResolvedValue({ rows: [] });
    actor({ email: 'john@jalbornoz.com', roles: ['STUDENT', 'ADMIN'], stored: 'ADMIN' });
    const again: any = await OnboardingPage();
    expect(again).toBeTruthy();
    expect(h.redirectMock).not.toHaveBeenCalledWith('/dashboard/admin/overview');
  });

  it('an unauthenticated visitor to "/" is still sent to the localized landing page', async () => {
    h.authMock.mockResolvedValue({ userId: null });
    await expect(Home()).rejects.toThrow(h.RedirectSignal);
    expect(h.redirectMock.mock.calls[0][0]).toMatch(/^\/[a-z]{2}$/);
    expect(h.getOrCreateCanonicalUserMock).not.toHaveBeenCalled();
  });
});
