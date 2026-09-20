import { auth } from '@clerk/nextjs/server';
import { redirect, notFound } from 'next/navigation';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import { getInstitutionOverview, getInstitutionLearnerSummary, InstitutionIntelligenceAccessDeniedError, NoActiveAnalyticsPolicyError } from '@/lib/institution-intelligence';
import { PageHeader } from '@/components/ui/PageHeader';
import { MetricCard } from '@/components/ui/MetricCard';
import { EmptyState } from '@/components/ui/EmptyState';
import { InstitutionSubNav } from '../InstitutionSubNav';

/**
 * F13 -- Institution Learning Intelligence (task section 19/20/21).
 * Knowledge/Skill/Competency distributions are rendered as THREE
 * separate lists -- never summed into one score (task section 13,
 * INV-F13-... "frontend must not calculate"; here the frontend does
 * not even aggregate what F12 already aggregated, it only renders it).
 * "No evidence" is shown as its own neutral count, never styled as a
 * failure (INV-F13-11/16). A cohort below F12's own governed
 * suppression threshold renders the SAME controlled "cohort too small"
 * state F12's API already computes (task section 21) -- this page
 * never overrides or second-guesses that decision.
 */
export default async function InstitutionLearnersPage({ params }: { params: Promise<{ institutionId: string }> }) {
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
    summary = await getInstitutionLearnerSummary(actor.id, institutionId);
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
    learners: t['institution.learners.title'],
    interventions: t['institution.interventions.title'],
    attention: t['institution.attention.title'],
  };

  return (
    <div>
      <PageHeader title={overview?.institutionName ?? ''} subtitle={t['institution.learners.title']} />
      <InstitutionSubNav institutionId={institutionId} active="learners" labels={subNavLabels} />

      {policyOpenDecision && (
        // MIN_COHORT_POLICY: OPEN_DECISION (F12) -- rendered honestly as
        // an unavailable state, never a silently-invented threshold
        // (task section 21/27).
        <EmptyState title={t['empty.smallCohortSuppressed']} />
      )}

      {summary && !summary.cohort.suppressed && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--space-4)' }}>
            <MetricCard label={t['institution.overview.uniqueLearners']} value={summary.cohort.value.uniqueLearnerCount.value} />
            <MetricCard
              label={t['institution.learners.withEvidence']}
              value={summary.cohort.value.evidencePresence.value.withEvidence}
              denominatorNote={`${t['institution.learners.noEvidence']}: ${summary.cohort.value.evidencePresence.value.noEvidence}`}
              limitations={summary.cohort.value.evidencePresence.limitations}
            />
          </div>

          <StateDistributionTable title="Concept Knowledge" distribution={summary.cohort.value.conceptKnowledge.distribution} />
          <StateDistributionTable title="Skill" distribution={summary.cohort.value.skill.distribution} />
          <StateDistributionTable title="Competency" distribution={summary.cohort.value.competency.distribution} />
        </div>
      )}

      {summary && summary.cohort.suppressed && <EmptyState title={t['institution.learners.suppressedSmallCohort']} />}
    </div>
  );
}

function StateDistributionTable({ title, distribution }: { title: string; distribution: Record<string, number> }) {
  const entries = Object.entries(distribution);
  return (
    <section>
      <h2 style={{ fontSize: 15, fontWeight: 700 }}>{title}</h2>
      {entries.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>—</p>
      ) : (
        <ul className="list-card card">
          {entries.map(([state, count]) => (
            <li key={state} className="list-row">
              <div className="row-main row-title">{state}</div>
              <div className="tabular" style={{ fontWeight: 700 }}>
                {count}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
