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

interface ConceptRecalibration {
  conceptId: string;
  label: string;
  previousMastery: number;
  newMastery: number;
  delta: number;
  debtResolved: boolean;
}

interface ExamResultOutcome {
  percentage: number;
  predictedReadiness: number | null;
  readinessDelta: number | null;
  recalibrated: ConceptRecalibration[];
}

interface ExamResultHistoryItem {
  id: string;
  scheduledDate: string;
  percentage: number;
  score: number;
  maxScore: number;
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
  const [history, setHistory] = useState<ExamResultHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [dateInput, setDateInput] = useState('');
  const [recurrenceOption, setRecurrenceOption] = useState<'none' | 'weekly' | 'biweekly' | 'monthly' | 'custom'>('none');
  const [customDays, setCustomDays] = useState('14');
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const [recordingResult, setRecordingResult] = useState(false);
  const [scoreInput, setScoreInput] = useState('');
  const [maxScoreInput, setMaxScoreInput] = useState('100');
  const [submittingResult, setSubmittingResult] = useState(false);
  const [lastOutcome, setLastOutcome] = useState<ExamResultOutcome | null>(null);

  const labelFor = (conceptId: string) =>
    concepts.find((c) => c.conceptId === conceptId)?.label || conceptId;

  async function load() {
    setLoading(true);
    try {
      const [upcomingRes, historyRes] = await Promise.all([
        fetch(`/api/assessments/upcoming?studentId=${studentId}&subjectId=${subjectId}`),
        fetch(`/api/assessments/results?studentId=${studentId}&subjectId=${subjectId}`),
      ]);
      const upcomingBody = await upcomingRes.json();
      const historyBody = await historyRes.json();

      const occ = upcomingBody.data?.occurrence || null;
      setOccurrence(occ);
      setHistory(historyBody.data?.results || []);
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

  function recurrenceParams(): { occurrencePattern?: string; intervalDays?: number } {
    switch (recurrenceOption) {
      case 'weekly':
        return { occurrencePattern: 'Weekly', intervalDays: 7 };
      case 'biweekly':
        return { occurrencePattern: 'Biweekly', intervalDays: 14 };
      case 'monthly':
        return { occurrencePattern: 'Monthly', intervalDays: 30 };
      case 'custom': {
        const days = Math.max(1, Number(customDays) || 0);
        return { occurrencePattern: `Custom (${days}d)`, intervalDays: days };
      }
      default:
        return {};
    }
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
            ...recurrenceParams(),
          }),
        });
      }
      setEditing(false);
      setDateInput('');
      setRecurrenceOption('none');
      setSelectedTopics([]);
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function submitResult() {
    if (!occurrence || !scoreInput || !maxScoreInput) return;
    setSubmittingResult(true);
    try {
      const res = await fetch('/api/assessments/record-result', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId,
          occurrenceId: occurrence.id,
          score: Number(scoreInput),
          maxScore: Number(maxScoreInput),
        }),
      });
      const body = await res.json();
      if (body.data) {
        setLastOutcome(body.data);
      }
      setRecordingResult(false);
      setScoreInput('');
      setMaxScoreInput('100');
      await load();
    } finally {
      setSubmittingResult(false);
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginTop: 'var(--space-3)', flexWrap: 'wrap' }}>
              <label className="label" style={{ color: 'var(--text-muted)' }}>{t['exam.recurrenceLabel']}</label>
              <select
                value={recurrenceOption}
                onChange={(e) => setRecurrenceOption(e.target.value as typeof recurrenceOption)}
                style={{
                  height: 34, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)',
                  padding: '0 var(--space-3)', fontFamily: 'inherit', fontSize: 13.5, background: 'var(--bg-base)',
                }}
              >
                <option value="none">{t['exam.recurrenceNone']}</option>
                <option value="weekly">{t['exam.recurrenceWeekly']}</option>
                <option value="biweekly">{t['exam.recurrenceBiweekly']}</option>
                <option value="monthly">{t['exam.recurrenceMonthly']}</option>
                <option value="custom">{t['exam.recurrenceCustom']}</option>
              </select>
              {recurrenceOption === 'custom' && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 13.5, color: 'var(--text-secondary)' }}>
                  {t['exam.recurrenceCustomDaysLabel'].split('___')[0]}
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={customDays}
                    onChange={(e) => setCustomDays(e.target.value)}
                    style={{
                      width: 60, height: 34, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)',
                      padding: '0 8px', fontFamily: 'inherit', fontSize: 13.5,
                    }}
                  />
                  {t['exam.recurrenceCustomDaysLabel'].split('___')[1]}
                </span>
              )}
            </div>
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

          {occurrence.daysUntil <= 0 && (
            <div style={{ marginTop: 'var(--space-4)', paddingTop: 'var(--space-3)', borderTop: '1px solid var(--border-default)' }}>
              {recordingResult ? (
                <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13.5, color: 'var(--text-secondary)' }}>{t['exam.scoreLabel']}</span>
                  <input
                    type="number"
                    min={0}
                    value={scoreInput}
                    onChange={(e) => setScoreInput(e.target.value)}
                    style={{ width: 70, height: 34, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)', padding: '0 8px', fontSize: 14 }}
                  />
                  <span style={{ fontSize: 13.5, color: 'var(--text-secondary)' }}>{t['exam.outOfLabel']}</span>
                  <input
                    type="number"
                    min={1}
                    value={maxScoreInput}
                    onChange={(e) => setMaxScoreInput(e.target.value)}
                    style={{ width: 70, height: 34, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)', padding: '0 8px', fontSize: 14 }}
                  />
                  <button
                    className="btn btn-primary"
                    disabled={!scoreInput || !maxScoreInput || submittingResult}
                    onClick={submitResult}
                  >
                    {t['exam.submitResult']}
                  </button>
                  <button className="btn btn-ghost" onClick={() => setRecordingResult(false)}>
                    {t['exam.cancel']}
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-3)' }}>
                  <p style={{ color: 'var(--text-secondary)', fontSize: 13.5, margin: 0 }}>{t['exam.recordResultPrompt']}</p>
                  <button className="btn btn-secondary" style={{ whiteSpace: 'nowrap' }} onClick={() => setRecordingResult(true)}>
                    {t['exam.recordResult']}
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <p style={{ color: 'var(--text-muted)', fontSize: 13.5, marginTop: 'var(--space-3)' }}>
          {t['exam.noneScheduled']}
        </p>
      )}

      {lastOutcome && (
        <div style={{ marginTop: 'var(--space-4)', paddingTop: 'var(--space-4)', borderTop: '1px solid var(--border-default)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
            <strong style={{ fontSize: 14 }}>{t['exam.resultSaved']}</strong>
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-6)', marginBottom: 'var(--space-3)' }}>
            {lastOutcome.predictedReadiness !== null && (
              <div>
                <div className="label" style={{ color: 'var(--text-muted)' }}>{t['exam.predicted']}</div>
                <div className="tabular" style={{ fontWeight: 600, fontSize: 15 }}>{Math.round(lastOutcome.predictedReadiness)}%</div>
              </div>
            )}
            <div>
              <div className="label" style={{ color: 'var(--text-muted)' }}>{t['exam.actual']}</div>
              <div className="tabular" style={{ fontWeight: 600, fontSize: 15 }}>{lastOutcome.percentage}%</div>
            </div>
          </div>
          {lastOutcome.recalibrated.length > 0 && (
            <>
              <p className="label" style={{ color: 'var(--text-muted)', margin: '0 0 6px' }}>{t['exam.recalibrated']}</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {lastOutcome.recalibrated.map((c) => (
                  <div key={c.conceptId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
                    <span>{c.label}</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="tabular" style={{ color: 'var(--text-muted)' }}>
                        {Math.round(c.previousMastery)}% → {Math.round(c.newMastery)}%
                      </span>
                      {c.debtResolved && (
                        <span style={{
                          fontSize: 11, fontWeight: 600, color: 'var(--success)', background: 'var(--success-subtle)',
                          borderRadius: 'var(--radius-full)', padding: '2px 8px',
                        }}>
                          {t['exam.debtResolvedBadge']}
                        </span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {history.length > 0 && (
        <div style={{ marginTop: 'var(--space-4)', paddingTop: 'var(--space-4)', borderTop: '1px solid var(--border-default)' }}>
          <p className="label" style={{ color: 'var(--text-muted)', margin: '0 0 8px' }}>{t['exam.history']}</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {history.map((h) => (
              <div key={h.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span style={{ color: 'var(--text-secondary)' }}>{h.scheduledDate}</span>
                <span className="tabular" style={{ fontWeight: 600 }}>
                  {h.score}/{h.maxScore} · {h.percentage}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
