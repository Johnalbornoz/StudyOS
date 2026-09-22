import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { requireStudyUSAdmin } from '@/lib/admin/authorization';
import { listUsers } from '@/services/user-admin.service';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { AdminSubNav } from '../AdminSubNav';
import TestIdentityCreator from './TestIdentityCreator';
import Link from 'next/link';

const ROLE_LABELS: Record<string, string> = { STUDENT: 'Estudiante', PARENT: 'Padre/Madre', TEACHER: 'Profesor' };

export default async function AdminTestAccountsPage() {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect('/sign-in');

  const admin = await requireStudyUSAdmin(clerkUserId);
  if (!admin) redirect('/dashboard');

  const { items } = await listUsers({ isTest: true }, 1, 50);

  return (
    <div>
      <PageHeader title="Cuentas de prueba" subtitle="Identidades desechables, marcadas y aisladas para validar flujos sin usar datos reales." />
      <AdminSubNav active="test-accounts" />

      <div style={{ marginBottom: 'var(--space-4)' }}>
        <TestIdentityCreator />
      </div>

      {items.length === 0 ? (
        <EmptyState title="No hay cuentas de prueba todavía." />
      ) : (
        <ul className="list-card card">
          {items.map((u) => (
            <li key={u.userId} className="list-row">
              <div className="row-main">
                <Link href={`/dashboard/admin/users/${u.userId}`} className="row-title">{u.displayLabel}</Link>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {u.roles.length > 0 ? u.roles.map((r) => ROLE_LABELS[r] ?? r).join(', ') : 'Sin rol'} · {u.status}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
