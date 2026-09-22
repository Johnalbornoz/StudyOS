'use client';

import { useState } from 'react';

export default function SessionsActions({ userId }: { userId: string }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<number | null>(null);

  async function revoke() {
    setBusy(true);
    const res = await fetch(`/api/admin/users/${userId}/revoke-sessions`, { method: 'POST' });
    setBusy(false);
    if (res.ok) {
      const body = await res.json();
      setResult(body.data.sessionsRevoked);
    }
  }

  return (
    <div>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 'var(--space-3)' }}>
        Clerk administra las sesiones activas de esta cuenta. Esta acción cierra todas las sesiones activas de inmediato, sin suspender ni archivar la cuenta.
      </p>
      <button className="btn btn-ghost" disabled={busy} onClick={revoke}>Revocar todas las sesiones activas</button>
      {result !== null && <p style={{ fontSize: 13, marginTop: 'var(--space-2)' }}>{result} sesión(es) revocada(s).</p>}
    </div>
  );
}
