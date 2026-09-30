import Link from 'next/link';
import type { getMessages } from '@/lib/i18n/messages';
import type { NextChallengeView } from '@/lib/experience/next-challenge';
import { challengeVerb, reinforceLabel } from '@/lib/experience/vocabulary';
import { conceptJourneyFromResult, type ConceptJourney } from '@/lib/lx/concept-journey';
import { LEARNER_JOURNEY_CONTRACT_VERSION } from '@/lib/lx/learner-journey-contract';
import { InlineAlert } from '@/components/ui/InlineAlert';
import { activityLabel } from './activityLabel';
import { activityCta } from './activityCta';
import { activityNarrative } from './activityNarrative';
import { whyThisSentence } from './WhyThisV3';
import StartSessionButton from './StartSessionButton';
import StageTrack from './StageTrack';
import LocalDateText from '@/components/ui/LocalDateText';

type T = ReturnType<typeof getMessages>;

/**
 * UX-2 -- "Tu siguiente reto". The single hero used by Today and My Path.
 *
 * Presentation of a `NextChallengeView` (lib/experience/next-challenge.ts):
 * the label, challenge verb, narrative and CTA all come from the view's
 * `activityType`, which is the SAME canonical activity the Start button
 * launches (the button still only sends the concept id -- the server
 * re-derives the activity). Nothing here chooses, ranks or gates.
 */
export default function NextChallengeCard({
  view,
  conceptLabel,
  subjectName,
  studentId,
  t,
  locale,
  legacyMinutes,
  fallbackJourney,
  launchMark,
  headingLevel = 2,
}: {
  view: NextChallengeView;
  conceptLabel: string;
  subjectName: string;
  studentId: string;
  t: T;
  locale: string;
  /** The legacy execution plan's own minute estimate -- shown only under the legacy authority, where it describes the same activity. */
  legacyMinutes?: number | null;
  /** Journey to draw when the view carries no canonical stage (legacy authority). */
  fallbackJourney?: ConceptJourney | null;
  launchMark?: string;
  headingLevel?: 1 | 2;
}) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2';
  const journey: ConceptJourney | null = view.stage
    ? conceptJourneyFromResult({
        stage: view.stage,
        intervention: view.status === 'READY' && view.reinforce ? 'REINFORCE' : null,
        reason: 'CANONICAL_ENGINE_V1',
        contractVersion: LEARNER_JOURNEY_CONTRACT_VERSION,
      })
    : fallbackJourney ?? null;

  if (view.status === 'UNAVAILABLE' && view.reason === 'CANONICAL_READ_FAILED') {
    // A failed read is a failure, never "nothing to do".
    return (
      <InlineAlert
        tone="error"
        title={t['xp.readFailedTitle']}
        body={t['xp.readFailedBody']}
        actions={
          <>
            <a href="/dashboard/today" className="btn btn-primary">{t['xp.errorRetry']}</a>
            <Link href="/dashboard/path" className="btn btn-secondary">{t['xp.pathLink']}</Link>
          </>
        }
      />
    );
  }

  if (view.status === 'READY') {
    const cta = activityCta(view.activityType, t);
    const why = whyThisSentence(view.facts, t, 1);
    const size = view.itemCount
      ? t['xp.questionCount'].replace('{count}', String(view.itemCount))
      : view.authority === 'LEGACY' && legacyMinutes
        ? t['bestNextAction.minutes'].replace('{min}', String(legacyMinutes))
        : null;
    return (
      <section className="xp-hero" aria-labelledby="xp-next-title" data-authority={view.authority}>
        <div className="xp-hero-eyebrow">
          {/* Closeout B: the retention eyebrow, branching ONLY on the
              already-chosen activity -- never a memory value or urgency. */}
          <span className="xp-hero-kicker">{view.activityType === 'RETENTION_CHECK' ? t['today.retentionEyebrow'] : t['xp.nextChallenge']}</span>
          <span className="xp-hero-verb">{challengeVerb(view.challenge, t)}</span>
        </div>
        <Heading id="xp-next-title" className="xp-hero-title">{conceptLabel}</Heading>
        <p className="xp-hero-meta">
          {subjectName && <span>{subjectName}</span>}
          <span>{activityLabel(view.activityType, t)}</span>
          {size && <span className="tabular">{size}</span>}
        </p>
        {view.reinforce && <span className="xp-reinforce">{reinforceLabel(t)}</span>}
        <p className="xp-hero-narrative">{activityNarrative(view.activityType, t)}</p>
        {why && (
          <p className="xp-hero-why">
            <strong>{t['whyThis.label']}</strong> {why}
          </p>
        )}
        {journey && <StageTrack journey={journey} t={t} />}
        <div className="xp-hero-cta">
          <StartSessionButton
            studentId={studentId}
            actionConceptId={view.conceptId}
            label={cta}
            accessibleLabel={`${cta}: ${conceptLabel}`}
            unavailableLabel={t['today3.unavailableBody']}
            retryLabel={t['today3.retry']}
            licenseTitle={t['learning.licenseRequiredTitle']}
            licenseBody={t['learning.licenseRequiredBody']}
            licenseCtaLabel={t['license.demoBannerCta']}
            variant="primary"
            size="lg"
            align="start"
            launchMark={launchMark}
          />
        </div>
      </section>
    );
  }

  if (view.status === 'WAITING') {
    // WAITING is a valid canonical result, never an error -- the SAME
    // copy Concept Mission's NOW card shows for this exact condition.
    return (
      <section className="xp-hero xp-hero--calm" aria-labelledby="xp-next-title">
        <div className="xp-hero-eyebrow">
          <span className="xp-hero-kicker">{subjectName}</span>
        </div>
        <Heading id="xp-next-title" className="xp-hero-title">{conceptLabel}</Heading>
        <p className="xp-hero-narrative"><strong>{t['conceptMission.noActionRetentionWaitingTitle']}</strong></p>
        <p className="xp-hero-why">
          {view.nextEligibleAt
            ? <LocalDateText template={t['conceptMission.noActionRetentionWaitingBodyWithDate']} iso={new Date(view.nextEligibleAt).toISOString()} locale={locale} />
            : t['conceptMission.noActionRetentionWaitingBody']}
        </p>
        {journey && <StageTrack journey={journey} t={t} />}
        <div className="xp-hero-cta">
          <Link href={`/dashboard/subjects/${view.subjectId}/concepts/${view.conceptId}`} className="btn btn-secondary">{t['xp.openConcept']}</Link>
        </div>
      </section>
    );
  }

  // CONSOLIDATED, or a canonical status with no executable action
  // (BLOCKED / LOCKED / NOT_READY / zero-gap): no Start button, ever.
  return (
    <section className="xp-hero xp-hero--calm" aria-labelledby="xp-next-title">
      <div className="xp-hero-eyebrow">
        <span className="xp-hero-kicker">{t['xp.nextChallenge']}</span>
      </div>
      <Heading id="xp-next-title" className="xp-hero-title">{t['xp.caughtUpTitle']}</Heading>
      <p className="xp-hero-why">{t['xp.caughtUpBody']}</p>
      <div className="xp-hero-cta">
        <Link href="/dashboard/path" className="btn btn-secondary">{t['xp.pathLink']}</Link>
      </div>
    </section>
  );
}
