import { useEffect, useRef, useState } from 'react';
import type { InteractiveFormula } from '@/services/interactive-formula.service';

/**
 * LX-4P-PERF-R1D R4 -- progressive-enhancement fetch for the OPTIONAL
 * interactive-formula widget.
 *
 * This is a real independent client request (not an unawaited
 * fire-and-forget server promise). It:
 *  - fires only once `enabled` is true (i.e. after the MODEL-required
 *    content is ready), so its timing is never part of MODEL TTFI;
 *  - fetches at most once per concept+language (a ref guard makes React
 *    effect re-runs / StrictMode double-invokes idempotent);
 *  - degrades silently to `null` on any failure -- MODEL stays fully
 *    usable.
 *
 * `[perf]` marks bracket the request so ops can grep formula timing
 * separately from EXPLANATION_READY / MODEL_RENDERED.
 */
function mark(label: string, conceptId: string): void {
  try {
    // eslint-disable-next-line no-console
    console.log('[perf]', JSON.stringify({ label, t: Math.round(performance.now()), conceptId }));
  } catch {
    /* performance unavailable */
  }
}

export function useInteractiveFormula(
  conceptId: string,
  studentId: string,
  language: string,
  enabled: boolean,
): InteractiveFormula | null {
  const [formula, setFormula] = useState<InteractiveFormula | null>(null);
  const attemptedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || !conceptId || !studentId) return;
    const key = `${conceptId}@${language}`;
    if (attemptedRef.current === key) return; // never a duplicate request from effect re-runs
    attemptedRef.current = key;

    let cancelled = false;
    mark('FORMULA_WIDGET_REQUEST_STARTED', conceptId);
    fetch(`/api/concepts/${conceptId}/interactive-formula?studentId=${studentId}&language=${language}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => (b?.data?.interactiveFormula ?? null) as InteractiveFormula | null)
      .catch(() => null)
      .then((f) => {
        if (cancelled) return;
        mark('FORMULA_WIDGET_READY', conceptId);
        if (f) setFormula(f);
      });
    return () => {
      cancelled = true;
    };
  }, [conceptId, studentId, language, enabled]);

  return formula;
}
