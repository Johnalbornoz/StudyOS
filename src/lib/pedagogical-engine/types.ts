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
}

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
}

export interface RequirementResult {
  stage: Exclude<PedagogicalStage, 'CONSOLIDATED'>;
  status: RequirementStatus;
  qualifyingEvidenceCount: number;
  nonQualifyingEvidenceCount: number;
  reasonCodes: EvidenceQualificationReasonCode[];
  /** Present only when status === 'WAITING'. */
  waitingUntil: string | null;
}

/**
 * PROVE_FAILURE / RETENTION_FAILURE follow the spec's own simple,
 * undiagnosed rules ("failure returns to PRACTICE" / "failure rolls
 * back to PROVE"). The three CASE_* diagnoses are reserved for TRANSFER
 * failure specifically, per the spec's explicit three-way diagnosis
 * (application-weak vs. foundational vs. critical-misconception).
 */
export type RollbackCase =
  | 'PROVE_FAILURE_RETURN_TO_PRACTICE'
  | 'RETENTION_FAILURE_RETURN_TO_PROVE'
  | 'CASE_A_TRANSFER_APPLICATION_WEAK'
  | 'CASE_B_FOUNDATIONAL_FAILURE'
  | 'CASE_C_CRITICAL_MISCONCEPTION';

export interface RollbackDecision {
  triggeredBy: Exclude<PedagogicalStage, 'CONSOLIDATED' | 'LEARN'>;
  case: RollbackCase;
  rolledBackTo: Exclude<PedagogicalStage, 'CONSOLIDATED'>;
  reasonCodes: EvidenceQualificationReasonCode[];
}

export interface DifficultyDecision {
  target: number;
  min: number;
  max: number;
  reasonCode: string;
}

export interface ActivityContract {
  activityType: PedagogicalActivityType;
  /** null for LEARN (an explanation surface, not a scored evidence-producing quiz) and CONSOLIDATED (no activity). */
  itemCount: { min: number; max: number } | null;
  difficulty: DifficultyDecision;
  independence: boolean;
  supportLevel: 'ASSISTED' | 'NONE';
  /** null for LEARN. */
  minimumScorePercent: number | null;
  evidenceContract: string;
  noveltyRequirements?: 'NOVEL_ITEMS_REQUIRED';
  transferDepth?: TransferChallengeDepth[];
}

export interface CanonicalPedagogicalDecision {
  policyVersion: string;
  conceptId: string;
  studentId: string;
  /** Ordered LEARN..TRANSFER -- always all five, regardless of stage reached. */
  requirements: RequirementResult[];
  /** The first unsatisfied requirement, or CONSOLIDATED when every requirement is SATISFIED and no critical misconception blocks it. */
  currentStage: PedagogicalStage;
  activityContract: ActivityContract | null;
  intervention: 'REINFORCE' | null;
  rollback: RollbackDecision | null;
  reasonCodes: EvidenceQualificationReasonCode[];
  computedAt: string;
}
