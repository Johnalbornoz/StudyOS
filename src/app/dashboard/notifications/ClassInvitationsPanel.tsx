'use client';

/**
 * Track A -- the Student's pending class invitations (consent-based
 * enrollment). Accepting makes the enrollment ACTIVE, which is what lets the
 * class's teachers see the Student's progress; declining grants nothing.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getMessages, type Locale } from '@/lib/i18n/messages';
import { fillMessage } from '@/lib/i18n/roles-messages';

interface Invitation {
  enrollmentId: string;
  className: string;
  institutionName: string;
}

export default function ClassInvitationsPanel({ locale }: { locale: Locale }) {
  const t = getMessages(locale);
  const router = useRouter();
  const [items, setItems] = useState<Invitation[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState(false);

  async function load() {
    const res = await fetch('/api/student/class-invitations', { cache: 'no-store' });
    if (!res.ok) return;
    const body = await res.json();
    setItems(body.data?.invitations ?? []);
  }

  useEffect(() => {
    load();
  }, []);

  async function respond(id: string, accept: boolean) {
    setBusy(id);
    setError(false);
    const res = await fetch(`/api/student/class-invitations/${id}/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accept }),
    });
    if (!res.ok) setError(true);
    await load();
    setBusy(null);
    router.refresh();
  }

  if (items.length === 0) return null;

  return (
    <section className="card list-card" aria-labelledby="class-invites" style={{ marginBottom: 'var(--space-6)' }}>
      <div style={{ padding: 'var(--space-4) var(--space-4) 0' }}>
        <h2 id="class-invites" className="label" style={{ color: 'var(--text-muted)', margin: 0, fontSize: 13 }}>
          {t['classInvites.title']}
        </h2>
      </div>
      {items.map((i) => (
        <div key={i.enrollmentId} className="list-row" style={{ flexWrap: 'wrap' }}>
          <div className="row-main" style={{ flexBasis: 220 }}>
            <div className="row-title">{i.className}</div>
            <div className="row-sub">{fillMessage(t['classInvites.body'], { institution: i.institutionName, className: i.className })}</div>
          </div>
          <div className="ta-actions">
            <button type="button" className="btn btn-ghost" disabled={busy === i.enrollmentId} onClick={() => respond(i.enrollmentId, false)}>
              {t['classInvites.decline']}
            </button>
            <button type="button" className="btn btn-primary" disabled={busy === i.enrollmentId} onClick={() => respond(i.enrollmentId, true)}>
              {t['classInvites.accept']}
            </button>
          </div>
        </div>
      ))}
      {error && (
        <p role="alert" className="ta-msg ta-msg-error" style={{ padding: 'var(--space-3) var(--space-4)' }}>
          {t['classInvites.error']}
        </p>
      )}
    </section>
  );
}
