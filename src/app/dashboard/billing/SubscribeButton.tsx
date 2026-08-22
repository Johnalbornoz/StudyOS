'use client';

import { useState } from 'react';

export default function SubscribeButton({
  label,
  notConfiguredMessage,
  errorMessage,
}: {
  label: string;
  notConfiguredMessage: string;
  errorMessage: string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/payments/checkout', { method: 'POST' });
      const body = await res.json();
      if (res.status === 503) {
        setError(notConfiguredMessage);
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
      {error && <p style={{ color: 'var(--error)', fontSize: 13, marginTop: 8 }}>{error}</p>}
    </div>
  );
}
