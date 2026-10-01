import { auth } from '@clerk/nextjs/server';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { getUserInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import { getInstitutionOverview, InstitutionIntelligenceAccessDeniedError } from '@/lib/institution-intelligence';
import {
  getClassInInstitution,
  listClassRosterForInstitution,
  listInstitutionClassesWithStaff,
  listApprovedTeachers,
  listLinkableSubjects,
} from '@/services/institution.service';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { InviteStudentForm, AssignTeacherForm, PostActionButton, SetClassSubjectForm } from '../../InstitutionForms';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Track A (A4) -- one class of THIS institution: teachers (assign / remove)
 * and roster (consent-based invitations, removal). A class id from another
 * institution -- or a malformed one -- is a plain not-found. The admin sees
 * names and enrollment state only; per-learner learning data stays behind
 * the teacher relationship and the cohort-suppressed F12 read models.
 */
export default async function InstitutionClassPage({ params }: { params: Promise<{ institutionId: string; classId: string }> }) {
  const { institutionId, classId } = await params;
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect('/sign-in');
  if (!UUID_RE.test(classId)) notFound();

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
  const klass = await getClassInInstitution(institutionId, classId);
  if (!klass) notFound();

  const [roster, classes, teachers, subjects] = await Promise.all([
    listClassRosterForInstitution(institutionId, classId),
    listInstitutionClassesWithStaff(institutionId),
    listApprovedTeachers(institutionId),
    listLinkableSubjects(),
  ]);
  const staff = classes.find((c) => c.id === classId)?.teachers ?? [];
  const base = `/api/institutions/${institutionId}`;

  return (
    <div className="ta-stack">
      <PageHeader
        title={klass.name}
        subtitle={[overview.institutionName, klass.gradeName, klass.subjectName].filter(Boolean).join(' · ')}
        breadcrumb={<Link href={`/dashboard/institution/${institutionId}/classes`}>{t['institution.classes.title']}</Link>}
      />

      <section className="card ta-card" aria-labelledby="subject-title">
        <h2 id="subject-title">{t['inst.class.subjectTitle']}</h2>
        <p className="ta-msg">{klass.subjectName ? klass.subjectName : t['inst.class.subjectMissing']}</p>
        <SetClassSubjectForm
          institutionId={institutionId}
          classId={classId}
          currentSubjectId={klass.subjectId}
          subjects={subjects}
          labels={{
            label: t['inst.class.subjectLabel'],
            submit: klass.subjectId ? t['inst.class.subjectChange'] : t['inst.class.subjectLink'],
            saved: t['inst.common.saved'],
            error: t['inst.common.error'],
          }}
        />
      </section>

      <section className="card ta-card" aria-labelledby="staff-title">
        <h2 id="staff-title">{t['inst.class.staffTitle']}</h2>
        {staff.length === 0 ? (
          <p className="ta-msg">{t['inst.classes.noTeachers']}</p>
        ) : (
          <ul className="role-list">
            {staff.map((s) => (
              <li key={s.assignmentId} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
                <span style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{s.name && s.email ? `${s.name} · ${s.email}` : (s.name ?? s.email)}</span>
                <PostActionButton url={`/api/institutions/assignments/${s.assignmentId}/end`} label={t['inst.class.endAssignment']} errorLabel={t['inst.common.error']} />
              </li>
            ))}
          </ul>
        )}
        <AssignTeacherForm
          institutionId={institutionId}
          teachers={teachers}
          fixedScope={{ classId }}
          labels={{
            title: t['inst.class.assignTeacher'],
            selectTeacher: t['inst.class.selectTeacher'],
            submit: t['inst.class.assignTeacher'],
            none: t['inst.class.noApprovedTeachers'],
            saved: t['inst.common.saved'],
            error: t['inst.teachers.assignError'],
            scopeRequired: t['inst.teachers.scopeRequired'],
          }}
        />
      </section>

      <section className="card ta-card" aria-labelledby="roster-title">
        <h2 id="roster-title">{t['inst.class.rosterTitle']}</h2>
        <InviteStudentForm
          institutionId={institutionId}
          classId={classId}
          labels={{
            label: t['inst.class.invite.label'],
            body: t['inst.class.invite.body'],
            submit: t['inst.class.invite.submit'],
            sent: t['inst.class.invite.sent'],
            noAccount: t['inst.class.invite.noAccount'],
            already: t['inst.class.invite.already'],
            error: t['inst.common.error'],
          }}
        />
        {roster.length === 0 ? (
          <EmptyState title={t['inst.class.rosterEmpty']} />
        ) : (
          <ul className="role-list">
            {roster.map((r) => (
              <li key={r.enrollmentId} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
                <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  <strong style={{ overflowWrap: 'anywhere' }}>{r.name}</strong>
                  {r.email && r.email !== r.name && <span className="ta-msg" style={{ overflowWrap: 'anywhere' }}>{r.email}</span>}
                </span>
                <span className="ta-actions">
                  <span className={r.status === 'ACTIVE' ? 'chip chip-good' : 'chip chip-warn'}>{t[`inst.class.status.${r.status}`]}</span>
                  <PostActionButton
                    url={`${base}/classes/${classId}/enrollments/${r.enrollmentId}/end`}
                    label={r.status === 'ACTIVE' ? t['inst.class.remove'] : t['inst.class.withdraw']}
                    errorLabel={t['inst.common.error']}
                  />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
