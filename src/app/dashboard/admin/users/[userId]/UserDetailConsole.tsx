'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import UserRoleActions from './UserRoleActions';
import UserStatusActions from './UserStatusActions';
import TestCleanupAction from './TestCleanupAction';
import SessionsActions from './SessionsActions';
import DangerZoneActions from './DangerZoneActions';

const ROLE_LABELS: Record<string, string> = {
  STUDENT: 'Estudiante', PARENT: 'Padre/Madre', TEACHER: 'Profesor', INSTITUTION_ADMIN: 'Coordinador', STUDYUS_ADMIN: 'Admin StudyUS',
};
const STATUS_LABELS: Record<string, string> = { ACTIVE: 'Activa', SUSPENDED: 'Suspendida', ARCHIVED: 'Archivada' };

type Tab = 'summary' | 'roles' | 'profile' | 'license' | 'relations' | 'sessions' | 'audit' | 'danger';

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'summary', label: 'Resumen' },
  { key: 'roles', label: 'Roles y acceso' },
  { key: 'profile', label: 'Perfil' },
  { key: 'license', label: 'Licencia' },
  { key: 'relations', label: 'Relaciones' },
  { key: 'sessions', label: 'Sesiones' },
  { key: 'audit', label: 'Auditoría' },
  { key: 'danger', label: 'Zona de peligro' },
];

export default function UserDetailConsole({ userId, viewerUserId }: { userId: string; viewerUserId: string }) {
  const [detail, setDetail] = useState<any>(null);
  const [tab, setTab] = useState<Tab>('summary');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/admin/users/${userId}`)
      .then((r) => {
        if (!r.ok) throw new Error('not found');
        return r.json();
      })
      .then((b) => setDetail(b.data))
      .catch(() => setError('No se pudo cargar este usuario.'));
  }, [userId]);

  if (error) return <div role="alert" className="card" style={{ padding: 'var(--space-4)', color: 'var(--danger, #b91c1c)' }}>{error}</div>;
  if (!detail) return <div style={{ padding: 'var(--space-6)' }}>Cargando…</div>;

  return (
    <div>
      <div className="card" style={{ padding: 'var(--space-4)', marginBottom: 'var(--space-4)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
          <div>
            <h2 style={{ fontSize: 18, margin: 0 }}>{detail.displayLabel}</h2>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '4px 0 0' }}>
              {detail.roles.length > 0 ? detail.roles.map((r: string) => ROLE_LABELS[r] ?? r).join(', ') : 'Sin rol'}
            </p>
          </div>
          <span className={`chip ${detail.status === 'ACTIVE' ? 'chip-good' : detail.status === 'SUSPENDED' ? 'chip-critical' : 'chip-warn'}`}>
            {STATUS_LABELS[detail.status] ?? detail.status}
          </span>
        </div>
        {detail.isTest && <p style={{ fontSize: 12, marginTop: 'var(--space-2)' }}><span className="chip chip-warn">CUENTA DE PRUEBA</span></p>}
      </div>

      <nav aria-label="Secciones del usuario" style={{ display: 'flex', gap: 'var(--space-1)', flexWrap: 'wrap', borderBottom: '1px solid var(--border-default)', marginBottom: 'var(--space-4)' }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            aria-current={tab === t.key ? 'page' : undefined}
            className="btn btn-ghost"
            style={{
              borderRadius: 0,
              borderBottom: tab === t.key ? '2px solid var(--brand-ink, #1a2332)' : '2px solid transparent',
              fontWeight: tab === t.key ? 700 : 500,
              color: t.key === 'danger' && tab !== t.key ? 'var(--danger, #b91c1c)' : undefined,
            }}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <section className="card" style={{ padding: 'var(--space-4)' }}>
        {tab === 'summary' && (
          <div>
            <p style={{ fontSize: 13.5, marginBottom: 6 }}>Espacio de trabajo activo: {detail.activeWorkspace ?? '(ninguno)'}</p>
            <p style={{ fontSize: 13.5, marginBottom: 6 }}>Creada: {new Date(detail.createdAt).toLocaleString('es')}</p>
            {detail.statusChangedAt && <p style={{ fontSize: 13.5, marginBottom: 6 }}>Último cambio de estado: {new Date(detail.statusChangedAt).toLocaleString('es')}</p>}
            <p style={{ fontSize: 13.5, marginBottom: 6 }}>Licencia activa: {detail.hasLicense ? 'sí' : 'no (modo demo)'}</p>
            {detail.testMetadata && (
              <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                Prueba — propósito: {detail.testMetadata.purpose ?? '—'}; revisar antes de: {detail.testMetadata.reviewAt ? new Date(detail.testMetadata.reviewAt).toLocaleDateString('es') : '—'}
              </p>
            )}
          </div>
        )}

        {tab === 'roles' && (
          <div>
            <h3 style={{ fontSize: 14, marginBottom: 'var(--space-2)' }}>Roles activos</h3>
            {detail.roles.length === 0 ? <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Sin roles.</p> : (
              <ul style={{ marginBottom: 'var(--space-3)' }}>
                {detail.roles.map((r: string) => <li key={r} style={{ fontSize: 13.5 }}>{ROLE_LABELS[r] ?? r}</li>)}
              </ul>
            )}
            <UserRoleActions userId={detail.userId} currentRoles={detail.roles} />
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 'var(--space-3)' }}>
              Añadir un rol nunca concede automáticamente relaciones, membresías ni licencias. Admin StudyUS no puede otorgarse desde esta pantalla; Coordinador institucional requiere el flujo institucional autorizado.
            </p>
          </div>
        )}

        {tab === 'profile' && (
          <div>
            <h3 style={{ fontSize: 14, marginBottom: 'var(--space-2)' }}>Perfiles académicos</h3>
            {detail.profiles.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Sin perfil académico.</p>
            ) : (
              <p style={{ fontSize: 13.5 }}>{detail.profiles.map((p: any) => p.type).join(', ')}</p>
            )}
            {detail.roles.includes('PARENT') && detail.profiles.some((p: any) => p.type === 'STUDENT') && (
              <p style={{ fontSize: 13, color: 'var(--danger, #b91c1c)', marginTop: 'var(--space-2)' }}>
                ⚠ Esta cuenta tiene rol Padre/Madre y también un perfil de Estudiante — revisar si es intencional.
              </p>
            )}
            {detail.institutionMemberships.length > 0 && (
              <>
                <h3 style={{ fontSize: 14, margin: 'var(--space-4) 0 var(--space-2)' }}>Membresías institucionales</h3>
                {detail.institutionMemberships.map((m: any, i: number) => (
                  <p key={i} style={{ fontSize: 13.5 }}>{m.institutionName} — {ROLE_LABELS[m.role] ?? m.role} — {m.status}</p>
                ))}
              </>
            )}
          </div>
        )}

        {tab === 'license' && (
          <div>
            {detail.subscriptionId ? (
              <>
                <p style={{ fontSize: 13.5, marginBottom: 'var(--space-2)' }}>Licencia activa: {detail.hasLicense ? 'sí' : 'no (modo demo)'}</p>
                <Link href={`/dashboard/admin/memberships/${detail.subscriptionId}`} className="btn">Ver detalle de membresía y pagos</Link>
              </>
            ) : (
              <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Esta cuenta no tiene identidad de estudiante, por lo que no aplica ninguna licencia.</p>
            )}
          </div>
        )}

        {tab === 'relations' && (
          <div>
            <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              Las relaciones padre-estudiante e instituciones se administran desde las pantallas dedicadas de invitaciones y solicitudes, para evitar que un administrador cree un vínculo sin el consentimiento del estudiante.
            </p>
          </div>
        )}

        {tab === 'sessions' && <SessionsActions userId={detail.userId} />}

        {tab === 'audit' && (
          <div>
            {detail.auditHistory.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Sin acciones registradas.</p>
            ) : (
              <ul>
                {detail.auditHistory.map((a: any, i: number) => (
                  <li key={i} style={{ fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 4 }}>
                    {new Date(a.occurredAt).toLocaleString('es')} — {a.action} — {a.result}{a.reason ? ` — ${a.reason}` : ''}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {tab === 'danger' && (
          <div>
            <h3 style={{ fontSize: 14, marginBottom: 'var(--space-3)' }}>Estado de la cuenta</h3>
            <UserStatusActions userId={detail.userId} status={detail.status} />
            {detail.isTest && (
              <>
                <h3 style={{ fontSize: 14, margin: 'var(--space-4) 0 var(--space-3)' }}>Limpieza de cuenta de prueba</h3>
                <TestCleanupAction userId={detail.userId} />
              </>
            )}
            <h3 style={{ fontSize: 14, margin: 'var(--space-4) 0 var(--space-3)', color: 'var(--danger, #b91c1c)' }}>Eliminación definitiva</h3>
            <DangerZoneActions userId={detail.userId} isSelf={detail.userId === viewerUserId} />
          </div>
        )}
      </section>
    </div>
  );
}
