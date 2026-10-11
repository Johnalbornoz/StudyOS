/**
 * L12 / UX-1 -- one browser session per role, saved as storage state for
 * the viewport projects.
 *
 * clerk-ticket: signs in through Clerk's testing helpers (a short-lived
 *   sign-in ticket minted with the test-instance secret key; no password).
 * storage-state: the Human Operator captured the sessions; nothing to do.
 * unset: no session is created and the role suites skip.
 */
import { mkdirSync } from 'node:fs';
import { clerk, clerkSetup } from '@clerk/testing/playwright';
import { expect, test as setup } from '@playwright/test';
import { GENERATED_STATE_DIR, generatedStatePath } from './support/session';
import { ROLES, clerkTicketBlocker, resolveRoleAuthMode, roleEmail } from './support/target';

const mode = resolveRoleAuthMode(process.env);

setup.describe.configure({ mode: 'serial' });

setup('clerk testing token', async () => {
  setup.skip(mode !== 'clerk-ticket', `E2E_ROLE_AUTH=${mode}: no programmatic sign-in`);
  const blocker = clerkTicketBlocker(process.env);
  expect(blocker, blocker ?? '').toBeNull();
  await clerkSetup();
  mkdirSync(GENERATED_STATE_DIR, { recursive: true });
});

for (const role of ROLES) {
  setup(`sign in: ${role}`, async ({ page }) => {
    setup.skip(mode !== 'clerk-ticket', `E2E_ROLE_AUTH=${mode}: no programmatic sign-in`);
    // Clerk must be loaded on the page before the helper can sign in.
    await page.goto('/sign-in');
    await clerk.signIn({ page, emailAddress: roleEmail(role, process.env) });
    await page.goto('/dashboard');
    await expect(page, `${role} did not reach a workspace`).toHaveURL(/\/dashboard(\/|$)/);
    await page.context().storageState({ path: generatedStatePath(role) });
  });
}
