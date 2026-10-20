'use client';
/**
 * J3.3 -- choose a discovered exam: creates the Exam Target (no subject is created or
 * needed), keeps the destination institution only as the "confirm with them" note, and
 * records the Student's approximate month when the database supports it.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

type L = Record<string, string>;

export function ChooseExamButton({ objectiveKey, destination, estimatedMonth, labels: l }: { objectiveKey: string; destination: string | null; estimatedMonth: string | null; labels: L }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  async function choose() {
    setBusy(true);
    setError(false);
    try {
      const r = await fetch('/api/exam-preparation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ objectiveKey, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, ...(destination ? { targetInstitutionName: destination } : {}) }),
      });
      const b = await r.json().catch(() => null);
      const id = b?.data?.profile?.id;
      if (!r.ok || !id) throw new Error();
      if (estimatedMonth) {
        // Best effort: an un-migrated database refuses the month (409) and the target stays valid without it.
        await fetch(`/api/exam-preparation/${id}/schedule`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ estimatedMonth }) }).catch(() => null);
      }
      router.push(`/dashboard/exam-prep/${id}`);
      router.refresh();
    } catch {
      setError(true);
      setBusy(false);
    }
  }
  return (
    <>
      <button type="button" className="btn btn-primary prep-cta" disabled={busy} onClick={choose}>{busy ? l['jx.disc.choosing'] : l['jx.disc.choose']}</button>
      {error ? <p className="ui-hint" role="alert">{l['jx.disc.error']}</p> : null}
    </>
  );
}
