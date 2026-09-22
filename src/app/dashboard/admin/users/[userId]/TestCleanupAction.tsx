'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const DEP_LABELS: Record<string, string> = {
  NOT_MARKED_TEST: 'La cuenta no está marcada como prueba.',
  STUDYUS_ADMIN_ROLE: 'Tiene el rol Admin StudyUS.',
  ADMINISTERS_INSTITUTION: 'Administra una institución.',
  HAS_ACCEPTED_RELATIONSHIP: 'Tiene una relación padre-estudiante aceptada.',
  HAS_REAL_PAYMENT: 'Tiene un pago real registrado.',
};

/** Fase 2A -- limpieza exclusiva de Preview, con verificación de dependencias antes de confirmar. */
export default function TestCleanupAction({ userId }: { userId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [dependencies, setDependencies] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function attempt() {
    setBusy(true);
    setError(null);
    setDependencies(null);
    const res = await fetch(`/api/admin/users/${userId}/test-cleanup`, { method: 'POST' });
    setBusy(false);
    if (res.ok) {
      router.refresh();
    } else if (res.status === 409) {
      const body = await res.json();
      setDependencies(body.dependencies ?? []);
    } else if (res.status === 403) {
      setError('La limpieza de cuentas de prueba solo está disponible en Preview.');
    } else {
      setError('No se pudo limpiar la cuenta.');
    }
  }

  if (dependencies) {
    return (
      <div>
        <p style={{ fontSize: 13, color: 'var(--danger, red)', marginBottom: 'var(--space-2)' }}>
          No se puede limpiar esta cuenta de prueba:
        </p>
        <ul style={{ fontSize: 13, marginBottom: 'var(--space-2)' }}>
          {dependencies.map((d) => <li key={d}>{DEP_LABELS[d] ?? d}</li>)}
        </ul>
      </div>
    );
  }

  if (confirming) {
    return (
      <div>
        <p style={{ fontSize: 13, marginBottom: 'var(--space-2)' }}>
          Esto eliminará la cuenta de Clerk y archivará el registro interno. Solo procede si esta cuenta es exclusivamente de prueba, sin relaciones ni pagos reales. Esta acción no puede deshacerse.
        </p>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button className="btn" disabled={busy} onClick={attempt}>Confirmar limpieza</button>
          <button className="btn btn-ghost" onClick={() => setConfirming(false)}>Cancelar</button>
        </div>
        {error && <p style={{ fontSize: 12, color: 'var(--danger, red)', marginTop: 'var(--space-2)' }}>{error}</p>}
      </div>
    );
  }

  return (
    <div>
      <button className="btn btn-ghost" onClick={() => setConfirming(true)}>Limpiar cuenta de prueba</button>
      {error && <p style={{ fontSize: 12, color: 'var(--danger, red)', marginTop: 'var(--space-2)' }}>{error}</p>}
    </div>
  );
}
