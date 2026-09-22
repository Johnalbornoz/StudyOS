'use client';

import { useEffect, useState, useCallback } from 'react';
import { EmptyState } from '@/components/ui/EmptyState';

interface AuditEntry {
  id: string;
  actorUserId: string;
  action: string;
  targetType: string;
  targetId: string | null;
  reason: string | null;
  result: string;
  environment: string;
  occurredAt: string;
}

export default function AuditConsole() {
  const [items, setItems] = useState<AuditEntry[] | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [result, setResult] = useState('');

  const pageSize = 30;

  const load = useCallback(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (action) params.set('action', action);
    if (result) params.set('result', result);
    fetch(`/api/admin/audit?${params.toString()}`).then((r) => r.json()).then((b) => {
      setItems(b.data.items);
      setTotalCount(b.data.totalCount);
    });
  }, [page, action, result]);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-4)', flexWrap: 'wrap' }}>
        <input placeholder="Filtrar por acción (p. ej. USER_SUSPENDED)" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} style={{ padding: 'var(--space-2)', flex: 1, minWidth: 220 }} />
        <select value={result} onChange={(e) => { setResult(e.target.value); setPage(1); }} style={{ padding: 'var(--space-2)' }}>
          <option value="">Todos los resultados</option>
          <option value="SUCCESS">Éxito</option>
          <option value="FAILURE">Fallo</option>
        </select>
      </div>

      {items === null ? (
        <div style={{ padding: 'var(--space-6)' }}>Cargando…</div>
      ) : items.length === 0 ? (
        <EmptyState title="No hay registros con estos filtros." />
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-default)' }}>
                  {['Fecha', 'Acción', 'Objetivo', 'Resultado', 'Motivo', 'Ambiente'].map((h) => (
                    <th key={h} scope="col" style={{ textAlign: 'left', padding: 'var(--space-3)', color: 'var(--text-muted)', fontSize: 11.5, fontWeight: 650, textTransform: 'uppercase' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((a) => (
                  <tr key={a.id} style={{ borderBottom: '1px solid var(--border-default)' }}>
                    <td style={{ padding: 'var(--space-3)', color: 'var(--text-muted)' }}>{new Date(a.occurredAt).toLocaleString('es')}</td>
                    <td style={{ padding: 'var(--space-3)', fontWeight: 600 }}>{a.action}</td>
                    <td style={{ padding: 'var(--space-3)' }}>{a.targetType}{a.targetId ? ` · ${a.targetId.slice(0, 8)}…` : ''}</td>
                    <td style={{ padding: 'var(--space-3)' }}>
                      <span className={`chip ${a.result === 'SUCCESS' ? 'chip-good' : 'chip-critical'}`}>{a.result === 'SUCCESS' ? 'Éxito' : 'Fallo'}</span>
                    </td>
                    <td style={{ padding: 'var(--space-3)', color: 'var(--text-muted)' }}>{a.reason ?? '—'}</td>
                    <td style={{ padding: 'var(--space-3)', color: 'var(--text-muted)' }}>{a.environment}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'var(--space-4)' }}>
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{totalCount} registro(s)</span>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button className="btn btn-ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Anterior</button>
          <button className="btn btn-ghost" disabled={page * pageSize >= totalCount} onClick={() => setPage((p) => p + 1)}>Siguiente →</button>
        </div>
      </div>
    </div>
  );
}
