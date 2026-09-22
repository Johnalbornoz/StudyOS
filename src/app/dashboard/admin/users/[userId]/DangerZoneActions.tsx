'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface ImpactItem { category: string; label: string; count: number; classification: string }
interface Impact { items: ImpactItem[]; canHardDelete: boolean; blockingReasons: string[] }

/** Permanent deletion -- only reachable when the server (re-checked, never trusted from this component's own earlier read) confirms nothing needs retaining. */
export default function DangerZoneActions({ userId, isSelf }: { userId: string; isSelf: boolean }) {
  const router = useRouter();
  const [impact, setImpact] = useState<Impact | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/admin/users/${userId}/deletion-impact`).then((r) => r.json()).then((b) => setImpact(b.data));
  }, [userId]);

  async function confirmDelete() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmationEmail: confirmEmail, reason }),
    });
    setBusy(false);
    if (res.ok) {
      router.push('/dashboard/admin/users');
      return;
    }
    const body = await res.json().catch(() => ({}));
    if (body.error === 'CONFIRMATION_MISMATCH') setError('El correo no coincide. Escribe exactamente el correo de esta cuenta.');
    else if (body.error === 'DELETION_BLOCKED') setError(`No se puede eliminar: ${body.dependencies?.join(', ')}`);
    else if (body.error === 'LAST_ADMIN_PROTECTED') setError('No se puede eliminar al único Admin StudyUS activo.');
    else if (body.error === 'SELF_DELETION_FORBIDDEN') setError('No puedes eliminar tu propia cuenta.');
    else setError('No se pudo completar la eliminación.');
  }

  if (isSelf) {
    return <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>No puedes eliminar tu propia cuenta.</p>;
  }

  if (!impact) return <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Calculando impacto…</p>;

  return (
    <div>
      <h3 style={{ fontSize: 14, marginBottom: 'var(--space-2)' }}>Análisis de impacto</h3>
      <table style={{ width: '100%', fontSize: 13, marginBottom: 'var(--space-4)', borderCollapse: 'collapse' }}>
        <tbody>
          {impact.items.map((i) => (
            <tr key={i.category} style={{ borderBottom: '1px solid var(--border-default)' }}>
              <td style={{ padding: '6px 0' }}>{i.label}</td>
              <td className="tabular" style={{ padding: '6px 0', textAlign: 'right' }}>{i.count}</td>
              <td style={{ padding: '6px 0 6px 12px', textAlign: 'right' }}>
                <span className={`chip ${i.classification === 'BLOCK_DELETION' ? 'chip-critical' : i.classification === 'RETAIN_FOR_AUDIT' ? 'chip-warn' : 'chip-good'}`} style={{ fontSize: 11 }}>
                  {i.classification === 'BLOCK_DELETION' ? 'Bloquea eliminación' : i.classification === 'RETAIN_FOR_AUDIT' ? 'Se conserva' : 'Se elimina'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {!impact.canHardDelete ? (
        <div className="card" style={{ padding: 'var(--space-3)', background: 'var(--warning-bg, #fff7ed)' }}>
          <p style={{ fontSize: 13, marginBottom: 'var(--space-2)' }}>
            No existe todavía una política de retención para datos académicos o de pago, así que la eliminación definitiva está bloqueada mientras existan estas dependencias. Puedes archivar la cuenta en su lugar (pestaña "Estado de la cuenta").
          </p>
        </div>
      ) : !confirming ? (
        <button className="btn btn-ghost" onClick={() => setConfirming(true)} style={{ color: 'var(--danger, #b91c1c)' }}>
          Eliminar definitivamente
        </button>
      ) : (
        <div>
          <p style={{ fontSize: 13, marginBottom: 'var(--space-2)', color: 'var(--danger, #b91c1c)' }}>
            Esta acción es irreversible: elimina la cuenta de Clerk y los datos internos que no requieren conservarse. Escribe el correo exacto de esta cuenta para confirmar.
          </p>
          <input
            placeholder="Correo exacto"
            value={confirmEmail}
            onChange={(e) => setConfirmEmail(e.target.value)}
            style={{ width: '100%', padding: 'var(--space-2)', marginBottom: 'var(--space-2)' }}
          />
          <input
            placeholder="Motivo (obligatorio)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            style={{ width: '100%', padding: 'var(--space-2)', marginBottom: 'var(--space-2)' }}
          />
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <button className="btn" disabled={busy || !confirmEmail || !reason} onClick={confirmDelete} style={{ background: 'var(--danger, #b91c1c)' }}>
              Confirmar eliminación definitiva
            </button>
            <button className="btn btn-ghost" onClick={() => setConfirming(false)}>Cancelar</button>
          </div>
          {error && <p role="alert" style={{ fontSize: 12, color: 'var(--danger, #b91c1c)', marginTop: 'var(--space-2)' }}>{error}</p>}
        </div>
      )}
    </div>
  );
}
