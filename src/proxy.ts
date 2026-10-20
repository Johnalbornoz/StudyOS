import { clerkMiddleware } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { PATHNAME_HEADER } from '@/lib/admin/shell-context';
import { isStudentGatedPath } from '@/lib/student/onboarding-gate';
import { isProtectedPagePath, SIGN_IN_PATH } from '@/lib/auth/protected-routes';
import { loadGateState } from '@/lib/student/onboarding-gate.server';
import { decideStudentOnboardingGate } from '@/lib/student/onboarding-gate';
import { decideWorkspacePageGuard } from '@/lib/identity/workspace-page-guard';
import { evaluateAccountGate, isAccountGatedApiPath } from '@/lib/identity/account-status-gate';

// Next.js 16 Proxy (formerly middleware; runs on the Node.js runtime).
//
// 1. Forwards the request path to Server Components as a REQUEST header
//    (never a response header) so the dashboard layout can present the
//    right workspace -- see src/lib/admin/shell-context.ts. Any
//    client-supplied value is overwritten.
// 2. Student onboarding gate: a Student without a complete academic
//    profile / first subject is redirected to the current onboarding step
//    BEFORE any Student page renders (a layout redirect cannot stop a
//    page's parallel side effects) -- see src/lib/student/onboarding-gate.ts.
//    One read-only query, only for Student pages under /dashboard. On a
//    lookup failure the request is let through (logged), never blocked.
// 3. REM-T1-01: an UNAUTHENTICATED request for a protected page (dashboard,
//    role selection, account area) is redirected to sign-in with a return
//    URL before anything renders -- never a dashboard shell with a
//    "Not authenticated" message. See src/lib/auth/protected-routes.ts.
// 4. L10 SF-1: an authenticated API request from an account whose database
//    status is not ACTIVE is refused (403) before the route runs -- see
//    src/lib/identity/account-status-gate.ts. Unauthenticated API requests
//    pass through untouched; each route answers 401 itself.
// 5. L10 SF-5: a dashboard page that belongs to a workspace the account does
//    not hold redirects to the account's own workspace before rendering, and
//    a non-ACTIVE account is sent to the suspended page -- see
//    src/lib/identity/workspace-page-guard.ts. It shares the ONE read-only
//    query of the onboarding gate (2), which now runs for every dashboard
//    page rather than only Student ones.
export default clerkMiddleware(async (auth, request) => {
  const pathname = request.nextUrl.pathname;

  if (isProtectedPagePath(pathname)) {
    const session = await auth();
    if (!session.userId) {
      // The app's own sign-in page (the normal authentication flow); Clerk's <SignIn/> returns to redirect_url.
      const signIn = new URL(SIGN_IN_PATH, request.url);
      signIn.searchParams.set('redirect_url', request.nextUrl.pathname + request.nextUrl.search);
      return NextResponse.redirect(signIn);
    }
    if (pathname === '/dashboard' || pathname.startsWith('/dashboard/')) {
      const state = await loadGateState(session.userId).catch((error) => {
        console.error('[proxy] dashboard gate lookup failed', error instanceof Error ? error.message : error);
        return null;
      });
      const workspaceTarget = decideWorkspacePageGuard(pathname, state);
      if (workspaceTarget && workspaceTarget !== pathname) {
        return NextResponse.redirect(new URL(workspaceTarget, request.url));
      }
      if (isStudentGatedPath(pathname)) {
        const target = decideStudentOnboardingGate(pathname, state);
        if (target && target !== pathname) {
          return NextResponse.redirect(new URL(target, request.url));
        }
      }
    }
  } else if (isAccountGatedApiPath(pathname)) {
    const session = await auth();
    if (session.userId) {
      const gate = await evaluateAccountGate(session.userId);
      if (!gate.allow) return NextResponse.json({ error: gate.error }, { status: gate.status });
    }
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(PATHNAME_HEADER, pathname);
  return NextResponse.next({ request: { headers: requestHeaders } });
});

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
