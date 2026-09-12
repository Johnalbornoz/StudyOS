'use client';

/**
 * LX-5 -- the continuation checkpoint.
 *
 * A brief "what just happened + one CONTINUE" that carries the learner
 * forward. CONTINUE calls `/api/learning/continue`, which re-reads
 * canonical truth and returns a launch target or "return to mission".
 * This component chooses nothing pedagogical.
 *
 * Failure ALWAYS degrades to a safe "back to the concept" -- the learner
 * is never stranded (LX-5M).
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Locale } from '@/lib/i18n/messages';
import { getMessages } from '@/lib/i18n/messages';
import {
  checkpointFor,
  conceptMissionPath,
  buildRelaunchTarget,
  newRelaunchNonce,
  isSameRoute,
  type LearningActivityKind,
  type ContinuationResolution,
} from '@/lib/lx/continuation';
import { writeLaunchTeachingHandoff } from '@/lib/lx/launch-teaching-handoff';

/** LX-5R1 R9: safe continuation diagnostics -- no learner answer/question content, ever. */
function mark(label: string, extra: Record<string, unknown>) {
  try {
    console.log('[perf]', JSON.stringify({ label, t: Math.round(performance.now()), ...extra }));
  } catch {
    /* performance/console unavailable -- diagnostics are best-effort only */
  }
}

export default function ContinuationPanel({
  studentId,
  subjectId,
  conceptId,
  locale,
  from,
  /** Optional extra one-liner shown under the body (e.g. a Prove-sufficiency note). Already localized. */
  note,
  /** 'inline' = plain block (Learn end); 'card' = bordered card (results / remediation). */
  variant = 'card',
}: {
  studentId: string;
  subjectId: string;
  conceptId: string;
  locale: Locale;
  from: LearningActivityKind;
  note?: string;
  variant?: 'inline' | 'card';
}) {
  const t = getMessages(locale);
  const router = useRouter();
  const cp = checkpointFor(from);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const headingRef = useRef<HTMLParagraphElement>(null);
  // LX-5R1 R6/R13: a navigation that "succeeds" here (router.push called
  // with no thrown error) can still fail to actually take the learner
  // anywhere -- e.g. an unforeseen same-route edge case this component
  // didn't detect. If that ever happens, this component stays mounted
  // and `busy` would otherwise spin forever. This is the backstop, not
  // the fix: cleared on unmount (the normal, expected outcome of a real
  // navigation) and never fires there.
  const stuckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // R9 / LX-5O: move focus to the checkpoint headline when it appears.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    return () => {
      if (stuckTimerRef.current) clearTimeout(stuckTimerRef.current);
    };
  }, []);

  function armStuckBackstop() {
    stuckTimerRef.current = setTimeout(() => {
      setBusy(false);
      setFailed(true);
      mark('CONTINUATION_FAILED', { conceptId, reason: 'navigation_did_not_unmount' });
    }, 4000);
  }

  async function onContinue() {
    setBusy(true);
    setFailed(false);
    mark('CONTINUATION_REQUEST_STARTED', { conceptId, from });
    try {
      const res = await fetch('/api/learning/continue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId, conceptId, subjectId, from }),
      });
      const body = await res.json();
      const c: ContinuationResolution | undefined = body?.data?.continuation;
      mark('CONTINUATION_DECISION_READY', { conceptId, activityType: (c as any)?.activityType ?? c?.status });
      if (c?.status === 'LAUNCH' && c.launchTarget) {
        // LX-4P-PERF-R1C C12: transport the server-derived Teaching
        // Experience to the launch so the quiz page does not recompute the
        // same canonical decision. Transport only -- the quiz page
        // re-validates (same concept + mode, fresh, intact) and falls back
        // to its own canonical /api/learning/teaching-intent fetch when
        // this is absent, stale, or mismatched.
        let mode: string | null = null;
        try {
          mode = new URL(c.launchTarget, window.location.origin).searchParams.get('mode');
        } catch {
          /* non-quiz / relative parse failure -- leave mode null (handoff will be ignored) */
        }
        if ('teachingExperience' in c) {
          writeLaunchTeachingHandoff({
            conceptId,
            mode,
            teachingExperience: c.teachingExperience ?? null,
            ts: Date.now(),
          });
        }
        // LX-5R1: a canonical LAUNCH may legitimately point back at the
        // exact route the learner is already on (e.g. PRACTICE ->
        // PRACTICE, same concept + mode) -- that is NOT an error and must
        // NOT be forced onto a different activity. But `router.push` of
        // an identical URL is a no-op in the App Router: nothing would
        // remount, and the learner would be stranded on the old Results
        // screen forever. Detect that case and append a fresh, one-shot
        // nonce so the navigation is genuine; the destination page uses
        // it only to key a full remount into a brand-new activity
        // instance (fresh quizId/questions/answers/results), never to
        // change what is being launched.
        const currentUrl = `${window.location.pathname}${window.location.search}`;
        const sameRoute = isSameRoute(currentUrl, c.launchTarget);
        const target = buildRelaunchTarget(currentUrl, c.launchTarget, newRelaunchNonce());
        mark(sameRoute ? 'CONTINUATION_SAME_ROUTE_RELAUNCH' : 'CONTINUATION_NAVIGATED', {
          conceptId,
          mode,
          sameRoute,
        });
        armStuckBackstop();
        router.push(target);
        return;
      }
      // RETURN_TO_MISSION (any reason) -> the Concept Mission.
      mark('CONTINUATION_NAVIGATED', { conceptId, sameRoute: false });
      armStuckBackstop();
      router.push(conceptMissionPath({ subjectId, conceptId }));
    } catch {
      mark('CONTINUATION_FAILED', { conceptId });
      setBusy(false);
      setFailed(true); // show the safe fallback button
    }
  }

  const missionHref = conceptMissionPath({ subjectId, conceptId });

  return (
    <section
      className={variant === 'card' ? 'card lx-checkpoint' : 'lx-checkpoint'}
      aria-labelledby="lx-cp-heading"
    >
      <p
        id="lx-cp-heading"
        ref={headingRef}
        tabIndex={-1}
        className="label"
        style={{ color: 'var(--brand-ink)', margin: 0 }}
      >
        {t[cp.headlineKey as keyof typeof t]}
      </p>
      <p style={{ margin: '4px 0 0', fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
        {t[cp.bodyKey as keyof typeof t]}
      </p>
      {note && (
        <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>{note}</p>
      )}

      <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-4)', flexWrap: 'wrap' }}>
        {!failed ? (
          <button type="button" className="btn btn-primary" onClick={onContinue} disabled={busy} aria-busy={busy}>
            {busy ? '…' : t[cp.continueKey as keyof typeof t]}
          </button>
        ) : (
          <a href={missionHref} className="btn btn-primary">
            {t['continuation.backToConcept']}
          </a>
        )}
        {!failed && (
          <a href={missionHref} className="btn btn-ghost">
            {t['continuation.backToConcept']}
          </a>
        )}
      </div>
      {failed && (
        <p role="alert" style={{ margin: '6px 0 0', fontSize: 12.5, color: 'var(--error)' }}>
          {t['continuation.resolveFailed']}
        </p>
      )}
    </section>
  );
}
