/**
 * AI request metrics -- per-operation performance accounting for EVERY AI
 * call, so a latency regression is visible (and attributable) from one log
 * line instead of being reconstructed from dozens.
 *
 * An operation scope (AsyncLocalStorage) is opened by `withAiRequestMetrics`
 * around every API route handler that can reach the AI gateway (enforced by
 * tests/unit/ai-request-metrics.test.ts), and by `runWithAiMetrics` around
 * background AI work. Inside a scope:
 *   - the gateway (`executeAI`) records every execution (capability, model,
 *     prompt, duration, validation, fallback, error);
 *   - the provider adapter (`callModel`) records every provider round-trip
 *     (model, duration, a hash of the exact input -- never the input).
 * When the operation ends, ONE `[ai-request-summary]` line is emitted (only
 * if AI actually ran) with the stage breakdown: pre-AI time, AI wall time vs
 * summed provider time (parallelism), post-AI time, call counts by
 * capability/model, failures, fallbacks, validation failures, duplicate
 * provider inputs and peak concurrency.
 *
 * Observability only: it never changes a call, never throws into the
 * caller, and never logs prompt/response content or learner data.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';

export interface AiExecutionSample {
  capability: string;
  model: string;
  promptId: string;
  startedAtMs: number;
  durationMs: number;
  success: boolean;
  validationStatus: string;
  fallbackUsed: boolean;
  errorCode?: string;
}

export interface AiProviderCallSample {
  provider: string;
  model: string;
  startedAtMs: number;
  durationMs: number;
  ok: boolean;
  /** sha256 of provider+model+system+user, first 16 hex chars -- identifies duplicate inputs without storing them. */
  inputHash: string;
}

interface AiMetricsScope {
  operation: string;
  startedAtMs: number;
  executions: AiExecutionSample[];
  providerCalls: AiProviderCallSample[];
  stages: Record<string, number>;
  closed: boolean;
}

const storage = new AsyncLocalStorage<AiMetricsScope>();

export function hashProviderInput(parts: Array<string | undefined>): string {
  return createHash('sha256').update(parts.map((p) => p ?? '').join('\u0000')).digest('hex').slice(0, 16);
}

/** The active operation name (for correlating per-call `[ai]` lines), or null outside a scope. */
export function currentAiOperation(): string | null {
  const s = storage.getStore();
  return s && !s.closed ? s.operation : null;
}

/** AI work recorded so far in the active scope (executions + provider round-trips). 0 outside a scope. */
export function currentAiCallCount(): { executions: number; providerCalls: number } {
  const s = storage.getStore();
  return s ? { executions: s.executions.length, providerCalls: s.providerCalls.length } : { executions: 0, providerCalls: 0 };
}

export function recordAiExecution(sample: AiExecutionSample): void {
  const s = storage.getStore();
  if (s && !s.closed) s.executions.push(sample);
}

export function recordAiProviderCall(sample: AiProviderCallSample): void {
  const s = storage.getStore();
  if (s && !s.closed) s.providerCalls.push(sample);
}

/**
 * Times one provider HTTP round-trip and records it in the active scope.
 * Used by the provider adapters -- the single transport boundary every AI
 * call in the codebase goes through.
 */
export async function measureProviderCall<T>(provider: string, model: string, inputParts: Array<string | undefined>, call: () => Promise<T>): Promise<T> {
  if (!storage.getStore()) return call();
  const startedAtMs = Date.now();
  const inputHash = hashProviderInput([provider, model, ...inputParts]);
  try {
    const result = await call();
    recordAiProviderCall({ provider, model, startedAtMs, durationMs: Date.now() - startedAtMs, ok: true, inputHash });
    return result;
  } catch (error) {
    recordAiProviderCall({ provider, model, startedAtMs, durationMs: Date.now() - startedAtMs, ok: false, inputHash });
    throw error;
  }
}

/** Optional named stage timing from the operation itself (e.g. persistence). */
export function recordAiStage(name: string, ms: number): void {
  const s = storage.getStore();
  if (s && !s.closed) s.stages[name] = (s.stages[name] ?? 0) + ms;
}

export interface AiRequestSummary {
  operation: string;
  totalMs: number;
  /** From operation start to the first AI provider call. */
  preAiMs: number | null;
  /** Wall-clock time during which at least one provider call was in flight. */
  aiWallMs: number;
  /** Sum of every provider call's duration. */
  aiProviderSumMs: number;
  /** aiProviderSumMs / aiWallMs -- 1 = fully sequential, >1 = parallel. */
  parallelism: number | null;
  /** Highest number of provider calls in flight at the same time. */
  peakConcurrency: number;
  /** From the last provider call's end to the operation end. */
  postAiMs: number | null;
  executionCount: number;
  providerCallCount: number;
  failedExecutions: number;
  fallbackExecutions: number;
  validationFailures: number;
  /** Provider calls whose exact input was already sent earlier in this operation. */
  duplicateProviderCalls: number;
  byCapability: Record<string, { count: number; ms: number }>;
  byModel: Record<string, { count: number; ms: number }>;
  stages: Record<string, number>;
  outcome: 'OK' | 'ERROR';
}

/** Pure: the summary of one finished scope. */
export function summarizeAiScope(scope: Omit<AiMetricsScope, 'closed'>, endedAtMs: number, outcome: 'OK' | 'ERROR' = 'OK'): AiRequestSummary {
  const calls = [...scope.providerCalls].sort((a, b) => a.startedAtMs - b.startedAtMs);
  let wall = 0;
  let curStart = -1;
  let curEnd = -1;
  for (const c of calls) {
    const s = c.startedAtMs;
    const e = c.startedAtMs + c.durationMs;
    if (s > curEnd) {
      if (curEnd > curStart) wall += curEnd - curStart;
      curStart = s;
      curEnd = e;
    } else {
      curEnd = Math.max(curEnd, e);
    }
  }
  if (curEnd > curStart) wall += curEnd - curStart;

  const events = calls.flatMap((c) => [
    { t: c.startedAtMs, d: 1 },
    { t: c.startedAtMs + c.durationMs, d: -1 },
  ]).sort((a, b) => a.t - b.t || a.d - b.d);
  let live = 0;
  let peak = 0;
  for (const ev of events) {
    live += ev.d;
    peak = Math.max(peak, live);
  }

  const sum = calls.reduce((n, c) => n + c.durationMs, 0);
  const seen = new Set<string>();
  let duplicates = 0;
  for (const c of calls) {
    if (seen.has(c.inputHash)) duplicates++;
    seen.add(c.inputHash);
  }
  const tally = <T extends { durationMs: number }>(items: T[], key: (t: T) => string) =>
    items.reduce<Record<string, { count: number; ms: number }>>((acc, it) => {
      const k = key(it);
      acc[k] = { count: (acc[k]?.count ?? 0) + 1, ms: (acc[k]?.ms ?? 0) + it.durationMs };
      return acc;
    }, {});
  const lastEnd = calls.reduce((m, c) => Math.max(m, c.startedAtMs + c.durationMs), -1);

  return {
    operation: scope.operation,
    totalMs: endedAtMs - scope.startedAtMs,
    preAiMs: calls.length ? calls[0].startedAtMs - scope.startedAtMs : null,
    aiWallMs: wall,
    aiProviderSumMs: sum,
    parallelism: wall > 0 ? Math.round((sum / wall) * 100) / 100 : null,
    peakConcurrency: peak,
    postAiMs: lastEnd >= 0 ? Math.max(0, endedAtMs - lastEnd) : null,
    executionCount: scope.executions.length,
    providerCallCount: calls.length,
    failedExecutions: scope.executions.filter((e) => !e.success).length,
    fallbackExecutions: scope.executions.filter((e) => e.fallbackUsed).length,
    validationFailures: scope.executions.filter((e) => e.validationStatus === 'FAILED').length,
    duplicateProviderCalls: duplicates,
    byCapability: tally(scope.executions, (e) => e.capability),
    byModel: tally(calls, (c) => c.model),
    stages: { ...scope.stages },
    outcome,
  };
}

function emitSummary(summary: AiRequestSummary): void {
  try {
    console.log('[ai-request-summary]', JSON.stringify(summary));
  } catch {
    /* observability must never break the operation */
  }
}

/**
 * Runs `fn` inside a fresh AI metrics scope and emits one summary when it
 * settles (only if AI ran). A nested call opens its own independent scope.
 */
export async function runWithAiMetrics<T>(operation: string, fn: () => Promise<T>): Promise<T> {
  const scope: AiMetricsScope = { operation, startedAtMs: Date.now(), executions: [], providerCalls: [], stages: {}, closed: false };
  let outcome: 'OK' | 'ERROR' = 'OK';
  try {
    return await storage.run(scope, fn);
  } catch (error) {
    outcome = 'ERROR';
    throw error;
  } finally {
    scope.closed = true;
    if (scope.executions.length > 0 || scope.providerCalls.length > 0) {
      emitSummary(summarizeAiScope(scope, Date.now(), outcome));
    }
  }
}

/** Wraps a route handler so every request is one AI metrics scope. Types and behavior are preserved exactly. */
export function withAiRequestMetrics<A extends unknown[], R>(operation: string, handler: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  return (...args: A) => runWithAiMetrics(operation, () => handler(...args));
}
