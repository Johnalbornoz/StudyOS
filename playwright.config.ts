/**
 * L12 / UX-1 -- browser and accessibility harness (tests/e2e).
 *
 *   npm run test:browser            known Stage findings reported as expected failures
 *   npm run test:browser:certify    nothing excused
 *
 * One project per viewport (mobile 375, tablet 768, desktop 1280), each
 * running the public suite and the four role suites. See tests/e2e/README.md.
 */
import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';
import { LOCAL_PORT, VIEWPORTS, protectionBypass, resolveBaseUrl, type ViewportName } from './tests/e2e/support/target';

const envFile = process.env.E2E_ENV_FILE;
if (envFile) {
  if (!existsSync(envFile)) throw new Error(`E2E_ENV_FILE not found: ${envFile}`);
  process.loadEnvFile(envFile);
}

const { baseUrl, managedServer } = resolveBaseUrl(process.env);
const OUTPUT = 'tests/e2e/.output';
// A trace stores every request header. With the protection bypass active that would write the secret to disk.
const bypassActive = protectionBypass(process.env, baseUrl) !== null;

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: `${OUTPUT}/artifacts`,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [
    ['list'],
    ['json', { outputFile: `${OUTPUT}/results.json` }],
    ['html', { outputFolder: `${OUTPUT}/html`, open: 'never' }],
  ],
  use: {
    baseURL: baseUrl,
    trace: bypassActive ? 'off' : 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: (Object.keys(VIEWPORTS) as ViewportName[]).map((name) => ({
    name,
    testMatch: /\.spec\.ts/,
    use: { ...devices['Desktop Chrome'], viewport: VIEWPORTS[name], hasTouch: name !== 'desktop' },
  })),
  webServer: managedServer
    ? {
        // A production build: no dev overlay, the markup users actually get.
        command: `npm run build && npm run start`,
        env: { PORT: String(LOCAL_PORT) },
        url: baseUrl,
        reuseExistingServer: true,
        timeout: 600_000,
        stdout: 'pipe',
        stderr: 'pipe',
      }
    : undefined,
});
