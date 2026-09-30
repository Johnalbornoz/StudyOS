import { auth, currentUser } from '@clerk/nextjs/server';
import { after } from 'next/server';
import { scheduleDeliveryReplenishment } from '@/services/activity-delivery-worker.service';
import Link from 'next/link';
import { query } from '@/lib/db';
import { getOrCreateStudentId } from '@/lib/auth';
import { getLearningOSSnapshot, loadConceptLabels, type ConceptDisplayInfo } from '@/services/learning-os-snapshot.service';
import { getLearningPlanHorizon } from '@/services/learning-plan-read.service';
import { getLearningDaysThisWeek } from '@/services/gamification.service';
import { listStudentExamProfiles } from '@/lib/assessment/student-exam-profile.service';
import { getExamDefinition } from '@/lib/assessment/exam-definition.service';
import { planItemWhyKey, planItemDayBucket } from '@/lib/learning-plan-presentation';
import type { LearningPlanItem } from '@/lib/learning-execution-policy';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import { deriveTodayState } from '@/lib/lx/today-view';
import type { NextChallengeView } from '@/lib/experience/next-challenge';
import { presentSnapshotNextChallenge, loadConceptNextChallenge } from '@/lib/experience/next-challenge.server';
import { challengeVerb } from '@/lib/experience/vocabulary';
import { selectGoalProfile, calendarDaysUntil } from '@/lib/experience/goal';
import { InlineAlert } from '@/components/ui/InlineAlert';
import { Section } from '@/components/ui/Section';
import { StatTile } from '@/components/ui/StatTile';
import { activityLabel } from '../activityLabel';
import { activityCta } from '../activityCta';
import StartSessionButton from '../StartSessionButton';
import NextChallengeCard from '../NextChallengeCard';
import SubjectSwitcher from '../SubjectSwitcher';

/**
 * UX-2 Home ("Hoy") -- an action-first entry point over the SAME
 * Learning-OS snapshot Today has always read (Phase 3C decisions + Phase
 * 3D execution fit). This page presents decisions; it never makes one.
 *
 * Hierarchy: context (date, greeting, the learner's existing exam goal)
 * -> "Tu siguiente reto" (the snapshot's next executable item, presented
 * by the canonical launch the Start button runs -- see
 * lib/experience/next-challenge.ts) -> a two-figure snapshot (learning
 * days this week, today's planned minutes) -> the rest of today's plan
 * -> the read-only 14-day horizon.
 *
 * See src/lib/lx/today-view.ts for the four semantic states. A snapshot
 * READ FAILURE is never treated as "nothing is due": it renders an error
 * with a retry.
 */

/** LX-6 R19: safe, learner-content-free observability. Server-side (this page never ships to the client) -- one line per event, never an answer/question/prompt/RAG value. */
function logToday(label: string, meta: Record<string, unknown> = {}): void {
  try {
    // eslint-disable-next-line no-console
    console.log('[today]', JSON.stringify({ label, ...meta }));
  } catch { /* logging must never break the page */ }
}

type T = ReturnType<typeof getMessages>;

/** One row of "Hoy también": the SAME presenter as the hero, so a row never offers an activity its button would not launch. */
function PlanRow({
  view,
  labels,
  studentId,
  t,
  locale,
}: {
  view: NextChallengeView;
  labels: Map<string, ConceptDisplayInfo>;
  studentId: string;
  t: T;
  locale: string;
}) {
  const info = labels.get(view.conceptId);
  const label = info?.label ?? view.conceptId;
  const conceptHref = `/dashboard/subjects/${view.subjectId}/concepts/${view.conceptId}`;
  return (
    <li className="card xp-row">
      <div className="xp-row-main">
        <Link href={conceptHref} className="xp-row-title">{label}</Link>
        <div className="xp-row-meta">
          {/* Closeout B: same guard as the hero -- the already-chosen activity only. */}
          {view.status === 'READY' && (
            <span className="xp-row-verb">{view.activityType === 'RETENTION_CHECK' ? t['today.retentionEyebrow'] : challengeVerb(view.challenge, t)}</span>
          )}
          {view.status === 'READY' && <span>{activityLabel(view.activityType, t)}</span>}
          {info?.subjectName && <span>{info.subjectName}</span>}
        </div>
      </div>
      <div className="xp-row-action">
        {view.status === 'READY' ? (
          <StartSessionButton
            studentId={studentId}
            actionConceptId={view.conceptId}
            label={activityCta(view.activityType, t)}
            accessibleLabel={`${activityCta(view.activityType, t)}: ${label}`}
            unavailableLabel={t['today3.unavailableBody']}
            retryLabel={t['today3.retry']}
            licenseTitle={t['learning.licenseRequiredTitle']}
            licenseBody={t['learning.licenseRequiredBody']}
            licenseCtaLabel={t['license.demoBannerCta']}
            variant="secondary"
          />
        ) : view.status === 'WAITING' && view.nextEligibleAt ? (
          <span className="xp-row-note">{t['xp.availableOn'].replace('{date}', new Date(view.nextEligibleAt).toLocaleDateString(locale))}</span>
        ) : (
          <Link href={conceptHref} className="ui-link">{t['xp.openConcept']}</Link>
        )}
      </div>
    </li>
  );
}

export default async function TodayPage() {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) {
    return (
      <div>
        <h1>Not authenticated</h1>
        <Link href="/sign-in">Sign in</Link>
      </div>
    );
  }

  const studentId = await getOrCreateStudentId(clerkUserId);
  const locale = await getInterfaceLanguage(studentId);
  const t = getMessages(locale);

  const requestStartedAtMs = Date.now();
  logToday('TODAY_REQUEST_STARTED');

  // LX-6 R4/R23: a genuine READ FAILURE is captured explicitly here --
  // never silently folded into the same branch a caught-up student's
  // empty decision list takes (see today-view.ts's deriveTodayState).
  let snapshot: Awaited<ReturnType<typeof getLearningOSSnapshot>> | null = null;
  let snapshotReadFailed = false;
  try {
    snapshot = await getLearningOSSnapshot(studentId, { preferredLanguage: locale });
  } catch (err) {
    snapshotReadFailed = true;
    console.error('[today] snapshot read failed:', err instanceof Error ? err.message : String(err));
  }
  logToday('TODAY_DECISION_READY', { latencyMs: Date.now() - requestStartedAtMs });

  // Context + figures: independent, read-only, each degrading to "not
  // shown" on failure -- never blocking the next-action hero.
  const todayIso = new Date().toISOString().slice(0, 10);
  const [user, learningDaysThisWeek, examProfiles, horizon, mySubjects] = await Promise.all([
    currentUser().catch(() => null),
    getLearningDaysThisWeek(studentId).catch(() => null),
    listStudentExamProfiles(studentId).catch(() => []),
    // 8F1 -- "Tu camino": a STRICTLY READ-ONLY 14-day plan glance. It
    // reads the 8B read boundary only; a render here never creates,
    // rolls, or reconciles a plan.
    getLearningPlanHorizon(studentId).catch(() => null),
    // UX-5 closure: the Student's own subjects, for the subject switcher and
    // the "no concept yet" first step. Fails soft (switcher hidden).
    query(
      `SELECT s.id, s.name, EXISTS (SELECT 1 FROM concepts c WHERE c.subject_id = s.id) AS has_concepts
       FROM subjects s WHERE s.student_id = $1 AND s.status != 'archived' ORDER BY s.name`,
      [studentId],
    )
      .then((r) => r.rows as { id: string; name: string; has_concepts: boolean }[])
      .catch(() => null),
  ]);
  const noConceptYet = !!mySubjects && mySubjects.length > 0 && mySubjects.every((sub) => !sub.has_concepts);
  const goalProfile = selectGoalProfile(examProfiles, todayIso);
  const goalDefinition = goalProfile ? await getExamDefinition(goalProfile.examDefinitionId).catch(() => null) : null;

  const caminoItems = (horizon?.items ?? []).slice(0, 4);
  const caminoLabels = caminoItems.length
    ? await loadConceptLabels(
        caminoItems.map((i) => i.conceptId).filter((v): v is string => !!v),
        locale,
      ).catch(() => new Map<string, ConceptDisplayInfo>())
    : new Map<string, ConceptDisplayInfo>();

  const todayFormatted = new Date().toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });

  const best = snapshot?.nextExecutableItem ?? null;
  const bestLabel = best ? snapshot!.conceptLabels.get(best.decision.actionConceptId) : null;
  // UX-2: the hero is presented from the canonical launch for this
  // concept (the snapshot's own `canonicalOverride`, computed with the
  // same function /api/learning/session/start runs) whenever the
  // canonical gate is on -- never from the legacy `activityType`, which
  // could name a different activity than the one the button launches.
  const hero = snapshot ? presentSnapshotNextChallenge(snapshot) : null;
  const heroHasAction = !!hero && (hero.status === 'READY' || hero.status === 'WAITING');

  // LX-6: a failed read is never "empty" -- it's unresolved (see below).
  const isEmpty = !snapshotReadFailed && (!snapshot || snapshot.decisions.length === 0);

  // Step 6L-A: a brand-new/cold profile with no evidence yet is a
  // different, calmer state than "caught up". A plain existence check
  // over already-canonical data (never a new recommendation policy),
  // never attempted when the read itself already failed.
  const isCold = isEmpty
    ? await query(`SELECT EXISTS (SELECT 1 FROM learning_evidence WHERE student_id = $1) AS has_evidence`, [studentId])
        .then((r) => r.rows[0].has_evidence === false)
        .catch(() => false)
    : false;

  const todayState = deriveTodayState({ snapshotReadFailed, hasPrimaryAction: heroHasAction, isColdProfile: isCold });
  if (todayState === 'NEXT_ACTION_AVAILABLE' && best) {
    // LEARNING_ACTIVITY_DELIVERY -- the primary action is one tap away: keep it READY.
    const replenishTarget = { studentId, subjectId: best.decision.subjectId, conceptId: best.decision.actionConceptId };
    after(() => scheduleDeliveryReplenishment(replenishTarget).catch((err) => console.error('[activity-delivery] replenishment failed', err)));
    logToday('TODAY_PRIMARY_ACTION_RENDERED', {
      activityType: hero?.status === 'READY' ? hero.activityType : null,
      authority: hero?.authority ?? null,
      heroStatus: hero?.status ?? null,
      conceptId: best.decision.actionConceptId,
      subjectId: best.decision.subjectId,
      reasonCode: best.decision.reasonCode,
    });
  } else if (todayState === 'UNRESOLVED') {
    logToday('TODAY_UNRESOLVED');
    logToday('TODAY_FAILED');
  }

  // The rest of today's session: never the hero twice (the hero IS
  // dailyPlan.items[0] -- selectExecutableNextAction's own contract).
  const sessionItems: LearningPlanItem[] = snapshot ? snapshot.dailyPlan.items.slice(1) : [];
  const sessionViews = await Promise.all(
    sessionItems.map((item) =>
      loadConceptNextChallenge({
        studentId,
        subjectId: item.decision.subjectId,
        conceptId: item.decision.actionConceptId,
        legacyDecision: item.decision,
        snapshot,
      }).catch((): NextChallengeView => ({
        status: 'UNAVAILABLE',
        authority: 'CANONICAL',
        conceptId: item.decision.actionConceptId,
        subjectId: item.decision.subjectId,
        stage: null,
        reason: 'CANONICAL_READ_FAILED',
      })),
    ),
  );
  const deferred = snapshot?.dailyPlan.deferred ?? [];

  const firstName = user?.firstName?.trim();
  const goalName = goalDefinition?.name ?? null;
  const goalDays = goalProfile?.examDate ? calendarDaysUntil(goalProfile.examDate, todayIso) : null;
  const goalWhen =
    goalDays === null ? null : goalDays === 0 ? t['xp.goalToday'] : goalDays === 1 ? t['xp.goalTomorrow'] : t['xp.goalDaysLeft'].replace('{days}', String(goalDays));

  // A hero concept with nothing executable right now (canonical
  // CONSOLIDATED / BLOCKED / zero-gap) shows the calm card only when
  // nothing else is planned -- otherwise the plan below leads.
  const showHero =
    !!hero && (hero.status === 'READY' || hero.status === 'WAITING' || (hero.status === 'UNAVAILABLE' && hero.reason === 'CANONICAL_READ_FAILED') || sessionViews.length === 0);

  return (
    <div className="xp-page">
      <header className="xp-intro">
        <p className="xp-date">{todayFormatted}</p>
        <h1>{firstName ? t['xp.greeting'].replace('{name}', firstName) : t['xp.greetingNoName']}</h1>
        <p className="xp-tagline">{t['xp.tagline']}</p>
        {mySubjects && mySubjects.length > 0 && (
          <div className="xp-subjects">
            <SubjectSwitcher
              subjects={mySubjects.map(({ id, name }) => ({ id, name }))}
              currentId={best?.decision.subjectId ?? (mySubjects.length === 1 ? mySubjects[0].id : null)}
              label={t['ss.label']}
              placeholder={t['ss.placeholder']}
              addLabel={t['ss.add']}
            />
          </div>
        )}
        {goalProfile && goalName && (
          <Link href={`/dashboard/exam-prep/${goalProfile.id}`} className="xp-goal">
            <span>{t['xp.goalLabel']}</span>
            <strong>{goalName}</strong>
            {goalWhen && <span className="xp-goal-when">{goalWhen}</span>}
          </Link>
        )}
      </header>

      {todayState === 'UNRESOLVED' ? (
        // LX-6 R4/R23: a read failure gets its own honest state -- Retry
        // (a plain reload; the next render re-reads canonical truth) and
        // View My Path. Never a fabricated recommendation.
        <InlineAlert
          tone="error"
          title={t['today3.unresolvedTitle']}
          body={t['today3.unresolvedBody']}
          actions={
            <>
              <a href="/dashboard/today" className="btn btn-primary">{t['today3.unresolvedRetry']}</a>
              <Link href="/dashboard/path" className="btn btn-secondary">{t['today3.viewMyPath']}</Link>
            </>
          }
        />
      ) : (
        <>
          {best && hero && showHero && (
            <NextChallengeCard
              view={hero}
              conceptLabel={bestLabel?.label ?? best.decision.actionConceptId}
              subjectName={bestLabel?.subjectName ?? ''}
              studentId={studentId}
              t={t}
              locale={locale}
              legacyMinutes={best.estimatedMinutes}
              launchMark="TODAY_PRIMARY_ACTION_LAUNCHED"
            />
          )}

          {isEmpty && noConceptYet && (
            // UX-5 closure: a new Student who chose a subject but no topic yet
            // continues exactly where first-run left off -- never a dead end.
            <section className="xp-hero" aria-labelledby="xp-first-title">
              <h2 id="xp-first-title" className="xp-hero-title">{t['sp.title']}</h2>
              <p className="xp-hero-why">{t['xp.firstTopicBody']}</p>
              <div className="xp-hero-cta">
                <Link href={`/dashboard/learn?subjectId=${mySubjects![0].id}`} className="btn btn-primary btn-lg">{t['xp.firstTopicCta']}</Link>
              </div>
            </section>
          )}

          {isEmpty && !noConceptYet && (
            <section className="xp-hero xp-hero--calm" aria-labelledby="xp-empty-title">
              <h2 id="xp-empty-title" className="xp-hero-title">{isCold ? t['today3.coldStateTitle'] : t['xp.caughtUpTitle']}</h2>
              <p className="xp-hero-why">{isCold ? t['today3.coldStateBody'] : t['xp.caughtUpBody']}</p>
              <div className="xp-hero-cta">
                {isCold ? (
                  <Link href="/dashboard/learn" className="btn btn-primary">{t['today3.coldStateCta']}</Link>
                ) : (
                  <Link href="/dashboard/path" className="btn btn-secondary">{t['xp.pathLink']}</Link>
                )}
              </div>
            </section>
          )}

          {!isEmpty && !best && (
            // Decisions exist but none is executable right now (Phase 3D's
            // own answer) -- a calm, explicit state, never a blank page.
            <section className="xp-hero xp-hero--calm" aria-labelledby="xp-caught-up-title">
              <h2 id="xp-caught-up-title" className="xp-hero-title">{t['xp.caughtUpTitle']}</h2>
              <p className="xp-hero-why">{t['xp.caughtUpBody']}</p>
              <div className="xp-hero-cta">
                <Link href="/dashboard/path" className="btn btn-secondary">{t['xp.pathLink']}</Link>
              </div>
            </section>
          )}

          {!isEmpty && snapshot && (
            <Section id="xp-snapshot" title={t['nav.progress']} action={<Link href="/dashboard" className="ui-link">{t['xp.progressLink']}</Link>}>
            <div className="xp-stats">
              {learningDaysThisWeek !== null && (
                <StatTile
                  label={t['xp.weekTitle']}
                  value={t['xp.weekValue'].replace('{count}', String(learningDaysThisWeek))}
                  hint={t['xp.weekHint']}
                >
                  <span className="ui-meter" aria-hidden>
                    {Array.from({ length: 7 }, (_, i) => (
                      <span key={i} className={i < learningDaysThisWeek ? 'on' : undefined} />
                    ))}
                  </span>
                </StatTile>
              )}
              <StatTile
                label={t['xp.todayPlanTitle']}
                value={t['xp.todayPlanValue'].replace('{minutes}', String(snapshot.dailyPlan.plannedMinutes))}
                hint={t['xp.todayPlanHint']
                  .replace('{count}', String(snapshot.dailyPlan.items.length))
                  .replace('{available}', String(snapshot.dailyPlan.availableMinutes))}
              />
            </div>
            </Section>
          )}

          {sessionViews.length > 0 && (
            <Section id="xp-also" title={t['xp.alsoToday']}>
              <ul className="xp-list">
                {sessionViews.map((view) => (
                  <PlanRow key={view.conceptId} view={view} labels={snapshot!.conceptLabels} studentId={studentId} t={t} locale={locale} />
                ))}
              </ul>
            </Section>
          )}

          {deferred.length > 0 && (
            // Still important, just not in today's time budget: listed,
            // never a competing set of Start buttons on Home.
            <details className="xp-later">
              <summary>{t['xp.laterTitle'].replace('{count}', String(deferred.length))}</summary>
              <p className="xp-row-note" style={{ margin: '0 0 var(--space-3)' }}>{t['today3.deferredSubtitle']}</p>
              <ul className="xp-list">
                {deferred.map((d) => {
                  const info = snapshot!.conceptLabels.get(d.decision.actionConceptId);
                  return (
                    <li key={d.decision.actionConceptId} className="card xp-row">
                      <div className="xp-row-main">
                        <Link href={`/dashboard/subjects/${d.decision.subjectId}/concepts/${d.decision.actionConceptId}`} className="xp-row-title">
                          {info?.label ?? d.decision.actionConceptId}
                        </Link>
                        {info?.subjectName && <div className="xp-row-meta"><span>{info.subjectName}</span></div>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </details>
          )}
        </>
      )}

      {/* LX-6 R10: purely informational "coming up" glance -- never
          competes with the primary action, never its own decision
          authority (read-only over the existing 8B plan horizon). */}
      {caminoItems.length > 0 && (
        <Section id="xp-camino" title={t['plan8.pathTitle']} action={<Link href="/dashboard/study-plan" className="ui-link">{t['plan8.viewFull']}</Link>}>
          <ul className="xp-list">
            {caminoItems.map((it) => {
              const info = it.conceptId ? caminoLabels.get(it.conceptId) : null;
              const bucket = planItemDayBucket(it.scheduledDate, todayIso);
              const dayLabel =
                bucket === 'TODAY'
                  ? t['plan8.today']
                  : bucket === 'OVERDUE'
                    ? t['plan8.overdue']
                    : new Date(it.scheduledDate).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' });
              return (
                <li key={it.id} className="card xp-row">
                  <div className="xp-row-main">
                    <span className="xp-row-title">{info?.label ?? it.conceptId ?? ''}</span>
                    <div className="xp-row-meta">
                      <span style={bucket === 'OVERDUE' ? { color: 'var(--warning)', fontWeight: 600 } : undefined}>{dayLabel}</span>
                      {info?.subjectName && <span>{info.subjectName}</span>}
                      <span>{t[planItemWhyKey(it.reasonCode) as keyof typeof t]}</span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </Section>
      )}
    </div>
  );
}
