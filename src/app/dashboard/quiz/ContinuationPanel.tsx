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
  type LearningActivityKind,
  type ContinuationResolution,
} from '@/lib/lx/continuation';

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

  // R9 / LX-5O: move focus to the checkpoint headline when it appears.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  async function onContinue() {
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch('/api/learning/continue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId, conceptId, subjectId, from }),
      });
      const body = await res.json();
      const c: ContinuationResolution | undefined = body?.data?.continuation;
      if (c?.status === 'LAUNCH' && c.launchTarget) {
        router.push(c.launchTarget);
        return;
      }
      // RETURN_TO_MISSION (any reason) -> the Concept Mission.
      router.push(conceptMissionPath({ subjectId, conceptId }));
    } catch {
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
