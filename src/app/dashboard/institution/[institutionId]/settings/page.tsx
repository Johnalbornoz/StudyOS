import { auth } from '@clerk/nextjs/server';
import { redirect, notFound } from 'next/navigation';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { getUserInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import { getInstitutionOverview, InstitutionIntelligenceAccessDeniedError } from '@/lib/institution-intelligence';
import { getInstitutionProfile } from '@/services/institution-admin.service';
import { institutionProfileLabels, institutionSubNavLabels } from '@/lib/institution/admin-labels';
import { PageHeader } from '@/components/ui/PageHeader';
import { InstitutionProfileForm } from '@/components/institution/InstitutionProfileForm';
import { InstitutionSubNav } from '../InstitutionSubNav';

/** Track A -- a coordinator edits the descriptive data of its own institution (name and status stay with StudyUS). */
export default async function InstitutionSettingsPage({ params }: { params: Promise<{ institutionId: string }> }) {
  const { institutionId } = await params;
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect('/sign-in');
  const actor = await getOrCreateCanonicalUser(clerkUserId, null);
  const locale = await getUserInterfaceLanguage(actor.id).catch(() => 'es' as const);
  const t = getMessages(locale);

  let overview;
  try {
    overview = await getInstitutionOverview(actor.id, institutionId);
  } catch (error) {
    if (error instanceof InstitutionIntelligenceAccessDeniedError) notFound();
    throw error;
  }
  const profile = await getInstitutionProfile(institutionId);
  if (!profile) notFound();

  return (
    <div className="ta-stack">
      <div>
        <PageHeader title={overview.institutionName} subtitle={t['ia.settings.subtitle']} />
        <InstitutionSubNav institutionId={institutionId} active="settings" labels={institutionSubNavLabels(t)} />
      </div>
      <InstitutionProfileForm
        mode="coordinator"
        endpoint={`/api/institutions/${institutionId}`}
        statusOptions={[]}
        initial={{
          name: profile.name,
          displayName: profile.displayName ?? '',
          country: profile.country ?? '',
          region: profile.region ?? '',
          curriculum: profile.curriculum ?? '',
          primaryContactName: profile.primaryContactName ?? '',
          primaryContactEmail: profile.primaryContactEmail ?? '',
          timezone: profile.timezone ?? '',
          locale: profile.locale ?? 'es',
        }}
        labels={institutionProfileLabels(t, t['ia.settings.title'], t['ia.save'])}
      />
    </div>
  );
}
