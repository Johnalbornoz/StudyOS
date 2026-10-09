/**
 * REM-T1-01 -- pages that require an authenticated session.
 *
 * Enforced in `src/proxy.ts` BEFORE any Server Component renders, so an
 * unauthenticated visitor never sees the StudyUs dashboard shell (sidebar,
 * Home/Learn/Progress, account navigation) together with a "Not
 * authenticated" message -- they are redirected to sign-in instead, with a
 * return URL. API routes are not listed: each authorizes itself (401).
 *
 * `/account/*` is the authenticated account area (e.g. change-password);
 * `/account-suspended` is a different, public explanation page and is NOT
 * matched (prefix match requires `/account` exactly or `/account/...`).
 */
export const PROTECTED_PAGE_PREFIXES = ['/dashboard', '/role-select', '/account'] as const;

export function isProtectedPagePath(pathname: string): boolean {
  return PROTECTED_PAGE_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** The app's own sign-in page (src/app/sign-in), used for every unauthenticated redirect. */
export const SIGN_IN_PATH = '/sign-in';
