import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getOrCreateStudentId } from '@/lib/auth';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import { listStudentExamProfiles } from '@/lib/assessment/student-exam-profile.service';
import { getExamDefinition } from '@/lib/assessment/exam-definition.service';
import { listExamCatalog } from '@/lib/exam-core/catalog.service';
import { findOpenSimulationAttemptForProfile } from '@/lib/simulation/attempt.service';
import { EXAM_FAMILIES } from '@/lib/exam-core/taxonomy';
import { getLatestReadinessSnapshot } from '@/lib/readiness/readiness.service';
import { PageIntro } from '@/components/ui/PageIntro';
import { StatusBadge, toneForReadinessStatus } from '@/components/ui/StatusBadge';
import { calendarDaysUntil } from '@/lib/experience/goal';
import { CreateExamProfileForm } from './CreateExamProfileForm';
import { ProfileCard } from './ProfileCard';

/**
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
  const locale = await getInterfaceLanguage(studentId).catch(() => 'es' as const);
  const t = getMessages(locale);

  const profiles = await listStudentExamProfiles(studentId);
  const catalog = await listExamCatalog();
  const rows = await Promise.all(
    profiles.map(async (profile) => {
      const [definition, snapshot, openAttempt] = await Promise.all([
        getExamDefinition(profile.examDefinitionId),
        profile.examVersionId ? getLatestReadinessSnapshot(profile.id) : Promise.resolve(null),
        findOpenSimulationAttemptForProfile(profile.id),
      ]);
      return { profile, definitionName: definition?.name ?? profile.examDefinitionId, family: definition?.examFamily ?? null, snapshot, openAttempt };
    })
  );
  const tr = t as Record<string, string>;
  const familyNames: Record<string, string> = Object.fromEntries([...EXAM_FAMILIES, 'OTHER'].map((f) => [f, tr[`exam.family.${f}`] ?? f]));
  const contentStatus: Record<string, string> = {
    DEV_CERT_FIXTURE: t['exam.contentStatus.DEV_CERT_FIXTURE'],
    ORIGINAL: t['exam.contentStatus.ORIGINAL'],
    OFFICIAL_LICENSED: t['exam.contentStatus.OFFICIAL_LICENSED'],
  };

  const profileMenuLabels: Record<string, string> = Object.fromEntries(
    Object.entries(tr).filter(([k]) => k.startsWith('examPrep.profile.') || k === 'exv2.menu.more' || k === 'exv2.delete.no')
  );
  const todayIso = new Date().toISOString().slice(0, 10);
  const dateLine = (examDate: string | null) => {
    if (!examDate) return t['examPrep.noExamDateSet'];
    const days = calendarDaysUntil(examDate, todayIso);
    const date = new Date(`${examDate}T12:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });
    if (days < 0) return date;
    return `${date} · ${days === 0 ? t['xp.goalToday'] : days === 1 ? t['xp.goalTomorrow'] : t['xp.goalDaysLeft'].replace('{days}', String(days))}`;
  };

  const form = (
    <CreateExamProfileForm
      studentId={studentId}
      groups={catalog}
      labels={{
        family: t['examPrep.create.family'],
        familyNames,
        contentStatus,
        title: t['examPrep.create.title'],
        lead: t['ex.setupLead'],
        exam: t['examPrep.create.exam'],
        date: t['examPrep.create.date'],
        purpose: t['examPrep.create.purpose'],
        programme: t['examPrep.create.programme'],
        subject: t['examPrep.create.subject'],
        optional: t['examPrep.create.optional'],
        submit: t['examPrep.create.submit'],
        submitting: t['examPrep.create.submitting'],
        unavailable: t['examPrep.create.unavailable'],
        error: t['examPrep.create.error'],
      }}
    />
  );

  return (
    <div className="xp-page xp-page--wide">
      <PageIntro title={t['examPrep.title']} lead={t['examPrep.subtitle']} actions={<Link className="btn btn-primary" href="/dashboard/exams">{t['exv2.page.cta']}</Link>} />

      {rows.length === 0 ? (
        // No exam yet: setting one up IS the primary action here.
        form
      ) : (
        <>
          <ul className="ex-list">
            {rows.map(({ profile, definitionName, family, snapshot, openAttempt }) => (
              <ProfileCard
                key={profile.id}
                profileId={profile.id}
                examName={definitionName}
                hasInProgress={!!openAttempt}
                labels={profileMenuLabels}
                info={
                  <>
                    <p className="ex-goal-kicker">{family ? familyNames[family] ?? family : t['ex.goalKicker']}</p>
                    <Link href={`/dashboard/exam-prep/${profile.id}`} className="ex-card-name">{definitionName}</Link>
                    <p className="ex-card-meta">{dateLine(profile.examDate)}</p>
                    <div className="ex-card-state">
                      {!profile.examVersionId ? (
                        <StatusBadge label={t['examPrep.noExamVersion']} tone="neutral" />
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
                    <Link href={`/dashboard/exam-prep/${profile.id}`} className="btn btn-primary">{t['ex.viewPrep']}</Link>
                  )
                }
              />
            ))}
          </ul>
          {/* With an exam already set up, configuration is secondary. */}
          <details className="ui-disclosure">
            <summary>{t['ex.addAnother']}</summary>
            <div className="ui-disclosure-body">{form}</div>
          </details>
        </>
      )}
    </div>
  );
}
