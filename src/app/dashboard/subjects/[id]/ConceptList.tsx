'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getMessages, Locale } from '@/lib/i18n/messages';

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      {items.map((c) => (
        <div key={c.conceptId}>
          <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', padding: 'var(--space-4)' }}>
            <span style={{ flex: '0 0 190px', fontWeight: 600, fontSize: 14 }}>{c.label}</span>
            <div className="mastery-row" style={{ flex: 1 }}>
              <div className="mastery-bar">
                <span className={masteryFillClass(c.masteryScore)} style={{ width: `${c.masteryScore}%` }} />
              </div>
              <span className="mastery-pct tabular">{Math.round(c.masteryScore)}%</span>
            </div>
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
        </div>
      ))}
    </div>
  );
}
