import { auth } from '@clerk/nextjs/server';
import Link from 'next/link';
import { getOrCreateStudentId } from '@/lib/auth';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import { loadMyPathContext, buildMyPathOverview } from '@/lib/lx/path-view';
import { activityCta } from '../activityCta';
import { activityNarrative } from '../activityNarrative';
import WhyThisV3 from '../WhyThisV3';
import StartSessionButton from '../StartSessionButton';
import JourneyStrip from './JourneyStrip';
import { journeyReason } from './journeyReason';

/**
 * LX-7 -- MY PATH (overview).
 *
 * The learner's canonical map of where they are, what they've done,
 * and what's next -- a PRESENTATION of `MyPathOverview`
 * (lib/lx/path-view.ts), never a second decision engine. The current
 * position hero is the exact same authority Today renders (R20): both
 * read `getLearningOSSnapshot().nextExecutableItem`.
 *
 * GLOBAL_INTERFACE_LANGUAGE governs this whole shell (R22) -- launching
 * an activity switches to ACTIVITY_LANGUAGE only inside that activity
 * (LX-4P-R3), never here.
 */

/** R29: safe, learner-content-free observability -- server-side only, one line per event. */
function logMyPath(label: string, meta: Record<string, unknown> = {}): void {
  try {
    // eslint-disable-next-line no-console
    console.log('[my-path]', JSON.stringify({ label, ...meta }));
  } catch { /* logging must never break the page */ }
}

export default async function MyPathPage() {
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
  logMyPath('MY_PATH_REQUEST_STARTED');

  const context = await loadMyPathContext(studentId, locale);
  const overview = await buildMyPathOverview(context);

  logMyPath('MY_PATH_READY', { latencyMs: Date.now() - requestStartedAtMs, state: overview.state });

  if (overview.state === 'READY' && overview.current) {
    logMyPath('MY_PATH_CURRENT_POSITION_RENDERED', {
      subjectId: overview.current.subjectId,
      conceptId: overview.current.conceptId,
      currentStage: overview.current.journey.currentStage,
      activityType: overview.current.activityType,
    });
  } else if (overview.state === 'UNRESOLVED') {
    logMyPath('MY_PATH_UNRESOLVED');
    logMyPath('MY_PATH_FAILED');
  }

  const consolidatedCount = overview.subjects.reduce((sum, s) => sum + s.summary.consolidatedCount, 0);
  const retentionDueCount = overview.subjects.reduce((sum, s) => sum + s.summary.retentionDueCount, 0);
  const transferPendingCount = overview.subjects.reduce((sum, s) => sum + s.summary.transferPendingCount, 0);

  const nearby = overview.currentSubjectView
    ? [...overview.currentSubjectView.topics.flatMap((tp) => tp.concepts), ...overview.currentSubjectView.unassigned]
        .filter((c) => !c.isCurrent && !c.journey.consolidated)
        .slice(0, 4)
    : [];

  return (
    <div>
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <h1>{t['myPath.title']}</h1>
        <p style={{ color: 'var(--text-secondary)', margin: '8px 0 0', fontSize: 15, maxWidth: '60ch' }}>{t['myPath.subtitle']}</p>
      </div>

      {overview.state === 'UNRESOLVED' && (
        <div className="card empty-state">
          <strong>{t['myPath.unresolvedTitle']}</strong>
          {t['myPath.unresolvedBody']}
          <div style={{ marginTop: 'var(--space-4)', display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <a href="/dashboard/path" className="btn btn-primary">{t['myPath.unresolvedRetry']}</a>
            <Link href="/dashboard/today" className="btn btn-ghost">{t['myPath.unresolvedGoToToday']}</Link>
          </div>
        </div>
      )}

      {overview.state === 'NO_ACTIVE_SUBJECTS' && (
        <div className="card empty-state">
          <strong>{t['myPath.startTitle']}</strong>
          {t['myPath.startBody']}
          <div style={{ marginTop: 'var(--space-4)' }}>
            <Link href="/dashboard/subjects" className="btn btn-primary">{t['myPath.exploreCta']}</Link>
          </div>
        </div>
      )}

      {overview.state === 'COLD' && (
        <div className="card empty-state">
          <strong>{t['myPath.startTitle']}</strong>
          {t['myPath.coldBody']}
          <div style={{ marginTop: 'var(--space-4)' }}>
            <Link href="/dashboard/subjects" className="btn btn-primary">{t['myPath.exploreCta']}</Link>
          </div>
        </div>
      )}

      {overview.state === 'READY' && (
        <>
          {overview.current ? (
            <div
              className="card"
              style={{ marginBottom: 'var(--space-8)', borderColor: 'var(--brand)', borderWidth: 2, padding: 'var(--space-6)' }}
            >
              <div className="label" style={{ color: 'var(--brand-ink)', marginBottom: 10 }}>{t['myPath.heroLabel']}</div>
              <p style={{ margin: '0 0 4px', fontSize: 13.5, color: 'var(--text-muted)' }}>{overview.current.subjectTitle}</p>
              <h2 style={{ margin: 0, fontSize: 24, lineHeight: 1.2, fontWeight: 700, letterSpacing: '-0.01em' }}>
                {overview.current.conceptTitle}
              </h2>
              <div style={{ margin: 'var(--space-4) 0' }}>
                <JourneyStrip journey={overview.current.journey} t={t} />
              </div>
              <p style={{ fontSize: 15.5, lineHeight: 1.5, color: 'var(--text-primary)', margin: '0 0 var(--space-2)', maxWidth: '52ch' }}>
                {activityNarrative(overview.current.activityType, t)}
              </p>
              <WhyThisV3 facts={overview.current.decision.facts} t={t} maxFacts={1} />
              <div style={{ marginTop: 'var(--space-5)' }}>
                <StartSessionButton
                  studentId={studentId}
                  actionConceptId={overview.current.conceptId}
                  label={activityCta(overview.current.activityType, t)}
                  accessibleLabel={`${activityCta(overview.current.activityType, t)}: ${overview.current.conceptTitle}`}
                  unavailableLabel={t['today3.unavailableBody']}
                  retryLabel={t['today3.retry']}
                  variant="primary"
                  launchMark="MY_PATH_ACTION_LAUNCHED"
                />
              </div>
            </div>
          ) : (
            <div className="card" style={{ marginBottom: 'var(--space-8)', padding: 'var(--space-6)' }}>
              <strong>{t['myPath.allCaughtUpTitle']}</strong>
              <p style={{ margin: '8px 0 0', color: 'var(--text-secondary)', fontSize: 14.5 }}>{t['myPath.allCaughtUpBody']}</p>
            </div>
          )}

          {nearby.length > 0 && (
            <div style={{ marginBottom: 'var(--space-8)' }}>
              <h2 style={{ fontSize: 14, fontWeight: 650, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.02em', marginBottom: 'var(--space-3)' }}>
                {t['myPath.nearbyTitle']}
              </h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                {nearby.map((c) => (
                  <div key={c.conceptId} className="card" style={{ padding: 'var(--space-4)' }}>
                    <Link href={`/dashboard/subjects/${overview.current!.subjectId}/concepts/${c.conceptId}`} style={{ fontSize: 14, fontWeight: 600 }}>
                      {c.title}
                    </Link>
                    <div style={{ marginTop: 6 }}>
                      <JourneyStrip journey={c.journey} t={t} />
                    </div>
                    <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>{journeyReason(c.journey, t)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {consolidatedCount + retentionDueCount + transferPendingCount > 0 && (
            <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 'var(--space-8)' }}>
              {[
                consolidatedCount > 0 ? `${consolidatedCount} ${t['myPath.summaryConsolidated']}` : null,
                retentionDueCount > 0 ? `${retentionDueCount} ${t['myPath.summaryRetentionDue']}` : null,
                transferPendingCount > 0 ? `${transferPendingCount} ${t['myPath.summaryTransferPending']}` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          )}

          <div>
            <h2 style={{ fontSize: 14, fontWeight: 650, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.02em', marginBottom: 'var(--space-3)' }}>
              {t['myPath.subjectsTitle']}
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 'var(--space-3)' }}>
              {overview.subjects.map((s) => (
                <Link
                  key={s.subjectId}
                  href={`/dashboard/path/${s.subjectId}`}
                  className="card"
                  style={{ padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 4 }}
                >
                  <span style={{ fontSize: 14.5, fontWeight: 650 }}>{s.title}</span>
                  <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                    {s.summary.consolidatedCount}/{s.summary.totalConcepts} {t['myPath.summaryConsolidated']}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
