import { auth } from '@clerk/nextjs/server';
import { redirect, notFound } from 'next/navigation';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import { getInstitutionOverview, InstitutionIntelligenceAccessDeniedError } from '@/lib/institution-intelligence';
import { PageHeader } from '@/components/ui/PageHeader';
import { MetricCard } from '@/components/ui/MetricCard';
import { InstitutionSubNav } from './InstitutionSubNav';

/**
 * F13 -- Institution Overview (task section 19/20). Every card renders
 * F12's own real `MetricEnvelope` fields (population, denominator,
 * limitations) -- never a bare number (task section 20). `institutionId`
 * is a client-controllable route param; `getInstitutionOverview` itself
 * independently re-verifies the actor's real, APPROVED
 * INSTITUTION_ADMIN membership to THIS exact institution before
 * returning anything (INV-F13-01/15).
 */
export default async function InstitutionOverviewPage({ params }: { params: Promise<{ institutionId: string }> }) {
  const { institutionId } = await params;
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect('/sign-in');

  const actor = await getOrCreateCanonicalUser(clerkUserId, null);
  const locale = await getInterfaceLanguage(actor.id).catch(() => 'es' as const);
  const t = getMessages(locale);

  let overview;
  try {
    overview = await getInstitutionOverview(actor.id, institutionId);
  } catch (error) {
    if (error instanceof InstitutionIntelligenceAccessDeniedError) notFound();
    throw error;
  }

  const subNavLabels = {
    overview: t['institution.overview.title'],
    learners: t['institution.learners.title'],
    interventions: t['institution.interventions.title'],
    attention: t['institution.attention.title'],
  };

  return (
    <div>
      <PageHeader title={overview.institutionName} subtitle={t['institution.overview.title']} />
      <InstitutionSubNav institutionId={institutionId} active="overview" labels={subNavLabels} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--space-4)' }}>
        <MetricCard
          label={t['institution.overview.activeTeachers']}
          value={overview.activeTeacherCount.value}
          populationDescription={overview.activeTeacherCount.population.description}
        />
        <MetricCard
          label={t['institution.overview.classes']}
          value={overview.activeClassCount.value}
          populationDescription={overview.activeClassCount.population.description}
          limitations={overview.activeClassCount.limitations}
        />
        <MetricCard
          label={t['institution.overview.uniqueLearners']}
          value={overview.uniqueActiveLearnerCount.value}
          populationDescription={overview.uniqueActiveLearnerCount.population.description}
          limitations={overview.uniqueActiveLearnerCount.limitations}
        />
        <MetricCard
          label={t['institution.overview.activeEnrollments']}
          value={overview.activeEnrollmentCount.value}
          populationDescription={overview.activeEnrollmentCount.population.description}
          limitations={overview.activeEnrollmentCount.limitations}
        />
      </div>
    </div>
  );
}
