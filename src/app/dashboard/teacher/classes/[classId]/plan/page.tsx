import { auth } from '@clerk/nextjs/server';
import { redirect, notFound } from 'next/navigation';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { getUserInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages, type MessageKey } from '@/lib/i18n/messages';
import { fillMessage } from '@/lib/i18n/roles-messages';
import { getTeacherClass } from '@/lib/teacher/class-assignment.service';
import { getClassPlanView, getClassNeeds, type ClassPlanConceptView } from '@/lib/learning-plan/class-plan.service';
import { listClassRosterForInstitution } from '@/services/institution.service';
import { EmptyState } from '@/components/ui/EmptyState';
import { InlineAlert } from '@/components/ui/InlineAlert';
import { ClassChrome } from '../class-chrome';
import { AddToClassPlanButton, RemoveFromClassPlanButton, ClassPlanConceptEditor, AssignConceptControl } from './ClassPlanActions';
import { ProposeConceptForm } from '@/components/learning-plan/ProposeConceptForm';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Track A -- Class Learning Plan (the class's Teacher only). Three blocks:
 * the current class plan (edit / remove / assign to all or selected, with a
 * preview), the suggested curriculum (institution curriculum when adopted,
 * else the subject catalog; coverage + prerequisites) and detected needs
 * (aggregated exam gaps -> "Asignar a estos N"). Plus "proponer concepto".
 * Assigning merges into each personal plan; no learner state is reset.
 */
export default async function TeacherClassPlanPage({ params }: { params: Promise<{ classId: string }> }) {
  const { classId } = await params;
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect('/sign-in');
  if (!UUID_RE.test(classId)) notFound();
  const actor = await getOrCreateCanonicalUser(clerkUserId, null);
  const klass = await getTeacherClass(actor.id, classId);
  if (!klass) notFound();
  const locale = await getUserInterfaceLanguage(actor.id).catch(() => 'es' as const);
  const t = getMessages(locale);

  if (!klass.subjectId) {
    return (
      <div className="ta-stack">
        <ClassChrome klass={klass} active="plan" t={t} />
        <InlineAlert tone="info" title={t['tc.noSubject.title']} body={t['tcp.plan.noSubject']} />
      </div>
    );
  }

  const [view, needs, roster] = await Promise.all([getClassPlanView(actor.id, classId, locale), getClassNeeds(actor.id, classId, locale), listClassRosterForInstitution(klass.institutionId, classId)]);
  const learners = roster.filter((r) => r.status === 'ACTIVE').map((r) => ({ studentId: r.studentId, name: r.name }));
  const current = view.concepts.filter((c) => c.inClassPlan);
  const suggested = view.concepts.filter((c) => !c.inClassPlan);
  const assignLabels = {
    assignAll: t['tcp.plan.assignAll'],
    assignSelected: t['tcp.plan.assignSelected'],
    selectStudents: t['tcp.plan.selectStudents'],
    preview: t['tcp.plan.preview'],
    confirm: t['tc.compose.assign'],
    cancel: t['tcp.plan.cancel'],
    assigning: t['tcp.plan.assigning'],
    done: t['tcp.plan.assignDone'],
    error: t['inst.common.error'],
  };
  const meta = (c: ClassPlanConceptView) =>
    [
      c.classification ? t[`lp.class.${c.classification}` as MessageKey] : null,
      fillMessage(t['tcp.plan.coverage'], { n: c.studentsWithConcept, total: view.activeLearners }),
      c.prerequisiteLabels.length ? fillMessage(t['lp.explore.prereqs'], { list: c.prerequisiteLabels.join(', ') }) : null,
    ]
      .filter(Boolean)
      .join(' · ');

  return (
    <div className="ta-stack">
      <ClassChrome klass={klass} active="plan" t={t} />
      <p className="ta-msg">{t['tcp.plan.subtitle']}</p>
      {!view.hasInstitutionCurriculum && <InlineAlert tone="info" title={t['tcp.plan.suggested']} body={t['tcp.plan.noCurriculum']} />}

      <section aria-labelledby="current-title" className="ta-stack" style={{ gap: 'var(--space-3)' }}>
        <h2 id="current-title" style={{ fontSize: 18 }}>{t['tcp.plan.current']}</h2>
        {current.length === 0 ? (
          <EmptyState title={t['tcp.plan.currentEmpty']} />
        ) : (
          current.map((c) => (
            <article key={c.canonicalConceptId} className="card ta-card" aria-label={c.label}>
              <div className="ta-coordinator">
                <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  <strong>{c.label}</strong>
                  <span className="ta-msg">{meta(c)}</span>
                  <span className="ta-msg">
                    {[
                      `${t['tcp.plan.priority']}: ${t[`tcp.plan.priority.${c.priority ?? 'NORMAL'}` as MessageKey]}`,
                      c.targetDate ? `${t['tcp.plan.targetDate']}: ${new Date(`${c.targetDate}T00:00:00`).toLocaleDateString(locale)}` : null,
                      c.period ? `${t['tcp.plan.period']}: ${c.period}` : null,
                      c.requiredForClass ? t['tcp.plan.required'] : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                <span className="ta-actions">
                  {c.supplemental && <span className="chip chip-warn">{t['tcp.plan.supplementalBadge']}</span>}
                  <RemoveFromClassPlanButton classId={classId} canonicalConceptId={c.canonicalConceptId} label={t['tcp.plan.remove']} confirmText={t['tcp.plan.removeConfirm']} errorLabel={t['inst.common.error']} />
                </span>
              </div>
              <AssignConceptControl classId={classId} canonicalConceptId={c.canonicalConceptId} learners={learners} labels={assignLabels} />
              <details>
                <summary style={{ cursor: 'pointer' }}>{t['tcp.plan.edit']}</summary>
                <ClassPlanConceptEditor
                  classId={classId}
                  canonicalConceptId={c.canonicalConceptId}
                  initial={{ priority: c.priority ?? 'NORMAL', targetDate: c.targetDate, period: c.period, requiredForClass: c.requiredForClass }}
                  labels={{
                    priority: t['tcp.plan.priority'],
                    priorities: { HIGH: t['tcp.plan.priority.HIGH'], NORMAL: t['tcp.plan.priority.NORMAL'], LOW: t['tcp.plan.priority.LOW'] },
                    targetDate: t['tcp.plan.targetDate'],
                    period: t['tcp.plan.period'],
                    required: t['tcp.plan.required'],
                    save: t['tcp.plan.save'],
                    saved: t['tcp.plan.saved'],
                    error: t['inst.common.error'],
                  }}
                />
              </details>
            </article>
          ))
        )}
      </section>

      <section aria-labelledby="needs-title" className="ta-stack" style={{ gap: 'var(--space-3)' }}>
        <h2 id="needs-title" style={{ fontSize: 18 }}>{t['tcp.plan.needs']}</h2>
        {needs.length === 0 ? (
          <EmptyState title={t['tcp.plan.needsEmpty']} />
        ) : (
          needs.map((n) => (
            <article key={n.canonicalConceptId} className="card ta-card" aria-label={n.label}>
              <strong>{n.label}</strong>
              <span className="ta-msg">{fillMessage(t['tcp.plan.needsBody'], { n: n.students.length })}</span>
              <span className="ta-msg">{n.students.map((s) => s.name).join(', ')}</span>
              <AssignConceptControl
                classId={classId}
                canonicalConceptId={n.canonicalConceptId}
                learners={n.students}
                fixedStudentIds={n.students.map((s) => s.studentId)}
                labels={{ ...assignLabels, assignThese: fillMessage(t['tcp.plan.assignThese'], { n: n.students.length }) }}
              />
            </article>
          ))
        )}
      </section>

      <section aria-labelledby="suggested-title" className="ta-stack" style={{ gap: 'var(--space-3)' }}>
        <h2 id="suggested-title" style={{ fontSize: 18 }}>{t['tcp.plan.suggested']}</h2>
        <p className="ta-msg">{t['tcp.plan.suggestedBody']}</p>
        {suggested.length === 0 ? (
          <EmptyState title={t['lp.explore.empty']} />
        ) : (
          <ul className="list-card card" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {suggested.map((c) => (
              <li key={c.canonicalConceptId} className="list-row" style={{ flexWrap: 'wrap' }}>
                <div className="row-main" style={{ flexBasis: 240 }}>
                  <div className="row-title">{c.label}</div>
                  <div className="row-sub">{meta(c)}</div>
                </div>
                <AddToClassPlanButton
                  classId={classId}
                  canonicalConceptId={c.canonicalConceptId}
                  label={view.hasInstitutionCurriculum && !c.classification ? t['tcp.plan.addSupplemental'] : t['tcp.plan.add']}
                  errorLabel={t['inst.common.error']}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card ta-card" aria-labelledby="propose-title">
        <h2 id="propose-title">{t['tcp.plan.propose']}</h2>
        <p className="ta-msg">{t['tcp.plan.proposeBody']}</p>
        <ProposeConceptForm
          endpoint={`/api/teacher/classes/${classId}/concept-proposals`}
          labels={{ title: t['tcp.plan.proposeTitle'], rationale: t['tcp.plan.proposeRationale'], submit: t['tcp.plan.proposeSubmit'], done: t['tcp.plan.proposeDone'], candidates: t['tcp.plan.proposeCandidates'], error: t['inst.common.error'] }}
        />
      </section>
    </div>
  );
}
