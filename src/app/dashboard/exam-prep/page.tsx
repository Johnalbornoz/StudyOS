import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getOrCreateStudentId } from '@/lib/auth';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import { listStudentExamProfiles } from '@/lib/assessment/student-exam-profile.service';
import { getExamDefinition, listAvailableExamOptions } from '@/lib/assessment/exam-definition.service';
import { getLatestReadinessSnapshot } from '@/lib/readiness/readiness.service';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusBadge, toneForReadinessStatus } from '@/components/ui/StatusBadge';
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      <PageHeader title={t['examPrep.title']} subtitle={t['examPrep.subtitle']} />

      <CreateExamProfileForm
        studentId={studentId}
        exams={availableExams}
        labels={{
          title: t['examPrep.create.title'],
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

      {rows.length === 0 ? (
        <EmptyState title={t['examPrep.empty']} body={t['examPrep.emptyBody']} />
      ) : (
        <ul className="list-card card">
          {rows.map(({ profile, definitionName, snapshot }) => (
            <li key={profile.id} className="list-row">
              <Link href={`/dashboard/exam-prep/${profile.id}`} className="row-main" style={{ textDecoration: 'none', color: 'inherit' }}>
                <div className="row-title">{definitionName}</div>
                <div className="row-sub">
                  {profile.examDate ? profile.examDate : t['examPrep.noExamDateSet']}
                </div>
              </Link>
              {!profile.examVersionId ? (
                <StatusBadge label={t['examPrep.noExamVersion']} tone="neutral" />
              ) : snapshot ? (
                <StatusBadge label={t[`examPrep.status.${snapshot.overallStatus}`] ?? snapshot.overallStatus} tone={toneForReadinessStatus(snapshot.overallStatus)} />
              ) : (
                <StatusBadge label={t['examPrep.noSnapshotYet']} tone="neutral" />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
