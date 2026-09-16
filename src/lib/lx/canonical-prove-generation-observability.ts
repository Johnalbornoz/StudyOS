/**
 * CANON-R6-PERF-I1 -- CANONICAL PROVE GENERATION OBSERVABILITY.
 *
 * Instrumentation only. This module makes NO generation, quality-gate,
 * novelty, or fallback decisions -- it only records, in one structured
 * event, what already happened during one `canonical_prove`
 * `generate-and-take` request, so CANON-R6-PERF-DIAG's own open
 * question (was the live 4-external-call trace a single gated-batch
 * Terra fallback, or an initial batch plus a novelty refill?) can be
 * answered directly from the next Preview run's logs, without guessing.
 *
 * Never logs question text, prompts, or the student's real id -- only
 * counts, durations, and a one-way hash for correlating a specific test
 * student across log lines without exposing their real identifier.
 */
import { createHash } from 'crypto';

/** One `generateGatedQuestionBatch` invocation's own diagnostics, tagged with WHICH invocation this was in the request (the route decides this label -- the generator itself has no notion of "primary" vs "refill"). */
export interface CanonicalProveGenerationInvocationRecord {
  invocationType: 'PRIMARY' | 'NOVELTY_REFILL_1' | 'NOVELTY_REFILL_2';
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

/** One novelty-filter pass's own diagnostics (Part 7) -- lets a reader see exactly how many questions were rejected as exact duplicates on each pass, and how many remained needed afterward. */
export interface CanonicalProveNoveltyPassRecord {
  noveltyPass: 'INITIAL' | 'REFILL_1' | 'REFILL_2';
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
  generationPrimaryMs: number | null;
  noveltyFilterMs: number | null;
  noveltyRefill1Ms: number | null;
  noveltyRefill2Ms: number | null;
  persistenceMs: number | null;
  totalMs: number;
  generationInvocationCount: number;
  externalAiCallCount: number;
  fallbackCount: number;
  semanticVerificationCount: number;
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
