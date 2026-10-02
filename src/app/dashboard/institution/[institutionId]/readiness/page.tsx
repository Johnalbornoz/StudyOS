import { auth } from '@clerk/nextjs/server';
import { redirect, notFound } from 'next/navigation';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { getUserInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import {
  getInstitutionOverview,
  getInstitutionReadiness,
  InstitutionIntelligenceAccessDeniedError,
  NoActiveAnalyticsPolicyError,
} from '@/lib/institution-intelligence';
import { MetricCard } from '@/components/ui/MetricCard';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusBadge, toneForReadinessStatus, toneForDimensionStatus } from '@/components/ui/StatusBadge';
import { IntelligenceHeader, NoCurriculum, loadContext } from '../intelligence-chrome';

/**
 * F14 / Track A -- Institution Readiness. Consumes F12's
 * `getInstitutionReadiness` (only F9's real `readiness_snapshots`, a
 * cohort-level distribution, never recomputed). The exam is chosen among
 * the exams whose blueprint covers the selected curriculum, and the class
 * among the institution's classes of that grade / subject -- never typed.
 * Same MIN_COHORT_POLICY OPEN_DECISION handling as before.
 */
export default async function InstitutionReadinessPage({ params, searchParams }: { params: Promise<{ institutionId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { institutionId } = await params;
  const sp = await searchParams;
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect('/sign-in');
  const actor = await getOrCreateCanonicalUser(clerkUserId, null);
  const locale = await getUserInterfaceLanguage(actor.id).catch(() => 'es' as const);
  const t = getMessages(locale);

  let overview;
  let ctx;
  try {
    overview = await getInstitutionOverview(actor.id, institutionId);
    ctx = await loadContext(actor.id, institutionId, sp, t);
  } catch (error) {
    if (error instanceof InstitutionIntelligenceAccessDeniedError) notFound();
    throw error;
  }

  const header = <IntelligenceHeader t={t} institutionId={institutionId} institutionName={overview.institutionName} tab="readiness" ctx={ctx} show={{ curriculum: true, period: false, class: true, exam: true }} />;
  if (!ctx.selected) {
    return (
      <div>
        {header}
        <NoCurriculum t={t} institutionId={institutionId} />
      </div>
    );
  }
  if (!ctx.examVersionId) {
    return (
      <div>
        {header}
        <EmptyState title={t['iix.empty.readinessNoExam']} />
      </div>
    );
  }

  let readiness: Awaited<ReturnType<typeof getInstitutionReadiness>> | null = null;
  let policyOpenDecision = false;
  try {
    readiness = await getInstitutionReadiness(actor.id, institutionId, { examVersionId: ctx.examVersionId, classId: ctx.classId ?? undefined });
  } catch (error) {
    if (error instanceof NoActiveAnalyticsPolicyError) policyOpenDecision = true;
    else if (!(error instanceof InstitutionIntelligenceAccessDeniedError)) throw error;
  }
  const learners = Number(readiness && !readiness.cohort.suppressed ? readiness.cohort.value.learnerCount.value ?? 0 : 0);

  return (
    <div>
      {header}
      {policyOpenDecision && <EmptyState title={t['empty.smallCohortSuppressed']} />}
      {readiness && readiness.cohort.suppressed && <EmptyState title={t['institution.learners.suppressedSmallCohort']} />}
      {readiness && !readiness.cohort.suppressed && learners === 0 && <EmptyState title={t['iix.empty.readiness']} />}

      {readiness && !readiness.cohort.suppressed && learners > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
          <MetricCard label={readiness.cohort.value.learnerCount.name} value={readiness.cohort.value.learnerCount.value} populationDescription={readiness.cohort.value.learnerCount.population.description} />

          <section>
            <h2 style={{ fontSize: 15, fontWeight: 700 }}>{t['examPrep.overallStatus']}</h2>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
              {Object.entries(readiness.cohort.value.overallStatusDistribution).map(([status, count]) => (
                <div key={status} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
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
                    <div key={status} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
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
    </div>
  );
}
