'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getMessages, Locale } from '@/lib/i18n/messages';
import { ConceptExplanationPanel, ConceptExplanationData } from './ConceptExplanationPanel';
import type { MasteryState } from '@/services/knowledge-state.service';
import type { LearnerJourneyStage } from '@/lib/lx/concept-journey';
import { deriveJourneyProgress } from '@/lib/lx/journey-progress';

function masteryFillClass(score: number) {
  if (score >= 75) return 'fill-good';
  if (score >= 50) return 'fill-warn';
  return 'fill-critical';
}

interface ConceptRow {
  conceptId: string;
  label: string;
  /**
   * LX-9R1: the canonical LX-1B journey stage for this concept -- the
   * ONLY input driving the row's percentage/label now (via
   * `deriveJourneyProgress`). Replaces the old raw `masteryScore`
   * (0-100 `mastery_score` percent), which could show a near-zero
   * number for a concept whose canonical journey had already advanced
   * to RETAIN/TRANSFER -- exactly the live-QA-reported bug this repairs.
   */
  journeyStage: LearnerJourneyStage;
  /** Kept for potential future secondary analytics -- no longer rendered directly on this row (R6: the row's label must agree with the journey stage, not a different axis). */
  masteryState: MasteryState | null;
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
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
              {/* LX-9R1: percentage AND label now come from the SAME
                  canonical journey-progress projection (never a raw
                  mastery-score bar paired with a different axis's
                  qualifier text) -- the fix for the live "2% /
                  Aprendiendo at RETAIN" report. */}
              {(() => {
                const progress = deriveJourneyProgress(c.journeyStage);
                return (
                  <>
                    <div className="mastery-row" title={t['subjectDetail.journeyProgressLabel']} aria-label={t['subjectDetail.journeyProgressLabel']}>
                      <div className="mastery-bar">
                        <span className={masteryFillClass(progress.progressPercent)} style={{ width: `${progress.progressPercent}%` }} />
                      </div>
                      <span className="mastery-pct tabular">{progress.progressPercent}%</span>
                    </div>
                    <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{t[progress.progressLabelKey]}</span>
                  </>
                );
              })()}
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
            {/*
              RELEASE-R1 PART A/C: this used to be a bare
              `/dashboard/quiz?subjectId=...&conceptId=...` link with NO
              mode -- quiz/page.tsx's own `modeParam` fallback then
              defaulted an unspecified mode to 'topic_practice'
              UNCONDITIONALLY, for every concept row, regardless of
              canonical actionState. This is the EXACT proven root cause
              of the live ZERO_GAP_PRACTICE_MISMATCH incident (a concept
              whose canonical evidence gap was already 0 still offered
              this button). Routed to Concept Mission instead -- the ONE
              place a canonical, actionState-gated CTA for this concept
              already exists (StartSessionButton, buildNow()) -- never a
              second, ungated launch path duplicating that logic here.
            */}
            <Link href={`/dashboard/subjects/${subjectId}/concepts/${c.conceptId}`} className="btn btn-ghost">
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
              conceptId={c.conceptId}
              studentId={studentId}
            />
          )}
        </div>
      ))}
    </div>
  );
}
