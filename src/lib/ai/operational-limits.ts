import { AIExecutionError } from './errors';
import { db } from '../db';

type Env = Record<string, string | undefined>;

/**
 * F0-S / RR-01 / RR-10 -- global AI call-volume containment.
 *
 * NOT a copy of the pre-existing, never-committed `operational-limits.ts`
 * from a parallel, uncommitted branch (that version integrated at the
 * adapter layer against a raw request-body object, and enforced a
 * request-byte-size ceiling + a model allowlist together with volume).
 * This baseline's shared AI execution boundary is `executeAI` in
 * `./gateway.ts`, which never sees a raw request body -- only
 * `{capability, provider, model, call}` -- so this module deliberately
 * covers ONLY what that boundary can actually observe: per-minute and
 * per-day call VOLUME, uniform across every provider/capability. It
 * does not attempt to reproduce the old per-request byte-size cap
 * (there is no request body at this boundary to measure) or an output-
 * token ceiling (`maxTokens` is already bounded per call site inside
 * each adapter's own caller, see LX-4P-PERF-R1G "canonical budget" --
 * duplicating that check here would be a second, divergent budget
 * authority, which is exactly what this package must not introduce).
 * See F0S_SECURITY_CONTAINMENT_REPORT.md for the residual-scope note.
 *
 * WHAT IS LIMITED: the number of AI provider calls made through
 * `executeAI`, globally across every student and every Vercel/Render
 * instance sharing this database (Postgres is the single source of
 * truth for the counter -- no per-instance in-memory state, so this is
 * correct under Fluid Compute/serverless horizontal scaling without
 * needing Redis or any new infrastructure).
 *
 * SCOPE: global, not per-user. A single student cannot be singled out
 * and throttled by this mechanism -- it protects the platform's
 * aggregate spend/abuse exposure, not per-student fairness. Per-user
 * quotas are a distinct, future concern (see residual risk register).
 *
 * WINDOW: two independent fixed windows, a UTC calendar day and a
 * wall-clock minute (not a sliding window) -- identical semantics to
 * the historical design. A window boundary allows a burst on both
 * sides of the transition; this is a known, accepted limitation of a
 * fixed-window counter, not a bug.
 *
 * FAILURE BEHAVIOR: fails CLOSED. Any error reserving a call slot --
 * including the `ai_global_limits` table not existing yet because its
 * migration has not been applied to the current database -- blocks the
 * AI call rather than silently allowing it. This is a deliberate
 * consequence of INV-08 (technical failures fail closed), not an
 * oversight: it means AI features will return a controlled
 * `RATE_LIMIT`/`CONFIGURATION_ERROR` (never a raw 500, never a silent
 * unlimited pass-through) in ANY environment where
 * `20260918_0000_ai_global_limits.sql` has not yet been applied via the
 * governed `npm run db:migrate` runner. See
 * F0S_PREVIEW_CERTIFICATION.md for whether that migration was applied
 * to the Preview database used for this package's certification.
 *
 * DISTRIBUTED VS. LOCAL: this is already "distributed-safe" in the
 * sense that matters for this architecture (every serverless instance
 * reads/writes the same Postgres row, atomically, via a single
 * conditional UPDATE -- two concurrent instances racing to reserve the
 * last slot in a window cannot both succeed). It is NOT a general-
 * purpose distributed rate limiter (no per-region/per-edge-node
 * awareness, no sub-row-lock-level concurrency tuning) -- for the
 * traffic volumes this platform has today, a single hot row is a
 * reasonable, zero-new-infrastructure baseline. A dedicated
 * distributed limiter (Redis/queue-based) is explicitly deferred to
 * F14/scale, per this package's own instructions.
 *
 * PREVIEW BEHAVIOR: identical code path to Production -- there is no
 * environment-conditional bypass (that would violate INV-09, "no
 * compatibility fallback may silently bypass"). Preview's limits are
 * configured via the SAME env vars, scoped to the Preview environment
 * in Vercel, independent of Production's values.
 *
 * FUTURE PRODUCTION LIMITATION: this package does NOT set or change
 * any Production environment variable. `AI_MAX_CALLS_PER_MINUTE`/
 * `AI_MAX_CALLS_PER_DAY` default to conservative values (see below) if
 * unset, so Production's current (already-live, unlimited) behavior is
 * unaffected until: (1) this branch is deployed there, AND (2) the
 * migration is applied there, AND (3) someone deliberately reviews and
 * sets these two variables for Production's real expected volume --
 * none of which this package performs.
 */

function positiveInt(env: Env, name: string, fallback: number, ceiling: number): number {
  const value = env[name];
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(parsed) || parsed < 1 || parsed > ceiling) {
    throw new AIExecutionError('CONFIGURATION_ERROR', `Invalid operational setting: ${name}`);
  }
  return parsed;
}

export interface AIVolumeLimits {
  perMinute: number;
  perDay: number;
}

/** Conservative, safe-by-default ceilings -- unset env vars never mean "unlimited." */
export function aiVolumeLimits(env: Env = process.env): AIVolumeLimits {
  return {
    perMinute: positiveInt(env, 'AI_MAX_CALLS_PER_MINUTE', 60, 100_000),
    perDay: positiveInt(env, 'AI_MAX_CALLS_PER_DAY', 5_000, 10_000_000),
  };
}

/**
 * One conditional UPDATE serializes concurrent reservations on the
 * single counter row (`id = true` is the table's only possible key --
 * see the migration). A failed/aborted AI call still consumes its
 * reservation; this counts attempted load, not billed success, and
 * deliberately never refunds a reservation for a call whose true
 * provider-side outcome is uncertain (matches the transactional
 * discipline already established for evidence idempotency elsewhere
 * in this codebase).
 */
const RESERVE_AI_CALL_SQL = `
  UPDATE public.ai_global_limits SET
    day_calls = CASE WHEN day_start = date_trunc('day', statement_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' THEN day_calls + 1 ELSE 1 END,
    minute_calls = CASE WHEN minute_start = date_trunc('minute', statement_timestamp()) THEN minute_calls + 1 ELSE 1 END,
    day_start = date_trunc('day', statement_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',
    minute_start = date_trunc('minute', statement_timestamp())
  WHERE id = true
    AND (day_start <> date_trunc('day', statement_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' OR day_calls < $1)
    AND (minute_start <> date_trunc('minute', statement_timestamp()) OR minute_calls < $2)
  RETURNING id`;

/**
 * Reserves one slot for an about-to-happen AI provider call. Called
 * once per `executeAI` invocation, before the provider is ever
 * contacted, so a request that would exceed the global volume ceiling
 * never reaches (or bills) the provider. Throws `AIExecutionError`
 * (`RATE_LIMIT` when the ceiling is genuinely reached,
 * `CONFIGURATION_ERROR` for any other failure including a missing
 * table) -- never resolves silently on failure.
 */
export async function reserveAICall(): Promise<void> {
  const limits = aiVolumeLimits();
  try {
    const result = await db.query(RESERVE_AI_CALL_SQL, [limits.perDay, limits.perMinute]);
    if (result.rowCount !== 1) {
      throw new AIExecutionError('RATE_LIMIT', 'Global AI execution volume limit reached');
    }
  } catch (error) {
    if (error instanceof AIExecutionError) throw error;
    throw new AIExecutionError('CONFIGURATION_ERROR', 'Global AI limiter unavailable; request blocked');
  }
}
