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
  labels: { approve: string; reject: string };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function decide(decision: 'APPROVED' | 'REJECTED') {
    setBusy(true);
    const res = await fetch(`/api/institutions/${institutionId}/memberships/${membershipId}/decide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision }),
    });
    setBusy(false);
    if (res.ok) router.refresh();
  }

  return (
    <span style={{ display: 'flex', gap: 8 }}>
      <button disabled={busy} onClick={() => decide('APPROVED')}>{labels.approve}</button>
      <button disabled={busy} onClick={() => decide('REJECTED')}>{labels.reject}</button>
    </span>
  );
}
