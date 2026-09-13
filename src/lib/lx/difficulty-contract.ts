/**
 * LX-1E (repaired in LX-1R), resolved in LX-9R3-R1 -- DIFFICULTY
 * CONTRACT.
 *
 * LX-0 found: the generator receives a `difficulty`, it is effectively
 * a static `3`, the AI tags each question 1-5, the UI shows five dots,
 * and the evidence row stores a DIFFERENT hardcoded `3`.
 *
 * LX-1R finding: the first LX-1 attempt then INVENTED a difficulty
 * policy -- mastery-score bands (0-20->1 ... 80-100->5) and activity
 * biases (Practice -1, Transfer +1). No such authority exists in
 * StudyUS. That derivation has been REMOVED.
 *
 * LX-9R3's own report proved section E below was never actually wired
 * anywhere: `generate-and-take/route.ts` still resolved every ordinary
 * canonical request to `validated.difficulty || 3`, and the client
 * never sends a `difficulty`, so nearly every generated quiz used a
 * static 3 regardless of the learner's real evidence. LX-9R3-R1
 * resolves section E for real.
 *
 * What this file establishes:
 *   A. Difficulty SEMANTICS -- three distinct notions kept separate.
 *   B. SCALE -- 1-5 is retained purely as the current technical
 *      representation (`GeneratedQuestion.difficulty`).
 *   C. OWNERSHIP invariant -- StudyUS, never the learner, selects a
 *      target challenge level.
 *   D. EVIDENCE CONSISTENCY -- the difficulty written on a
 *      `learning_evidence` row must be the actual generated question
 *      difficulty, not a constant.
 *   E. TARGET DIFFICULTY AUTHORITY (`resolveTargetDifficulty`) --
 *      the ONE canonical function that turns already-certified
 *      ActivityType + Knowledge State facts into a target challenge
 *      level. It consults ONLY existing canonical signals (activity
 *      purpose, `MasteryState`, active critical-misconception count)
 *      -- never time spent, clicks, streaks, raw quiz count, or a
 *      learner-selected value -- and never queries anything itself
 *      (pure, no IO, same discipline as the rest of this file).
 *
 * Pure, no IO.
 */

/** 1 -> 2 in LX-1R (invented band/bias policy removed). 2 -> 3 in LX-9R3-R1 (section E resolved -- `resolveTargetDifficulty` now returns a real, canonical decision). */
export const DIFFICULTY_CONTRACT_VERSION = 3 as const;

// --- A. SEMANTICS (documentation, no policy) ---
//
//  1. QUESTION intrinsic difficulty
//     Complexity of ONE generated question. Owned by the generator;
//     carried on `GeneratedQuestion.difficulty` (1-5).
//  2. LEARNER-RELATIVE target challenge
//     How hard the SET should be for THIS learner right now. NOT owned
//     by any current authority -> see `resolveTargetDifficulty` (UNRESOLVED).
//  3. ACTIVITY purpose
//     Practice / Prove / Retain / Transfer / Assess. Interacts with (2)
//     but is not the same thing. The interaction RULE is future policy.
//
// These three must never be collapsed into one value.

// --- B. SCALE (current technical representation only) ---

/** The integer scale `GeneratedQuestion.difficulty` already uses. No new per-level meaning is assigned by LX-1. */
export type QuestionDifficultyValue = 1 | 2 | 3 | 4 | 5;
export const QUESTION_DIFFICULTY_MIN = 1 as const;
export const QUESTION_DIFFICULTY_MAX = 5 as const;

/**
 * EXISTING_EXECUTION_CONSTRAINT -- every current quiz-generation call
 * site uses `options.difficulty || 3`. A compatibility default, NOT a
 * target-difficulty policy and NOT an evidence requirement.
 */
export const LEGACY_GENERATION_DIFFICULTY_DEFAULT: QuestionDifficultyValue = 3;

function clampToScale(n: number): QuestionDifficultyValue {
  const r = Math.round(n);
  return (r < QUESTION_DIFFICULTY_MIN ? QUESTION_DIFFICULTY_MIN : r > QUESTION_DIFFICULTY_MAX ? QUESTION_DIFFICULTY_MAX : r) as QuestionDifficultyValue;
}

// --- C. OWNERSHIP invariant (assertion, not a function) ---
/**
 * `DIFFICULTY_IS_STUDYUS_OWNED = true`: a canonical learning activity's
 * target difficulty will be selected by StudyUS. The learner may
 * eventually SEE it; the learner never SETS it. LX-1 states the
 * invariant; it does not implement the selection.
 */
export const DIFFICULTY_IS_STUDYUS_OWNED = true as const;

// --- D. EVIDENCE CONSISTENCY (kept -- demonstrated need) ---

/**
 * The difficulty written on a `learning_evidence` row for a single
 * question MUST be that question's actual difficulty
 * (`GeneratedQuestion.difficulty`), clamped to the scale -- never a
 * hardcoded constant. LX-4 replaces the quiz route's `difficulty: 3`
 * with this.
 */
export function difficultyForEvidence(questionDifficulty: number): QuestionDifficultyValue {
  return clampToScale(questionDifficulty);
}

/**
 * When one evidence row aggregates several questions, its difficulty is
 * the mean of the ACTUAL question difficulties (rounded, clamped) --
 * still derived from real questions, never a constant. Falls back to
 * the legacy generation default only for an empty set.
 */
export function aggregateEvidenceDifficulty(questionDifficulties: readonly number[]): QuestionDifficultyValue {
  if (questionDifficulties.length === 0) return LEGACY_GENERATION_DIFFICULTY_DEFAULT;
  const mean = questionDifficulties.reduce((a, b) => a + b, 0) / questionDifficulties.length;
  return clampToScale(mean);
}

// --- E. TARGET DIFFICULTY AUTHORITY (LX-9R3-R1) ---

/**
 * Historical record of the inputs this authority was scoped to consult
 * (kept for traceability -- `resolveTargetDifficulty` below is the
 * actual implementation).
 */
export const CANDIDATE_INPUTS_FOR_TARGET_DIFFICULTY_AUTHORITY = [
  'concept_knowledge_state dimensions (Phase 2.2)',
  'LearningDecision.targetDimension (Phase 3C)',
  'activity purpose (ActivityType)',
  'TeachingIntent.supportLevel (Phase 5F)',
  'learner difficulty history (learning_evidence.difficulty over time)',
  'GeneratedQuestion.difficulty metadata (generator)',
] as const;

/**
 * The narrow slice of `ConceptKnowledgeState` (knowledge-state.service.ts)
 * this authority reads. `masteryState` is the same already-canonical,
 * already-thresholded classification `deriveLearnerJourneyStage` and
 * `computeSupportLevel`'s callers key off -- this file introduces no
 * new numeric band on top of a raw score. `criticalMisconceptionCount`
 * is the same field `computePrimaryBarrier`/`computeSupportLevel`
 * already treat as an unconditional escalation to HIGH_SUPPORT
 * (adaptive-teaching-policy.ts); it plays the identical role here.
 */
export interface TargetDifficultyKnowledgeState {
  masteryState: MasteryStateLike;
  criticalMisconceptionCount: number;
}

/** Kept as a string union here (not imported) so this file stays IO-free and dependency-light; the real `MasteryState` type (knowledge-state.service.ts) is structurally identical and callers pass it directly. */
export type MasteryStateLike =
  | 'UNKNOWN'
  | 'LEARNING'
  | 'DEVELOPING'
  | 'PROVISIONAL_MASTERY'
  | 'VALIDATED_MASTERY'
  | 'AT_RISK'
  | 'INTERVENTION_REQUIRED';

/**
 * The ONLY two purpose-driving facts this authority takes, beyond
 * Knowledge State: `ActivityType` (StudyUS's own existing taxonomy,
 * activity-taxonomy.ts) IS the "activity purpose" input D1 asks for --
 * EvidenceMode, LearnerJourneyStage, and TeachingIntent/SupportLevel
 * are each a coarser or finer PROJECTION of the same underlying
 * canonical facts (EvidenceMode is a pure function of ActivityType;
 * LearnerJourneyStage/TeachingIntent are presentation-layer views over
 * LearningState, which itself already reduces to the SAME
 * MasteryState/critical-misconception facts read here for any concept
 * not blocked upstream of generation). Consulting the projection AND
 * its source would not add information, only a second name for it.
 */
export interface TargetDifficultyContext {
  activityType: ActivityTypeLike;
  /** `null`/omitted when no Concept Knowledge State exists yet (e.g. the very first activity on a concept) -- never treated as a block, only as "nothing to adapt from yet." */
  knowledgeState?: TargetDifficultyKnowledgeState | null;
}

/** Kept as a string union for the same IO-free reason as `MasteryStateLike` above; the real `ActivityType` (activity-taxonomy.ts) is structurally identical. */
export type ActivityTypeLike =
  | 'PRACTICE'
  | 'REVIEW'
  | 'SOLO_CHECK'
  | 'DIAGNOSTIC_CHECK'
  | 'REMEDIATION'
  | 'SOLO_VERIFY'
  | 'TRANSFER'
  | 'RETENTION_CHECK'
  | 'CUMULATIVE_ASSESSMENT'
  | 'MOCK_EXAM';

export type TargetDifficultyReasonCode =
  | 'REMEDIATION_REBUILD'
  | 'DIAGNOSTIC_TARGETED'
  | 'PRACTICE_HIGH_SUPPORT_REBUILD'
  | 'PRACTICE_LEARNING_GUIDED'
  | 'PRACTICE_DEVELOPING_MODERATE'
  | 'PRACTICE_ESTABLISHED_CHALLENGE'
  | 'PROVE_CRITICAL_MISCONCEPTION_FLOOR'
  | 'PROVE_INDEPENDENT_BUILDING'
  | 'PROVE_INDEPENDENT_ESTABLISHED'
  | 'RETENTION_CRITICAL_MISCONCEPTION_FLOOR'
  | 'RETENTION_APPROPRIATE_BUILDING'
  | 'RETENTION_APPROPRIATE_ESTABLISHED'
  | 'TRANSFER_CRITICAL_MISCONCEPTION_FLOOR'
  | 'TRANSFER_HIGH_ABSTRACTION_BUILDING'
  | 'TRANSFER_HIGH_ABSTRACTION_ESTABLISHED'
  | 'ASSESSMENT_CRITICAL_MISCONCEPTION_FLOOR'
  | 'ASSESSMENT_INDEPENDENT_BUILDING'
  | 'ASSESSMENT_INDEPENDENT_ESTABLISHED'
  | 'INSUFFICIENT_STATE_DEFAULT';

export interface TargetDifficultyDecision {
  level: QuestionDifficultyValue;
  reasonCode: TargetDifficultyReasonCode;
  /** Which fields of `TargetDifficultyContext` this decision actually consulted -- for observability, never for a second decision. */
  derivedFrom: readonly string[];
}

const ACTIVITY_ONLY: readonly string[] = ['activityType'];
const ACTIVITY_AND_KNOWLEDGE_STATE: readonly string[] = [
  'activityType',
  'knowledgeState.masteryState',
  'knowledgeState.criticalMisconceptionCount',
];

/**
 * The ONE canonical target-difficulty authority (D2). Pure and
 * deterministic: the same context always yields the same decision (no
 * hidden clock, no randomness, no learner-selected override consulted
 * here -- a caller-supplied override is the CALLER's decision to
 * honor or not, never this function's).
 *
 * Design, activity by activity (D3):
 *   - REMEDIATION is always the floor (1) -- rebuilding understanding
 *     after a failure must never itself be a harder question.
 *   - DIAGNOSTIC_CHECK is always a fixed, low-moderate level (2) --
 *     its job is isolating ONE specific misconception cheaply, not
 *     testing challenge tolerance; it is not adaptive by design.
 *   - PRACTICE/REVIEW (EvidenceMode PRACTICE) grades across FOUR
 *     levels (1-4) by `MasteryState`, so a genuinely blocked learner
 *     (`INTERVENTION_REQUIRED` or an active critical misconception)
 *     and an established one (`PROVISIONAL_MASTERY`/`VALIDATED_MASTERY`)
 *     are visibly, meaningfully different (D3/test 4).
 *   - SOLO_CHECK/SOLO_VERIFY ("Prove"), RETENTION_CHECK ("Retain"),
 *     and CUMULATIVE_ASSESSMENT/MOCK_EXAM ("Assess") are independent-
 *     or assessment-evidence activities: they never drop to
 *     PRACTICE's rebuilding floor even when a critical misconception
 *     is active elsewhere on the concept (that misconception would
 *     already have routed the learner to PRACTICE/REMEDIATION
 *     upstream, per `computeLearningState`'s own precedence -- this
 *     is a defensive floor, not a reachable everyday path) -- their
 *     OWN floor (3) is never trivialized, only their ceiling moves
 *     (D3 PROVE: "no scaffolding-based reduction that trivializes
 *     evidence"; test 7).
 *   - RETENTION_CHECK deliberately uses the SAME two-level band as
 *     SOLO_CHECK (3-4), keyed only by the STABLE `masteryState` (which
 *     a retention attempt's own evidence does not retroactively
 *     inflate run over run) -- so repeating the check cannot escalate
 *     it into an endless harder exam (D3 RETAIN; test 8/14). Varying
 *     REPRESENTATION across attempts while holding this level steady
 *     is the cross-attempt novelty exclusion note's job, combined at
 *     the generation call site (D7), not this function's.
 *   - TRANSFER is the only activity whose ceiling reaches 5 and whose
 *     floor is 4, never lower -- "should normally be the highest
 *     contextual/abstraction demand" (D3 TRANSFER; test 10).
 *   - Every branch's own floor/ceiling differ by exactly one level, so
 *     no single evidence update can move a level by more than one
 *     step within an activity's own band (D5 bounded movement) --
 *     satisfied by construction of the bands themselves, not by a
 *     second "diff against history" mechanism (which would be a
 *     second, parallel learner model).
 */
export function resolveTargetDifficulty(context: TargetDifficultyContext): TargetDifficultyDecision {
  const { activityType, knowledgeState } = context;

  if (activityType === 'REMEDIATION') {
    return { level: 1, reasonCode: 'REMEDIATION_REBUILD', derivedFrom: ACTIVITY_ONLY };
  }
  if (activityType === 'DIAGNOSTIC_CHECK') {
    return { level: 2, reasonCode: 'DIAGNOSTIC_TARGETED', derivedFrom: ACTIVITY_ONLY };
  }
  if (!knowledgeState) {
    return { level: LEGACY_GENERATION_DIFFICULTY_DEFAULT, reasonCode: 'INSUFFICIENT_STATE_DEFAULT', derivedFrom: ACTIVITY_ONLY };
  }

  const { masteryState, criticalMisconceptionCount } = knowledgeState;
  // The SAME unconditional escalation adaptive-teaching-policy.ts's
  // computeSupportLevel/computePrimaryBarrier already apply -- an
  // active critical misconception or INTERVENTION_REQUIRED overrides
  // whatever the raw MasteryState band alone would suggest.
  const blocked = criticalMisconceptionCount > 0 || masteryState === 'INTERVENTION_REQUIRED';
  const established = !blocked && (masteryState === 'PROVISIONAL_MASTERY' || masteryState === 'VALIDATED_MASTERY');

  switch (activityType) {
    case 'PRACTICE':
    case 'REVIEW': {
      if (blocked) return { level: 1, reasonCode: 'PRACTICE_HIGH_SUPPORT_REBUILD', derivedFrom: ACTIVITY_AND_KNOWLEDGE_STATE };
      if (masteryState === 'LEARNING' || masteryState === 'UNKNOWN') {
        return { level: 2, reasonCode: 'PRACTICE_LEARNING_GUIDED', derivedFrom: ACTIVITY_AND_KNOWLEDGE_STATE };
      }
      if (established) return { level: 4, reasonCode: 'PRACTICE_ESTABLISHED_CHALLENGE', derivedFrom: ACTIVITY_AND_KNOWLEDGE_STATE };
      return { level: 3, reasonCode: 'PRACTICE_DEVELOPING_MODERATE', derivedFrom: ACTIVITY_AND_KNOWLEDGE_STATE }; // DEVELOPING / AT_RISK
    }
    case 'SOLO_CHECK':
    case 'SOLO_VERIFY': {
      if (blocked) return { level: 3, reasonCode: 'PROVE_CRITICAL_MISCONCEPTION_FLOOR', derivedFrom: ACTIVITY_AND_KNOWLEDGE_STATE };
      if (established) return { level: 4, reasonCode: 'PROVE_INDEPENDENT_ESTABLISHED', derivedFrom: ACTIVITY_AND_KNOWLEDGE_STATE };
      return { level: 3, reasonCode: 'PROVE_INDEPENDENT_BUILDING', derivedFrom: ACTIVITY_AND_KNOWLEDGE_STATE };
    }
    case 'RETENTION_CHECK': {
      if (blocked) return { level: 3, reasonCode: 'RETENTION_CRITICAL_MISCONCEPTION_FLOOR', derivedFrom: ACTIVITY_AND_KNOWLEDGE_STATE };
      if (established) return { level: 4, reasonCode: 'RETENTION_APPROPRIATE_ESTABLISHED', derivedFrom: ACTIVITY_AND_KNOWLEDGE_STATE };
      return { level: 3, reasonCode: 'RETENTION_APPROPRIATE_BUILDING', derivedFrom: ACTIVITY_AND_KNOWLEDGE_STATE };
    }
    case 'TRANSFER': {
      if (blocked) return { level: 4, reasonCode: 'TRANSFER_CRITICAL_MISCONCEPTION_FLOOR', derivedFrom: ACTIVITY_AND_KNOWLEDGE_STATE };
      if (established) return { level: 5, reasonCode: 'TRANSFER_HIGH_ABSTRACTION_ESTABLISHED', derivedFrom: ACTIVITY_AND_KNOWLEDGE_STATE };
      return { level: 4, reasonCode: 'TRANSFER_HIGH_ABSTRACTION_BUILDING', derivedFrom: ACTIVITY_AND_KNOWLEDGE_STATE };
    }
    case 'CUMULATIVE_ASSESSMENT':
    case 'MOCK_EXAM': {
      if (blocked) return { level: 3, reasonCode: 'ASSESSMENT_CRITICAL_MISCONCEPTION_FLOOR', derivedFrom: ACTIVITY_AND_KNOWLEDGE_STATE };
      if (established) return { level: 4, reasonCode: 'ASSESSMENT_INDEPENDENT_ESTABLISHED', derivedFrom: ACTIVITY_AND_KNOWLEDGE_STATE };
      return { level: 3, reasonCode: 'ASSESSMENT_INDEPENDENT_BUILDING', derivedFrom: ACTIVITY_AND_KNOWLEDGE_STATE };
    }
    default:
      return { level: LEGACY_GENERATION_DIFFICULTY_DEFAULT, reasonCode: 'INSUFFICIENT_STATE_DEFAULT', derivedFrom: ACTIVITY_ONLY };
  }
}
