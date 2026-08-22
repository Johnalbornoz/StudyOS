'use client';

import { useState } from 'react';
import Link from 'next/link';
import { getMessages, Locale } from '@/lib/i18n/messages';
import { ConceptExplanationPanel, ConceptExplanationData } from '@/app/dashboard/subjects/[id]/ConceptExplanationPanel';

interface ErrorPattern {
  errorType: string;
  count: number;
  subjectId: string;
  subjectName: string;
  topConceptId: string;
  topConceptLabel: string;
  topConceptCount: number;
  lastOccurredAt: string;
}

export default function ErrorPatternList({
  studentId,
  locale,
  patterns,
}: {
  studentId: string;
  locale: Locale;
  patterns: ErrorPattern[];
}) {
  const t = getMessages(locale);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [guidance, setGuidance] = useState<Record<string, ConceptExplanationData>>({});
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  function keyOf(p: ErrorPattern) {
    return `${p.subjectId}-${p.errorType}`;
  }

  async function toggle(p: ErrorPattern) {
    const key = keyOf(p);
    if (expandedKey === key) {
      setExpandedKey(null);
      return;
    }
    setExpandedKey(key);
    if (guidance[key]) return;

    setLoadingKey(key);
    setErrorKey(null);
    try {
      const params = new URLSearchParams({
        studentId,
        subjectId: p.subjectId,
        errorType: p.errorType,
        topConceptId: p.topConceptId,
        topConceptLabel: p.topConceptLabel,
        occurrences: String(p.count),
        language: locale,
      });
      const res = await fetch(`/api/learning-debt/error-guidance?${params.toString()}`);
      const body = await res.json();
      if (res.ok) {
        setGuidance((prev) => ({ ...prev, [key]: body.data.guidance }));
      } else {
        setErrorKey(key);
      }
    } catch {
      setErrorKey(key);
    } finally {
      setLoadingKey(null);
    }
  }

  return (
    <div className="card list-card">
      {patterns.map((p) => {
        const key = keyOf(p);
        const expanded = expandedKey === key;
        return (
          <div key={key}>
            <div className="list-row">
              <span style={{ width: 9, height: 9, borderRadius: '50%', flexShrink: 0, background: 'var(--brand)' }} />
              <div className="row-main">
                <div className="row-title">
                  {t[`errorType.${p.errorType}` as keyof typeof t] || p.errorType} · {p.subjectName}
                </div>
                <div className="row-sub">
                  {p.count} {t['debt.errorOccurrences']}
                  {p.topConceptLabel && ` · ${t['debt.errorTopConcept']} "${p.topConceptLabel}"`}
                </div>
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ height: 32, fontSize: 13, flexShrink: 0 }}
                onClick={() => toggle(p)}
              >
                {expanded ? t['debt.hideGuidance'] : t['debt.understandPattern']}
              </button>
            </div>

            {expanded && (
              <div style={{ padding: '0 var(--space-4) var(--space-4)' }}>
                <ConceptExplanationPanel
                  locale={locale}
                  loading={loadingKey === key}
                  error={errorKey === key}
                  data={guidance[key]}
                  headerLabel={t['debt.guidanceLabel']}
                />
                {guidance[key] && p.topConceptId && (
                  <div style={{ marginTop: 'var(--space-3)', textAlign: 'right' }}>
                    <Link
                      href={`/dashboard/quiz?subjectId=${p.subjectId}&conceptId=${p.topConceptId}`}
                      className="btn btn-ghost"
                      style={{ fontSize: 13 }}
                    >
                      {t['debt.practiceOptional']}
                    </Link>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
