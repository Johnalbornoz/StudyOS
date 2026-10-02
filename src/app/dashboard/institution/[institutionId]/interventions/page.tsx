import { auth } from '@clerk/nextjs/server';
import { redirect, notFound } from 'next/navigation';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { getUserInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages, type MessageKey } from '@/lib/i18n/messages';
import { fillMessage } from '@/lib/i18n/roles-messages';
import { getInstitutionOverview, getInstitutionInterventionSummary, InstitutionIntelligenceAccessDeniedError, NoActiveAnalyticsPolicyError } from '@/lib/institution-intelligence';
import { PERIOD_DAYS } from '@/lib/institution/intelligence-context.service';
import { EmptyState } from '@/components/ui/EmptyState';
import { InlineAlert } from '@/components/ui/InlineAlert';
import { StatusBadge, toneForInterventionStatus } from '@/components/ui/StatusBadge';
import { IntelligenceHeader, loadContext } from '../intelligence-chrome';

/**
 * F14 / Track A -- assignment activity (F12 `getInstitutionInterventionSummary`,
 * cohort-suppressed distribution). Filtered by the governed context:
 * period (sinceDays) and a class of the selected curriculum's grade /
 * subject. Works without a curriculum (institution-wide), with a prompt to
 * configure one.
 */
export default async function InstitutionInterventionsPage({ params, searchParams }: { params: Promise<{ institutionId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { institutionId } = await params;
  const sp = await searchParams;
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect('/sign-in');
  const actor = await getOrCreateCanonicalUser(clerkUserId, null);
  const locale = await getUserInterfaceLanguage(actor.id).catch(() => 'es' as const);
  const t = getMessages(locale);

  let overview;
  let ctx;
  let summary;
  let policyOpenDecision = false;
  try {
    overview = await getInstitutionOverview(actor.id, institutionId);
    ctx = await loadContext(actor.id, institutionId, sp, t);
    summary = await getInstitutionInterventionSummary(actor.id, institutionId, { classId: ctx.classId ?? undefined, sinceDays: PERIOD_DAYS[ctx.period] });
  } catch (error) {
    if (error instanceof InstitutionIntelligenceAccessDeniedError) notFound();
    if (error instanceof NoActiveAnalyticsPolicyError) policyOpenDecision = true;
    else throw error;
  }
  if (!overview || !ctx) notFound();
  const total = summary && !summary.cohort.suppressed ? summary.cohort.value.distribution.value.total : 0;

  return (
    <div>
      <IntelligenceHeader t={t} institutionId={institutionId} institutionName={overview.institutionName} tab="interventions" ctx={ctx} show={{ curriculum: true, period: true, class: true, exam: false }} />
      {!ctx.selected && <InlineAlert tone="info" title={t['iix.noCurriculum.title']} body={t['iix.noCurriculum.body']} />}
      {policyOpenDecision && <EmptyState title={t['empty.smallCohortSuppressed']} />}
      {summary && summary.cohort.suppressed && <EmptyState title={t['institution.learners.suppressedSmallCohort']} />}
      {summary && !summary.cohort.suppressed && total === 0 && <EmptyState title={t['iix.empty.interventions']} />}
      {summary && !summary.cohort.suppressed && total > 0 && (
        <>
          <p className="ta-msg">{fillMessage(t['iix.interventions.total'], { n: total })}</p>
          <ul className="list-card card">
            {(Object.entries(summary.cohort.value.distribution.value.byStatus) as Array<[keyof typeof summary.cohort.value.distribution.value.byStatus, number]>).map(([status, count]) => (
              <li key={status} className="list-row">
                <div className="row-main">
                  <StatusBadge label={t[`assignments.status.${status}` as MessageKey] ?? status} tone={toneForInterventionStatus(status)} />
                </div>
                <div className="tabular" style={{ fontWeight: 700 }}>
                  {count}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
