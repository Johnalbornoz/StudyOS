/**
 * LEARNING_ACTIVITY_DELIVERY -- hands queued replenishment to the worker in a
 * SEPARATE invocation. A learner-facing request (and its after()) only
 * enqueues and calls this: it never runs the AI generation pipeline in the
 * instance that serves the learner. The worker endpoint answers 202 at once
 * and drains the queue in its own invocation.
 *
 * Without the internal secret or a deployment URL (local runs, scripts) it
 * dispatches nothing: the jobs stay queued for the next dispatch or the
 * scheduled worker.
 */
export type DispatchOutcome = 'DISPATCHED' | 'UNAVAILABLE' | 'FAILED';

export const WORKER_PATH = '/api/internal/generation-worker';
const DISPATCH_TIMEOUT_MS = 10_000;

function log(event: string, fields: Record<string, unknown>) {
  try {
    console.log('[worker-dispatch]', JSON.stringify({ event, ...fields }));
  } catch {
    /* observability never breaks the caller */
  }
}

/** Where and how to reach this deployment's worker; null when it cannot be reached. */
export function workerDispatchTarget(env: Record<string, string | undefined> = process.env): { url: string; headers: Record<string, string> } | null {
  const secret = env.CRON_SECRET;
  const host = env.VERCEL_URL;
  if (!secret || !host) return null;
  const headers: Record<string, string> = { authorization: `Bearer ${secret}` };
  // this deployment is behind Deployment Protection: the automation bypass lets it call itself
  if (env.VERCEL_AUTOMATION_BYPASS_SECRET) headers['x-vercel-protection-bypass'] = env.VERCEL_AUTOMATION_BYPASS_SECRET;
  return { url: `https://${host}${WORKER_PATH}`, headers };
}

export async function dispatchDeliveryWorker(reason: string): Promise<DispatchOutcome> {
  const target = workerDispatchTarget();
  if (!target) {
    log('unavailable', { reason });
    return 'UNAVAILABLE';
  }
  try {
    const res = await fetch(target.url, { method: 'POST', headers: target.headers, signal: AbortSignal.timeout(DISPATCH_TIMEOUT_MS) });
    const accepted = res.status === 202;
    log(accepted ? 'dispatched' : 'rejected', { reason, status: res.status });
    return accepted ? 'DISPATCHED' : 'FAILED';
  } catch (error) {
    log('failed', { reason, error: error instanceof Error ? error.message : String(error) });
    return 'FAILED';
  }
}
