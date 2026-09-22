'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** Fase 2A -- suspender/reactivar/archivar. Toda acción de bloqueo pide un motivo y explica su consecuencia antes de confirmar. */
export default function UserStatusActions({ userId, status }: { userId: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<'suspend' | 'archive' | null>(null);
  const [reason, setReason] = useState('');

  async function reactivate() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/admin/users/${userId}/reactivate`, { method: 'POST' });
    setBusy(false);
    if (res.ok) router.refresh();
    else setError('No se pudo reactivar.');
  }

  async function confirmAction() {
    if (!confirming || !reason.trim()) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/admin/users/${userId}/${confirming}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: reason.trim() }),
    });
    setBusy(false);
    if (res.ok) {
      setConfirming(null);
      setReason('');
      router.refresh();
    } else if (res.status === 409) {
      setError('No se puede suspender/archivar al único Admin StudyUS activo.');
    } else {
      setError('No se pudo completar la acción.');
    }
  }

  if (confirming) {
    return (
      <div>
        <p style={{ fontSize: 13, marginBottom: 'var(--space-2)' }}>
          {confirming === 'suspend'
            ? 'Suspender bloquea el acceso de inmediato y revoca sus sesiones activas. Los datos se conservan y puede reactivarse después.'
            : 'Archivar retira la cuenta de operación normal y revoca sus sesiones activas. Los datos se conservan; no es una eliminación definitiva.'}
        </p>
        <input
          placeholder="Motivo (obligatorio)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          style={{ width: '100%', padding: 'var(--space-2)', marginBottom: 'var(--space-2)' }}
        />
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button className="btn" disabled={busy || !reason.trim()} onClick={confirmAction}>Confirmar {confirming === 'suspend' ? 'suspensión' : 'archivo'}</button>
          <button className="btn btn-ghost" onClick={() => setConfirming(null)}>Cancelar</button>
        </div>
        {error && <p style={{ fontSize: 12, color: 'var(--danger, red)', marginTop: 'var(--space-2)' }}>{error}</p>}
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        {status !== 'SUSPENDED' && (
          <button className="btn btn-ghost" disabled={busy} onClick={() => setConfirming('suspend')}>Suspender</button>
        )}
        {status !== 'ACTIVE' && (
          <button className="btn" disabled={busy} onClick={reactivate}>Reactivar</button>
        )}
        {status !== 'ARCHIVED' && (
          <button className="btn btn-ghost" disabled={busy} onClick={() => setConfirming('archive')}>Archivar</button>
        )}
      </div>
      {error && <p style={{ fontSize: 12, color: 'var(--danger, red)', marginTop: 'var(--space-2)' }}>{error}</p>}
    </div>
  );
}
