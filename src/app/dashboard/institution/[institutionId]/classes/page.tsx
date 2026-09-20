import { auth } from '@clerk/nextjs/server';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import { getInstitutionOverview, getInstitutionClasses, InstitutionIntelligenceAccessDeniedError } from '@/lib/institution-intelligence';
import { DEFAULT_PAGE_SIZE } from '@/lib/institution-intelligence/types';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { InstitutionSubNav } from '../InstitutionSubNav';

/**
 * F14 Workstream D -- Institution Classes (task section 7). Consumes
 * F12's `getInstitutionClasses` (roster.service.ts), which is already
 * bounded/paginated (task section 46/34) -- this page only renders the
 * page it's given, it never fetches an unbounded list.
 */
export default async function InstitutionClassesPage({
  params,
  searchParams,
}: {
  params: Promise<{ institutionId: string }>;
  searchParams: Promise<{ gradeId?: string; offset?: string }>;
}) {
  const { institutionId } = await params;
  const { gradeId, offset: offsetParam } = await searchParams;
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect('/sign-in');

  const actor = await getOrCreateCanonicalUser(clerkUserId, null);
  const locale = await getInterfaceLanguage(actor.id).catch(() => 'es' as const);
  const t = getMessages(locale);
  const offset = Math.max(Number(offsetParam) || 0, 0);

  let overview;
  let classes;
  try {
    overview = await getInstitutionOverview(actor.id, institutionId);
    classes = await getInstitutionClasses(actor.id, institutionId, gradeId ? { gradeId } : undefined, { limit: DEFAULT_PAGE_SIZE, offset });
  } catch (error) {
    if (error instanceof InstitutionIntelligenceAccessDeniedError) notFound();
    throw error;
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

  const gradeQuery = gradeId ? `&gradeId=${gradeId}` : '';
  const hasPrev = offset > 0;
  const hasNext = offset + classes.items.length < classes.totalCount;

  return (
    <div>
      <PageHeader title={overview.institutionName} subtitle={t['institution.classes.title']} />
      <InstitutionSubNav institutionId={institutionId} active="classes" labels={subNavLabels} />

      {classes.items.length === 0 ? (
        <EmptyState title={t['empty.noData']} />
      ) : (
        <ul className="list-card card">
          {classes.items.map((c) => (
            <li key={c.id} className="list-row">
              <div className="row-main">
                <div className="row-title">{c.name}</div>
                {c.gradeName && <div className="row-sub">{c.gradeName}</div>}
              </div>
              <div className="tabular" style={{ fontWeight: 700 }}>{c.activeEnrollmentCount}</div>
            </li>
          ))}
        </ul>
      )}

      <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
        {hasPrev && (
          <Link href={`/dashboard/institution/${institutionId}/classes?offset=${Math.max(offset - DEFAULT_PAGE_SIZE, 0)}${gradeQuery}`} className="btn">
            ←
          </Link>
        )}
        {hasNext && (
          <Link href={`/dashboard/institution/${institutionId}/classes?offset=${offset + DEFAULT_PAGE_SIZE}${gradeQuery}`} className="btn">
            →
          </Link>
        )}
      </div>
    </div>
  );
}
