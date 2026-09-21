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
vi.mock('@/lib/lx/workspace-navigation', () => ({ buildParentNav: vi.fn(() => []), buildTeacherNav: vi.fn(() => []), buildInstitutionNav: vi.fn(() => []) }));
vi.mock('./LanguageSwitcher', () => ({ default: () => null }));
vi.mock('./LearnerShell', () => ({ default: ({ children }: any) => children }));
vi.mock('./WorkspaceSwitcher', () => ({ default: () => null }));

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
  getOrCreateCanonicalUserMock.mockReset().mockResolvedValue({ id: 'user-1', activeWorkspace: null });
  resolveAvailableWorkspacesMock.mockReset();
  resolveDefaultWorkspaceMock.mockReset().mockResolvedValue(null);
  getActiveWorkspaceMock.mockReset().mockResolvedValue(null);
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
