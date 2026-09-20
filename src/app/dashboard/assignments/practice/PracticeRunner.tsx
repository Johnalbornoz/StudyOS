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
 *
 * F15 -- the per-format answer inputs and encoding are now shared with
 * the Exam-Taking ItemRunner (`QuestionAnswerFields`/`encodeClientAnswer`)
 * instead of a second copy.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { QuestionAnswerFields, type ClientQuestionForInput } from '@/components/quiz/QuestionAnswerFields';
import { encodeClientAnswer } from '@/lib/quiz/client-answer-encoding';

interface ClientQuestion extends ClientQuestionForInput {
  type: string;
  question: string;
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

  async function onSubmit() {
    setPhase('submitting');
    setError(null);
    try {
      const answers = questions.map((q) => ({ questionIndex: q.index, answer: encodeClientAnswer(q, staged[q.index]) }));
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
          <QuestionAnswerFields question={q} staged={staged[q.index]} onChange={(value) => setStaged((s) => ({ ...s, [q.index]: value }))} />
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
