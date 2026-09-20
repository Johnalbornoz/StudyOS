import { auth } from '@clerk/nextjs/server';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import { getInstitutionOverview, getInstitutionGrades, InstitutionIntelligenceAccessDeniedError } from '@/lib/institution-intelligence';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { InstitutionSubNav } from '../InstitutionSubNav';

/**
 * F14 Workstream D -- Institution Grades (task section 7). Consumes
 * F12's already-certified `getInstitutionGrades` (roster.service.ts) --
 * a real backend function with zero prior UI, exactly like the other
 * four F13 Institution pages before it.
 */
export default async function InstitutionGradesPage({ params }: { params: Promise<{ institutionId: string }> }) {
  const { institutionId } = await params;
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect('/sign-in');

  const actor = await getOrCreateCanonicalUser(clerkUserId, null);
  const locale = await getInterfaceLanguage(actor.id).catch(() => 'es' as const);
  const t = getMessages(locale);

  let overview;
  let grades;
  try {
    overview = await getInstitutionOverview(actor.id, institutionId);
    grades = await getInstitutionGrades(actor.id, institutionId);
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

  return (
    <div>
      <PageHeader title={overview.institutionName} subtitle={t['institution.grades.title']} />
      <InstitutionSubNav institutionId={institutionId} active="grades" labels={subNavLabels} />

      {grades.length === 0 ? (
        <EmptyState title={t['empty.noData']} />
      ) : (
        <ul className="list-card card">
          {grades.map((g) => (
            <li key={g.id} className="list-row">
              <Link href={`/dashboard/institution/${institutionId}/classes?gradeId=${g.id}`} className="row-main" style={{ textDecoration: 'none', color: 'inherit' }}>
                <div className="row-title">{g.name}</div>
              </Link>
              <div className="tabular" style={{ fontWeight: 700 }}>{g.classCount}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
