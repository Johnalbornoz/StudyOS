/**
 * Student onboarding gate -- a new Student must complete the academic
 * profile and add a first subject before using the Student workspace.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ dbQueryMock: vi.fn(), authMock: vi.fn() }));

vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => h.dbQueryMock(...a) } }));
vi.mock('@clerk/nextjs/server', () => ({
  // Pass-through: the proxy's handler is exercised directly with a mocked auth().
  clerkMiddleware: (handler: any) => (request: any) => handler(() => h.authMock(), request),
}));

import {
  decideStudentOnboardingGate,
  isAcademicProfileComplete,
  isStudentGatedPath,
  studentOnboardingStage,
  type AcademicProfileFields,
  type GateState,
} from '@/lib/student/onboarding-gate';
import { loadGateState } from '@/lib/student/onboarding-gate.server';
import proxy from '@/proxy';
import { NextRequest } from 'next/server';

const COMPLETE: AcademicProfileFields = {
  profileCompleted: true, countryOfStudy: 'co', schoolYear: '10', curriculumType: 'national',
  ibProgramme: null, ibYear: null, academicYear: '2026',
};

function student(over: Partial<GateState> = {}): GateState {
  return { accountStatus: 'ACTIVE', roles: ['STUDENT'], storedWorkspace: 'STUDENT', profile: null, subjectCount: 0, ...over };
}

beforeEach(() => {
  h.dbQueryMock.mockReset();
  h.authMock.mockReset();
});

describe('academic profile completeness (server-side, never inferred from a students row)', () => {
  it('requires the completion flag and every required field; IB also needs programme and year', () => {
    expect(isAcademicProfileComplete(COMPLETE)).toBe(true);
    expect(isAcademicProfileComplete(null)).toBe(false);
    expect(isAcademicProfileComplete({ ...COMPLETE, profileCompleted: false })).toBe(false);
    expect(isAcademicProfileComplete({ ...COMPLETE, academicYear: '  ' })).toBe(false);
    expect(isAcademicProfileComplete({ ...COMPLETE, schoolYear: null })).toBe(false);
    expect(isAcademicProfileComplete({ ...COMPLETE, curriculumType: 'ib' })).toBe(false);
    expect(isAcademicProfileComplete({ ...COMPLETE, curriculumType: 'ib', ibProgramme: 'dp', ibYear: 'DP1' })).toBe(true);
  });

  it('stages: profile -> first subject -> ready', () => {
    expect(studentOnboardingStage(null, 0)).toBe('ACADEMIC_PROFILE');
    expect(studentOnboardingStage(COMPLETE, 0)).toBe('FIRST_SUBJECT');
    expect(studentOnboardingStage(COMPLETE, 1)).toBe('READY');
  });

  it('only Student pages under /dashboard are gated', () => {
    expect(isStudentGatedPath('/dashboard')).toBe(true);
    expect(isStudentGatedPath('/dashboard/progress')).toBe(true);
    expect(isStudentGatedPath('/dashboard/admin/overview')).toBe(false);
    expect(isStudentGatedPath('/dashboard/parent')).toBe(false);
    expect(isStudentGatedPath('/api/academic-profile')).toBe(false);
    expect(isStudentGatedPath('/role-select')).toBe(false);
  });
});

describe('gate decisions', () => {
  it('1. new Student without an academic profile -> academic profile onboarding', () => {
    expect(decideStudentOnboardingGate('/dashboard/today', student())).toBe('/dashboard/profile');
  });

  it('2. direct access to /dashboard without an academic profile -> onboarding', () => {
    expect(decideStudentOnboardingGate('/dashboard', student())).toBe('/dashboard/profile');
  });

  it('3. direct access to an inner Student route without an academic profile -> onboarding', () => {
    for (const path of ['/dashboard/progress', '/dashboard/subjects', '/dashboard/quiz', '/dashboard/tutor', '/dashboard/onboarding', '/dashboard/subjects/new']) {
      expect(decideStudentOnboardingGate(path, student())).toBe('/dashboard/profile');
    }
    expect(decideStudentOnboardingGate('/dashboard/profile', student())).toBeNull();
  });

  it('4. incomplete profile keeps the onboarding going; then the first-subject step is enforced', () => {
    const partial = { ...COMPLETE, profileCompleted: false };
    expect(decideStudentOnboardingGate('/dashboard', student({ profile: partial }))).toBe('/dashboard/profile');
    // profile complete, no subject yet: only the first-subject flow (and the profile) is reachable
    const s = student({ profile: COMPLETE, subjectCount: 0 });
    expect(decideStudentOnboardingGate('/dashboard', s)).toBe('/dashboard/onboarding');
    expect(decideStudentOnboardingGate('/dashboard/progress', s)).toBe('/dashboard/onboarding');
    expect(decideStudentOnboardingGate('/dashboard/onboarding', s)).toBeNull();
    expect(decideStudentOnboardingGate('/dashboard/subjects/new', s)).toBeNull();
    expect(decideStudentOnboardingGate('/dashboard/profile', s)).toBeNull();
  });

  it('5. Student with a complete profile and a subject enters the workspace normally', () => {
    const s = student({ profile: COMPLETE, subjectCount: 2 });
    for (const path of ['/dashboard', '/dashboard/today', '/dashboard/progress', '/dashboard/subjects']) {
      expect(decideStudentOnboardingGate(path, s)).toBeNull();
    }
  });

  it('6. admin-only is never gated (Admin Overview routing is unaffected)', () => {
    const admin = student({ roles: ['STUDYUS_ADMIN'], storedWorkspace: 'ADMIN' });
    expect(decideStudentOnboardingGate('/dashboard/admin/overview', admin)).toBeNull();
    expect(decideStudentOnboardingGate('/dashboard', admin)).toBeNull();
    expect(decideStudentOnboardingGate('/dashboard', student({ roles: ['PARENT'], storedWorkspace: 'PARENT' }))).toBeNull();
  });

  // Track A product amendment: admin is a capability; Student pages always
  // render in the Student persona, so the gate applies whatever was stored.
  it('7. Student persona + admin capability: Student pages are gated; admin routes are not', () => {
    const multi = { roles: ['STUDENT', 'STUDYUS_ADMIN'] as any, profile: null, subjectCount: 0 };
    expect(decideStudentOnboardingGate('/dashboard', student({ ...multi, storedWorkspace: 'STUDENT' }))).toBe('/dashboard/profile');
    expect(decideStudentOnboardingGate('/dashboard', student({ ...multi, storedWorkspace: 'ADMIN' }))).toBe('/dashboard/profile');
    expect(decideStudentOnboardingGate('/dashboard/admin/users', student({ ...multi, storedWorkspace: 'STUDENT' }))).toBeNull();
  });

  it('accounts that do not exist yet, have no role, or are not ACTIVE are left to the existing flows', () => {
    expect(decideStudentOnboardingGate('/dashboard', null)).toBeNull();
    expect(decideStudentOnboardingGate('/dashboard', student({ roles: [] }))).toBeNull();
    expect(decideStudentOnboardingGate('/dashboard', student({ accountStatus: 'SUSPENDED' }))).toBeNull();
  });
});

describe('8. no accidental creation -- the gate only reads', () => {
  it('loads state with a single SELECT and maps a missing academic profile to null', async () => {
    h.dbQueryMock.mockResolvedValue({ rows: [{ status: 'ACTIVE', active_workspace: 'STUDENT', roles: ['STUDENT'], profile_completed: null, subject_count: 0 }] });
    const state = await loadGateState('clerk_1');
    expect(h.dbQueryMock).toHaveBeenCalledTimes(1);
    const sql: string = h.dbQueryMock.mock.calls[0][0];
    expect(sql.trim().toUpperCase().startsWith('SELECT')).toBe(true);
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
    expect(state).toMatchObject({ roles: ['STUDENT'], profile: null, subjectCount: 0 });
  });

  it('a students row alone never completes onboarding', () => {
    // A student row exists (created by any Student page) but no academic profile and no subject.
    expect(decideStudentOnboardingGate('/dashboard', student({ profile: null, subjectCount: 0 }))).toBe('/dashboard/profile');
  });
});

describe('proxy -- enforced before any page renders', () => {
  const req = (path: string) => new NextRequest(new URL(path, 'https://dev.example.test'));

  it('redirects an unfinished Student before the page runs, and forwards the path header otherwise', async () => {
    h.authMock.mockResolvedValue({ userId: 'clerk_1' });
    h.dbQueryMock.mockResolvedValue({ rows: [{ status: 'ACTIVE', active_workspace: 'STUDENT', roles: ['STUDENT'], profile_completed: null, subject_count: 0 }] });
    const res: any = await (proxy as any)(req('/dashboard'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://dev.example.test/dashboard/profile');

    const ok: any = await (proxy as any)(req('/dashboard/profile'));
    expect(ok.headers.get('location')).toBeNull();
    expect(ok.headers.get('x-middleware-request-x-studyos-pathname')).toBe('/dashboard/profile');
  });

  it('does not query the database for non-Student routes', async () => {
    h.authMock.mockResolvedValue({ userId: 'clerk_1' });
    await (proxy as any)(req('/dashboard/admin/overview'));
    await (proxy as any)(req('/api/academic-profile'));
    expect(h.dbQueryMock).not.toHaveBeenCalled();
  });

  it('fails open when the lookup fails (request continues, nothing blocked)', async () => {
    h.authMock.mockResolvedValue({ userId: 'clerk_1' });
    h.dbQueryMock.mockRejectedValue(new Error('db down'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res: any = await (proxy as any)(req('/dashboard'));
    expect(res.headers.get('location')).toBeNull();
    errSpy.mockRestore();
  });
});
