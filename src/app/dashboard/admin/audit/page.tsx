import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { requireStudyUSAdmin } from '@/lib/admin/authorization';
import { PageHeader } from '@/components/ui/PageHeader';
import { AdminSubNav } from '../AdminSubNav';
import AuditConsole from './AuditConsole';

export default async function AdminAuditPage() {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect('/sign-in');

  const admin = await requireStudyUSAdmin(clerkUserId);
  if (!admin) redirect('/dashboard');

  return (
    <div>
      <PageHeader title="Auditoría" subtitle="Historial de acciones administrativas. Nunca incluye contraseñas ni secretos." />
      <AdminSubNav active="audit" />
      <AuditConsole />
    </div>
  );
}
