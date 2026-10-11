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
