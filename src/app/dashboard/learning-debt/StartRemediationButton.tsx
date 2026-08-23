'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function StartRemediationButton({ diagnosisId, label }: { diagnosisId: string; label: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  async function start() {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch('/api/cognitive/remediation/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ diagnosisId }),
      });
      const body = await res.json();
      if (res.ok && body.href) {
        router.push(body.href);
      } else {
        setError(true);
        setLoading(false);
      }
    } catch {
      setError(true);
      setLoading(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
      <button
        type="button"
        className="btn btn-primary"
        style={{ height: 32, fontSize: 13, flexShrink: 0 }}
        onClick={start}
        disabled={loading}
      >
        {loading ? '…' : label}
      </button>
      {error && <span style={{ fontSize: 12, color: 'var(--error)' }}>{'!'}</span>}
    </div>
  );
}
