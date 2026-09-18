/**
 * CANON-R2 -- Canonical Learning State Machine v1.0: shared types.
 *
 * ARCHITECTURAL BOUNDARY (see docs/CANON_R2_PEDAGOGICAL_ENGINE_V1.md):
 * this module owns pedagogical DECISION-MAKING ONLY. It has zero
 * imports from React/Next.js, zero DB/network access, zero knowledge
 * of AI providers/models/prompts/caching, and zero knowledge of quiz
 * generation or the Quality Gate. Every type below is either a plain
 * value the caller already has (raw evidence, a policy) or a plain
 * value this module hands back (a decision, a contract) -- never a
 * React prop, a DB row, or a provider response shape.
 */

/** The five learner-visible progression rungs, plus the terminal state. Deliberately the SAME vocabulary as `LearnerJourneyStage` (src/lib/lx/learner-journey-contract.ts) -- this is not a second, competing taxonomy; it IS the taxonomy, moved to its canonical, isolated home. */
export type PedagogicalStage = 'LEARN' | 'PRACTICE' | 'PROVE' | 'RETAIN' | 'TRANSFER' | 'CONSOLIDATED';

/** Ordered progression -- index order IS the canonical precedence. Never reordered at a call site. */
export const STAGE_ORDER: readonly Exclude<PedagogicalStage, 'CONSOLIDATED'>[] = [
  'LEARN',
  'PRACTICE',
  'PROVE',
  'RETAIN',
  'TRANSFER',
];

/**
 * A requirement's status is never inferred from "does evidence of this
 * type exist" alone -- see EvidenceQualificationResult and the engine's
 * own doc comments.
 *   SATISFIED  -- a currently-valid qualifying attempt exists.
 *   UNSATISFIED -- reachable, but no qualifying attempt exists yet (or
 *                  a prior qualifying attempt was invalidated by a
 *                  downstream rollback).
 *   LOCKED     -- the prerequisite requirement is itself not SATISFIED;
 *                  no attempt at this stage can qualify yet.
 *   WAITING    -- reachable and a qualifying attempt is structurally
 *                  possible, but a temporal gate (the Retention minimum
 *                  wait) has not yet elapsed.
 *   UNRESOLVED -- the engine cannot determine status from the given
 *                  inputs (e.g. malformed evidence) -- never silently
 *                  treated as SATISFIED or UNSATISFIED.
 */
export type RequirementStatus = 'SATISFIED' | 'UNSATISFIED' | 'LOCKED' | 'WAITING' | 'UNRESOLVED';

export type EvidenceQualificationResult = 'QUALIFIES' | 'DOES_NOT_QUALIFY' | 'UNRESOLVED';

/** The ONE shared vocabulary of "why this evidence did or didn't count" -- every qualification decision cites one of these, never a bespoke ad hoc string. */
export type EvidenceQualificationReasonCode =
  | 'PASSING_SCORE'
  | 'INSUFFICIENT_SCORE'
  | 'FAILED_ATTEMPT'
  | 'ASSISTED_WHEN_INDEPENDENCE_REQUIRED'
  | 'CRITICAL_MISCONCEPTION'
  | 'WRONG_ACTIVITY_TYPE'
  | 'PREMATURE_STAGE_EVIDENCE'
  | 'TEMPORALLY_INELIGIBLE'
  | 'MISSING_REQUIRED_REASONING'
  | 'NOT_APPLICABLE'
  | 'UNRESOLVED_POLICY';

/** The declared purpose of one historical attempt -- distinct from the app's own `ActivityType` (src/lib/activity-taxonomy.ts), which this module never imports. A future integration adapter (documented, not built in this phase) maps app ActivityType -> this vocabulary. */
export type PedagogicalActivityType = 'LEARN_CHECK' | 'PRACTICE' | 'PROVE' | 'RETENTION_CHECK' | 'TRANSFER' | 'REINFORCE';

export type TransferChallengeDepth = 'NEAR' | 'CONTEXTUAL' | 'HIGHER';

/**
 * ONE raw, immutable ledger entry. The engine NEVER deletes, rewrites,
 * or reinterprets a row's own recorded facts -- it only classifies
 * whether each row QUALIFIES toward a requirement (see
 * `qualifyEvidence`). "Activity attempt exists" and "attempt qualifies"
 * are always kept as two separate facts (Invariant 1 / 2).
 */
export interface RawEvidenceItem {
  id: string;
  /** The activity's OWN declared purpose when it was administered -- never inferred after the fact from its score. */
  activityType: PedagogicalActivityType;
  timestamp: string;
  itemCount: number;
  correctCount: number;
  /** 0-100. Always present -- callers compute this from correctCount/itemCount before handing evidence to the engine; the engine does no rounding/derivation of its own. */
  scorePercent: number;
  /** True only when NO hint, tutor turn, or worked example was used on this attempt. */
  independent: boolean;
  /** The difficulty actually administered (1-5), never the difficulty requested. */
  difficulty: number;
  /** A critical misconception was detected DURING this specific attempt. */
  hasCriticalMisconception: boolean;
  /** TRANSFER attempts only. */
  transferDepth?: TransferChallengeDepth;
  /** TRANSFER attempts only -- exactly 3 scores (0-100), one per structured challenge, in the same order the challenges were administered. */
  perChallengeScores?: number[];
  /** Whether this attempt satisfied a response contract requiring shown reasoning (SHOW_WORK / EXPLAIN / JUSTIFY). Undefined when no such contract applied. */
  reasoningProvided?: boolean;
  /** RETENTION_CHECK attempts only: whether the item set was genuinely novel (never previously seen by this learner) -- required for a Retention attempt to even be eligible for qualification. */
  novel?: boolean;
  /**
   * CANON-V2-REMEDIATION Part 4 -- TRANSFER attempts only. The ONE
   * trusted, EXPLICIT diagnostic signal for a non-qualifying Transfer
   * attempt, never inferred by this engine from `perChallengeScores` or
   * any other numeric pattern. A critical misconception is reported
   * separately via `hasCriticalMisconception` (checked before this
   * field is ever consulted); this field distinguishes the remaining
   * three failure modes Policy V2 Section 7 requires:
   *   - `APPLICATION_CONTEXT_WEAKNESS` -- core knowledge/procedure is
   *     intact; the learner failed to apply it in the new context.
   *     Stay TRANSFER, immediate retry, no wait.
   *   - `RETENTION_WEAKNESS` -- the learner failed to retrieve
   *     previously-demonstrated knowledge, but there is no explicit
   *     foundational/procedural breakdown. Rollback to RETAIN only,
   *     immediate retry, no new 3-day wait -- PROVE remains valid.
   *   - `FOUNDATIONAL_PROCEDURAL_FAILURE` -- explicit evidence that
   *     prerequisite reasoning, core procedure, or concept foundation is
   *     invalid. Rollback to the earliest invalidated requirement
   *     (normally PRACTICE), resetting the Practice qualification cycle.
   * Produced by evidence dimensions outside a bare per-challenge score
   * pattern -- out of scope for this isolated engine to compute itself.
   * Absent defaults to the most conservative classification,
   * `APPLICATION_CONTEXT_WEAKNESS` -- see `engine.ts`'s Transfer
   * rollback handling for why a numeric score alone must never drive
   * this distinction.
   */
  transferFailureDiagnostic?: TransferFailureDiagnostic;
}

/** CANON-V2-REMEDIATION Part 4 -- the closed vocabulary for Policy V2 Section 7's non-misconception Transfer failure classifications. Critical misconception is reported through `RawEvidenceItem.hasCriticalMisconception` instead, never through this field. */
export type TransferFailureDiagnostic = 'APPLICATION_CONTEXT_WEAKNESS' | 'RETENTION_WEAKNESS' | 'FOUNDATIONAL_PROCEDURAL_FAILURE';

/**
 * CANON-R4R1 Part 9 -- the MINIMUM possible engine input extension
 * resolving CANON-R4's own documented `ENGINE_INTERFACE_EXTENSION_REQUIRED`
 * finding. A `RecognizedRequirement` is never converted into a
 * `RawEvidenceItem` -- the engine consumes it as a wholly separate
 * satisfaction basis (see `RequirementResult.satisfactionBasis`) so
 * legacy/migration provenance and real v1 evidence stay distinguishable
 * all the way through the decision (CANON-R4 Part 18).
 */
export type RecognizedRequirementBasis = 'LEGACY_MIGRATION_BASELINE' | 'LEGACY_POLICY_RECOGNITION';

export interface RecognizedRequirement {
  requirement: Exclude<PedagogicalStage, 'CONSOLIDATED'>;
  basis: RecognizedRequirementBasis;
  /** Opaque foreign key into the caller's own recognition-persistence layer (e.g. a `pedagogical_requirement_recognition` row id) -- never learner content, never interpreted by this engine. */
  recognitionId: string;
  reasonCode: string;
  /**
   * When this recognition was established (e.g. at migration). Used
   * ONLY as a conservative anchor for a temporal gate (Retention's
   * 3-day minimum wait) when no REAL v1 evidence timestamp exists yet
   * for the prerequisite stage it recognizes -- never treated as a real
   * administered difficulty/score event, and never read from the
   * system clock internally (caller-injected, like `now`).
   */
  recognizedAt: string;
}

/** CANON-R4R1 Part 11 -- why an entire `recognizedRequirements` input was rejected outright (never partially applied, never silently gap-filled). */
export type RecognitionRejectionReason = 'NON_CONTIGUOUS_RECOGNITION_SET' | 'DUPLICATE_REQUIREMENT_IN_RECOGNITION_SET';

export interface PedagogicalEngineInput {
  conceptId: string;
  studentId: string;
  /** Injected by the caller, never read from the system clock internally -- determinism (Invariant: same input + same policyVersion => same decision). */
  now: string;
  /** The complete, immutable evidence ledger for this (student, concept). Order-independent -- the engine sorts by timestamp itself. */
  evidence: RawEvidenceItem[];
  /**
   * A CURRENT, live fact -- not derived from the evidence ledger alone.
   * A misconception can be resolved after the attempt that revealed it;
   * this flag reflects "is one still active right now," which the
   * engine cannot determine from historical rows by itself. Provided by
   * the (not-yet-built) integration boundary from the existing
   * misconception service.
   */
  activeCriticalMisconception: boolean;
  policyVersion?: string;
  /**
   * CANON-R4R1 -- optional. Omitting this field (every pre-existing
   * caller and test) produces BYTE-IDENTICAL behavior to before this
   * extension existed. When present, MUST form a contiguous prefix of
   * `STAGE_ORDER` (LEARN, or LEARN+PRACTICE, or LEARN+PRACTICE+PROVE,
   * ...) with no duplicate requirement -- an invalid set is rejected in
   * its entirety (never partially applied, never gap-filled; see
   * `CanonicalPedagogicalDecision.recognitionRejected`). A requirement
   * present here establishes only the STARTING baseline the
   * chronological replay begins from -- any REAL v1 evidence that would
   * roll that requirement back (or a downstream one) through the
   * engine's own existing rollback rules overrides it permanently for
   * the rest of that replay (CANON-R4R1 Part 12-14: "newer v1
   * failure/rollback state > legacy recognition"). Recognition is never
   * re-applied mid-replay -- it seeds the initial state exactly once.
   */
  recognizedRequirements?: RecognizedRequirement[];
}

/** CANON-R4R1 Part 15 -- exposed explicitly so a caller never has to guess WHY a requirement is SATISFIED. `null` whenever `status !== 'SATISFIED'`. */
export type SatisfactionBasis = 'V1_EVIDENCE' | RecognizedRequirementBasis | null;

export interface RequirementResult {
  stage: Exclude<PedagogicalStage, 'CONSOLIDATED'>;
  status: RequirementStatus;
  qualifyingEvidenceCount: number;
  nonQualifyingEvidenceCount: number;
  /** CANON-R2R1 Part 28: opaque `RawEvidenceItem.id` values only -- never learner answer text, question text, or other free-form content. */
  qualifyingEvidenceIds: string[];
  nonQualifyingEvidenceIds: string[];
  reasonCodes: EvidenceQualificationReasonCode[];
  /** Present only when status === 'WAITING'. */
  waitingUntil: string | null;
  /** CANON-R4R1 Part 15. `null` unless status === 'SATISFIED'. */
  satisfactionBasis: SatisfactionBasis;
}

/**
 * PROVE_FAILURE / RETENTION_FAILURE follow the spec's own simple,
 * undiagnosed rules ("failure returns to PRACTICE" / "second
 * CONSECUTIVE Retain failure returns to PROVE"). The four
 * TRANSFER_CASE_* diagnoses are reserved for TRANSFER failure
 * specifically, per Policy V2 Section 7's explicit four-way
 * classification -- lettered A/B/C/D to match the policy's own naming
 * exactly (CANON-V2-REMEDIATION Part 4: the pre-remediation engine's
 * `CASE_B_FOUNDATIONAL_FAILURE` was a letter-mismatch against the
 * policy, which reserves B for retention-weakness and C for
 * foundational/procedural failure -- this rename fixes that).
 */
export type RollbackCase =
  | 'PROVE_FAILURE_RETURN_TO_PRACTICE'
  | 'RETENTION_FAILURE_RETURN_TO_PROVE'
  | 'TRANSFER_CASE_A_APPLICATION_CONTEXT_WEAKNESS'
  | 'TRANSFER_CASE_B_RETENTION_WEAKNESS'
  | 'TRANSFER_CASE_C_FOUNDATIONAL_PROCEDURAL_FAILURE'
  | 'TRANSFER_CASE_D_CRITICAL_MISCONCEPTION';

export interface RollbackDecision {
  triggeredBy: Exclude<PedagogicalStage, 'CONSOLIDATED' | 'LEARN'>;
  case: RollbackCase;
  rolledBackTo: Exclude<PedagogicalStage, 'CONSOLIDATED'>;
  reasonCodes: EvidenceQualificationReasonCode[];
}

/**
 * CANON-R2R1 Part 13/16 -- the closed vocabulary every evidence-driven
 * difficulty decision cites. Naming may evolve; the DISTINCTIONS below
 * (default vs. increase vs. maintained vs. decrease vs.
 * misconception-driven, and their Prove/Retention/Transfer/Reinforce
 * analogs) must never collapse into a single generic code -- a consumer
 * (and this module's own tests) must be able to tell WHY a target was
 * chosen, not just what it is.
 */
export type DifficultyReasonCode =
  | 'LEARN_UNDERSTANDING_ONLY'
  | 'PRACTICE_DEFAULT_DIFFICULTY'
  | 'PRACTICE_SUCCESS_DIFFICULTY_INCREASE'
  | 'PRACTICE_DIFFICULTY_MAINTAINED'
  | 'PRACTICE_LOW_PERFORMANCE_DIFFICULTY_DECREASE'
  | 'PRACTICE_MISCONCEPTION_REINFORCEMENT'
  | 'PROVE_DIFFICULTY_FROM_QUALIFYING_PRACTICE'
  | 'RETENTION_MATCHES_QUALIFYING_PROVE_DIFFICULTY'
  | 'TRANSFER_BASE_DIFFICULTY'
  | 'TRANSFER_ADVANCED_DIFFICULTY_SUPPORTED'
  | 'REINFORCE_DERIVED_FROM_PRACTICE_GAP';

export interface DifficultyDecision {
  target: number;
  min: number;
  max: number;
  reasonCode: DifficultyReasonCode;
}

export interface ActivityContract {
  activityType: PedagogicalActivityType;
  /** null for LEARN (no canonical item-count authority exists for the comprehension check -- never an invented number) and CONSOLIDATED (no activity). */
  itemCount: { min: number; max: number } | null;
  difficulty: DifficultyDecision;
  independence: boolean;
  supportLevel: 'ASSISTED' | 'NONE';
  /** null only for CONSOLIDATED. LEARN's own bar (80, EXCLUSIVE -- see `qualifyEvidence`) is still reported numerically here for the generation system's benefit; the exclusivity itself lives in the qualification logic, not this field. */
  minimumScorePercent: number | null;
  evidenceContract: string;
  noveltyRequirements?: 'NOVEL_ITEMS_REQUIRED';
  transferDepth?: TransferChallengeDepth[];
}

/**
 * CANON-R2R1 Part 21 -- a closed enum every consumer can branch on
 * directly; never inferred from `stage` alone (a RETAIN stage might be
 * WAITING or EXECUTABLE, and consumers must not have to know that).
 */
export type ActionState = 'EXECUTABLE' | 'WAITING' | 'LOCKED' | 'CONSOLIDATED' | 'BLOCKED';

/** CANON-R2R1 Part 22 -- a semantic pedagogical action only. Never a URL, API route, or React navigation target -- routing stays entirely external to this engine. */
export type NextCanonicalAction = 'LEARN' | 'PRACTICE' | 'PROVE' | 'RETENTION_CHECK' | 'TRANSFER' | 'NONE';

/** CANON-R2R1 Part 23. */
export type WaitingReason = 'RETENTION_MINIMUM_INTERVAL_NOT_REACHED';

/**
 * CANON-R2R1 Part 28 -- a safe, serializable evidence-qualification
 * summary per requirement. Deliberately the SAME data already carried on
 * `RequirementResult` (qualification is qualification -- there is no
 * second, independently-computed notion of "qualified evidence" this
 * engine tracks); exposed under its own name because the spec calls for
 * both `requirements` and `qualifiedEvidence` as named output fields.
 * Never includes learner answer text, question text, or other free-form
 * content -- only opaque evidence ids and reason codes.
 */
export interface QualifiedEvidenceSummary {
  requirement: Exclude<PedagogicalStage, 'CONSOLIDATED'>;
  status: RequirementStatus;
  qualifyingEvidenceIds: string[];
  nonQualifyingEvidenceIds: string[];
  reasonCodes: EvidenceQualificationReasonCode[];
  satisfactionBasis: SatisfactionBasis;
}

export interface CanonicalPedagogicalDecision {
  policyVersion: string;
  /**
   * CANON-R2R1 Part 25 -- a deterministic fingerprint of the exact
   * pedagogical input state that produced this decision (policyVersion,
   * conceptId, studentId, a normalized evidence fingerprint,
   * activeCriticalMisconception, and the injected `now`). Never a random
   * UUID, never persisted by this module, never containing learner
   * answer/question text or other PII (Part 26) -- see `engine.ts`'s
   * `computeCanonicalRevision`.
   */
  canonicalRevision: string;
  conceptId: string;
  studentId: string;
  /** The first unsatisfied requirement, or CONSOLIDATED when every requirement is SATISFIED and no critical misconception blocks it. */
  stage: PedagogicalStage;
  /** @deprecated Compatibility alias for `stage` (identical value) -- kept because CANON-R2 code and its own tests already reference `currentStage`. Prefer `stage` in new code. */
  currentStage: PedagogicalStage;
  actionState: ActionState;
  nextCanonicalAction: NextCanonicalAction;
  /** Ordered LEARN..TRANSFER -- always all five, regardless of stage reached. */
  requirements: RequirementResult[];
  qualifiedEvidence: QualifiedEvidenceSummary[];
  activityContract: ActivityContract | null;
  /** Present only when actionState === 'WAITING'. */
  waitingReason: WaitingReason | null;
  /** Present only when actionState === 'WAITING' and a temporal gate produced a concrete date. */
  nextEligibleAt: string | null;
  intervention: 'REINFORCE' | null;
  rollback: RollbackDecision | null;
  reasonCodes: EvidenceQualificationReasonCode[];
  /** CANON-R2R1 Part 27 -- the already-approved fixed stage-anchor percentage (mirrored from `src/lib/lx/journey-progress.ts`'s own anchors, not imported -- see MODULE DEPENDENCY RULES). Follows `stage` exactly; premature evidence can never raise it. */
  journeyProgressPercent: number;
  computedAt: string;
  /**
   * CANON-R4R1 Part 11 -- `null` when `recognizedRequirements` was
   * omitted, empty, or valid. Non-null means the ENTIRE input set was
   * rejected and ignored (never partially applied) -- the decision
   * proceeds exactly as if no recognition had been supplied at all.
   */
  recognitionRejected: RecognitionRejectionReason | null;
  /**
   * The timestamp of the PROVE evidence that most recently demonstrated
   * independent competence -- verbatim from `replay`'s own
   * `state.proveQualifyingAt` (set from either qualifying real V1 PROVE
   * evidence, or a recognized legacy PROVE's `recognizedAt`; reset to
   * `null` by the engine's own existing rollback rules). This is a
   * PROVE fact, never a RETAIN/memory fact -- it is also the exact
   * anchor `nextEligibleAt`'s own RETAIN-eligibility computation already
   * uses (`proveQualifyingAt + CANONICAL_POLICY.retention.minimumWaitDays`).
   * `null` whenever no PROVE currently qualifies. Never independently
   * recomputed here -- this field only exposes the single existing
   * internal value, so it can never disagree with the engine's own
   * RETAIN-eligibility logic.
   */
  lastQualifyingProveAt: string | null;
}
