'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** Fase 2A -- Mecanismo A: invitación real por Clerk. El rol inicial es solo una sugerencia -- el usuario invitado siempre confirma su rol real en /role-select. */
export default function InviteUserForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [intendedRole, setIntendedRole] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setMessage(null);
    const res = await fetch('/api/admin/users/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, intendedRole: intendedRole || null }),
    });
    setBusy(false);
    if (res.ok) {
      setMessage('Invitación enviada.');
      setEmail('');
      setIntendedRole('');
      router.refresh();
    } else if (res.status === 409) {
      setMessage('Ya existe una invitación o cuenta para ese correo.');
    } else {
      setMessage('No se pudo enviar la invitación.');
    }
  }

  if (!open) {
    return <button className="btn" onClick={() => setOpen(true)}>Invitar usuario</button>;
  }

  return (
    <div className="card" style={{ padding: 'var(--space-3)', minWidth: 280 }}>
      <h3 style={{ fontSize: 14, marginBottom: 'var(--space-2)' }}>Invitar usuario</h3>
      <input
        type="email"
        placeholder="correo@ejemplo.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        style={{ width: '100%', padding: 'var(--space-2)', marginBottom: 'var(--space-2)' }}
      />
      <select value={intendedRole} onChange={(e) => setIntendedRole(e.target.value)} style={{ width: '100%', padding: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
        <option value="">Sin rol (elige en /role-select)</option>
        <option value="STUDENT">Estudiante (sugerido)</option>
        <option value="PARENT">Padre/Madre (sugerido)</option>
        <option value="TEACHER">Profesor (sugerido)</option>
      </select>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 'var(--space-2)' }}>
        El rol es solo una sugerencia. La persona invitada siempre confirma su rol real al completar el registro.
      </p>
      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <button className="btn" disabled={busy || !email} onClick={submit}>Enviar invitación</button>
        <button className="btn btn-ghost" onClick={() => setOpen(false)}>Cancelar</button>
      </div>
      {message && <p style={{ fontSize: 12, marginTop: 'var(--space-2)' }}>{message}</p>}
    </div>
  );
}
