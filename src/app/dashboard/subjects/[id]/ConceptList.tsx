'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getMessages, Locale } from '@/lib/i18n/messages';
import { ConceptExplanationPanel, ConceptExplanationData } from './ConceptExplanationPanel';

function masteryFillClass(score: number) {
  if (score >= 75) return 'fill-good';
  if (score >= 50) return 'fill-warn';
  return 'fill-critical';
}

interface ConceptRow {
  conceptId: string;
  label: string;
  masteryScore: number;
}

export default function ConceptList({
  subjectId,
  studentId,
  locale,
  concepts,
}: {
  subjectId: string;
  studentId: string;
  locale: Locale;
  concepts: ConceptRow[];
}) {
  const t = getMessages(locale);
  const router = useRouter();
  const [items, setItems] = useState(concepts);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorId, setErrorId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [explanations, setExplanations] = useState<Record<string, ConceptExplanationData>>({});
  const [explainLoadingId, setExplainLoadingId] = useState<string | null>(null);
  const [explainErrorId, setExplainErrorId] = useState<string | null>(null);

  async function handleDelete(conceptId: string) {
    if (!confirm(t['subjectDetail.deleteConceptConfirm'])) return;
    setBusyId(conceptId);
    setErrorId(null);
    try {
      const res = await fetch(`/api/concepts/${conceptId}?studentId=${studentId}`, { method: 'DELETE' });
      if (res.ok) {
        setItems((prev) => prev.filter((c) => c.conceptId !== conceptId));
        router.refresh();
      } else {
        setErrorId(conceptId);
      }
    } finally {
      setBusyId(null);
    }
  }

  async function handleLearnMore(conceptId: string) {
    if (expandedId === conceptId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(conceptId);
    if (explanations[conceptId]) return;

    setExplainLoadingId(conceptId);
    setExplainErrorId(null);
    try {
      const res = await fetch(`/api/concepts/${conceptId}/explanation?studentId=${studentId}&language=${locale}`);
      const body = await res.json();
      if (res.ok) {
        setExplanations((prev) => ({ ...prev, [conceptId]: body.data.explanation }));
      } else {
        setExplainErrorId(conceptId);
      }
    } catch {
      setExplainErrorId(conceptId);
    } finally {
      setExplainLoadingId(null);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      {items.map((c) => (
        <div key={c.conceptId}>
          <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', padding: 'var(--space-4)' }}>
            <Link
              href={`/dashboard/subjects/${subjectId}/concepts/${c.conceptId}`}
              title={t['subjectDetail.viewConceptDetail']}
              style={{
                flex: '0 0 190px', minWidth: 0, fontWeight: 600, fontSize: 14, color: 'var(--brand)',
                textDecoration: 'underline', textDecorationColor: 'var(--border-default)', textUnderlineOffset: 3,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}
            >
              {c.label}
            </Link>
            <div className="mastery-row" style={{ flex: 1 }}>
              <div className="mastery-bar">
                <span className={masteryFillClass(c.masteryScore)} style={{ width: `${c.masteryScore}%` }} />
              </div>
              <span className="mastery-pct tabular">{Math.round(c.masteryScore)}%</span>
            </div>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ fontSize: 13, flexShrink: 0 }}
              onClick={() => handleLearnMore(c.conceptId)}
            >
              {expandedId === c.conceptId ? t['subjectDetail.learnMoreCollapse'] : t['subjectDetail.learnMoreAction']}
            </button>
            <Link
              href={`/dashboard/quiz?subjectId=${subjectId}&conceptId=${c.conceptId}&mode=quick_check`}
              className="btn btn-ghost"
              style={{ fontSize: 13 }}
            >
              {t['quiz.modeQuickCheck']}
            </Link>
            <Link href={`/dashboard/quiz?subjectId=${subjectId}&conceptId=${c.conceptId}`} className="btn btn-ghost">
              {t['subjectDetail.practice']}
            </Link>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ fontSize: 13, color: 'var(--error)', flexShrink: 0 }}
              disabled={busyId === c.conceptId}
              onClick={() => handleDelete(c.conceptId)}
            >
              {t['common.delete']}
            </button>
          </div>
          {errorId === c.conceptId && (
            <p style={{ color: 'var(--error)', fontSize: 12.5, marginTop: 4 }}>
              {t['subjectDetail.deleteConceptHasHistory']}
            </p>
          )}
          {expandedId === c.conceptId && (
            <ConceptExplanationPanel
              locale={locale}
              loading={explainLoadingId === c.conceptId}
              error={explainErrorId === c.conceptId}
              data={explanations[c.conceptId]}
            />
          )}
        </div>
      ))}
    </div>
  );
}
