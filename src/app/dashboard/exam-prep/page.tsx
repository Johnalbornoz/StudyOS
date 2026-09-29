import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getOrCreateStudentId } from '@/lib/auth';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import { listStudentExamProfiles } from '@/lib/assessment/student-exam-profile.service';
import { getExamDefinition, listAvailableExamOptions } from '@/lib/assessment/exam-definition.service';
import { getLatestReadinessSnapshot } from '@/lib/readiness/readiness.service';
import { PageIntro } from '@/components/ui/PageIntro';
import { StatusBadge, toneForReadinessStatus } from '@/components/ui/StatusBadge';
import { calendarDaysUntil } from '@/lib/experience/goal';
import { CreateExamProfileForm } from './CreateExamProfileForm';

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
  const availableExams = await listAvailableExamOptions();
  const rows = await Promise.all(
    profiles.map(async (profile) => {
      const definition = await getExamDefinition(profile.examDefinitionId);
      const snapshot = profile.examVersionId ? await getLatestReadinessSnapshot(profile.id) : null;
      return { profile, definitionName: definition?.name ?? profile.examDefinitionId, snapshot };
    })
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
      exams={availableExams}
      labels={{
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
      <PageIntro title={t['examPrep.title']} lead={t['examPrep.subtitle']} />

      {rows.length === 0 ? (
        // No exam yet: setting one up IS the primary action here.
        form
      ) : (
        <>
          <ul className="ex-list">
            {rows.map(({ profile, definitionName, snapshot }) => (
              <li key={profile.id} className="card ex-card">
                <div>
                  <p className="ex-goal-kicker">{t['ex.goalKicker']}</p>
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
                </div>
                <Link href={`/dashboard/exam-prep/${profile.id}`} className="btn btn-primary">{t['ex.viewPrep']}</Link>
              </li>
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
