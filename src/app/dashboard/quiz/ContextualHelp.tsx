'use client';

/**
 * LX-4R R4 -- the in-activity contextual help surface.
 *
 * Replaces the single "Hint" toggle. Every action maps to a real
 * backend behaviour and is dispatched through ONE gated endpoint
 * (`POST /api/learning/contextual-help`) -- the server denies help for
 * any non-PRACTICE evidence mode (client hiding is not the enforcement).
 * Nothing here diagnoses.
 */

import { useEffect, useId, useReducer, useRef } from 'react';
import type { Locale } from '@/lib/i18n/messages';
import { getMessages } from '@/lib/i18n/messages';
import MathText from '@/components/MathText';
import { helpReducer, helpRequestBody, initialHelpState, type HelpAction, type HelpResult, type HelpScope } from '@/lib/quiz/help-state';

const HELP_TIMEOUT_MS = 45_000;

const ACTION_KEY: Record<HelpAction, string> = {
  HINT: 'help.giveHint',
  EXAMPLE: 'help.showExample',
  REMINDER: 'help.remindRule',
  ANOTHER_ANGLE: 'help.explainDifferently',
  FIRST_STEP: 'help.showFirstStep',
};

export default function ContextualHelp({
  studentId,
  quizId,
  questionIndex,
  locale,
}: {
  studentId: string;
  quizId: string;
  questionIndex: number;
  /**
   * LX-4P-PERF-R1 R20: the activity/question language governs this whole
   * surface -- the help CONTENT and the menu chrome ("Need help?", the
   * action labels, errors). The global shell stays on interface_language.
   */
  locale: Locale;
}) {
  const t = getMessages(locale);
  const panelId = useId();
  // Help UI state is bound to quizId + questionIndex (help-state.ts): a new
  // question starts clean and a late reply for the previous one is dropped.
  // The parent also remounts this component per question (key).
  const [state, dispatch] = useReducer(helpReducer, { quizId, questionIndex }, initialHelpState);
  const { open, loading, error, result } = state;
  const requestSeq = useRef(0);
  const inFlight = useRef<AbortController | null>(null);

  useEffect(() => {
    dispatch({ type: 'SCOPE_CHANGED', scope: { quizId, questionIndex } });
    return () => {
      // leaving this question: cancel its pending help request (UI only --
      // the server's record that help was used is never undone)
      inFlight.current?.abort();
      inFlight.current = null;
    };
  }, [quizId, questionIndex]);

  async function run(action: HelpAction) {
    const scope: HelpScope = { quizId, questionIndex };
    const requestId = Math.max(state.requestId, requestSeq.current) + 1;
    requestSeq.current = requestId;
    dispatch({ type: 'REQUEST', action, requestId });
    // Loading always ends: success, error, or the client-side timeout.
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    const timer = setTimeout(() => controller.abort(), HELP_TIMEOUT_MS);
    try {
      const res = await fetch('/api/learning/contextual-help', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(helpRequestBody(scope, studentId, action, locale)),
        signal: controller.signal,
      });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error();
      const data = body.data as HelpResult;
      // Never an empty help box: a hint reply with no content shows the safe fallback.
      if (action === 'HINT' && !(data.hints && data.hints.some((h) => h.trim()))) {
        data.hints = [t['help.hintFallbackData']];
      }
      dispatch({ type: 'SUCCESS', scope, requestId, result: data });
    } catch {
      if (action === 'HINT') dispatch({ type: 'SUCCESS', scope, requestId, result: { action, hints: [t['help.hintFallbackData']] } });
      else dispatch({ type: 'FAILURE', scope, requestId });
    } finally {
      clearTimeout(timer);
      if (inFlight.current === controller) inFlight.current = null;
    }
  }

  return (
    <div className="al-help">
      <button
        type="button"
        className="btn btn-secondary al-help-trigger"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => dispatch({ type: 'TOGGLE' })}
      >
        {t['activeLearning.needHelp']}
      </button>

      <div id={panelId} hidden={!open} className="al-help-panel">
        <p className="label" style={{ color: 'var(--text-muted)', margin: '0 0 var(--space-2)' }}>{t['help.menuTitle']}</p>
        <div className="al-help-actions">
          {(Object.keys(ACTION_KEY) as HelpAction[]).map((a) => (
            <button
              key={a}
              type="button"
              className="btn btn-secondary"
              disabled={loading !== null}
              aria-busy={loading === a}
              onClick={() => run(a)}
            >
              {loading === a ? t['help.loading'] : t[ACTION_KEY[a] as keyof typeof t]}
            </button>
          ))}
        </div>

        {error && (
          <p role="alert" style={{ margin: 'var(--space-3) 0 0', fontSize: 13.5, color: 'var(--error)' }}>
            {t['help.error']}
          </p>
        )}

        {result && (
          <div className="al-help-result" aria-live="polite" data-testid="help-result" data-action={result.action}>
            {result.hints && result.hints.length > 0 && (
              <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14, lineHeight: 1.7 }}>
                {result.hints.map((h, i) => (
                  <li key={i}><MathText text={h} /></li>
                ))}
              </ul>
            )}
            {result.example && <p style={{ margin: 0, fontSize: 14, lineHeight: 1.7 }}><MathText text={result.example} /></p>}
            {result.reminder && <p style={{ margin: 0, fontSize: 14, lineHeight: 1.7 }}><MathText text={result.reminder} /></p>}
            {result.sections && result.sections.map((s, i) => (
              <div key={i} style={{ marginTop: i ? 'var(--space-3)' : 0 }}>
                <h4 style={{ margin: '0 0 2px', fontSize: 13, fontWeight: 650, color: 'var(--brand-ink)' }}>{s.heading}</h4>
                <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.7, color: 'var(--text-secondary)' }}><MathText text={s.body} /></p>
              </div>
            ))}
            {result.firstStep && (
              <div>
                <p style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 600 }}><MathText text={result.firstStep.prompt} /></p>
                <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-secondary)' }}>
                  <span className="label" style={{ color: 'var(--text-muted)' }}>{t['workedExample.why']}:</span>{' '}
                  <MathText text={result.firstStep.why} />
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
