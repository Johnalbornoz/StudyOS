'use client';

/** Track A -- one-click acceptance of a coordinator invitation (the server re-checks everything). */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function AcceptCoordinatorInvitation({
  token,
  emailMismatch,
  labels,
}: {
  token: string;
  emailMismatch: boolean;
  labels: { submit: string; accepting: string; done: string; mismatch: string; errors: Record<string, string>; generic: string };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(emailMismatch ? { text: labels.mismatch, error: true } : null);
  return (
    <div className="ta-stack" style={{ gap: 'var(--space-3)' }}>
      <div className="ta-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const res = await fetch('/api/coordinator-invitations/accept', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
            const json = await res.json().catch(() => ({}));
            if (res.ok && json?.data?.institutionId) {
              setMessage({ text: labels.done });
              router.push(`/dashboard/institution/${json.data.institutionId}`);
              return;
            }
            setBusy(false);
            setMessage({ text: labels.errors[json?.error] ?? labels.generic, error: true });
          }}
        >
          {busy ? labels.accepting : labels.submit}
        </button>
      </div>
      {message && (
        <p role={message.error ? 'alert' : 'status'} className={message.error ? 'ta-msg ta-msg-error' : 'ta-msg'}>
          {message.text}
        </p>
      )}
    </div>
  );
}
