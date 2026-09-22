import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { requireStudyUSAdmin } from '@/lib/admin/authorization';
import { listPendingInvitations } from '@/services/user-admin.service';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { AdminSubNav } from '../AdminSubNav';
import RevokeInvitationButton from './RevokeInvitationButton';

const ROLE_LABELS: Record<string, string> = { STUDENT: 'Estudiante', PARENT: 'Padre/Madre', TEACHER: 'Profesor' };

export default async function AdminInvitationsPage() {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect('/sign-in');

  const admin = await requireStudyUSAdmin(clerkUserId);
  if (!admin) redirect('/dashboard');

  const invitations = await listPendingInvitations();

  return (
    <div>
      <PageHeader title="Invitaciones" subtitle="Invitaciones enviadas desde la consola, todavía sin aceptar." />
      <AdminSubNav active="invitations" />

      {invitations.length === 0 ? (
        <EmptyState title="No hay invitaciones pendientes." />
      ) : (
        <ul className="list-card card">
          {invitations.map((inv) => (
            <li key={inv.invitationId} className="list-row">
              <div className="row-main">
                <div className="row-title">{inv.emailMasked}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Rol sugerido: {inv.intendedRole ? ROLE_LABELS[inv.intendedRole] ?? inv.intendedRole : 'sin definir'} · Enviada {new Date(inv.createdAt).toLocaleDateString('es')}
                </div>
              </div>
              <RevokeInvitationButton invitationId={inv.invitationId} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
