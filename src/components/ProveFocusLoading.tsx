'use client';

/**
 * CANON-R6-PERF-R2 Part 15-27 -- a dedicated, focused waiting experience
 * for canonical Prove generation, replacing the generic "generating..."
 * spinner for `canonical_prove` ONLY. Deliberately calm, academic, and
 * non-gamified -- "your assessment is being prepared," never "the
 * website is stuck." Every principle below maps directly to a spec
 * part:
 *
 * - Part 18/17: NO fake progress. This client has no real backend-step
 *   signal for the live `generate-and-take` request it's waiting on
 *   (a single POST, not a polled multi-stage job) -- so the
 *   "preparation sequence" is a neutral, indeterminate, looping
 *   animation, never fake checkmarks/percentages/countdowns.
 * - Part 21: 0-800ms renders nothing (avoids a loading flash for a
 *   cache HIT, which should feel instant); 800ms-2s shows a minimal,
 *   single-line indicator; >2s shows the full focused experience.
 * - Part 19: curated, static (never AI-generated), localized
 *   (ACTIVITY_LANGUAGE, via the caller's own `at` translator) micro-
 *   reminders, rotated slowly, never trivia/game content.
 * - Part 20/26: subtle motion (a pulsing three-dot sequence), respects
 *   `prefers-reduced-motion`, `aria-live="polite"` on the text that
 *   actually changes (the rotating reminder) -- the decorative dots are
 *   `aria-hidden` so screen readers are never spammed per animation frame.
 */
import { useEffect, useState } from 'react';

const REMINDER_KEYS = [
  'quiz.proveFocusTip1',
  'quiz.proveFocusTip2',
  'quiz.proveFocusTip3',
  'quiz.proveFocusTip4',
] as const;

const REMINDER_ROTATE_MS = 6000;
const MINIMAL_THRESHOLD_MS = 800;
const FULL_THRESHOLD_MS = 2000;

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mql.matches);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);
  return reduced;
}

export interface ProveFocusLoadingProps {
  /** ACTIVITY_LANGUAGE-scoped translator (Part 27 -- never GLOBAL_INTERFACE_LANGUAGE for this copy). */
  at: Record<string, string>;
  /** The frozen canonical Prove contract's own item count -- static policy, not fetched (10 today). */
  itemCount?: number;
  /** The frozen canonical Prove contract's own difficulty range display -- static policy, not fetched. */
  difficultyLabel?: string;
}

export default function ProveFocusLoading({ at, itemCount = 10, difficultyLabel = '3-4' }: ProveFocusLoadingProps) {
  const [stage, setStage] = useState<'instant' | 'minimal' | 'full'>('instant');
  const [reminderIndex, setReminderIndex] = useState(0);
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    const minimalTimer = setTimeout(() => setStage((s) => (s === 'instant' ? 'minimal' : s)), MINIMAL_THRESHOLD_MS);
    const fullTimer = setTimeout(() => setStage('full'), FULL_THRESHOLD_MS);
    return () => {
      clearTimeout(minimalTimer);
      clearTimeout(fullTimer);
    };
  }, []);

  useEffect(() => {
    if (stage !== 'full') return;
    const interval = setInterval(() => {
      setReminderIndex((i) => (i + 1) % REMINDER_KEYS.length);
    }, REMINDER_ROTATE_MS);
    return () => clearInterval(interval);
  }, [stage]);

  // Part 21: 0-800ms -- render nothing, so a fast cache-hit response
  // never causes a loading flash.
  if (stage === 'instant') return null;

  if (stage === 'minimal') {
    return (
      <div className="card empty-state" role="status" aria-live="polite" style={{ padding: 'var(--space-6)' }}>
        <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 14 }}>{at['quiz.provePreparingTitle']}</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 480, margin: '0 auto' }}>
      <div className="card" style={{ padding: 'var(--space-8)', textAlign: 'center' }}>
        <p className="label" style={{ color: 'var(--brand-ink)', marginBottom: 6 }}>{at['quiz.provePreparingTitle']}</p>
        <p style={{ color: 'var(--text-secondary)', fontSize: 14, margin: '0 0 var(--space-5)' }}>
          {(at['quiz.provePreparingSubtitle'] || '').replace('{count}', String(itemCount))}
        </p>

        <div
          style={{ display: 'flex', justifyContent: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 'var(--space-6)' }}
          aria-hidden="true"
        >
          <span className="chip">{(at['quiz.provePreparingContractCount'] || '').replace('{count}', String(itemCount))}</span>
          <span className="chip">{at['quiz.provePreparingContractIndependent']}</span>
          <span className="chip">{(at['quiz.provePreparingContractDifficulty'] || '').replace('{range}', difficultyLabel)}</span>
          <span className="chip">{at['quiz.provePreparingContractNoHints']}</span>
        </div>

        {/* Part 18 -- indeterminate only: a subtle pulsing dot sequence,
            never a percentage/countdown/fake stage-completion. Decorative
            -- aria-hidden so it is never announced per animation frame. */}
        <div aria-hidden="true" style={{ display: 'flex', justifyContent: 'center', gap: 10, marginBottom: 'var(--space-5)' }}>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: 'var(--brand)',
                opacity: reducedMotion ? 0.6 : undefined,
                animation: reducedMotion ? undefined : `prove-focus-pulse 1.4s ease-in-out ${i * 0.2}s infinite`,
              }}
            />
          ))}
        </div>

        <p
          role="status"
          aria-live="polite"
          style={{
            fontSize: 13,
            color: 'var(--text-muted)',
            minHeight: 36,
            margin: 0,
            transition: reducedMotion ? undefined : 'opacity 0.4s ease',
          }}
        >
          {at[REMINDER_KEYS[reminderIndex]]}
        </p>
      </div>
      {!reducedMotion && (
        <style>{`
          @keyframes prove-focus-pulse {
            0%, 100% { transform: scale(0.85); opacity: 0.5; }
            50% { transform: scale(1.15); opacity: 1; }
          }
        `}</style>
      )}
    </div>
  );
}
