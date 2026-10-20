'use client';

import { Skeleton } from '@/components/ui/Skeleton';
import { useShellMessages } from '../ShellLocale';

/**
 * F5 -- the Exams page renders on the server (readiness, instances, the requested level) and takes seconds; without an
 * instant loading state a click on a preparation link looked dead. This fallback shows at once, then the page streams in.
 */
export default function ExamsLoading() {
  const t = useShellMessages();
  return (
    <div className="exv2-page" aria-busy="true">
      <p className="sr-only" role="status">{t['xp.loading']}</p>
      <div className="xp-intro">
        <Skeleton width={140} height={14} />
        <Skeleton width="min(320px, 80%)" height={30} />
        <Skeleton width="min(420px, 85%)" height={16} />
      </div>
      <div aria-hidden style={{ display: 'grid', gap: 12, marginTop: 16 }}>
        <Skeleton height={56} radius="var(--radius-md)" />
        <Skeleton height={160} radius="var(--radius-md)" />
        <Skeleton height={48} radius="var(--radius-md)" />
      </div>
    </div>
  );
}
