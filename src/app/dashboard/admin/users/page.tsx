import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { requireStudyUSAdmin } from '@/lib/admin/authorization';
import { listUsers, listPendingInvitations, type UserListFilters } from '@/services/user-admin.service';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import InviteUserForm from './InviteUserForm';
import TestIdentityCreator from './TestIdentityCreator';

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

/**
 * Fase 2A -- global user administration. Gated exclusively by
 * `requireStudyUSAdmin` (a real, canonical `user_roles` check, not
 * merely `isAdminEmail` or the workspace label) -- see
 * src/lib/admin/authorization.ts. An INSTITUTION_ADMIN/coordinator
 * account never satisfies this gate, however many institutions they
 * administer.
 */
export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect('/sign-in');

  const admin = await requireStudyUSAdmin(clerkUserId);
  if (!admin) redirect('/dashboard');

  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const filters: UserListFilters = {
    query: sp.query || undefined,
    role: (sp.role as any) || undefined,
    status: (sp.status as any) || undefined,
    isTest: sp.isTest === 'true' ? true : sp.isTest === 'false' ? false : undefined,
  };

  const [{ items, totalCount }, invitations] = await Promise.all([
    listUsers(filters, page, 20),
    page === 1 ? listPendingInvitations(filters.query) : Promise.resolve([]),
  ]);

  return (
    <div>
      <PageHeader title="Administración de usuarios" subtitle="Consulta, invita y administra cuentas. Solo visible para un Admin StudyUS activo." />

      <section style={{ marginBottom: 'var(--space-6)', display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
        <InviteUserForm />
        <TestIdentityCreator />
      </section>

      <form method="get" style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-4)', flexWrap: 'wrap' }}>
        <input name="query" defaultValue={sp.query} placeholder="Buscar por correo o alias" style={{ padding: 'var(--space-2)', flex: 1, minWidth: 200 }} />
        <select name="role" defaultValue={sp.role ?? ''} style={{ padding: 'var(--space-2)' }}>
          <option value="">Todos los roles</option>
          {Object.entries(ROLE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select name="status" defaultValue={sp.status ?? ''} style={{ padding: 'var(--space-2)' }}>
          <option value="">Todos los estados</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select name="isTest" defaultValue={sp.isTest ?? ''} style={{ padding: 'var(--space-2)' }}>
          <option value="">Prueba y reales</option>
          <option value="true">Solo prueba</option>
          <option value="false">Solo reales</option>
        </select>
        <button type="submit" className="btn">Filtrar</button>
      </form>

      {invitations.length > 0 && (
        <section style={{ marginBottom: 'var(--space-6)' }}>
          <h2 style={{ fontSize: 15, marginBottom: 'var(--space-2)' }}>Invitaciones pendientes</h2>
          <ul className="list-card card">
            {invitations.map((inv) => (
              <li key={inv.invitationId} className="list-row">
                <div className="row-main">
                  <div className="row-title">{inv.emailMasked}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    Rol previsto: {inv.intendedRole ? ROLE_LABELS[inv.intendedRole] : 'sin definir'} · Enviada {new Date(inv.createdAt).toLocaleDateString('es')}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <h2 style={{ fontSize: 15, marginBottom: 'var(--space-2)' }}>Usuarios ({totalCount})</h2>
      {items.length === 0 ? (
        <EmptyState title="No se encontraron usuarios con estos filtros." />
      ) : (
        <ul className="list-card card">
          {items.map((u) => (
            <li key={u.userId} className="list-row">
              <div className="row-main">
                <Link href={`/dashboard/admin/users/${u.userId}`} className="row-title">
                  {u.displayLabel}
                </Link>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {u.roles.length > 0 ? u.roles.map((r) => ROLE_LABELS[r] ?? r).join(', ') : 'Sin rol'} · {STATUS_LABELS[u.status] ?? u.status}
                  {u.isTest && ' · PRUEBA'}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
        {page > 1 && (
          <Link href={`?${new URLSearchParams({ ...sp, page: String(page - 1) } as any).toString()}`} className="btn">←</Link>
        )}
        {page * 20 < totalCount && (
          <Link href={`?${new URLSearchParams({ ...sp, page: String(page + 1) } as any).toString()}`} className="btn">→</Link>
        )}
      </div>
    </div>
  );
}
