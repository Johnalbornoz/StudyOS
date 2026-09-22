'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const ADDABLE_ROLES = ['STUDENT', 'PARENT', 'TEACHER'] as const;
const LABELS: Record<string, string> = { STUDENT: 'Estudiante', PARENT: 'Padre/Madre', TEACHER: 'Profesor' };

/** Fase 2A -- solo roles no privilegiados. INSTITUTION_ADMIN/STUDYUS_ADMIN nunca aparecen como opción para añadir (la ruta tampoco los aceptaría). */
export default function UserRoleActions({ userId, currentRoles }: { userId: string; currentRoles: string[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addRole(role: string) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/admin/users/${userId}/roles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    });
    setBusy(false);
    if (res.ok) router.refresh();
    else setError('No se pudo añadir el rol.');
  }

  async function revokeRole(role: string) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/admin/users/${userId}/roles/${role}`, { method: 'DELETE' });
    setBusy(false);
    if (res.ok) router.refresh();
    else if (res.status === 409) setError('No se puede quitar el único Admin StudyUS activo.');
    else setError('No se pudo revocar el rol.');
  }

  const addable = ADDABLE_ROLES.filter((r) => !currentRoles.includes(r));

  return (
    <div style={{ marginTop: 'var(--space-3)' }}>
      {addable.length > 0 && (
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', marginBottom: 'var(--space-2)' }}>
          {addable.map((r) => (
            <button key={r} disabled={busy} className="btn btn-ghost" onClick={() => addRole(r)}>
              Añadir {LABELS[r]}
            </button>
          ))}
        </div>
      )}
      {currentRoles.filter((r) => ADDABLE_ROLES.includes(r as any)).length > 0 && (
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          {currentRoles.filter((r) => ADDABLE_ROLES.includes(r as any)).map((r) => (
            <button key={r} disabled={busy} className="btn btn-ghost" onClick={() => revokeRole(r)}>
              Revocar {LABELS[r] ?? r}
            </button>
          ))}
        </div>
      )}
      {error && <p style={{ fontSize: 12, color: 'var(--danger, red)', marginTop: 'var(--space-2)' }}>{error}</p>}
    </div>
  );
}
