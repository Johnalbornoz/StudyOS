'use client';

import { useEffect, useState, useCallback } from 'react';
import { EmptyState } from '@/components/ui/EmptyState';

/** Track A: who is asking -- "Nombre · email", or the email alone; never an internal id. */
function who(name: string | null | undefined, email: string | null | undefined): string {
  if (name && email) return `${name} · ${email}`;
  return name || email || 'Cuenta sin correo registrado';
}

export default function RequestsInbox() {
  const [data, setData] = useState<{ institutionRequests: any[]; invitations: any[]; syncErrors: string[]; syncAccounts?: any[] } | null>(null);
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
              <li key={r.id} className="list-row" style={{ flexWrap: 'wrap' }}>
                <div className="row-main" style={{ flexBasis: 240 }}>
                  <div className="row-title" style={{ overflowWrap: 'anywhere' }}>{who(r.requesterName, r.requesterEmail)}</div>
                  <div className="row-sub">
                    {r.membershipRole === 'TEACHER' ? 'Profesor' : 'Coordinador'} · {r.institutionName} · Solicitado {r.requestedAt ? new Date(r.requestedAt).toLocaleDateString('es') : '—'}
                  </div>
                </div>
                <span className="ta-actions">
                  <button className="btn btn-secondary" disabled={busy} onClick={() => decide(r.id, 'REJECTED')} aria-label={`Rechazar a ${who(r.requesterName, r.requesterEmail)} en ${r.institutionName}`}>Rechazar</button>
                  <button className="btn btn-primary" disabled={busy} onClick={() => decide(r.id, 'APPROVED')} aria-label={`Aprobar a ${who(r.requesterName, r.requesterEmail)} en ${r.institutionName}`}>Aprobar</button>
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
            {(data.syncAccounts ?? data.syncErrors.map((userId) => ({ userId }))).map((a: any) => (
              <li key={a.userId} className="list-row" style={{ flexWrap: 'wrap' }}>
                <div className="row-main" style={{ flexBasis: 240 }}>
                  <div className="row-title" style={{ overflowWrap: 'anywhere' }}>{who(a.name, a.email)}</div>
                  <div className="row-sub">
                    Existe en StudyUS pero no en Clerk · estado {a.status ?? '—'}
                    {a.roles?.length ? ` · ${a.roles.join(', ')}` : ''}
                    {a.isTest ? ' · cuenta de prueba' : ''}
                  </div>
                </div>
                <span className="ta-actions">
                  <a className="btn btn-ghost" href={`/dashboard/admin/users/${a.userId}`}>Ver ficha</a>
                  <button className="btn btn-ghost" disabled={busy} onClick={() => reconcileSync(a.userId)}>Marcar revisado</button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
