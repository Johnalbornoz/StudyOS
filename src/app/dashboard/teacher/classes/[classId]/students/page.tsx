import { auth } from '@clerk/nextjs/server';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { getUserInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages, type MessageKey } from '@/lib/i18n/messages';
import { fillMessage } from '@/lib/i18n/roles-messages';
import { getTeacherClass } from '@/lib/teacher/class-assignment.service';
import { getClassStudentPlans, type ClassStudentPlan } from '@/lib/learning-plan/class-plan.service';
import { listClassRosterForInstitution } from '@/services/institution.service';
import { EmptyState } from '@/components/ui/EmptyState';
import { InviteStudentForm, PostActionButton } from '@/app/dashboard/institution/[institutionId]/InstitutionForms';
import { ClassChrome } from '../class-chrome';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Track A -- the class's students for its Teacher: roster with consent-based
 * invitations, and the student-centric view (each learner's concepts of the
 * class subject in their plan, with phase and sources). Read-only for
 * learner state.
 */
export default async function TeacherClassStudentsPage({ params }: { params: Promise<{ classId: string }> }) {
  const { classId } = await params;
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect('/sign-in');
  if (!UUID_RE.test(classId)) notFound();

  const actor = await getOrCreateCanonicalUser(clerkUserId, null);
  const klass = await getTeacherClass(actor.id, classId);
  if (!klass) notFound();

  const locale = await getUserInterfaceLanguage(actor.id).catch(() => 'es' as const);
  const t = getMessages(locale);

  const [roster, plans] = await Promise.all([
    listClassRosterForInstitution(klass.institutionId, classId),
    klass.subjectId ? getClassStudentPlans(actor.id, classId, locale) : Promise.resolve([] as ClassStudentPlan[]),
  ]);
  const stageLabel = (stage: string | null) => (stage ? t[`conceptMission.stage.${stage}` as MessageKey] : t['lp.phase.NOT_STARTED']);

  return (
    <div className="ta-stack">
      <ClassChrome klass={klass} active="students" t={t} />
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

      <section aria-labelledby="plans-title" className="ta-stack" style={{ gap: 'var(--space-3)' }}>
        <h2 id="plans-title" style={{ fontSize: 18 }}>{t['tcp.students.phases']}</h2>
        {plans.length === 0 ? (
          <EmptyState title={t['tcp.students.empty']} />
        ) : (
          <ul className="list-card card" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {plans.map((p) => (
              <li key={p.studentId} className="list-row" style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <div className="row-main" style={{ flexBasis: 260 }}>
                  <Link href={`/dashboard/teacher/classes/${classId}/students/${p.studentId}`} className="row-title">
                    {p.name}
                  </Link>
                  {p.concepts.length === 0 ? (
                    <div className="row-sub">{t['lp.plan.empty']}</div>
                  ) : (
                    p.concepts.map((c) => (
                      <div key={c.canonicalConceptId} className="row-sub">
                        <strong>{c.label}</strong>: {stageLabel(c.stage)}
                        {c.sources.length > 0 ? ` · ${t['tcp.learner.sources']}: ${c.sources.map((s) => t[`lp.source.${s}` as MessageKey]).join(', ')}` : ''}
                      </div>
                    ))
                  )}
                </div>
                <Link href={`/dashboard/teacher/classes/${classId}/students/${p.studentId}`} className="btn btn-secondary">
                  {t['tcp.students.view']}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
