/**
 * L12 / UX-1 -- pages reachable without a session: the marketing site in
 * Spanish and English, sign-in and sign-up. Runs at every viewport.
 */
import { expect, test } from '@playwright/test';
import { expectDocumentLanguage, expectNavigationControlsNamed, expectNoAccessibilityViolations, expectNoHorizontalOverflow, openPage } from './support/audit';
import { coversKnownFinding } from './support/known-findings';

/** `lang`: the language the page is written in, when the route fixes it. */
const PUBLIC_PAGES: Array<{ path: string; lang?: string }> = [
  { path: '/es', lang: 'es' },
  { path: '/es/how-it-works', lang: 'es' },
  { path: '/en', lang: 'en' },
  { path: '/en/how-it-works', lang: 'en' },
  { path: '/de', lang: 'de' },
  { path: '/sign-in' },
  { path: '/sign-up' },
];

for (const { path, lang } of PUBLIC_PAGES) {
  test.describe(`public ${path}`, () => {
    test.beforeEach(async ({ page }) => {
      await openPage(page, path);
    });

    test('has no critical accessibility violations', async ({ page }) => {
      await expectNoAccessibilityViolations(page, 'public');
    });

    test('does not overflow horizontally', async ({ page }) => {
      await expectNoHorizontalOverflow(page);
    });

    test('navigation controls have accessible names', async ({ page }) => {
      coversKnownFinding('KF-L12-02');
      await expectNavigationControlsNamed(page);
    });

    if (lang) {
      test(`declares its language on <html> (${lang})`, async ({ page }) => {
        coversKnownFinding('KF-L12-01');
        await expectDocumentLanguage(page, lang);
      });

      // What a crawler or a reader without JavaScript receives.
      test(`serves <html lang="${lang}"> in the initial HTML`, async ({ request }) => {
        coversKnownFinding('KF-L12-01');
        const html = await (await request.get(path)).text();
        expect(html.match(/<html[^>]*\slang="([^"]*)"/)?.[1]).toBe(lang);
      });
    } else {
      test('declares a language on <html>', async ({ page }) => {
        await expect(page.locator('html')).toHaveAttribute('lang', /^[a-z]{2}/i);
      });
    }
  });
}

test('a protected page sends a visitor to sign-in with a return URL', async ({ page }) => {
  await page.goto('/dashboard/today');
  await expect(page).toHaveURL(/\/sign-in\?redirect_url=/);
  expect(new URL(page.url()).searchParams.get('redirect_url')).toBe('/dashboard/today');
});
