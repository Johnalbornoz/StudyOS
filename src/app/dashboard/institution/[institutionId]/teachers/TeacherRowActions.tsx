'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Onboarding/authorization rework (2026-09-21) -- revoke an APPROVED
 * teacher membership, or create a TeacherAssignment (grade/class/
 * subject scope) for it. Both post to already-authorized existing
 * routes (`.../memberships/[membershipId]/revoke`,
 * `.../assignments`) -- this component makes no authorization
 * decision itself.
 */
export function TeacherRowActions({
  institutionId,
  membershipId,
  labels,
}: {
  institutionId: string;
  membershipId: string;
  labels: { revoke: string; assign: string; subjectPlaceholder: string };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [subjectLabel, setSubjectLabel] = useState('');

  async function revoke() {
    setBusy(true);
    const res = await fetch(`/api/institutions/${institutionId}/memberships/${membershipId}/revoke`, { method: 'POST' });
    setBusy(false);
    if (res.ok) router.refresh();
  }

  async function assign() {
    setBusy(true);
    const res = await fetch(`/api/institutions/${institutionId}/assignments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ institutionMembershipId: membershipId, subjectLabel: subjectLabel.trim() || null }),
    });
    setBusy(false);
    if (res.ok) {
      setAssigning(false);
      setSubjectLabel('');
      router.refresh();
    }
  }

  if (assigning) {
    return (
      <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          value={subjectLabel}
          onChange={(e) => setSubjectLabel(e.target.value)}
          placeholder={labels.subjectPlaceholder}
          style={{ padding: 4, fontSize: 13 }}
        />
        <button disabled={busy} onClick={assign}>{labels.assign}</button>
        <button disabled={busy} onClick={() => setAssigning(false)}>×</button>
      </span>
    );
  }

  return (
    <span style={{ display: 'flex', gap: 8 }}>
      <button disabled={busy} onClick={() => setAssigning(true)}>{labels.assign}</button>
      <button disabled={busy} onClick={revoke}>{labels.revoke}</button>
    </span>
  );
}
