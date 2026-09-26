import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { requireStudyUSAdmin } from '@/lib/admin/authorization';
import { getAdminOverview } from '@/services/admin-overview.service';
import { listPendingInvitations } from '@/services/user-admin.service';
import { detectMembershipInconsistencies } from '@/services/membership-admin.service';
import { detectIdentityInconsistencies, type IdentityReconciliationReport } from '@/services/identity-reconciliation.service';
import { PageHeader } from '@/components/ui/PageHeader';
import { AdminSubNav } from '../AdminSubNav';
import { StatCard } from '../StatCard';

export default async function AdminOverviewPage() {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect('/sign-in');

  const admin = await requireStudyUSAdmin(clerkUserId);
  if (!admin) redirect('/dashboard');

  const [overview, invitations, inconsistencies, identity] = await Promise.all([
    getAdminOverview(),
    listPendingInvitations().catch(() => []),
    detectMembershipInconsistencies().catch(() => []),
    detectIdentityInconsistencies().catch(
      (): IdentityReconciliationReport => ({ clerkReachable: false, humanDbUsers: 0, clerkUsers: null, items: [] })
    ),
  ]);
  const dbWithoutClerk = identity.items.filter((i) => i.kind === 'DB_WITHOUT_CLERK');
  const clerkWithoutDb = identity.items.filter((i) => i.kind === 'CLERK_WITHOUT_DB');

  return (
    <div>
      <PageHeader title="Resumen" subtitle="Estado general de cuentas, roles y membresías. Cada cifra proviene del servidor." />
      <AdminSubNav active="overview" />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 'var(--space-3)', marginBottom: 'var(--space-6)' }}>
        <StatCard label="Usuarios totales" value={overview.totalUsers} />
        <StatCard label="Activos" value={overview.activeUsers} />
        <StatCard label="Suspendidos" value={overview.suspendedUsers} tone={overview.suspendedUsers > 0 ? 'warn' : 'default'} />
        <StatCard label="Archivados" value={overview.archivedUsers} />
        <StatCard label="Estudiantes" value={overview.students} />
        <StatCard label="Padres/Madres" value={overview.parents} />
        <StatCard label="Profesores" value={overview.teachers} />
        <StatCard label="Coordinadores" value={overview.institutionAdmins} />
        <StatCard label="Cuentas de prueba" value={overview.testAccounts} />
        <StatCard label="Invitaciones pendientes" value={invitations.length} />
        <StatCard label="Solicitudes docentes pendientes" value={overview.pendingTeacherRequests} tone={overview.pendingTeacherRequests > 0 ? 'warn' : 'default'} />
        <StatCard label="Inconsistencias de membresía" value={inconsistencies.length} tone={inconsistencies.length > 0 ? 'critical' : 'default'} />
        <StatCard label="Inconsistencias Clerk ↔ StudyOS" value={identity.items.length} tone={!identity.clerkReachable ? 'warn' : identity.items.length > 0 ? 'critical' : 'default'} />
      </div>

      <section className="card" style={{ padding: 'var(--space-4)', marginBottom: 'var(--space-6)' }}>
        <h2 style={{ fontSize: 15, marginBottom: 'var(--space-2)' }}>Reconciliación de identidades (Clerk ↔ StudyOS)</h2>
        {!identity.clerkReachable ? (
          <p style={{ fontSize: 13.5, color: 'var(--text-secondary)' }}>
            No se pudo consultar Clerk: la reconciliación no está verificada en este momento (no significa 0 inconsistencias).
          </p>
        ) : identity.items.length === 0 ? (
          <p style={{ fontSize: 13.5, color: 'var(--text-secondary)' }}>
            Sin inconsistencias: {identity.humanDbUsers} cuenta(s) de StudyOS y {identity.clerkUsers} identidad(es) de Clerk coinciden.
          </p>
        ) : (
          <div style={{ fontSize: 13.5 }}>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 'var(--space-3)' }}>
              Solo detección: nada se elimina ni se repara automáticamente.
            </p>
            {dbWithoutClerk.length > 0 && (
              <>
                <h3 style={{ fontSize: 13.5, margin: 'var(--space-2) 0' }}>Cuenta de StudyOS sin identidad en Clerk ({dbWithoutClerk.length})</h3>
                <ul>
                  {dbWithoutClerk.map((i) => (
                    <li key={`db-${i.userId}`}>
                      {i.userId ? <a href={`/dashboard/admin/users/${i.userId}`}>{i.emailMasked}</a> : i.emailMasked} — estado {i.status}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {clerkWithoutDb.length > 0 && (
              <>
                <h3 style={{ fontSize: 13.5, margin: 'var(--space-2) 0' }}>Identidad de Clerk sin cuenta en StudyOS ({clerkWithoutDb.length})</h3>
                <ul>
                  {clerkWithoutDb.map((i, n) => (
                    <li key={`clerk-${n}`}>{i.emailMasked}{i.createdAt ? ` — creada ${new Date(i.createdAt).toLocaleDateString('es')}` : ''}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </section>

      {(overview.pendingTeacherRequests > 0 || invitations.length > 0 || inconsistencies.length > 0) && (
        <section className="card" style={{ padding: 'var(--space-4)' }}>
          <h2 style={{ fontSize: 15, marginBottom: 'var(--space-2)' }}>Requiere tu atención</h2>
          <ul style={{ fontSize: 13.5 }}>
            {overview.pendingTeacherRequests > 0 && <li>{overview.pendingTeacherRequests} solicitud(es) docente pendiente(s) — ver "Solicitudes pendientes"</li>}
            {invitations.length > 0 && <li>{invitations.length} invitación(es) sin aceptar — ver "Invitaciones"</li>}
            {inconsistencies.length > 0 && <li>{inconsistencies.length} inconsistencia(s) de membresía detectada(s) — ver "Membresías y pagos"</li>}
          </ul>
        </section>
      )}
    </div>
  );
}
