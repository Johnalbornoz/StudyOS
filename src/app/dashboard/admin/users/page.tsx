import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { requireStudyUSAdmin } from '@/lib/admin/authorization';
import { PageHeader } from '@/components/ui/PageHeader';
import { AdminSubNav } from '../AdminSubNav';
import UsersConsole from './UsersConsole';

/**
 * Professional Admin Console -- redesigned 2026-09-21. The server
 * component's only job is the real authorization gate (never trust a
 * client-side check); everything interactive (search, filters, sort,
 * pagination, create/action modals) lives in `UsersConsole`, a client
 * component driving the same `/api/admin/users` API the previous
 * prototype used -- no route or authorization changed, only the
 * experience built on top of it.
 */
export default async function AdminUsersPage() {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect('/sign-in');

  const admin = await requireStudyUSAdmin(clerkUserId);
  if (!admin) redirect('/dashboard');

  return (
    <div>
      <PageHeader title="Usuarios" subtitle="Consulta, crea y administra cuentas." />
      <AdminSubNav active="users" />
      <UsersConsole />
    </div>
  );
}
