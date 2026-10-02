import { auth } from '@clerk/nextjs/server';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { getUserInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import { fillMessage } from '@/lib/i18n/roles-messages';
import { getInstitutionOverview, InstitutionIntelligenceAccessDeniedError } from '@/lib/institution-intelligence';
import { listInstitutionClassesWithStaff, listInstitutionGrades, listLinkableSubjects } from '@/services/institution.service';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { InstitutionSubNav } from '../InstitutionSubNav';
import { CreateClassForm } from '../InstitutionForms';

/**
 * F14 / Track A (A4) -- Institution classes: the admin creates classes
 * (product decision: the Institution Admin owns institutional classes) and
 * sees each class's grade, teachers and enrollment. Gated like every other
 * institution page (`getInstitutionOverview` -> not found for anyone who is
 * not an APPROVED INSTITUTION_ADMIN of THIS institution) before the
 * institution-scoped reads.
 */
export default async function InstitutionClassesPage({
  params,
  searchParams,
}: {
  params: Promise<{ institutionId: string }>;
  searchParams: Promise<{ gradeId?: string }>;
}) {
  const { institutionId } = await params;
  const { gradeId } = await searchParams;
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
  const [allClasses, grades, subjects] = await Promise.all([listInstitutionClassesWithStaff(institutionId), listInstitutionGrades(institutionId), listLinkableSubjects()]);
  const classes = gradeId ? allClasses.filter((c) => c.gradeId === gradeId) : allClasses;

  const subNavLabels = {
    overview: t['institution.overview.title'],
    grades: t['institution.grades.title'],
    classes: t['institution.classes.title'],
    teachers: t['institution.teachers.title'],
    requests: t['institution.requests.title'],
    subjects: t['ia.nav.subjects'],
    curriculum: t['icur.nav'],
    coordinators: t['ia.nav.coordinators'],
    settings: t['ia.nav.settings'],
    learners: t['institution.learners.title'],
    coverage: t['institution.coverage.title'],
    readiness: t['institution.readiness.title'],
    interventions: t['institution.interventions.title'],
    attention: t['institution.attention.title'],
  };

  return (
    <div className="ta-stack">
      <div>
        <PageHeader title={overview.institutionName} subtitle={t['institution.classes.title']} />
        <InstitutionSubNav institutionId={institutionId} active="classes" labels={subNavLabels} />
      </div>

      <CreateClassForm
        institutionId={institutionId}
        grades={grades}
        subjects={subjects}
        labels={{
          title: t['inst.classes.create.title'],
          name: t['inst.classes.create.name'],
          grade: t['inst.classes.create.grade'],
          noGrade: t['inst.classes.create.noGrade'],
          subject: t['inst.classes.create.subject'],
          noSubject: t['inst.classes.create.noSubject'],
          submit: t['inst.classes.create.submit'],
          saved: t['inst.common.saved'],
          error: t['inst.common.error'],
        }}
      />

      {classes.length === 0 ? (
        <EmptyState title={t['inst.classes.empty']} />
      ) : (
        <ul className="list-card card" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {classes.map((c) => (
            <li key={c.id} className="list-row" style={{ flexWrap: 'wrap' }}>
              <div className="row-main" style={{ flexBasis: 220 }}>
                <Link href={`/dashboard/institution/${institutionId}/classes/${c.id}`} className="row-title">
                  {c.name}
                </Link>
                <div className="row-sub">
                  {[c.gradeName, c.subjectName ?? t['inst.classes.noSubject'], fillMessage(t['inst.classes.students'], { active: c.activeEnrollmentCount, pending: c.pendingEnrollmentCount })]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
                <div className="row-sub">
                  {t['inst.classes.teachers']}: {c.teachers.length > 0 ? c.teachers.map((tch) => (tch.name && tch.email ? `${tch.name} · ${tch.email}` : (tch.name ?? tch.email))).join(', ') : t['inst.classes.noTeachers']}
                </div>
              </div>
              <Link href={`/dashboard/institution/${institutionId}/classes/${c.id}`} className="btn btn-secondary">
                {t['inst.classes.manage']}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
