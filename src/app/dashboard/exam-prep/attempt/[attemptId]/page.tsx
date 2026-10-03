import { auth } from '@clerk/nextjs/server';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { getOrCreateStudentId } from '@/lib/auth';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import { getSimulationAttempt } from '@/lib/simulation/attempt.service';
import { findInstanceByAttempt } from '@/lib/exam-core/exam-instance.service';
import { db } from '@/lib/db';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { AttemptControls } from './AttemptControls';
import { ItemRunner } from './ItemRunner';
import { isAttemptDeletedFromHistory } from '@/lib/exam-core/history.service';

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
  // STUDENT E2E: localized labels for the attempt's enums (the same keys the setup screen uses) -- never a raw code.
  const label = (key: string, fallback: string) => (t as Record<string, string>)[key] ?? fallback;

  const attempt = await getSimulationAttempt(attemptId);
  if (!attempt || attempt.studentId !== studentId) notFound();
  // Deleted from the Student's history (a pre-V2 attempt has no instance): never reachable again.
  if (await isAttemptDeletedFromHistory(attempt.id)) notFound();
  // Track B: a submitted attempt is shown as its result (exam score vs canonical mastery, sections, review).
  if (attempt.status === 'COMPLETED') redirect(`/dashboard/exam-prep/attempt/${attempt.id}/result`);
  // Exam V2: the instance (if any) this attempt belongs to -- portfolio uploads are scoped to it.
  const instance = await findInstanceByAttempt(attempt.id).catch(() => null);
  if (instance?.status === 'DELETED') notFound();
  // The content-origin label names the framework ("Práctica generada por StudyUS, alineada al formato de IB").
  const familyRow = await db.query(`SELECT d.exam_family FROM exam_versions v JOIN exam_definitions d ON d.id = v.exam_definition_id WHERE v.id = $1`, [attempt.examVersionId]).catch(() => ({ rows: [] as any[] }));
  const frameworkName = (t as Record<string, string>)[`exam.family.${familyRow.rows[0]?.exam_family}`] ?? familyRow.rows[0]?.exam_family ?? '';
  const v2Labels: Record<string, string> = Object.fromEntries(Object.entries(t as Record<string, string>).filter(([k]) => k.startsWith('exv2.')).map(([k, v]) => [k, v.replace('{framework}', frameworkName)]));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      <PageHeader
        title={t['examPrep.attempt.title']}
        subtitle={label(`ex.type.${attempt.simulationType}`, attempt.simulationType)}
        breadcrumb={<Link href={`/dashboard/exam-prep/${attempt.examProfileId}`}>{t['examPrep.title']}</Link>}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        <StatusBadge
          label={t[`examPrep.attempt.status.${attempt.status}`] ?? attempt.status}
          tone={attempt.status === 'ABANDONED' ? 'neutral' : attempt.status === 'PAUSED' ? 'warn' : 'info'}
        />
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          {t['examPrep.attempt.timingMode']}: {label(`ex.timing.${attempt.timingMode}`, attempt.timingMode)}
        </span>
      </div>

      {attempt.status === 'ACTIVE' && (
        <ItemRunner
          attemptId={attempt.id}
          locale={locale}
          instanceId={instance?.id ?? null}
          labels={{
            v2: v2Labels,
            loading: t['examPrep.attempt.itemLoading'],
            loadError: t['examPrep.attempt.error'],
            submit: t['examPrep.run.submitAnswer'],
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
            section: t['examPrep.run.section'],
            timeLeft: t['examPrep.run.timeLeft'],
            overtime: t['examPrep.run.overtime'],
            timeUpHard: t['examPrep.run.timeUpHard'],
            saved: t['examPrep.run.saved'],
            saving: t['examPrep.run.saving'],
            saveError: t['examPrep.run.saveError'],
            question: t['examPrep.run.question'],
            marks: t['examPrep.run.marks'],
            resources: t['examPrep.run.resources'],
            breakTitle: t['examPrep.run.breakTitle'],
            breakBody: t['examPrep.run.breakBody'],
            endBreak: t['examPrep.run.endBreak'],
            handIn: t['examPrep.run.handIn'],
            handInConfirm: t['examPrep.run.handInConfirm'],
            handingIn: t['examPrep.run.handingIn'],
            navLabel: t['examPrep.run.navLabel'],
            navStatus: {
              OPEN: t['examPrep.run.status.OPEN'],
              DRAFT: t['examPrep.run.status.DRAFT'],
              ANSWERED: t['examPrep.run.status.ANSWERED'],
              UNAVAILABLE: t['examPrep.run.status.UNAVAILABLE'],
              SKIPPED: t['examPrep.run.status.SKIPPED'],
              MISSING: t['examPrep.run.status.MISSING'],
            },
            integrity: t['examPrep.run.integrity'],
            answerRecorded: t['examPrep.run.answerRecorded'],
            invalidAnswer: t['examPrep.run.invalidAnswer'],
            part: t['examPrep.run.part'],
            answerPlaceholder: t['examPrep.run.answerPlaceholder'],
            calculator: t['examPrep.run.calculator'],
            retry: t['xp.errorRetry'],
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
        pauseAllowed={attempt.pauseAllowed}
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
