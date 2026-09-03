/**
 * Adaptive Teaching (Phase 5F): the IO layer around the pure
 * `computeTeachingIntent` policy (src/lib/adaptive-teaching-policy.ts).
 * Assembles a compact, certified `TeachingContextInputs` slice from the
 * Digital Learning Twin, computes the `TeachingIntent`, and persists
 * minimal strategy provenance -- never a second Learner Model, never a
 * second decision engine, never a write to any protected system
 * (Mastery, Knowledge State, Verification, misconception/intervention
 * lifecycle, Decision Policy).
 *
 * Takes an ALREADY-COMPUTED `LearningDecision` as an input parameter,
 * never recomputes one: `getLearningDecisions`/`getBestLearningDecision`/
 * `getNextBestActionV3` (Phase 4) remain the only ways to derive WHAT
 * happens next, and this layer only ever consumes their output. This
 * also structurally enforces 5F.6 (Phase 5 never mutates
 * `LearningDecision.activityType`/`reasonCode`/`learningState`/
 * priority/target concept) -- there is no code path here that could,
 * since the decision is a read-only argument, never rebuilt.
 */

import { db } from '@/lib/db';
import { getDecisionContext } from '@/lib/learner-twin';
import type { MetricProjection, HelpDependencyComponents } from '@/lib/learner-twin';
import type { LearningDecision } from '@/lib/adaptive-learning-policy';
import { getLearningDecisions } from './adaptive-learning-orchestrator.service';
import {
  computeTeachingIntent,
  ADAPTIVE_TEACHING_POLICY_VERSION,
  type TeachingIntent,
  type TeachingContextInputs,
} from '@/lib/adaptive-teaching-policy';
import type { TutorStrategy } from './tutor-strategy.service';
import type { ErrorType } from './error-intelligence.service';
import { recordDecisionEvent } from '@/lib/audit';

/**
 * Phase 5C.6: a concept counts as "high help dependency" only with
 * enough evidence to say so (mirrors this codebase's established
 * minimum-occurrence discipline, e.g. error-intelligence.service.ts's
 * MIN_OCCURRENCES) -- a single assisted attempt never flags dependency.
 * Fixed, documented threshold, the one place it's applied.
 */
const HELP_DEPENDENCY_MIN_EVIDENCE = 3;
const HELP_DEPENDENCY_ASSISTED_SHARE_THRESHOLD = 0.6;
const HELP_DEPENDENCY_HINT_SHARE_THRESHOLD = 0.5;

/** Bounded -- never the concept's whole strategy history (5G.15). */
const PREVIOUS_STRATEGY_LOOKBACK = 5;

/**
 * Phase 5F.2: bounded, most-recent-first read of prior
 * TEACHING_STRATEGY_SELECTED provenance for this student+concept, via
 * the SAME generic decision_events audit trail Phase 0E2/2D/2E/4
 * already use -- no new table. `LIMIT` keeps this a fixed-size read
 * regardless of how long the concept has been taught (5G.15).
 */
export async function getRecentTeachingStrategies(studentId: string, conceptId: string): Promise<TutorStrategy[]> {
  const result = await db.query(
    `SELECT new_state FROM decision_events
     WHERE student_id = $1 AND concept_id = $2 AND decision_type = 'TEACHING_STRATEGY_SELECTED'
     ORDER BY created_at DESC LIMIT $3`,
    [studentId, conceptId, PREVIOUS_STRATEGY_LOOKBACK]
  );
  return result.rows
    .map((r) => (r.new_state as { strategy?: string } | null)?.strategy)
    .filter((s): s is TutorStrategy => typeof s === 'string' && s.length > 0);
}

/**
 * Phase 5C.6/5B.4: fixed, documented threshold applied to the Twin's
 * own certified `helpDependency` metric (Phase 1E) -- this is the ONE
 * place the threshold lives; `adaptive-teaching-policy.ts` only ever
 * sees the resulting boolean, never the raw shares.
 */
function helpDependencyFlagFrom(metric: MetricProjection<HelpDependencyComponents> | undefined): boolean {
  if (!metric || metric.requested !== true || !metric.result.available) return false;
  const v = metric.result.value;
  return v.totalEvidenceCount >= HELP_DEPENDENCY_MIN_EVIDENCE &&
    (v.assistedEvidenceShare >= HELP_DEPENDENCY_ASSISTED_SHARE_THRESHOLD || v.hintUsageShare >= HELP_DEPENDENCY_HINT_SHARE_THRESHOLD);
}

export interface GetTeachingIntentOptions {
  /** 5D.4: set only when this call is reacting to one specific graded response. Never inferred from history. */
  lastErrorType?: ErrorType | null;
}

/**
 * Phase 5B/5F: the one entry point a caller (a future content-
 * generation call site, or a read-only API route) uses to get a
 * `TeachingIntent` for an already-computed `LearningDecision`.
 *
 * Query cost (5G.15): exactly one `getDecisionContext` call (bounded to
 * this one concept, with `derivedMetrics` limited to the two this
 * policy actually reads -- never `'all'`) plus one bounded, LIMITed
 * decision_events read for strategy provenance. Misconception codes
 * come from `decision.facts`/`.signals`, already computed by Phase 4 --
 * zero additional query for those (see adaptive-teaching-policy.ts's
 * extractMisconceptionCodes).
 */
export async function getTeachingIntent(
  studentId: string,
  decision: LearningDecision,
  options: GetTeachingIntentOptions = {}
): Promise<TeachingIntent> {
  const [context, previousStrategies] = await Promise.all([
    getDecisionContext(studentId, decision.actionConceptId, { derivedMetrics: ['helpDependency', 'assessmentState'] }),
    getRecentTeachingStrategies(studentId, decision.actionConceptId),
  ]);

  const cognitiveLevel =
    context?.assessmentState.requested === true && context.assessmentState.result.available
      ? context.assessmentState.result.value.cognitiveDemand.latestObservedLevel
      : null;

  const inputs: TeachingContextInputs = {
    calibrationLabel: context?.metacognition.confidenceCalibration.label ?? null,
    independentMastery: context?.independence.independentMastery ?? null,
    masteryScore: context?.mastery.score ?? null,
    helpDependencyFlag: helpDependencyFlagFrom(context?.helpDependency),
    cognitiveLevel,
    lastErrorType: options.lastErrorType ?? null,
    previousStrategies,
  };

  const intent = computeTeachingIntent(studentId, decision, inputs);

  // Phase 5F.2: never blocks/throws on the caller's behalf -- same
  // swallow-and-log failure policy as every other recordDecisionEvent
  // call site (mastery/verification/misconception/intervention
  // engines). A failed provenance write never prevents teaching content
  // from being generated; it only means the next call's
  // previousStrategies read won't see this one.
  await recordDecisionEvent({
    decisionType: 'TEACHING_STRATEGY_SELECTED',
    engine: 'adaptive-teaching-engine',
    engineVersion: String(ADAPTIVE_TEACHING_POLICY_VERSION),
    studentId,
    subjectId: decision.subjectId,
    conceptId: decision.actionConceptId,
    sourceEventType: 'learning_decision',
    newState: { strategy: intent.strategy, primaryBarrier: intent.primaryBarrier, supportLevel: intent.supportLevel, explanationDepth: intent.explanationDepth },
    reasonCode: decision.reasonCode,
    reasonDetails: { activityType: decision.activityType, learningState: decision.learningState },
  });

  return intent;
}

/**
 * Phase 5-R S1/S19: the bridge for a live call site that has
 * studentId/conceptId but no already-computed `LearningDecision` in
 * hand (a quiz-hint request, a concept-explanation view, an Explain &
 * Defend generation). Reuses `getLearningDecisions` (Phase 4,
 * certified, unmodified) VERBATIM -- never a second decision
 * computation, never a duplicate signal-consolidation pass -- and
 * filters to the one concept the caller cares about.
 *
 * Cost, measured and reported (not merely claimed) in
 * docs/audits/STUDYUS_PHASE_5_R_LIVE_ADAPTIVE_TEACHING_ACTIVATION.md
 * S19: `getLearningDecisions`'s own fixed, bounded query count (it
 * loads each signal source once per student, not per concept -- see
 * that function's own doc comment: "computed fresh on every call,"
 * already the pre-existing cost of Today's Plan/Next Best Action,
 * unchanged by this call) -- no NEW query shape is introduced here.
 *
 * Returns `null` when Phase 4 has no active decision for this concept
 * (e.g. a brand-new concept with zero signals, or one already
 * VALIDATED) -- callers MUST treat `null` as "no adaptive layer
 * available this call," falling back to their pre-existing,
 * already-safe non-adaptive behavior, never fabricating a decision.
 */
export async function getBestLearningDecisionForConcept(studentId: string, conceptId: string): Promise<LearningDecision | null> {
  const decisions = await getLearningDecisions(studentId);
  return decisions.find((d) => d.actionConceptId === conceptId) ?? null;
}

/**
 * Convenience composition of the above + `getTeachingIntent` for a
 * live call site that only has studentId/conceptId. `null` means "no
 * TeachingIntent available for this call" -- never an error, never a
 * fabricated default (5F.6 / S18: this function cannot invent a
 * LearningDecision, so it cannot invent a TeachingIntent either).
 */
export async function getTeachingIntentForConcept(
  studentId: string,
  conceptId: string,
  options: GetTeachingIntentOptions = {}
): Promise<TeachingIntent | null> {
  const decision = await getBestLearningDecisionForConcept(studentId, conceptId);
  if (!decision) return null;
  return getTeachingIntent(studentId, decision, options);
}
