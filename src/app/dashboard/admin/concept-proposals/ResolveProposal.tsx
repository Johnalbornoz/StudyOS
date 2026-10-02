'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** Track A -- StudyUS catalog governance resolves one concept proposal. */
export function ResolveProposal({
  proposalId,
  candidates,
  canApprove,
}: {
  proposalId: string;
  candidates: Array<{ canonicalConceptId: string; name: string; score: number }>;
  canApprove: boolean;
}) {
  const router = useRouter();
  const [target, setTarget] = useState(candidates[0]?.canonicalConceptId ?? '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resolve(action: 'MAP_TO_EXISTING' | 'MERGE' | 'APPROVE' | 'REJECT') {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/admin/concept-proposals/${proposalId}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, canonicalConceptId: action === 'MAP_TO_EXISTING' || action === 'MERGE' ? target || null : null, note: note.trim() || null }),
      });
      const json = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(json?.error ?? 'ERROR');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ERROR');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ta-form ta-stack" style={{ gap: 'var(--space-2)' }}>
      {candidates.length > 0 && (
        <label className="ta-field">
          <span>Posibles equivalentes</span>
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            {candidates.map((c) => (
              <option key={c.canonicalConceptId} value={c.canonicalConceptId}>
                {c.name} ({Math.round(c.score * 100)}%)
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="ta-field">
        <span>Nota (opcional)</span>
        <input type="text" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <span className="ta-actions">
        {candidates.length > 0 && (
          <>
            <button type="button" className="btn btn-secondary" disabled={busy || !target} onClick={() => resolve('MAP_TO_EXISTING')}>
              Vincular al existente
            </button>
            <button type="button" className="btn btn-ghost" disabled={busy || !target} onClick={() => resolve('MERGE')}>
              Fusionar
            </button>
          </>
        )}
        {canApprove && (
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => resolve('APPROVE')}>
            Aprobar y crear concepto
          </button>
        )}
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => resolve('REJECT')}>
          Rechazar
        </button>
      </span>
      {error && <span className="ta-msg" role="alert">No se pudo resolver ({error}).</span>}
    </div>
  );
}
