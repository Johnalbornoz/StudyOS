import { clerkMiddleware } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { PATHNAME_HEADER } from '@/lib/admin/shell-context';

// Forwards the request path to Server Components as a REQUEST header
// (never a response header) so the dashboard layout can present the
// right workspace for the route -- see src/lib/admin/shell-context.ts.
// Any client-supplied value is overwritten here.
export default clerkMiddleware((_auth, request) => {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(PATHNAME_HEADER, request.nextUrl.pathname);
  return NextResponse.next({ request: { headers: requestHeaders } });
});

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
