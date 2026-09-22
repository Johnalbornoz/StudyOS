'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Fase 2A -- Mecanismo B: identidad preconfigurada de prueba. Crea una
 * cuenta Clerk real vía la API de administración (nunca el formulario
 * público de /sign-up), marcada TEST desde el primer momento. Las
 * credenciales se muestran UNA sola vez, en pantalla, y nunca se
 * guardan en ningún documento ni registro -- solo el alias se conserva.
 */
export default function TestIdentityCreator() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [alias, setAlias] = useState('');
  const [purpose, setPurpose] = useState('');
  const [initialRole, setInitialRole] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ oneTimeEmail: string; oneTimePassword: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/admin/users/test-identities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alias, purpose, initialRole: initialRole || null }),
    });
    setBusy(false);
    if (res.ok) {
      const body = await res.json();
      setResult({ oneTimeEmail: body.data.oneTimeEmail, oneTimePassword: body.data.oneTimePassword });
      router.refresh();
    } else if (res.status === 403) {
      setError('Esta acción solo está disponible en Preview.');
    } else {
      setError('No se pudo crear la identidad de prueba.');
    }
  }

  if (!open) {
    return <button className="btn" onClick={() => setOpen(true)}>Crear identidad de prueba</button>;
  }

  if (result) {
    return (
      <div className="card" style={{ padding: 'var(--space-3)', minWidth: 320, border: '1px solid var(--warning-border, #fdba74)' }}>
        <h3 style={{ fontSize: 14, marginBottom: 'var(--space-2)' }}>Identidad de prueba creada</h3>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 'var(--space-2)' }}>
          Estas credenciales se muestran una sola vez. No se guardan en ningún registro ni documento — cópialas ahora si necesitas iniciar sesión manualmente.
        </p>
        <p style={{ fontSize: 13, fontFamily: 'monospace', wordBreak: 'break-all' }}>{result.oneTimeEmail}</p>
        <p style={{ fontSize: 13, fontFamily: 'monospace' }}>{result.oneTimePassword}</p>
        <button className="btn" onClick={() => { setResult(null); setOpen(false); setAlias(''); setPurpose(''); setInitialRole(''); }} style={{ marginTop: 'var(--space-2)' }}>
          Cerrar
        </button>
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: 'var(--space-3)', minWidth: 280 }}>
      <h3 style={{ fontSize: 14, marginBottom: 'var(--space-2)' }}>Crear identidad de prueba (Preview)</h3>
      <input
        placeholder="Alias (p. ej. ID-S)"
        value={alias}
        onChange={(e) => setAlias(e.target.value)}
        style={{ width: '100%', padding: 'var(--space-2)', marginBottom: 'var(--space-2)' }}
      />
      <input
        placeholder="Propósito"
        value={purpose}
        onChange={(e) => setPurpose(e.target.value)}
        style={{ width: '100%', padding: 'var(--space-2)', marginBottom: 'var(--space-2)' }}
      />
      <select value={initialRole} onChange={(e) => setInitialRole(e.target.value)} style={{ width: '100%', padding: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
        <option value="">Sin rol inicial</option>
        <option value="STUDENT">Estudiante</option>
        <option value="PARENT">Padre/Madre</option>
        <option value="TEACHER">Profesor</option>
      </select>
      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <button className="btn" disabled={busy || !alias || !purpose} onClick={submit}>Crear</button>
        <button className="btn btn-ghost" onClick={() => setOpen(false)}>Cancelar</button>
      </div>
      {error && <p style={{ fontSize: 12, color: 'var(--danger, red)', marginTop: 'var(--space-2)' }}>{error}</p>}
    </div>
  );
}
