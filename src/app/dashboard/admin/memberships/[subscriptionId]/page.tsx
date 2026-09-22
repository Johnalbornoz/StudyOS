import { auth } from '@clerk/nextjs/server';
import { redirect, notFound } from 'next/navigation';
import { requireStudyUSAdmin } from '@/lib/admin/authorization';
import { getMembershipDetail } from '@/services/membership-admin.service';
import { PageHeader } from '@/components/ui/PageHeader';
import { AdminSubNav } from '../../AdminSubNav';
import MembershipDetailConsole from './MembershipDetailConsole';

export default async function AdminMembershipDetailPage({ params }: { params: Promise<{ subscriptionId: string }> }) {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect('/sign-in');

  const admin = await requireStudyUSAdmin(clerkUserId);
  if (!admin) redirect('/dashboard');

  const { subscriptionId } = await params;
  const detail = await getMembershipDetail(subscriptionId, admin.actor.id);
  if (!detail) notFound();

  return (
    <div>
      <PageHeader
        title={`Membresía · ${detail.studentLabel}`}
        subtitle="Pago, licencia y estado comercial de este estudiante."
        breadcrumb={<a href="/dashboard/admin/memberships">← Membresías y pagos</a>}
      />
      <AdminSubNav active="memberships" />
      <MembershipDetailConsole initialDetail={detail} />
    </div>
  );
}
