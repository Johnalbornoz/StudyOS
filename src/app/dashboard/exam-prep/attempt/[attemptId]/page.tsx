import { auth } from '@clerk/nextjs/server';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { getOrCreateStudentId } from '@/lib/auth';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import { getSimulationAttempt } from '@/lib/simulation/attempt.service';
import { getSimulationScoreSummary } from '@/lib/simulation/scoring.service';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { AttemptControls } from './AttemptControls';
import { ItemRunner } from './ItemRunner';

/**
 * F15 Workstream A -- completes IVG-F14-01: a real, active attempt now
 * renders the item-by-item ItemRunner (generation + grading both
 * delegated to already-certified services -- see
 * item-resolution.service.ts) instead of a deferred-notice message.
 * PAUSED/ABANDONED/COMPLETED render their own real, distinct state --
 * never the item-taking UI for a non-ACTIVE attempt.
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

  const scoreSummary = attempt.status === 'COMPLETED' ? await getSimulationScoreSummary(attempt.examAttemptId) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      <PageHeader
        title={t['examPrep.attempt.title']}
        subtitle={attempt.simulationType}
        breadcrumb={<Link href={`/dashboard/exam-prep/${attempt.examProfileId}`}>{t['examPrep.title']}</Link>}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        <StatusBadge
          label={t[`examPrep.attempt.status.${attempt.status}`] ?? attempt.status}
          tone={attempt.status === 'COMPLETED' ? 'good' : attempt.status === 'ABANDONED' ? 'neutral' : attempt.status === 'PAUSED' ? 'warn' : 'info'}
        />
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          {t['examPrep.attempt.timingMode']}: {attempt.timingMode}
        </span>
      </div>

      {attempt.status === 'COMPLETED' && scoreSummary && (
        <div className="card" style={{ padding: 'var(--space-4)' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)' }}>{t['assignments.practice.score']}</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>
            {scoreSummary.maxScore > 0 ? Math.round((scoreSummary.rawScore / scoreSummary.maxScore) * 100) : 0}%
          </div>
        </div>
      )}

      {attempt.status === 'ACTIVE' && (
        <ItemRunner
          attemptId={attempt.id}
          labels={{
            loading: t['examPrep.attempt.itemLoading'],
            loadError: t['examPrep.attempt.error'],
            submit: t['examPrep.attempt.itemSubmit'],
            submitting: t['examPrep.attempt.itemSubmitting'],
            submitError: t['examPrep.attempt.error'],
            progress: t['examPrep.attempt.progress'],
            itemUnavailable: t['examPrep.attempt.itemUnavailable'],
            itemUnavailableReason: {
              NO_CURRICULUM_MAPPING: t['examPrep.attempt.itemUnavailable.noCurriculumMapping'],
              CONCEPT_NOT_MATCHED: t['examPrep.attempt.itemUnavailable.conceptNotMatched'],
              NO_ITEM_GENERATED: t['examPrep.attempt.itemUnavailable.noItemGenerated'],
            },
            skip: t['examPrep.attempt.skip'],
            skipping: t['examPrep.attempt.skipping'],
            complete: t['examPrep.attempt.complete'],
            completeBody: t['examPrep.attempt.completeBody'],
            finalize: t['examPrep.attempt.finalize'],
            finalizing: t['examPrep.attempt.finalizing'],
            finalizeError: t['examPrep.attempt.finalizeError'],
            lastFeedback: t['examPrep.attempt.lastFeedback'],
          }}
        />
      )}

      {(attempt.status === 'PAUSED' || attempt.status === 'ABANDONED') && (
        <div className="card" style={{ padding: 'var(--space-4)' }}>
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            {attempt.status === 'PAUSED' ? t['examPrep.attempt.pausedBody'] : t['examPrep.attempt.abandonedBody']}
          </p>
        </div>
      )}

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
  );
}
