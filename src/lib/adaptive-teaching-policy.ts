/**
 * Adaptive Teaching Policy (Phase 5B): the ONE canonical, deterministic
 * contract translating a Phase 4 `LearningDecision` (WHAT should happen
 * next) plus a compact slice of certified learner state into a
 * `TeachingIntent` (HOW it should be delivered). Pure, no IO -- exactly
 * the same shape discipline as `adaptive-learning-policy.ts`, which
 * this file consumes and never redefines.
 *
 * Phase 5A reconciliation finding (see
 * docs/audits/STUDYUS_PHASE_5_FINAL_ADAPTIVE_TEACHING_CERTIFICATION.md
 * S3): StudyUs already has real, tested pedagogical machinery --
 * tutor-strategy.service.ts's `TutorStrategy` taxonomy and
 * `selectTutorStrategy`, remediation.service.ts's `RemediationPattern`
 * and step sequencing, and a mature, certified AI Gateway
 * (src/lib/ai/gateway.ts + prompt-registry.ts) already fronting every
 * content-generating call site (tutor chat, concept explanations, quiz
 * hints, error-pattern guidance, Explain & Defend, Transfer) with
 * risk-classified, validated, fail-closed execution. None of that is
 * rebuilt here. What was missing -- confirmed by that same audit -- is
 * a SINGLE contract that (a) is keyed off the Phase 4 canonical
 * `LearningState`/`reasonCode` (which predate neither
 * `selectTutorStrategy` nor `determineRemediationPattern` were aware
 * of), (b) makes the barrier/support/depth/anti-repetition reasoning
 * explicit and versioned, and (c) reuses `TutorStrategy` as its
 * strategy taxonomy rather than inventing a parallel one. This file is
 * that contract.
 *
 * CORE PRINCIPLE (unchanged from the task spec): AI generates content;
 * this policy decides why and under what constraints. Nothing in this
 * file calls an AI provider, reads a learning-style label, or writes
 * any learner state.
 */

import type { LearningDecision, LearningState, LearningSignalType } from './adaptive-learning-policy';
import { evidenceModeForActivity, type ActivityType, type EvidenceMode } from './activity-taxonomy';
import type { TargetDimension } from './adaptive-learning-policy';
import type { TutorStrategy } from '@/services/tutor-strategy.service';
import type { CognitiveLevel } from '@/services/quiz-generation.service';
import type { ErrorType } from '@/services/error-intelligence.service';

/**
 * Phase 5F.7 / 5B.7: versioned exactly like ADAPTIVE_LEARNING_POLICY_VERSION
 * (adaptive-learning-policy.ts) -- any change to barrier classification,
 * strategy selection, support-level thresholds, or explanation-depth
 * rules bumps this, documented here, never silent.
 */
export const ADAPTIVE_TEACHING_POLICY_VERSION = 1;

/**
 * Phase 5B.2: WHY the learner is struggling (or, for RETENTION_RISK/
 * TRANSFER_GAP/INSUFFICIENT_INDEPENDENT_EVIDENCE, why this concept
 * needs this kind of attention right now). Deliberately NOT the full
 * task-spec list -- PROCEDURAL_GAP is omitted here because no
 * DECISION-level certified signal distinguishes it (the certified
 * error taxonomy -- CONCEPTUAL/PROCEDURAL/CARELESS/INCOMPLETE/
 * MISREADING, error-intelligence.service.ts -- is a fact about ONE
 * graded response, not a property of a LearningDecision); it is instead
 * surfaced as `TeachingContextInputs.lastErrorType`, an optional,
 * caller-supplied refinement used only by `selectTeachingStrategy` when
 * a specific graded error is the reason teaching is happening (5D.4).
 * This is the minimum canonical taxonomy the task's 5B.3 instruction
 * asks for -- selected, not the full brainstormed list.
 */
export type PrimaryBarrier =
  | 'LOW_UNDERSTANDING'
  | 'ACTIVE_MISCONCEPTION'
  | 'PREREQUISITE_GAP'
  | 'HELP_DEPENDENCY'
  | 'OVERCONFIDENCE'
  | 'LOW_CONFIDENCE'
  | 'PERSISTENT_FAILURE'
  | 'INSUFFICIENT_INDEPENDENT_EVIDENCE'
  | 'RETENTION_RISK'
  | 'TRANSFER_GAP';

/** Phase 5B.4. */
export type SupportLevel = 'HIGH_SUPPORT' | 'GUIDED' | 'PARTIAL_SUPPORT' | 'MINIMAL_SUPPORT' | 'INDEPENDENT';

/** Phase 5B.5. */
export type ExplanationDepth = 'BRIEF' | 'STANDARD' | 'DEEP';

/**
 * Compact, caller-assembled slice of certified state -- never the
 * whole DecisionContext/ConceptView (5A objective: "never the whole
 * Learner Model," same discipline `buildCompactTutorContext` already
 * follows). Every field here traces to an already-certified source;
 * none is computed by this file.
 */
export interface TeachingContextInputs {
  /** DecisionContext.metacognition.confidenceCalibration.label (Phase 1). */
  calibrationLabel: 'OVERCONFIDENT' | 'WELL_CALIBRATED' | 'UNDERCONFIDENT' | 'INSUFFICIENT_EVIDENCE' | null;
  /** DecisionContext.independence.independentMastery (Phase 1). */
  independentMastery: number | null;
  /** DecisionContext.mastery.score (Phase 1/2). */
  masteryScore: number | null;
  /**
   * Derived from DecisionContext's opt-in `helpDependency` metric
   * (Phase 1E) by the caller (adaptive-teaching.service.ts) applying a
   * documented, fixed threshold -- this file never reads
   * HelpDependencyComponents' raw shares itself, so the threshold lives
   * in exactly one place. `null` when the metric was not requested or
   * is not yet available (insufficient evidence) -- treated as `false`.
   */
  helpDependencyFlag: boolean;
  /** DecisionContext.assessmentState (opt-in, Phase 3F) -- the most recently observed CognitiveDemand tag, or null when none is available. */
  cognitiveLevel: CognitiveLevel | null;
  /** Optional: set only when this TeachingIntent is being derived in direct reaction to one graded response (5D.4) -- e.g. quiz grading feedback. Never inferred, never defaulted from history. */
  lastErrorType?: ErrorType | null;
  /**
   * Bounded, most-recent-first strategies StudyUs has already tried on
   * THIS student+concept (Phase 5F.2 provenance, via decision_events) --
   * never the student's whole strategy history across every concept.
   * Empty when none exist yet (first time teaching this concept).
   */
  previousStrategies: TutorStrategy[];
}

/**
 * Phase 5B.1, adapted to real fields. `representationHints` from the
 * task's example shape is deliberately NOT included: no certified
 * signal in StudyUs measures a representation/modality preference, and
 * inventing one -- even framed as "just a hint" -- would be exactly the
 * learning-style classification the task's Core Principle forbids.
 * Documented here rather than silently dropped.
 */
export interface TeachingIntent {
  studentId: string;
  subjectId: string;
  conceptId: string;
  activityType: ActivityType;
  learningState: LearningState;
  reasonCode: LearningSignalType;
  instructionalGoal: string;
  targetKnowledgeDimension: TargetDimension;
  primaryBarrier: PrimaryBarrier;
  misconceptionCodes: string[];
  /** = decision.targetConceptIds verbatim (Phase 4C) -- when this decision targets a prerequisite/root cause, that concept id lives here, never re-derived. */
  prerequisiteConceptIds: string[];
  supportLevel: SupportLevel;
  explanationDepth: ExplanationDepth;
  reasoningDemand: CognitiveLevel | null;
  strategy: TutorStrategy;
  avoidStrategies: TutorStrategy[];
  previousStrategies: TutorStrategy[];
  successCriteria: string;
  policyVersion: number;
}

/**
 * Phase 5B.2: keyed off `decision.learningState`, NOT re-derived from
 * raw signals. `LearningState` (Phase 4B) already resolves the exact
 * most-severe-first precedence ("Critical misconception or
 * prerequisite repair may temporarily require more support even for
 * otherwise-strong learners," 5B.4) -- recomputing that precedence here
 * from `decision.signals` would be a second, potentially inconsistent
 * copy of Phase 4's own reconciliation. Calibration/help-dependency
 * only refine the barrier within the `DEVELOPING` residual bucket --
 * the one LearningState value that means "no stronger classification
 * fired" -- never override a real escalation (misconception/
 * prerequisite/repair/retention/transfer), matching the same
 * precedence discipline `computeLearningState` itself uses.
 */
export function computePrimaryBarrier(decision: LearningDecision, inputs: Pick<TeachingContextInputs, 'calibrationLabel' | 'helpDependencyFlag'>): PrimaryBarrier {
  switch (decision.learningState) {
    case 'MISCONCEPTION_BLOCKED':
      return 'ACTIVE_MISCONCEPTION';
    case 'PREREQUISITE_BLOCKED':
      return 'PREREQUISITE_GAP';
    case 'NEEDS_REPAIR':
      return 'PERSISTENT_FAILURE';
    case 'PENDING_VERIFICATION':
    case 'INSUFFICIENT_INDEPENDENT_EVIDENCE':
      return 'INSUFFICIENT_INDEPENDENT_EVIDENCE';
    case 'RETENTION_RISK':
      return 'RETENTION_RISK';
    case 'TRANSFER_GAP':
      return 'TRANSFER_GAP';
    case 'NOT_STARTED':
    case 'VALIDATED':
      // VALIDATED is practically unreachable here: consolidateSignals
      // (adaptive-learning-policy.ts) never produces a ConceptDecisionContext
      // -- and therefore never a LearningDecision -- for a concept with
      // zero active signals, which is exactly what VALIDATED means.
      // Handled defensively rather than assumed impossible.
      return 'LOW_UNDERSTANDING';
    case 'DEVELOPING':
    default:
      if (inputs.helpDependencyFlag) return 'HELP_DEPENDENCY';
      if (inputs.calibrationLabel === 'OVERCONFIDENT') return 'OVERCONFIDENCE';
      if (inputs.calibrationLabel === 'UNDERCONFIDENT') return 'LOW_CONFIDENCE';
      return 'LOW_UNDERSTANDING';
  }
}

/**
 * Phase 5B.3: reuses `TutorStrategy` (tutor-strategy.service.ts) as the
 * canonical taxonomy -- selected per the task's own "minimum canonical
 * taxonomy supported by the actual product" instruction. Each barrier's
 * default deliberately mirrors `selectTutorStrategy`'s existing,
 * already-shipped mappings where one exists (OVERCONFIDENT->SOCRATIC,
 * low retention->RETRIEVAL, recurring misconception->CONTRAST, transfer
 * weakness->TRANSFER) -- reconciliation, not reinvention.
 */
const STRATEGY_CHAIN: Record<PrimaryBarrier, TutorStrategy[]> = {
  LOW_UNDERSTANDING: ['EXPLAIN', 'ANALOGY', 'SCAFFOLD'],
  ACTIVE_MISCONCEPTION: ['CONTRAST', 'EXPLAIN', 'SOCRATIC'],
  PREREQUISITE_GAP: ['SCAFFOLD', 'EXPLAIN', 'RETRIEVAL'],
  PERSISTENT_FAILURE: ['SCAFFOLD', 'ANALOGY', 'EXPLAIN'],
  HELP_DEPENDENCY: ['SOCRATIC', 'RETRIEVAL', 'TEACH_BACK'],
  OVERCONFIDENCE: ['SOCRATIC', 'CONTRAST', 'TEACH_BACK'],
  LOW_CONFIDENCE: ['TEACH_BACK', 'CHALLENGE', 'EXPLAIN'],
  INSUFFICIENT_INDEPENDENT_EVIDENCE: ['RETRIEVAL', 'SOCRATIC', 'TEACH_BACK'],
  RETENTION_RISK: ['RETRIEVAL', 'SCAFFOLD', 'EXPLAIN'],
  TRANSFER_GAP: ['TRANSFER', 'ANALOGY', 'SOCRATIC'],
};

/**
 * 5D.4 (error-aware refinement): a CONCEPTUAL error on this specific
 * response strengthens the case for CONTRAST regardless of barrier; a
 * CARELESS/MISREADING error never escalates to a full conceptual
 * strategy -- consistent with "a careless arithmetic slip should not
 * trigger a full conceptual reteach automatically."
 */
function errorAwareOverride(lastErrorType: ErrorType | null | undefined, chain: TutorStrategy[]): TutorStrategy[] {
  if (lastErrorType === 'CONCEPTUAL' && !chain.includes('CONTRAST')) return ['CONTRAST', ...chain];
  if (lastErrorType === 'CARELESS' || lastErrorType === 'MISREADING') {
    // Never lead with a heavy re-teach strategy for a slip -- prefer
    // asking the student to recheck their own work first.
    return ['SOCRATIC', ...chain.filter((s) => s !== 'SOCRATIC')];
  }
  return chain;
}

/**
 * Phase 5B.6 / 5G.8: never repeats the immediately-preceding strategy
 * for the SAME concept when it was ALSO the one before that (two
 * consecutive uses -- one retry is not yet "repeated failure," per
 * `PATTERN_STEPS`-style minimum-effective-intervention discipline
 * elsewhere in this codebase). Picks the next untried entry in the
 * barrier's own strategy chain -- never an LLM's subjective "this
 * didn't work" judgment (5F.4): the only input is persisted provenance.
 */
export function computeAvoidStrategies(previousStrategies: TutorStrategy[]): TutorStrategy[] {
  if (previousStrategies.length >= 2 && previousStrategies[0] === previousStrategies[1]) {
    return [previousStrategies[0]];
  }
  return [];
}

export function selectTeachingStrategy(
  barrier: PrimaryBarrier,
  inputs: Pick<TeachingContextInputs, 'lastErrorType' | 'previousStrategies'>
): TutorStrategy {
  const baseChain = errorAwareOverride(inputs.lastErrorType, STRATEGY_CHAIN[barrier]);
  const avoid = new Set(computeAvoidStrategies(inputs.previousStrategies));
  const choice = baseChain.find((s) => !avoid.has(s));
  // Every chain has >= 2 entries and avoid has at most 1 -- a choice
  // always exists; the fallback below is defensive, never reachable
  // with the chains defined above, and documented rather than silently
  // assumed.
  return choice ?? baseChain[baseChain.length - 1];
}

/**
 * Phase 5B.4 / 5D.3 / 5G.9: the hard floor. Any ActivityType whose
 * Evidence Mode is not PRACTICE (SOLO_CHECK, SOLO_VERIFY, TRANSFER,
 * RETENTION_CHECK, DIAGNOSTIC_CHECK, CUMULATIVE_ASSESSMENT, MOCK_EXAM --
 * activity-taxonomy.ts's EVIDENCE_MODE_BY_ACTIVITY) is an
 * evidence-collection moment, not a teaching moment: supportLevel is
 * always INDEPENDENT there, structurally, so supported instruction can
 * never leak into independent/assessment evidence. Only PRACTICE/
 * REVIEW/REMEDIATION (evidenceMode PRACTICE) may receive real
 * scaffolding.
 */
export function computeSupportLevel(
  decision: LearningDecision,
  barrier: PrimaryBarrier,
  inputs: Pick<TeachingContextInputs, 'independentMastery' | 'masteryScore'>
): SupportLevel {
  if (evidenceModeForActivity(decision.activityType) !== 'PRACTICE') return 'INDEPENDENT';
  if (barrier === 'ACTIVE_MISCONCEPTION' || barrier === 'PREREQUISITE_GAP' || barrier === 'PERSISTENT_FAILURE') return 'HIGH_SUPPORT';
  // 5C.6/5G.4: high help dependency gets LESS support than independence
  // alone would suggest, never more -- the point is fading, not
  // permanent assistance.
  if (barrier === 'HELP_DEPENDENCY') return 'MINIMAL_SUPPORT';
  const { independentMastery, masteryScore } = inputs;
  if (independentMastery === null || masteryScore === null) return 'GUIDED';
  const gap = masteryScore - independentMastery;
  if (gap > 20) return 'GUIDED';
  if (gap > 10) return 'PARTIAL_SUPPORT';
  return 'MINIMAL_SUPPORT';
}

/**
 * Phase 5B.5 / 5G.6: derived from barrier severity and cognitive
 * demand, never from arbitrary text-length personalization.
 * LOW_CONFIDENCE (strong evidence, low self-confidence) stays BRIEF --
 * flooding an already-competent student with basic explanation is
 * exactly the over-scaffolding the task warns against.
 */
export function computeExplanationDepth(
  decision: LearningDecision,
  barrier: PrimaryBarrier,
  inputs: Pick<TeachingContextInputs, 'cognitiveLevel'>
): ExplanationDepth {
  if (evidenceModeForActivity(decision.activityType) !== 'PRACTICE') return 'BRIEF';
  if (barrier === 'LOW_CONFIDENCE') return 'BRIEF';
  if (barrier === 'ACTIVE_MISCONCEPTION' || barrier === 'PREREQUISITE_GAP') return 'DEEP';
  if (inputs.cognitiveLevel === 'ANALYSIS' || inputs.cognitiveLevel === 'SYNTHESIS' || inputs.cognitiveLevel === 'EVALUATION') return 'DEEP';
  return 'STANDARD';
}

const INSTRUCTIONAL_GOAL: Record<PrimaryBarrier, string> = {
  LOW_UNDERSTANDING: 'Build initial understanding of this concept.',
  ACTIVE_MISCONCEPTION: 'Correct the specific incorrect mental model before further practice.',
  PREREQUISITE_GAP: 'Repair the missing prerequisite this concept depends on.',
  HELP_DEPENDENCY: 'Reduce reliance on assistance so the student can perform independently.',
  OVERCONFIDENCE: 'Require active demonstration before confirming understanding.',
  LOW_CONFIDENCE: 'Build self-efficacy without re-teaching already-demonstrated understanding.',
  PERSISTENT_FAILURE: 'Restructure into a smaller, more explicit sequence than previous attempts.',
  INSUFFICIENT_INDEPENDENT_EVIDENCE: 'Obtain a genuinely independent attempt at this concept.',
  RETENTION_RISK: 'Retrieve and refresh previously mastered material before it is forgotten.',
  TRANSFER_GAP: 'Apply the concept in a new context beyond where it was originally learned.',
};

const SUCCESS_CRITERIA: Record<PrimaryBarrier, string> = {
  LOW_UNDERSTANDING: 'Student can restate the core idea and complete one worked example correctly.',
  ACTIVE_MISCONCEPTION: 'Student can articulate why the incorrect model fails, not just produce the correct answer once.',
  PREREQUISITE_GAP: 'Student demonstrates the prerequisite skill correctly before returning to the original concept.',
  HELP_DEPENDENCY: 'Student attempts the next step before any hint is shown.',
  OVERCONFIDENCE: 'Student produces a correct explanation or prediction, not just a correct final answer.',
  LOW_CONFIDENCE: 'Student explains the concept in their own words without added instructional content.',
  PERSISTENT_FAILURE: 'Student completes the smaller restructured sequence in order, one step at a time.',
  INSUFFICIENT_INDEPENDENT_EVIDENCE: 'Student completes one attempt with no assistance and no hints used.',
  RETENTION_RISK: 'Student recalls the material before any new instruction is shown.',
  TRANSFER_GAP: 'Student correctly applies the concept in the new context presented.',
};

/**
 * Phase 5B.1: the single composition point. Pure -- given the same
 * `decision`/`inputs`, always returns a deep-equal `TeachingIntent`
 * (5G.13 determinism). Never mutates `decision`, never reads
 * `decision.activityType`/`reasonCode`/`learningState` into anything
 * other than a verbatim pass-through field (5F.6 decision/teaching
 * boundary).
 */
export function computeTeachingIntent(studentId: string, decision: LearningDecision, inputs: TeachingContextInputs): TeachingIntent {
  const barrier = computePrimaryBarrier(decision, inputs);
  const strategy = selectTeachingStrategy(barrier, inputs);
  return {
    studentId,
    subjectId: decision.subjectId,
    conceptId: decision.actionConceptId,
    activityType: decision.activityType,
    learningState: decision.learningState,
    reasonCode: decision.reasonCode,
    instructionalGoal: INSTRUCTIONAL_GOAL[barrier],
    targetKnowledgeDimension: decision.targetDimension,
    primaryBarrier: barrier,
    misconceptionCodes: extractMisconceptionCodes(decision),
    prerequisiteConceptIds: decision.targetConceptIds,
    supportLevel: computeSupportLevel(decision, barrier, inputs),
    explanationDepth: computeExplanationDepth(decision, barrier, inputs),
    reasoningDemand: inputs.cognitiveLevel,
    strategy,
    avoidStrategies: computeAvoidStrategies(inputs.previousStrategies),
    previousStrategies: inputs.previousStrategies,
    successCriteria: SUCCESS_CRITERIA[barrier],
    policyVersion: ADAPTIVE_TEACHING_POLICY_VERSION,
  };
}

/**
 * 5C.3: reads misconception codes straight off the already-computed
 * `decision.facts`/`decision.primarySignal` (Phase 4's own
 * `buildFacts`/`LearningSignal.misconceptionCode`) -- never a fresh
 * query. Zero additional query cost (5G.15).
 */
function extractMisconceptionCodes(decision: LearningDecision): string[] {
  const codes = new Set<string>();
  if (decision.primarySignal.misconceptionCode) codes.add(decision.primarySignal.misconceptionCode);
  for (const signal of decision.signals) {
    if (signal.misconceptionCode) codes.add(signal.misconceptionCode);
  }
  for (const fact of decision.facts) {
    const code = (fact as { misconceptionCode?: unknown }).misconceptionCode;
    if (typeof code === 'string' && code) codes.add(code);
  }
  return [...codes];
}
