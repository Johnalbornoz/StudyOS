/**
 * T1 REMEDIATION -- Account & Academic Profile (REM-T1-01 .. REM-T1-07).
 *
 * Numbered cases follow the remediation brief's section 11 (1-30), plus the
 * REM-T1-03 time-context cases. Pure logic is exercised directly; routes and
 * the proxy with mocked Clerk / DB (no network, no real database); client
 * components with renderToStaticMarkup.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const h = vi.hoisted(() => ({
  dbQueryMock: vi.fn(),
  authMock: vi.fn(),
  redirectToSignIn: vi.fn(),
  signOutMock: vi.fn(),
  pathname: '/dashboard/profile',
  requireStudentIdMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => h.dbQueryMock(...a) }, query: (...a: any[]) => h.dbQueryMock(...a) }));
vi.mock('@clerk/nextjs/server', () => ({
  clerkMiddleware: (handler: any) => (request: any) => handler(() => h.authMock(), request),
  auth: () => h.authMock(),
}));
vi.mock('@clerk/nextjs', () => ({
  UserButton: () => createElement('span', { 'data-user-button': true }),
  useClerk: () => ({ signOut: h.signOutMock }),
}));
vi.mock('next/navigation', () => ({
  usePathname: () => h.pathname,
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  redirect: (to: string) => { throw new Error(`REDIRECT:${to}`); },
}));
vi.mock('next/image', () => ({ default: (p: any) => createElement('img', { alt: p.alt, src: String(p.src) }) }));
vi.mock('@/lib/auth', () => ({ requireStudentId: (...a: any[]) => h.requireStudentIdMock(...a) }));

import { NextRequest } from 'next/server';
import proxy from '@/proxy';
import { isProtectedPagePath } from '@/lib/auth/protected-routes';
import {
  decideStudentOnboardingGate,
  studentOnboardingStage,
  STUDENT_CONTEXT_PATH,
  ACADEMIC_PROFILE_PATH,
  EXAM_PREPARATION_PATH,
  FIRST_SUBJECT_PATH,
  type AcademicProfileFields,
  type GateState,
} from '@/lib/student/onboarding-gate';
import { loadGateState } from '@/lib/student/onboarding-gate.server';
import { effectiveContextType, knownSubjectLevels, nextPathForContext, profileSubjectCatalogKey, resolveProfileSubjects } from '@/lib/student/student-context';
import { cancelOutcome, isProfileDraftDirty, wizardActions, type ProfileDraft } from '@/lib/student/academic-profile-draft';
import { suggestSubjects } from '@/lib/experience/subject-catalog';
import { isPersonalProfileSubject } from '@/lib/exam-core/objectives/picker';
import { countryDisplayName, gradeDisplayLabel, localizeSubjectName, parseStoredGrade } from '@/lib/i18n/catalog-labels';
import {
  canonicalTimeContextText,
  formatTimeContext,
  isAcceptedTimeContext,
  resolveTimeContextModel,
  storedTimeContext,
  timeContextColumns,
  timeContextKey,
  timeContextOptions,
} from '@/lib/student/time-context';
import { availableSeries, canonicalSeries, SESSION_CATALOG, type SessionCatalog } from '@/lib/exam-core/catalog/programme-sessions';
import { parseTimeContextKey, timeContextFitsModel } from '@/lib/student/time-context';
import { getInterfaceLanguage, setInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages, LOCALES } from '@/lib/i18n/messages';
import { ACADEMIC_PROFILE_MESSAGES } from '@/lib/i18n/academic-profile-messages';
import LearnerShell from '@/app/dashboard/LearnerShell';
import AcademicProfileWizard from '@/app/dashboard/profile/AcademicProfileWizard';
import { ObjectivePicker } from '@/app/dashboard/exam-prep/ObjectivePicker';
import { GET as contextGET, POST as contextPOST } from '@/app/api/student/context/route';

const ROOT = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf-8');
const req = (path: string) => new NextRequest(new URL(path, 'https://dev.example.test'));

const COMPLETE: AcademicProfileFields = { profileCompleted: true, countryOfStudy: 'MX', schoolYear: '3° Preparatoria', curriculumType: 'national', ibProgramme: null, ibYear: null, academicYear: '2026–2027' };
const student = (over: Partial<GateState> = {}): GateState => ({ accountStatus: 'ACTIVE', roles: ['STUDENT'], storedWorkspace: 'STUDENT', profile: null, subjectCount: 0, studentContextType: null, ...over });

beforeEach(() => {
  h.dbQueryMock.mockReset();
  h.authMock.mockReset();
  h.redirectToSignIn.mockReset();
  h.signOutMock.mockReset();
  h.requireStudentIdMock.mockReset();
  h.pathname = '/dashboard/profile';
});

// =================================================================== REM-T1-01 AUTH / ROUTING
describe('REM-T1-01 auth, session and onboarding shell', () => {
  it('1. unauthenticated protected route redirects to the app sign-in BEFORE rendering (with return URL)', async () => {
    h.authMock.mockResolvedValue({ userId: null });
    for (const path of ['/dashboard/today', '/dashboard/learn', '/dashboard', '/dashboard/notifications', '/role-select', '/account/change-password']) {
      const res: any = await (proxy as any)(req(path));
      expect(res.status, path).toBe(307);
      const loc = new URL(res.headers.get('location'));
      expect(loc.pathname, path).toBe('/sign-in');
      expect(loc.searchParams.get('redirect_url'), path).toBe(path);
    }
    const q: any = await (proxy as any)(req('/dashboard/exam-prep?from=start'));
    expect(new URL(q.headers.get('location')).searchParams.get('redirect_url')).toBe('/dashboard/exam-prep?from=start');
    expect(h.dbQueryMock).not.toHaveBeenCalled();
  });

  it('1b. public pages are not protected; /account-suspended is not the account area', () => {
    expect(isProtectedPagePath('/')).toBe(false);
    expect(isProtectedPagePath('/es')).toBe(false);
    expect(isProtectedPagePath('/sign-in')).toBe(false);
    expect(isProtectedPagePath('/account-suspended')).toBe(false);
    expect(isProtectedPagePath('/account/change-password')).toBe(true);
    expect(isProtectedPagePath('/dashboard/exam-prep/abc')).toBe(true);
  });

  it('1c. the layout never renders the Student shell without a session (defence in depth)', () => {
    const layout = read('src/app/dashboard/layout.tsx');
    expect(layout).toMatch(/if \(!clerkUserId\) redirect\('\/sign-in'\);/);
  });

  it('2. incomplete Student onboarding redirects to onboarding, including Notifications and Learn', () => {
    for (const path of ['/dashboard/today', '/dashboard/learn', '/dashboard', '/dashboard/notifications', '/dashboard/plan']) {
      expect(decideStudentOnboardingGate(path, student()), path).toBe(STUDENT_CONTEXT_PATH);
      expect(decideStudentOnboardingGate(path, student({ studentContextType: 'ACADEMIC' })), path).toBe(ACADEMIC_PROFILE_PATH);
      expect(decideStudentOnboardingGate(path, student({ studentContextType: 'ACADEMIC', profile: COMPLETE })), path).toBe(FIRST_SUBJECT_PATH);
    }
  });

  it('2b. refresh does not bypass the gate: the proxy re-evaluates every request from the DB', async () => {
    h.authMock.mockResolvedValue({ userId: 'clerk_1' });
    h.dbQueryMock.mockResolvedValue({ rows: [{ status: 'ACTIVE', active_workspace: 'STUDENT', student_context_type: null, roles: ['STUDENT'], profile_completed: null, subject_count: 0, exam_target_count: 0 }] });
    for (let i = 0; i < 2; i++) {
      const res: any = await (proxy as any)(req('/dashboard/today'));
      expect(res.headers.get('location')).toBe('https://dev.example.test/dashboard/start');
    }
    expect(h.dbQueryMock).toHaveBeenCalledTimes(2);
  });

  it('3. a completed Student reaches the dashboard (no redirect, no onboarding chrome)', () => {
    const done = student({ studentContextType: 'ACADEMIC', profile: COMPLETE, subjectCount: 1 });
    for (const path of ['/dashboard/today', '/dashboard/learn', '/dashboard', '/dashboard/notifications']) expect(decideStudentOnboardingGate(path, done)).toBeNull();
    expect(studentOnboardingStage(COMPLETE, 1, 0, 0, 'ACADEMIC')).toBe('READY');
    // An existing onboarded Student whose context was never stored is NOT sent back (defaults to ACADEMIC).
    expect(decideStudentOnboardingGate('/dashboard/today', student({ studentContextType: null, profile: COMPLETE, subjectCount: 1 }))).toBeNull();
  });

  it('4. Sign out is available during onboarding (onboarding chrome) and ends the Clerk session', () => {
    const html = renderToStaticMarkup(
      createElement(LearnerShell, {
        groups: [{ kind: 'PRIMARY', items: [{ key: 'home', href: '/dashboard/today', label: 'Home', iconKey: 'CalendarDays' }] }],
        displayName: 'Ana', streak: 0, streakLabel: '', menuLabel: 'Menu', closeLabel: 'Close', navLabel: 'Nav', exitLabel: 'Exit',
        localeSwitcher: createElement('span', { 'data-lang': true }), chrome: 'onboarding', signOutLabel: 'Sign out', children: createElement('p', null, 'step'),
      } as any)
    );
    expect(html).toContain('data-testid="sign-out"');
    expect(html).toContain('Sign out');
    expect(html).toContain('data-lang');
    // No product navigation during mandatory onboarding.
    expect(html).not.toContain('href="/dashboard/today"');
    expect(html).not.toMatch(/lx-sidebar|lx-navlink|data-user-button/);
    const action = read('src/components/auth/SignOutAction.tsx');
    expect(action).toMatch(/await signOut\(\{ redirectUrl \}\)/);
    expect(action).toMatch(/redirectUrl = '\/sign-in'/);
    expect(read('src/app/role-select/page.tsx')).toMatch(/<SignOutAction label=\{t\['common\.signOut'\]\} \/>/);
    expect(read('src/app/dashboard/layout.tsx')).toMatch(/chrome=\{onboardingChrome \? 'onboarding' : 'full'\}/);
    for (const l of LOCALES) expect(getMessages(l)['common.signOut']).toBeTruthy();
  });
});

// =================================================================== PRIMARY ROLE
describe('Primary role is never changed by the Student context', () => {
  it('5/6. the context API and service never touch roles or family relationships', () => {
    const svc = read('src/services/student-context.service.ts');
    const route = read('src/app/api/student/context/route.ts');
    for (const src of [svc, route]) {
      expect(src).not.toMatch(/user_roles|assignSelfServiceRole|parent_student_relationships|INSERT INTO students/);
    }
    expect(svc).toMatch(/UPDATE students\s+SET student_context_type/);
    // The one-persona rule itself is unchanged (covered by f1-role-assignment-security.test.ts).
    expect(read('src/lib/identity/role-assignment.service.ts')).toMatch(/PERSONA_EXISTS/);
  });
});

// =================================================================== REM-T1-02 STUDENT CONTEXT
describe('REM-T1-02 Academic Student vs Exam-prep Candidate', () => {
  it('7/8. a new Student can choose either context (POST /api/student/context)', async () => {
    h.authMock.mockResolvedValue({ userId: 'clerk_1' });
    h.requireStudentIdMock.mockResolvedValue('stu-1');
    h.dbQueryMock.mockResolvedValue({ rows: [] });
    for (const [type, next] of [['ACADEMIC', '/dashboard/profile'], ['EXAM_PREP', '/dashboard/exam-prep?from=start']] as const) {
      const res = await contextPOST(new NextRequest('https://dev.example.test/api/student/context', { method: 'POST', body: JSON.stringify({ contextType: type }) }));
      expect(res.status).toBe(200);
      expect((await res.json()).data).toEqual({ contextType: type, next });
    }
    const writes = h.dbQueryMock.mock.calls.map((c) => String(c[0]));
    expect(writes.every((sql) => /UPDATE students/.test(sql))).toBe(true);
    expect(h.dbQueryMock.mock.calls.map((c) => c[1])).toEqual([['stu-1', 'ACADEMIC'], ['stu-1', 'EXAM_PREP']]);
  });

  it('7b. invalid / unauthenticated / non-Student requests are refused', async () => {
    h.authMock.mockResolvedValue({ userId: null });
    expect((await contextPOST(new NextRequest('https://x.test/api/student/context', { method: 'POST', body: '{"contextType":"ACADEMIC"}' }))).status).toBe(401);
    h.authMock.mockResolvedValue({ userId: 'clerk_1' });
    expect((await contextPOST(new NextRequest('https://x.test/api/student/context', { method: 'POST', body: '{"contextType":"TEACHER"}' }))).status).toBe(400);
    h.requireStudentIdMock.mockResolvedValue(null);
    expect((await contextPOST(new NextRequest('https://x.test/api/student/context', { method: 'POST', body: '{"contextType":"ACADEMIC"}' }))).status).toBe(403);
    expect(h.dbQueryMock).not.toHaveBeenCalled();
  });

  it('9. an Academic Student receives the academic-profile flow', () => {
    expect(nextPathForContext('ACADEMIC')).toBe('/dashboard/profile');
    expect(studentOnboardingStage(null, 0, 0, 0, 'ACADEMIC')).toBe('ACADEMIC_PROFILE');
    expect(decideStudentOnboardingGate('/dashboard/learn', student({ studentContextType: 'ACADEMIC' }))).toBe(ACADEMIC_PROFILE_PATH);
    expect(decideStudentOnboardingGate('/dashboard/start', student({ studentContextType: 'ACADEMIC' }))).toBeNull();
  });

  it('10. an Exam-prep Candidate never needs fake school / grade / curriculum data', () => {
    const candidate = student({ studentContextType: 'EXAM_PREP' });
    expect(studentOnboardingStage(null, 0, 0, 0, 'EXAM_PREP')).toBe('EXAM_TARGET');
    expect(decideStudentOnboardingGate('/dashboard/today', candidate)).toBe(EXAM_PREPARATION_PATH);
    expect(decideStudentOnboardingGate('/dashboard/exam-prep', candidate)).toBeNull();
    expect(decideStudentOnboardingGate('/dashboard/exam-prep/discover', candidate)).toBeNull();
    // With an exam target and NO academic profile: READY -- Learn and Exam Prep both open.
    const ready = student({ studentContextType: 'EXAM_PREP', examTargetCount: 1, profile: null, subjectCount: 0 });
    for (const path of ['/dashboard/learn', '/dashboard/exam-prep', '/dashboard/today', '/dashboard']) expect(decideStudentOnboardingGate(path, ready), path).toBeNull();
    // An Academic Student also keeps Exam Prep once onboarded.
    expect(decideStudentOnboardingGate('/dashboard/exam-prep', student({ studentContextType: 'ACADEMIC', profile: COMPLETE, subjectCount: 1 }))).toBeNull();
  });

  it('11/12. the context is persisted server-side: it survives refresh and a new login (read from the DB each time)', async () => {
    h.dbQueryMock.mockResolvedValue({ rows: [{ status: 'ACTIVE', active_workspace: 'STUDENT', student_context_type: 'EXAM_PREP', roles: ['STUDENT'], profile_completed: null, subject_count: 0, exam_target_count: 0 }] });
    const a = await loadGateState('clerk_1');
    const b = await loadGateState('clerk_1');
    expect(a?.studentContextType).toBe('EXAM_PREP');
    expect(b?.studentContextType).toBe('EXAM_PREP');
    expect(String(h.dbQueryMock.mock.calls[0][0])).toMatch(/s\.student_context_type/);
    h.authMock.mockResolvedValue({ userId: 'clerk_1' });
    h.requireStudentIdMock.mockResolvedValue('stu-1');
    h.dbQueryMock.mockResolvedValue({ rows: [{ student_context_type: 'EXAM_PREP' }] });
    expect((await (await contextGET()).json()).data).toEqual({ contextType: 'EXAM_PREP' });
  });

  it('12b. existing Students keep working: completed profile -> ACADEMIC; exam-target only -> EXAM_PREP; nothing else forced', () => {
    expect(effectiveContextType({ stored: null, profileCompleted: true, examTargetCount: 0 })).toBe('ACADEMIC');
    expect(effectiveContextType({ stored: null, profileCompleted: false, examTargetCount: 2 })).toBe('EXAM_PREP');
    expect(effectiveContextType({ stored: null, profileCompleted: false, examTargetCount: 0 })).toBeNull();
    expect(effectiveContextType({ stored: 'EXAM_PREP', profileCompleted: true, examTargetCount: 0 })).toBe('EXAM_PREP');
    // Callers predating the context model keep their exact behaviour (no CONTEXT stage).
    expect(studentOnboardingStage(null, 0)).toBe('ACADEMIC_PROFILE');
    // STUDENT_JOURNEY_V2=UX keeps its own entry choice (EntryChoice on the profile page).
    expect(decideStudentOnboardingGate('/dashboard/today', student({ journeyUx: true }))).toBe(ACADEMIC_PROFILE_PATH);
  });

  it('12c. migration 20261106_1000 is additive and backfills without erasing anything', () => {
    const sql = read('database/migrations/20261106_1000_student_context_and_time_context.sql')
      .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
    expect(sql).not.toMatch(/DROP |DELETE FROM|TRUNCATE|ALTER COLUMN|SET NOT NULL|RENAME/);
    expect(sql.match(/UPDATE public\.students/g)).toHaveLength(2);
    expect(sql).toMatch(/WHERE s\.student_context_type IS NULL/);
    expect(sql).not.toMatch(/UPDATE public\.student_academic_profile|user_roles|class_enrollments/);
  });
});

// =================================================================== REM-T1-06 PROFILE DRAFT
describe('REM-T1-06 profile edit: Cancel / discard, nothing official before Finish', () => {
  const persisted: ProfileDraft = { country: 'MX', grade: '3° Preparatoria', scope: 'NATIONAL', programme: 'p1', qualification: null, subjects: ['s1', 's2'], timeKey: 'SY:2026-2027' };
  const initial = { countryOfStudy: 'MX' as const, schoolYear: '3° Preparatoria', curriculumType: 'national' as const, curriculumScope: 'NATIONAL' as const, academicProgrammeId: 'p1', academicQualificationId: null, academicSubjectIds: ['s1', 's2'], academicYear: '2026–2027', profileCompleted: true };
  const t = getMessages('en') as Record<string, string>;

  it('13. existing profile values preload (draft == persisted; legacy academic year parsed)', () => {
    expect(isProfileDraftDirty(persisted, { ...persisted })).toBe(false);
    expect(storedTimeContext({ academicYear: initial.academicYear })).toEqual({ kind: 'SCHOOL_YEAR', startYear: 2026, endYear: 2027 });
    const html = renderToStaticMarkup(createElement(AcademicProfileWizard, { t, initial: { ...initial, profileCompleted: false }, locale: 'en' }));
    expect(html).toMatch(/aria-pressed="true"[^>]*><span class="acp-option-label">Mexico/);
  });

  it('14. Cancel with no change exits straight away', () => {
    expect(cancelOutcome(isProfileDraftDirty(persisted, persisted))).toBe('EXIT');
  });

  it('15. dirty Cancel asks "Discard unsaved changes?"; Discard restores the persisted draft', () => {
    const edited = { ...persisted, grade: '2° Preparatoria' };
    expect(isProfileDraftDirty(persisted, edited)).toBe(true);
    expect(cancelOutcome(true)).toBe('CONFIRM_DISCARD');
    expect(isProfileDraftDirty(persisted, { ...persisted, subjects: ['s2', 's1'] })).toBe(false);
    expect(isProfileDraftDirty(persisted, { ...persisted, timeKey: 'SY:2027-2028' })).toBe(true);
    const ui = read('src/app/dashboard/profile/AcademicProfileWizard.tsx');
    expect(ui).toMatch(/function exitWizard\(\) \{\s+resetToPersisted\(\);/);
    for (const k of ['acp.cancel', 'acp.discard.title', 'acp.discard.keep', 'acp.discard.confirm']) for (const l of LOCALES) expect((ACADEMIC_PROFILE_MESSAGES as any)[l][k], `${l} ${k}`).toBeTruthy();
    expect(t['acp.discard.title']).toBe('Discard unsaved changes?');
  });

  it('16. Finish is the ONLY write (one POST, from finish())', () => {
    const ui = read('src/app/dashboard/profile/AcademicProfileWizard.tsx');
    expect(ui.match(/method: 'POST'/g)).toHaveLength(1);
    const finish = ui.slice(ui.indexOf('async function finish()'), ui.indexOf('const canContinue'));
    expect(finish).toMatch(/fetch\('\/api\/academic-profile'/);
    expect(finish).toMatch(/timeContext: selectedTime/);
  });

  it('17. an incomplete edit never mutates the persisted profile (buttons per step; no autosave)', () => {
    expect(wizardActions(0, false)).toEqual(['cancel', 'continue']);
    expect(wizardActions(2, false)).toEqual(['cancel', 'back', 'continue']);
    expect(wizardActions(5, true)).toEqual(['cancel', 'back', 'finish']);
    const ui = read('src/app/dashboard/profile/AcademicProfileWizard.tsx');
    expect(ui).not.toMatch(/localStorage|sessionStorage|setInterval|onBlur=\{[^}]*fetch/);
    const html = renderToStaticMarkup(createElement(AcademicProfileWizard, { t, initial: { ...initial, profileCompleted: false }, locale: 'en', exitHref: '/dashboard/start' }));
    expect(html).toContain('data-actions="cancel,continue"');
    expect(html).toContain('data-cancel');
  });
});

// =================================================================== REM-T1-03 TIME CONTEXT
describe('REM-T1-03 context-aware final step (controlled values only)', () => {
  const oct2026 = new Date(Date.UTC(2026, 9, 9));

  it('national / school curricula use a controlled academic-year selector', () => {
    const mx = resolveTimeContextModel({ country: 'MX', programmeName: 'Educación Media Superior — Marco Curricular Común (MCCEMS)' });
    expect(mx).toEqual({ kind: 'SCHOOL_YEAR', format: 'SPLIT' });
    expect(timeContextOptions(mx, oct2026).map((o) => canonicalTimeContextText(o))).toEqual(['2026–2027', '2027–2028']);
    const co = resolveTimeContextModel({ country: 'CO', programmeName: null });
    expect(timeContextOptions(co, oct2026).map((o) => canonicalTimeContextText(o))).toEqual(['2026', '2027']);
    expect(timeContextOptions(mx, new Date(Date.UTC(2027, 2, 1))).map((o) => timeContextKey(o))).toEqual(['SY:2026-2027', 'SY:2027-2028']);
  });

  it('IB Diploma uses examination sessions (May / November)', () => {
    const ib = resolveTimeContextModel({ country: 'MX', programmeName: 'IB Diploma Programme' });
    expect(ib).toMatchObject({ kind: 'EXAM_SESSION', body: 'IB', series: ['MAY', 'NOVEMBER'] });
    expect(timeContextOptions(ib, oct2026).map((o) => formatTimeContext(o, 'en'))).toEqual(['November 2026', 'May 2027', 'November 2027', 'May 2028']);
    expect(formatTimeContext({ kind: 'EXAM_SESSION', series: 'MAY', year: 2027 }, 'es')).toBe('Mayo 2027');
  });

  it('Cambridge uses its canonical series: June / November by default (never IB\'s May)', () => {
    const mx = resolveTimeContextModel({ country: 'MX', programmeName: 'Cambridge IGCSE' });
    expect(mx).toMatchObject({ kind: 'EXAM_SESSION', body: 'CAMBRIDGE' });
    expect(timeContextOptions(mx, oct2026).map((o) => formatTimeContext(o, 'en'))).toEqual(['November 2026', 'June 2027', 'November 2027', 'June 2028']);
    expect(timeContextOptions(mx, oct2026).map((o) => timeContextKey(o))).toEqual(['ES:NOVEMBER:2026', 'ES:JUNE:2027', 'ES:NOVEMBER:2027', 'ES:JUNE:2028']);
    expect(formatTimeContext({ kind: 'EXAM_SESSION', series: 'JUNE', year: 2027 }, 'es')).toBe('Junio 2027');
    for (const p of ['Cambridge IGCSE', 'Cambridge Upper Secondary', 'Cambridge Advanced', 'Cambridge AICE Diploma']) {
      expect(availableSeries({ programmeName: p, country: 'US', year: 2027 }), p).toEqual(['JUNE', 'NOVEMBER']);
    }
    expect(availableSeries({ programmeName: 'IB Middle Years Programme', country: 'MX', year: 2027 })).toEqual([]);
  });

  it('Cambridge March is RESTRICTED: offered only where governed (India, Romania), never hard-coded to one country', () => {
    expect(availableSeries({ programmeName: 'Cambridge IGCSE', country: 'IN', year: 2027 })).toEqual(['MARCH', 'JUNE', 'NOVEMBER']);
    expect(availableSeries({ programmeName: 'Cambridge Advanced', country: 'RO', year: 2027 })).toEqual(['MARCH', 'JUNE', 'NOVEMBER']);
    for (const c of ['MX', 'CO', 'US', 'DE', 'OTHER', '', null]) expect(availableSeries({ programmeName: 'Cambridge IGCSE', country: c, year: 2027 }), String(c)).not.toContain('MARCH');
    const ro = resolveTimeContextModel({ country: 'RO', programmeName: 'Cambridge IGCSE' });
    expect(timeContextOptions(ro, oct2026).map((o) => timeContextKey(o))).toEqual(['ES:NOVEMBER:2026', 'ES:MARCH:2027', 'ES:JUNE:2027', 'ES:NOVEMBER:2027']);
    const mx = resolveTimeContextModel({ country: 'MX', programmeName: 'Cambridge IGCSE' });
    expect(timeContextFitsModel({ kind: 'EXAM_SESSION', series: 'MARCH', year: 2027 }, mx)).toBe(false);
    expect(isAcceptedTimeContext({ kind: 'EXAM_SESSION', series: 'MARCH', year: 2027 }, mx, oct2026, null)).toBe(false);
    expect(SESSION_CATALOG.regionRules.find((r) => r.series === 'MARCH')!.countries).toEqual(['IN', 'RO']);
  });

  it('availability is region- AND year-dependent (rule windows); unknown = not offered', () => {
    const catalog: SessionCatalog = { ...SESSION_CATALOG, regionRules: [{ series: 'MARCH', countries: ['IN'], fromYear: 2028, toYear: 2029, source: 'test' }] };
    expect(availableSeries({ programmeName: 'Cambridge IGCSE', country: 'IN', year: 2027 }, catalog)).toEqual(['JUNE', 'NOVEMBER']);
    expect(availableSeries({ programmeName: 'Cambridge IGCSE', country: 'IN', year: 2028 }, catalog)).toEqual(['MARCH', 'JUNE', 'NOVEMBER']);
    expect(availableSeries({ programmeName: 'Cambridge IGCSE', country: 'IN', year: 2030 }, catalog)).toEqual(['JUNE', 'NOVEMBER']);
    expect(availableSeries({ programmeName: 'Cambridge IGCSE', country: 'RO', year: 2028 }, catalog)).toEqual(['JUNE', 'NOVEMBER']);
    // No region rule at all -> the restricted series is never offered.
    expect(availableSeries({ programmeName: 'Cambridge IGCSE', country: 'IN', year: 2027 }, { ...SESSION_CATALOG, regionRules: [] })).toEqual(['JUNE', 'NOVEMBER']);
  });

  it('qualification and syllabus exclusions remove a series (conservative across selected syllabi)', () => {
    const catalog: SessionCatalog = {
      ...SESSION_CATALOG,
      programmes: { ...SESSION_CATALOG.programmes, 'Cambridge Advanced': { body: 'CAMBRIDGE', series: ['JUNE', 'NOVEMBER'], restrictedSeries: ['MARCH'], qualificationExclusions: { 'Cambridge International AS Level': ['MARCH'] } } },
      syllabusSeries: { '9709': ['JUNE', 'NOVEMBER'], '9231': ['JUNE'] },
    };
    expect(availableSeries({ programmeName: 'Cambridge Advanced', qualificationName: 'Cambridge International A Level', country: 'IN', year: 2027 }, catalog)).toEqual(['MARCH', 'JUNE', 'NOVEMBER']);
    expect(availableSeries({ programmeName: 'Cambridge Advanced', qualificationName: 'Cambridge International AS Level', country: 'IN', year: 2027 }, catalog)).toEqual(['JUNE', 'NOVEMBER']);
    expect(availableSeries({ programmeName: 'Cambridge Advanced', syllabusCodes: ['9709'], country: 'IN', year: 2027 }, catalog)).toEqual(['JUNE', 'NOVEMBER']);
    expect(availableSeries({ programmeName: 'Cambridge Advanced', syllabusCodes: ['9709', '9231'], country: 'IN', year: 2027 }, catalog)).toEqual(['JUNE']);
    // A syllabus without a governed entry follows its programme.
    expect(availableSeries({ programmeName: 'Cambridge Advanced', syllabusCodes: ['0000'], country: 'RO', year: 2027 }, catalog)).toEqual(['MARCH', 'JUNE', 'NOVEMBER']);
  });

  it('existing saved values stay readable: legacy FEB_MARCH / MAY_JUNE / OCT_NOV read as MARCH / JUNE / NOVEMBER, never rewritten', () => {
    expect(canonicalSeries('MAY_JUNE')).toBe('JUNE');
    expect(canonicalSeries('OCT_NOV')).toBe('NOVEMBER');
    expect(canonicalSeries('FEB_MARCH')).toBe('MARCH');
    expect(storedTimeContext({ academicYear: 'May/June 2027', examSeries: 'MAY_JUNE', examYear: 2027 })).toEqual({ kind: 'EXAM_SESSION', series: 'JUNE', year: 2027 });
    expect(parseTimeContextKey('ES:OCT_NOV:2027')).toEqual({ kind: 'EXAM_SESSION', series: 'NOVEMBER', year: 2027 });
    expect(formatTimeContext(storedTimeContext({ academicYear: null, examSeries: 'OCT_NOV', examYear: 2027 })!, 'en')).toBe('November 2027');
    const mx = resolveTimeContextModel({ country: 'MX', programmeName: 'Cambridge IGCSE' });
    const saved = storedTimeContext({ academicYear: 'May/June 2027', examSeries: 'MAY_JUNE', examYear: 2027 });
    expect(isAcceptedTimeContext(saved!, mx, oct2026, saved)).toBe(true);
    // IB rows are unaffected.
    expect(storedTimeContext({ academicYear: 'May 2027', examSeries: 'MAY', examYear: 2027 })).toEqual({ kind: 'EXAM_SESSION', series: 'MAY', year: 2027 });
    // New writes are canonical only.
    const route = read('src/app/api/academic-profile/route.ts');
    expect(route).toMatch(/series: z\.enum\(\['MAY', 'NOVEMBER', 'MARCH', 'JUNE'\]\)/);
    const sql = read('database/migrations/20261106_1100_exam_series_canonical.sql').split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
    expect(sql).not.toMatch(/UPDATE |DELETE FROM|DROP COLUMN|TRUNCATE/);
    for (const v of ['MAY', 'NOVEMBER', 'MARCH', 'JUNE', 'FEB_MARCH', 'MAY_JUNE', 'OCT_NOV']) expect(sql).toContain(`'${v}'`);
  });

  it('the server accepts only controlled values (or the stored one) and stores them structurally', () => {
    const ib = resolveTimeContextModel({ country: 'MX', programmeName: 'IB Diploma Programme' });
    const may27 = { kind: 'EXAM_SESSION' as const, series: 'MAY' as const, year: 2027 };
    expect(isAcceptedTimeContext(may27, ib, oct2026, null)).toBe(true);
    expect(isAcceptedTimeContext({ kind: 'EXAM_SESSION', series: 'JUNE', year: 2027 }, ib, oct2026, null)).toBe(false);
    expect(isAcceptedTimeContext({ kind: 'SCHOOL_YEAR', startYear: 2026, endYear: 2027 }, ib, oct2026, null)).toBe(false);
    expect(isAcceptedTimeContext({ kind: 'EXAM_SESSION', series: 'MAY', year: 2031 }, ib, oct2026, null)).toBe(false);
    const old = { kind: 'EXAM_SESSION' as const, series: 'MAY' as const, year: 2026 };
    expect(isAcceptedTimeContext(old, ib, oct2026, old)).toBe(true);
    expect(timeContextColumns(may27)).toEqual({ academicYearStart: null, academicYearEnd: null, examSeries: 'MAY', examYear: 2027 });
    const route = read('src/app/api/academic-profile/route.ts');
    expect(route).toMatch(/error: 'TIME_CONTEXT_INVALID' \}, \{ status: 400 \}/);
    expect(read('src/app/dashboard/profile/AcademicProfileWizard.tsx')).not.toMatch(/type="text" value=\{academicYear\}/);
  });

  it('existing saved values stay readable; unparseable legacy text is shown, never rewritten', () => {
    expect(storedTimeContext({ academicYear: '2026-27' })).toEqual({ kind: 'SCHOOL_YEAR', startYear: 2026, endYear: 2027 });
    expect(storedTimeContext({ academicYear: '2026/2027' })).toEqual({ kind: 'SCHOOL_YEAR', startYear: 2026, endYear: 2027 });
    expect(storedTimeContext({ academicYear: 'el que viene' })).toBeNull();
    expect(storedTimeContext({ academicYear: 'x', examSeries: 'NOVEMBER', examYear: 2027 })).toEqual({ kind: 'EXAM_SESSION', series: 'NOVEMBER', year: 2027 });
  });
});

// =================================================================== REM-T1-04 PROPAGATION
describe('REM-T1-04 Academic Profile propagation', () => {
  const profile = resolveProfileSubjects([
    { academicSubjectId: 'a1', name: 'Mathematics: analysis and approaches', level: 'HL' },
    { academicSubjectId: 'a2', name: 'Physics', level: 'HL' },
    { academicSubjectId: 'a3', name: 'Visual arts', level: 'HL' },
  ]);

  it('18. "For you" lists the Student\'s selected subjects first, with their exact variant -- not a generic IB list', () => {
    const s = suggestSubjects({
      profile: { curriculumType: 'ib', ibProgramme: 'DP', ibYear: 'DP2', schoolYear: '3° Preparatoria' },
      locale: 'en', examSubjectFocus: [], ownedSubjectNames: [],
      profileSubjects: profile.map((p) => ({ catalogKey: p.catalogKey, label: p.label, level: p.level })),
    });
    expect(s.map((x) => x.key)).toEqual(['mathematics', 'physics', 'visual_arts']);
    expect(s[0]).toMatchObject({ reason: 'PROFILE_SUBJECT', label: 'Mathematics: analysis and approaches · HL', level: 'HL' });
    expect(s.map((x) => x.key)).not.toContain('chemistry');
    expect(s.map((x) => x.key)).not.toContain('english');
  });

  it('19. a known subject level is reused (HL/SL never asked again); ambiguous levels are not guessed', () => {
    expect(knownSubjectLevels(profile)).toEqual({ mathematics: 'HL', physics: 'HL', visual_arts: 'HL' });
    expect(knownSubjectLevels(resolveProfileSubjects([
      { academicSubjectId: 'x', name: 'Mathematics: analysis and approaches', level: 'HL' },
      { academicSubjectId: 'y', name: 'Mathematics: applications and interpretation', level: 'SL' },
    ]))).toEqual({});
    expect(profileSubjectCatalogKey({ name: 'Pensamiento Matemático', canonicalName: 'Matemáticas' })).toBe('mathematics');
    const picker = read('src/app/dashboard/subjects/SubjectPicker.tsx');
    expect(picker).toMatch(/const ibLevel = explicitLevel \?\? \(askLevel \? undefined : knownLevels\[key\]\);/);
    const create = read('src/app/api/subjects/create/route.ts');
    expect(create).toMatch(/ibLevel: ibLevel \?\? knownLevel/);
  });

  it('20. Exam Prep shows the Student\'s profile subjects first, then "Explore all ... options"', () => {
    expect(isPersonalProfileSubject([{ code: 'CURRICULUM_SUBJECT', programme: 'IB Diploma Programme', subject: 'Physics' }])).toBe(true);
    expect(isPersonalProfileSubject([{ code: 'CURRICULUM', programme: 'IB Diploma Programme' }])).toBe(false);
    const l = { ...(getMessages('en') as Record<string, string>) };
    const obj = (key: string, label: string, yourSubject: boolean) => ({ key, framework: 'IB_DP', kind: 'SUBJECT_LEVEL' as const, label, context: { programme: 'IB DP', groups: [], subject: label, syllabusCode: null, level: 'HL', version: null }, status: 'canAdd', preparationId: null, searchText: label.toLowerCase(), recommended: true, reason: null, yourSubject });
    const html = renderToStaticMarkup(createElement(ObjectivePicker, {
      objectives: [obj('ib.dp.math_aa.hl', 'Mathematics AA HL', true), obj('ib.dp.chemistry.hl', 'Chemistry HL', false), obj('ib.dp.physics.hl', 'Physics HL', true)],
      frameworks: [{ key: 'IB_DP', region: 'INTL' }], suggested: ['IB_DP'], labels: l,
    }));
    expect(html).toContain('data-your-subjects');
    const mine = html.slice(html.indexOf('data-your-subjects'), html.indexOf('data-explore-all'));
    expect(mine).toContain('Mathematics AA HL');
    expect(mine).toContain('Physics HL');
    expect(mine).not.toContain('Chemistry HL');
    expect(html).toContain('Explore all');
  });

  it('21. the full catalog remains reachable everywhere', () => {
    expect(read('src/app/dashboard/subjects/SubjectPicker.tsx')).toMatch(/<details className="sp-all"/);
    expect(read('src/app/dashboard/exam-prep/ObjectivePicker.tsx')).toMatch(/data-explore-all/);
    expect(read('src/app/dashboard/exam-prep/PreparationChooser.tsx')).toMatch(/others/);
  });
});

// =================================================================== CLASS CONTEXT
describe('Class context is never merged into the personal profile', () => {
  it('22. a class curriculum reason is not a personal profile subject', () => {
    expect(isPersonalProfileSubject([{ code: 'CURRICULUM_SUBJECT', programme: 'Cambridge IGCSE', subject: 'Physics', className: '10A' }])).toBe(false);
  });
  it('23. the class still governs inside the class (institution reasons and class curricula untouched)', () => {
    expect(read('src/lib/exam-core/eligibility/rules.ts')).toMatch(/INSTITUTION_ASSIGNED/);
    const resolver = read('src/lib/student/student-context.server.ts');
    expect(resolver).not.toMatch(/class_enrollments|classes|institution/);
  });
  it('24. editing the personal profile never touches class membership', () => {
    for (const f of ['src/services/academic-profile-catalogue.service.ts', 'src/services/academic-profile.service.ts', 'src/app/api/academic-profile/route.ts', 'src/services/student-context.service.ts']) {
      expect(read(f), f).not.toMatch(/(INSERT INTO|UPDATE|DELETE FROM)\s+(class_enrollments|classes|institution)/i);
    }
  });
});

// =================================================================== REM-T1-07 LOCALIZATION
describe('REM-T1-07 localization of catalog values', () => {
  it('25/26/27. the interface language is a server-side preference: it survives refresh, navigation and re-login', async () => {
    h.dbQueryMock.mockResolvedValueOnce({ rows: [] });
    await setInterfaceLanguage('stu-1', 'en');
    expect(String(h.dbQueryMock.mock.calls[0][0])).toMatch(/INSERT INTO user_language_preferences/);
    for (const l of ['en', 'es'] as const) {
      h.dbQueryMock.mockResolvedValueOnce({ rows: [{ interface_language: l }] });
      expect(await getInterfaceLanguage('stu-1')).toBe(l);
    }
    expect(read('src/app/dashboard/layout.tsx')).toMatch(/getInterfaceLanguage\(studentId\)/);
  });

  it('28. subject names render in the locale where a translation exists; otherwise the official name', () => {
    expect(localizeSubjectName('Matemáticas', 'en')).toBe('Mathematics');
    expect(localizeSubjectName('Mathematics', 'es')).toBe('Matemáticas');
    expect(localizeSubjectName('Mathematics: analysis and approaches', 'es')).toBe('Mathematics: analysis and approaches');
    expect(localizeSubjectName('Física', 'de')).toBe('Physik');
    expect(read('src/app/dashboard/subjects/SubjectPicker.tsx')).toMatch(/localizeSubjectName\(o\.name, locale\)/);
  });

  it('29. grade and country labels render in the locale (canonical stored values unchanged)', () => {
    expect(gradeDisplayLabel('3° Preparatoria', 'en')).toBe('Preparatoria, year 3');
    expect(gradeDisplayLabel('3° Preparatoria', 'es')).toBe('3° Preparatoria');
    expect(gradeDisplayLabel('Grade 10', 'es')).toBe('10.º grado');
    expect(gradeDisplayLabel('Something custom', 'en')).toBe('Something custom');
    expect(countryDisplayName('US', 'es')).toBe('Estados Unidos');
    expect(countryDisplayName('DE', 'es')).toBe('Alemania');
    expect(countryDisplayName('DE', 'en')).toBe('Germany');
    expect(countryDisplayName('OTHER', 'es')).toBe('Otro');
    expect(countryDisplayName('MX', 'en')).toBe('Mexico');
  });

  it('30. switching locale never changes canonical IDs or profile data', () => {
    const before = '3° Preparatoria';
    for (const l of LOCALES) gradeDisplayLabel(before, l);
    expect(parseStoredGrade(before)).toEqual({ system: 'MX_PREPARATORIA', n: 3 });
    const ui = read('src/app/dashboard/profile/AcademicProfileWizard.tsx');
    // The wizard stores the canonical value (g / c.value), only the LABEL is localized.
    expect(ui).toMatch(/onClick=\{\(\) => setGrade\(g\)\}/);
    expect(ui).toMatch(/setCountry\(c\.value\)/);
    expect(canonicalTimeContextText({ kind: 'EXAM_SESSION', series: 'MAY', year: 2027 })).toBe('May 2027');
    expect(read('src/lib/i18n/catalog-labels.ts')).not.toMatch(/db\.query|UPDATE|INSERT/);
  });
});
