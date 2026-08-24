/**
 * Phase 3A: the one authoritative, server-side AI permission policy.
 *
 * Every place in the product that considers using AI to help a
 * student -- hints, explanations, an "ask AI"/"improve my answer"
 * feature, autocomplete -- must ask this function first, keyed by
 * Evidence Mode (never by scattered `if (quizMode === ...)` checks
 * copied into each component). Frontend state can request a feature;
 * it can never authorize one -- the server re-checks canUseAI itself
 * before doing anything AI-assisted (see /api/quizzes/hint).
 *
 * Three feature classes, each with a fixed rule:
 *   - Student-answer-assistance features (HINT, EXPLAIN, ASK_AI, ...):
 *     allowed only in PRACTICE. This is the actual mode gate.
 *   - Input-assistance features (MATH_TOOLBAR): always allowed, in
 *     every mode. Inserting "√" or "±" at the cursor never answers the
 *     question for the student -- see §30, "input assistance is not
 *     answer assistance." Disabling it in Independent/Assessment mode
 *     would be an accessibility regression, not a security fix.
 *   - Internal/system features (INTERNAL_GRADING, VARIANT_GENERATION,
 *     VERIFICATION_GENERATION, REASONING_EVALUATION,
 *     ERROR_CLASSIFICATION, DIFFICULTY_SELECTION,
 *     CONSISTENCY_ANALYSIS): always allowed. These never show the
 *     student anything that helps them answer -- they're the system
 *     grading/authoring its own material, which has to keep working
 *     even mid-Assessment.
 */

import type { EvidenceMode } from './activity-taxonomy';

export type AIFeature =
  // Student-facing assistance -- gated to PRACTICE only
  | 'HINT'
  | 'EXPLAIN'
  | 'ASK_AI'
  | 'SOLVE'
  | 'REWRITE'
  | 'IMPROVE_ANSWER'
  | 'AUTOCOMPLETE'
  | 'PRE_SUBMIT_CHECK'
  // Input assistance -- always allowed
  | 'MATH_TOOLBAR'
  // Internal/system -- always allowed
  | 'INTERNAL_GRADING'
  | 'VARIANT_GENERATION'
  | 'VERIFICATION_GENERATION'
  | 'REASONING_EVALUATION'
  | 'ERROR_CLASSIFICATION'
  | 'DIFFICULTY_SELECTION'
  | 'CONSISTENCY_ANALYSIS';

const STUDENT_ASSISTANCE_FEATURES = new Set<AIFeature>([
  'HINT',
  'EXPLAIN',
  'ASK_AI',
  'SOLVE',
  'REWRITE',
  'IMPROVE_ANSWER',
  'AUTOCOMPLETE',
  'PRE_SUBMIT_CHECK',
]);

const INPUT_ASSISTANCE_FEATURES = new Set<AIFeature>(['MATH_TOOLBAR']);

const INTERNAL_FEATURES = new Set<AIFeature>([
  'INTERNAL_GRADING',
  'VARIANT_GENERATION',
  'VERIFICATION_GENERATION',
  'REASONING_EVALUATION',
  'ERROR_CLASSIFICATION',
  'DIFFICULTY_SELECTION',
  'CONSISTENCY_ANALYSIS',
]);

export interface AttemptState {
  /** Once an attempt has been submitted, student-assistance features no longer apply -- there's nothing left to help with. */
  submitted?: boolean;
}

export interface CanUseAIInput {
  evidenceMode: EvidenceMode;
  feature: AIFeature;
  attemptState?: AttemptState;
}

export function canUseAI(input: CanUseAIInput): boolean {
  const { evidenceMode, feature, attemptState } = input;

  if (INPUT_ASSISTANCE_FEATURES.has(feature)) return true;
  if (INTERNAL_FEATURES.has(feature)) return true;

  if (STUDENT_ASSISTANCE_FEATURES.has(feature)) {
    if (attemptState?.submitted) return false;
    return evidenceMode === 'PRACTICE';
  }

  // Unknown feature -- fail closed rather than silently allow something new.
  return false;
}
