'use client';

import { useMemo, useState } from 'react';
import katex from 'katex';
import { evaluate } from 'mathjs';
import { Locale, getMessages } from '@/lib/i18n/messages';
import { InteractiveFormula } from '@/services/interactive-formula.service';

function renderLatex(source: string): string {
  try {
    return katex.renderToString(source, { throwOnError: false, displayMode: true });
  } catch {
    return source;
  }
}

function formatValue(v: number, step: number): string {
  const decimals = step < 1 ? Math.min(4, (String(step).split('.')[1] || '').length) : 0;
  return v.toFixed(decimals);
}

function substituteTemplate(template: string, scope: Record<string, number>, resultText?: string): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_, expr: string) => {
    const trimmed = expr.trim();
    if (trimmed === 'result' && resultText !== undefined) return resultText;
    try {
      const value = evaluate(trimmed, scope);
      return typeof value === 'number' ? String(Math.round(value * 1000) / 1000) : String(value);
    } catch {
      return '';
    }
  });
}

export default function InteractiveFormulaWidget({
  locale,
  data,
}: {
  locale: Locale;
  data: InteractiveFormula;
}) {
  const t = getMessages(locale);
  const [values, setValues] = useState<Record<string, number>>(() =>
    Object.fromEntries(data.variables.map((v) => [v.symbol, v.default]))
  );

  const result = useMemo(() => {
    try {
      const raw = evaluate(data.resultExpression, values);
      return typeof raw === 'number' ? raw : NaN;
    } catch {
      return NaN;
    }
  }, [data.resultExpression, values]);

  const resultText = Number.isFinite(result) ? formatValue(result, 0.01) : '—';

  const formulaHtml = useMemo(() => renderLatex(data.latexTemplate), [data.latexTemplate]);
  const substitutedHtml = useMemo(
    () => renderLatex(substituteTemplate(data.latexSubstitutionTemplate, values, resultText)),
    [data.latexSubstitutionTemplate, values, resultText]
  );
  const diagramSvg = useMemo(
    () => (data.diagramSvgTemplate ? substituteTemplate(data.diagramSvgTemplate, values) : null),
    [data.diagramSvgTemplate, values]
  );

  return (
    <div
      style={{
        marginTop: 20,
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
        background: 'var(--bg-base)',
      }}
    >
      <div
        style={{
          padding: '10px 20px',
          background: 'var(--bg-subtle)',
          borderBottom: '1px solid var(--border-default)',
          fontSize: 12,
          fontWeight: 650,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          color: 'var(--text-muted)',
        }}
      >
        {t['subjectDetail.interactiveFormulaLabel']}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: diagramSvg ? '1.1fr 1fr' : '1fr',
          gap: 0,
        }}
      >
        <div style={{ padding: '20px 24px', borderRight: diagramSvg ? '1px solid var(--border-default)' : 'none' }}>
          <div
            style={{ fontSize: 18, textAlign: 'center', marginBottom: 4, color: 'var(--text-primary)' }}
            dangerouslySetInnerHTML={{ __html: formulaHtml }}
          />
          <div
            style={{ fontSize: 15, textAlign: 'center', marginBottom: 20, color: 'var(--brand-ink)', overflowX: 'auto' }}
            dangerouslySetInnerHTML={{ __html: substitutedHtml }}
          />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {data.variables.map((v) => (
              <div key={v.symbol}>
                <div
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                    fontSize: 13, marginBottom: 4,
                  }}
                >
                  <span style={{ color: 'var(--text-secondary)' }}>{v.label}</span>
                  <span className="tabular" style={{ fontWeight: 650, color: 'var(--text-primary)' }}>
                    {formatValue(values[v.symbol], v.step)} {v.unit}
                  </span>
                </div>
                <input
                  type="range"
                  min={v.min}
                  max={v.max}
                  step={v.step}
                  value={values[v.symbol]}
                  onChange={(e) =>
                    setValues((prev) => ({ ...prev, [v.symbol]: Number(e.target.value) }))
                  }
                  style={{ width: '100%', accentColor: 'var(--brand)' }}
                />
              </div>
            ))}
          </div>

          <div
            style={{
              marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border-default)',
              textAlign: 'center',
            }}
          >
            <span style={{ fontSize: 12.5, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              {data.resultSymbol}
            </span>
            <div className="tabular" style={{ fontSize: 26, fontWeight: 650, color: 'var(--brand-ink)' }}>
              {resultText} <span style={{ fontSize: 15, fontWeight: 600 }}>{data.resultUnit}</span>
            </div>
          </div>
        </div>

        {diagramSvg && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, background: 'var(--bg-subtle)' }}>
            <div style={{ width: '100%', maxWidth: 280 }} dangerouslySetInnerHTML={{ __html: diagramSvg }} />
          </div>
        )}
      </div>
    </div>
  );
}
