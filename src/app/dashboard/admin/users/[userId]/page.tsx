import { auth } from '@clerk/nextjs/server';
import { redirect, notFound } from 'next/navigation';
import { requireStudyUSAdmin } from '@/lib/admin/authorization';
import { getUserDetail } from '@/services/user-admin.service';
import { PageHeader } from '@/components/ui/PageHeader';
import UserRoleActions from './UserRoleActions';
import UserStatusActions from './UserStatusActions';
import TestCleanupAction from './TestCleanupAction';

const ROLE_LABELS: Record<string, string> = {
  STUDENT: 'Estudiante',
  PARENT: 'Padre/Madre',
  TEACHER: 'Profesor',
  INSTITUTION_ADMIN: 'Coordinador',
  STUDYUS_ADMIN: 'Admin StudyUS',
};

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Activa',
  SUSPENDED: 'Suspendida',
  ARCHIVED: 'Archivada',
};

export default async function AdminUserDetailPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect('/sign-in');

  const admin = await requireStudyUSAdmin(clerkUserId);
  if (!admin) redirect('/dashboard');

  const { userId } = await params;
  const detail = await getUserDetail(userId);
  if (!detail) notFound();

  return (
    <div>
      <PageHeader title={detail.displayLabel} subtitle={`Estado: ${STATUS_LABELS[detail.status] ?? detail.status}${detail.isTest ? ' · Cuenta de prueba' : ''}`} />

      <section className="card" style={{ padding: 'var(--space-4)', marginBottom: 'var(--space-4)' }}>
        <h2 style={{ fontSize: 14, marginBottom: 'var(--space-2)' }}>Identidad</h2>
        <p style={{ fontSize: 13 }}>Espacio de trabajo activo: {detail.activeWorkspace ?? '(ninguno)'}</p>
        <p style={{ fontSize: 13 }}>Perfiles académicos: {detail.profiles.length === 0 ? 'ninguno' : detail.profiles.map((p) => p.type).join(', ')}</p>
        <p style={{ fontSize: 13 }}>Licencia activa: {detail.hasLicense ? 'sí' : 'no'}</p>
        <p style={{ fontSize: 13 }}>Creada: {new Date(detail.createdAt).toLocaleString('es')}</p>
        {detail.statusChangedAt && <p style={{ fontSize: 13 }}>Último cambio de estado: {new Date(detail.statusChangedAt).toLocaleString('es')}</p>}
        {detail.testMetadata && (
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Prueba — propósito: {detail.testMetadata.purpose ?? '—'}; revisar antes de: {detail.testMetadata.reviewAt ? new Date(detail.testMetadata.reviewAt).toLocaleDateString('es') : '—'}
          </p>
        )}
      </section>

      <section className="card" style={{ padding: 'var(--space-4)', marginBottom: 'var(--space-4)' }}>
        <h2 style={{ fontSize: 14, marginBottom: 'var(--space-2)' }}>Roles activos</h2>
        {detail.roles.length === 0 ? <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Sin roles.</p> : (
          <ul>
            {detail.roles.map((r) => (
              <li key={r} style={{ fontSize: 13 }}>{ROLE_LABELS[r] ?? r}</li>
            ))}
          </ul>
        )}
        <UserRoleActions userId={detail.userId} currentRoles={detail.roles} />
      </section>

      {detail.institutionMemberships.length > 0 && (
        <section className="card" style={{ padding: 'var(--space-4)', marginBottom: 'var(--space-4)' }}>
          <h2 style={{ fontSize: 14, marginBottom: 'var(--space-2)' }}>Membresías institucionales</h2>
          {detail.institutionMemberships.map((m, i) => (
            <p key={i} style={{ fontSize: 13 }}>{m.institutionName} — {ROLE_LABELS[m.role] ?? m.role} — {m.status}</p>
          ))}
        </section>
      )}

      <section className="card" style={{ padding: 'var(--space-4)', marginBottom: 'var(--space-4)' }}>
        <h2 style={{ fontSize: 14, marginBottom: 'var(--space-2)' }}>Estado de la cuenta</h2>
        <UserStatusActions userId={detail.userId} status={detail.status} />
      </section>

      {detail.isTest && (
        <section className="card" style={{ padding: 'var(--space-4)', marginBottom: 'var(--space-4)' }}>
          <h2 style={{ fontSize: 14, marginBottom: 'var(--space-2)' }}>Limpieza de cuenta de prueba</h2>
          <TestCleanupAction userId={detail.userId} />
        </section>
      )}

      <section className="card" style={{ padding: 'var(--space-4)' }}>
        <h2 style={{ fontSize: 14, marginBottom: 'var(--space-2)' }}>Historial de acciones administrativas</h2>
        {detail.auditHistory.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Sin acciones registradas.</p>
        ) : (
          <ul>
            {detail.auditHistory.map((a, i) => (
              <li key={i} style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {new Date(a.occurredAt).toLocaleString('es')} — {a.action} — {a.result}{a.reason ? ` — ${a.reason}` : ''}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
