import { auth } from '@clerk/nextjs/server';
import { redirect, notFound } from 'next/navigation';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import { getInstitutionOverview, InstitutionIntelligenceAccessDeniedError } from '@/lib/institution-intelligence';
import { listPendingMemberships, listDecidedMemberships } from '@/services/institution.service';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { InstitutionSubNav } from '../InstitutionSubNav';
import { MembershipRequestActions } from './MembershipRequestActions';

/**
 * Onboarding/authorization rework (2026-09-21) -- the coordinator
 * (INSTITUTION_ADMIN) surface the task's own "Coordinador
 * institucional" section requires and which had no UI at all before
 * this page: list PENDING teacher membership requests, approve/reject
 * them, and browse an auditable history of prior decisions. Revoking
 * an already-APPROVED teacher and assigning them to a class/grade live
 * on the existing `../teachers` page (each row already carries its own
 * `membershipId`).
 *
 * Access is gated the same way every other institution page is gated
 * (`getInstitutionOverview` -> `InstitutionIntelligenceAccessDeniedError`
 * -> `notFound()`), BEFORE calling the un-gated
 * `listPendingMemberships`/`listDecidedMemberships` service functions
 * directly -- those two never check access themselves, so this page is
 * their only caller and must gate first.
 */
export default async function InstitutionRequestsPage({ params }: { params: Promise<{ institutionId: string }> }) {
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

  const [pending, decided] = await Promise.all([
    listPendingMemberships(institutionId),
    listDecidedMemberships(institutionId),
  ]);

  const subNavLabels = {
    overview: t['institution.overview.title'],
    grades: t['institution.grades.title'],
    classes: t['institution.classes.title'],
    teachers: t['institution.teachers.title'],
    requests: t['institution.requests.title'],
    learners: t['institution.learners.title'],
    coverage: t['institution.coverage.title'],
    readiness: t['institution.readiness.title'],
    interventions: t['institution.interventions.title'],
    attention: t['institution.attention.title'],
  };

  return (
    <div>
      <PageHeader title={overview.institutionName} subtitle={t['institution.requests.title']} />
      <InstitutionSubNav institutionId={institutionId} active="requests" labels={subNavLabels} />

      <section style={{ marginBottom: 'var(--space-6)' }}>
        <h2 style={{ fontSize: 16, marginBottom: 'var(--space-3)' }}>{t['institution.requests.pendingTitle']}</h2>
        {pending.length === 0 ? (
          <EmptyState title={t['institution.requests.pendingEmpty']} />
        ) : (
          <ul className="list-card card">
            {pending.map((m) => (
              <li key={m.id} className="list-row">
                <div className="row-main">
                  <div className="row-title">{m.userId}</div>
                  {m.requestedAt && (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {t['institution.requests.requestedAt']}: {new Date(m.requestedAt).toLocaleString(locale)}
                    </div>
                  )}
                </div>
                <MembershipRequestActions institutionId={institutionId} membershipId={m.id} labels={{ approve: t['institution.requests.approve'], reject: t['institution.requests.reject'] }} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 style={{ fontSize: 16, marginBottom: 'var(--space-3)' }}>{t['institution.requests.historyTitle']}</h2>
        {decided.length === 0 ? (
          <EmptyState title={t['institution.requests.historyEmpty']} />
        ) : (
          <ul className="list-card card">
            {decided.map((m) => (
              <li key={m.id} className="list-row">
                <div className="row-main">
                  <div className="row-title">{m.userEmail ?? m.userId}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {m.status} {m.reviewedAt ? `— ${new Date(m.reviewedAt).toLocaleString(locale)}` : ''}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
