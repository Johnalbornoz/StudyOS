/**
 * CANON-V2-FINAL-HARDENING Section 3 -- THE ONE CANONICAL ERROR
 * TAXONOMY.
 *
 * Every canonical failure this system can produce -- across generation,
 * session authorization, contract validation, evidence persistence, and
 * re-evaluation -- is one of exactly 9 codes below. This module is the
 * single typed source of truth for that vocabulary; no other module may
 * define its own competing "canonical failure category."
 *
 * MAPPING, NOT A BREAKING RENAME: this codebase already has real,
 * tested, route-specific reason codes (`V1_PROVE_GENERATION_INCOMPLETE`,
 * `V1_RETAIN_GENERATION_INCOMPLETE`, `V1_TRANSFER_GENERATION_INCOMPLETE`,
 * `V1_ACTIVITY_CONTRACT_VIOLATION`, `CanonicalDecisionUnavailableError`)
 * with existing client/test expectations. Renaming them outright would
 * be a second, uncoordinated migration with real regression risk for no
 * behavioral gain. Instead, `toCanonicalErrorCode` maps every existing
 * legacy code to exactly one of the 9 canonical codes below -- so a
 * caller (an error response, an observability event, a test) can always
 * ask "which canonical category is this?" and get the SAME answer for
 * the SAME semantic failure, regardless of which specific route or
 * generator produced it. New canonical code should be written directly
 * against `CanonicalErrorCode`; legacy code is mapped, not rewritten.
 */

/** The closed, total set of canonical failure categories. */
export type CanonicalErrorCode =
  /** A fresh canonical pedagogical decision could not be computed (a read failure, never a "no decision exists" case -- see CanonicalDecisionUnavailableError). */
  | 'CANONICAL_DECISION_UNAVAILABLE'
  /** No implementation is registered for an otherwise-real PedagogicalActivityType -- an impossible-configuration/certification failure, never a normal learner state (see canonical-implementation-registry.ts). */
  | 'CANONICAL_IMPLEMENTATION_MISSING'
  /** The actually-administered (or actually-generated) activity does not match its own authorized/expected contract (item count, difficulty, independence, response contract, depth structure). */
  | 'ACTIVITY_CONTRACT_MISMATCH'
  /** The AI generation call itself did not produce a usable result (provider error, timeout, empty/short result after bounded recovery). */
  | 'AI_GENERATION_FAILED'
  /** The AI generation call returned a structurally invalid result (malformed shape, wrong question count/depth, out-of-range difficulty) -- distinct from AI_GENERATION_FAILED: something came back, but it fails structural validation. */
  | 'AI_GENERATION_INVALID'
  /** AI-based grading/validation itself could not be trusted (a parse failure, a validation call that itself errored) -- distinct from a wrong answer, which is a normal grading OUTCOME, never a failure. */
  | 'AI_VALIDATION_FAILED'
  /** Evidence that should have been persisted (mastery update, evidence row) could not be written. */
  | 'EVIDENCE_PERSISTENCE_FAILED'
  /** The canonical decision could not be re-evaluated after a fresh evidence write (the same-request re-fetch that must reflect newly-created evidence). */
  | 'CANONICAL_REEVALUATION_FAILED'
  /** A dependency this operation needed (DB, a required upstream read) was unavailable -- a lower-level category than the 3 canonical-specific ones above, for failures that aren't about the canonical model itself. */
  | 'DEPENDENCY_UNAVAILABLE';

export const CANONICAL_ERROR_CODES: readonly CanonicalErrorCode[] = [
  'CANONICAL_DECISION_UNAVAILABLE',
  'CANONICAL_IMPLEMENTATION_MISSING',
  'ACTIVITY_CONTRACT_MISMATCH',
  'AI_GENERATION_FAILED',
  'AI_GENERATION_INVALID',
  'AI_VALIDATION_FAILED',
  'EVIDENCE_PERSISTENCE_FAILED',
  'CANONICAL_REEVALUATION_FAILED',
  'DEPENDENCY_UNAVAILABLE',
];

export interface CanonicalError {
  code: CanonicalErrorCode;
  /** Internal diagnostic detail -- never shown to a learner (see canonical-ai-failure-ux.ts for the learner-safe message). */
  detail: string;
}

/**
 * Every legacy/route-specific failure identifier this codebase has ever
 * produced, mapped to exactly one canonical code. Keys are matched
 * case-sensitively, exact string. A key present here must never map to
 * more than one canonical code (the whole point of this module is "same
 * semantic failure -> same canonical code") -- verified by this
 * module's own test (canon-v2-error-taxonomy.test.ts).
 */
const LEGACY_TO_CANONICAL: Record<string, CanonicalErrorCode> = {
  // Generation shortfall (never published partial) -- Prove/Retain/Transfer
  // all mean the exact same thing: the generator could not produce a
  // complete, valid activity, so the whole request failed closed.
  V1_PROVE_GENERATION_INCOMPLETE: 'AI_GENERATION_FAILED',
  V1_RETAIN_GENERATION_INCOMPLETE: 'AI_GENERATION_FAILED',
  V1_TRANSFER_GENERATION_INCOMPLETE: 'AI_GENERATION_FAILED',
  GENERATION_FAILED: 'AI_GENERATION_FAILED',

  // Contract mismatch -- the administered activity didn't match its own
  // authorized contract (item count, difficulty, independence).
  V1_ACTIVITY_CONTRACT_VIOLATION: 'ACTIVITY_CONTRACT_MISMATCH',

  // Registered-implementation gap -- the one impossible-configuration
  // case (see activity-launch-readiness.ts).
  CANONICAL_IMPLEMENTATION_MISSING: 'CANONICAL_IMPLEMENTATION_MISSING',

  // Decision-read failure -- CanonicalDecisionUnavailableError's own
  // string name, for callers that only have the error's constructor
  // name / a serialized code rather than the error instance itself.
  CanonicalDecisionUnavailableError: 'CANONICAL_DECISION_UNAVAILABLE',
  CANONICAL_DECISION_UNAVAILABLE: 'CANONICAL_DECISION_UNAVAILABLE',

  // Same-request canonical re-evaluation (the post-submission re-fetch)
  // could not complete -- generate-and-take/route.ts's own
  // `canonicalResultsStatus` value for this exact case.
  CANONICAL_RESULTS_UNAVAILABLE: 'CANONICAL_REEVALUATION_FAILED',

  // Authorization failures for a canonical_* mode with no legitimate
  // legacy meaning -- the underlying cause is always "no matching,
  // currently-valid activity contract," i.e. a contract mismatch
  // between what was requested and what the fresh decision authorizes.
  V1_PROVE_AUTHORIZATION_FAILED: 'ACTIVITY_CONTRACT_MISMATCH',
  V1_RETAIN_AUTHORIZATION_FAILED: 'ACTIVITY_CONTRACT_MISMATCH',
  V1_TRANSFER_AUTHORIZATION_FAILED: 'ACTIVITY_CONTRACT_MISMATCH',
  V1_LEARN_CHECK_AUTHORIZATION_FAILED: 'ACTIVITY_CONTRACT_MISMATCH',
};

/**
 * Maps any known legacy/route-specific failure identifier to its
 * canonical code. An unrecognized identifier maps to
 * `DEPENDENCY_UNAVAILABLE` -- the most conservative "something this
 * operation needed was not available" category -- rather than throwing,
 * since this function is often called from an error-logging path that
 * must never itself fail. `mapped: false` on the result tells a caller
 * (e.g. this module's own test) whether the input was actually
 * recognized.
 */
export function toCanonicalErrorCode(legacyCode: string): { code: CanonicalErrorCode; mapped: boolean } {
  const mapped = LEGACY_TO_CANONICAL[legacyCode];
  if (mapped) return { code: mapped, mapped: true };
  return { code: 'DEPENDENCY_UNAVAILABLE', mapped: false };
}

export function makeCanonicalError(code: CanonicalErrorCode, detail: string): CanonicalError {
  return { code, detail };
}
