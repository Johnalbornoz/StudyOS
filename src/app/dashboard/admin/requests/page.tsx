import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { requireStudyUSAdmin } from '@/lib/admin/authorization';
import { PageHeader } from '@/components/ui/PageHeader';
import { AdminSubNav } from '../AdminSubNav';
import RequestsInbox from './RequestsInbox';

export default async function AdminRequestsPage() {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect('/sign-in');

  const admin = await requireStudyUSAdmin(clerkUserId);
  if (!admin) redirect('/dashboard');

  return (
    <div>
      <PageHeader title="Solicitudes pendientes" subtitle="Profesores y coordinadores esperando aprobación, e inconsistencias de sincronización." />
      <AdminSubNav active="requests" />
      <RequestsInbox />
    </div>
  );
}
