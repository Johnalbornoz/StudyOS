import { clerkMiddleware } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { PATHNAME_HEADER } from '@/lib/admin/shell-context';
import { isStudentGatedPath } from '@/lib/student/onboarding-gate';
import { evaluateStudentOnboardingGate } from '@/lib/student/onboarding-gate.server';

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
export default clerkMiddleware(async (auth, request) => {
  const pathname = request.nextUrl.pathname;

  if (isStudentGatedPath(pathname)) {
    const { userId } = await auth();
    if (userId) {
      const target = await evaluateStudentOnboardingGate(userId, pathname).catch((error) => {
        console.error('[proxy] student onboarding gate lookup failed', error instanceof Error ? error.message : error);
        return null;
      });
      if (target && target !== pathname) {
        return NextResponse.redirect(new URL(target, request.url));
      }
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
