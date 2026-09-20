'use client';

/**
 * F15 Workstream A -- the item-by-item exam-taking experience
 * IVG-F14-01 deferred. Fetches/generates one item at a time via the
 * new `/api/simulation/attempts/[id]/next-item` adapter
 * (item-resolution.service.ts) and submits through the SAME route --
 * grading remains 100% delegated to the real, unmodified F9
 * `recordSimulationItemResponse`. Reuses the exact same answer
 * controls/encoding as the Assignment Practice runner
 * (`QuestionAnswerFields`/`encodeClientAnswer`).
 *
 * Platform-vs-learner distinction (task's own explicit requirement):
 * an `ITEM_UNAVAILABLE` result is rendered as a distinct, honest
 * "the platform could not prepare this part yet" state with a Skip
 * action -- never presented as a wrong answer, never silently
 * fabricated as a question, never allowed to block the exam forever.
 */
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { QuestionAnswerFields, type ClientQuestionForInput } from '@/components/quiz/QuestionAnswerFields';
import { encodeClientAnswer } from '@/lib/quiz/client-answer-encoding';

interface ClientQuestion extends ClientQuestionForInput {
  type: string;
  question: string;
}

export interface ItemRunnerLabels {
  loading: string;
  loadError: string;
  submit: string;
  submitting: string;
  submitError: string;
  progress: string;
  itemUnavailable: string;
  itemUnavailableReason: Record<string, string>;
  skip: string;
  skipping: string;
  complete: string;
  completeBody: string;
  finalize: string;
  finalizing: string;
  finalizeError: string;
  lastFeedback: string;
}

type Phase = 'loading' | 'ready' | 'submitting' | 'unavailable' | 'skipping' | 'complete' | 'finalizing' | 'finalized' | 'error';

export function ItemRunner({ attemptId, labels }: { attemptId: string; labels: ItemRunnerLabels }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('loading');
  const [targetIndex, setTargetIndex] = useState(0);
  const [totalTargets, setTotalTargets] = useState(0);
  const [question, setQuestion] = useState<ClientQuestion | null>(null);
  const [unavailableReason, setUnavailableReason] = useState<string | null>(null);
  const [staged, setStaged] = useState<unknown>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [lastFeedback, setLastFeedback] = useState<string | null>(null);

  const loadNextItem = useCallback(async () => {
    setPhase('loading');
    setError(null);
    try {
      const res = await fetch(`/api/simulation/attempts/${attemptId}/next-item`);
      const body = await res.json();
      if (!res.ok) {
        setError(body?.message || labels.loadError);
        setPhase('error');
        return;
      }
      const data = body.data;
      setTotalTargets(data.totalTargets ?? 0);
      if (data.outcome === 'COMPLETE') {
        setPhase('complete');
        return;
      }
      if (data.outcome === 'ITEM_UNAVAILABLE') {
        setTargetIndex(data.targetIndex);
        setUnavailableReason(data.reason);
        setPhase('unavailable');
        return;
      }
      setTargetIndex(data.targetIndex);
      setQuestion(data.question);
      setStaged(undefined);
      setPhase('ready');
    } catch {
      setError(labels.loadError);
      setPhase('error');
    }
  }, [attemptId, labels.loadError]);

  useEffect(() => {
    loadNextItem();
  }, [loadNextItem]);

  async function onSubmit() {
    if (!question) return;
    setPhase('submitting');
    setError(null);
    try {
      const answer = encodeClientAnswer(question, staged);
      const idempotencyKey = crypto.randomUUID();
      const res = await fetch(`/api/simulation/attempts/${attemptId}/next-item`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'submit', studentAnswer: answer, idempotencyKey }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body?.message || labels.submitError);
        setPhase('ready');
        return;
      }
      setLastFeedback(body.data.evaluation.feedback);
      if (body.data.done) {
        setPhase('complete');
      } else {
        await loadNextItem();
      }
    } catch {
      setError(labels.submitError);
      setPhase('ready');
    }
  }

  async function onSkip() {
    setPhase('skipping');
    setError(null);
    try {
      const res = await fetch(`/api/simulation/attempts/${attemptId}/next-item`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'skip' }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body?.message || labels.submitError);
        setPhase('unavailable');
        return;
      }
      if (body.data.done) {
        setPhase('complete');
      } else {
        await loadNextItem();
      }
    } catch {
      setError(labels.submitError);
      setPhase('unavailable');
    }
  }

  async function onFinalize() {
    setPhase('finalizing');
    setError(null);
    try {
      const res = await fetch(`/api/simulation/attempts/${attemptId}/complete`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.message || labels.finalizeError);
        setPhase('complete');
        return;
      }
      setPhase('finalized');
      router.refresh();
    } catch {
      setError(labels.finalizeError);
      setPhase('complete');
    }
  }

  if (phase === 'loading') return <div className="card" style={{ padding: 'var(--space-4)' }}>{labels.loading}</div>;
  if (phase === 'error') return <div className="card" style={{ padding: 'var(--space-4)', color: 'var(--error)' }}>{error}</div>;

  if (phase === 'complete' || phase === 'finalizing' || phase === 'finalized') {
    return (
      <div className="card" style={{ padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>{labels.complete}</h2>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>{labels.completeBody}</p>
        {phase !== 'finalized' && (
          <button type="button" className="btn btn-primary" disabled={phase === 'finalizing'} onClick={onFinalize}>
            {phase === 'finalizing' ? labels.finalizing : labels.finalize}
          </button>
        )}
        {error && (
          <p role="alert" style={{ fontSize: 12.5, color: 'var(--error)' }}>
            {error}
          </p>
        )}
      </div>
    );
  }

  if (phase === 'unavailable' || phase === 'skipping') {
    return (
      <div className="card" style={{ padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          {labels.progress.replace('{n}', String(targetIndex + 1)).replace('{total}', String(totalTargets))}
        </p>
        <p>{unavailableReason ? (labels.itemUnavailableReason[unavailableReason] ?? labels.itemUnavailable) : labels.itemUnavailable}</p>
        <button type="button" className="btn" disabled={phase === 'skipping'} onClick={onSkip}>
          {phase === 'skipping' ? labels.skipping : labels.skip}
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {/* aria-live: a screen-reader user is told a new question loaded --
          question content otherwise swaps silently via client state after
          an async fetch, with no other cue (F15_ACCESSIBILITY_CERTIFICATION.md). */}
      <p aria-live="polite" style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
        {labels.progress.replace('{n}', String(targetIndex + 1)).replace('{total}', String(totalTargets))}
      </p>
      {question && (
        <div className="card" style={{ padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <div style={{ fontWeight: 600 }}>{question.question}</div>
          <QuestionAnswerFields question={question} staged={staged} onChange={setStaged} />
        </div>
      )}
      {lastFeedback && (
        <p style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
          {labels.lastFeedback}: {lastFeedback}
        </p>
      )}
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
