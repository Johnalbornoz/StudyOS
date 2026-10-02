/**
 * LX-2E -- learner shell navigation config. Organised by learner
 * intent; utilities separated; temporary mappings documented; every
 * label key must exist in every supported locale.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { buildLearnerNav, allNavHrefs } from '@/lib/lx/learner-navigation';
import { MESSAGES, LOCALES } from '@/lib/i18n/messages';

const nav = (over = {}) => buildLearnerNav({ isAdmin: false, debtCount: 0, notifCount: 0, ...over });

describe('LX-2E buildLearnerNav', () => {
  it('UX-5 closure: primary group is exactly Inicio / Aprender / Progreso, in that order; Assignments joins it only while work is pending', () => {
    const primary = nav().find((g) => g.kind === 'PRIMARY')!;
    expect(primary.items.map((i) => i.key)).toEqual(['today', 'learn', 'progress']);
    expect(primary.items.map((i) => i.href)).toEqual(['/dashboard/today', '/dashboard/learn', '/dashboard']);
    expect(primary.items.map((i) => i.labelKey)).toEqual(['nav.home', 'nav.learn', 'nav.progress']);
    // Aprender owns Mi ruta / Tu conocimiento / Materias as detail routes (highlighted, never removed)
    expect(primary.items.find((i) => i.key === 'learn')!.activePrefixes).toEqual(['/dashboard/path', '/dashboard/knowledge', '/dashboard/subjects']);
    const withWork = nav({ assignmentCount: 2 }).find((g) => g.kind === 'PRIMARY')!;
    expect(withWork.items.map((i) => i.key)).toEqual(['today', 'learn', 'progress', 'assignments']);
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

  it('UX-2/UX-5: no capability was removed -- every destination stays reachable (nav or Aprender-owned detail route)', () => {
    const inNav = [
      '/dashboard/today', '/dashboard', '/dashboard/exam-prep', '/dashboard/assignments',
      '/dashboard/study-plan', '/dashboard/learning-debt', '/dashboard/tutor',
      '/dashboard/notifications', '/dashboard/profile', '/dashboard/parent', '/dashboard/billing', '/dashboard/learn',
    ];
    for (const assignmentCount of [0, 1]) {
      const groups = nav({ assignmentCount });
      const hrefs = allNavHrefs(groups);
      for (const h of inNav) expect(hrefs, h).toContain(h);
      const owned = groups.flatMap((g) => g.items).flatMap((i) => i.activePrefixes ?? []);
      for (const h of ['/dashboard/path', '/dashboard/knowledge', '/dashboard/subjects']) expect(owned, h).toContain(h);
    }
    // the detail routes themselves still exist
    for (const f of ['src/app/dashboard/path/page.tsx', 'src/app/dashboard/knowledge/page.tsx', 'src/app/dashboard/subjects/page.tsx']) {
      expect(existsSync(join(process.cwd(), f)), f).toBe(true);
    }
  });

  it('UX-5 closure: exactly three bottom-tab destinations (Inicio / Aprender / Progreso), all primary', () => {
    const groups = nav({ assignmentCount: 4 });
    const tabs = groups.flatMap((g) => g.items.filter((i) => i.mobileTab).map((i) => ({ key: i.key, kind: g.kind })));
    expect(tabs).toEqual([
      { key: 'today', kind: 'PRIMARY' },
      { key: 'learn', kind: 'PRIMARY' },
      { key: 'progress', kind: 'PRIMARY' },
    ]);
  });

  it('LX-7: no temporary stand-in mapping remains in the nav', () => {
    expect(nav().flatMap((g) => g.items).every((i) => i.temporaryMappingNote === undefined)).toBe(true);
  });

  it('secondary group ("Más") holds Tutor, My plan (Track A learning plan), Exam Prep, assignments without pending work, study plan, learning debt', () => {
    const secondary = nav().find((g) => g.kind === 'SECONDARY')!;
    expect(secondary.items.map((i) => i.key)).toEqual(['tutor', 'myPlan', 'examPrep', 'assignments', 'studyPlan', 'debt']);
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
