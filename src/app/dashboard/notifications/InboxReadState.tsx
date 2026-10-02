'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Track A -- notification READ state (never business state). Same model for
 * every role (one account inbox):
 *  - opening this page marks as read exactly the unread notifications it
 *    rendered (once per visit; visiting any other page changes nothing);
 *  - "Marcar todas como leídas" while anything is still unread;
 *  - "Marcar como no leída" per notification.
 * The shell badge (unread notifications only) is updated immediately via
 * the `studyus:unread-notifications` event; the server count is the source
 * of truth on the next render.
 */
export const UNREAD_EVENT = 'studyus:unread-notifications';

function announce(count: number) {
  window.dispatchEvent(new CustomEvent(UNREAD_EVENT, { detail: { count } }));
}

async function post(body: unknown): Promise<number | null> {
  try {
    const r = await fetch('/api/notifications/inbox', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) return null;
    const json = await r.json();
    return typeof json?.data?.unreadCount === 'number' ? json.data.unreadCount : null;
  } catch {
    return null;
  }
}

export function InboxReadControls({ displayedUnreadIds, initialUnread, label }: { displayedUnreadIds: string[]; initialUnread: number; label: string }) {
  const router = useRouter();
  const [unread, setUnread] = useState(initialUnread);
  const [busy, setBusy] = useState(false);
  const done = useRef(false);
  useEffect(() => {
    if (done.current || displayedUnreadIds.length === 0) return;
    done.current = true;
    post({ ids: displayedUnreadIds }).then((count) => {
      if (count === null) return;
      setUnread(count);
      announce(count);
    });
  }, [displayedUnreadIds]);
  if (unread <= 0) return null;
  return (
    <button
      type="button"
      className="btn btn-ghost"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const count = await post({});
        setBusy(false);
        if (count !== null) {
          setUnread(count);
          announce(count);
          router.refresh();
        }
      }}
    >
      {label}
    </button>
  );
}

export function MarkUnreadButton({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const count = await post({ ids: [id], unread: true });
        setBusy(false);
        if (count !== null) {
          announce(count);
          router.refresh();
        }
      }}
    >
      {label}
    </button>
  );
}
