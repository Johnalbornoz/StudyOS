import { auth } from '@clerk/nextjs/server';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { getOrCreateStudentId } from '@/lib/auth';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import { getSimulationAttempt } from '@/lib/simulation/attempt.service';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { AttemptControls } from './AttemptControls';

/**
 * F14 Workstream A -- Simulation attempt status (task section 4/12).
 * Deliberately status/lifecycle-only: item-by-item exam-taking UI
 * (rendering real assessment items from the frozen SimulationPlan,
 * timing, per-item response capture via
 * `/api/simulation/attempts/[id]/responses`) is a genuinely separate,
 * large surface this phase does not build -- see
 * F14_STUDENT_EXAM_PREP_EXPERIENCE.md's own disclosed scope decision.
 * No "Complete" action is exposed here for exactly that reason: this
 * page never lets a student finalize an attempt with zero real item
 * responses recorded, which would produce a truthful-but-hollow score
 * rather than a fabricated one -- still not something to expose
 * silently. Pause/Resume/Abandon are real, safe, and fully supported
 * by the existing F9 attempt lifecycle regardless.
 */
export default async function SimulationAttemptPage({ params }: { params: Promise<{ attemptId: string }> }) {
  const { attemptId } = await params;
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect('/sign-in');

  const studentId = await getOrCreateStudentId(clerkUserId);
  const locale = await getInterfaceLanguage(studentId).catch(() => 'es' as const);
  const t = getMessages(locale);

  const attempt = await getSimulationAttempt(attemptId);
  if (!attempt || attempt.studentId !== studentId) notFound();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      <PageHeader
        title={t['examPrep.attempt.title']}
        subtitle={attempt.simulationType}
        breadcrumb={<Link href={`/dashboard/exam-prep/${attempt.examProfileId}`}>{t['examPrep.title']}</Link>}
      />

      <div className="card" style={{ padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <StatusBadge
            label={t[`examPrep.attempt.status.${attempt.status}`] ?? attempt.status}
            tone={attempt.status === 'COMPLETED' ? 'good' : attempt.status === 'ABANDONED' ? 'neutral' : attempt.status === 'PAUSED' ? 'warn' : 'info'}
          />
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t['examPrep.attempt.timingMode']}: {attempt.timingMode}</span>
        </div>

        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t['examPrep.attempt.deferredNotice']}</p>

        <AttemptControls
          attemptId={attempt.id}
          status={attempt.status}
          labels={{
            pause: t['examPrep.attempt.pause'],
            resume: t['examPrep.attempt.resume'],
            abandon: t['examPrep.attempt.abandon'],
            error: t['examPrep.attempt.error'],
          }}
        />
      </div>
    </div>
  );
}
