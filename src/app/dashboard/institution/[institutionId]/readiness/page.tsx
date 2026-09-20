import { auth } from '@clerk/nextjs/server';
import { redirect, notFound } from 'next/navigation';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import {
  getInstitutionOverview,
  getInstitutionReadiness,
  InstitutionIntelligenceAccessDeniedError,
  NoActiveAnalyticsPolicyError,
} from '@/lib/institution-intelligence';
import { PageHeader } from '@/components/ui/PageHeader';
import { MetricCard } from '@/components/ui/MetricCard';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusBadge, toneForReadinessStatus, toneForDimensionStatus } from '@/components/ui/StatusBadge';
import { InstitutionSubNav } from '../InstitutionSubNav';

/**
 * F14 Workstream D -- Institution Readiness (task section 7/13/19-21).
 * Consumes F12's `getInstitutionReadiness`, which reads ONLY F9's real
 * `readiness_snapshots` (INV-F12-09) -- a cohort-level DISTRIBUTION of
 * already-computed per-student overall/dimension statuses, never a
 * recomputation, never mixed with Coverage (a deliberately separate
 * page/metric, task section 7's own explicit requirement). Same
 * MIN_COHORT_POLICY OPEN_DECISION handling as the Learners page: an
 * unresolved policy renders honestly, never a fabricated threshold.
 */
export default async function InstitutionReadinessPage({
  params,
  searchParams,
}: {
  params: Promise<{ institutionId: string }>;
  searchParams: Promise<{ examVersionId?: string; classId?: string }>;
}) {
  const { institutionId } = await params;
  const { examVersionId, classId } = await searchParams;
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

  let readiness: Awaited<ReturnType<typeof getInstitutionReadiness>> | null = null;
  let policyOpenDecision = false;
  let readinessError: string | null = null;
  if (examVersionId) {
    try {
      readiness = await getInstitutionReadiness(actor.id, institutionId, { examVersionId, classId: classId || undefined });
    } catch (error) {
      if (error instanceof NoActiveAnalyticsPolicyError) policyOpenDecision = true;
      else readinessError = error instanceof Error ? error.message : t['error.generic'];
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
      <PageHeader title={overview.institutionName} subtitle={t['institution.readiness.title']} />
      <InstitutionSubNav institutionId={institutionId} active="readiness" labels={subNavLabels} />

      <form method="GET" className="card" style={{ display: 'flex', gap: 'var(--space-3)', padding: 'var(--space-4)', marginBottom: 'var(--space-6)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, fontWeight: 600 }}>
          Exam Version ID
          <input name="examVersionId" defaultValue={examVersionId} required />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, fontWeight: 600 }}>
          Class ID (optional)
          <input name="classId" defaultValue={classId} />
        </label>
        <button type="submit" className="btn btn-primary">{t['common.save']}</button>
      </form>

      {readinessError && <p role="alert" style={{ color: 'var(--error)' }}>{readinessError}</p>}
      {policyOpenDecision && <EmptyState title={t['empty.smallCohortSuppressed']} />}

      {readiness && !readiness.cohort.suppressed && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
          <MetricCard label={readiness.cohort.value.learnerCount.name} value={readiness.cohort.value.learnerCount.value} populationDescription={readiness.cohort.value.learnerCount.population.description} />

          <section>
            <h2 style={{ fontSize: 15, fontWeight: 700 }}>{t['examPrep.overallStatus']}</h2>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
              {Object.entries(readiness.cohort.value.overallStatusDistribution).map(([status, count]) => (
                <div key={status} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <StatusBadge label={t[`examPrep.status.${status}` as keyof typeof t] ?? status} tone={toneForReadinessStatus(status)} />
                  <span className="tabular">{count}</span>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 style={{ fontSize: 15, fontWeight: 700 }}>{t['examPrep.dimensions']}</h2>
            {Object.entries(readiness.cohort.value.dimensionStatusDistribution).map(([dimension, statuses]) => (
              <div key={dimension} style={{ marginBottom: 'var(--space-3)' }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{dimension}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
                  {Object.entries(statuses).map(([status, count]) => (
                    <div key={status} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <StatusBadge label={status} tone={toneForDimensionStatus(status)} />
                      <span className="tabular">{count}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </section>
        </div>
      )}

      {readiness && readiness.cohort.suppressed && <EmptyState title={t['institution.learners.suppressedSmallCohort']} />}
    </div>
  );
}
