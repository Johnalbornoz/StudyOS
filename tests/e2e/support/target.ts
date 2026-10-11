/**
 * L12 / UX-1 -- where the browser harness runs, and as whom.
 *
 * Pure functions over an environment record (no Playwright import), so the
 * guards are covered by tests/unit/l12-e2e-harness.test.ts.
 *
 * Environment:
 *   E2E_BASE_URL        target origin. Unset: the harness builds and serves
 *                       this checkout on http://127.0.0.1:3100 (playwright.config.ts).
 *   E2E_ENV_FILE        optional env file loaded before anything else (Clerk keys, DB).
 *   E2E_ROLE_AUTH       unset | clerk-ticket | storage-state. Unset: the four
 *                       role suites are skipped, never silently passed.
 *   E2E_STORAGE_STATE_DIR  storage-state mode: a directory holding student.json,
 *                       parent.json, teacher.json, institution.json.
 *   E2E_<ROLE>_EMAIL    clerk-ticket mode: the account to sign in as.
 *   E2E_<ROLE>_PATHS    extra comma-separated paths to audit for a role.
 *   E2E_KNOWN_FINDINGS  expected (default) | strict. See known-findings.ts.
 *   E2E_AXE_FAIL_ON     comma-separated axe impacts that fail a page (default: critical).
 */

export type Env = Record<string, string | undefined>;

export const LOCAL_PORT = 3100;
export const LOCAL_BASE_URL = `http://127.0.0.1:${LOCAL_PORT}`;

/** PRODUCTION is locked for every lane (docs/orchestration LOCKS.md). The harness never targets it. */
export const PRODUCTION_HOSTS = ['studyus.pro', 'www.studyus.pro'] as const;

export const VIEWPORTS = {
  mobile: { width: 375, height: 812 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1280, height: 800 },
} as const;
export type ViewportName = keyof typeof VIEWPORTS;

/** Below this width the shell replaces the sidebar with the top bar, tab bar and drawer (globals.css). */
export const COMPACT_NAV_MAX_WIDTH = 1023;

export const ROLES = ['student', 'parent', 'teacher', 'institution'] as const;
export type Role = (typeof ROLES)[number];

/** Workspace home per role (src/lib/identity/workspace-entry.ts) and the Track A fixture identity that holds it. */
export const ROLE_DEFAULTS: Record<Role, { home: string; fixtureEmail: string }> = {
  student: { home: '/dashboard/today', fixtureEmail: 'studyus-ta-student-a+clerk_test@example.com' },
  parent: { home: '/dashboard/parent', fixtureEmail: 'studyus-ta-parent-a+clerk_test@example.com' },
  teacher: { home: '/dashboard/teacher', fixtureEmail: 'studyus-ta-teacher-a+clerk_test@example.com' },
  institution: { home: '/dashboard/institution', fixtureEmail: 'studyus-ta-inst-b+clerk_test@example.com' },
};

export type RoleAuthMode = 'none' | 'clerk-ticket' | 'storage-state';

export function resolveBaseUrl(env: Env): { baseUrl: string; managedServer: boolean } {
  const raw = env.E2E_BASE_URL?.trim();
  if (!raw) return { baseUrl: LOCAL_BASE_URL, managedServer: true };
  const url = new URL(raw);
  if ((PRODUCTION_HOSTS as readonly string[]).includes(url.hostname.toLowerCase())) {
    throw new Error(`E2E_BASE_URL points at Production (${url.hostname}). The browser harness never runs against Production.`);
  }
  return { baseUrl: url.origin, managedServer: false };
}

export function resolveRoleAuthMode(env: Env): RoleAuthMode {
  const raw = env.E2E_ROLE_AUTH?.trim();
  if (!raw) return 'none';
  if (raw === 'clerk-ticket' || raw === 'storage-state') return raw;
  throw new Error(`E2E_ROLE_AUTH must be clerk-ticket or storage-state (got "${raw}").`);
}

/**
 * Why programmatic sign-in cannot be used, or null when it can. Ticket
 * sign-in is a Clerk test-instance feature: a live key is refused here, so
 * the harness can never mint a session on the Production Clerk instance.
 */
export function clerkTicketBlocker(env: Env): string | null {
  const secret = env.CLERK_SECRET_KEY ?? '';
  const publishable = env.CLERK_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '';
  if (!secret || !publishable) return 'CLERK_SECRET_KEY and a Clerk publishable key are required for clerk-ticket sign-in';
  if (!secret.startsWith('sk_test_') || !publishable.startsWith('pk_test_')) return 'clerk-ticket sign-in only runs with Clerk test-instance keys (sk_test_ / pk_test_)';
  return null;
}

export function roleEmail(role: Role, env: Env): string {
  return env[`E2E_${role.toUpperCase()}_EMAIL`]?.trim() || ROLE_DEFAULTS[role].fixtureEmail;
}

/** The role's home first, then any extra paths from E2E_<ROLE>_PATHS. Only same-origin absolute paths are accepted. */
export function rolePaths(role: Role, env: Env): string[] {
  const extra = (env[`E2E_${role.toUpperCase()}_PATHS`] ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.startsWith('/') && !p.startsWith('//'));
  return [...new Set([ROLE_DEFAULTS[role].home, ...extra])];
}

export function axeFailImpacts(env: Env): string[] {
  const allowed = ['minor', 'moderate', 'serious', 'critical'];
  const picked = (env.E2E_AXE_FAIL_ON ?? 'critical').split(',').map((s) => s.trim()).filter((s) => allowed.includes(s));
  return picked.length > 0 ? picked : ['critical'];
}

/** Primary language subtag, lower-cased: "es-CO" -> "es". Empty when absent. */
export function primaryLanguage(lang: string | null | undefined): string {
  return (lang ?? '').trim().toLowerCase().split('-')[0];
}
