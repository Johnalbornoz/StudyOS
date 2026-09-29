'use client'; // Error boundaries must be Client Components

import RouteErrorState from './RouteErrorState';

/**
 * UX-2 -- shell-level error boundary for every /dashboard/** page. It sits
 * inside the dashboard layout, so navigation stays usable when a page
 * fails (previously an unexpected server error replaced the whole screen
 * with Next's default error page).
 */
export default function DashboardError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <RouteErrorState error={error} retry={retry} />;
}
