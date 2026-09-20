'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface AttemptControlLabels {
  pause: string;
  resume: string;
  abandon: string;
  error: string;
}

export function AttemptControls({
  attemptId,
  status,
  labels,
}: {
  attemptId: string;
  status: 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'ABANDONED';
  labels: AttemptControlLabels;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(action: 'pause' | 'resume' | 'abandon') {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/simulation/attempts/${attemptId}/${action}`, { method: 'POST' });
      if (!res.ok) {
        setError(labels.error);
        return;
      }
      router.refresh();
    } catch {
      setError(labels.error);
    } finally {
      setBusy(false);
    }
  }

  if (status === 'COMPLETED' || status === 'ABANDONED') return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        {status === 'ACTIVE' && (
          <button type="button" className="btn" disabled={busy} onClick={() => call('pause')}>
            {labels.pause}
          </button>
        )}
        {status === 'PAUSED' && (
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => call('resume')}>
            {labels.resume}
          </button>
        )}
        <button type="button" className="btn" disabled={busy} onClick={() => call('abandon')}>
          {labels.abandon}
        </button>
      </div>
      {error && (
        <p role="alert" style={{ fontSize: 12.5, color: 'var(--error)' }}>
          {error}
        </p>
      )}
    </div>
  );
}
