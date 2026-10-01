'use client';

/**
 * Track A (A4) -- StudyUS admin controls: create an institution and assign
 * its administrator by the email of an existing account. Both routes are
 * STUDYUS_ADMIN-only (role + allowlist) and audited server-side.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Msg = { text: string; error?: boolean } | null;

export function CreateInstitutionForm({ labels }: { labels: { title: string; name: string; submit: string; done: string; error: string } }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Msg>(null);
  return (
    <form
      className="ta-form card ta-card"
      aria-label={labels.title}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim()) return;
        setBusy(true);
        const res = await fetch('/api/admin/institutions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.trim() }),
        });
        setMessage(res.ok ? { text: labels.done } : { text: labels.error, error: true });
        setBusy(false);
        if (res.ok) {
          setName('');
          router.refresh();
        }
      }}
    >
      <h2>{labels.title}</h2>
      <label htmlFor="inst-name">{labels.name}</label>
      <div className="ta-row">
        <input id="inst-name" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
        <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>
          {labels.submit}
        </button>
      </div>
      {message && (
        <p role={message.error ? 'alert' : 'status'} className={message.error ? 'ta-msg ta-msg-error' : 'ta-msg'}>
          {message.text}
        </p>
      )}
    </form>
  );
}

export function InviteInstitutionAdminForm({
  institutionId,
  labels,
}: {
  institutionId: string;
  labels: { title: string; email: string; submit: string; done: string; userNotFound: string; roleRevoked: string; error: string };
}) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Msg>(null);
  return (
    <form
      className="ta-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!email.trim()) return;
        setBusy(true);
        const res = await fetch(`/api/admin/institutions/${institutionId}/invite-admin`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email.trim() }),
        });
        const body = await res.json().catch(() => ({}));
        if (res.ok) {
          setMessage({ text: labels.done });
          setEmail('');
          router.refresh();
        } else if (body?.error === 'USER_NOT_FOUND') setMessage({ text: labels.userNotFound, error: true });
        else if (body?.error === 'ROLE_REVOKED') setMessage({ text: labels.roleRevoked, error: true });
        else setMessage({ text: labels.error, error: true });
        setBusy(false);
      }}
    >
      <label htmlFor={`admin-email-${institutionId}`}>{labels.email}</label>
      <div className="ta-row">
        <input id={`admin-email-${institutionId}`} type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
        <button type="submit" className="btn btn-secondary" disabled={busy || !email.trim()}>
          {labels.submit}
        </button>
      </div>
      {message && (
        <p role={message.error ? 'alert' : 'status'} className={message.error ? 'ta-msg ta-msg-error' : 'ta-msg'}>
          {message.text}
        </p>
      )}
    </form>
  );
}
