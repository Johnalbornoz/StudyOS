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

import { useId, useState } from 'react';
import type { Locale } from '@/lib/i18n/messages';
import { getMessages } from '@/lib/i18n/messages';
import MathText from '@/components/MathText';

type HelpAction = 'HINT' | 'EXAMPLE' | 'REMINDER' | 'ANOTHER_ANGLE' | 'FIRST_STEP';

const ACTION_KEY: Record<HelpAction, string> = {
  HINT: 'help.giveHint',
  EXAMPLE: 'help.showExample',
  REMINDER: 'help.remindRule',
  ANOTHER_ANGLE: 'help.explainDifferently',
  FIRST_STEP: 'help.showFirstStep',
};

interface HelpResult {
  action: HelpAction;
  hints?: string[];
  example?: string;
  reminder?: string;
  sections?: { heading: string; body: string }[];
  firstStep?: { prompt: string; expectedAnswer: string; why: string } | null;
}

export default function ContextualHelp({
  studentId,
  quizId,
  questionIndex,
  locale,
}: {
  studentId: string;
  quizId: string;
  questionIndex: number;
  locale: Locale;
}) {
  const t = getMessages(locale);
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState<HelpAction | null>(null);
  const [error, setError] = useState(false);
  const [result, setResult] = useState<HelpResult | null>(null);

  async function run(action: HelpAction) {
    setLoading(action);
    setError(false);
    setResult(null);
    try {
      const res = await fetch('/api/learning/contextual-help', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId, quizId, questionIndex, action, language: locale }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error();
      setResult(body.data as HelpResult);
    } catch {
      setError(true);
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="al-help">
      <button
        type="button"
        className="btn btn-ghost al-help-trigger"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
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
          <div className="al-help-result" aria-live="polite">
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
