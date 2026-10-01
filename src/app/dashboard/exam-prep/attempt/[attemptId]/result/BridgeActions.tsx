'use client';

/** Exam V2 -- result-page actions: "Añadir a mi plan" (governed concept request) and "repeat from zero". */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function ConceptRequestButton({ simulationAttemptId, learningObjectiveId, requested, labels: l }: { simulationAttemptId: string; learningObjectiveId: string; requested: boolean; labels: Record<string, string> }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>(requested ? 'done' : 'idle');
  async function request() {
    setState('busy');
    const r = await fetch('/api/exams/concept-requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ simulationAttemptId, learningObjectiveId }) }).catch(() => null);
    setState(r?.ok ? 'done' : 'error');
  }
  if (state === 'done') return <span className="xr-pill is-good">{l['exv2.bridge.requested']}</span>;
  return (
    <>
      <button type="button" className="btn" onClick={request} disabled={state === 'busy'}>{l['exv2.bridge.addToPlan']}</button>
      {state === 'error' && <span className="xr-error">{l['exv2.error.generic']}</span>}
    </>
  );
}

export function RetakeButton({ instanceId, labels: l }: { instanceId: string; labels: Record<string, string> }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  async function retake() {
    setBusy(true);
    const r = await fetch(`/api/exams/instances/${instanceId}/retake`, { method: 'POST' }).catch(() => null);
    setBusy(false);
    if (!r?.ok) {
      setError(true);
      return;
    }
    router.push('/dashboard/exams');
  }
  return (
    <>
      <button type="button" className="btn" onClick={retake} disabled={busy}>{l['exv2.action.retake']}</button>
      {error && <span className="xr-error">{l['exv2.error.generic']}</span>}
    </>
  );
}
