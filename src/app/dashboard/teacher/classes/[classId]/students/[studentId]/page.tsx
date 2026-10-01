import { auth } from '@clerk/nextjs/server';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { getUserInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages, type MessageKey } from '@/lib/i18n/messages';
import { fillMessage } from '@/lib/i18n/roles-messages';
import { getTeacherLearnerView, TeacherLearnerAccessDeniedError, type LearnerConceptState } from '@/lib/teacher/learner-view.service';
import { listAssignableConceptsForClass } from '@/lib/teacher/class-assignment.service';
import { historyActivityLabel, resultLabel, type EvidenceResult } from '@/lib/concept-evidence-labels';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusBadge, toneForInterventionStatus } from '@/components/ui/StatusBadge';
import { CancelInterventionButton } from '@/app/dashboard/teacher/students/CancelInterventionButton';
import { ClassAssignmentComposer } from '../../ClassAssignmentComposer';
import { attentionLabels } from '../../../../attention-labels';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Track A -- the Teacher's view of ONE learner in ONE class they teach,
 * scoped to the class's subject: who needs help → on what → why → what
 * the Teacher can do; the canonical learning state per topic (stage, next
 * step, valid practice, last successful demonstration, memory, transfer);
 * evidence; gaps (misconceptions, slips vs errors, prerequisites); and
 * this learner's assignments. Read-only over the canonical read models --
 * the Teacher can assign or re-assign practice, never edit a phase,
 * mastery or evidence. Anything outside the actor's own class/learner is
 * a plain not-found. Tutor conversations, parent data and billing are
 * never read here.
 */
export default async function TeacherLearnerPage({ params }: { params: Promise<{ classId: string; studentId: string }> }) {
  const { classId, studentId } = await params;
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect('/sign-in');
  if (!UUID_RE.test(classId) || !UUID_RE.test(studentId)) notFound();

  const actor = await getOrCreateCanonicalUser(clerkUserId, null);
  let view;
  try {
    view = await getTeacherLearnerView(actor.id, classId, studentId);
  } catch (error) {
    if (error instanceof TeacherLearnerAccessDeniedError) notFound();
    throw error;
  }
  const assignable = await listAssignableConceptsForClass(actor.id, classId);

  const locale = await getUserInterfaceLanguage(actor.id).catch(() => 'es' as const);
  const t = getMessages(locale);
  const labels = attentionLabels(t);
  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(locale) : null);
  const { klass } = view;
  const focus = view.attention.find((a) => a.canonicalConceptId)?.canonicalConceptId ?? undefined;

  const nextStep = (c: LearnerConceptState): string => {
    if (c.decisionUnavailable) return t['tl.unavailable'];
    if (c.actionState === 'WAITING') return c.nextEligibleAt ? fillMessage(t['tl.next.waitingUntil'], { date: fmt(c.nextEligibleAt) }) : t['tl.next.waiting'];
    if (c.actionState === 'CONSOLIDATED' || c.nextAction === 'NONE' || !c.nextAction) return t['tl.next.NONE'];
    return t[`tl.next.${c.nextAction}` as MessageKey];
  };

  return (
    <div className="ta-stack">
      <PageHeader
        title={view.student.name}
        subtitle={[klass.subjectName ? `${klass.name} · ${klass.subjectName}` : klass.name, klass.gradeName, klass.institutionName].filter(Boolean).join(' · ')}
        breadcrumb={<Link href={`/dashboard/teacher/classes/${classId}`}>{klass.name}</Link>}
      />
      <p className="ta-msg">{t['tl.readOnlyNote']}</p>

      <section className="card ta-card" aria-labelledby="needs-title">
        <h2 id="needs-title">{t['tl.needs.title']}</h2>
        {view.attention.length === 0 ? (
          <p className="ta-msg">{t['tc.help.onTrack']}</p>
        ) : (
          <ul className="role-list">
            {view.attention.map((a, i) => (
              <li key={i} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span>
                  <strong>{labels.reason[a.reason]}</strong> · {a.topic}
                </span>
                {a.detail && <span className="ta-msg">{fillMessage(t['tl.needs.why'], { detail: a.detail })}</span>}
                <span className="ta-msg">
                  {fillMessage(t['tc.help.suggestion'], { action: labels.suggestion[a.suggestion] })} ·{' '}
                  <a href="#assign">{t['tl.needs.assignNow']}</a>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="state-title" className="ta-stack" style={{ gap: 'var(--space-3)' }}>
        <h2 id="state-title" style={{ fontSize: 18 }}>{t['tl.state.title']}</h2>
        {view.concepts.length === 0 ? (
          <EmptyState title={klass.subjectId ? t['tl.state.noTopics'] : t['tc.noSubject.body']} />
        ) : (
          view.concepts.map((c) => (
            <article key={c.canonicalConceptId} className="card ta-card" aria-label={c.topic}>
              <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 'var(--space-2)', alignItems: 'center' }}>
                <h3 style={{ margin: 0, fontSize: 16 }}>{c.topic}</h3>
                <span className={c.reinforce ? 'chip chip-warn' : 'chip'}>
                  {c.reinforce ? t['myPathStage.REINFORCE'] : t[`conceptMission.stage.${c.stage ?? 'NOT_STARTED'}`]}
                </span>
              </div>
              {!c.inLearnerPlan ? (
                <p className="ta-msg">{t['tl.state.notInPlan']}</p>
              ) : (
                <>
                  <dl className="ta-facts">
                    <dt>{t['tl.state.phase']}</dt>
                    <dd>{c.stage ? t[`conceptMission.stage.${c.stage}`] : t['tl.unavailable']}</dd>
                    <dt>{t['tl.state.next']}</dt>
                    <dd>{nextStep(c)}</dd>
                    <dt>{t['tl.state.practice']}</dt>
                    <dd>{c.practice ? fillMessage(t['tl.state.practiceValue'], { n: c.practice.passesInWindow, required: c.practice.requiredPasses }) : '—'}</dd>
                    <dt>{t['tl.state.lastProve']}</dt>
                    <dd>{c.lastSuccessfulProveAt ? fmt(c.lastSuccessfulProveAt) : t['tl.state.notYet']}</dd>
                    <dt>{t['tl.state.retention']}</dt>
                    <dd>
                      {c.retention
                        ? [
                            t[`tl.memory.${c.retention.status}` as MessageKey],
                            c.retention.due ? t['tl.memory.due'] : c.retention.nextReviewAt ? fillMessage(t['tl.memory.nextReview'], { date: fmt(c.retention.nextReviewAt) }) : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')
                        : t['tl.memory.none']}
                    </dd>
                    <dt>{t['tl.state.transfer']}</dt>
                    <dd>{t[`tl.transfer.${c.transferDepth ?? 'NONE'}`]}</dd>
                  </dl>

                  <h4 style={{ margin: 'var(--space-2) 0 0', fontSize: 14 }}>{t['tl.evidence.title']}</h4>
                  <p className="ta-msg">
                    {fillMessage(t['tl.evidence.summary'], {
                      total: c.evidence.totalAttempts,
                      correct: c.evidence.correctAttempts,
                      independent: c.evidence.independentAttempts,
                    })}
                    {c.evidence.lastEvidenceAt ? ` · ${fillMessage(t['tl.evidence.last'], { date: fmt(c.evidence.lastEvidenceAt) })}` : ''}
                  </p>
                  {c.recentActivity.length > 0 && (
                    <ul className="role-list ta-compact">
                      {c.recentActivity.map((r, i) => (
                        <li key={i} style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', justifyContent: 'space-between' }}>
                          <span>
                            {fmt(r.at)} · {historyActivityLabel({ sourceType: r.sourceType, activityType: r.activityType }, t)}
                            {r.independent ? ` · ${t['tl.evidence.solo']}` : ''}
                          </span>
                          <span className="ta-msg">
                            {resultLabel(r.result as EvidenceResult, t)}
                            {r.scorePercent !== null ? ` · ${Math.round(r.scorePercent)}%` : ''}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}

                  <h4 style={{ margin: 'var(--space-2) 0 0', fontSize: 14 }}>{t['tl.gaps.title']}</h4>
                  <ul className="role-list ta-compact">
                    <li>
                      {c.misconceptions.active > 0
                        ? fillMessage(t['tl.gaps.misconceptions'], { n: c.misconceptions.active })
                        : t['tl.gaps.noMisconceptions']}
                      {c.misconceptions.items.map((m, i) => (
                        <div key={i} className="ta-msg">
                          {fillMessage(t['tl.gaps.misconceptionItem'], { description: m.description, n: m.occurrences })}
                        </div>
                      ))}
                    </li>
                    <li>{fillMessage(t['tl.gaps.signals'], { slips: c.answerSignals.minorSlips, errors: c.answerSignals.mathErrors + c.answerSignals.misconceptions })}</li>
                    <li>
                      {c.prerequisiteGaps.length > 0
                        ? fillMessage(t['tl.gaps.prerequisites'], { list: c.prerequisiteGaps.map((g) => g.label).join(', ') })
                        : t['tl.gaps.noPrerequisites']}
                    </li>
                  </ul>
                </>
              )}
            </article>
          ))
        )}
      </section>

      <section aria-labelledby="learner-assignments" className="ta-stack" style={{ gap: 'var(--space-3)' }}>
        <h2 id="learner-assignments" style={{ fontSize: 18 }}>{t['tl.assignments.title']}</h2>
        {view.assignments.length === 0 ? (
          <EmptyState title={t['teacher.interventions.empty']} />
        ) : (
          <ul className="list-card card" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {view.assignments.map((a) => (
              <li key={a.interventionId} className="list-row" style={{ flexWrap: 'wrap' }}>
                <div className="row-main" style={{ flexBasis: 220 }}>
                  <div className="row-title">{a.title}</div>
                  <div className="row-sub">
                    {[
                      a.title !== a.topic ? a.topic : null,
                      fillMessage(t['tc.assignments.created'], { date: fmt(a.assignedAt) }),
                      a.dueAt ? fillMessage(t['teacherClass.due'], { date: fmt(a.dueAt) }) : null,
                      a.result ? fillMessage(t['teacherClass.result'], { correct: a.result.correct, total: a.result.total }) : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </div>
                <StatusBadge label={t[`assignments.status.${a.status}`]} tone={toneForInterventionStatus(a.status)} />
                {(a.status === 'ASSIGNED' || a.status === 'IN_PROGRESS') && (
                  <CancelInterventionButton interventionId={a.interventionId} label={t['teacherStudent.cancel']} errorLabel={t['inst.common.error']} />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div id="assign">
        <ClassAssignmentComposer
          classId={classId}
          concepts={assignable.concepts}
          activeLearners={[{ studentId, name: view.student.name }]}
          subjectLinked={assignable.subjectLinked}
          preset={{ canonicalConceptId: focus, studentId }}
          labels={{
            title: t['tl.assign.title'],
            body: t['tl.assign.body'],
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
            publish: t['teacherStudent.assign.submit'],
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
      </div>
    </div>
  );
}
