'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Phase 3E's single student-facing entry point into the Session Engine.
 * Never trusts a client-held LearningDecision -- only studentId +
 * actionConceptId are sent; the server re-derives the current Phase 3C
 * decision and validates ownership before returning a launch target.
 * On UNAVAILABLE this shows a neutral retry state and never silently
 * substitutes a different action -- retrying re-derives fresh from the
 * server, it does not fall back to a client-guessed URL.
 */
export default function StartSessionButton({
  studentId,
  actionConceptId,
  label,
  accessibleLabel,
  unavailableLabel,
  retryLabel,
  variant = 'primary',
}: {
  studentId: string;
  actionConceptId: string;
  label: string;
  accessibleLabel?: string;
  unavailableLabel: string;
  retryLabel: string;
  variant?: 'primary' | 'secondary';
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  async function start() {
    setLoading(true);
    setUnavailable(false);
    try {
      const res = await fetch('/api/learning/session/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId, actionConceptId }),
      });
      const body = await res.json();
      const session = body?.data?.session;
      if (res.ok && session?.launchStatus === 'READY' && session.launchTarget) {
        router.push(session.launchTarget);
        return;
      }
      setUnavailable(true);
    } catch {
      setUnavailable(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
      <button
        type="button"
        className={variant === 'primary' ? 'btn btn-primary' : 'btn btn-secondary'}
        style={{ height: variant === 'primary' ? undefined : 32, fontSize: variant === 'primary' ? undefined : 13, flexShrink: 0 }}
        onClick={start}
        disabled={loading}
        aria-label={accessibleLabel ?? label}
        aria-busy={loading}
      >
        {loading ? <span aria-hidden="true">…</span> : unavailable ? retryLabel : label}
      </button>
      {unavailable && (
        <span role="alert" style={{ fontSize: 12, color: 'var(--error)' }}>
          {unavailableLabel}
        </span>
      )}
    </div>
  );
}
