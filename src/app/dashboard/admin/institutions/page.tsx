import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { requireStudyUSAdmin } from '@/lib/admin/authorization';
import { db } from '@/lib/db';
import { listActiveInstitutions } from '@/services/institution.service';
import { getUserInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { AdminSubNav } from '../AdminSubNav';
import { CreateInstitutionForm, InviteInstitutionAdminForm } from './InstitutionAdminForms';

/**
 * StudyUS admin -- institutions. Track A: the admin creates institutions and
 * assigns each one's administrator (the only path to INSTITUTION_ADMIN).
 * Operational management (grades, classes, teachers, roster) belongs to the
 * institution's own administrators in their workspace; a StudyUS admin is
 * not an institution member, so this page no longer links into a
 * workspace that would (correctly) answer not-found for them.
 */
export default async function AdminInstitutionsPage() {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect('/sign-in');

  const admin = await requireStudyUSAdmin(clerkUserId);
  if (!admin) redirect('/dashboard');

  const locale = await getUserInterfaceLanguage(admin.actor.id).catch(() => 'es' as const);
  const t = getMessages(locale);
  const institutions = await listActiveInstitutions();
  const admins = institutions.length
    ? await db.query(
        `SELECT im.institution_id, u.email FROM institution_memberships im JOIN users u ON u.id = im.user_id
         WHERE im.institution_id = ANY($1::uuid[]) AND im.membership_role = 'INSTITUTION_ADMIN' AND im.status = 'APPROVED' ORDER BY u.email`,
        [institutions.map((i) => i.id)]
      )
    : { rows: [] as any[] };

  return (
    <div className="ta-stack">
      <div>
        <PageHeader title="Instituciones" subtitle="Instituciones activas y sus administradores. La gestión operativa vive en el espacio de cada institución." />
        <AdminSubNav active="institutions" />
      </div>

      <CreateInstitutionForm
        labels={{
          title: t['adminInst.create.title'],
          name: t['adminInst.create.name'],
          submit: t['adminInst.create.submit'],
          done: t['adminInst.create.done'],
          error: t['inst.common.error'],
        }}
      />

      {institutions.length === 0 ? (
        <EmptyState title="No hay instituciones activas." />
      ) : (
        <ul className="role-list">
          {institutions.map((inst) => {
            const emails = admins.rows.filter((r: any) => r.institution_id === inst.id).map((r: any) => r.email);
            return (
              <li key={inst.id} className="card ta-card">
                <h2>{inst.name}</h2>
                <p className="ta-msg">{emails.length > 0 ? emails.join(', ') : '—'}</p>
                <InviteInstitutionAdminForm
                  institutionId={inst.id}
                  labels={{
                    title: t['adminInst.invite.title'],
                    email: t['adminInst.invite.email'],
                    submit: t['adminInst.invite.submit'],
                    done: t['adminInst.invite.done'],
                    userNotFound: t['adminInst.invite.userNotFound'],
                    roleRevoked: t['adminInst.invite.roleRevoked'],
                    error: t['adminInst.invite.error'],
                  }}
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
