import { auth } from '@clerk/nextjs/server';
import { redirect, notFound } from 'next/navigation';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import { getInstitutionOverview, getInstitutionInterventionSummary, InstitutionIntelligenceAccessDeniedError, NoActiveAnalyticsPolicyError } from '@/lib/institution-intelligence';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
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
  let policyOpenDecision = false;
  try {
    overview = await getInstitutionOverview(actor.id, institutionId);
    summary = await getInstitutionInterventionSummary(actor.id, institutionId);
  } catch (error) {
    if (error instanceof InstitutionIntelligenceAccessDeniedError) notFound();
    if (error instanceof NoActiveAnalyticsPolicyError) {
      policyOpenDecision = true;
    } else {
      throw error;
    }
  }

  const subNavLabels = {
    overview: t['institution.overview.title'],
    grades: t['institution.grades.title'],
    classes: t['institution.classes.title'],
    teachers: t['institution.teachers.title'],
    learners: t['institution.learners.title'],
    coverage: t['institution.coverage.title'],
    readiness: t['institution.readiness.title'],
    interventions: t['institution.interventions.title'],
    attention: t['institution.attention.title'],
  };

  return (
    <div>
      <PageHeader title={overview?.institutionName ?? ''} subtitle={t['institution.interventions.title']} />
      <InstitutionSubNav institutionId={institutionId} active="interventions" labels={subNavLabels} />

      {policyOpenDecision && <EmptyState title={t['empty.smallCohortSuppressed']} />}

      {summary && !summary.cohort.suppressed && (
        <>
          <ul className="list-card card">
            {(Object.entries(summary.cohort.value.distribution.value.byStatus) as Array<[keyof typeof summary.cohort.value.distribution.value.byStatus, number]>).map(
              ([status, count]) => (
                <li key={status} className="list-row">
                  <div className="row-main">
                    <StatusBadge label={status} tone={toneForInterventionStatus(status)} />
                  </div>
                  <div className="tabular" style={{ fontWeight: 700 }}>
                    {count}
                  </div>
                </li>
              )
            )}
          </ul>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 'var(--space-2)' }}>
            {summary.cohort.value.distribution.limitations.join(' ')}
          </p>
        </>
      )}

      {summary && summary.cohort.suppressed && <EmptyState title={t['institution.learners.suppressedSmallCohort']} />}
    </div>
  );
}
