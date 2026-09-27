/**
 * LEARNING_ACTIVITY_DELIVERY -- DB-backed background generation queue
 * (table generation_jobs).
 *
 *  - dedup: at most one open (PENDING/RUNNING) job per dedup key;
 *  - concurrency: jobs are claimed with FOR UPDATE SKIP LOCKED, so parallel
 *    workers never take the same job;
 *  - bounded retries: exponential backoff, FAILED after max_attempts;
 *  - stale leases: a RUNNING job whose worker died is reclaimed after
 *    JOB_LEASE_MS;
 *  - observability: one structured line per state change.
 *
 * Workers run off the learner's request (Next.js `after()` -> Vercel
 * waitUntil, and the protected worker endpoint), never on a hot path.
 */
import { randomUUID } from 'crypto';
import { db } from '@/lib/db';

export type GenerationJobKind = 'BANK_REPLENISH' | 'PREPARE_INVENTORY';

export interface GenerationJob<P = Record<string, unknown>> {
  id: string;
  kind: GenerationJobKind;
  dedupKey: string;
  payload: P;
  attempts: number;
  maxAttempts: number;
}

export const JOB_LEASE_MS = 10 * 60 * 1000;
export const JOB_BACKOFF_BASE_MS = 20_000;

function log(event: string, fields: Record<string, unknown>) {
  try {
    console.log('[generation-queue]', JSON.stringify({ event, ...fields }));
  } catch {
    /* never break the caller */
  }
}

/** Queues a job unless an equivalent one is already open. Returns true when a new job was created. */
export async function enqueueGenerationJob(kind: GenerationJobKind, dedupKey: string, payload: Record<string, unknown>, opts: { delayMs?: number; maxAttempts?: number } = {}): Promise<boolean> {
  const r = await db.query(
    `INSERT INTO generation_jobs (kind, dedup_key, payload, max_attempts, run_after)
     VALUES ($1, $2, $3, $4, now() + ($5 || ' milliseconds')::interval)
     ON CONFLICT (dedup_key) WHERE status IN ('PENDING', 'RUNNING') DO NOTHING
     RETURNING id`,
    [kind, dedupKey, JSON.stringify(payload), opts.maxAttempts ?? 3, String(opts.delayMs ?? 0)],
  );
  const created = r.rows.length > 0;
  log(created ? 'enqueued' : 'deduplicated', { kind, dedupKey });
  return created;
}

/** Claims up to `limit` due jobs for this worker (SKIP LOCKED), reclaiming stale leases. */
export async function claimGenerationJobs(limit: number, workerId: string, onlyStudentId?: string): Promise<GenerationJob[]> {
  const r = await db.query(
    `UPDATE generation_jobs j
        SET status = 'RUNNING', locked_at = now(), locked_by = $2, attempts = j.attempts + 1, updated_at = now()
      WHERE j.id IN (
        SELECT id FROM generation_jobs
         WHERE ((status = 'PENDING' AND run_after <= now())
            OR (status = 'RUNNING' AND locked_at < now() - ($3 || ' milliseconds')::interval))
           AND ($4::text IS NULL OR payload->>'studentId' = $4::text)
         ORDER BY run_after, created_at
         LIMIT $1
         FOR UPDATE SKIP LOCKED
      )
      RETURNING j.id, j.kind, j.dedup_key, j.payload, j.attempts, j.max_attempts`,
    [limit, workerId, String(JOB_LEASE_MS), onlyStudentId ?? null],
  );
  return r.rows.map((row) => ({ id: row.id, kind: row.kind, dedupKey: row.dedup_key, payload: row.payload, attempts: row.attempts, maxAttempts: row.max_attempts }));
}

export async function completeGenerationJob(job: GenerationJob, result: Record<string, unknown>): Promise<void> {
  await db.query(`UPDATE generation_jobs SET status = 'SUCCEEDED', result = $2, locked_at = NULL, updated_at = now() WHERE id = $1`, [job.id, JSON.stringify(result)]);
  log('succeeded', { kind: job.kind, dedupKey: job.dedupKey, attempts: job.attempts, ...result });
}

/** Retries with exponential backoff until max_attempts, then FAILED. `payload` may narrow what remains to do (per-candidate retry). */
export async function failGenerationJob(job: GenerationJob, error: string, remainingPayload?: Record<string, unknown>): Promise<'RETRY' | 'FAILED'> {
  const final = job.attempts >= job.maxAttempts;
  const backoff = JOB_BACKOFF_BASE_MS * 2 ** Math.max(0, job.attempts - 1);
  await db.query(
    `UPDATE generation_jobs
        SET status = $2, last_error = $3, locked_at = NULL, updated_at = now(),
            run_after = now() + ($4 || ' milliseconds')::interval,
            payload = COALESCE($5::jsonb, payload)
      WHERE id = $1`,
    [job.id, final ? 'FAILED' : 'PENDING', error.slice(0, 500), String(backoff), remainingPayload ? JSON.stringify(remainingPayload) : null],
  );
  log(final ? 'failed' : 'retry_scheduled', { kind: job.kind, dedupKey: job.dedupKey, attempts: job.attempts, error: error.slice(0, 200) });
  return final ? 'FAILED' : 'RETRY';
}

export type JobHandler = (job: GenerationJob) => Promise<{ ok: true; result: Record<string, unknown> } | { ok: false; error: string; remainingPayload?: Record<string, unknown> }>;

/**
 * Processes due jobs until none remain, `maxJobs` were handled, or the
 * deadline is near. Runs up to `concurrency` jobs in parallel.
 */
export async function runGenerationWorker(
  handlers: Record<GenerationJobKind, JobHandler>,
  /** `onlyStudentId`: process only this learner's jobs (operations / benchmark isolation). */
  opts: { maxJobs?: number; concurrency?: number; deadlineMs?: number; onlyStudentId?: string } = {},
): Promise<{ processed: number; succeeded: number; retried: number; failed: number }> {
  const workerId = `worker-${randomUUID().slice(0, 8)}`;
  const deadline = Date.now() + (opts.deadlineMs ?? 240_000);
  const maxJobs = opts.maxJobs ?? 20;
  const concurrency = opts.concurrency ?? 3;
  const stats = { processed: 0, succeeded: 0, retried: 0, failed: 0 };
  while (stats.processed < maxJobs && Date.now() < deadline) {
    const jobs = await claimGenerationJobs(Math.min(concurrency, maxJobs - stats.processed), workerId, opts.onlyStudentId);
    if (jobs.length === 0) break;
    await Promise.all(
      jobs.map(async (job) => {
        stats.processed++;
        try {
          const outcome = await handlers[job.kind](job);
          if (outcome.ok) {
            await completeGenerationJob(job, outcome.result);
            stats.succeeded++;
          } else {
            (await failGenerationJob(job, outcome.error, outcome.remainingPayload)) === 'FAILED' ? stats.failed++ : stats.retried++;
          }
        } catch (error) {
          (await failGenerationJob(job, error instanceof Error ? error.message : String(error))) === 'FAILED' ? stats.failed++ : stats.retried++;
        }
      }),
    );
  }
  log('worker_run', { workerId, ...stats });
  return stats;
}
