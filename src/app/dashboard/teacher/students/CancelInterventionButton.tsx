'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** Track A -- cancel an ASSIGNED / IN_PROGRESS intervention of a class this teacher teaches (scoped server-side). */
export function CancelInterventionButton({ interventionId, label, errorLabel }: { interventionId: string; label: string; errorLabel: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  return (
    <span className="ta-actions">
      <button
        type="button"
        className="btn btn-ghost"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(false);
          const res = await fetch(`/api/teacher/interventions/${interventionId}/cancel`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
          });
          setBusy(false);
          if (!res.ok) setError(true);
          else router.refresh();
        }}
      >
        {label}
      </button>
      {error && (
        <span role="alert" className="ta-msg ta-msg-error">
          {errorLabel}
        </span>
      )}
    </span>
  );
}
