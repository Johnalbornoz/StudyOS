import { auth } from '@clerk/nextjs/server';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { getUserInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import { fillMessage } from '@/lib/i18n/roles-messages';
import { getTeacherClassRoster } from '@/lib/teacher/read-model.service';
import { isTeacherOfClass, listAssignableConceptsForClass, listClassAssignments } from '@/lib/teacher/class-assignment.service';
import { db } from '@/lib/db';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusBadge, toneForInterventionStatus } from '@/components/ui/StatusBadge';
import { ClassAssignmentComposer } from './ClassAssignmentComposer';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * F13 / Track A (A3) -- one class, for the teacher who TEACHES it (approved
 * membership + active scope). Anyone else -- a pending teacher, another
 * class's teacher, an institution admin -- gets the same not-found a real
 * 404 would (never "exists but not yours"). Roster, class assignments with
 * each learner's outcome (read back from the canonical activity records),
 * and the assignment composer.
 */
export default async function TeacherClassPage({ params }: { params: Promise<{ classId: string }> }) {
  const { classId } = await params;
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect('/sign-in');
  if (!UUID_RE.test(classId)) notFound();

  const actor = await getOrCreateCanonicalUser(clerkUserId, null);
  if (!(await isTeacherOfClass(actor.id, classId))) notFound();

  const locale = await getUserInterfaceLanguage(actor.id).catch(() => 'es' as const);
  const t = getMessages(locale);

  const [klass, roster, assignable, assignments] = await Promise.all([
    db.query(`SELECT name FROM classes WHERE id = $1`, [classId]),
    getTeacherClassRoster(actor.id, classId),
    listAssignableConceptsForClass(actor.id, classId),
    listClassAssignments(actor.id, classId),
  ]);

  return (
    <div className="ta-stack">
      <PageHeader title={klass.rows[0]?.name ?? ''} breadcrumb={<Link href="/dashboard/teacher">{t['nav.teacherClasses']}</Link>} />

      <section aria-labelledby="roster-title" className="ta-stack" style={{ gap: 'var(--space-3)' }}>
        <h2 id="roster-title" style={{ fontSize: 18 }}>{t['teacher.roster.title']}</h2>
        {roster.length === 0 ? (
          <EmptyState title={t['teacher.roster.empty']} />
        ) : (
          <ul className="list-card card" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {roster.map((s) => (
              <li key={s.studentId} className="list-row">
                <div className="row-main">
                  <Link href={`/dashboard/teacher/students/${s.studentId}?classId=${classId}`} className="row-title">
                    {s.name}
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ClassAssignmentComposer
        classId={classId}
        concepts={assignable.concepts}
        activeLearners={assignable.activeLearners}
        labels={{
          title: t['teacherClass.compose.title'],
          body: t['teacherClass.compose.body'],
          concept: t['teacherClass.compose.concept'],
          conceptOption: t['teacherClass.compose.conceptOption'],
          noConcepts: t['teacherClass.compose.noConcepts'],
          noLearners: t['teacherClass.compose.noLearners'],
          instructions: t['teacherClass.compose.instructions'],
          due: t['teacherClass.compose.due'],
          publish: t['teacherClass.compose.publish'],
          publishing: t['teacherClass.compose.publishing'],
          published: t['teacherClass.compose.published'],
          skipped: t['teacherClass.compose.skipped'],
          error: t['teacherClass.compose.error'],
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
                <span className="ta-msg">
                  {fillMessage(t['teacherClass.assignments.progress'], { done: a.counts.COMPLETED, total: a.learners.length })}
                  {a.dueAt ? ` · ${fillMessage(t['teacherClass.due'], { date: new Date(a.dueAt).toLocaleDateString(locale) })}` : ''}
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
                  <Link href={`/dashboard/teacher/students/${l.studentId}?classId=${classId}`}>{l.studentName}</Link>
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
