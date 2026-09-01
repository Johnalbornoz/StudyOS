/**
 * Phase 1D: Behavioral Evidence -- Response Time.
 *
 * RESPONSE_TIME_MS = time from the first meaningful presentation of the
 * answerable item to the explicit student answer-submission. It does
 * NOT include question generation time, server grading time, AI
 * grading latency, database write latency, verification-generation
 * latency, or page-load before the item becomes answerable -- the
 * clock only starts once the learner can actually see and answer it.
 *
 * CORE INVARIANT: this module NEVER affects correctness, grading,
 * mastery, Knowledge State, or any other pedagogical decision. It is a
 * pure, side-effect-free normalizer that turns two client-supplied
 * timestamps into an observational fact plus a trust label. Nothing
 * here can fail the learning interaction it's attached to -- see
 * `normalizeResponseTiming`'s doc comment below (fails open: invalid
 * input always degrades to a `quality`, never a thrown error).
 *
 * Client timing is observational, not authoritative -- the server
 * never trusts it blindly (Step 4/6). Server receipt time is NOT
 * treated as thinking time anywhere in this module, since the server
 * does not know when the question actually became visible to the
 * learner; only the client-measured interval can represent that.
 */

/** Trust label for one observed response-time sample. Never used to reject an answer -- see normalizeResponseTiming. */
export type TimingQuality = 'VALID' | 'MISSING' | 'INVALID' | 'CLOCK_SKEW' | 'OUTLIER';

/** Raw client-supplied timestamps for one answerable item. Both optional -- absence is normal (older clients, or a feature not yet instrumented), never an error. */
export interface BehavioralTimingInput {
  questionPresentedAt?: string | null;
  answerSubmittedAt?: string | null;
}

/** Normalized server-side output. `responseTimeMs` is null whenever no trustworthy duration exists (MISSING/INVALID/CLOCK_SKEW) -- never fabricated as 0. */
export interface ResponseTiming {
  responseTimeMs: number | null;
  quality: TimingQuality;
}

/**
 * Step 5: generous maximum valid interaction duration, chosen from
 * actual product behavior discovered in the Phase 1D interaction audit
 * -- structured quiz questions are already bounded by the quiz
 * session's own 45-minute TTL (quiz-persistence.service.ts), so 2 hours
 * is well beyond any legitimate structured-quiz duration. Single-item
 * interactions with no session TTL (Explain & Defend, Transfer,
 * Verification) have no hard product bound, so this ceiling is set
 * generously enough to accommodate a real break (bathroom, distraction,
 * a paused thought) without accepting a multi-day-stale timestamp as if
 * it were real thinking time. NOT used pedagogically in Phase 1D --
 * only to classify a sample as OUTLIER, never to change grading,
 * mastery, or any decision.
 */
export const MAX_VALID_RESPONSE_TIME_MS = 2 * 60 * 60 * 1000; // 2 hours

/**
 * Turns two client-supplied ISO timestamps into a trustworthy-enough
 * duration plus a quality label. Fails open by construction: every
 * branch returns a normal `ResponseTiming` value, never throws --
 * malformed/malicious input degrades the *quality* label, it never
 * blocks the caller from proceeding with the actual learning
 * interaction (Step 23's PRIMARY_LEARNING_OPERATION invariant).
 */
export function normalizeResponseTiming(input: BehavioralTimingInput): ResponseTiming {
  const { questionPresentedAt, answerSubmittedAt } = input;

  if (!questionPresentedAt || !answerSubmittedAt) {
    return { responseTimeMs: null, quality: 'MISSING' };
  }

  const presentedMs = Date.parse(questionPresentedAt);
  const submittedMs = Date.parse(answerSubmittedAt);

  if (!Number.isFinite(presentedMs) || !Number.isFinite(submittedMs)) {
    return { responseTimeMs: null, quality: 'INVALID' };
  }

  const duration = submittedMs - presentedMs;

  if (!Number.isFinite(duration)) {
    return { responseTimeMs: null, quality: 'INVALID' };
  }

  // Covers both "answered before presented" and any client clock jump
  // that produces a negative interval -- never reinterpreted as a
  // positive number, since we cannot know which timestamp is wrong.
  if (duration < 0) {
    return { responseTimeMs: null, quality: 'CLOCK_SKEW' };
  }

  // Beyond the generous ceiling: the answer is still valid, but the
  // duration is not silently clamped into a normal-looking value --
  // kept for diagnostics, tagged unusable for any future behavioral
  // interpretation (Step 5).
  if (duration > MAX_VALID_RESPONSE_TIME_MS) {
    return { responseTimeMs: duration, quality: 'OUTLIER' };
  }

  return { responseTimeMs: duration, quality: 'VALID' };
}

/** One normalized observation, ready to store -- never more than responseTimeMs + quality + (optionally) which question it belongs to. */
export interface ResponseTimingEntry {
  responseTimeMs: number | null;
  timingQuality: Exclude<TimingQuality, 'MISSING'>;
  /** Only present for multi-question writers (a quiz's per-concept evidence bucket may span several questions). */
  questionIndex?: number;
}

/**
 * Step 11: the single reusable normalization-to-storage step every
 * evidence writer uses -- turns one or more normalized `ResponseTiming`
 * values into the entries actually persisted. MISSING samples are
 * dropped entirely (Step 10: no timing data is represented by no
 * entry, never a null-filled placeholder) -- INVALID/CLOCK_SKEW/OUTLIER
 * are kept, since the client did attempt to report timing and that is
 * itself a useful diagnostic fact.
 */
export function toResponseTimingEntries(samples: Array<{ timing: ResponseTiming; questionIndex?: number }>): ResponseTimingEntry[] {
  return samples
    .filter((s) => s.timing.quality !== 'MISSING')
    .map((s) => ({
      responseTimeMs: s.timing.responseTimeMs,
      timingQuality: s.timing.quality as Exclude<TimingQuality, 'MISSING'>,
      ...(s.questionIndex !== undefined ? { questionIndex: s.questionIndex } : {}),
    }));
}

/**
 * Additively merges `behavior.responseTimes` onto an existing metadata
 * object without touching any other key (AI provenance, transfer
 * distance, verification metadata, etc. all pass through untouched).
 * Emits nothing at all when there is no usable entry, so a request
 * with no/only-MISSING timing produces byte-identical metadata to the
 * pre-Phase-1D behavior.
 */
export function withBehaviorMetadata<T extends Record<string, unknown>>(
  metadata: T,
  entries: ResponseTimingEntry[]
): T | (T & { behavior: { responseTimes: ResponseTimingEntry[] } }) {
  if (entries.length === 0) return metadata;
  return { ...metadata, behavior: { responseTimes: entries } };
}
