/**
 * Onboarding/authorization rework (2026-09-21) -- the core "no debe ser
 * posible entrar al dashboard normal con cero roles" requirement. Root
 * cause: DashboardLayout used to default a roleless account's
 * `availableWorkspaces` to `['STUDENT']` and immediately provision a
 * `students` row via `getOrCreateStudentId`. Proves the fix: zero
 * active roles -> redirect('/role-select') before any workspace
 * resolution or Student provisioning, and a real login (>=1 role)
 * never triggers the redirect.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

class RedirectSignal extends Error {
  constructor(public destination: string) {
    super(`NEXT_REDIRECT:${destination}`);
  }
}
const redirectMock = vi.fn((...args: any[]) => {
  throw new RedirectSignal(args[0]);
});
vi.mock('next/navigation', () => ({ redirect: (...a: any[]) => redirectMock(...a) }));

const authMock = vi.fn();
const currentUserMock = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({ auth: () => authMock(), currentUser: () => currentUserMock() }));

const isAdminEmailMock = vi.fn();
vi.mock('@/services/admin.service', () => ({ isAdminEmail: (...a: any[]) => isAdminEmailMock(...a) }));
vi.mock('@/services/notifications.service', () => ({ getUnreadNotifications: vi.fn(async () => []) }));
vi.mock('@/services/learning-debt.service', () => ({ getActiveDebts: vi.fn(async () => []) }));
vi.mock('@/services/gamification.service', () => ({ getLearningDaysThisWeek: vi.fn(async () => 0) }));
vi.mock('@/lib/student/teacher-intervention-execution.service', () => ({ countPendingTeacherInterventionsForStudent: vi.fn(async () => 0) }));
vi.mock('@/lib/i18n/language', () => ({ getInterfaceLanguage: vi.fn(async () => 'es') }));
vi.mock('@/lib/lx/learner-navigation', () => ({ buildLearnerNav: vi.fn(() => []) }));
const buildAdminNavMock = vi.fn(() => []);
vi.mock('@/lib/lx/workspace-navigation', () => ({ buildParentNav: vi.fn(() => []), buildTeacherNav: vi.fn(() => []), buildInstitutionNav: vi.fn(() => []), buildAdminNav: () => buildAdminNavMock() }));

let requestPathname: string | null = '/dashboard';
vi.mock('next/headers', () => ({ headers: async () => new Headers(requestPathname ? { 'x-studyos-pathname': requestPathname } : {}) }));

const bootstrapAdminMock = vi.fn();
vi.mock('@/lib/admin/authorization', () => ({ bootstrapStudyUSAdminIfEligible: (...a: any[]) => bootstrapAdminMock(...a) }));
vi.mock('./LanguageSwitcher', () => ({ default: () => null }));
vi.mock('./LearnerShell', () => ({ default: ({ children }: any) => children }));
vi.mock('./WorkspaceSwitcher', () => ({ default: () => null }));
vi.mock('./LicenseBanner', () => ({ default: () => 'LICENSE_BANNER' }));

const canUseCapabilityMock = vi.fn();
vi.mock('@/lib/entitlements', () => ({ canUseCapability: (...a: any[]) => canUseCapabilityMock(...a) }));

const getOrCreateStudentIdMock = vi.fn();
vi.mock('@/lib/auth', () => ({ getOrCreateStudentId: (...a: any[]) => getOrCreateStudentIdMock(...a) }));

const getOrCreateCanonicalUserMock = vi.fn();
const resolveAvailableWorkspacesMock = vi.fn();
const resolveDefaultWorkspaceMock = vi.fn();
const getActiveWorkspaceMock = vi.fn();
vi.mock('@/lib/identity', () => ({
  getOrCreateCanonicalUser: (...a: any[]) => getOrCreateCanonicalUserMock(...a),
  resolveAvailableWorkspaces: (...a: any[]) => resolveAvailableWorkspacesMock(...a),
  resolveDefaultWorkspace: (...a: any[]) => resolveDefaultWorkspaceMock(...a),
  getActiveWorkspace: (...a: any[]) => getActiveWorkspaceMock(...a),
}));

import DashboardLayout from '@/app/dashboard/layout';

beforeEach(() => {
  redirectMock.mockClear();
  authMock.mockReset().mockResolvedValue({ userId: 'clerk-user-1' });
  currentUserMock.mockReset().mockResolvedValue({ firstName: 'Ana', primaryEmailAddress: { emailAddress: 'ana@test.com' }, emailAddresses: [] });
  isAdminEmailMock.mockReset().mockReturnValue(false);
  getOrCreateStudentIdMock.mockReset().mockResolvedValue('student-1');
  getOrCreateCanonicalUserMock.mockReset().mockResolvedValue({ id: 'user-1', status: 'ACTIVE', activeWorkspace: null });
  resolveAvailableWorkspacesMock.mockReset();
  resolveDefaultWorkspaceMock.mockReset().mockResolvedValue(null);
  getActiveWorkspaceMock.mockReset().mockResolvedValue(null);
  canUseCapabilityMock.mockReset().mockResolvedValue(true);
  bootstrapAdminMock.mockReset().mockResolvedValue(undefined);
  buildAdminNavMock.mockClear();
  requestPathname = '/dashboard';
});

describe('DashboardLayout -- zero active roles redirects to /role-select, never renders a Student fallback', () => {
  it('redirects before resolving any workspace or provisioning a Student, when the account has zero active roles', async () => {
    resolveAvailableWorkspacesMock.mockResolvedValue([]);

    await expect(DashboardLayout({ children: null as any })).rejects.toThrow(RedirectSignal);
    expect(redirectMock).toHaveBeenCalledWith('/role-select');
    expect(getOrCreateStudentIdMock).not.toHaveBeenCalled();
    expect(resolveDefaultWorkspaceMock).not.toHaveBeenCalled();
  });

  it('a real STUDENT account (>=1 active role) is never redirected', async () => {
    resolveAvailableWorkspacesMock.mockResolvedValue(['STUDENT']);
    resolveDefaultWorkspaceMock.mockResolvedValue('STUDENT');

    await DashboardLayout({ children: null as any });
    expect(redirectMock).not.toHaveBeenCalled();
    expect(getOrCreateStudentIdMock).toHaveBeenCalledWith('clerk-user-1');
  });

  it('a PARENT-only account (no STUDENT role) is never redirected and never provisions a students row', async () => {
    resolveAvailableWorkspacesMock.mockResolvedValue(['PARENT']);
    resolveDefaultWorkspaceMock.mockResolvedValue('PARENT');

    await DashboardLayout({ children: null as any });
    expect(redirectMock).not.toHaveBeenCalled();
    expect(getOrCreateStudentIdMock).not.toHaveBeenCalled();
  });

  it('an unauthenticated request is not redirected by this layout (Clerk middleware is the actual gate for that)', async () => {
    authMock.mockResolvedValue({ userId: null });
    await DashboardLayout({ children: null as any });
    expect(redirectMock).not.toHaveBeenCalled();
    expect(resolveAvailableWorkspacesMock).not.toHaveBeenCalled();
  });
});

describe('DashboardLayout -- Fase 2A: a SUSPENDED or ARCHIVED account is blocked server-side, before any workspace/role resolution', () => {
  it('redirects a SUSPENDED account to /account-suspended without resolving workspaces or provisioning a Student', async () => {
    getOrCreateCanonicalUserMock.mockResolvedValue({ id: 'user-1', status: 'SUSPENDED', activeWorkspace: null });

    await expect(DashboardLayout({ children: null as any })).rejects.toThrow(RedirectSignal);
    expect(redirectMock).toHaveBeenCalledWith('/account-suspended');
    expect(resolveAvailableWorkspacesMock).not.toHaveBeenCalled();
    expect(getOrCreateStudentIdMock).not.toHaveBeenCalled();
  });

  it('redirects an ARCHIVED account the same way', async () => {
    getOrCreateCanonicalUserMock.mockResolvedValue({ id: 'user-1', status: 'ARCHIVED', activeWorkspace: null });

    await expect(DashboardLayout({ children: null as any })).rejects.toThrow(RedirectSignal);
    expect(redirectMock).toHaveBeenCalledWith('/account-suspended');
  });

  it('an ACTIVE account is never redirected by this check', async () => {
    getOrCreateCanonicalUserMock.mockResolvedValue({ id: 'user-1', status: 'ACTIVE', activeWorkspace: null });
    resolveAvailableWorkspacesMock.mockResolvedValue(['STUDENT']);
    resolveDefaultWorkspaceMock.mockResolvedValue('STUDENT');

    await DashboardLayout({ children: null as any });
    expect(redirectMock).not.toHaveBeenCalled();
  });
});

describe('DashboardLayout -- Rediseño de consola profesional: a temporary-password account must change it before reaching the dashboard', () => {
  it('redirects to /account/change-password without resolving workspaces or provisioning a Student, checked in the same position as the status gate', async () => {
    getOrCreateCanonicalUserMock.mockResolvedValue({ id: 'user-1', status: 'ACTIVE', activeWorkspace: null, passwordChangeRequired: true });

    await expect(DashboardLayout({ children: null as any })).rejects.toThrow(RedirectSignal);
    expect(redirectMock).toHaveBeenCalledWith('/account/change-password');
    expect(resolveAvailableWorkspacesMock).not.toHaveBeenCalled();
    expect(getOrCreateStudentIdMock).not.toHaveBeenCalled();
  });

  it('an account that already changed its password is never redirected by this check', async () => {
    getOrCreateCanonicalUserMock.mockResolvedValue({ id: 'user-1', status: 'ACTIVE', activeWorkspace: null, passwordChangeRequired: false });
    resolveAvailableWorkspacesMock.mockResolvedValue(['STUDENT']);
    resolveDefaultWorkspaceMock.mockResolvedValue('STUDENT');

    await DashboardLayout({ children: null as any });
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it('a SUSPENDED account with passwordChangeRequired still true is caught by the status check first (order matters, but both fail closed)', async () => {
    getOrCreateCanonicalUserMock.mockResolvedValue({ id: 'user-1', status: 'SUSPENDED', activeWorkspace: null, passwordChangeRequired: true });

    await expect(DashboardLayout({ children: null as any })).rejects.toThrow(RedirectSignal);
    expect(redirectMock).toHaveBeenCalledWith('/account-suspended');
  });
});

describe('DashboardLayout -- demo/no-license banner, visible cue only (server-side entitlement checks are the real gate)', () => {
  it('shows the license banner for a STUDENT workspace with no active license', async () => {
    resolveAvailableWorkspacesMock.mockResolvedValue(['STUDENT']);
    resolveDefaultWorkspaceMock.mockResolvedValue('STUDENT');
    canUseCapabilityMock.mockResolvedValue(false);

    const result: any = await DashboardLayout({ children: null as any });
    expect(canUseCapabilityMock).toHaveBeenCalledWith('user-1', 'student-1', 'LEARNING_FULL_ACCESS');
    expect(result.props.banner).toBeTruthy();
  });

  it('hides the license banner for a STUDENT workspace with an active license', async () => {
    resolveAvailableWorkspacesMock.mockResolvedValue(['STUDENT']);
    resolveDefaultWorkspaceMock.mockResolvedValue('STUDENT');
    canUseCapabilityMock.mockResolvedValue(true);

    const result: any = await DashboardLayout({ children: null as any });
    expect(result.props.banner).toBeUndefined();
  });

  it('fails closed to showing the banner if the entitlement check itself errors', async () => {
    resolveAvailableWorkspacesMock.mockResolvedValue(['STUDENT']);
    resolveDefaultWorkspaceMock.mockResolvedValue('STUDENT');
    canUseCapabilityMock.mockRejectedValue(new Error('db unavailable'));

    const result: any = await DashboardLayout({ children: null as any });
    expect(result.props.banner).toBeTruthy();
  });

  it('never shows the license banner (or checks the capability) for a non-STUDENT workspace', async () => {
    resolveAvailableWorkspacesMock.mockResolvedValue(['PARENT']);
    resolveDefaultWorkspaceMock.mockResolvedValue('PARENT');

    const result: any = await DashboardLayout({ children: null as any });
    expect(canUseCapabilityMock).not.toHaveBeenCalled();
    expect(result.props.banner).toBeUndefined();
  });
});

describe('DashboardLayout -- Admin/Auth reset block: Platform Administration context (A01-UX-02, A01-LOGIC-01)', () => {
  it('grants the allowlisted admin role before resolving workspaces, so an admin-only account never lands on role selection', async () => {
    isAdminEmailMock.mockReturnValue(true);
    resolveAvailableWorkspacesMock.mockResolvedValue(['ADMIN']);
    resolveDefaultWorkspaceMock.mockResolvedValue('ADMIN');
    requestPathname = '/dashboard/admin/overview';

    await DashboardLayout({ children: null as any });
    expect(bootstrapAdminMock).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-1' }), 'ana@test.com');
    expect(bootstrapAdminMock.mock.invocationCallOrder[0]).toBeLessThan(resolveAvailableWorkspacesMock.mock.invocationCallOrder[0]);
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it('a Student+Admin account on an admin route is shown the Administration context, with no license banner and no Student reads', async () => {
    resolveAvailableWorkspacesMock.mockResolvedValue(['STUDENT', 'ADMIN']);
    resolveDefaultWorkspaceMock.mockResolvedValue('STUDENT');
    getActiveWorkspaceMock.mockResolvedValue('STUDENT');
    canUseCapabilityMock.mockResolvedValue(false);
    requestPathname = '/dashboard/admin/users';

    const result: any = await DashboardLayout({ children: null as any });
    expect(result.props.banner).toBeUndefined();
    expect(buildAdminNavMock).toHaveBeenCalled();
    expect(getOrCreateStudentIdMock).not.toHaveBeenCalled();
    expect(canUseCapabilityMock).not.toHaveBeenCalled();
    expect(result.props.workspaceSwitcher.props.active).toBe('ADMIN');
    expect(result.props.workspaceSwitcher.props.available).toEqual(['STUDENT', 'ADMIN']);
  });

  it('the same account outside admin routes keeps its Student workspace (and banner)', async () => {
    resolveAvailableWorkspacesMock.mockResolvedValue(['STUDENT', 'ADMIN']);
    resolveDefaultWorkspaceMock.mockResolvedValue('STUDENT');
    getActiveWorkspaceMock.mockResolvedValue('STUDENT');
    canUseCapabilityMock.mockResolvedValue(false);
    requestPathname = '/dashboard/subjects';

    const result: any = await DashboardLayout({ children: null as any });
    expect(result.props.workspaceSwitcher.props.active).toBe('STUDENT');
    expect(result.props.banner).toBeTruthy();
  });

  it('an admin-only account opening /dashboard is sent to the console instead of provisioning a Student', async () => {
    resolveAvailableWorkspacesMock.mockResolvedValue(['ADMIN']);
    resolveDefaultWorkspaceMock.mockResolvedValue('ADMIN');
    requestPathname = '/dashboard';

    await expect(DashboardLayout({ children: null as any })).rejects.toThrow(RedirectSignal);
    expect(redirectMock).toHaveBeenCalledWith('/dashboard/admin/overview');
    expect(getOrCreateStudentIdMock).not.toHaveBeenCalled();
  });
});
