/**
 * Evidence Idempotency (Phase 2B): the canonical, deterministic
 * encoding of "which logical learner action produced this evidence."
 *
 * A `learning_evidence` row's `operation_key` (see the
 * 20260901_1200_evidence_idempotency.sql migration) is built from an
 * EvidenceApplicationIdentity via buildOperationKey -- pure, no I/O,
 * no randomness. The same identity always produces the same key; two
 * different identities can never collide (operationType and
 * operationId are never allowed to contain the "::" separator, which
 * would otherwise let e.g. operationId "A::B" collide with a
 * different operationType/operationId split).
 *
 * Deliberately NOT built from a timestamp, a freshly-generated random
 * UUID, or anything else that would make a transport retry look like
 * a new logical action (Phase 2A/2B's whole point) -- operationId must
 * always come from a stable domain identifier that already exists
 * (a quiz session id, a verification attempt id) or was minted exactly
 * once at the start of one logical learner action (an Explain/Transfer
 * activity id, minted at generation time -- never at submit time,
 * which would make every retry unique) and round-tripped unchanged
 * through every retry of that same action.
 *
 * Opaque and non-PII by construction: every operationId used by a real
 * caller today is a server-generated id (a quiz session id, a
 * verification_attempts.id, a minted activity/submission token) or a
 * caller-supplied opaque string for the one generic writer that
 * accepts one -- never a student name, email, or raw answer.
 */

export const EVIDENCE_OPERATION_TYPES = [
  'QUIZ_SUBMISSION',
  'VERIFICATION_RESOLUTION',
  'EXPLAIN_DEFEND',
  'TRANSFER',
  'REAL_SCHOOL_EXAM',
  'RECORD_EVIDENCE',
] as const;

export type EvidenceOperationType = (typeof EVIDENCE_OPERATION_TYPES)[number];

export interface EvidenceApplicationIdentity {
  /** Which kind of logical learner action this is -- see EVIDENCE_OPERATION_TYPES. */
  operationType: EvidenceOperationType;
  /**
   * A stable domain identifier for that ONE action -- a quiz session
   * id, a verification attempt id, a minted activity/submission token.
   * Must be identical across every transport retry of the same action
   * and different for every genuinely new action. Never a timestamp,
   * never freshly randomized per request.
   */
  operationId: string;
  /**
   * Evidence is concept-bucketed (one quiz submission can produce
   * separate evidence for several concepts), so the key is scoped to
   * (operationType, operationId, conceptId) -- concept A and concept B
   * from the SAME quiz session are different logical evidence
   * applications; the same concept replayed under the same
   * operationId is the same one.
   */
  conceptId: string;
}

const SEPARATOR = '::';

/**
 * operationType/operationId must never themselves contain the
 * separator -- every real caller passes a fixed enum value and a
 * server-generated/minted opaque id (never free-form student text),
 * so this is a defensive invariant check, not a sanitizer.
 */
function assertNoSeparator(value: string, field: string): void {
  if (value.includes(SEPARATOR)) {
    throw new Error(`EvidenceApplicationIdentity.${field} must not contain "${SEPARATOR}": ${JSON.stringify(value)}`);
  }
}

/** Deterministic, pure. QUIZ_SUBMISSION::<quizId>::<conceptId>, etc. */
export function buildOperationKey(identity: EvidenceApplicationIdentity): string {
  assertNoSeparator(identity.operationType, 'operationType');
  assertNoSeparator(identity.operationId, 'operationId');
  assertNoSeparator(identity.conceptId, 'conceptId');
  return [identity.operationType, identity.operationId, identity.conceptId].join(SEPARATOR);
}
