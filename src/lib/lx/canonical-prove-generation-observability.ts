/**
 * CANON-R6-PERF-I1/R1 -- CANONICAL PROVE GENERATION OBSERVABILITY.
 *
 * Instrumentation only. This module makes NO generation, quality-gate,
 * novelty, or fallback decisions -- it only records, in one structured
 * event, what already happened during one `canonical_prove`
 * `generate-and-take` request.
 *
 * CANON-R6-PERF-I1's own summary line confirmed the live 48-64s
 * latency was ONE monolithic exact-10 `generateGatedQuestionBatch`
 * invocation's own serial Luna -> semantic-verify -> Terra-SHORT-
 * fallback -> semantic-verify chain (never a novelty refill). CANON-
 * R6-PERF-R1 replaces that single invocation with N CONCURRENT,
 * smaller chunks (`generateConcurrentChunkedBatch`) plus at most ONE
 * bounded aggregate recovery round (`generateBoundedRecoveryBatch`) --
 * this module's own shape evolves to describe THAT flow: `invocations`
 * now holds one `CHUNK` record per concurrent chunk (tagged by
 * `chunkIndex`) plus, at most, one `AGGREGATE_RECOVERY` record, instead
 * of the old single `PRIMARY`/`NOVELTY_REFILL_1`/`NOVELTY_REFILL_2`
 * shape. Fields that no longer have a direct equivalent
 * (`generationPrimaryMs`, `noveltyRefill1Ms`, `noveltyRefill2Ms`) are
 * KEPT on the summary type for schema continuity but always reported
 * `null` going forward -- superseded by `chunkPlan`/`chunkCount`,
 * `generationConcurrentMs`, and `aggregateRecoveryMs` respectively.
 *
 * Never logs question text, prompts, or the student's real id -- only
 * counts, durations, and a one-way hash for correlating a specific test
 * student across log lines without exposing their real identifier.
 */
import { createHash } from 'crypto';

/**
 * One generation invocation's own diagnostics within the request --
 * either one of the N concurrent initial chunks (`CHUNK`, with its own
 * `chunkIndex`), or the single bounded aggregate-recovery round
 * (`AGGREGATE_RECOVERY`, `chunkIndex: null`) that runs at most once,
 * only if the concurrent chunks' own aggregate (after novelty
 * filtering) still fell short of the target. The route decides this
 * label -- neither `generateConcurrentChunkedBatch` nor
 * `generateBoundedRecoveryBatch` has any notion of "chunk index" or
 * "recovery" themselves.
 */
export interface CanonicalProveGenerationInvocationRecord {
  invocationType: 'CHUNK' | 'AGGREGATE_RECOVERY';
  chunkIndex: number | null;
  requestedCount: number;
  acceptedCount: number;
  durationMs: number;
  fallbackUsed: boolean;
  fallbackReasonCode: 'SHORT' | 'EMPTY' | null;
  generationCalls: number;
  recoveryCalls: number;
  semanticVerificationUsed: boolean;
  semanticCallCount: number;
  semanticCandidateCount: number;
  semanticAcceptedCount: number;
  semanticRejectedCount: number;
  externalAiCallCount: number;
  insufficientCount: boolean;
  operationId: string;
  parentOperationId: string | null;
}

/** One novelty-filter pass's own diagnostics (Part 7) -- lets a reader see exactly how many questions were rejected as exact duplicates on each pass, and how many remained needed afterward. `INITIAL` filters the concurrent chunks' own aggregate; `RECOVERY` (at most once) filters the aggregate-recovery round's own output. */
export interface CanonicalProveNoveltyPassRecord {
  noveltyPass: 'INITIAL' | 'RECOVERY';
  candidateCount: number;
  acceptedCount: number;
  rejectedExactDuplicateCount: number;
  remainingNeeded: number;
}

export interface CanonicalProveGenerationSummary {
  operationId: string;
  parentOperationId: string;
  studentIdHash: string;
  conceptId: string;
  quizMode: 'canonical_prove';
  canonicalStage: string | null;
  targetItemCount: number;
  difficultyTarget: number | null;
  canonicalAuthorizationMs: number | null;
  priorHistoryMs: number | null;
  /** @deprecated CANON-R6-PERF-R1 -- no single "primary" invocation exists once generation is chunked; always `null` now. Superseded by `chunkPlan`/`chunkCount` and `generationConcurrentMs`. Kept for summary schema continuity. */
  generationPrimaryMs: number | null;
  /** CANON-R6-PERF-R1 -- wall-clock time of the N-concurrent-chunk round (the `Promise.all` itself), i.e. what replaced the old single serial `generationPrimaryMs`. */
  generationConcurrentMs: number | null;
  /** CANON-R6-PERF-R1 -- the balanced chunk sizes `planChunks` produced for this request's target count (e.g. `[4, 3, 3]` for 10). */
  chunkPlan: number[];
  /** CANON-R6-PERF-R1 -- `chunkPlan.length`, for convenience. */
  chunkCount: number;
  noveltyFilterMs: number | null;
  /** @deprecated CANON-R6-PERF-R1 -- the up-to-2-refill mechanism this represented no longer exists (replaced by at most ONE aggregate recovery round); always `null` now. Superseded by `aggregateRecoveryMs`. Kept for summary schema continuity. */
  noveltyRefill1Ms: number | null;
  /** @deprecated CANON-R6-PERF-R1 -- see `noveltyRefill1Ms`; always `null` now. */
  noveltyRefill2Ms: number | null;
  /** CANON-R6-PERF-R1 -- how many novel (post-fingerprint-filter) questions the concurrent chunk round alone produced, BEFORE any aggregate recovery. */
  initialAcceptedCount: number;
  /** CANON-R6-PERF-R1 -- true iff the concurrent chunks' own novelty-filtered aggregate fell short of the target, triggering the one bounded recovery round. */
  aggregateRecoveryUsed: boolean;
  /** CANON-R6-PERF-R1 -- how many questions the (at most one) recovery round was asked to generate; `null` when `aggregateRecoveryUsed` is false. */
  aggregateRecoveryRequestedCount: number | null;
  /** CANON-R6-PERF-R1 -- the recovery round's own wall-clock duration; `null` when `aggregateRecoveryUsed` is false. */
  aggregateRecoveryMs: number | null;
  persistenceMs: number | null;
  totalMs: number;
  generationInvocationCount: number;
  externalAiCallCount: number;
  fallbackCount: number;
  semanticVerificationCount: number;
  /** CANON-R6-PERF-R1 -- 0 or 1: whether the bounded aggregate recovery round fired (same underlying "did an extra generation round beyond the first happen" concept the old multi-refill count represented, now bounded to at most 1). */
  noveltyRefillCount: number;
  priorPracticeFingerprintCount: number | null;
  rejectedExactDuplicateCount: number | null;
  acceptedNovelQuestionCount: number | null;
  finalQuestionCount: number;
  invocations: CanonicalProveGenerationInvocationRecord[];
  noveltyPasses: CanonicalProveNoveltyPassRecord[];
  result: 'SUCCESS' | 'INCOMPLETE' | 'ERROR';
  errorCode?: string;
}

/**
 * One-way, non-reversible, deterministic per-student tag -- safe to log.
 * Never the real id; only useful for a human comparing log lines across
 * requests for the SAME (known) test student in Preview, e.g. to
 * confirm "yes, this is our test student" without printing the real
 * uuid. Truncated (16 hex chars) -- a correlation aid, not a security
 * boundary.
 */
export function hashStudentId(studentId: string): string {
  return createHash('sha256').update(studentId).digest('hex').slice(0, 16);
}

/**
 * Emits exactly one structured `CANONICAL_PROVE_GENERATION_SUMMARY`
 * event. Never throws -- a logging failure must never break the
 * response it is describing (same convention as every other logger in
 * this codebase, e.g. `logGatedBatch`/`logAIExecution`).
 */
export function logCanonicalProveGenerationSummary(summary: CanonicalProveGenerationSummary): void {
  try {
    // eslint-disable-next-line no-console
    console.log('CANONICAL_PROVE_GENERATION_SUMMARY', JSON.stringify(summary));
  } catch { /* logging must never break the response */ }
}
