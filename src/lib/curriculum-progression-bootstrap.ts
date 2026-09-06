/**
 * Phase 8 -- Step 8C1: the minimal Phase-4-compatible NOT_STARTED entry
 * boundary.
 *
 * §8C1.12 audit finding: a truly NOT_STARTED concept (no
 * learning_evidence, no concept_knowledge_state row) is ALREADY
 * launchable through the canonical path -- `/dashboard/quiz?subjectId=
 * ...&conceptId=...` (default quizMode `topic_practice`,
 * evidenceSource `PRACTICE_QUIZ`) generates first-touch practice
 * questions for any valid concept id and requires no prior KS row. What
 * is missing is only that `getLearningDecisions` never *emits* a
 * decision for a concept with no KS row (Phase 4 seeds candidates from
 * `concept_knowledge_state`).
 *
 * This helper closes that gap WITHOUT a second ranking / selection
 * engine and WITHOUT touching Phase 4 policy: it produces exactly ONE
 * deterministic `LearningDecision` for ONE already-eligible curriculum
 * concept, using Phase 4's own vocabulary and the canonical
 * first-touch = PRACTICE / NOT_STARTED / UNDERSTANDING mapping
 * (`computeLearningState` returns NOT_STARTED for `!ks`, and
 * `selectActivityType` returns PRACTICE for the NOT_STARTED /
 * developing residual). It never scores, never ranks, never picks
 * which concept -- the curriculum-eligibility read already did that in
 * `topics.display_order` order.
 *
 * PURE. No DB, no AI, no clock.
 */
import {
  ADAPTIVE_LEARNING_POLICY_VERSION,
  type LearningDecision,
  type LearningSignal,
} from '@/lib/adaptive-learning-policy';

/** The synthetic signal that stands in for "Phase 4 has no live decision yet, but the curriculum says start here". */
export const CURRICULUM_PROGRESSION_SIGNAL_TYPE = 'CURRICULUM_PROGRESSION' as unknown as LearningSignal['type'];

export interface NotStartedBootstrapInput {
  studentId: string;
  subjectId: string;
  conceptId: string;
}

/**
 * A minimal, deterministic first-touch decision for a NOT_STARTED
 * curriculum concept. Shape-compatible with `learning-session-engine`'s
 * `startLearningSession` (PRACTICE -> quiz launch needs only
 * `activityType` + `subjectId` + `actionConceptId`). `priorityScore`
 * is 0 -- the lowest possible -- because a bootstrap decision must
 * never outrank a real Phase 4 decision for the same or another
 * concept.
 */
export function bootstrapNotStartedLearningDecision(input: NotStartedBootstrapInput): LearningDecision {
  const signal: LearningSignal = {
    type: CURRICULUM_PROGRESSION_SIGNAL_TYPE,
    source: 'curriculum-eligibility-read.service',
    conceptId: input.conceptId,
    subjectId: input.subjectId,
    metadata: {},
  };
  return {
    actionConceptId: input.conceptId,
    subjectId: input.subjectId,
    targetConceptIds: [],
    signals: [signal],
    primarySignal: signal,
    learningState: 'NOT_STARTED',
    targetDimension: 'UNDERSTANDING',
    activityType: 'PRACTICE',
    pedagogicalPriority: 'LOW',
    temporalUrgency: null,
    priorityScore: 0,
    reasonCode: CURRICULUM_PROGRESSION_SIGNAL_TYPE,
    facts: [],
    dueAt: null,
    policyVersion: ADAPTIVE_LEARNING_POLICY_VERSION,
  };
}

/** True when a live Phase 4 decision set contains a decision for this concept (bootstrap is used only when it does NOT). */
export function hasLiveDecisionForConcept(decisions: readonly LearningDecision[], conceptId: string): boolean {
  return decisions.some((d) => d.actionConceptId === conceptId);
}
