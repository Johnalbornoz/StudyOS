'use client';

import 'katex/dist/katex.min.css';
import { Locale, getMessages } from '@/lib/i18n/messages';
import InteractiveFormulaWidget from './InteractiveFormulaWidget';
import { InteractiveFormula } from '@/services/interactive-formula.service';

export interface ConceptExplanationData {
  summary: string;
  sections: { heading: string; body: string }[];
  examples: string[];
  interactiveFormula?: InteractiveFormula;
}

export function ConceptExplanationPanel({
  locale,
  loading,
  error,
  data,
  headerLabel,
}: {
  locale: Locale;
  loading: boolean;
  error: boolean;
  data?: ConceptExplanationData;
  headerLabel?: string;
}) {
  const t = getMessages(locale);

  return (
    <div
      style={{
        marginTop: 6,
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-default)',
        borderLeft: '3px solid var(--brand)',
        background: 'var(--bg-base)',
        boxShadow: 'var(--shadow-sm)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '11px 20px',
          background: 'var(--brand-subtle)',
          borderBottom: '1px solid var(--border-default)',
        }}
      >
        <span aria-hidden style={{ fontSize: 14 }}>✨</span>
        <span
          style={{
            fontSize: 12,
            fontWeight: 650,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            color: 'var(--brand-ink)',
          }}
        >
          {headerLabel || t['subjectDetail.aiExplanationLabel']}
        </span>
      </div>

      <div style={{ padding: '20px 24px 24px' }}>
        {loading ? (
          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-muted)', fontStyle: 'italic' }}>
            {t['subjectDetail.learnMoreLoading']}
          </p>
        ) : error || !data ? (
          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--error)' }}>{t['subjectDetail.learnMoreError']}</p>
        ) : (
          <>
            <p
              style={{
                margin: '0 0 20px',
                fontSize: 16.5,
                lineHeight: 1.55,
                fontWeight: 550,
                color: 'var(--text-primary)',
                textWrap: 'balance' as any,
              }}
            >
              {data.summary}
            </p>

            {data.interactiveFormula && (
              <InteractiveFormulaWidget locale={locale} data={data.interactiveFormula} />
            )}

            {data.sections.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: data.interactiveFormula ? 20 : 0 }}>
                {data.sections.map((s, i) => (
                  <div key={i}>
                    <h5
                      style={{
                        margin: '0 0 4px',
                        fontSize: 13.5,
                        fontWeight: 650,
                        color: 'var(--brand-ink)',
                      }}
                    >
                      {s.heading}
                    </h5>
                    <p style={{ margin: 0, fontSize: 14, lineHeight: 1.7, color: 'var(--text-secondary)' }}>
                      {s.body}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {data.examples.length > 0 && (
              <div
                style={{
                  marginTop: 20,
                  padding: '14px 16px',
                  background: 'var(--bg-subtle)',
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                <p className="label" style={{ color: 'var(--text-muted)', margin: '0 0 8px' }}>
                  {t['subjectDetail.aiExplanationExamplesLabel']}
                </p>
                <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {data.examples.map((ex, i) => (
                    <li key={i} style={{ fontSize: 13.5, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
                      {ex}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
