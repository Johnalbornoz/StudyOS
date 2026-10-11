/**
 * L6 ST-4 -- one plan surface in the Student navigation.
 *
 * Before: "Mi plan" (/dashboard/plan) and "Plan de estudio"
 * (/dashboard/study-plan) sat in the same nav group. Now /dashboard/plan is
 * the only entry; the 14-day schedule is its "schedule" tab and the old URL
 * redirects to it. No schedule action was dropped.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { buildLearnerNav, allNavHrefs } from '@/lib/lx/learner-navigation';

const h = vi.hoisted(() => ({ redirect: null as any }));
vi.mock('next/navigation', () => ({ redirect: (...a: any[]) => h.redirect(...a) }));

const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf-8');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const variants = [
  { isAdmin: false, debtCount: 0, notifCount: 0 },
  { isAdmin: true, debtCount: 2, notifCount: 3, assignmentCount: 4 },
  { isAdmin: false, debtCount: 0, notifCount: 0, examPrepPrimary: true },
];

describe('Student navigation', () => {
  it('shows exactly one plan entry, pointing at /dashboard/plan, in every nav variant', () => {
    for (const inputs of variants) {
      const items = buildLearnerNav(inputs).flatMap((g) => g.items);
      const planItems = items.filter((i) => /^\/dashboard\/(plan|study-plan)(\/|\?|$)/.test(i.href));
      expect(planItems.map((i) => [i.key, i.href])).toEqual([['myPlan', '/dashboard/plan']]);
      expect(allNavHrefs(buildLearnerNav(inputs))).not.toContain('/dashboard/study-plan');
      expect(items.some((i) => i.key === 'studyPlan')).toBe(false);
    }
  });

  it('no href is listed twice', () => {
    for (const inputs of variants) {
      const hrefs = allNavHrefs(buildLearnerNav(inputs));
      expect(new Set(hrefs).size).toBe(hrefs.length);
    }
  });
});

describe('/dashboard/study-plan', () => {
  it('redirects to the schedule tab of /dashboard/plan and renders nothing of its own', async () => {
    h.redirect = vi.fn(() => { throw new Error('NEXT_REDIRECT'); });
    const { default: StudyPlanRedirect } = await import('@/app/dashboard/study-plan/page');
    expect(() => StudyPlanRedirect()).toThrow('NEXT_REDIRECT');
    expect(h.redirect).toHaveBeenCalledWith('/dashboard/plan?tab=schedule');
    const code = stripComments(read('src/app/dashboard/study-plan/page.tsx'));
    expect(code).not.toMatch(/use client|fetch\(/);
  });
});

describe('/dashboard/plan carries the schedule', () => {
  const page = read('src/app/dashboard/plan/page.tsx');
  const panel = read('src/app/dashboard/plan/SchedulePanel.tsx');

  it('"schedule" is a tab of the plan page and renders the schedule panel', () => {
    expect(page).toMatch(/const TABS: Tab\[\] = \['plan', 'schedule', 'explore', 'recommended', 'exam'\]/);
    expect(page).toMatch(/\{tab === 'schedule' && <SchedulePanel \/>\}/);
    expect(existsSync(join(process.cwd(), 'src/app/dashboard/plan/SchedulePanel.tsx'))).toBe(true);
  });

  it('an unknown tab still falls back to "plan"', () => {
    expect(page).toMatch(/TABS\.includes\(sp\.tab as Tab\) \? \(sp\.tab as Tab\) : 'plan'/);
  });

  it('every schedule action the old page offered is still there', () => {
    for (const endpoint of [
      '/api/learning/plan?studentId=',
      '/api/learning/plan/rebuild',
      '/launch',
      '/reschedule',
      '/skip',
      '/api/learning/plan/extra-practice',
      '/api/learning/capacity',
      '/api/learning/timezone',
    ]) {
      expect(panel, endpoint).toContain(endpoint);
    }
  });

  it('the panel does not add a second page heading', () => {
    expect(panel).not.toMatch(/<h1[ >]/);
  });

  it('Today links straight to the schedule tab, not through the redirect', () => {
    const today = read('src/app/dashboard/today/page.tsx');
    expect(today).toContain('href="/dashboard/plan?tab=schedule"');
    expect(today).not.toContain('/dashboard/study-plan');
  });

  it('no Student page links to the old URL any more', () => {
    for (const f of ['src/app/dashboard/plan/page.tsx', 'src/app/dashboard/plan/SchedulePanel.tsx', 'src/app/dashboard/today/page.tsx']) {
      expect(stripComments(read(f)), f).not.toContain('/dashboard/study-plan');
    }
  });
});
