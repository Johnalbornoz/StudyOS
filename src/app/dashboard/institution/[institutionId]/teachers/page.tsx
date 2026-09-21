import { auth } from '@clerk/nextjs/server';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import { getInstitutionOverview, getInstitutionTeachers, InstitutionIntelligenceAccessDeniedError } from '@/lib/institution-intelligence';
import { DEFAULT_PAGE_SIZE } from '@/lib/institution-intelligence/types';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { InstitutionSubNav } from '../InstitutionSubNav';
import { TeacherRowActions } from './TeacherRowActions';

/**
 * F14 Workstream D -- Institution Teachers (task section 7). Consumes
 * F12's `getInstitutionTeachers` (roster.service.ts) -- deliberately a
 * plain roster with operational counts only, no score/ranking (task
 * section 23's own explicit prohibition, structurally documented in the
 * service itself).
 */
export default async function InstitutionTeachersPage({
  params,
  searchParams,
}: {
  params: Promise<{ institutionId: string }>;
  searchParams: Promise<{ offset?: string }>;
}) {
  const { institutionId } = await params;
  const { offset: offsetParam } = await searchParams;
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect('/sign-in');

  const actor = await getOrCreateCanonicalUser(clerkUserId, null);
  const locale = await getInterfaceLanguage(actor.id).catch(() => 'es' as const);
  const t = getMessages(locale);
  const offset = Math.max(Number(offsetParam) || 0, 0);

  let overview;
  let teachers;
  try {
    overview = await getInstitutionOverview(actor.id, institutionId);
    teachers = await getInstitutionTeachers(actor.id, institutionId, { limit: DEFAULT_PAGE_SIZE, offset });
  } catch (error) {
    if (error instanceof InstitutionIntelligenceAccessDeniedError) notFound();
    throw error;
  }

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

  const hasPrev = offset > 0;
  const hasNext = offset + teachers.items.length < teachers.totalCount;

  return (
    <div>
      <PageHeader title={overview.institutionName} subtitle={t['institution.teachers.title']} />
      <InstitutionSubNav institutionId={institutionId} active="teachers" labels={subNavLabels} />

      {teachers.items.length === 0 ? (
        <EmptyState title={t['empty.noData']} />
      ) : (
        <ul className="list-card card">
          {teachers.items.map((teacher) => (
            <li key={teacher.membershipId} className="list-row">
              <div className="row-main">
                <div className="row-title">{teacher.userId}</div>
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'center' }}>
                <span className="tabular">{teacher.activeAssignmentCount}</span>
                <span className="tabular">{teacher.activeLearnerCount}</span>
                <TeacherRowActions
                  institutionId={institutionId}
                  membershipId={teacher.membershipId}
                  labels={{
                    revoke: t['institution.teachers.revoke'],
                    assign: t['institution.teachers.assign'],
                    subjectPlaceholder: t['institution.teachers.assignmentSubjectPlaceholder'],
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}

      <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
        {hasPrev && (
          <Link href={`/dashboard/institution/${institutionId}/teachers?offset=${Math.max(offset - DEFAULT_PAGE_SIZE, 0)}`} className="btn">
            ←
          </Link>
        )}
        {hasNext && (
          <Link href={`/dashboard/institution/${institutionId}/teachers?offset=${offset + DEFAULT_PAGE_SIZE}`} className="btn">
            →
          </Link>
        )}
      </div>
    </div>
  );
}
