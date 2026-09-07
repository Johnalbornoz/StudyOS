import { auth } from '@clerk/nextjs/server';
import Link from 'next/link';
import { getOrCreateStudentId } from '@/lib/auth';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { getMessages } from '@/lib/i18n/messages';
import { getRemediationSessionView } from '@/lib/remediation-session-view';
import ContinuationPanel from '@/app/dashboard/quiz/ContinuationPanel';
import FocusOriginBeacon from '@/app/dashboard/FocusOriginBeacon';
import {
  remediationStepLabel,
  remediationStepDescription,
  remediationStepCta,
  remediationStepStatusLabel,
  remediationSupportLevelCopy,
  remediationPatternWhy,
  remediationPromisesWorkedExample,
  remediationStepIsIndependent,
} from '@/lib/remediation-presentation-labels';

/**
 * STUDYUS PHASE 6L -- LEARNING EXPERIENCE ACTIVATION
 * Step 6L-B1: the Remediation Session Shell. Presentation + navigation
 * ONLY -- this component renders whatever getRemediationSessionView
 * (the one server-side read boundary) already decided; it never
 * itself picks a pattern, a step, a support level, or an
 * independence moment. See that file's own header comment for the
 * full read-boundary contract.
 */
export default async function RemediationSessionPage({
  params,
}: {
  params: Promise<{ pathId: string }>;
}) {
  const { pathId } = await params;
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

  const view = await getRemediationSessionView(studentId, pathId, locale);

  // Cold/missing/terminal path state (Section 21): fail safe, never
  // fabricate a new path -- a neutral message plus a way back to
  // Today is always available.
  if (view.status === 'NOT_FOUND') {
    return (
      <div className="card empty-state">
        <strong>{t['remediation.notFoundTitle']}</strong>
        {t['remediation.notFoundBody']}
        <div style={{ marginTop: 'var(--space-4)' }}>
          <Link href="/dashboard/today" className="btn btn-primary">
            {t['remediation.backToToday']}
          </Link>
        </div>
      </div>
    );
  }

  if (view.status === 'TERMINAL') {
    // LX-5F: REINFORCE is an overlay on a journey -- when the repair is
    // done, carry the learner back into that journey via the canonical
    // continuation resolver (re-reads Phase 4 -- the engine may now want
    // something other than the original activity), not to a generic
    // Today page.
    return (
      <div className="card empty-state">
        {view.conceptId && view.subjectId && (
          <FocusOriginBeacon subjectId={view.subjectId} conceptId={view.conceptId} />
        )}
        <strong>{t['remediation.completedTitle']}</strong>
        {t['remediation.completedBody']}
        {view.conceptId && view.subjectId ? (
          <div style={{ marginTop: 'var(--space-4)', textAlign: 'left', maxWidth: 420, marginInline: 'auto' }}>
            <ContinuationPanel
              studentId={studentId}
              subjectId={view.subjectId}
              conceptId={view.conceptId}
              locale={locale}
              from="REINFORCE"
              variant="inline"
            />
          </div>
        ) : (
          <div style={{ marginTop: 'var(--space-4)' }}>
            <Link href="/dashboard/today" className="btn btn-primary">
              {t['remediation.backToToday']}
            </Link>
          </div>
        )}
      </div>
    );
  }

  const isIndependentStep = remediationStepIsIndependent(view.currentStepType);
  const promisesWorkedExample = remediationPromisesWorkedExample(view.supportLevel);

  return (
    <div style={{ maxWidth: 640 }}>
      {/* LX-5R Issue 2: this route is keyed by pathId, so its URL does not
          carry the concept -- publish a path-scoped Focus Mode origin the
          shell trusts only while the learner is on THIS path. */}
      <FocusOriginBeacon subjectId={view.subjectId} conceptId={view.conceptId} />

      {/* Session header */}
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <p className="label" style={{ color: 'var(--text-muted)', margin: '0 0 4px' }}>{view.conceptLabel}</p>
        <h1>{t['remediation.headerTitle']}</h1>
        <p style={{ color: 'var(--text-secondary)', margin: '8px 0 0', fontSize: 15, maxWidth: '58ch' }}>
          {t['remediation.headerSubtitle']}
        </p>
      </div>

      {/* Why */}
      <div className="card" style={{ marginBottom: 'var(--space-6)', display: 'flex', gap: 'var(--space-4)', alignItems: 'flex-start' }}>
        <div aria-hidden style={{ fontSize: 20, lineHeight: 1 }}>💡</div>
        <div>
          {/* Visual-review fix (6L-B1 visual pass): was a plain styled div --
              promoted to a real heading so a screen-reader user navigating
              by headings actually lands on "why", not just "journey". The
              `.label` class supplies the same visual style either way. */}
          <h2 className="label" style={{ color: 'var(--text-muted)', marginBottom: 4, fontSize: 13 }}>{t['remediation.whyTitle']}</h2>
          <p style={{ margin: 0, fontSize: 14.5 }}>{remediationPatternWhy(view.pattern, t)}</p>
          {view.hasMisconceptionContext && (
            <p style={{ margin: '8px 0 0', fontSize: 13.5, color: 'var(--text-muted)' }}>{t['remediation.misconceptionHint']}</p>
          )}
        </div>
      </div>

      {/* Journey / progress */}
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <h2 style={{ margin: '0 0 var(--space-3)', fontSize: 16 }}>{t['remediation.journeyTitle']}</h2>
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {view.steps.map((step, i) => {
            const isActive = i === view.activeStepIndex;
            const isCompleted = step.status === 'completed';
            return (
              <li
                key={`${step.stepType}-${i}`}
                style={{
                  display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-3) var(--space-4)',
                  borderRadius: 'var(--radius-md)',
                  background: isActive ? 'var(--brand-subtle)' : 'transparent',
                  border: `1px solid ${isActive ? 'var(--brand)' : 'var(--border-default)'}`,
                }}
              >
                <span
                  aria-hidden
                  style={{
                    flexShrink: 0, width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center',
                    justifyContent: 'center', fontSize: 12, fontWeight: 700,
                    background: isCompleted ? 'var(--success)' : isActive ? 'var(--brand)' : 'var(--text-muted)',
                    color: '#fff',
                  }}
                >
                  {isCompleted ? '✓' : i + 1}
                </span>
                <span style={{ flex: 1, fontWeight: isActive ? 650 : 500, fontSize: 14 }}>
                  {remediationStepLabel(step.stepType, t)}
                </span>
                {/* Text label, never color alone, so status is understandable
                    without relying on the badge's background hue. */}
                <span
                  className="tabular"
                  style={{
                    fontSize: 11, fontWeight: 650, textTransform: 'uppercase', letterSpacing: '0.02em',
                    color: isActive ? 'var(--brand-ink)' : 'var(--text-muted)',
                  }}
                >
                  {remediationStepStatusLabel(step.status, t)}
                </span>
              </li>
            );
          })}
        </ol>
      </div>

      {/* Current step card */}
      <div className="card" style={{ marginBottom: 'var(--space-6)', borderColor: 'var(--brand)', borderWidth: 2 }}>
        {/* Visual-review fix (6L-B1 visual pass): promoted to a real
            heading, same reasoning as the "why" title above -- a
            screen-reader user navigating by headings should land on
            "current step" too, not just h1/journey. */}
        <h2 className="label" style={{ color: 'var(--brand-ink)', marginBottom: 4, fontSize: 13 }}>{t['remediation.currentStepTitle']}</h2>
        <div style={{ fontSize: 17, fontWeight: 650 }}>{remediationStepLabel(view.currentStepType, t)}</div>
        <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: '6px 0 0' }}>
          {remediationStepDescription(view.currentStepType, t)}
        </p>

        {/* Visual-review fix: supportLevel + workedExample now read as one
            grouped "what kind of help you'll get" statement (tighter
            gap, stronger text-secondary color) instead of two more
            same-weight gray lines indistinguishable from the fade note
            below -- reduces the "wall of muted text" the current-step
            card had before. No copy changed, only spacing/color. */}
        {(view.supportLevel || promisesWorkedExample) && (
          <div style={{ marginTop: 14 }}>
            {view.supportLevel && (
              <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', margin: 0, fontWeight: 550 }}>
                {remediationSupportLevelCopy(view.supportLevel, t)}
              </p>
            )}
            {promisesWorkedExample && (
              <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '3px 0 0' }}>{t['remediation.workedExampleNote']}</p>
            )}
          </div>
        )}

        {isIndependentStep ? (
          <div
            style={{
              marginTop: 'var(--space-4)', padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius-md)',
              background: 'var(--warning-subtle)', border: '1px solid var(--warning)',
            }}
          >
            <div style={{ fontSize: 13.5, fontWeight: 650, color: 'var(--warning)' }}>{t['remediation.independentTitle']}</div>
            <p style={{ fontSize: 13, margin: '4px 0 0', color: 'var(--text-secondary)' }}>{t['remediation.independentNote']}</p>
          </div>
        ) : (
          <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '16px 0 0' }}>{t['remediation.supportFadeNote']}</p>
        )}

        <div style={{ marginTop: 'var(--space-5)' }}>
          <Link
            href={view.activityHref}
            className="btn btn-primary"
            aria-label={`${remediationStepCta(view.currentStepType, t)}: ${remediationStepLabel(view.currentStepType, t)}`}
          >
            {remediationStepCta(view.currentStepType, t)}
          </Link>
        </div>
      </div>
    </div>
  );
}
