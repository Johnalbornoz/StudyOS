import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getOrCreateStudentId } from '@/lib/auth';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages, type MessageKey } from '@/lib/i18n/messages';
import { fillMessage } from '@/lib/i18n/roles-messages';
import { getPersonalPlan, type PlanEntryView } from '@/lib/learning-plan/personal-plan.service';
import { getStudentCurriculumView } from '@/lib/learning-plan/student-views.service';
import { getStudentRecommendations, type RecommendationReason } from '@/lib/learning-plan/recommendations.service';
import { refreshExamGapRecommendations } from '@/lib/learning-plan/exam-bridge.service';
import { listStudentExamProfiles } from '@/lib/assessment/student-exam-profile.service';
import { getExamDefinition } from '@/lib/assessment/exam-definition.service';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import StartSessionButton from '../StartSessionButton';
import { AddToPlanButton, ArchiveToggle, ExamRecommendationActions } from './PlanActions';

type Tab = 'plan' | 'explore' | 'recommended' | 'exam';
const TABS: Tab[] = ['plan', 'explore', 'recommended', 'exam'];

/**
 * Track A -- the Student's learning plan: what I'm studying (Mi plan), what I
 * can study (Explorar currículo), what is recommended and why, and exam
 * preparation. Every concept is identified by its canonical id; adding goes
 * through the universal enrollment (one learner state per concept, progress
 * never reset); the Learning Engine is launched through the normal session
 * start. This page decides nothing pedagogical.
 */
export default async function LearningPlanPage({ searchParams }: { searchParams: Promise<{ tab?: string; subject?: string; context?: string }> }) {
  const sp = await searchParams;
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect('/sign-in');
  const studentId = await getOrCreateStudentId(clerkUserId);
  const locale = await getInterfaceLanguage(studentId).catch(() => 'es' as const);
  const t = getMessages(locale);
  const tab: Tab = TABS.includes(sp.tab as Tab) ? (sp.tab as Tab) : 'plan';
  const stageLabel = (stage: string | null) => (stage ? t[`conceptMission.stage.${stage}` as MessageKey] : t['lp.phase.NOT_STARTED']);
  const tabHref = (k: Tab) => `/dashboard/plan?tab=${k}`;
  const startLabels = { unavailableLabel: t['lp.plan.unavailable'], retryLabel: t['lp.plan.retry'], licenseTitle: t['learning.licenseRequiredTitle'], licenseBody: t['learning.licenseRequiredBody'], licenseCtaLabel: t['license.demoBannerCta'] };
  const addLabels = { add: t['lp.explore.add'], adding: t['lp.explore.adding'], error: t['lp.error'] };

  return (
    <div className="ta-stack">
      <PageHeader title={t['lp.title']} subtitle={t['lp.subtitle']} />
      <nav aria-label={t['lp.title']} className="ta-subnav">
        {TABS.map((k) => (
          <Link key={k} href={tabHref(k)} aria-current={k === tab ? 'page' : undefined}>
            {t[`lp.tab.${k}` as MessageKey]}
          </Link>
        ))}
      </nav>

      {tab === 'plan' && <PlanTab />}
      {tab === 'explore' && <ExploreTab />}
      {tab === 'recommended' && <RecommendedTab />}
      {tab === 'exam' && <ExamTab />}
    </div>
  );

  function sourceText(e: PlanEntryView) {
    return e.sources.map((s) => (s.className && (s.type === 'CLASS_PLAN' || s.type === 'TEACHER_ASSIGNMENT') ? `${t[`lp.source.${s.type}` as MessageKey]} · ${s.className}` : t[`lp.source.${s.type}` as MessageKey])).join(' · ');
  }

  async function PlanTab() {
    const plan = await getPersonalPlan(studentId, locale);
    const active = plan.entries.filter((e) => e.planStatus === 'IN_PLAN');
    const archived = plan.entries.filter((e) => e.planStatus === 'ARCHIVED');
    const bySubject = new Map<string, PlanEntryView[]>();
    for (const e of active) bySubject.set(e.subjectName, [...(bySubject.get(e.subjectName) ?? []), e]);
    return (
      <>
        {active.length === 0 ? (
          <EmptyState title={t['lp.plan.empty']} body={t['lp.plan.emptyBody']} />
        ) : (
          [...bySubject.entries()].map(([subject, entries]) => (
            <section key={subject} className="ta-stack" style={{ gap: 'var(--space-2)' }} aria-label={subject}>
              <h2 style={{ fontSize: 18 }}>{subject}</h2>
              <ul className="list-card card" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {entries.map((e) => (
                  <li key={e.canonicalConceptId} className="list-row" style={{ flexWrap: 'wrap' }}>
                    <div className="row-main" style={{ flexBasis: 240 }}>
                      <div className="row-title">{e.label}</div>
                      <div className="row-sub">
                        {t['lp.plan.phase']}: {stageLabel(e.stage)}
                        {e.evidenceCount > 0 ? ` · ${fillMessage(t['lp.plan.evidence'], { n: e.evidenceCount })}` : ''}
                      </div>
                      {e.sources.length > 0 && <div className="row-sub">{t['lp.plan.sources']}: {sourceText(e)}</div>}
                    </div>
                    <span className={e.displayStatus === 'COMPLETED' || e.displayStatus === 'MAINTENANCE' ? 'chip chip-good' : 'chip'}>{t[`lp.status.${e.displayStatus}` as MessageKey]}</span>
                    <StartSessionButton studentId={studentId} actionConceptId={e.learnerConceptId} label={e.evidenceCount > 0 ? t['lp.plan.continue'] : t['lp.plan.start']} {...startLabels} />
                    <ArchiveToggle canonicalConceptId={e.canonicalConceptId} archived={false} labels={{ archive: t['lp.plan.archive'], restore: t['lp.plan.restore'], error: t['lp.error'] }} />
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
        <p>
          <Link href={tabHref('explore')} className="btn btn-secondary">
            {t['lp.plan.explore']}
          </Link>
        </p>
        {archived.length > 0 && (
          <details className="card ta-card">
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
              {t['lp.plan.archived']} ({archived.length})
            </summary>
            <ul className="role-list">
              {archived.map((e) => (
                <li key={e.canonicalConceptId} className="ta-coordinator">
                  <span>
                    {e.label} · <span className="ta-msg">{e.subjectName}</span>
                  </span>
                  <ArchiveToggle canonicalConceptId={e.canonicalConceptId} archived labels={{ archive: t['lp.plan.archive'], restore: t['lp.plan.restore'], error: t['lp.error'] }} />
                </li>
              ))}
            </ul>
          </details>
        )}
        {plan.ownConcepts.length > 0 && (
          <details className="card ta-card">
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
              {t['lp.plan.own']} ({plan.ownConcepts.length})
            </summary>
            <p className="ta-msg">{t['lp.plan.ownBody']}</p>
            <ul className="role-list ta-compact">
              {plan.ownConcepts.map((c) => (
                <li key={c.learnerConceptId}>
                  {c.label} · <span className="ta-msg">{c.subjectName}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </>
    );
  }

  async function ExploreTab() {
    const view = await getStudentCurriculumView(studentId, sp.subject ?? null, sp.context ?? null, locale);
    if (view.subjects.length === 0) {
      return (
        <EmptyState
          title={t['lp.explore.noSubjects']}
          action={
            <Link href="/dashboard/subjects/new" className="btn btn-primary">
              {t['lp.explore.createSubject']}
            </Link>
          }
        />
      );
    }
    const subjectHref = (key: string) => `/dashboard/plan?tab=explore&subject=${key}`;
    return (
      <>
        <section className="card ta-card" aria-label={t['lp.explore.subject']}>
          <div className="ta-row" style={{ alignItems: 'center' }}>
            <strong>{t['lp.explore.mine']}:</strong>
            {view.subjects.filter((s) => s.own).map((s) => (
              <Link key={s.catalogKey} href={subjectHref(s.catalogKey)} className={s.catalogKey === view.selected ? 'chip chip-good' : 'chip'} aria-current={s.catalogKey === view.selected ? 'page' : undefined}>
                {s.name}
              </Link>
            ))}
          </div>
          {view.subjects.some((s) => !s.own) && (
            <div className="ta-row" style={{ alignItems: 'center' }}>
              <span className="ta-msg">{t['lp.explore.otherSubjects']}:</span>
              {view.subjects.filter((s) => !s.own).map((s) => (
                <Link key={s.catalogKey} href={subjectHref(s.catalogKey)} className={s.catalogKey === view.selected ? 'chip chip-good' : 'chip'}>
                  {s.name}
                </Link>
              ))}
            </div>
          )}
          {view.selected && (
            <div className="ta-row" style={{ alignItems: 'center' }}>
              <strong>{t['lp.explore.context']}:</strong>
              <span>{view.context ? `${view.context.programme} · ${view.context.name} (${view.context.versionLabel})` : t['lp.explore.general']}</span>
              {view.reason && <span className="ta-msg">({t[`lp.explore.reason.${view.reason}` as MessageKey]})</span>}
            </div>
          )}
          {view.options.length > 0 && view.selected && (
            <div className="ta-row" style={{ alignItems: 'center' }}>
              <Link href={`${subjectHref(view.selected)}&context=general`} className={!view.context ? 'chip chip-good' : 'chip'}>
                {t['lp.explore.general']}
              </Link>
              {view.options.map((o) => (
                <Link key={o.academicSubjectId} href={`${subjectHref(view.selected!)}&context=${o.academicSubjectId}`} className={view.context?.academicSubjectId === o.academicSubjectId ? 'chip chip-good' : 'chip'}>
                  {o.programme} · {o.name}
                </Link>
              ))}
            </div>
          )}
          <p className="ta-msg">{fillMessage(t['lp.explore.counts'], view.counts)}</p>
        </section>
        {view.areas.length === 0 ? (
          <EmptyState title={t['lp.explore.empty']} />
        ) : (
          view.areas.map((area) => (
            <section key={area.label} className="ta-stack" style={{ gap: 'var(--space-2)' }} aria-label={area.label}>
              <h2 style={{ fontSize: 16 }}>{area.label}</h2>
              <ul className="list-card card" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {area.concepts.map((c) => (
                  <li key={c.canonicalConceptId} className="list-row" style={{ flexWrap: 'wrap' }}>
                    <div className="row-main" style={{ flexBasis: 220 }}>
                      <div className="row-title">{c.label}</div>
                      {c.prerequisiteLabels.length > 0 && <div className="row-sub">{fillMessage(t['lp.explore.prereqs'], { list: c.prerequisiteLabels.join(', ') })}</div>}
                      {c.status && <div className="row-sub">{t['lp.plan.phase']}: {stageLabel(c.stage)}</div>}
                    </div>
                    {c.classification && <span className="chip">{t[`lp.class.${c.classification}` as MessageKey]}</span>}
                    {c.recommended && <span className="chip chip-warn">{t['lp.explore.recommended']}</span>}
                    {c.status && c.status !== 'ARCHIVED' ? (
                      <>
                        <span className="chip chip-good">{t[`lp.status.${c.status}` as MessageKey]}</span>
                        {c.learnerConceptId && <StartSessionButton studentId={studentId} actionConceptId={c.learnerConceptId} label={t['lp.plan.continue']} variant="secondary" {...startLabels} />}
                      </>
                    ) : (
                      <AddToPlanButton canonicalConceptId={c.canonicalConceptId} source={c.recommended ? 'CURRICULUM_RECOMMENDATION' : 'SELF_SELECTED'} labels={addLabels} />
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </>
    );
  }

  function reasonText(r: RecommendationReason) {
    if (r.type === 'NEXT_CONCEPT' && !r.detail) return t['lp.rec.reason.NEXT_FIRST'];
    return fillMessage(t[`lp.rec.reason.${r.type}` as MessageKey], { detail: r.detail ?? '' });
  }

  async function RecommendedTab() {
    await refreshExamGapRecommendations(studentId).catch(() => 0);
    const recs = await getStudentRecommendations(studentId, locale);
    if (recs.length === 0) return <EmptyState title={t['lp.rec.empty']} />;
    return (
      <ul className="list-card card" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {recs.map((r) => {
          const primary = r.reasons[0];
          const exam = r.reasons.find((x) => x.type === 'EXAM_GAP');
          const sourceFor = primary.type === 'CLASS_PLAN' ? 'CLASS_PLAN' : primary.type === 'INSTITUTION_REQUIRED' ? 'INSTITUTION_CURRICULUM' : primary.type === 'PREREQUISITE' ? 'PREREQUISITE_RECOMMENDATION' : 'CURRICULUM_RECOMMENDATION';
          return (
            <li key={r.canonicalConceptId} className="list-row" style={{ flexWrap: 'wrap' }}>
              <div className="row-main" style={{ flexBasis: 240 }}>
                <div className="row-title">{r.label}</div>
                {r.reasons.map((reason, i) => (
                  <div key={i} className="row-sub">
                    {reasonText(reason)}
                    {reason.targetDate ? ` · ${new Date(reason.targetDate).toLocaleDateString(locale)}` : ''}
                  </div>
                ))}
              </div>
              {r.inPlan ? (
                <>
                  <span className="ta-msg">{t['lp.rec.already']}</span>
                  {r.learnerConceptId && <StartSessionButton studentId={studentId} actionConceptId={r.learnerConceptId} label={t['lp.plan.continue']} variant="secondary" {...startLabels} />}
                  {exam?.examRecommendationId && <ExamRecommendationActions recommendationId={exam.examRecommendationId} labels={{ reinforce: t['lp.rec.add'], add: t['lp.rec.add'], dismiss: t['lp.rec.dismiss'], error: t['lp.error'] }} />}
                </>
              ) : exam?.examRecommendationId ? (
                <ExamRecommendationActions recommendationId={exam.examRecommendationId} labels={{ reinforce: t['lp.rec.reinforce'], add: t['lp.rec.add'], dismiss: t['lp.rec.dismiss'], error: t['lp.error'] }} />
              ) : (
                <AddToPlanButton canonicalConceptId={r.canonicalConceptId} source={sourceFor} classId={primary.classId ?? null} labels={{ add: t['lp.rec.add'], adding: t['lp.explore.adding'], error: t['lp.error'] }} />
              )}
            </li>
          );
        })}
      </ul>
    );
  }

  async function ExamTab() {
    const profiles = await listStudentExamProfiles(studentId);
    // Track B objective-first profiles may have no exam definition: fall back to the objective's own label.
    const named = await Promise.all(profiles.map(async (p) => ({
      ...p,
      name: (p.examDefinitionId ? (await getExamDefinition(p.examDefinitionId))?.name : null)
        ?? (typeof p.objectiveContext?.label === 'string' ? p.objectiveContext.label : null)
        ?? p.objectiveKey ?? '',
    })));
    return (
      <>
        {named.length === 0 ? (
          <EmptyState title={t['lp.exam.empty']} />
        ) : (
          <ul className="list-card card" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {named.map((p) => (
              <li key={p.id} className="list-row" style={{ flexWrap: 'wrap' }}>
                <div className="row-main" style={{ flexBasis: 220 }}>
                  <div className="row-title">{p.name}</div>
                  {p.examDate && <div className="row-sub">{new Date(p.examDate).toLocaleDateString(locale)}</div>}
                </div>
                <Link href={`/dashboard/plan/exam/${p.id}`} className="btn btn-secondary">
                  {t['lp.exam.open']}
                </Link>
              </li>
            ))}
          </ul>
        )}
        <p>
          <Link href="/dashboard/exam-prep" className="btn btn-ghost">
            {t['lp.exam.setup']}
          </Link>
        </p>
      </>
    );
  }
}
