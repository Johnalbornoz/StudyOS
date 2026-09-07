/**
 * LX-3 -- CONCEPT MISSION.
 *
 * Presentation only. Every value comes from `ConceptMissionView`
 * (built by the pure `buildConceptMissionView` from canonical outputs).
 * This component chooses nothing: not the stage, not the milestones,
 * not the primary action. The one CTA launches through the exact same
 * canonical mechanism Today uses (`StartSessionButton` ->
 * `POST /api/learning/session/start`).
 *
 * Information hierarchy (LX-3G): 1. concept + goal · 2. journey ·
 * 3. now. Everything measured (mastery %, dimensions, retention,
 * transfer, evidence strength) lives below, under a "More about my
 * progress" disclosure owned by the page.
 */

import Link from 'next/link';
import type { Locale } from '@/lib/i18n/messages';
import { getMessages } from '@/lib/i18n/messages';
import type {
  ConceptMissionView,
  ConceptMissionMilestone,
} from '@/lib/lx/concept-mission';
import { activityLabel } from '@/app/dashboard/activityLabel';
import { activityCta } from '@/app/dashboard/activityCta';
import WhyThisV3 from '@/app/dashboard/WhyThisV3';
import StartSessionButton from '@/app/dashboard/StartSessionButton';
import ConceptExplanationDisclosure from './ConceptExplanationDisclosure';

type T = ReturnType<typeof getMessages>;

function stageLabel(stage: string, t: T): string {
  return t[`conceptMission.stage.${stage}` as keyof T] ?? stage;
}

function milestoneStatusText(m: ConceptMissionMilestone, t: T): string {
  const rungLabel = stageLabel(m.rung, t);
  const key = m.demonstrated
    ? 'conceptMission.milestone.demonstrated'
    : m.position === 'CURRENT'
      ? 'conceptMission.milestone.current'
      : m.position === 'PASSED'
        ? 'conceptMission.milestone.passed'
        : m.position === 'INDETERMINATE'
          ? 'conceptMission.milestone.indeterminate'
          : 'conceptMission.milestone.upcoming';
  return (t[key as keyof T] as string).replace('{stage}', rungLabel);
}

function markerGlyph(m: ConceptMissionMilestone): string {
  if (m.demonstrated) return '✓';
  if (m.position === 'CURRENT') return '●';
  if (m.position === 'PASSED') return '–';
  if (m.position === 'INDETERMINATE') return '·';
  return '○';
}

function JourneyRail({ view, t }: { view: ConceptMissionView; t: T }) {
  const journey = view.journey;
  const unavailable = journey.status === 'UNAVAILABLE';
  return (
    <section aria-labelledby="cm-journey-title" style={{ marginBottom: 'var(--space-6)' }}>
      <h2 id="cm-journey-title" className="label" style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 'var(--space-2)' }}>
        {t['conceptMission.journeyTitle']}
      </h2>
      <p style={{ margin: '0 0 var(--space-3)', fontSize: 15, fontWeight: 600 }}>
        {unavailable
          ? t['conceptMission.journeyUnavailable']
          : t['conceptMission.journeyYouAreHere'].replace('{stage}', stageLabel(journey.stage, t))}
      </p>
      <ol className="cm-rail">
        {journey.milestones.map((m) => (
          <li
            key={m.rung}
            className={`cm-rung cm-rung-${m.position.toLowerCase()}${m.demonstrated ? ' cm-rung-done' : ''}`}
          >
            <span className="cm-rung-marker" aria-hidden="true">{markerGlyph(m)}</span>
            <span className="cm-rung-label" aria-hidden="true">{stageLabel(m.rung, t)}</span>
            {m.readyToProve && (
              <span className="cm-rung-note" aria-hidden="true">{t['conceptMission.readyToProveNote']}</span>
            )}
            <span className="sr-only">{milestoneStatusText(m, t)}</span>
          </li>
        ))}
      </ol>
      {!unavailable && (
        <p style={{ margin: 'var(--space-3) 0 0', fontSize: 13.5, color: 'var(--text-secondary)' }}>
          {(t[`conceptMission.reason.${journey.reasonCode}` as keyof T] as string) ?? ''}
        </p>
      )}
      {!unavailable && journey.intervention === 'REINFORCE' && (
        <div
          className="card"
          style={{ marginTop: 'var(--space-3)', padding: 'var(--space-3) var(--space-4)', display: 'flex', flexDirection: 'column', gap: 4 }}
        >
          <span className="label" style={{ color: 'var(--warning)', fontSize: 12 }}>{t['conceptMission.reinforceBadge']}</span>
          <span style={{ fontSize: 13.5, color: 'var(--text-secondary)' }}>{t['conceptMission.reinforceBody']}</span>
        </div>
      )}
    </section>
  );
}

function NowCard({
  view,
  studentId,
  conceptId,
  locale,
  t,
}: {
  view: ConceptMissionView;
  studentId: string;
  conceptId: string;
  locale: Locale;
  t: T;
}) {
  const { now, learn } = view;

  if (now.kind === 'CANONICAL_ACTION' && now.activityType && now.actionConceptId) {
    return (
      <section
        aria-labelledby="cm-now-title"
        className="card"
        style={{ marginBottom: 'var(--space-6)', borderColor: 'var(--brand)', borderWidth: 2, display: 'flex', flexDirection: 'column', gap: 4 }}
      >
        <h2 id="cm-now-title" className="label" style={{ color: 'var(--text-muted)', fontSize: 13 }}>{t['conceptMission.nowTitle']}</h2>
        <div style={{ fontSize: 18, fontWeight: 650 }}>{activityLabel(now.activityType, t)}</div>
        {now.facts.length > 0 && <WhyThisV3 facts={now.facts} t={t} />}
        <div style={{ marginTop: 'var(--space-3)' }}>
          <StartSessionButton
            studentId={studentId}
            actionConceptId={now.actionConceptId}
            label={activityCta(now.activityType, t)}
            accessibleLabel={`${activityCta(now.activityType, t)}: ${activityLabel(now.activityType, t)}`}
            unavailableLabel={t['today3.unavailableBody']}
            retryLabel={t['today3.retry']}
            variant="primary"
          />
        </div>
      </section>
    );
  }

  // NO_CANONICAL_ACTION
  const consolidated = now.fallback === 'CONSOLIDATED_NO_ACTION';
  return (
    <section
      aria-labelledby="cm-now-title"
      className="card"
      style={{ marginBottom: 'var(--space-6)', padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 6 }}
    >
      <h2 id="cm-now-title" className="label" style={{ color: 'var(--text-muted)', fontSize: 13 }}>{t['conceptMission.nowTitle']}</h2>
      <div style={{ fontSize: 18, fontWeight: 650 }}>
        {consolidated ? t['conceptMission.noActionConsolidatedTitle'] : t['conceptMission.noActionLearnFirstTitle']}
      </div>
      <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
        {consolidated ? t['conceptMission.noActionConsolidatedBody'] : t['conceptMission.noActionLearnFirstBody']}
      </p>
      {!consolidated && learn.prominence === 'PRIMARY_INLINE' && (
        <div style={{ marginTop: 'var(--space-2)' }}>
          <ConceptExplanationDisclosure
            studentId={studentId}
            subjectId={view.identity.subjectId}
            conceptId={conceptId}
            locale={locale}
            expandLabel={t['conceptMission.learnExpandRead']}
            collapseLabel={t['conceptMission.learnCollapse']}
            emphasis="primary"
          />
        </div>
      )}
    </section>
  );
}

export default function ConceptMission({
  view,
  studentId,
  conceptId,
  locale,
}: {
  view: ConceptMissionView;
  studentId: string;
  conceptId: string;
  locale: Locale;
}) {
  const t = getMessages(locale);
  const learnInlineFromNow = view.now.kind === 'NO_CANONICAL_ACTION' && view.now.fallback === 'LEARN_FIRST';
  const learnLabel = view.learn.state === 'REVIEW' ? t['conceptMission.learnExpandReview'] : t['conceptMission.learnExpandRead'];

  return (
    <div style={{ maxWidth: 640 }}>
      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 6, display: 'flex', gap: 6 }}>
        <Link href={`/dashboard/subjects/${view.identity.subjectId}`} style={{ color: 'var(--text-muted)' }}>
          {view.identity.subjectName}
        </Link>{' '}
        / {view.identity.conceptName}
      </div>
      <h1 style={{ marginBottom: 'var(--space-2)' }}>{view.identity.conceptName}</h1>

      <section aria-labelledby="cm-goal-title" style={{ marginBottom: 'var(--space-6)' }}>
        <h2 id="cm-goal-title" className="label" style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 2 }}>
          {t['conceptMission.goalTitle']}
        </h2>
        <p style={{ margin: 0, fontSize: 15.5, lineHeight: 1.55, color: 'var(--text-primary)' }}>{view.goal.text}</p>
      </section>

      <JourneyRail view={view} t={t} />

      <NowCard view={view} studentId={studentId} conceptId={conceptId} locale={locale} t={t} />

      {/* LEARN: inline & primary when understanding is the job and there
          IS a canonical action (the NowCard renders its own inline
          disclosure for the LEARN_FIRST no-action case). */}
      {!learnInlineFromNow && view.learn.prominence === 'PRIMARY_INLINE' && (
        <section aria-labelledby="cm-learn-title" style={{ marginBottom: 'var(--space-6)' }}>
          <h2 id="cm-learn-title" style={{ fontSize: 16, marginBottom: 'var(--space-3)' }}>{t['conceptMission.learnTitle']}</h2>
          <ConceptExplanationDisclosure
            studentId={studentId}
            subjectId={view.identity.subjectId}
            conceptId={conceptId}
            locale={locale}
            expandLabel={learnLabel}
            collapseLabel={t['conceptMission.learnCollapse']}
            emphasis="secondary"
          />
        </section>
      )}

      {/* Secondary actions -- never alternative learning activities. */}
      <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap', marginBottom: 'var(--space-6)' }}>
        {view.learn.prominence === 'SECONDARY' && (
          <ConceptExplanationDisclosure
            studentId={studentId}
            subjectId={view.identity.subjectId}
            conceptId={conceptId}
            locale={locale}
            expandLabel={learnLabel}
            collapseLabel={t['conceptMission.learnCollapse']}
            emphasis="secondary"
          />
        )}
        <Link
          href={`/dashboard/tutor?subjectId=${view.identity.subjectId}&conceptId=${conceptId}`}
          className="btn btn-secondary"
        >
          {t['conceptMission.secondaryTutor']}
        </Link>
      </div>
    </div>
  );
}
