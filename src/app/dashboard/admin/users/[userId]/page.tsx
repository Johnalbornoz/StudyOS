import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { requireStudyUSAdmin } from '@/lib/admin/authorization';
import { PageHeader } from '@/components/ui/PageHeader';
import { AdminSubNav } from '../../AdminSubNav';
import UserDetailConsole from './UserDetailConsole';

export default async function AdminUserDetailPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect('/sign-in');

  const admin = await requireStudyUSAdmin(clerkUserId);
  if (!admin) redirect('/dashboard');

  const { userId } = await params;

  return (
    <div>
      <PageHeader title="Detalle de usuario" subtitle="Roles, perfil, licencia, relaciones y auditoría." />
      <AdminSubNav active="users" />
      <UserDetailConsole userId={userId} viewerUserId={admin.actor.id} />
    </div>
  );
}
