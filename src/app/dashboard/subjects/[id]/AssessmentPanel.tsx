'use client';

import { useEffect, useState } from 'react';
import { getMessages, Locale } from '@/lib/i18n/messages';

interface Occurrence {
  id: string;
  scheduledDate: string;
  daysUntil: number;
  status: string;
}

export default function AssessmentPanel({
  subjectId,
  studentId,
  locale,
}: {
  subjectId: string;
  studentId: string;
  locale: Locale;
}) {
  const t = getMessages(locale);
  const [occurrence, setOccurrence] = useState<Occurrence | null>(null);
  const [readiness, setReadiness] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [dateInput, setDateInput] = useState('');
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/assessments/upcoming?studentId=${studentId}&subjectId=${subjectId}`);
      const body = await res.json();
      const occ = body.data?.occurrence || null;
      setOccurrence(occ);
      setReadiness(null);

      if (occ) {
        const readinessRes = await fetch(
          `/api/exam-readiness/score?studentId=${studentId}&subjectId=${subjectId}`
        );
        const readinessBody = await readinessRes.json();
        if (readinessBody.data?.hasUpcomingExam) {
          setReadiness(readinessBody.data.overall.score);
        }
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectId]);

  async function save() {
    if (!dateInput) return;
    setSaving(true);
    try {
      if (occurrence) {
        await fetch('/api/assessments/reschedule', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ studentId, occurrenceId: occurrence.id, scheduledDate: dateInput }),
        });
      } else {
        await fetch('/api/assessments/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ studentId, subjectId, scheduledDate: dateInput }),
        });
      }
      setEditing(false);
      setDateInput('');
      await load();
    } finally {
      setSaving(false);
    }
  }

  if (loading) return null;

  return (
    <div className="card" style={{ marginBottom: 'var(--space-6)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3>{t['exam.title']}</h3>
        {!editing && (
          <button
            className="btn btn-ghost"
            onClick={() => {
              setDateInput(occurrence?.scheduledDate || '');
              setEditing(true);
            }}
          >
            {occurrence ? t['exam.reschedule'] : t['exam.schedule']}
          </button>
        )}
      </div>

      {editing ? (
        <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', marginTop: 'var(--space-4)' }}>
          <label className="label" style={{ color: 'var(--text-muted)' }}>{t['exam.dateLabel']}</label>
          <input
            type="date"
            value={dateInput}
            onChange={(e) => setDateInput(e.target.value)}
            style={{
              height: 36, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)',
              padding: '0 var(--space-3)', fontFamily: 'inherit', fontSize: 14,
            }}
          />
          <button className="btn btn-primary" disabled={!dateInput || saving} onClick={save}>
            {t['exam.save']}
          </button>
          <button className="btn btn-ghost" onClick={() => setEditing(false)}>
            {t['exam.cancel']}
          </button>
        </div>
      ) : occurrence ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-6)', marginTop: 'var(--space-3)' }}>
          <div>
            <div className="label" style={{ color: 'var(--text-muted)' }}>{t['exam.dateLabel']}</div>
            <div style={{ fontWeight: 600, fontSize: 15 }}>{occurrence.scheduledDate}</div>
          </div>
          <div>
            <div className="label" style={{ color: 'var(--text-muted)' }}>&nbsp;</div>
            <div className="tabular" style={{ fontWeight: 600, fontSize: 15 }}>
              {occurrence.daysUntil} {t['exam.daysUntil']}
            </div>
          </div>
          <div>
            <div className="label" style={{ color: 'var(--text-muted)' }}>{t['exam.readiness']}</div>
            <div className="tabular" style={{ fontWeight: 600, fontSize: 15 }}>
              {readiness !== null ? `${readiness}%` : t['exam.readinessLoading']}
            </div>
          </div>
        </div>
      ) : (
        <p style={{ color: 'var(--text-muted)', fontSize: 13.5, marginTop: 'var(--space-3)' }}>
          {t['exam.noneScheduled']}
        </p>
      )}
    </div>
  );
}
