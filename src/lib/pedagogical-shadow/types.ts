/**
 * CANON-R3 -- PEDAGOGICAL ENGINE SHADOW INTEGRATION: shared types.
 *
 * This directory is the INTEGRATION LAYER, deliberately separate from
 * the pure, frozen `src/lib/pedagogical-engine/` (which this phase does
 * not modify -- see docs/CANON_R3_SHADOW_INTEGRATION.md's ENGINE FREEZE
 * VERIFICATION section). Unlike the pure engine, code here MAY reference
 * application/domain types (`ActivityType`, `ConceptKnowledgeState`,
 * etc.) -- it is the boundary that translates real StudyUS data into the
 * engine's own contract, never the other way around.
 *
 * NOTHING in this directory has authority over learner-facing behavior.
 * It reads, compares, and reports -- it never writes, routes, generates,
 * or grades.
 */
import type { RawEvidenceItem, CanonicalPedagogicalDecision, PedagogicalStage, ActionState, NextCanonicalAction, TransferFailureDiagnostic } from '@/lib/pedagogical-engine';

/**
 * CANON-V2-REMEDIATION Part 5 -- the REAL per-challenge Transfer shape a
 * future write path must persist (see `new-evidence-capture-contract.ts`'s
 * `V1TransferChallengeCapture`, which this mirrors exactly). Depth-tagged
 * (never order-dependent) so a caller can supply the 3 challenges in any
 * order; the adapter itself re-orders them into the engine's own
 * NEAR/CONTEXTUAL/HIGHER `perChallengeScores` sequence and fails closed
 * (`TRANSFER_CHALLENGE_BREAKDOWN_UNAVAILABLE`) if any of the 3 depths is
 * missing, duplicated, or the array isn't exactly length 3.
 */
export interface StudyUSTransferChallengeScore {
  depth: 'NEAR' | 'CONTEXTUAL' | 'HIGHER';
  scorePercent: number;
  reasoningProvided?: boolean;
}

/** GROUNDING NOTE (verified against database/baseline/STUDYUS_BASELINE_2026_08.sql's real `learning_evidence` DDL and its one write path, src/services/mastery.service.ts / src/app/api/quizzes/generate-and-take/route.ts): every field below is either a REAL column/JSONB path this adapter has confirmed exists, or an explicitly-optional field the adapter documents as NOT reliably available today. Nothing here is invented to make the mapping look more complete than it is. */
export interface StudyUSEvidenceRow {
  /** learning_evidence.id -- the ONLY identifier this module ever carries forward into a shadow report. */
  id: string;
  /** learning_evidence.source_type (EvidenceSourceType, e.g. 'PRACTICE_QUIZ', 'PRACTICE_QUESTION', 'CUMULATIVE_ASSESSMENT', 'EXAM_SIMULATION', 'DIAGNOSTIC'). */
  sourceType: string;
  /** learning_evidence.result. */
  result: 'correct' | 'partial' | 'incorrect';
  /** learning_evidence.score_percent -- confirmed already stored 0-100 (see generate-and-take/route.ts's own `Math.round((bucket.correct/bucket.total)*100)`), never a 0-1 fraction, in the one real write path audited. `scoreShape` below still lets a caller declare a different source's shape rather than this module guessing. */
  scorePercent: number | null;
  scoreShape?: ScoreShape;
  /** learning_evidence.difficulty -- the difficulty ACTUALLY administered (an aggregate mean when the row represents a multi-question bucket; see `aggregateEvidenceDifficulty` at the real write site). Never recomputed here. */
  difficulty: number;
  /** learning_evidence.timestamp, ISO. */
  timestamp: string;
  /** learning_evidence.hints_used. */
  hintsUsed: number;
  /** learning_evidence.ai_assistance_type. */
  aiAssistanceType: string;
  /**
   * The CANONICAL `ActivityType` for this row, when resolvable.
   * GROUNDING NOTE: this is deliberately NOT `learning_evidence.activity_type`
   * -- direct inspection of the one real write path
   * (generate-and-take/route.ts) shows that column is always the
   * generic literal `'quiz'`. The real canonical ActivityType lives in
   * `learning_evidence.metadata->>'activityType'` (copied verbatim from
   * `quiz_sessions.activity_type` at generation time). This module never
   * parses JSONB itself -- callers must supply the already-extracted
   * value, or `null` when absent (older rows / no metadata written).
   */
  activityType: string | null;
  /**
   * `quiz_sessions.quiz_mode` for the session this row's bucket
   * belongs to, when resolvable (join key: the row's `operation_key`,
   * which encodes the quizId used as `quiz_sessions.id` -- confirmed at
   * the real write site, `identity: {operationType: 'QUIZ_SUBMISSION',
   * operationId: validated.quizId, conceptId}`). Present as a fallback
   * discriminator since `activityType` (metadata) is not always
   * populated on older rows -- `quiz_mode` is the more consistently
   * available real signal (QUIZ_MODE_CONFIG, generate-and-take/route.ts).
   */
  quizMode?: string | null;
  /**
   * GROUNDING NOTE: `learning_evidence` has NO durable, queryable item-
   * count column (confirmed against its full column list). The real
   * per-bucket question count (`bucket.total`) is used only to weight
   * the mastery-score algorithm and is persisted solely inside
   * `decision_events.reason_details.sampleSize` -- a SEPARATE audit
   * table, not this row, and of unknown completeness for older data.
   * Supply this ONLY when a caller has successfully joined that trail;
   * absent otherwise. This adapter NEVER fabricates a count (Part 8).
   */
  itemCount?: number;
  correctCount?: number;
  /**
   * Only knowable from a separate memory/retention source
   * (concept_memory_state's own novelty bookkeeping) that this module
   * does not itself read. `undefined` unless a caller supplies it.
   */
  novel?: boolean;
  /**
   * Whether THIS specific attempt was linked to a critical misconception
   * occurrence (a per-attempt historical fact, from the misconception
   * service's own occurrence records) -- distinct from
   * `activeCriticalMisconception` on the adapter's overall output, which
   * must reflect CURRENT state (Part 11). `undefined` unless a caller
   * supplies it; never inferred from `result` alone.
   */
  hasItemCriticalMisconception?: boolean;
  /**
   * GROUNDING NOTE: real StudyUS transfer distances are NEAR/MID/FAR
   * (concept_transfer_state's own CHECK constraint), NOT the new
   * engine's NEAR/CONTEXTUAL/HIGHER vocabulary. This module never
   * remaps one taxonomy onto the other -- see the TRANSFER CHALLENGE
   * MAPPING section of the report. Carried through verbatim, untyped,
   * for audit visibility only; never fed into `RawEvidenceItem.transferDepth`.
   */
  rawTransferDistance?: string;
  /**
   * CANON-V2-REMEDIATION Part 5 -- the REAL, depth-tagged 3-challenge
   * breakdown for a canonical Transfer attempt (see
   * `StudyUSTransferChallengeScore` above and
   * `new-evidence-capture-contract.ts`'s `V1TransferCapture`). GROUNDING
   * NOTE (unchanged from CANON-R3): real StudyUS Transfer evidence is
   * still recorded per INDIVIDUAL task (`transfer_task_instances`) today
   * -- there is no live write path yet that administers and persists 3
   * challenges together as one canonical attempt (canonical Transfer
   * generation/session/execution remains explicitly NOT_READY, exactly
   * like Retention -- see `activity-launch-readiness.ts`). This field
   * defines the REAL shape such a future write path must populate; this
   * adapter never synthesizes it from separate individual attempts, and
   * fails closed (`TRANSFER_CHALLENGE_BREAKDOWN_UNAVAILABLE`) whenever
   * it is absent, malformed, or not exactly the 3 required depths.
   */
  transferChallenges?: StudyUSTransferChallengeScore[];
  /** Only mapped when a real response-contract field exists on the source row; `undefined` otherwise (Part 14). */
  reasoningProvided?: boolean;
  /**
   * CANON-V2-REMEDIATION Part 4's own diagnostic signal (Policy V2
   * Section 7's 3 non-misconception Transfer failure classifications).
   * NEVER inferred from `transferChallenges`/`scorePercent` by this
   * adapter -- `undefined` unless a caller supplies an explicit,
   * independently-sourced diagnostic value. StudyUS has no live source
   * for this yet; documented as an adapter gap, never guessed.
   */
  transferFailureDiagnostic?: TransferFailureDiagnostic;
}

export type ScoreShape = 'PERCENT_0_100' | 'FRACTION_0_1' | 'RATIO';

/** The ONE closed vocabulary for "why this row could not be mapped (fully or at all)." Every gap the adapter finds cites one of these -- never a bespoke ad hoc string, and never silence. */
export type AdapterUnresolvedReason =
  | 'LEARN_CHECK_SOURCE_UNAVAILABLE'
  | 'UNSUPPORTED_ACTIVITY_TYPE'
  | 'UNKNOWN_SOURCE'
  | 'ITEM_COUNT_NOT_AVAILABLE'
  | 'TRANSFER_CHALLENGE_BREAKDOWN_UNAVAILABLE'
  | 'TRANSFER_DEPTH_TAXONOMY_MISMATCH';

export interface AdapterUnresolvedMapping {
  reason: AdapterUnresolvedReason;
  /** The `StudyUSEvidenceRow.id` this finding is about; `null` for a concept-level (not row-level) finding such as LEARN_CHECK_SOURCE_UNAVAILABLE. */
  evidenceId: string | null;
  detail: string;
}

/** CANON-R3 Part 29 -- never used to judge the new engine as defective; a LOW-confidence mapping is a statement about the ADAPTER's own input completeness, nothing else. */
export type AdapterConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface EvidenceAdapterResult {
  items: RawEvidenceItem[];
  unresolved: AdapterUnresolvedMapping[];
  warnings: string[];
  confidence: AdapterConfidence;
  /** How many raw StudyUS rows were considered, regardless of whether each one ultimately mapped. */
  rowsConsidered: number;
  /** A deterministic fingerprint of the RAW (pre-adapter) evidence rows -- see `evidence-snapshot-fingerprint.ts`. Distinct from the engine's own `canonicalRevision` (Part 18): this one lets a caller confirm OLD and NEW were computed from the identical underlying evidence set, independent of any later wall-clock `now`. */
  evidenceSnapshotFingerprint: string;
}

/**
 * CANON-R3 Part 16 -- the CURRENT canonical authority's own answer,
 * normalized to a shape the comparator can read. Every field an
 * `UNAVAILABLE` counterpart of `null` when the current model's own
 * composition (`buildCanonicalLearningProgress` et al.) did not resolve
 * it -- never guessed.
 */
export interface OldCanonicalSnapshot {
  stage: string | null;
  actionState: string | null;
  nextAction: string | null;
  progressPercent: number | null;
  validationReadiness: string | null;
  /** Which real, already-existing functions this snapshot was actually composed from -- for audit, so a reader can verify nothing was reimplemented. */
  sourceAuthorities: string[];
}

export interface NewCanonicalSnapshot {
  stage: PedagogicalStage;
  actionState: ActionState;
  nextCanonicalAction: NextCanonicalAction;
  progressPercent: number;
  policyVersion: string;
  canonicalRevision: string;
}

export type ComparisonResult =
  | 'MATCH'
  | 'EXPECTED_POLICY_DIFFERENCE'
  | 'ADAPTER_DATA_GAP'
  | 'OLD_MODEL_INCONSISTENCY'
  | 'NEW_MODEL_POSSIBLE_DEFECT'
  | 'UNRESOLVED';

/** The ONE closed vocabulary for "why OLD and NEW disagreed." Every disagreement cites at least one -- never a bare "MISMATCH" (Part 21). */
export type DisagreementReasonCode =
  | 'OLD_RETAIN_NEW_PRACTICE_BECAUSE_NO_QUALIFIED_PROVE'
  | 'OLD_TRANSFER_NEW_RETAIN_BECAUSE_RETENTION_UNSATISFIED'
  | 'NEW_LEARN_BLOCKED_BECAUSE_LEARN_CHECK_NOT_AVAILABLE'
  | 'HISTORICAL_ITEM_COUNT_DOES_NOT_MEET_NEW_POLICY'
  | 'TRANSFER_BREAKDOWN_UNAVAILABLE'
  | 'OLD_SNAPSHOT_FIELD_UNAVAILABLE'
  | 'STAGE_VOCABULARY_DIFFERS'
  | 'ACTION_STATE_DIFFERS_SAME_STAGE'
  | 'NO_DISAGREEMENT';

export interface ComparisonOutcome {
  result: ComparisonResult;
  reasonCodes: DisagreementReasonCode[];
  /** A short, structured (never free-prose-only) explanation -- human-auditable, still built entirely from closed-vocabulary facts. */
  explanation: string;
}

/** CANON-R3 Part 22 -- the ONE safe, serializable shadow record. No learner answer text, no question text, no learner name, no free-form responses -- every field here is a stage/action/count/id, never content. */
export interface ShadowComparisonRecord {
  conceptId: string;
  evidenceSnapshotFingerprint: string;
  old: {
    stage: string | null;
    action: string | null;
    progress: number | null;
  };
  new: {
    stage: PedagogicalStage;
    actionState: ActionState;
    nextCanonicalAction: NextCanonicalAction;
    progress: number;
    policyVersion: string;
  };
  comparison: {
    result: ComparisonResult;
    reasonCodes: DisagreementReasonCode[];
  };
  adapter: {
    evidenceCount: number;
    unresolvedMappings: AdapterUnresolvedReason[];
    warnings: string[];
    confidence: AdapterConfidence;
  };
}

export type { RawEvidenceItem, CanonicalPedagogicalDecision };
