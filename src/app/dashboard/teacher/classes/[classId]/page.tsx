import { auth } from '@clerk/nextjs/server';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { getUserInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import { fillMessage } from '@/lib/i18n/roles-messages';
import { getTeacherClass, listAssignableConceptsForClass, listClassAssignments } from '@/lib/teacher/class-assignment.service';
import { listClassLearnerAttention } from '@/lib/teacher/learner-view.service';
import { listClassRosterForInstitution } from '@/services/institution.service';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { InlineAlert } from '@/components/ui/InlineAlert';
import { StatusBadge, toneForInterventionStatus } from '@/components/ui/StatusBadge';
import { InviteStudentForm, PostActionButton } from '@/app/dashboard/institution/[institutionId]/InstitutionForms';
import { ClassAssignmentComposer } from './ClassAssignmentComposer';
import { attentionLabels } from '../../attention-labels';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * F13 / Track A -- one class, for the teacher who TEACHES it (approved
 * membership + active scope). Anyone else -- a pending teacher, another
 * class's teacher, an institution admin -- gets the same not-found a real
 * 404 would (never "exists but not yours").
 *
 * Context (institution · grade · subject), "who needs help" (read-only
 * projection of the canonical read models), the roster with consent-based
 * invitations, the assignment composer (topics of the class's subject only)
 * and every assignment's lifecycle per learner.
 */
export default async function TeacherClassPage({ params }: { params: Promise<{ classId: string }> }) {
  const { classId } = await params;
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect('/sign-in');
  if (!UUID_RE.test(classId)) notFound();

  const actor = await getOrCreateCanonicalUser(clerkUserId, null);
  const klass = await getTeacherClass(actor.id, classId);
  if (!klass) notFound();

  const locale = await getUserInterfaceLanguage(actor.id).catch(() => 'es' as const);
  const t = getMessages(locale);
  const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(locale) : null);

  const [roster, assignable, assignments, attention] = await Promise.all([
    listClassRosterForInstitution(klass.institutionId, classId),
    listAssignableConceptsForClass(actor.id, classId),
    listClassAssignments(actor.id, classId),
    listClassLearnerAttention(actor.id, classId),
  ]);
  const active = roster.filter((r) => r.status === 'ACTIVE');
  const labels = attentionLabels(t);

  return (
    <div className="ta-stack">
      <PageHeader
        title={klass.subjectName ? `${klass.name} · ${klass.subjectName}` : klass.name}
        subtitle={[klass.institutionName, klass.gradeName].filter(Boolean).join(' · ')}
        breadcrumb={<Link href="/dashboard/teacher">{t['nav.teacherClasses']}</Link>}
      />

      {!klass.subjectId && <InlineAlert tone="info" title={t['tc.noSubject.title']} body={t['tc.noSubject.body']} />}

      <section aria-labelledby="help-title" className="ta-stack" style={{ gap: 'var(--space-3)' }}>
        <h2 id="help-title" style={{ fontSize: 18 }}>{t['tc.help.title']}</h2>
        <p className="ta-msg">{t['tc.help.body']}</p>
        {attention.learners.length === 0 ? (
          <EmptyState title={t['tc.help.noLearners']} />
        ) : (
          <ul className="list-card card" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {attention.learners.map((l) => {
              const top = l.attention[0];
              return (
                <li key={l.studentId} className="list-row" style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
                  <div className="row-main" style={{ flexBasis: 240 }}>
                    <Link href={`/dashboard/teacher/classes/${classId}/students/${l.studentId}`} className="row-title">
                      {l.name}
                    </Link>
                    {top ? (
                      <>
                        <div className="row-sub">
                          <strong>{labels.reason[top.reason]}</strong> · {top.topic}
                          {top.detail ? ` — ${top.detail}` : ''}
                        </div>
                        <div className="row-sub">{fillMessage(t['tc.help.suggestion'], { action: labels.suggestion[top.suggestion] })}</div>
                        {l.attention.length > 1 && <div className="row-sub">{fillMessage(t['tc.help.more'], { n: l.attention.length - 1 })}</div>}
                      </>
                    ) : (
                      <div className="row-sub">{t['tc.help.onTrack']}</div>
                    )}
                    {l.stages.length > 0 && (
                      <div className="row-sub">
                        {l.stages.map((s) => `${s.topic}: ${t[`conceptMission.stage.${s.stage ?? 'NOT_STARTED'}`]}`).join(' · ')}
                      </div>
                    )}
                  </div>
                  <span className={top ? 'chip chip-warn' : 'chip chip-good'}>{top ? t['tc.help.needsHelp'] : t['tc.help.ok']}</span>
                  <Link href={`/dashboard/teacher/classes/${classId}/students/${l.studentId}`} className="btn btn-secondary">
                    {t['tc.help.view']}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="card ta-card" aria-labelledby="roster-title">
        <h2 id="roster-title">{t['teacher.roster.title']}</h2>
        <InviteStudentForm
          institutionId={klass.institutionId}
          classId={classId}
          endpoint={`/api/teacher/classes/${classId}/enrollments`}
          labels={{
            label: t['inst.class.invite.label'],
            body: t['tc.invite.body'],
            submit: t['inst.class.invite.submit'],
            sent: t['inst.class.invite.sent'],
            noAccount: t['inst.class.invite.noAccount'],
            already: t['inst.class.invite.already'],
            error: t['inst.common.error'],
          }}
        />
        {roster.length === 0 ? (
          <EmptyState title={t['teacher.roster.empty']} />
        ) : (
          <ul className="role-list">
            {roster.map((r) => (
              <li key={r.enrollmentId} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
                <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  {r.status === 'ACTIVE' ? (
                    <Link href={`/dashboard/teacher/classes/${classId}/students/${r.studentId}`} style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
                      {r.name}
                    </Link>
                  ) : (
                    <strong style={{ overflowWrap: 'anywhere' }}>{r.name}</strong>
                  )}
                  {r.email && r.email !== r.name && <span className="ta-msg" style={{ overflowWrap: 'anywhere' }}>{r.email}</span>}
                </span>
                <span className="ta-actions">
                  <span className={r.status === 'ACTIVE' ? 'chip chip-good' : 'chip chip-warn'}>{t[`inst.class.status.${r.status}`]}</span>
                  <PostActionButton
                    url={`/api/teacher/classes/${classId}/enrollments/${r.enrollmentId}/end`}
                    label={r.status === 'ACTIVE' ? t['inst.class.remove'] : t['inst.class.withdraw']}
                    errorLabel={t['inst.common.error']}
                    confirmText={r.status === 'ACTIVE' ? fillMessage(t['tc.removeConfirm'], { name: r.name }) : undefined}
                  />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ClassAssignmentComposer
        classId={classId}
        concepts={assignable.concepts}
        activeLearners={active.map((r) => ({ studentId: r.studentId, name: r.name }))}
        subjectLinked={assignable.subjectLinked}
        labels={{
          title: t['teacherClass.compose.title'],
          body: t['tc.compose.body'],
          assignmentTitle: t['tc.compose.assignmentTitle'],
          assignmentTitleHint: t['tc.compose.assignmentTitleHint'],
          concept: t['teacherClass.compose.concept'],
          conceptOption: t['teacherClass.compose.conceptOption'],
          noSubject: t['tc.noSubject.body'],
          noConcepts: t['tc.compose.noConcepts'],
          noLearners: t['teacherClass.compose.noLearners'],
          instructions: t['teacherClass.compose.instructions'],
          start: t['tc.compose.start'],
          due: t['teacherClass.compose.due'],
          recipients: t['tc.compose.recipients'],
          wholeClass: t['tc.compose.wholeClass'],
          selected: t['tc.compose.selected'],
          selectAtLeastOne: t['tc.compose.selectAtLeastOne'],
          publish: t['teacherClass.compose.publish'],
          publishing: t['teacherClass.compose.publishing'],
          published: t['teacherClass.compose.published'],
          skipped: t['teacherClass.compose.skipped'],
          error: t['teacherClass.compose.error'],
          errors: {
            CLASS_SUBJECT_REQUIRED: t['tc.noSubject.body'],
            CONCEPT_NOT_IN_CLASS_SUBJECT: t['tc.error.conceptNotInSubject'],
            RECIPIENT_NOT_IN_CLASS: t['tc.error.recipientNotInClass'],
            INVALID_DATES: t['tc.error.invalidDates'],
            NO_LEARNERS_TO_ASSIGN: t['tc.error.noLearnersToAssign'],
          },
        }}
      />

      <section aria-labelledby="assignments-title" className="ta-stack" style={{ gap: 'var(--space-3)' }}>
        <h2 id="assignments-title" style={{ fontSize: 18 }}>{t['teacherClass.assignmentsTitle']}</h2>
        {assignments.length === 0 ? (
          <EmptyState title={t['teacherClass.assignments.empty']} />
        ) : (
          assignments.map((a) => (
            <article key={a.assignmentGroupId} className="card" aria-label={a.title}>
              <div style={{ padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <strong>{a.title}</strong>
                {a.title !== a.conceptName && <span className="ta-msg">{fillMessage(t['studentAssign.topic'], { topic: a.conceptName })}</span>}
                <span className="ta-msg">
                  {[
                    fillMessage(t['tc.assignments.created'], { date: fmtDate(a.assignedAt) }),
                    a.startsAt ? fillMessage(t['tc.assignments.starts'], { date: fmtDate(a.startsAt) }) : null,
                    a.dueAt ? fillMessage(t['teacherClass.due'], { date: fmtDate(a.dueAt) }) : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                <span className="ta-msg">
                  {fillMessage(t['tc.assignments.counts'], {
                    assigned: a.counts.ASSIGNED,
                    started: a.counts.IN_PROGRESS,
                    completed: a.counts.COMPLETED,
                    overdue: a.counts.EXPIRED,
                  })}
                </span>
                {a.instructions && <span className="ta-msg">{a.instructions}</span>}
              </div>
              <div className="ta-table-row ta-table-head" aria-hidden>
                <span>{t['teacherClass.learner']}</span>
                <span>{t['teacherClass.status']}</span>
                <span>{t['teacherClass.outcome']}</span>
              </div>
              {a.learners.map((l) => (
                <div key={l.interventionId} className="ta-table-row">
                  <Link href={`/dashboard/teacher/classes/${classId}/students/${l.studentId}`}>{l.studentName}</Link>
                  <span>
                    <StatusBadge label={t[`assignments.status.${l.status}`]} tone={toneForInterventionStatus(l.status)} />
                  </span>
                  <span className="ta-msg">{l.result ? fillMessage(t['teacherClass.result'], { correct: l.result.correct, total: l.result.total }) : '—'}</span>
                </div>
              ))}
            </article>
          ))
        )}
      </section>
    </div>
  );
}
