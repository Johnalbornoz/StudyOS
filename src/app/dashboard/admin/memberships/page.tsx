import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { requireStudyUSAdmin } from '@/lib/admin/authorization';
import { PageHeader } from '@/components/ui/PageHeader';
import { AdminSubNav } from '../AdminSubNav';
import MembershipsConsole from './MembershipsConsole';

export default async function AdminMembershipsPage() {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect('/sign-in');

  const admin = await requireStudyUSAdmin(clerkUserId);
  if (!admin) redirect('/dashboard');

  return (
    <div>
      <PageHeader title="Membresías y pagos" subtitle="Pago, suscripción, membresía y licencia de cada estudiante, sin confundirlos." />
      <AdminSubNav active="memberships" />
      <MembershipsConsole adminActorId={admin.actor.id} />
    </div>
  );
}
