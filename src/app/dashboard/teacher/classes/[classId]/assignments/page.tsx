import { auth } from '@clerk/nextjs/server';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { getUserInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import { fillMessage } from '@/lib/i18n/roles-messages';
import { getTeacherClass, listAssignableConceptsForClass, listClassAssignments } from '@/lib/teacher/class-assignment.service';
import { listClassRosterForInstitution } from '@/services/institution.service';
import { EmptyState } from '@/components/ui/EmptyState';
import { InlineAlert } from '@/components/ui/InlineAlert';
import { StatusBadge, toneForInterventionStatus } from '@/components/ui/StatusBadge';
import { ClassAssignmentComposer } from '../ClassAssignmentComposer';
import { InstitutionTaskCard, EditOwnTaskDue } from './InstitutionTasksPanel';
import { listClassInstitutionAssignments } from '@/lib/institution/institution-governance.service';
import { ClassChrome } from '../class-chrome';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Track A -- the class's tasks for its Teacher: the assignment composer
 * (topics of the class's subject; publishing merges the concept into each
 * personal plan) and every assignment's lifecycle per learner.
 */
export default async function TeacherClassAssignmentsPage({ params }: { params: Promise<{ classId: string }> }) {
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

  const [roster, assignable, assignments, institutionTasks] = await Promise.all([
    listClassRosterForInstitution(klass.institutionId, classId),
    listAssignableConceptsForClass(actor.id, classId),
    listClassAssignments(actor.id, classId),
    listClassInstitutionAssignments(actor.id, classId, locale).catch(() => []),
  ]);
  const taskLabels: Record<string, string> = {
    badge: t['cur2.lock.badge'],
    institutionTask: t['cur2.lock.institutionTask'],
    explain: t['cur2.lock.explain'],
    explainDirect: t['cur2.lock.explainDirect'],
    date: t['cur2.lock.date'],
    concept: t['cur2.tasks.concept'],
    startsAt: t['cur2.tasks.startsAt'],
    dueAt: t['cur2.tasks.dueAt'],
    priority: t['cur2.tasks.priority'],
    required: t['cur2.tasks.required'],
    instructions: t['cur2.tasks.instructions'],
    already: t['cur2.teacher.alreadyRecipients'],
    assignAll: t['cur2.teacher.assignAll'],
    assignSelected: t['cur2.teacher.assignSelected'],
    assigned: t['cur2.teacher.assigned'],
    cancel: t['cur2.wizard.cancel'],
    error: t['cur2.error'],
    'priority.HIGH': t['tcp.plan.priority.HIGH'],
    'priority.NORMAL': t['tcp.plan.priority.NORMAL'],
    'priority.LOW': t['tcp.plan.priority.LOW'],
    editOwn: t['cur2.teacher.editOwn'],
    ownSaved: t['cur2.teacher.ownSaved'],
    save: t['cur2.save'],
  };
  const active = roster.filter((r) => r.status === 'ACTIVE');

  return (
    <div className="ta-stack">
      <ClassChrome klass={klass} active="assignments" t={t} />
      {!klass.subjectId && <InlineAlert tone="info" title={t['tc.noSubject.title']} body={t['tc.noSubject.body']} />}

      {institutionTasks.length > 0 && (
        <section aria-labelledby="institution-tasks-title" className="ta-stack" style={{ gap: 'var(--space-3)' }}>
          <h2 id="institution-tasks-title" style={{ fontSize: 18 }}>{t['cur2.teacher.institutionTasks']}</h2>
          {institutionTasks.map((task) => (
            <InstitutionTaskCard key={task.id} classId={classId} task={task} learners={active.map((r) => ({ studentId: r.studentId, name: r.name }))} institutionName={klass.institutionName} locale={locale} labels={taskLabels} />
          ))}
        </section>
      )}

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
          publish: t['tc.compose.assign'],
          publishing: t['teacherClass.compose.publishing'],
          published: t['teacherClass.compose.published'],
          publishedAdded: t['tc.compose.publishedAdded'],
          skipped: t['tc.compose.skippedAuth'],
          previewHave: t['tc.compose.preview.have'],
          previewAdd: t['tc.compose.preview.add'],
          error: t['teacherClass.compose.error'],
          errors: {
            CLASS_SUBJECT_REQUIRED: t['tc.noSubject.body'],
            CONCEPT_NOT_IN_CLASS_SUBJECT: t['tc.error.conceptNotInSubject'],
            RECIPIENT_NOT_IN_CLASS: t['tc.error.recipientNotInClass'],
            INVALID_DATES: t['tc.error.invalidDates'],
            NO_LEARNERS_TO_ASSIGN: t['tc.error.noLearnersToAssign'],
            REQUEST_CONFLICT: t['inst.common.error'],
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
                {a.ownerScope === 'INSTITUTION' ? (
                  <span className="chip chip-warn" data-owner="INSTITUTION">🔒 {t['cur2.lock.institutionTask']}</span>
                ) : (
                  <EditOwnTaskDue classId={classId} groupId={a.assignmentGroupId} current={a.dueAt} labels={taskLabels} />
                )}
              </div>
              <div className="ta-table-row ta-table-head" aria-hidden>
                <span>{t['teacherClass.learner']}</span>
                <span>{t['teacherClass.status']}</span>
                <span>{t['teacherClass.outcome']}</span>
              </div>
              {a.learners.map((l) => (
                <div key={l.interventionId} className="ta-table-row">
                  <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                    <Link href={`/dashboard/teacher/classes/${classId}/students/${l.studentId}`}>{l.studentName}</Link>
                    <span className="ta-msg">{l.addedToPlan ? t['tc.assignments.addedToPlan'] : t['tc.assignments.hadConcept']}</span>
                  </span>
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
