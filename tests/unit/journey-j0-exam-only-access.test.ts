/**
 * Student Exam Journey V2 -- J0 (G-01): the Independent Exam Student reaches
 * Exam Preparation without any subject, and no combination of
 * (academic profile, subjects, exam targets) produces a redirect loop between
 * the proxy gate, the first destination and the onboarding bounce.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const h = vi.hoisted(() => ({ dbQueryMock: vi.fn(), authMock: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => h.dbQueryMock(...a) } }));
vi.mock('@clerk/nextjs/server', () => ({
  clerkMiddleware: (handler: any) => (request: any) => handler(() => h.authMock(), request),
}));

import {
  decideStudentOnboardingGate,
  studentOnboardingStage,
  EXAM_PREPARATION_PATH,
  VALID_EXAM_TARGET_PREDICATE,
  type AcademicProfileFields,
  type GateState,
} from '@/lib/student/onboarding-gate';
import { loadGateState } from '@/lib/student/onboarding-gate.server';
import { resolveFirstDestination, onboardingRouteRedirect } from '@/lib/lx/first-destination';
import proxy from '@/proxy';
import { NextRequest } from 'next/server';

const ROOT = join(__dirname, '..', '..');
const COMPLETE: AcademicProfileFields = {
  profileCompleted: true, countryOfStudy: 'co', schoolYear: '10', curriculumType: 'national',
  ibProgramme: null, ibYear: null, academicYear: '2026',
};
const student = (over: Partial<GateState> = {}): GateState => ({ accountStatus: 'ACTIVE', roles: ['STUDENT'], storedWorkspace: 'STUDENT', profile: null, subjectCount: 0, ...over });

beforeEach(() => {
  h.dbQueryMock.mockReset();
  h.authMock.mockReset();
});

describe('J0 -- Independent Exam Student reaches Exam Prep without subjects', () => {
  it('a valid exam target alone makes the Student READY (no subject, no school profile)', () => {
    expect(studentOnboardingStage(null, 0, 1)).toBe('READY');
    expect(studentOnboardingStage(COMPLETE, 0, 1)).toBe('READY');
    const paa = student({ profile: null, subjectCount: 0, examTargetCount: 1 });
    for (const path of ['/dashboard/exam-prep', '/dashboard/exam-prep/prof-1', '/dashboard/exam-prep/attempt/a-1', '/dashboard/exams', '/dashboard/today']) {
      expect(decideStudentOnboardingGate(path, paa)).toBeNull();
    }
  });

  it('the exam-preparation intent stays reachable while the first subject is pending (the target can be created)', () => {
    const s = student({ profile: COMPLETE, subjectCount: 0, examTargetCount: 0 });
    expect(decideStudentOnboardingGate(EXAM_PREPARATION_PATH, s)).toBeNull();
    // every other Student page still continues the onboarding: nothing else is opened up
    expect(decideStudentOnboardingGate('/dashboard/today', s)).toBe('/dashboard/onboarding');
    expect(decideStudentOnboardingGate('/dashboard/exams', s)).toBe('/dashboard/onboarding');
    expect(decideStudentOnboardingGate('/dashboard/exam-preparation-fake', s)).toBe('/dashboard/onboarding');
  });

  it('a gate state without examTargetCount (pre-J0 callers) behaves as zero targets', () => {
    expect(decideStudentOnboardingGate('/dashboard/today', student({ profile: COMPLETE, subjectCount: 0 }))).toBe('/dashboard/onboarding');
    expect(studentOnboardingStage(COMPLETE, 0)).toBe('FIRST_SUBJECT');
  });
});

describe('J0 -- non-regression of the existing flows', () => {
  it('learning-only Student: profile -> first subject -> ready, exactly as before', () => {
    expect(decideStudentOnboardingGate('/dashboard/today', student())).toBe('/dashboard/profile');
    expect(decideStudentOnboardingGate('/dashboard/today', student({ profile: COMPLETE }))).toBe('/dashboard/onboarding');
    expect(decideStudentOnboardingGate('/dashboard/today', student({ profile: COMPLETE, subjectCount: 1 }))).toBeNull();
  });

  it('without a target and without a profile, Exam Prep is NOT opened (the academic profile step is unchanged)', () => {
    expect(decideStudentOnboardingGate(EXAM_PREPARATION_PATH, student())).toBe('/dashboard/profile');
  });

  it('institution Student (profile + subjects, with or without an assigned target) is unaffected', () => {
    for (const examTargetCount of [0, 1]) {
      const s = student({ profile: COMPLETE, subjectCount: 3, examTargetCount });
      for (const path of ['/dashboard', '/dashboard/today', '/dashboard/exam-prep', '/dashboard/notifications']) expect(decideStudentOnboardingGate(path, s)).toBeNull();
    }
  });

  it('non-Student workspaces are never gated, whatever the targets', () => {
    expect(decideStudentOnboardingGate('/dashboard', student({ roles: ['PARENT'], storedWorkspace: 'PARENT', examTargetCount: 0 }))).toBeNull();
  });
});

// ------------------------------------------------------------------ loop freedom
/**
 * The three redirect sources a Student can hit, composed exactly as the app runs them:
 *   "/"                     -> app/page.tsx: resolveFirstDestination (never gated itself)
 *   any /dashboard/* page   -> proxy gate first; if it lets the request through, the page
 *   /dashboard/onboarding   -> then onboardingRouteRedirect
 */
function nextHop(path: string, s: { profile: AcademicProfileFields | null; subjects: number; targets: number }): string | null {
  const facts = { hasSubject: s.subjects > 0, hasExamGoal: s.targets > 0 };
  if (path === '/') return resolveFirstDestination(facts).path;
  const gate = decideStudentOnboardingGate(path, student({ profile: s.profile, subjectCount: s.subjects, examTargetCount: s.targets }));
  if (gate && gate !== path) return gate;
  if (path === '/dashboard/onboarding') return onboardingRouteRedirect(facts);
  return null;
}

function settle(start: string, s: Parameters<typeof nextHop>[1]): { final: string; hops: string[] } {
  const hops = [start];
  let path = start;
  for (let i = 0; i < 10; i++) {
    const next = nextHop(path, s);
    if (!next || next === path) return { final: path, hops };
    if (hops.includes(next)) throw new Error(`redirect loop: ${[...hops, next].join(' -> ')}`);
    hops.push(next);
    path = next;
  }
  throw new Error(`no settlement: ${hops.join(' -> ')}`);
}

describe('J0 -- no redirect loop for any (profile, subjects, targets) combination', () => {
  const profiles = [null, { ...COMPLETE, profileCompleted: false }, COMPLETE];
  const starts = ['/', '/dashboard', '/dashboard/today', '/dashboard/onboarding', '/dashboard/exam-prep', '/dashboard/exam-prep/prof-1', '/dashboard/profile', '/dashboard/subjects/new'];

  it('every start path settles in at most a few hops', () => {
    for (const profile of profiles) for (const subjects of [0, 1]) for (const targets of [0, 1]) for (const start of starts) {
      expect(() => settle(start, { profile, subjects, targets })).not.toThrow();
    }
  });

  it('exam target + no subject (with or without a school profile): "/" lands in Exam Prep, and onboarding bounces there too', () => {
    for (const profile of profiles) {
      expect(settle('/', { profile, subjects: 0, targets: 1 }).final).toBe('/dashboard/exam-prep');
      expect(settle('/dashboard/onboarding', { profile, subjects: 0, targets: 1 }).final).toBe('/dashboard/exam-prep');
    }
  });

  it('the onboarding exam intent (profile complete, nothing else yet) reaches Exam Prep instead of bouncing back', () => {
    expect(settle('/dashboard/exam-prep', { profile: COMPLETE, subjects: 0, targets: 0 }).final).toBe('/dashboard/exam-prep');
  });
});

// ------------------------------------------------------------------ server loader + proxy
describe('J0 -- gate state loader and proxy', () => {
  const req = (path: string) => new NextRequest(new URL(path, 'https://dev.example.test'));

  it('the loader counts valid exam targets in the same single read-only SELECT, with the shared predicate', async () => {
    h.dbQueryMock.mockResolvedValue({ rows: [{ status: 'ACTIVE', active_workspace: 'STUDENT', roles: ['STUDENT'], profile_completed: null, subject_count: 0, exam_target_count: 2 }] });
    const state = await loadGateState('clerk_1');
    expect(h.dbQueryMock).toHaveBeenCalledTimes(1);
    const sql: string = h.dbQueryMock.mock.calls[0][0];
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
    expect(sql).toContain(`FROM student_exam_profiles ep WHERE ep.student_id = s.id AND ep.${VALID_EXAM_TARGET_PREDICATE}`);
    expect(state).toMatchObject({ profile: null, subjectCount: 0, examTargetCount: 2 });
  });

  it('proxy: a Student with only an exam target opens Exam Prep (no redirect)', async () => {
    h.authMock.mockResolvedValue({ userId: 'clerk_1' });
    h.dbQueryMock.mockResolvedValue({ rows: [{ status: 'ACTIVE', active_workspace: 'STUDENT', roles: ['STUDENT'], profile_completed: null, subject_count: 0, exam_target_count: 1 }] });
    const res: any = await (proxy as any)(req('/dashboard/exam-prep'));
    expect(res.headers.get('location')).toBeNull();
  });

  it('proxy: without targets and subjects the pre-J0 redirect stays (profile first)', async () => {
    h.authMock.mockResolvedValue({ userId: 'clerk_1' });
    h.dbQueryMock.mockResolvedValue({ rows: [{ status: 'ACTIVE', active_workspace: 'STUDENT', roles: ['STUDENT'], profile_completed: null, subject_count: 0, exam_target_count: 0 }] });
    const res: any = await (proxy as any)(req('/dashboard/exam-prep'));
    expect(res.headers.get('location')).toBe('https://dev.example.test/dashboard/profile');
  });

  it('the first destination and the onboarding bounce use the SAME valid-target predicate as the gate', () => {
    for (const file of ['src/app/page.tsx', 'src/app/dashboard/onboarding/page.tsx']) {
      const src = readFileSync(join(ROOT, file), 'utf-8');
      expect(src).toContain('VALID_EXAM_TARGET_PREDICATE');
      expect(src).not.toMatch(/student_exam_profiles WHERE student_id = \$1 AND status <> 'ARCHIVED'/);
    }
  });

  it('J0 never creates subjects: the gate module and loader perform no writes', () => {
    for (const file of ['src/lib/student/onboarding-gate.ts', 'src/lib/student/onboarding-gate.server.ts']) {
      const src = readFileSync(join(ROOT, file), 'utf-8');
      expect(src).not.toMatch(/\b(INSERT|UPDATE|DELETE)\s/);
    }
  });
});
