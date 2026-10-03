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
import { PostActionButton, SetClassSubjectForm } from '../../InstitutionForms';
import { ClassCurriculumSelect } from '../../curriculum/CurriculumManager';
import { listInstitutionCurriculumSubjects, listAcademicDomains } from '@/lib/institution/curriculum-management.service';
import { curriculumContextLabel, rankCurriculumCandidates } from '@/lib/institution/curriculum-identity';
import { classBindingLabels } from '@/lib/institution/admin-labels';
import { listGrades } from '@/lib/institution/institution-operations.service';
import { opsLabels } from '@/lib/institution/page-context';
import { ClassForm, ClassTeacherSelect, AddStudentForm, StudentClassAction, RowMenu } from '../../OpsActions';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Track A (A4) -- one class of THIS institution: teachers (assign / remove)
 * and roster (consent-based invitations, removal). A class id from another
 * institution -- or a malformed one -- is a plain not-found. The admin sees
 * names and enrollment state only; per-learner learning data stays behind
 * the teacher relationship and the cohort-suppressed F12 read models.
 */
const thisClassStatus = (classes: Array<{ id: string; status: string }>, id: string) => classes.find((c) => c.id === id)?.status ?? 'ACTIVE';
const staffMembership = (teacher: { userId: string }, staff: { userId: string }) => teacher.userId === staff.userId;

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

  const [roster, classes, teachers, subjects, curricula, domains, grades] = await Promise.all([
    listClassRosterForInstitution(institutionId, classId),
    listInstitutionClassesWithStaff(institutionId),
    listApprovedTeachers(institutionId),
    listLinkableSubjects(),
    listInstitutionCurriculumSubjects(institutionId, { includeArchived: true }),
    listAcademicDomains(locale),
    listGrades(institutionId),
  ]);
  const l = opsLabels(t as unknown as Record<string, string>);
  const archived = thisClassStatus(classes, classId) === 'ARCHIVED';
  const thisClass = classes.find((c) => c.id === classId);
  const currentCurriculum = curricula.find((c) => c.curriculumId === thisClass?.institutionCurriculumId) ?? null;
  const curriculumLabel = (c: (typeof curricula)[number]) => curriculumContextLabel(c, t['cur2.wizard.allGrades']);
  const domainLabel = thisClass?.academicDomain ? domains.find((d) => d.code === thisClass.academicDomain)?.label ?? thisClass.academicDomain : null;
  const staff = classes.find((c) => c.id === classId)?.teachers ?? [];
  const base = `/api/institutions/${institutionId}`;

  return (
    <div className="ta-stack">
      <PageHeader
        title={klass.name}
        subtitle={[overview.institutionName, klass.gradeName, klass.subjectName].filter(Boolean).join(' · ')}
        breadcrumb={<Link href={`/dashboard/institution/${institutionId}/classes`}>{t['institution.classes.title']}</Link>}
      />
      <div className="ta-entity-row" data-class-status={archived ? 'ARCHIVED' : 'ACTIVE'}>
        <span className="ta-row">
          <span className={`chip${archived ? '' : ' chip-good'}`}>{l[`iops.common.status.${archived ? 'ARCHIVED' : 'ACTIVE'}`]}</span>
          {currentCurriculum && <Link href={`/dashboard/institution/${institutionId}/curriculum/${currentCurriculum.curriculumId}`}>{l['iops.classes.plan']}</Link>}
          <Link href={`/dashboard/institution/${institutionId}/tasks`}>{l['iops.classes.assignments']}</Link>
        </span>
        <RowMenu
          label={klass.name}
          l={l}
          items={archived ? [{ label: l['iops.common.reactivate'], action: { url: `${base}/classes/${classId}/reactivate` } }] : [{ label: l['iops.common.archive'], action: { url: `${base}/classes/${classId}/archive`, confirm: l['iops.classes.archiveHint'] } }]}
        />
      </div>
      {archived && <p className="ta-msg">{l['iops.classes.archiveHint']}</p>}
      {!archived && (
        <section className="card ta-card" id="class-edit">
          <ClassForm
            id="class-edit-form"
            institutionId={institutionId}
            classId={classId}
            grades={grades.map((g) => ({ id: g.id, name: g.name }))}
            domains={domains}
            curricula={[]}
            teachers={[]}
            initial={{ name: klass.name, gradeId: klass.gradeId ?? null, academicDomain: thisClass?.academicDomain ?? null, period: thisClass?.period ?? null }}
            l={l}
          />
        </section>
      )}

      <section className="card ta-card" aria-labelledby="class-curriculum-title" data-class-curriculum>
        <h2 id="class-curriculum-title">{t['cur2.teacher.curriculum']}</h2>
        <p className="ta-msg">
          {currentCurriculum ? curriculumLabel(currentCurriculum) + (currentCurriculum.status === 'ARCHIVED' ? ` (${t['cur2.status.ARCHIVED']})` : '') : t['cur2.classes.none2']}
        </p>
        <ClassCurriculumSelect
          institutionId={institutionId}
          classId={classId}
          current={thisClass?.institutionCurriculumId ?? null}
          options={rankCurriculumCandidates(curricula, { academicDomain: thisClass?.academicDomain ?? null, gradeId: klass.gradeId }).map((r) => ({ id: r.curriculum.curriculumId, label: curriculumLabel(r.curriculum), compatible: r.compatible }))}
          domainLabel={domainLabel}
          labels={classBindingLabels(t as Record<string, string>)}
        />
      </section>

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
        {!archived && (
          <div id="class-teacher">
            <ClassTeacherSelect
              institutionId={institutionId}
              classId={classId}
              current={staff.length === 1 ? (teachers.find((x) => staffMembership(x, staff[0]))?.membershipId ?? null) : null}
              teachers={teachers.map((x) => ({ membershipId: x.membershipId, label: x.name ? `${x.name} (${x.email})` : x.email ?? x.membershipId }))}
              l={l}
            />
          </div>
        )}
      </section>

      <section className="card ta-card" aria-labelledby="roster-title">
        <h2 id="roster-title">{t['inst.class.rosterTitle']}</h2>
        {!archived && <AddStudentForm institutionId={institutionId} classes={[]} fixedClassId={classId} l={l} />}
        <p className="ta-msg">{l['iops.students.historyNote']}</p>
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
                  {r.status === 'ACTIVE' && !archived && (
                    <StudentClassAction
                      institutionId={institutionId}
                      studentId={r.studentId}
                      mode="move"
                      fromOptions={[{ id: classId, label: klass.name }]}
                      toOptions={classes.filter((c) => c.id !== classId && c.status === 'ACTIVE').map((c) => ({ id: c.id, label: [c.name, c.gradeName].filter(Boolean).join(' · ') }))}
                      l={l}
                    />
                  )}
                  <Link href={`/dashboard/institution/${institutionId}/students/${r.studentId}`}>{l['iops.common.view']}</Link>
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
