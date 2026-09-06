/**
 * LX-1E (repaired in LX-1R) -- DIFFICULTY CONTRACT.
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
 * What LX-1 legitimately establishes:
 *   A. Difficulty SEMANTICS -- three distinct notions kept separate.
 *   B. SCALE -- 1-5 is retained purely as the current technical
 *      representation (`GeneratedQuestion.difficulty`). LX-1 assigns
 *      NO new pedagogical meaning to the five levels.
 *   C. OWNERSHIP invariant -- StudyUS, never the learner, selects a
 *      target challenge level.
 *   D. EVIDENCE CONSISTENCY -- the difficulty written on a
 *      `learning_evidence` row must be the actual generated question
 *      difficulty, not a constant. (Backed by the demonstrated
 *      hardcoded `3`.)
 *   E. UNRESOLVED adaptive authority -- no canonical authority selects
 *      a learner-relative target difficulty today. LX-1 states that
 *      explicitly and defers the policy to LX-4.
 *
 * Pure, no IO. No thresholds. No `masteryScore` mapping.
 */

/** Bumped from 1 -> 2 in LX-1R (invented band/bias policy removed). */
export const DIFFICULTY_CONTRACT_VERSION = 2 as const;

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

// --- E. UNRESOLVED adaptive authority ---

/**
 * The list of canonical inputs a FUTURE target-difficulty authority
 * (LX-4) is allowed to consult. LX-1 does not combine them into a
 * policy -- it only records that they exist.
 */
export const CANDIDATE_INPUTS_FOR_TARGET_DIFFICULTY_AUTHORITY = [
  'concept_knowledge_state dimensions (Phase 2.2)',
  'LearningDecision.targetDimension (Phase 3C)',
  'activity purpose (ActivityType)',
  'TeachingIntent.supportLevel (Phase 5F)',
  'learner difficulty history (learning_evidence.difficulty over time)',
  'GeneratedQuestion.difficulty metadata (generator)',
] as const;

export type TargetDifficultyResolution = {
  status: 'UNRESOLVED';
  reason: string;
  deferredTo: 'LX-4';
  candidateInputsForFutureAuthority: typeof CANDIDATE_INPUTS_FOR_TARGET_DIFFICULTY_AUTHORITY;
};

/**
 * There is no canonical StudyUS authority that selects a
 * learner-relative target difficulty today. This function makes that
 * explicit instead of inventing one. It takes NO inputs -- LX-1 has no
 * policy to run.
 */
export function resolveTargetDifficulty(): TargetDifficultyResolution {
  return {
    status: 'UNRESOLVED',
    reason:
      'No canonical authority selects a learner-relative target difficulty. The generator currently receives a static default (LEGACY_GENERATION_DIFFICULTY_DEFAULT); no Knowledge-State / LearningDecision / TeachingIntent rule sets it. Establishing this policy is LX-4.',
    deferredTo: 'LX-4',
    candidateInputsForFutureAuthority: CANDIDATE_INPUTS_FOR_TARGET_DIFFICULTY_AUTHORITY,
  };
}
