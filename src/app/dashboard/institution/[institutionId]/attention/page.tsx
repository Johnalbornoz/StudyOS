import { auth } from '@clerk/nextjs/server';
import { redirect, notFound } from 'next/navigation';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import { getInstitutionOverview, getInstitutionAttentionAreas, InstitutionIntelligenceAccessDeniedError } from '@/lib/institution-intelligence';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { InstitutionSubNav } from '../InstitutionSubNav';

/**
 * F13 -- Institution Attention Areas (task section 19/35). Every card
 * cites its own source metric id and the real numbers behind it (F12's
 * own deterministic output, rendered verbatim) -- never an opaque
 * "risk" flag with no explanation.
 */
export default async function InstitutionAttentionPage({ params }: { params: Promise<{ institutionId: string }> }) {
  const { institutionId } = await params;
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect('/sign-in');

  const actor = await getOrCreateCanonicalUser(clerkUserId, null);
  const locale = await getInterfaceLanguage(actor.id).catch(() => 'es' as const);
  const t = getMessages(locale);

  let overview;
  let areas;
  try {
    [overview, areas] = await Promise.all([
      getInstitutionOverview(actor.id, institutionId),
      getInstitutionAttentionAreas(actor.id, institutionId),
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

  return (
    <div>
      <PageHeader title={overview.institutionName} subtitle={t['institution.attention.title']} />
      <InstitutionSubNav institutionId={institutionId} active="attention" labels={subNavLabels} />

      {areas.length === 0 ? (
        <EmptyState title={t['institution.attention.empty']} />
      ) : (
        <ul className="list-card card">
          {areas.map((a, i) => (
            <li key={i} className="list-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
              <div className="row-title">{a.reasonCode}</div>
              <div className="row-sub">{a.detail}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {a.citedMetricId}: {a.citedNumerator}
                {a.citedDenominator !== null ? ` / ${a.citedDenominator}` : ''}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
