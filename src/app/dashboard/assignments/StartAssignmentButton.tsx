'use client';

/**
 * F14 Workstream B -- "Start"/"Continue" action (task section 5). POSTs
 * to the real, unmodified F11-C1..C4 dispatcher
 * (`/api/student/teacher-interventions/[id]/start`), which returns the
 * SAME `executionReference` `reconcileCompletionsForStudent` later
 * checks for completion -- this component never generates its own
 * practice/exam session, only routes to the one the server already
 * created (CONCEPT/SKILL/COMPETENCY -> the Practice runner by quizId;
 * EXAM -> the Exam Prep attempt page by simulationAttempt id).
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface StartAssignmentLabels {
  start: string;
  starting: string;
  error: string;
  notExecutableYet: string;
}

export function StartAssignmentButton({
  interventionId,
  targetType,
  labels,
}: {
  interventionId: string;
  targetType: string;
  labels: StartAssignmentLabels;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onStart() {
    setBusy(true);
    setError(null);
    try {
      const idempotencyKey = crypto.randomUUID();
      const res = await fetch(`/api/student/teacher-interventions/${interventionId}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idempotencyKey }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body?.message || body?.error || labels.error);
        return;
      }
      const { outcome, executionReference } = body.data;
      if (outcome === 'NOT_EXECUTABLE_YET') {
        setError(labels.notExecutableYet);
        return;
      }
      if (targetType === 'EXAM') {
        router.push(`/dashboard/exam-prep/attempt/${executionReference}`);
      } else {
        router.push(`/dashboard/assignments/practice?quizId=${encodeURIComponent(executionReference)}`);
      }
    } catch {
      setError(labels.error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
      <button type="button" className="btn btn-primary" disabled={busy} onClick={onStart}>
        {busy ? labels.starting : labels.start}
      </button>
      {error && (
        <p role="alert" style={{ fontSize: 12.5, color: 'var(--error)', margin: 0 }}>
          {error}
        </p>
      )}
    </div>
  );
}
