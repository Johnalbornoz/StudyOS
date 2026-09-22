import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { requireStudyUSAdmin } from '@/lib/admin/authorization';
import { listActiveInstitutions } from '@/services/institution.service';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { AdminSubNav } from '../AdminSubNav';

/**
 * A lightweight index into the institution intelligence workspace
 * that already exists (`/dashboard/institution/[id]/**`), not a
 * duplicate of it -- institution-level operational data (grades,
 * classes, coverage, readiness) has its own, already-built,
 * already-certified surface; this console only needs to route a
 * STUDYUS_ADMIN there and show which institutions exist.
 */
export default async function AdminInstitutionsPage() {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect('/sign-in');

  const admin = await requireStudyUSAdmin(clerkUserId);
  if (!admin) redirect('/dashboard');

  const institutions = await listActiveInstitutions();

  return (
    <div>
      <PageHeader title="Instituciones" subtitle="Instituciones activas. La gestión operativa detallada vive en el espacio de cada institución." />
      <AdminSubNav active="institutions" />

      {institutions.length === 0 ? (
        <EmptyState title="No hay instituciones activas." />
      ) : (
        <ul className="list-card card">
          {institutions.map((inst) => (
            <li key={inst.id} className="list-row">
              <div className="row-main">
                <div className="row-title">{inst.name}</div>
              </div>
              <Link href={`/dashboard/institution/${inst.id}/requests`} className="btn btn-ghost">Ver solicitudes y profesores</Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
