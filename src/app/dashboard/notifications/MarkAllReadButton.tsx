'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** Track A -- marks the caller's own inbox (current workspace, server-resolved) as read. */
export function MarkAllReadButton({ label }: { label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-ghost"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch('/api/notifications/inbox', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {});
        setBusy(false);
        router.refresh();
      }}
    >
      {label}
    </button>
  );
}
