'use client';

/**
 * F14 Workstream B -- renders a Teacher-assigned reinforcement quiz's
 * already-generated, already-stored questions (fetched via the new
 * thin `/api/quizzes/session/[quizId]` adapter) and submits answers to
 * the real, unmodified `/api/quizzes/generate-and-take` SUBMIT branch
 * -- grading/scoring/mastery-update logic all remain there, untouched.
 * Deliberately simpler than the self-service `/dashboard/quiz` page
 * (no setup form, no hints, no teaching-stage choreography, no
 * canonical v1 launch markers) -- a reinforcement assignment's job is
 * "answer these already-chosen questions," not "configure a new
 * activity."
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';

type AnswerFormat = 'single_choice' | 'multi_choice' | 'text' | 'matching' | 'ordering' | 'classification';

interface ClientQuestion {
  index: number;
  type: string;
  answerFormat: AnswerFormat;
  question: string;
  options?: { id: string; text: string }[];
  matchingLeft?: string[];
  matchingRightShuffled?: string[];
  orderingItemsShuffled?: string[];
  classificationItems?: string[];
  classificationCategories?: string[];
}

export interface PracticeRunnerLabels {
  loading: string;
  loadError: string;
  submit: string;
  submitting: string;
  submitError: string;
  resultsTitle: string;
  score: string;
  alreadyCompleted: string;
  backToAssignments: string;
}

export function PracticeRunner({
  quizId,
  studentId,
  labels,
}: {
  quizId: string;
  studentId: string;
  labels: PracticeRunnerLabels;
}) {
  const [phase, setPhase] = useState<'loading' | 'ready' | 'submitting' | 'done' | 'error'>('loading');
  const [questions, setQuestions] = useState<ClientQuestion[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [staged, setStaged] = useState<Record<number, unknown>>({});
  const [results, setResults] = useState<{ score: number; correctCount: number; incorrectCount: number; totalQuestions: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/quizzes/session/${encodeURIComponent(quizId)}?studentId=${encodeURIComponent(studentId)}`);
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(labels.loadError);
          setPhase('error');
          return;
        }
        setQuestions(body.data.questions);
        setStatus(body.data.status);
        setPhase('ready');
      } catch {
        if (!cancelled) {
          setError(labels.loadError);
          setPhase('error');
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [quizId, studentId, labels.loadError]);

  function encodeAnswer(q: ClientQuestion): string {
    const value = staged[q.index];
    if (q.answerFormat === 'single_choice') return (value as string) || '';
    if (q.answerFormat === 'multi_choice') return Array.isArray(value) ? (value as string[]).join(',') : '';
    if (q.answerFormat === 'text') return (value as string) || '';
    if (q.answerFormat === 'matching') return JSON.stringify(value || {});
    if (q.answerFormat === 'ordering') {
      const positions = (value as Record<string, number>) || {};
      const ordered = [...(q.orderingItemsShuffled || [])].sort((a, b) => (positions[a] ?? 0) - (positions[b] ?? 0));
      return JSON.stringify(ordered);
    }
    if (q.answerFormat === 'classification') return JSON.stringify(value || {});
    return '';
  }

  async function onSubmit() {
    setPhase('submitting');
    setError(null);
    try {
      const answers = questions.map((q) => ({ questionIndex: q.index, answer: encodeAnswer(q) }));
      const res = await fetch('/api/quizzes/generate-and-take', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId, quizId, answers }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body?.message || body?.error || labels.submitError);
        setPhase('ready');
        return;
      }
      setResults(body.data.results);
      setPhase('done');
    } catch {
      setError(labels.submitError);
      setPhase('ready');
    }
  }

  if (phase === 'loading') return <div className="card" style={{ padding: 'var(--space-4)' }}>{labels.loading}</div>;
  if (phase === 'error') return <div className="card" style={{ padding: 'var(--space-4)', color: 'var(--error)' }}>{error}</div>;

  if (status && status !== 'active' && phase !== 'done') {
    return (
      <div className="card" style={{ padding: 'var(--space-4)' }}>
        <p>{labels.alreadyCompleted}</p>
        <Link href="/dashboard/assignments">{labels.backToAssignments}</Link>
      </div>
    );
  }

  if (phase === 'done' && results) {
    return (
      <div className="card" style={{ padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>{labels.resultsTitle}</h2>
        <p>
          {labels.score}: {Math.round(results.score * 100)}% ({results.correctCount}/{results.totalQuestions})
        </p>
        <Link href="/dashboard/assignments">{labels.backToAssignments}</Link>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {questions.map((q) => (
        <div key={q.index} className="card" style={{ padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <div style={{ fontWeight: 600 }}>{q.question}</div>

          {q.answerFormat === 'single_choice' && q.options && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {q.options.map((opt) => (
                <label key={opt.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
                  <input
                    type="radio"
                    name={`q-${q.index}`}
                    checked={staged[q.index] === opt.id}
                    onChange={() => setStaged((s) => ({ ...s, [q.index]: opt.id }))}
                  />
                  {opt.text}
                </label>
              ))}
            </div>
          )}

          {q.answerFormat === 'multi_choice' && q.options && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {q.options.map((opt) => {
                const selected: string[] = (staged[q.index] as string[]) || [];
                return (
                  <label key={opt.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
                    <input
                      type="checkbox"
                      checked={selected.includes(opt.id)}
                      onChange={(e) =>
                        setStaged((s) => ({
                          ...s,
                          [q.index]: e.target.checked ? [...selected, opt.id] : selected.filter((id) => id !== opt.id),
                        }))
                      }
                    />
                    {opt.text}
                  </label>
                );
              })}
            </div>
          )}

          {q.answerFormat === 'text' && (
            <textarea
              rows={4}
              value={(staged[q.index] as string) || ''}
              onChange={(e) => setStaged((s) => ({ ...s, [q.index]: e.target.value }))}
            />
          )}

          {q.answerFormat === 'matching' && q.matchingLeft && q.matchingRightShuffled && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {q.matchingLeft.map((left) => {
                const map = (staged[q.index] as Record<string, string>) || {};
                return (
                  <label key={left} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
                    {left}
                    <select value={map[left] || ''} onChange={(e) => setStaged((s) => ({ ...s, [q.index]: { ...map, [left]: e.target.value } }))}>
                      <option value="" />
                      {q.matchingRightShuffled!.map((right) => (
                        <option key={right} value={right}>
                          {right}
                        </option>
                      ))}
                    </select>
                  </label>
                );
              })}
            </div>
          )}

          {q.answerFormat === 'ordering' && q.orderingItemsShuffled && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {q.orderingItemsShuffled.map((item) => {
                const positions = (staged[q.index] as Record<string, number>) || {};
                return (
                  <label key={item} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
                    {item}
                    <select
                      value={positions[item] ?? ''}
                      onChange={(e) => setStaged((s) => ({ ...s, [q.index]: { ...positions, [item]: Number(e.target.value) } }))}
                    >
                      <option value="" />
                      {q.orderingItemsShuffled!.map((_, i) => (
                        <option key={i} value={i + 1}>
                          {i + 1}
                        </option>
                      ))}
                    </select>
                  </label>
                );
              })}
            </div>
          )}

          {q.answerFormat === 'classification' && q.classificationItems && q.classificationCategories && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {q.classificationItems.map((item) => {
                const map = (staged[q.index] as Record<string, string>) || {};
                return (
                  <label key={item} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
                    {item}
                    <select value={map[item] || ''} onChange={(e) => setStaged((s) => ({ ...s, [q.index]: { ...map, [item]: e.target.value } }))}>
                      <option value="" />
                      {q.classificationCategories!.map((cat) => (
                        <option key={cat} value={cat}>
                          {cat}
                        </option>
                      ))}
                    </select>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      ))}

      <button type="button" className="btn btn-primary" disabled={phase === 'submitting'} onClick={onSubmit}>
        {phase === 'submitting' ? labels.submitting : labels.submit}
      </button>
      {error && (
        <p role="alert" style={{ fontSize: 12.5, color: 'var(--error)' }}>
          {error}
        </p>
      )}
    </div>
  );
}
