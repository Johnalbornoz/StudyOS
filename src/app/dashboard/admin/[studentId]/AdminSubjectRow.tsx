'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

function masteryFillClass(score: number) {
  if (score >= 75) return 'fill-good';
  if (score >= 50) return 'fill-warn';
  return 'fill-critical';
}

export default function AdminSubjectRow({
  subjectId,
  name,
  avgMastery,
  conceptCount,
  confirmLabel,
  deleteLabel,
}: {
  subjectId: string;
  name: string;
  avgMastery: number | null;
  conceptCount: number;
  confirmLabel: string;
  deleteLabel: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function handleDelete() {
    if (!confirm(confirmLabel)) return;
    setBusy(true);
    setError(false);
    try {
      const res = await fetch(`/api/admin/subjects/${subjectId}`, { method: 'DELETE' });
      if (res.ok) {
        router.refresh();
      } else {
        setError(true);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="list-row">
      <div className="row-main">
        <div className="row-title">{name}</div>
        {error && <div className="row-sub" style={{ color: 'var(--error)' }}>Error</div>}
      </div>
      <div className="mastery-row" style={{ flex: '0 0 160px' }}>
        <div className="mastery-bar">
          <span className={masteryFillClass(avgMastery ?? 0)} style={{ width: `${avgMastery ?? 0}%` }} />
        </div>
        <span className="mastery-pct tabular">{avgMastery !== null ? `${avgMastery}%` : '—'}</span>
      </div>
      <span style={{ fontSize: 12.5, color: 'var(--text-muted)', flexShrink: 0, width: 90, textAlign: 'right' }}>
        {conceptCount}
      </span>
      <button
        type="button"
        className="btn btn-ghost"
        style={{ fontSize: 13, color: 'var(--error)', flexShrink: 0 }}
        disabled={busy}
        onClick={handleDelete}
      >
        {deleteLabel}
      </button>
    </div>
  );
}
