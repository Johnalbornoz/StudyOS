'use client';

import { useEffect, useState } from 'react';
import { getMessages, Locale } from '@/lib/i18n/messages';

interface Occurrence {
  id: string;
  scheduledDate: string;
  daysUntil: number;
  status: string;
  isRecurring: boolean;
  topics: string[];
}

interface ConceptOption {
  conceptId: string;
  label: string;
  masteryScore: number;
}

export default function AssessmentPanel({
  subjectId,
  studentId,
  locale,
  concepts,
}: {
  subjectId: string;
  studentId: string;
  locale: Locale;
  concepts: ConceptOption[];
}) {
  const t = getMessages(locale);
  const [occurrence, setOccurrence] = useState<Occurrence | null>(null);
  const [readiness, setReadiness] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [dateInput, setDateInput] = useState('');
  const [recurring, setRecurring] = useState(false);
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const labelFor = (conceptId: string) =>
    concepts.find((c) => c.conceptId === conceptId)?.label || conceptId;

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

  function toggleTopic(conceptId: string) {
    setSelectedTopics((prev) =>
      prev.includes(conceptId) ? prev.filter((id) => id !== conceptId) : [...prev, conceptId]
    );
  }

  async function save() {
    if (!dateInput) return;
    setSaving(true);
    try {
      if (occurrence) {
        await fetch('/api/assessments/reschedule', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            studentId,
            occurrenceId: occurrence.id,
            scheduledDate: dateInput,
            topics: selectedTopics,
          }),
        });
      } else {
        await fetch('/api/assessments/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            studentId,
            subjectId,
            scheduledDate: dateInput,
            topics: selectedTopics,
            ...(recurring ? { occurrencePattern: 'Weekly', intervalDays: 7 } : {}),
          }),
        });
      }
      setEditing(false);
      setDateInput('');
      setRecurring(false);
      setSelectedTopics([]);
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
              setSelectedTopics(occurrence?.topics || []);
              setEditing(true);
            }}
          >
            {occurrence ? t['exam.reschedule'] : t['exam.schedule']}
          </button>
        )}
      </div>

      {editing ? (
        <div style={{ marginTop: 'var(--space-4)' }}>
          <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
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

          {!occurrence && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginTop: 'var(--space-3)', fontSize: 13.5, color: 'var(--text-secondary)' }}>
              <input type="checkbox" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} />
              {t['exam.recurring']}
            </label>
          )}

          {concepts.length > 0 && (
            <div style={{ marginTop: 'var(--space-4)', paddingTop: 'var(--space-4)', borderTop: '1px solid var(--border-default)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="label" style={{ color: 'var(--text-muted)' }}>{t['exam.topicsTitle']}</span>
                <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ height: 28, padding: '0 10px', fontSize: 12.5 }}
                    onClick={() => setSelectedTopics(concepts.map((c) => c.conceptId))}
                  >
                    {t['exam.topicsSelectAll']}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ height: 28, padding: '0 10px', fontSize: 12.5 }}
                    onClick={() => setSelectedTopics([])}
                  >
                    {t['exam.topicsSelectNone']}
                  </button>
                </div>
              </div>
              <p style={{ color: 'var(--text-muted)', fontSize: 12.5, margin: '6px 0 10px' }}>
                {t['exam.topicsHint']}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', maxHeight: 220, overflowY: 'auto' }}>
                {concepts.map((c) => (
                  <label key={c.conceptId} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 13.5 }}>
                    <input
                      type="checkbox"
                      checked={selectedTopics.includes(c.conceptId)}
                      onChange={() => toggleTopic(c.conceptId)}
                    />
                    <span style={{ flex: 1 }}>{c.label}</span>
                    <span className="tabular" style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                      {Math.round(c.masteryScore)}%
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : occurrence ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-6)', marginTop: 'var(--space-3)' }}>
            <div>
              <div className="label" style={{ color: 'var(--text-muted)' }}>{t['exam.dateLabel']}</div>
              <div style={{ fontWeight: 600, fontSize: 15, display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                {occurrence.scheduledDate}
                {occurrence.isRecurring && (
                  <span style={{
                    fontSize: 11, fontWeight: 600, color: 'var(--brand-ink)', background: 'var(--brand-subtle)',
                    borderRadius: 'var(--radius-full)', padding: '2px 8px',
                  }}>
                    {t['exam.recurringBadge']}
                  </span>
                )}
              </div>
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

          <div style={{ marginTop: 'var(--space-4)', paddingTop: 'var(--space-3)', borderTop: '1px solid var(--border-default)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="label" style={{ color: 'var(--text-muted)' }}>{t['exam.topicsTitle']}</span>
              {concepts.length > 0 && (
                <button
                  className="btn btn-ghost"
                  style={{ height: 28, padding: '0 10px', fontSize: 12.5 }}
                  onClick={() => {
                    setDateInput(occurrence.scheduledDate);
                    setSelectedTopics(occurrence.topics || []);
                    setEditing(true);
                  }}
                >
                  {t['exam.editTopics']}
                </button>
              )}
            </div>
            {occurrence.topics && occurrence.topics.length > 0 ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
                {occurrence.topics.map((topicId) => (
                  <span key={topicId} style={{
                    fontSize: 12.5, background: 'var(--bg-subtle)', border: '1px solid var(--border-default)',
                    borderRadius: 'var(--radius-full)', padding: '3px 10px',
                  }}>
                    {labelFor(topicId)}
                  </span>
                ))}
              </div>
            ) : (
              <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 'var(--space-2)' }}>
                {t['exam.topicsNone']}
              </p>
            )}
          </div>
        </>
      ) : (
        <p style={{ color: 'var(--text-muted)', fontSize: 13.5, marginTop: 'var(--space-3)' }}>
          {t['exam.noneScheduled']}
        </p>
      )}
    </div>
  );
}
