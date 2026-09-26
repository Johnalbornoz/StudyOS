'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import CreateUserModal from './CreateUserModal';
import InviteUserModal from './InviteUserModal';

const ROLE_LABELS: Record<string, string> = {
  STUDENT: 'Estudiante',
  PARENT: 'Padre/Madre',
  TEACHER: 'Profesor',
  INSTITUTION_ADMIN: 'Coordinador',
  STUDYUS_ADMIN: 'Admin StudyUS',
};
const STATUS_LABELS: Record<string, string> = { ACTIVE: 'Activa', SUSPENDED: 'Suspendida', ARCHIVED: 'Archivada' };
const STATUS_TONE: Record<string, string> = { ACTIVE: 'chip-good', SUSPENDED: 'chip-critical', ARCHIVED: 'chip-warn' };

interface UserRow {
  userId: string;
  displayLabel: string;
  status: string;
  activeWorkspace: string | null;
  roles: string[];
  isTest: boolean;
  hasLicense: boolean;
  syncState: string;
  createdAt: string;
}

export default function UsersConsole() {
  const [items, setItems] = useState<UserRow[] | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [openMenuFor, setOpenMenuFor] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pageSize = 20;

  const load = useCallback(async () => {
    setError(null);
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (query) params.set('query', query);
    if (role) params.set('role', role);
    if (status) params.set('status', status);
    const res = await fetch(`/api/admin/users?${params.toString()}`);
    if (!res.ok) {
      setError('No se pudo cargar la lista de usuarios.');
      return;
    }
    const body = await res.json();
    setItems(body.data.users);
    setTotalCount(body.data.totalCount);
  }, [page, query, role, status]);

  useEffect(() => {
    load();
  }, [load]);

  function onQueryChange(value: string) {
    setQuery(value);
    setPage(1);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(load, 350);
  }

  async function quickAction(userId: string, action: 'suspend' | 'reactivate' | 'archive') {
    setOpenMenuFor(null);
    if (action === 'reactivate') {
      await fetch(`/api/admin/users/${userId}/reactivate`, { method: 'POST' });
      load();
      return;
    }
    const reason = window.prompt(action === 'suspend' ? 'Motivo de la suspensión (obligatorio):' : 'Motivo del archivo (obligatorio):');
    if (!reason) return;
    await fetch(`/api/admin/users/${userId}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
    load();
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-4)', flexWrap: 'wrap' }}>
        <button className="btn" onClick={() => setCreating(true)}>+ Crear usuario</button>
        <button className="btn btn-ghost" onClick={() => setInviting(true)}>Invitar por correo</button>
        <button className="btn btn-ghost" onClick={load} aria-label="Recargar lista">↻ Recargar</button>
      </div>

      <form
        onSubmit={(e) => e.preventDefault()}
        style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-4)', flexWrap: 'wrap' }}
      >
        <input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Buscar por correo o alias"
          aria-label="Buscar usuarios"
          style={{ padding: 'var(--space-2)', flex: 1, minWidth: 220 }}
        />
        <select value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }} aria-label="Filtrar por rol" style={{ padding: 'var(--space-2)' }}>
          <option value="">Todos los roles</option>
          {Object.entries(ROLE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Filtrar por estado" style={{ padding: 'var(--space-2)' }}>
          <option value="">Todos los estados</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </form>

      {error && (
        <div className="card" style={{ padding: 'var(--space-3)', marginBottom: 'var(--space-4)', color: 'var(--danger, #b91c1c)' }} role="alert">
          {error} <button className="btn btn-ghost" onClick={load}>Reintentar</button>
        </div>
      )}

      {items === null ? (
        <div aria-live="polite" style={{ padding: 'var(--space-6)' }}>
          {[...Array(5)].map((_, i) => (
            <div key={i} style={{ height: 44, background: 'var(--border-default)', opacity: 0.4, borderRadius: 6, marginBottom: 8 }} />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="empty-state">
          <strong>No se encontraron usuarios con estos filtros.</strong>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-default)' }}>
                  {['Usuario', 'Roles', 'Estado', 'Licencia', 'Creado', ''].map((h) => (
                    <th key={h} scope="col" style={{ textAlign: 'left', padding: 'var(--space-3) var(--space-4)', color: 'var(--text-muted)', fontSize: 12, fontWeight: 650, textTransform: 'uppercase', letterSpacing: '0.02em' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((u) => (
                  <tr key={u.userId} style={{ borderBottom: '1px solid var(--border-default)' }}>
                    <td style={{ padding: 'var(--space-3) var(--space-4)' }}>
                      <Link href={`/dashboard/admin/users/${u.userId}`} style={{ fontWeight: 600 }}>{u.displayLabel}</Link>
                      {u.isTest && <span className="chip chip-warn" style={{ marginLeft: 8, fontSize: 11 }}>PRUEBA</span>}
                      {u.syncState === 'CLERK_MISSING' && (
                        <span className="chip chip-critical" style={{ marginLeft: 8, fontSize: 11 }} title="Esta cuenta de StudyOS no tiene identidad en Clerk: no puede iniciar sesión.">SIN CLERK</span>
                      )}
                      {u.syncState === 'UNVERIFIED' && (
                        <span className="chip" style={{ marginLeft: 8, fontSize: 11 }} title="No se pudo consultar Clerk para verificar esta cuenta.">SIN VERIFICAR</span>
                      )}
                    </td>
                    <td style={{ padding: 'var(--space-3) var(--space-4)', color: 'var(--text-secondary)' }}>
                      {u.roles.length > 0 ? u.roles.map((r) => ROLE_LABELS[r] ?? r).join(', ') : 'Sin rol'}
                    </td>
                    <td style={{ padding: 'var(--space-3) var(--space-4)' }}>
                      <span className={`chip ${STATUS_TONE[u.status] ?? ''}`}>{STATUS_LABELS[u.status] ?? u.status}</span>
                    </td>
                    <td style={{ padding: 'var(--space-3) var(--space-4)' }}>{u.hasLicense ? 'Sí' : 'Demo'}</td>
                    <td style={{ padding: 'var(--space-3) var(--space-4)', color: 'var(--text-muted)' }}>{new Date(u.createdAt).toLocaleDateString('es')}</td>
                    <td style={{ padding: 'var(--space-3) var(--space-4)', textAlign: 'right', position: 'relative' }}>
                      <button className="btn btn-ghost" onClick={() => setOpenMenuFor(openMenuFor === u.userId ? null : u.userId)} aria-haspopup="true" aria-expanded={openMenuFor === u.userId}>
                        Acciones ⌄
                      </button>
                      {openMenuFor === u.userId && (
                        <div
                          role="menu"
                          style={{
                            position: 'absolute', right: 'var(--space-4)', top: '100%', zIndex: 10,
                            background: 'var(--surface, #fff)', border: '1px solid var(--border-default)', borderRadius: 8,
                            boxShadow: '0 4px 16px rgba(0,0,0,0.12)', minWidth: 160, padding: 'var(--space-1)',
                          }}
                        >
                          <Link href={`/dashboard/admin/users/${u.userId}`} className="btn btn-ghost" style={{ display: 'block', width: '100%', textAlign: 'left' }}>Ver detalle</Link>
                          {u.status !== 'SUSPENDED' && <button className="btn btn-ghost" style={{ display: 'block', width: '100%', textAlign: 'left' }} onClick={() => quickAction(u.userId, 'suspend')}>Suspender</button>}
                          {u.status !== 'ACTIVE' && <button className="btn btn-ghost" style={{ display: 'block', width: '100%', textAlign: 'left' }} onClick={() => quickAction(u.userId, 'reactivate')}>Reactivar</button>}
                          {u.status !== 'ARCHIVED' && <button className="btn btn-ghost" style={{ display: 'block', width: '100%', textAlign: 'left' }} onClick={() => quickAction(u.userId, 'archive')}>Archivar</button>}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'var(--space-4)' }}>
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{totalCount} usuario(s) en total</span>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button className="btn btn-ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Anterior</button>
          <button className="btn btn-ghost" disabled={page * pageSize >= totalCount} onClick={() => setPage((p) => p + 1)}>Siguiente →</button>
        </div>
      </div>

      {creating && <CreateUserModal onClose={() => setCreating(false)} onCreated={() => { setCreating(false); load(); }} />}
      {inviting && <InviteUserModal onClose={() => setInviting(false)} onSent={() => { setInviting(false); load(); }} />}
    </div>
  );
}
