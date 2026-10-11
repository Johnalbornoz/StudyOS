'use client';

import { useState } from 'react';

export default function SubscribeButton({
  label,
  notConfiguredMessage,
  errorMessage,
  studentId,
  unavailableMessage,
}: {
  label: string;
  notConfiguredMessage: string;
  errorMessage: string;
  /** L7 PA-5: a Parent paying for this linked child. Omitted for the Student's own checkout. */
  studentId?: string;
  /** Shown when the subscription cannot be purchased now (409); falls back to errorMessage. */
  unavailableMessage?: string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/payments/checkout', studentId ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ studentId }) } : { method: 'POST' });
      const body = await res.json();
      if (res.status === 503) {
        setError(notConfiguredMessage);
        return;
      }
      if (res.status === 409 && unavailableMessage) {
        setError(unavailableMessage);
        return;
      }
      if (!res.ok || !body.data?.checkoutUrl) {
        setError(errorMessage);
        return;
      }
      window.location.href = body.data.checkoutUrl;
    } catch {
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button className="btn btn-primary" disabled={loading} onClick={handleClick}>
        {label}
      </button>
      {error && <p role="alert" style={{ color: 'var(--error)', fontSize: 13, marginTop: 8 }}>{error}</p>}
    </div>
  );
}
