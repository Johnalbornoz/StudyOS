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

interface HistoryItem {
  timestamp: string;
  sourceType: string;
  result: 'correct' | 'partial' | 'incorrect';
  scorePercent: number | null;
  learningMode: 'SOLO' | 'COACH' | 'AI_NATIVE' | null;
  hintsUsed: number;
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
      style={{ flexShrink: 0, color: 'var(--text-muted)', transition: 'transform 180ms ease', transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}
    >
      <path d="M5 3l6 5-6 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function sourceLabel(sourceType: string, t: ReturnType<typeof getMessages>): string {
  switch (sourceType) {
    case 'PRACTICE_QUESTION':
      return t['quiz.modeQuickCheck'];
    case 'PRACTICE_QUIZ':
      return t['quiz.modeTopicPractice'];
    case 'CUMULATIVE_ASSESSMENT':
      return t['quiz.modeCumulative'];
    case 'EXAM_SIMULATION':
      return t['quiz.modeExamSim'];
    case 'GUIDED_EXERCISE':
      return t['subjectDetail.sourceGuidedExercise'];
    case 'TOPIC_ASSESSMENT':
      return t['subjectDetail.sourceTopicAssessment'];
    case 'REAL_SCHOOL_EXAM':
      return t['subjectDetail.sourceRealExam'];
    default:
      return sourceType;
  }
}

function resultLabel(result: HistoryItem['result'], t: ReturnType<typeof getMessages>): string {
  return result === 'correct' ? t['subjectDetail.resultCorrect'] : result === 'partial' ? t['subjectDetail.resultPartial'] : t['subjectDetail.resultIncorrect'];
}

function resultColor(result: HistoryItem['result']): string {
  return result === 'correct' ? 'var(--brand)' : result === 'partial' ? 'var(--warning)' : 'var(--error)';
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
  const [historyExpandedId, setHistoryExpandedId] = useState<string | null>(null);
  const [history, setHistory] = useState<Record<string, HistoryItem[]>>({});
  const [historyLoadingId, setHistoryLoadingId] = useState<string | null>(null);
  const [historyErrorId, setHistoryErrorId] = useState<string | null>(null);

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

  async function toggleHistory(conceptId: string) {
    if (historyExpandedId === conceptId) {
      setHistoryExpandedId(null);
      return;
    }
    setHistoryExpandedId(conceptId);
    if (history[conceptId]) return;

    setHistoryLoadingId(conceptId);
    setHistoryErrorId(null);
    try {
      const res = await fetch(`/api/concepts/${conceptId}/history?studentId=${studentId}`);
      const body = await res.json();
      if (res.ok) {
        setHistory((prev) => ({ ...prev, [conceptId]: body.data.history }));
      } else {
        setHistoryErrorId(conceptId);
      }
    } catch {
      setHistoryErrorId(conceptId);
    } finally {
      setHistoryLoadingId(null);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      {items.map((c) => (
        <div key={c.conceptId}>
          <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', padding: 'var(--space-4)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '0 0 190px', minWidth: 0 }}>
              <button
                type="button"
                onClick={() => toggleHistory(c.conceptId)}
                aria-expanded={historyExpandedId === c.conceptId}
                aria-label={t['subjectDetail.historyToggle']}
                title={t['subjectDetail.historyToggle']}
                style={{ display: 'flex', background: 'none', border: 'none', cursor: 'pointer', padding: 4, margin: '-4px', flexShrink: 0 }}
              >
                <Chevron open={historyExpandedId === c.conceptId} />
              </button>
              <Link
                href={`/dashboard/subjects/${subjectId}/concepts/${c.conceptId}`}
                style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              >
                {c.label}
              </Link>
            </div>
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
          {historyExpandedId === c.conceptId && (
            <div
              style={{
                marginTop: 4, padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius-sm)',
                background: 'var(--bg-subtle)', border: '1px solid var(--border-default)',
              }}
            >
              {historyLoadingId === c.conceptId ? (
                <p style={{ fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic', margin: 0 }}>…</p>
              ) : historyErrorId === c.conceptId ? (
                <p style={{ fontSize: 13, color: 'var(--error)', margin: 0 }}>{t['common.error']}</p>
              ) : !history[c.conceptId] || history[c.conceptId].length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>{t['subjectDetail.historyEmpty']}</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {history[c.conceptId].map((h, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
                      <span className="tabular" style={{ color: 'var(--text-muted)', flexShrink: 0, width: 90 }}>
                        {new Date(h.timestamp).toLocaleDateString()}
                      </span>
                      <span style={{ flexShrink: 0, minWidth: 140 }}>{sourceLabel(h.sourceType, t)}</span>
                      <span style={{ color: resultColor(h.result), fontWeight: 600, flexShrink: 0, minWidth: 70 }}>
                        {resultLabel(h.result, t)}
                        {h.scorePercent !== null ? ` (${Math.round(h.scorePercent)}%)` : ''}
                      </span>
                      {h.learningMode && (
                        <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
                          {h.learningMode === 'SOLO' ? t['subjectDetail.modeSolo'] : h.learningMode === 'COACH' ? t['subjectDetail.modeCoach'] : h.learningMode}
                        </span>
                      )}
                      {h.hintsUsed > 0 && (
                        <span style={{ color: 'var(--text-muted)' }}>{t['subjectDetail.hintsShort'].replace('{count}', String(h.hintsUsed))}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
