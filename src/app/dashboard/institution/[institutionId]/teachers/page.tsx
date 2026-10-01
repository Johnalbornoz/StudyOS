import { auth } from '@clerk/nextjs/server';
import { redirect, notFound } from 'next/navigation';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { getUserInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import { fillMessage } from '@/lib/i18n/roles-messages';
import { getInstitutionOverview, InstitutionIntelligenceAccessDeniedError } from '@/lib/institution-intelligence';
import {
  listApprovedTeachers,
  listInstitutionTeacherAssignments,
  listInstitutionClassesWithStaff,
  listInstitutionGrades,
} from '@/services/institution.service';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { InstitutionSubNav } from '../InstitutionSubNav';
import { AssignTeacherForm, PostActionButton } from '../InstitutionForms';

/**
 * F14 / Track A (A4) -- approved teachers of THIS institution, by email
 * (never a raw id), their active class / grade scopes, assigning a scope
 * (which MUST name a class or a grade -- a scope-less assignment granted
 * nothing) and revoking a teacher. A plain roster: no score or ranking.
 */
export default async function InstitutionTeachersPage({ params }: { params: Promise<{ institutionId: string }> }) {
  const { institutionId } = await params;
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect('/sign-in');

  const actor = await getOrCreateCanonicalUser(clerkUserId, null);
  const locale = await getUserInterfaceLanguage(actor.id).catch(() => 'es' as const);
  const t = getMessages(locale);

  let overview;
  try {
    overview = await getInstitutionOverview(actor.id, institutionId);
  } catch (error) {
    if (error instanceof InstitutionIntelligenceAccessDeniedError) notFound();
    throw error;
  }
  const [teachers, assignments, classes, grades] = await Promise.all([
    listApprovedTeachers(institutionId),
    listInstitutionTeacherAssignments(institutionId),
    listInstitutionClassesWithStaff(institutionId),
    listInstitutionGrades(institutionId),
  ]);
  const scopes = [
    ...classes.map((c) => ({ value: `class:${c.id}`, label: fillMessage(t['inst.teachers.scopeClass'], { name: c.name }) })),
    ...grades.map((g) => ({ value: `grade:${g.id}`, label: fillMessage(t['inst.teachers.scopeGrade'], { name: g.name }) })),
  ];

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
    <div className="ta-stack">
      <div>
        <PageHeader title={overview.institutionName} subtitle={t['institution.teachers.title']} />
        <InstitutionSubNav institutionId={institutionId} active="teachers" labels={subNavLabels} />
      </div>

      {teachers.length === 0 ? (
        <EmptyState title={t['inst.teachers.empty']} />
      ) : (
        <>
          {scopes.length > 0 && (
            <section className="card ta-card" aria-label={t['inst.teachers.assignTo']}>
              <AssignTeacherForm
                institutionId={institutionId}
                teachers={teachers}
                scopes={scopes}
                labels={{
                  title: t['inst.teachers.assignTo'],
                  selectTeacher: t['inst.class.selectTeacher'],
                  scope: t['inst.teachers.assignTo'],
                  submit: t['institution.teachers.assign'],
                  none: t['inst.teachers.empty'],
                  saved: t['inst.common.saved'],
                  error: t['inst.teachers.assignError'],
                  scopeRequired: t['inst.teachers.scopeRequired'],
                }}
              />
            </section>
          )}
          <ul className="list-card card" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {teachers.map((teacher) => {
              const mine = assignments.filter((a) => a.membershipId === teacher.membershipId);
              return (
                <li key={teacher.membershipId} className="list-row" style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
                  <div className="row-main" style={{ flexBasis: 240 }}>
                    <div className="row-title" style={{ overflowWrap: 'anywhere' }}>{teacher.email ?? teacher.userId}</div>
                    {mine.length === 0 ? (
                      <div className="row-sub">{t['inst.teachers.noAssignments']}</div>
                    ) : (
                      <ul style={{ listStyle: 'none', margin: '6px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {mine.map((a) => (
                          <li key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                            <span className="row-sub" style={{ margin: 0 }}>
                              {a.className
                                ? fillMessage(t['inst.teachers.scopeClass'], { name: a.className })
                                : fillMessage(t['inst.teachers.scopeGrade'], { name: a.gradeName ?? '' })}
                            </span>
                            <PostActionButton url={`/api/institutions/assignments/${a.id}/end`} label={t['inst.class.endAssignment']} errorLabel={t['inst.common.error']} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <PostActionButton
                    url={`/api/institutions/${institutionId}/memberships/${teacher.membershipId}/revoke`}
                    label={t['institution.teachers.revoke']}
                    errorLabel={t['inst.common.error']}
                    confirmText={`${t['institution.teachers.revoke']}: ${teacher.email ?? ''}?`}
                  />
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
