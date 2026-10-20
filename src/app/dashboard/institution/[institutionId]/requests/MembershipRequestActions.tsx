'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Onboarding/authorization rework (2026-09-21) -- approve/reject a
 * PENDING teacher membership request. Posts to the existing, already-
 * authorized `/api/institutions/[id]/memberships/[membershipId]/decide`
 * route -- this component makes no authorization decision itself.
 */
export function MembershipRequestActions({
  institutionId,
  membershipId,
  labels,
}: {
  institutionId: string;
  membershipId: string;
  labels: { approve: string; reject: string; error?: string };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function decide(decision: 'APPROVED' | 'REJECTED') {
    setBusy(true);
    setError(false);
    const res = await fetch(`/api/institutions/${institutionId}/memberships/${membershipId}/decide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision }),
    });
    setBusy(false);
    // Track A: a failed decision is shown, never silently swallowed.
    if (res.ok) router.refresh();
    else setError(true);
  }

  // Track A: real, 44px primary actions (they were unstyled 22px buttons).
  return (
    <span className="ta-actions">
      <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => decide('REJECTED')}>
        {labels.reject}
      </button>
      <button type="button" className="btn btn-primary" disabled={busy} onClick={() => decide('APPROVED')}>
        {labels.approve}
      </button>
      {error && labels.error && (
        <span role="alert" className="ta-msg ta-msg-error">
          {labels.error}
        </span>
      )}
    </span>
  );
}
