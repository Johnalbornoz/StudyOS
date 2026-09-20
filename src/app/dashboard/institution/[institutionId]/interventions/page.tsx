import { auth } from '@clerk/nextjs/server';
import { redirect, notFound } from 'next/navigation';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import { getInstitutionOverview, getInstitutionInterventionSummary, InstitutionIntelligenceAccessDeniedError } from '@/lib/institution-intelligence';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge, toneForInterventionStatus } from '@/components/ui/StatusBadge';
import { InstitutionSubNav } from '../InstitutionSubNav';

/**
 * F13 -- Institution Intervention Intelligence (task section 19/22).
 * Renders F12's own real status/type distribution verbatim -- "Completed"
 * here means the underlying activity was operationally finalized, never
 * a performance/quality claim (task section 22, INV-F13-...).
 */
export default async function InstitutionInterventionsPage({ params }: { params: Promise<{ institutionId: string }> }) {
  const { institutionId } = await params;
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect('/sign-in');

  const actor = await getOrCreateCanonicalUser(clerkUserId, null);
  const locale = await getInterfaceLanguage(actor.id).catch(() => 'es' as const);
  const t = getMessages(locale);

  let overview;
  let summary;
  try {
    [overview, summary] = await Promise.all([
      getInstitutionOverview(actor.id, institutionId),
      getInstitutionInterventionSummary(actor.id, institutionId),
    ]);
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

  const statuses = Object.entries(summary.distribution.value.byStatus) as Array<[keyof typeof summary.distribution.value.byStatus, number]>;

  return (
    <div>
      <PageHeader title={overview.institutionName} subtitle={t['institution.interventions.title']} />
      <InstitutionSubNav institutionId={institutionId} active="interventions" labels={subNavLabels} />

      <ul className="list-card card">
        {statuses.map(([status, count]) => (
          <li key={status} className="list-row">
            <div className="row-main">
              <StatusBadge label={status} tone={toneForInterventionStatus(status)} />
            </div>
            <div className="tabular" style={{ fontWeight: 700 }}>
              {count}
            </div>
          </li>
        ))}
      </ul>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 'var(--space-2)' }}>
        {summary.distribution.limitations.join(' ')}
      </p>
    </div>
  );
}
