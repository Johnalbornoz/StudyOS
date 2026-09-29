'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { classifySessionLaunch, LICENSE_CTA_PATH } from '@/lib/lx/session-launch-outcome';

/**
 * Licence awareness: learning activities require LEARNING_FULL_ACCESS
 * (demo mode excludes AI-generated activities). The existing
 * session-eligibility endpoint is asked once per student (short-lived,
 * shared across every button on the page) so an unlicensed student sees
 * "activate a licence" instead of a CTA that cannot succeed. The server
 * remains the authority: session/start refuses with ENTITLEMENT_REQUIRED
 * either way, and that response shows the same state.
 */
const ELIGIBILITY_TTL_MS = 30_000;
const eligibilityCache = new Map<string, { at: number; entitled: Promise<boolean | null> }>();

function fetchEntitled(studentId: string): Promise<boolean | null> {
  const cached = eligibilityCache.get(studentId);
  if (cached && Date.now() - cached.at < ELIGIBILITY_TTL_MS) return cached.entitled;
  const entitled = fetch(`/api/learning/session-eligibility?studentId=${encodeURIComponent(studentId)}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((b) => (b?.data && typeof b.data.entitled === 'boolean' ? b.data.entitled : null))
    .catch(() => null);
  eligibilityCache.set(studentId, { at: Date.now(), entitled });
  return entitled;
}

/**
 * Phase 3E's single student-facing entry point into the Session Engine.
 * Never trusts a client-held LearningDecision -- only studentId +
 * actionConceptId are sent; the server re-derives the current Phase 3C
 * decision and validates ownership before returning a launch target.
 * On UNAVAILABLE this shows a neutral retry state and never silently
 * substitutes a different action -- retrying re-derives fresh from the
 * server, it does not fall back to a client-guessed URL.
 */
export default function StartSessionButton({
  studentId,
  actionConceptId,
  label,
  accessibleLabel,
  unavailableLabel,
  retryLabel,
  variant = 'primary',
  launchMark,
  licenseTitle,
  licenseBody,
  licenseCtaLabel,
  size = 'default',
  align = 'end',
}: {
  studentId: string;
  actionConceptId: string;
  label: string;
  accessibleLabel?: string;
  unavailableLabel: string;
  retryLabel: string;
  variant?: 'primary' | 'secondary';
  /**
   * LX-6 R19 -- optional safe observability label. When supplied, one
   * `[perf]` line is logged right before navigation, carrying only
   * this label + `conceptId` (never learner content, never the launch
   * URL). Callers that don't care about a specific event name (most
   * StartSessionButton uses outside Today) simply omit it -- no log,
   * no behavior change.
   */
  launchMark?: string;
  /** Localized copy for the licence-required state (demo mode). */
  licenseTitle: string;
  licenseBody: string;
  licenseCtaLabel: string;
  /** UX-2 presentation only: 'lg' renders the hero-sized primary button. */
  size?: 'default' | 'lg';
  /** UX-2 presentation only: horizontal alignment of the button and its inline error. */
  align?: 'start' | 'end';
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [licenseRequired, setLicenseRequired] = useState(false);

  useEffect(() => {
    let active = true;
    fetchEntitled(studentId).then((entitled) => {
      if (active && entitled === false) setLicenseRequired(true);
    });
    return () => {
      active = false;
    };
  }, [studentId]);

  async function start() {
    setLoading(true);
    setUnavailable(false);
    try {
      const res = await fetch('/api/learning/session/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId, actionConceptId }),
      });
      const body = await res.json().catch(() => null);
      const outcome = classifySessionLaunch(res.status, body);
      if (outcome.kind === 'LICENSE_REQUIRED') {
        setLicenseRequired(true);
        return;
      }
      if (outcome.kind === 'LAUNCH') {
        if (launchMark) {
          try {
            console.log('[perf]', JSON.stringify({ label: launchMark, t: Math.round(performance.now()), conceptId: actionConceptId }));
          } catch { /* noop */ }
        }
        router.push(outcome.target);
        return;
      }
      setUnavailable(true);
    } catch {
      setUnavailable(true);
    } finally {
      setLoading(false);
    }
  }

  if (licenseRequired) {
    return (
      <div role="note" style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 420 }}>
        <strong style={{ fontSize: 14 }}>{licenseTitle}</strong>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{licenseBody}</span>
        <Link href={LICENSE_CTA_PATH} className={variant === 'primary' ? 'btn btn-primary' : 'btn btn-secondary'} style={{ alignSelf: 'flex-start' }}>
          {licenseCtaLabel}
        </Link>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: align === 'start' ? 'flex-start' : 'flex-end', gap: 4 }}>
      <button
        type="button"
        className={`${variant === 'primary' ? 'btn btn-primary' : 'btn btn-secondary'}${size === 'lg' ? ' btn-lg' : ''}`}
        style={{ height: variant === 'primary' ? undefined : 32, fontSize: variant === 'primary' ? undefined : 13, flexShrink: 0 }}
        onClick={start}
        disabled={loading}
        aria-label={accessibleLabel ?? label}
        aria-busy={loading}
      >
        {loading ? <span aria-hidden="true">…</span> : unavailable ? retryLabel : label}
      </button>
      {unavailable && (
        <span role="alert" style={{ fontSize: 12, color: 'var(--error)' }}>
          {unavailableLabel}
        </span>
      )}
    </div>
  );
}
