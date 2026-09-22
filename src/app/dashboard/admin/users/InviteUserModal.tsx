'use client';

import { useState } from 'react';
import { Modal } from '../Modal';

export default function InviteUserModal({ onClose, onSent }: { onClose: () => void; onSent: () => void }) {
  const [email, setEmail] = useState('');
  const [intendedRole, setIntendedRole] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/admin/users/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, intendedRole: intendedRole || null }),
    });
    setBusy(false);
    if (res.ok) onSent();
    else if (res.status === 409) setError('Ya existe una invitación o cuenta para ese correo.');
    else setError('No se pudo enviar la invitación.');
  }

  return (
    <Modal title="Invitar usuario por correo" onClose={onClose}>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Correo electrónico</label>
      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={{ width: '100%', padding: 'var(--space-2)', marginBottom: 'var(--space-3)' }} />

      <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Rol sugerido (opcional)</label>
      <select value={intendedRole} onChange={(e) => setIntendedRole(e.target.value)} style={{ width: '100%', padding: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
        <option value="">Sin sugerencia</option>
        <option value="STUDENT">Estudiante</option>
        <option value="PARENT">Padre/Madre/Tutor</option>
        <option value="TEACHER">Profesor</option>
      </select>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 'var(--space-3)' }}>
        Es solo una sugerencia. La persona invitada siempre confirma su rol real en /role-select.
      </p>

      {error && <p role="alert" style={{ fontSize: 13, color: 'var(--danger, #b91c1c)', marginBottom: 'var(--space-3)' }}>{error}</p>}

      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <button className="btn" disabled={busy || !email} onClick={submit}>Enviar invitación</button>
        <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
      </div>
    </Modal>
  );
}
