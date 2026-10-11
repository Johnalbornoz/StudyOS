/**
 * L12 / UX-1 -- one smoke path per profile (Student, Parent, Teacher,
 * Institution): the workspace home, plus any E2E_<ROLE>_PATHS, at every
 * viewport. Needs a session per role (auth.setup.ts); without one the
 * suite reports NOT_RUN, it does not pass.
 */
import { expect, test, type Page } from '@playwright/test';
import {
  expectDocumentLanguage,
  expectNavigationControlsNamed,
  expectNoAccessibilityViolations,
  expectNoHorizontalOverflow,
  openPage,
  shellLanguage,
} from './support/audit';
import { coversKnownFinding } from './support/known-findings';
import { roleSession } from './support/session';
import { COMPACT_NAV_MAX_WIDTH, ROLES, ROLE_DEFAULTS, primaryLanguage, rolePaths } from './support/target';

const isCompact = (page: Page) => (page.viewportSize()?.width ?? 0) <= COMPACT_NAV_MAX_WIDTH;

for (const role of ROLES) {
  test.describe(`${role} workspace`, () => {
    // Resolved lazily in the worker: the session file is written by the setup project.
    test.use({
      storageState: async ({}, use) => {
        const session = roleSession(role);
        await use('path' in session ? session.path : undefined);
      },
    });

    test.beforeEach(() => {
      const session = roleSession(role);
      test.skip('skip' in session, 'skip' in session ? session.skip : '');
    });

    test('lands in its own workspace', async ({ page }) => {
      const home = ROLE_DEFAULTS[role].home;
      await openPage(page, home);
      expect(new URL(page.url()).pathname, `${role} was sent away from ${home}`).toMatch(new RegExp(`^${home}(/|$)`));
      await expect(page.locator('main').first()).toBeVisible();
    });

    for (const path of rolePaths(role, process.env)) {
      test.describe(path, () => {
        test.beforeEach(async ({ page }) => {
          await openPage(page, path);
        });

        test('has no critical accessibility violations', async ({ page }) => {
          await expectNoAccessibilityViolations(page);
        });

        test('does not overflow horizontally', async ({ page }) => {
          await expectNoHorizontalOverflow(page);
        });

        test('declares the workspace language on <html>', async ({ page }) => {
          const lang = await shellLanguage(page);
          coversKnownFinding('KF-L12-01', primaryLanguage(lang) !== 'en');
          await expectDocumentLanguage(page, lang);
        });

        test('navigation controls have accessible names', async ({ page }) => {
          coversKnownFinding('KF-L12-02');
          await expectNavigationControlsNamed(page);
        });
      });
    }

    test('navigation matches the viewport and every control in it is named', async ({ page }) => {
      coversKnownFinding('KF-L12-02');
      await openPage(page, ROLE_DEFAULTS[role].home);

      if (!isCompact(page)) {
        await expect(page.locator('.lx-sidebar')).toBeVisible();
        await expect(page.locator('.lx-topbar')).toBeHidden();
        await expectNavigationControlsNamed(page, page.locator('.lx-sidebar'));
        return;
      }

      // Collapsed navigation: the sidebar gives way to the top bar (and a tab bar where the workspace has one).
      await expect(page.locator('.lx-sidebar')).toBeHidden();
      await expect(page.locator('.lx-topbar')).toBeVisible();
      await expectNavigationControlsNamed(page, page.locator('.lx-topbar'));
      const tabBar = page.locator('.lx-tabbar');
      if (await tabBar.isVisible()) await expectNavigationControlsNamed(page, tabBar);

      // The full menu is one tap away, as a named dialog whose controls are all named.
      const trigger = page.locator('button[aria-controls="lx-drawer"]').first();
      await expect(trigger).toBeVisible();
      await expect(trigger).toHaveAccessibleName(/\S/);
      await trigger.click();
      const drawer = page.getByRole('dialog');
      await expect(drawer).toBeVisible();
      await expect(drawer).toHaveAccessibleName(/\S/);
      await expectNavigationControlsNamed(page, drawer);
      await expectNoHorizontalOverflow(page);
    });
  });
}
