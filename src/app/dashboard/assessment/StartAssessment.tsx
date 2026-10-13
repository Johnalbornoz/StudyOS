'use client';

/**
 * B5-R -- the Start control of the preview. It sends the launch INTENT to the canonical start route and
 * opens the session the start authority returns (a new one, or the open one being resumed).
 * It chooses nothing: no question, no count, no session id of its own.
 */
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { InlineAlert } from '@/components/ui/InlineAlert';
import type { AssessmentLaunchRequest } from '@/lib/assessment-experience/launch';

export function StartAssessment({ request, labels, backHref }: { request: AssessmentLaunchRequest; labels: { start: string; starting: string; failed: string; retry: string; back: string; preparing?: string; failedLearning?: string; failedAssessment?: string }; backHref: string }) {
  const router = useRouter();
  const [state, setState] = useState<'IDLE' | 'STARTING' | 'FAILED'>('IDLE');
  // why the start failed, in the experience's own terms: a generation failure is retryable and is never "not enough questions"
  const [failure, setFailure] = useState<'GENERIC' | 'LEARNING' | 'ASSESSMENT'>('GENERIC');

  const start = async () => {
    setState('STARTING');
    try {
      const res = await fetch('/api/assessments/learning/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success || typeof body.data?.sessionId !== 'string') {
        setFailure(body?.reason === 'LEARNING_GENERATION_FAILED' ? 'LEARNING' : body?.reason === 'ASSESSMENT_GENERATION_INCOMPLETE' ? 'ASSESSMENT' : 'GENERIC');
        return setState('FAILED');
      }
      router.push(`/dashboard/assessment/${encodeURIComponent(body.data.sessionId)}`);
    } catch {
      setState('FAILED');
    }
  };

  return (
    <>
      {state === 'FAILED' && <InlineAlert tone="error" title={(failure === 'LEARNING' ? labels.failedLearning : failure === 'ASSESSMENT' ? labels.failedAssessment : undefined) ?? labels.failed} />}
      {state === 'STARTING' && labels.preparing && <p className="ui-hint" role="status" aria-live="polite">{labels.preparing}</p>}
      <div className="xr-next-actions">
        <button type="button" className="btn btn-primary btn-lg" onClick={start} disabled={state === 'STARTING'} aria-busy={state === 'STARTING'}>
          {state === 'STARTING' ? labels.starting : state === 'FAILED' ? labels.retry : labels.start}
        </button>
        <Link href={backHref} className="btn btn-ghost">{labels.back}</Link>
      </div>
    </>
  );
}
