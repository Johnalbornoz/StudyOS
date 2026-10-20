'use client';

import { useEffect, useState } from 'react';
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
  pauseAllowed = true,
  labels,
}: {
  attemptId: string;
  status: 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'ABANDONED';
  /** Track B: official simulation timing never offers pause (the server refuses it anyway). */
  pauseAllowed?: boolean;
  labels: AttemptControlLabels;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // BRW-C3-01 (RC-3): while the runner hands the attempt in, no other lifecycle action may start (an "abandon" during
  // a long hand-in was refused with 409 and read as "finalization failed" although it succeeded).
  const [handingIn, setHandingIn] = useState(false);
  useEffect(() => {
    const on = (e: Event) => { const d = (e as CustomEvent<{ attemptId: string; active: boolean }>).detail; if (d?.attemptId === attemptId) setHandingIn(!!d.active); };
    window.addEventListener('studyus:attempt-handing-in', on);
    return () => window.removeEventListener('studyus:attempt-handing-in', on);
  }, [attemptId]);

  async function call(action: 'pause' | 'resume' | 'abandon') {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/simulation/attempts/${attemptId}/${action}`, { method: 'POST' });
      if (!res.ok) {
        // the attempt was already handed in (e.g. a hand-in finished meanwhile): show its result, never a false error
        const now = await fetch(`/api/simulation/attempts/${attemptId}`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
        if (now?.data?.attempt?.status === 'COMPLETED' || now?.data?.status === 'COMPLETED') {
          router.push(`/dashboard/exam-prep/attempt/${attemptId}/result`);
          return;
        }
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
        {status === 'ACTIVE' && pauseAllowed && (
          <button type="button" className="btn" disabled={busy || handingIn} onClick={() => call('pause')}>
            {labels.pause}
          </button>
        )}
        {status === 'PAUSED' && (
          <button type="button" className="btn btn-primary" disabled={busy || handingIn} onClick={() => call('resume')}>
            {labels.resume}
          </button>
        )}
        <button type="button" className="btn" disabled={busy || handingIn} onClick={() => call('abandon')}>
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
