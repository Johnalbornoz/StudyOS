import { auth } from '@clerk/nextjs/server';
import Link from 'next/link';
import { getOrCreateStudentId } from '@/lib/auth';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import { loadMyPathContext, buildMyPathOverview } from '@/lib/lx/path-view';
import { presentSnapshotNextChallenge } from '@/lib/experience/next-challenge.server';
import NextChallengeCard from '../NextChallengeCard';
import StageTrack from '../StageTrack';
import { PageIntro } from '@/components/ui/PageIntro';
import { Section } from '@/components/ui/Section';
import { InlineAlert } from '@/components/ui/InlineAlert';
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
  // UX-2: the hero is presented exactly like Today's (same snapshot item, same canonical launch).
  const heroView = context.snapshot && overview.current ? presentSnapshotNextChallenge(context.snapshot) : null;

  logMyPath('MY_PATH_READY', { latencyMs: Date.now() - requestStartedAtMs, state: overview.state });

  if (overview.state === 'READY' && overview.current) {
    logMyPath('MY_PATH_CURRENT_POSITION_RENDERED', {
      subjectId: overview.current.subjectId,
      conceptId: overview.current.conceptId,
      currentStage: overview.current.journey.currentStage,
      activityType: heroView?.status === 'READY' ? heroView.activityType : null,
      heroStatus: heroView?.status ?? null,
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
    <div className="xp-page xp-page--wide">
      <PageIntro title={t['myPath.title']} lead={t['myPath.subtitle']} />

      {overview.state === 'UNRESOLVED' && (
        <InlineAlert
          tone="error"
          title={t['myPath.unresolvedTitle']}
          body={t['myPath.unresolvedBody']}
          actions={
            <>
              <a href="/dashboard/path" className="btn btn-primary">{t['myPath.unresolvedRetry']}</a>
              <Link href="/dashboard/today" className="btn btn-secondary">{t['myPath.unresolvedGoToToday']}</Link>
            </>
          }
        />
      )}

      {(overview.state === 'NO_ACTIVE_SUBJECTS' || overview.state === 'COLD') && (
        <section className="xp-hero xp-hero--calm" aria-labelledby="rt-start-title">
          <h2 id="rt-start-title" className="xp-hero-title">{t['myPath.startTitle']}</h2>
          <p className="xp-hero-why">{overview.state === 'COLD' ? t['myPath.coldBody'] : t['myPath.startBody']}</p>
          <div className="xp-hero-cta">
            <Link href="/dashboard/subjects" className="btn btn-primary">{t['myPath.exploreCta']}</Link>
          </div>
        </section>
      )}

      {overview.state === 'READY' && (
        <>
          {overview.current && heroView ? (
            // UX-2: the SAME hero Today renders, from the SAME snapshot
            // next-executable item -- presented from the canonical launch
            // the Start button runs, never from the legacy activityType.
            <NextChallengeCard
              view={heroView}
              conceptLabel={overview.current.conceptTitle}
              subjectName={overview.current.subjectTitle}
              studentId={studentId}
              t={t}
              locale={locale}
              legacyMinutes={overview.current.estimatedMinutes}
              fallbackJourney={overview.current.journey}
              launchMark="MY_PATH_ACTION_LAUNCHED"
            />
          ) : (
            <section className="xp-hero xp-hero--calm" aria-labelledby="rt-caught-up">
              <h2 id="rt-caught-up" className="xp-hero-title">{t['myPath.allCaughtUpTitle']}</h2>
              <p className="xp-hero-why">{t['myPath.allCaughtUpBody']}</p>
            </section>
          )}

          {nearby.length > 0 && (
            <Section id="rt-next" title={t['myPath.nearbyTitle']}>
              <ul className="rt-next">
                {nearby.map((c) => (
                  <li key={c.conceptId} className="card rt-card">
                    <Link href={`/dashboard/subjects/${overview.current!.subjectId}/concepts/${c.conceptId}`} className="rt-card-title">
                      {c.title}
                    </Link>
                    <p className="rt-card-reason">{journeyReason(c.journey, t)}</p>
                    <StageTrack journey={c.journey} t={t} variant="light" />
                    {c.journey.intervention && <span className="xp-reinforce" style={{ alignSelf: 'flex-start' }}>{t['myPathStage.REINFORCE']}</span>}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section id="rt-subjects" title={t['myPath.subjectsTitle']} action={<Link href="/dashboard/knowledge" className="ui-link">{t['kn.seeAll']}</Link>}>
            {consolidatedCount + retentionDueCount + transferPendingCount > 0 && (
              <ul className="rt-summary">
                {consolidatedCount > 0 && <li>{t['myPath.pillConsolidated']}<strong>{consolidatedCount}</strong></li>}
                {retentionDueCount > 0 && <li>{t['myPath.pillRetentionDue']}<strong>{retentionDueCount}</strong></li>}
                {transferPendingCount > 0 && <li>{t['myPath.pillTransferPending']}<strong>{transferPendingCount}</strong></li>}
              </ul>
            )}
            <ul className="rt-subjects">
              {overview.subjects.map((s) => (
                <li key={s.subjectId}>
                  <Link href={`/dashboard/path/${s.subjectId}`} className="card card-link rt-subject">
                    <span className="rt-subject-title">{s.title}</span>
                    <span className="rt-subject-meta">
                      {s.summary.consolidatedCount}/{s.summary.totalConcepts} {t['myPath.summaryConsolidated']}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        </>
      )}
    </div>
  );
}
