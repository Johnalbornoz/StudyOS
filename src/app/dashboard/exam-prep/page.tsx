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
import { loadPickerData } from '@/lib/exam-core/objectives/picker';
import { allObjectiveCapabilities, profileObjective } from '@/lib/exam-core/objectives/preparation.service';
import { objectiveStatusKey } from '@/lib/exam-core/objectives/capabilities';
import { ProfileCard } from './ProfileCard';
import { after } from 'next/server';
import { isStudentJourneyShadowEnabled } from '@/lib/exam-journey/feature-flag';
import { runStudentExamJourneyShadow } from '@/lib/exam-journey/shadow.server';

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
export default async function ExamPrepPage() {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect('/sign-in');

  const studentId = await getOrCreateStudentId(clerkUserId);
  // Student Exam Journey V2 (J2): shadow only -- computed and logged after the response, never rendered.
  if (isStudentJourneyShadowEnabled()) after(() => runStudentExamJourneyShadow(studentId, 'dashboard/exam-prep'));
  const locale = await getInterfaceLanguage(studentId).catch(() => 'es' as const);
  const t = getMessages(locale);
  const tr = t as Record<string, string>;

  const [profiles, picker, caps] = await Promise.all([listStudentExamProfiles(studentId), loadPickerData(studentId, locale), allObjectiveCapabilities(locale)]);
  const rows = await Promise.all(
    profiles.map(async (profile) => {
      const [definition, snapshot, openAttempt, objective] = await Promise.all([
        profile.examDefinitionId ? getExamDefinition(profile.examDefinitionId) : Promise.resolve(null),
        profile.examVersionId ? getLatestReadinessSnapshot(profile.id) : Promise.resolve(null),
        findOpenSimulationAttemptForProfile(profile.id),
        profileObjective(profile),
      ]);
      const capabilities = objective ? caps.get(objective.key) ?? null : null;
      return { profile, objective, capabilities, definitionName: objective?.label ?? definition?.name ?? '', family: definition?.examFamily ?? null, snapshot, openAttempt };
    })
  );
  const familyNames: Record<string, string> = Object.fromEntries([...EXAM_FAMILIES, 'OTHER'].map((f) => [f, tr[`exam.family.${f}`] ?? f]));

  const profileMenuLabels: Record<string, string> = Object.fromEntries(
    Object.entries(tr).filter(([k]) => k.startsWith('examPrep.profile.') || k === 'exv2.menu.more' || k === 'exv2.delete.no')
  );
  const prepLabels: Record<string, string> = Object.fromEntries(Object.entries(tr).filter(([k]) => k.startsWith('prep.') || k.startsWith('elig.')));
  const todayIso = new Date().toISOString().slice(0, 10);
  const dateLine = (examDate: string | null) => {
    if (!examDate) return t['examPrep.noExamDateSet'];
    const days = calendarDaysUntil(examDate, todayIso);
    const date = new Date(`${examDate}T12:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });
    if (days < 0) return date;
    return `${date} · ${days === 0 ? t['xp.goalToday'] : days === 1 ? t['xp.goalTomorrow'] : t['xp.goalDaysLeft'].replace('{days}', String(days))}`;
  };

  const chooser = (
    <section className="prep-choose" id="prep-choose" aria-labelledby="prep-choose-title">
      <h2 id="prep-choose-title" className="sr-only">{tr['prep.question']}</h2>
      <PreparationChooser objectives={picker.objectives} frameworks={picker.frameworks} suggested={picker.suggested} frameworkReasons={picker.frameworkReasons} hasAcademicContext={picker.hasAcademicContext} labels={prepLabels} />
    </section>
  );

  return (
    <div className="xp-page xp-page--wide">
      {/* Objective first: the page IS the question; readiness never blocks the choice. */}
      <PageIntro title={rows.length === 0 ? tr['prep.question'] : t['examPrep.title']} lead={tr['prep.lead']} />

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
                    <p className="ex-card-meta">{dateLine(profile.examDate)}</p>
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
