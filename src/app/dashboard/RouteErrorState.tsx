'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { InlineAlert } from '@/components/ui/InlineAlert';
import { useShellMessages } from './ShellLocale';

/**
 * UX-2 -- the shared body of a route `error.tsx` inside the learner shell:
 * an honest failure (never an empty state), a retry that re-renders the
 * segment, and a way back to Hoy. Localized through the shell's own
 * resolved language. The raw error is only logged -- in production Next
 * forwards a generic message plus a digest, never server details.
 */
export default function RouteErrorState({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const t = useShellMessages();
  useEffect(() => {
    console.error('[route-error]', error.digest ?? error.message);
  }, [error]);
  return (
    <div style={{ maxWidth: 'var(--page-max)' }}>
      <InlineAlert
        tone="error"
        title={t['xp.errorTitle']}
        body={t['xp.errorBody']}
        actions={
          <>
            <button type="button" className="btn btn-primary" onClick={() => retry()}>{t['xp.errorRetry']}</button>
            <Link href="/dashboard/today" className="btn btn-secondary">{t['xp.errorHome']}</Link>
          </>
        }
      />
    </div>
  );
}
