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
  it('primary group is exactly Today / My Path / Progress, in that order', () => {
    const primary = nav().find((g) => g.kind === 'PRIMARY')!;
    expect(primary.items.map((i) => i.key)).toEqual(['today', 'myPath', 'progress']);
    expect(primary.items.map((i) => i.href)).toEqual(['/dashboard/today', '/dashboard/subjects', '/dashboard']);
  });

  it('My Path carries a documented temporary mapping to the existing Subjects experience', () => {
    const myPath = nav().find((g) => g.kind === 'PRIMARY')!.items.find((i) => i.key === 'myPath')!;
    expect(myPath.temporaryMappingNote).toMatch(/LX-7|Subjects/);
  });

  it('secondary group is useful-not-primary (study plan, learning debt, tutor)', () => {
    const secondary = nav().find((g) => g.kind === 'SECONDARY')!;
    expect(secondary.items.map((i) => i.key).sort()).toEqual(['debt', 'studyPlan', 'tutor']);
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
    // /dashboard/subjects appears once (My Path); a separate Subjects item was folded in
    expect(hrefs.filter((h) => h === '/dashboard/subjects').length).toBe(1);
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
