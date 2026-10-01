import { auth } from '@clerk/nextjs/server';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { requireStudyUSAdmin } from '@/lib/admin/authorization';
import { getInstitutionProfile, listCoordinators } from '@/services/institution-admin.service';
import { getUserInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages, type MessageKey } from '@/lib/i18n/messages';
import { institutionProfileLabels, coordinatorsLabels } from '@/lib/institution/admin-labels';
import { PageHeader } from '@/components/ui/PageHeader';
import { InstitutionProfileForm } from '@/components/institution/InstitutionProfileForm';
import { CoordinatorsPanel } from '@/components/institution/CoordinatorsPanel';
import { AdminSubNav } from '../../AdminSubNav';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Platform Admin -- one institution: profile (incl. name and status) and its coordinators. */
export default async function AdminInstitutionDetailPage({ params }: { params: Promise<{ institutionId: string }> }) {
  const { institutionId } = await params;
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect('/sign-in');
  const admin = await requireStudyUSAdmin(clerkUserId);
  if (!admin) redirect('/dashboard');
  if (!UUID_RE.test(institutionId)) notFound();

  const institution = await getInstitutionProfile(institutionId);
  if (!institution) notFound();
  const coordinators = await listCoordinators(institutionId);
  const locale = await getUserInterfaceLanguage(admin.actor.id).catch(() => 'es' as const);
  const t = getMessages(locale);

  return (
    <div className="ta-stack">
      <div>
        <PageHeader
          title={institution.displayName || institution.name}
          subtitle={t[`ia.status.${institution.status}` as MessageKey]}
          breadcrumb={<Link href="/dashboard/admin/institutions">{t['ia.detail.back']}</Link>}
        />
        <AdminSubNav active="institutions" />
      </div>
      <CoordinatorsPanel apiBase={`/api/admin/institutions/${institutionId}`} coordinators={coordinators} locale={locale} labels={coordinatorsLabels(t, t['ia.coord.body'])} />
      <InstitutionProfileForm
        mode="platform-edit"
        endpoint={`/api/admin/institutions/${institutionId}`}
        statusOptions={['ACTIVE', 'DRAFT', 'SUSPENDED', 'ARCHIVED']}
        initial={{
          name: institution.name,
          displayName: institution.displayName ?? '',
          country: institution.country ?? '',
          region: institution.region ?? '',
          curriculum: institution.curriculum ?? '',
          status: institution.status,
          primaryContactName: institution.primaryContactName ?? '',
          primaryContactEmail: institution.primaryContactEmail ?? '',
          timezone: institution.timezone ?? '',
          locale: institution.locale ?? 'es',
        }}
        labels={institutionProfileLabels(t, t['ia.edit.title'], t['ia.save'])}
      />
    </div>
  );
}
