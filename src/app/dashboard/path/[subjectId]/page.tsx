import { auth } from '@clerk/nextjs/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { query } from '@/lib/db';
import { getOrCreateStudentId } from '@/lib/auth';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import { loadMyPathContext, buildSubjectPathView, type ConceptPathView } from '@/lib/lx/path-view';
import { isRetentionWaiting } from '@/lib/lx/learner-journey-contract';
import type { NextChallengeView } from '@/lib/experience/next-challenge';
import { loadConceptNextChallenge } from '@/lib/experience/next-challenge.server';
import { whyThisSentence } from '../../WhyThisV3';
import { activityCta } from '../../activityCta';
import { activityNarrative } from '../../activityNarrative';
import StartSessionButton from '../../StartSessionButton';
import JourneyStrip from '../JourneyStrip';
import { journeyReason } from '../journeyReason';
import LocalDateText from '@/components/ui/LocalDateText';
import { localizeSubjectName } from '@/lib/i18n/catalog-labels';

/** R29: safe, learner-content-free observability. */
function logMyPath(label: string, meta: Record<string, unknown> = {}): void {
  try {
    // eslint-disable-next-line no-console
    console.log('[my-path]', JSON.stringify({ label, ...meta }));
  } catch { /* logging must never break the page */ }
}

function ConceptRow({
  concept,
  subjectId,
  studentId,
  t,
  locale,
  onCurrentDecision,
}: {
  concept: ConceptPathView;
  subjectId: string;
  studentId: string;
  t: ReturnType<typeof getMessages>;
  locale: string;
  /** UX-2: the current concept's next challenge -- the SAME presenter and gates as Today/My Path. */
  onCurrentDecision: NextChallengeView | null;
}) {
  const ready = onCurrentDecision?.status === 'READY' ? onCurrentDecision : null;
  const why = ready ? whyThisSentence(ready.facts, t, 1) : '';
  return (
    <div className="card" style={{ padding: 'var(--space-4)', borderColor: concept.isCurrent ? 'var(--brand)' : undefined, borderWidth: concept.isCurrent ? 2 : undefined }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <Link href={`/dashboard/subjects/${subjectId}/concepts/${concept.conceptId}`} style={{ fontSize: 14.5, fontWeight: 650 }}>
          {concept.title}
        </Link>
        {concept.isCurrent && ready && (
          <StartSessionButton
            studentId={studentId}
            actionConceptId={concept.conceptId}
            label={activityCta(ready.activityType, t)}
            accessibleLabel={`${activityCta(ready.activityType, t)}: ${concept.title}`}
            unavailableLabel={t['today3.unavailableBody']}
            retryLabel={t['today3.retry']}
            licenseTitle={t['learning.licenseRequiredTitle']}
            licenseBody={t['learning.licenseRequiredBody']}
            licenseCtaLabel={t['license.demoBannerCta']}
            variant="secondary"
            launchMark="MY_PATH_ACTION_LAUNCHED"
          />
        )}
      </div>
      <div style={{ marginTop: 8 }}>
        <JourneyStrip journey={concept.journey} t={t} />
      </div>
      {concept.isCurrent && ready ? (
        <>
          <p style={{ margin: '8px 0 0', fontSize: 13.5, color: 'var(--text-primary)' }}>{activityNarrative(ready.activityType, t)}</p>
          {why && (
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 6 }}>
              <span style={{ fontWeight: 650, color: 'var(--text-secondary)' }}>{t['whyThis.label']}</span> {why}
            </div>
          )}
        </>
      ) : concept.isCurrent && onCurrentDecision?.status === 'WAITING' ? (
        <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>
          {onCurrentDecision.nextEligibleAt
            ? <LocalDateText template={t['conceptMission.noActionRetentionWaitingBodyWithDate']} iso={new Date(onCurrentDecision.nextEligibleAt).toISOString()} locale={locale} />
            : t['conceptMission.noActionRetentionWaitingBody']}
        </p>
      ) : (
        <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>{journeyReason(concept.journey, t)}</p>
      )}
    </div>
  );
}

export default async function SubjectPathPage({ params }: { params: Promise<{ subjectId: string }> }) {
  const { subjectId } = await params;
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

  const subjectResult = await query(`SELECT id, name FROM subjects WHERE id = $1 AND student_id = $2`, [subjectId, studentId]);
  const subject = subjectResult.rows[0];
  if (!subject) notFound();

  const requestStartedAtMs = Date.now();
  logMyPath('MY_PATH_REQUEST_STARTED', { subjectId });

  const context = await loadMyPathContext(studentId, locale);
  let subjectView: Awaited<ReturnType<typeof buildSubjectPathView>> | null = null;
  let unresolved = context.snapshotReadFailed;
  try {
    subjectView = await buildSubjectPathView(context, subjectId, subject.name);
  } catch (err) {
    unresolved = true;
    console.error('[my-path] subject path build failed:', err instanceof Error ? err.message : String(err));
  }

  logMyPath('MY_PATH_READY', { subjectId, latencyMs: Date.now() - requestStartedAtMs });

  const allConcepts = subjectView ? [...subjectView.topics.flatMap((tp) => tp.concepts), ...subjectView.unassigned] : [];
  const currentDecision = context.snapshot?.decisions.find((d) => d.actionConceptId === subjectView?.currentConceptId) ?? null;
  // UX-2 (waiting/gating consistency): the current concept's Start button
  // honors the SAME authoritative gates Today/My Path apply -- the
  // canonical launch when the gate is on; with the gate off, the legacy
  // retention-waiting rule My Path already uses (isRetentionWaiting on
  // this concept's journey + batched memory signal).
  const currentConcept = allConcepts.find((c) => c.conceptId === subjectView?.currentConceptId) ?? null;
  const currentView: NextChallengeView | null =
    currentDecision && currentConcept
      ? await loadConceptNextChallenge({
          studentId,
          subjectId,
          conceptId: currentDecision.actionConceptId,
          legacyDecision: currentDecision,
          snapshot: context.snapshot,
          legacyGate: {
            waiting:
              !currentConcept.journey.intervention &&
              isRetentionWaiting(currentConcept.journey.currentStage, context.memorySignals.get(currentDecision.actionConceptId)?.retentionDue),
            nextEligibleAt: context.memorySignals.get(currentDecision.actionConceptId)?.nextReviewAt ?? null,
            zeroGapBlocked: false,
          },
        }).catch(() => null)
      : null;
  const fullyConsolidated = !!subjectView && subjectView.summary.totalConcepts > 0 && subjectView.summary.consolidatedCount === subjectView.summary.totalConcepts;

  if (subjectView?.currentConceptId) {
    const current = allConcepts.find((c) => c.conceptId === subjectView!.currentConceptId);
    logMyPath('MY_PATH_CURRENT_POSITION_RENDERED', { subjectId, conceptId: current?.conceptId, currentStage: current?.journey.currentStage });
  } else if (unresolved) {
    logMyPath('MY_PATH_UNRESOLVED', { subjectId });
    logMyPath('MY_PATH_FAILED', { subjectId });
  }

  return (
    <div>
      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 6, display: 'flex', gap: 6 }}>
        <Link href="/dashboard/path" style={{ color: 'var(--text-muted)' }}>{t['myPath.title']}</Link> / {localizeSubjectName(subject.name, locale)}
      </div>
      <h1 style={{ marginBottom: 'var(--space-6)' }}>{localizeSubjectName(subject.name, locale)}</h1>

      {unresolved && (
        <div className="card empty-state">
          <strong>{t['myPath.unresolvedTitle']}</strong>
          {t['myPath.unresolvedBody']}
          <div style={{ marginTop: 'var(--space-4)', display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <a href={`/dashboard/path/${subjectId}`} className="btn btn-primary">{t['myPath.unresolvedRetry']}</a>
            <Link href="/dashboard/today" className="btn btn-ghost">{t['myPath.unresolvedGoToToday']}</Link>
          </div>
        </div>
      )}

      {!unresolved && subjectView && (
        <>
          {fullyConsolidated && (
            <div className="card" style={{ marginBottom: 'var(--space-6)', padding: 'var(--space-5)' }}>
              <strong>{t['myPath.subjectUpToDateTitle']}</strong>
              <p style={{ margin: '6px 0 0', color: 'var(--text-secondary)', fontSize: 14 }}>{t['myPath.subjectUpToDateBody']}</p>
            </div>
          )}

          {allConcepts.length === 0 ? (
            <div className="card empty-state">
              <strong>{t['myPath.startTitle']}</strong>
              {t['myPath.startBody']}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
              {subjectView.topics.map((topic) => {
                const hasCurrent = topic.concepts.some((c) => c.isCurrent);
                return (
                  <details key={topic.topicId} open={hasCurrent || subjectView!.topics.length === 1}>
                    <summary style={{ fontSize: 15, fontWeight: 650, cursor: 'pointer', padding: '4px 0' }}>{topic.title}</summary>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', marginTop: 'var(--space-3)' }}>
                      {topic.concepts.map((c) => (
                        <ConceptRow
                          key={c.conceptId}
                          concept={c}
                          subjectId={subjectId}
                          studentId={studentId}
                          t={t}
                          locale={locale}
                          onCurrentDecision={c.isCurrent ? currentView : null}
                        />
                      ))}
                    </div>
                  </details>
                );
              })}
              {subjectView.unassigned.length > 0 && (
                <details open={subjectView.unassigned.some((c) => c.isCurrent)}>
                  <summary style={{ fontSize: 15, fontWeight: 650, cursor: 'pointer', padding: '4px 0' }}>{t['hierarchy.unassigned']}</summary>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', marginTop: 'var(--space-3)' }}>
                    {subjectView.unassigned.map((c) => (
                      <ConceptRow
                        key={c.conceptId}
                        concept={c}
                        subjectId={subjectId}
                        studentId={studentId}
                        t={t}
                        locale={locale}
                        onCurrentDecision={c.isCurrent ? currentView : null}
                      />
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
