/**
 * LX-2E -- learner shell navigation config. Organised by learner
 * intent; utilities separated; temporary mappings documented; every
 * label key must exist in every supported locale.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildLearnerNav, allNavHrefs } from '@/lib/lx/learner-navigation';
import { MESSAGES, LOCALES } from '@/lib/i18n/messages';

const nav = (over = {}) => buildLearnerNav({ isAdmin: false, debtCount: 0, notifCount: 0, ...over });

describe('LX-2E buildLearnerNav', () => {
  it('UX-2/UX-4: primary group is exactly Today / My Path / Progress / Knowledge / Exam Prep, in that order; Assignments joins it only while work is pending', () => {
    const primary = nav().find((g) => g.kind === 'PRIMARY')!;
    expect(primary.items.map((i) => i.key)).toEqual(['today', 'myPath', 'progress', 'knowledge', 'examPrep']);
    expect(primary.items.map((i) => i.href)).toEqual(['/dashboard/today', '/dashboard/path', '/dashboard', '/dashboard/knowledge', '/dashboard/exam-prep']);
    // UX-4: Knowledge is not a mobile tab (phones: "Más" + links from Progreso / Mi ruta)
    expect(primary.items.find((i) => i.key === 'knowledge')!.mobileTab).toBeFalsy();
    const withWork = nav({ assignmentCount: 2 }).find((g) => g.kind === 'PRIMARY')!;
    expect(withWork.items.map((i) => i.key)).toEqual(['today', 'myPath', 'progress', 'knowledge', 'examPrep', 'assignments']);
    expect(withWork.items.find((i) => i.key === 'assignments')!.badge).toBe(2);
  });

  it('UX-2: Assignments is always reachable -- in PRIMARY with pending work, otherwise under "Más" -- and never listed twice', () => {
    for (const assignmentCount of [0, 3]) {
      const all = nav({ assignmentCount }).flatMap((g) => g.items).filter((i) => i.key === 'assignments');
      expect(all).toHaveLength(1);
      expect(all[0].href).toBe('/dashboard/assignments');
    }
    expect(nav().find((g) => g.kind === 'SECONDARY')!.items.some((i) => i.key === 'assignments')).toBe(true);
    expect(nav({ assignmentCount: 3 }).find((g) => g.kind === 'SECONDARY')!.items.some((i) => i.key === 'assignments')).toBe(false);
  });

  it('UX-2: no capability was removed -- every pre-UX-2 destination is still in the nav, plus Materias', () => {
    const before = [
      '/dashboard/today', '/dashboard/path', '/dashboard', '/dashboard/exam-prep', '/dashboard/assignments',
      '/dashboard/study-plan', '/dashboard/learning-debt', '/dashboard/tutor',
      '/dashboard/notifications', '/dashboard/profile', '/dashboard/parent', '/dashboard/billing',
    ];
    for (const assignmentCount of [0, 1]) {
      const hrefs = allNavHrefs(nav({ assignmentCount }));
      for (const h of before) expect(hrefs, h).toContain(h);
      expect(hrefs).toContain('/dashboard/subjects');
    }
  });

  it('UX-2: exactly three bottom-tab destinations (Hoy / Mi ruta / Progreso), all primary', () => {
    const groups = nav({ assignmentCount: 4 });
    const tabs = groups.flatMap((g) => g.items.filter((i) => i.mobileTab).map((i) => ({ key: i.key, kind: g.kind })));
    expect(tabs).toEqual([
      { key: 'today', kind: 'PRIMARY' },
      { key: 'myPath', kind: 'PRIMARY' },
      { key: 'progress', kind: 'PRIMARY' },
    ]);
  });

  it('LX-7: My Path now has its own real implementation -- no temporary stand-in mapping remains', () => {
    const myPath = nav().find((g) => g.kind === 'PRIMARY')!.items.find((i) => i.key === 'myPath')!;
    expect(myPath.temporaryMappingNote).toBeUndefined();
    expect(myPath.href).toBe('/dashboard/path');
  });

  it('secondary group is useful-not-primary (subjects, assignments without pending work, study plan, learning debt, tutor)', () => {
    const secondary = nav().find((g) => g.kind === 'SECONDARY')!;
    expect(secondary.items.map((i) => i.key)).toEqual(['subjects', 'assignments', 'studyPlan', 'debt', 'tutor']);
  });

  it('utility group holds account/profile/system; admin only when isAdmin', () => {
    expect(nav().find((g) => g.kind === 'UTILITY')!.items.some((i) => i.key === 'admin')).toBe(false);
    expect(nav({ isAdmin: true }).find((g) => g.kind === 'UTILITY')!.items.some((i) => i.key === 'admin')).toBe(true);
    const util = nav().find((g) => g.kind === 'UTILITY')!;
    expect(util.items.map((i) => i.key)).toEqual(['notifications', 'profile', 'parent', 'billing']);
  });

  it('badges flow through only where provided', () => {
    const g = buildLearnerNav({ isAdmin: false, debtCount: 3, notifCount: 5 });
    const debt = g.flatMap((x) => x.items).find((i) => i.key === 'debt')!;
    const notif = g.flatMap((x) => x.items).find((i) => i.key === 'notifications')!;
    expect(debt.badge).toBe(3);
    expect(notif.badge).toBe(5);
  });

  it('every href is under /dashboard and there are no duplicates', () => {
    const hrefs = allNavHrefs(nav({ isAdmin: true }));
    expect(hrefs.every((h) => h.startsWith('/dashboard'))).toBe(true);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it('every labelKey resolves in every supported locale', () => {
    const keys = new Set<string>();
    for (const g of nav({ isAdmin: true })) {
      if (g.titleKey) keys.add(g.titleKey);
      for (const i of g.items) keys.add(i.labelKey);
    }
    for (const loc of LOCALES) {
      for (const k of keys) {
        expect(MESSAGES[loc][k as keyof (typeof MESSAGES)[typeof loc]], `${loc}:${k}`).toBeTruthy();
      }
    }
  });
});

describe('LX-2 i18n -- new entry-experience keys present in all locales', () => {
  const src = readFileSync(join(process.cwd(), 'src/lib/i18n/messages.ts'), 'utf-8');
  const NEW_KEYS = [
    'marketing.stagesTitle', 'marketing.stageLearnName', 'marketing.stageProveName', 'marketing.stageTransferName',
    'howItWorks.step5Title', 'howItWorks.step5Body',
    'signup.framingTitle', 'signup.framingBody', 'signup.next',
    'onboarding2.title', 'onboarding2.whatTitle', 'onboarding2.needTitle', 'onboarding2.nextTitle', 'onboarding2.cta', 'onboarding2.laterProfile',
    'nav.myPath', 'nav.progress', 'nav.groupMore', 'nav.menu', 'nav.closeMenu',
  ];
  it('each new key appears once per locale (5 total)', () => {
    for (const k of NEW_KEYS) {
      const n = src.split(`'${k}':`).length - 1;
      expect(n, k).toBe(LOCALES.length);
    }
  });
  it('the false "adjusts difficulty" claim is gone from marketing copy', () => {
    // LX-1R: difficulty selection is UNRESOLVED until LX-4; homepage must not promise it
    const marketingBlock = src.match(/'marketing\.section4Body':[^\n]*/g) ?? [];
    for (const line of marketingBlock) {
      expect(line.toLowerCase()).not.toMatch(/adjust\w* (the )?difficulty|ajusta\w* .*dificultad|passt .*schwierigkeit|ajuste.*difficult|ajusta.*dificuldade/);
    }
  });
});
