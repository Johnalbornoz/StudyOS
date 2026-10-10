import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getOrCreateStudentId } from '@/lib/auth';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import { listStudentExamProfiles } from '@/lib/assessment/student-exam-profile.service';
import { getExamDefinition } from '@/lib/assessment/exam-definition.service';
import { findOpenSimulationAttemptForProfile } from '@/lib/simulation/attempt.service';
import { EXAM_FAMILIES } from '@/lib/exam-core/taxonomy';
import { getLatestReadinessSnapshot } from '@/lib/readiness/readiness.service';
import { PageIntro } from '@/components/ui/PageIntro';
import { StatusBadge, toneForReadinessStatus } from '@/components/ui/StatusBadge';
import { calendarDaysUntil } from '@/lib/experience/goal';
import { PreparationChooser } from './PreparationChooser';
import { loadResolvedStudentContext } from '@/lib/student/student-context.server';
import { presentObjective } from '@/lib/exam-core/objectives/objective-display';
import { examSessionLabel, objectiveSessionModel, storedExamSession } from '@/lib/exam-core/objectives/objective-session';
import { loadPickerData } from '@/lib/exam-core/objectives/picker';
import { allObjectiveCapabilities, profileObjective } from '@/lib/exam-core/objectives/preparation.service';
import { objectiveStatusKey } from '@/lib/exam-core/objectives/capabilities';
import { ProfileCard } from './ProfileCard';
import { after } from 'next/server';
import { isStudentJourneyShadowEnabled, isStudentJourneyUxEnabled } from '@/lib/exam-journey/feature-flag';
import { getStudentExamJourneys, getStudentInstitutionalContext, loadExamTargetRows } from '@/lib/exam-journey/ux.server';
import { isActivePreparation, presentNextAction, studentBlockerKeys, targetScheduleLines } from '@/lib/exam-journey/ux';
import { scheduleFactsFromRow } from '@/lib/exam-journey/exam-target';
import { ScheduleSummary } from './journey/ExamTargetOverview';
import { fillMessage } from '@/lib/i18n/roles-messages';
import { runStudentExamJourneyShadow } from '@/lib/exam-journey/shadow.server';
import { examPrepBackHref } from '@/lib/lx/onboarding-paths';
import { ArrowLeft } from 'lucide-react';

/**
 * Track B -- objective first: "¿Para qué examen quieres prepararte?" Every
 * catalogue objective can be chosen; the Student's preparations list what
 * StudyUs can do today for each.
 *
 * F14 Workstream A -- Student Exam Prep landing (task section 4). This
 * is the FIRST Student-facing surface over F9 (readiness.service.ts /
 * simulation/eligibility.service.ts) and F7's Student Exam Profiles --
 * both fully real, certified, and previously never exposed by any UI.
 * Presents whatever F9 already decided (`overallStatus`); never
 * recomputes it (INV: no Mastery/Readiness/Coverage/Gap in the client).
 */
export default async function ExamPrepPage({ searchParams }: { searchParams?: Promise<{ from?: string }> } = {}) {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect('/sign-in');

  const studentId = await getOrCreateStudentId(clerkUserId);
  // Student Exam Journey V2 (J2): shadow only -- computed and logged after the response, never rendered.
  if (isStudentJourneyShadowEnabled()) after(() => runStudentExamJourneyShadow(studentId, 'dashboard/exam-prep'));
  const locale = await getInterfaceLanguage(studentId).catch(() => 'es' as const);
  const t = getMessages(locale);
  const tr = t as Record<string, string>;

  const [profiles, picker, caps, studentContext] = await Promise.all([listStudentExamProfiles(studentId), loadPickerData(studentId, locale), allObjectiveCapabilities(locale), loadResolvedStudentContext(studentId)]);
  // T1 final delta (A): an EXAM_PREP Student has no school to describe -- the landing is the exam selector.
  const examPrepContext = studentContext.contextType === 'EXAM_PREP';
  const lead = examPrepContext ? tr['acp.prep.examLead'] : tr['prep.lead'];
  const rows = await Promise.all(
    profiles.map(async (profile) => {
      const [definition, snapshot, openAttempt, objective] = await Promise.all([
        profile.examDefinitionId ? getExamDefinition(profile.examDefinitionId) : Promise.resolve(null),
        profile.examVersionId ? getLatestReadinessSnapshot(profile.id) : Promise.resolve(null),
        findOpenSimulationAttemptForProfile(profile.id),
        profileObjective(profile),
      ]);
      const capabilities = objective ? caps.get(objective.key) ?? null : null;
      return { profile, objective, capabilities, definitionName: (objective ? presentObjective(objective, locale).label : null) ?? definition?.name ?? '', family: definition?.examFamily ?? null, snapshot, openAttempt };
    })
  );
  // REM-T1-05 / REM-T1-02: opened from a first-use journey choice -> Back returns to that choice.
  const backHref = examPrepBackHref((await searchParams)?.from);
  const backLink = backHref ? (
    <Link href={backHref} className="btn btn-ghost" data-back style={{ display: 'inline-flex', gap: 6, alignItems: 'center', alignSelf: 'flex-start' }}>
      <ArrowLeft size={16} strokeWidth={2} aria-hidden />
      <span>{tr['acp.onboarding.back']}</span>
    </Link>
  ) : null;
  const familyNames: Record<string, string> = Object.fromEntries([...EXAM_FAMILIES, 'OTHER'].map((f) => [f, tr[`exam.family.${f}`] ?? f]));

  const profileMenuLabels: Record<string, string> = Object.fromEntries(
    Object.entries(tr).filter(([k]) => k.startsWith('examPrep.profile.') || k === 'exv2.menu.more' || k === 'exv2.delete.no')
  );
  const prepLabels: Record<string, string> = Object.fromEntries(Object.entries(tr).filter(([k]) => k.startsWith('prep.') || k.startsWith('elig.') || k.startsWith('acp.prep.')));
  const todayIso = new Date().toISOString().slice(0, 10);
  const dateLine = (examDate: string | null) => {
    if (!examDate) return t['examPrep.noExamDateSet'];
    const days = calendarDaysUntil(examDate, todayIso);
    const date = new Date(`${examDate}T12:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });
    if (days < 0) return date;
    return `${date} · ${days === 0 ? t['xp.goalToday'] : days === 1 ? t['xp.goalTomorrow'] : t['xp.goalDaysLeft'].replace('{days}', String(days))}`;
  };

  // T1 final delta (C): an exam with governed sessions shows its series + year ("Mayo 2027"), never "no exam date".
  const timeLine = (profile: (typeof rows)[number]['profile'], objective: (typeof rows)[number]['objective']) => {
    if (!objective || !objectiveSessionModel(objective, studentContext.legacy.countryOfStudy)) return dateLine(profile.examDate);
    const session = storedExamSession(profile);
    return session ? examSessionLabel(session, locale) : profile.examDate ? dateLine(profile.examDate) : tr['acp.goal.session.pending'];
  };

  const chooser = (
    <section className="prep-choose" id="prep-choose" aria-labelledby="prep-choose-title">
      <h2 id="prep-choose-title" className="sr-only">{tr['prep.question']}</h2>
      <PreparationChooser objectives={picker.objectives} frameworks={picker.frameworks} suggested={picker.suggested} frameworkReasons={picker.frameworkReasons} hasAcademicContext={picker.hasAcademicContext} examPrepContext={examPrepContext} labels={prepLabels} />
    </section>
  );

  // Student Exam Journey V2 (J1.4 / J3.3 / J3.5, STUDENT_JOURNEY_V2=UX): one card per target, each with its
  // OWN date (with its source), state, next step and blockers -- never a merged readiness, no percentages.
  if (isStudentJourneyUxEnabled()) {
    const [journeys, targetRows, context] = await Promise.all([
      rows.length ? getStudentExamJourneys(studentId) : Promise.resolve([]),
      rows.length ? loadExamTargetRows(studentId) : Promise.resolve(new Map()),
      getStudentInstitutionalContext(studentId).catch(() => null),
    ]);
    const byTarget = new Map(journeys.map((j) => [j.examTargetId, j]));
    const institutionDefinesPath = !!context?.institutions.some((i) => i.classes.some((c) => c.subject.value !== null));
    const jxLabels: Record<string, string> = Object.fromEntries(Object.entries(tr).filter(([k]) => k.startsWith('jx.')));
    const ordered = rows
      .map((row) => ({ ...row, resolution: byTarget.get(row.profile.id) ?? null, stored: targetRows.get(row.profile.id) ?? null }))
      .sort((a, b) => Number(!!b.resolution && isActivePreparation(b.resolution)) - Number(!!a.resolution && isActivePreparation(a.resolution)));
    return (
      <div className="xp-page xp-page--wide">
        {backLink}
        <PageIntro title={rows.length === 0 ? tr['prep.question'] : t['examPrep.title']} lead={lead} />
        {institutionDefinesPath ? <p className="ui-hint jx-exams-note" data-programme-note>{tr['jx.inst.exams.note']}</p> : null}

        {ordered.length > 0 && (
          <section aria-labelledby="prep-mine-title" className="prep-mine">
            <h2 id="prep-mine-title" className="exv2-title">{tr['prep.mine.title']}</h2>
            <ul className="ex-list">
              {ordered.map(({ profile, objective, family, definitionName, openAttempt, resolution, stored }) => {
                const blockers = resolution ? studentBlockerKeys(resolution) : [];
                return (
                  <ProfileCard
                    key={profile.id}
                    profileId={profile.id}
                    examName={definitionName}
                    hasInProgress={!!openAttempt}
                    labels={profileMenuLabels}
                    info={
                      <div className="jx-target" data-target-state={resolution?.state ?? 'UNRESOLVED'}>
                        <p className="ex-goal-kicker">{objective ? tr[`prep.fw.${objective.framework}`] : family ? familyNames[family] ?? family : t['ex.goalKicker']}</p>
                        <Link href={`/dashboard/exam-prep/${profile.id}`} className="ex-card-name">{definitionName}</Link>
                        {stored ? <ScheduleSummary lines={targetScheduleLines(scheduleFactsFromRow(stored))} labels={jxLabels} locale={locale} /> : null}
                        {resolution ? (
                          <>
                            <p className="ex-card-meta">{tr[`jx.state.${resolution.state}`]}</p>
                            <p className="ex-card-meta" data-next-action={resolution.recommendedNextAction.kind}>
                              {fillMessage(tr['jx.card.next'], { action: tr[presentNextAction(resolution.recommendedNextAction.kind).labelKey] })}
                            </p>
                          </>
                        ) : null}
                        {blockers.length > 0 ? <ul className="jx-notices" data-blockers>{blockers.map((k) => <li key={k} className="jx-notice">{tr[k]}</li>)}</ul> : null}
                        {profile.targetInstitutionName ? <p className="jx-notice" data-requirement="unconfirmed">{fillMessage(tr['jx.requirement.unconfirmed'], { institution: profile.targetInstitutionName })}</p> : null}
                      </div>
                    }
                    primary={
                      openAttempt ? (
                        <Link href={`/dashboard/exam-prep/attempt/${openAttempt.id}`} className="btn btn-primary">{t['examPrep.inProgress.resume']}</Link>
                      ) : (
                        <Link href={`/dashboard/exam-prep/${profile.id}`} className="btn btn-primary">{tr['jx.card.view']}</Link>
                      )
                    }
                  />
                );
              })}
            </ul>
          </section>
        )}

        <p className="jx-discover-link"><Link className="btn btn-secondary prep-cta" href="/dashboard/exam-prep/discover">{tr['jx.disc.link']}</Link></p>
        {chooser}
      </div>
    );
  }

  return (
    <div className="xp-page xp-page--wide">
      {/* Objective first: the page IS the question; readiness never blocks the choice. */}
      {backLink}
      <PageIntro title={rows.length === 0 ? tr['prep.question'] : t['examPrep.title']} lead={lead} />

      {rows.length > 0 && (
        <section aria-labelledby="prep-mine-title" className="prep-mine">
          <h2 id="prep-mine-title" className="exv2-title">{tr['prep.mine.title']}</h2>
          <ul className="ex-list">
            {rows.map(({ profile, objective, capabilities, definitionName, family, snapshot, openAttempt }) => (
              <ProfileCard
                key={profile.id}
                profileId={profile.id}
                examName={definitionName}
                hasInProgress={!!openAttempt}
                labels={profileMenuLabels}
                info={
                  <>
                    <p className="ex-goal-kicker">{objective ? tr[`prep.fw.${objective.framework}`] : family ? familyNames[family] ?? family : t['ex.goalKicker']}</p>
                    <Link href={`/dashboard/exam-prep/${profile.id}`} className="ex-card-name">{definitionName}</Link>
                    <p className="ex-card-meta">{timeLine(profile, objective)}</p>
                    <div className="ex-card-state">
                      {capabilities ? (
                        <span className={`xr-pill prep-status prep-status--${objectiveStatusKey(capabilities)}`}>{tr[`prep.status.${objectiveStatusKey(capabilities)}`]}</span>
                      ) : snapshot && snapshot.overallStatus !== 'INSUFFICIENT_EVIDENCE' ? (
                        <StatusBadge label={t[`examPrep.status.${snapshot.overallStatus}`]} tone={toneForReadinessStatus(snapshot.overallStatus)} />
                      ) : (
                        <span>{t['ex.formingTitle']}</span>
                      )}
                    </div>
                  </>
                }
                primary={
                  openAttempt ? (
                    <Link href={`/dashboard/exam-prep/attempt/${openAttempt.id}`} className="btn btn-primary">{t['examPrep.inProgress.resume']}</Link>
                  ) : (
                    <Link href={`/dashboard/exam-prep/${profile.id}`} className="btn btn-primary">{tr['prep.cta.view']}</Link>
                  )
                }
              />
            ))}
          </ul>
        </section>
      )}

      {chooser}
    </div>
  );
}
