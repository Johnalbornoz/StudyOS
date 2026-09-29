'use client';

import { Skeleton } from '@/components/ui/Skeleton';
import { useShellMessages } from '../ShellLocale';

/**
 * UX-2 -- Home's instant loading state: the page's own shape (greeting,
 * "Tu siguiente reto" hero, two figures) so nothing jumps when the real
 * content streams in. One polite status announcement for assistive tech;
 * the blocks themselves are decorative.
 */
export default function TodayLoading() {
  const t = useShellMessages();
  return (
    <div className="xp-page" aria-busy="true">
      <p className="sr-only" role="status">{t['xp.loading']}</p>
      <div className="xp-intro">
        <Skeleton width={140} height={14} />
        <Skeleton width="min(320px, 80%)" height={30} />
        <Skeleton width="min(260px, 70%)" height={16} />
      </div>
      <div className="xp-hero" aria-hidden>
        <Skeleton width={160} height={14} style={{ opacity: 0.35 }} />
        <Skeleton width="min(420px, 85%)" height={30} style={{ marginTop: 16, opacity: 0.35 }} />
        <Skeleton width="min(360px, 75%)" height={16} style={{ marginTop: 20, opacity: 0.35 }} />
        <Skeleton width={200} height={52} radius="var(--radius-md)" style={{ marginTop: 28, opacity: 0.35 }} />
      </div>
      <div className="xp-stats" aria-hidden>
        <Skeleton height={112} radius="var(--radius-md)" />
        <Skeleton height={112} radius="var(--radius-md)" />
      </div>
    </div>
  );
}
