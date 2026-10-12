/**
 * The harness's own `test`: Playwright's, plus two things every spec needs.
 *
 * 1. Deployment Protection bypass. When E2E_VERCEL_BYPASS_SECRET is set (see
 *    target.ts), the bypass header is added to requests to the TARGET ORIGIN
 *    only -- never to Clerk, fonts or any other host a page loads -- and to
 *    the API `request` fixture, which then follows no redirect (a redirect
 *    could carry the header to another origin). The secret is never logged.
 *
 * 2. No silent audit of Vercel's login page. A target behind Deployment
 *    Protection answers every path, public ones included, with a redirect to
 *    vercel.com. Without this check a run "passes" most assertions against
 *    that page. Any test whose browser is sent to a Vercel protection host
 *    fails, saying why.
 */
import { test as base, expect } from '@playwright/test';
import { VERCEL_BYPASS_ENV, isVercelProtectionHost, protectionBypass } from './target';

export const test = base.extend<{ protectionGuard: void }>({
  context: async ({ context, baseURL }, use) => {
    const bypass = baseURL ? protectionBypass(process.env, baseURL) : null;
    if (bypass) {
      await context.route(`${bypass.origin}/**`, async (route) => {
        await route.continue({ headers: { ...route.request().headers(), ...bypass.headers } });
      });
    }
    await use(context);
  },

  request: async ({ playwright, baseURL }, use) => {
    const bypass = baseURL ? protectionBypass(process.env, baseURL) : null;
    const api = await playwright.request.newContext(bypass ? { baseURL, extraHTTPHeaders: bypass.headers, maxRedirects: 0 } : { baseURL });
    await use(api);
    await api.dispose();
  },

  protectionGuard: [
    async ({ page }, use) => {
      const intercepted: string[] = [];
      page.on('framenavigated', (frame) => {
        if (frame !== page.mainFrame()) return;
        try {
          const host = new URL(frame.url()).hostname;
          if (isVercelProtectionHost(host)) intercepted.push(host);
        } catch {
          // about:blank and similar
        }
      });
      await use();
      expect(
        intercepted,
        `the browser was sent to ${intercepted[0]}: the target is behind Vercel Deployment Protection, so this test did not see the application. Set ${VERCEL_BYPASS_ENV}.`
      ).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
