'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { EmptyState } from '@/components/ui/EmptyState';
import { ApprovePaymentModal } from './ApprovePaymentModal';
import { GrantLicenseModal } from './GrantLicenseModal';

const STATUS_LABELS: Record<string, string> = {
  unpaid: 'Pago pendiente',
  payment_under_review: 'Pago en revisión',
  active: 'Activa',
  past_due: 'Pago vencido',
  suspended: 'Suspendida',
  reactivated: 'Reactivada',
  canceled: 'Cancelada',
  cancelled_at_period_end: 'Cancelada (fin de periodo)',
  expired: 'Vencida',
  refunded: 'Reembolsada',
  disputed: 'En disputa',
};

const STATUS_CHIP: Record<string, string> = {
  active: 'chip-good',
  reactivated: 'chip-good',
  unpaid: 'chip-warn',
  payment_under_review: 'chip-warn',
  past_due: 'chip-warn',
  suspended: 'chip-critical',
  disputed: 'chip-critical',
  refunded: 'chip-critical',
  canceled: 'chip-warn',
  cancelled_at_period_end: 'chip-warn',
  expired: 'chip-warn',
};

const SOURCE_LABELS: Record<string, string> = {
  INDIVIDUAL_PAYMENT: 'Pago individual',
  PARENT_PAYMENT: 'Pago de padre/madre',
  INSTITUTIONAL_LICENSE: 'Licencia institucional',
  ADMIN_PROMOTION: 'Promoción administrativa',
  TRIAL: 'Prueba',
};

interface MembershipItem {
  subscriptionId: string;
  studentId: string;
  studentLabel: string;
  plan: string | null;
  status: string;
  statusLabel: string;
  source: string | null;
  currentPeriodEnd: string | null;
  grantExpiresAt: string | null;
  createdAt: string;
}

interface Inconsistency { type: string; label: string; subscriptionId: string; studentId: string; }

export default function MembershipsConsole({ adminActorId }: { adminActorId: string }) {
  const [items, setItems] = useState<MembershipItem[] | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [source, setSource] = useState('');
  const [query, setQuery] = useState('');
  const [inconsistencies, setInconsistencies] = useState<Inconsistency[]>([]);
  const [modal, setModal] = useState<'approve' | 'grant' | null>(null);

  const pageSize = 20;

  const load = useCallback(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (status) params.set('status', status);
    if (source) params.set('source', source);
    if (query) params.set('query', query);
    fetch(`/api/admin/memberships?${params.toString()}`).then((r) => r.json()).then((b) => {
      setItems(b.data.items);
      setTotalCount(b.data.totalCount);
    });
  }, [page, status, source, query]);

  const loadInconsistencies = useCallback(() => {
    fetch('/api/admin/memberships/inconsistencies').then((r) => r.json()).then((b) => setInconsistencies(b.data.findings));
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadInconsistencies(); }, [loadInconsistencies]);

  function refreshAll() {
    load();
    loadInconsistencies();
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-4)', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', flex: 1 }}>
          <input placeholder="Buscar por correo del estudiante…" value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} style={{ padding: 'var(--space-2)', minWidth: 240 }} />
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} style={{ padding: 'var(--space-2)' }}>
            <option value="">Todos los estados</option>
            {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select value={source} onChange={(e) => { setSource(e.target.value); setPage(1); }} style={{ padding: 'var(--space-2)' }}>
            <option value="">Todas las fuentes</option>
            {Object.entries(SOURCE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <button className="btn btn-ghost" onClick={refreshAll}>↻ Recargar</button>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button className="btn btn-ghost" onClick={() => setModal('grant')}>Conceder licencia</button>
          <button className="btn" onClick={() => setModal('approve')}>+ Aprobar pago manual</button>
        </div>
      </div>

      {inconsistencies.length > 0 && (
        <div className="card" role="alert" style={{ padding: 'var(--space-3) var(--space-4)', marginBottom: 'var(--space-4)', background: 'var(--warning-bg, #fff7ed)', border: '1px solid var(--warning-border, #fdba74)' }}>
          <strong style={{ fontSize: 13.5 }}>{inconsistencies.length} inconsistencia(s) detectada(s)</strong>
          <ul style={{ margin: 'var(--space-2) 0 0', paddingLeft: 18, fontSize: 12.5 }}>
            {inconsistencies.slice(0, 5).map((f, idx) => (
              <li key={idx}>
                {f.label} — <Link href={`/dashboard/admin/memberships/${f.subscriptionId}`}>ver membresía</Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {items === null ? (
        <div style={{ padding: 'var(--space-6)' }}>Cargando…</div>
      ) : items.length === 0 ? (
        <EmptyState title="No hay membresías con estos filtros." />
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-default)' }}>
                  {['Estudiante', 'Plan', 'Estado', 'Fuente', 'Vencimiento', 'Creada', ''].map((h) => (
                    <th key={h} scope="col" style={{ textAlign: 'left', padding: 'var(--space-3)', color: 'var(--text-muted)', fontSize: 11.5, fontWeight: 650, textTransform: 'uppercase' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((m) => (
                  <tr key={m.subscriptionId} style={{ borderBottom: '1px solid var(--border-default)' }}>
                    <td style={{ padding: 'var(--space-3)' }}>{m.studentLabel}</td>
                    <td style={{ padding: 'var(--space-3)' }}>{m.plan ?? '—'}</td>
                    <td style={{ padding: 'var(--space-3)' }}>
                      <span className={`chip ${STATUS_CHIP[m.status] ?? ''}`}>{m.statusLabel}</span>
                    </td>
                    <td style={{ padding: 'var(--space-3)', color: 'var(--text-muted)' }}>{m.source ? (SOURCE_LABELS[m.source] ?? m.source) : '—'}</td>
                    <td style={{ padding: 'var(--space-3)', color: 'var(--text-muted)' }}>
                      {m.grantExpiresAt ? new Date(m.grantExpiresAt).toLocaleDateString('es') : m.currentPeriodEnd ? new Date(m.currentPeriodEnd).toLocaleDateString('es') : '—'}
                    </td>
                    <td style={{ padding: 'var(--space-3)', color: 'var(--text-muted)' }}>{new Date(m.createdAt).toLocaleDateString('es')}</td>
                    <td style={{ padding: 'var(--space-3)' }}>
                      <Link href={`/dashboard/admin/memberships/${m.subscriptionId}`} className="btn btn-ghost">Ver</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'var(--space-4)' }}>
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{totalCount} membresía(s)</span>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button className="btn btn-ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Anterior</button>
          <button className="btn btn-ghost" disabled={page * pageSize >= totalCount} onClick={() => setPage((p) => p + 1)}>Siguiente →</button>
        </div>
      </div>

      {modal === 'approve' && <ApprovePaymentModal onClose={() => setModal(null)} onDone={() => { setModal(null); refreshAll(); }} adminActorId={adminActorId} />}
      {modal === 'grant' && <GrantLicenseModal onClose={() => setModal(null)} onDone={() => { setModal(null); refreshAll(); }} adminActorId={adminActorId} />}
    </div>
  );
}
