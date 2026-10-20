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
 *   E2E_STORAGE_STATE_DIR  a directory holding student.json, parent.json,
 *                       teacher.json and institution.json: Playwright storage
 *                       states captured by the Human Operator. Unset: the four
 *                       role suites are skipped, never silently passed. The
 *                       harness never signs in by itself.
 *   E2E_<ROLE>_PATHS    extra comma-separated paths to audit for a role.
 *   E2E_VERCEL_BYPASS_SECRET  the project's Vercel "Protection Bypass for Automation" secret, for a target
 *                       behind Vercel Deployment Protection. Sent only to the target origin, only over https,
 *                       only to a *.vercel.app host. Never printed. Unset: no bypass; a protected target then
 *                       fails the run loudly (see fixtures.ts) instead of being audited as Vercel's login page.
 *   E2E_KNOWN_FINDINGS  expected (default) | strict. See known-findings.ts.
 *   E2E_AXE_FAIL_ON     extra axe impacts that fail a page, on top of the release
 *                       policy (see AXE_POLICY). It can tighten, never loosen.
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

/** Workspace home per role (src/lib/identity/workspace-entry.ts). */
export const ROLE_DEFAULTS: Record<Role, { home: string }> = {
  student: { home: '/dashboard/today' },
  parent: { home: '/dashboard/parent' },
  teacher: { home: '/dashboard/teacher' },
  institution: { home: '/dashboard/institution' },
};

/**
 * Accessibility release policy (Orchestrator ruling, 2026-10-11): the axe
 * impacts that fail a page. Authenticated product pages: critical and
 * serious. Public marketing pages for the initial pilot: critical; their
 * serious findings are reported, not excused.
 */
export type Surface = 'public' | 'authenticated';
export const AXE_POLICY: Record<Surface, readonly string[]> = {
  public: ['critical'],
  authenticated: ['critical', 'serious'],
};

export const isProductionHost = (hostname: string) => {
  const host = hostname.toLowerCase().replace(/^\./, '');
  return PRODUCTION_HOSTS.some((p) => host === p || host.endsWith(`.${p}`));
};

export function resolveBaseUrl(env: Env): { baseUrl: string; managedServer: boolean } {
  const raw = env.E2E_BASE_URL?.trim();
  if (!raw) return { baseUrl: LOCAL_BASE_URL, managedServer: true };
  const url = new URL(raw);
  if (isProductionHost(url.hostname)) {
    throw new Error(`E2E_BASE_URL points at Production (${url.hostname}). The browser harness never runs against Production.`);
  }
  return { baseUrl: url.origin, managedServer: false };
}

export const VERCEL_BYPASS_ENV = 'E2E_VERCEL_BYPASS_SECRET';
export const VERCEL_BYPASS_HEADER = 'x-vercel-protection-bypass';
/** Where Vercel Deployment Protection sends a visitor it does not let through. */
export const VERCEL_PROTECTION_HOSTS = ['vercel.com'] as const;

export const isVercelProtectionHost = (hostname: string) => {
  const host = hostname.toLowerCase();
  return VERCEL_PROTECTION_HOSTS.some((p) => host === p || host.endsWith(`.${p}`));
};

/**
 * The Deployment Protection bypass for this run, or null when none applies.
 * The secret goes to the target origin and nowhere else: the caller attaches
 * `headers` only to requests whose origin is `origin`.
 */
export function protectionBypass(env: Env, baseUrl: string): { origin: string; headers: Record<string, string> } | null {
  const secret = env[VERCEL_BYPASS_ENV]?.trim();
  if (!secret) return null;
  const url = new URL(baseUrl);
  if (isProductionHost(url.hostname)) throw new Error(`${VERCEL_BYPASS_ENV} is set for a Production target (${url.hostname}). The browser harness never runs against Production.`);
  // the local build is not behind Deployment Protection: the secret is not sent to it
  if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return null;
  if (url.protocol !== 'https:' || !url.hostname.toLowerCase().endsWith('.vercel.app')) {
    throw new Error(`${VERCEL_BYPASS_ENV} is set but the target (${url.origin}) is not an https *.vercel.app deployment; the secret is not sent there.`);
  }
  return { origin: url.origin, headers: { [VERCEL_BYPASS_HEADER]: secret } };
}

/** The role's home first, then any extra paths from E2E_<ROLE>_PATHS. Only same-origin absolute paths are accepted. */
export function rolePaths(role: Role, env: Env): string[] {
  const extra = (env[`E2E_${role.toUpperCase()}_PATHS`] ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.startsWith('/') && !p.startsWith('//'));
  return [...new Set([ROLE_DEFAULTS[role].home, ...extra])];
}

export function axeFailImpacts(surface: Surface, env: Env): string[] {
  const allowed = ['minor', 'moderate', 'serious', 'critical'];
  const extra = (env.E2E_AXE_FAIL_ON ?? '').split(',').map((s) => s.trim()).filter((s) => allowed.includes(s));
  return [...new Set([...AXE_POLICY[surface], ...extra])];
}

/** Primary language subtag, lower-cased: "es-CO" -> "es". Empty when absent. */
export function primaryLanguage(lang: string | null | undefined): string {
  return (lang ?? '').trim().toLowerCase().split('-')[0];
}
