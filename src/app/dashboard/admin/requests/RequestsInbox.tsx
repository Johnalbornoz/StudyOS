'use client';

import { useEffect, useState, useCallback } from 'react';
import { EmptyState } from '@/components/ui/EmptyState';

export default function RequestsInbox() {
  const [data, setData] = useState<{ institutionRequests: any[]; invitations: any[]; syncErrors: string[] } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetch('/api/admin/requests').then((r) => r.json()).then((b) => setData(b.data));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function decide(membershipId: string, decision: 'APPROVED' | 'REJECTED') {
    setBusy(true);
    await fetch(`/api/admin/requests/${membershipId}/decide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision }),
    });
    setBusy(false);
    load();
  }

  async function reconcileSync(userId: string) {
    setBusy(true);
    await fetch(`/api/admin/users/${userId}/reconcile`, { method: 'POST' });
    setBusy(false);
    load();
  }

  if (!data) return <div style={{ padding: 'var(--space-6)' }}>Cargando…</div>;

  return (
    <div>
      <section style={{ marginBottom: 'var(--space-6)' }}>
        <h2 style={{ fontSize: 15, marginBottom: 'var(--space-2)' }}>Membresías institucionales pendientes</h2>
        {data.institutionRequests.length === 0 ? (
          <EmptyState title="No hay solicitudes de profesor o coordinador pendientes." />
        ) : (
          <ul className="list-card card">
            {data.institutionRequests.map((r: any) => (
              <li key={r.id} className="list-row">
                <div className="row-main">
                  <div className="row-title">{r.institutionName}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    Rol solicitado: {r.membershipRole === 'TEACHER' ? 'Profesor' : 'Coordinador'} · Solicitado {r.requestedAt ? new Date(r.requestedAt).toLocaleDateString('es') : '—'}
                  </div>
                </div>
                <span style={{ display: 'flex', gap: 8 }}>
                  <button className="btn" disabled={busy} onClick={() => decide(r.id, 'APPROVED')}>Aprobar</button>
                  <button className="btn btn-ghost" disabled={busy} onClick={() => decide(r.id, 'REJECTED')}>Rechazar</button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section style={{ marginBottom: 'var(--space-6)' }}>
        <h2 style={{ fontSize: 15, marginBottom: 'var(--space-2)' }}>Invitaciones sin aceptar</h2>
        {data.invitations.length === 0 ? (
          <EmptyState title="No hay invitaciones pendientes." />
        ) : (
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>{data.invitations.length} invitación(es) — ver detalle en la sección "Invitaciones".</p>
        )}
      </section>

      <section>
        <h2 style={{ fontSize: 15, marginBottom: 'var(--space-2)' }}>Inconsistencias Clerk ↔ StudyUS</h2>
        {data.syncErrors.length === 0 ? (
          <EmptyState title="No se detectaron inconsistencias en la muestra reciente." />
        ) : (
          <ul className="list-card card">
            {data.syncErrors.map((userId) => (
              <li key={userId} className="list-row">
                <div className="row-main">
                  <div className="row-title">Cuenta interna sin usuario de Clerk correspondiente</div>
                </div>
                <button className="btn btn-ghost" disabled={busy} onClick={() => reconcileSync(userId)}>Marcar revisado</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
