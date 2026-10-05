import { auth } from '@clerk/nextjs/server';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { getUserInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import { fillMessage } from '@/lib/i18n/roles-messages';
import { getTeacherClass, listClassAssignments } from '@/lib/teacher/class-assignment.service';
import { listClassLearnerAttention } from '@/lib/teacher/learner-view.service';
import { EmptyState } from '@/components/ui/EmptyState';
import { InlineAlert } from '@/components/ui/InlineAlert';
import { attentionLabels } from '../../attention-labels';
import { ClassChrome } from './class-chrome';
import { ClassExamAssignments } from '@/components/exam-eligibility/ClassExamAssignments';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * F13 / Track A -- one class, for the teacher who TEACHES it (approved
 * membership + active scope). Anyone else -- a pending teacher, another
 * class's teacher, an institution admin -- gets the same not-found a real
 * 404 would (never "exists but not yours").
 *
 * Resumen tab: context (institution · grade · subject), "who needs help"
 * (read-only projection of the canonical read models) and a summary of the
 * class plan and tasks. Roster, tasks, plan and progress live in their own
 * tabs (Plan de aprendizaje | Estudiantes | Tareas | Progreso).
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
  const [assignments, attention] = await Promise.all([listClassAssignments(actor.id, classId), listClassLearnerAttention(actor.id, classId)]);
  const latest = assignments[0];
  const labels = attentionLabels(t);

  return (
    <div className="ta-stack">
      <ClassChrome klass={klass} active="overview" t={t} />

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

      <section className="card ta-card" aria-labelledby="summary-title">
        <h2 id="summary-title">{t['tcp.assignments.title']}</h2>
        {latest ? (
          <p className="ta-msg">
            <strong>{latest.title}</strong> ·{' '}
            {fillMessage(t['tc.assignments.counts'], { assigned: latest.counts.ASSIGNED, started: latest.counts.IN_PROGRESS, completed: latest.counts.COMPLETED, overdue: latest.counts.EXPIRED })}
          </p>
        ) : (
          <p className="ta-msg">{t['teacherClass.assignments.empty']}</p>
        )}
        <span className="ta-actions">
          <Link href={`/dashboard/teacher/classes/${classId}/assignments`} className="btn btn-secondary">
            {t['tcp.nav.assignments']}
          </Link>
          <Link href={`/dashboard/teacher/classes/${classId}/plan`} className="btn btn-ghost">
            {t['tcp.nav.plan']}
          </Link>
        </span>
      </section>

      <ClassExamAssignments apiBase={`/api/teacher/classes/${classId}/exam-assignments`} labels={Object.fromEntries(Object.entries(t as Record<string, string>).filter(([k]) => k.startsWith('elig.assign.') || k.startsWith('prep.fw.')))} />
    </div>
  );
}
