/**
 * Phase 3C -- Adaptive Learning Orchestrator: the pure decision policy.
 *
 * Everything in this file is a pure function over already-loaded data --
 * no DB, no fetch, no LLM. The IO side (loading signals from the many
 * existing Phase 1/2/2.2/3A/3B services) lives in
 * adaptive-learning-orchestrator.service.ts, which calls into this file.
 * Splitting it this way is what makes the policy directly unit-testable
 * without a database (see tests/unit/adaptive-learning-orchestrator.test.ts).
 *
 * Read-only by construction: this file has no imports capable of writing
 * anything, and never assigns MasteryState -- Phase 2.2's
 * evaluateValidationLifecycle remains the only place that ever happens.
 * See docs/architecture/phase-3-adaptive-learning-orchestration.md for
 * the full Phase 3C design writeup.
 */

import type { ActivityType } from './activity-taxonomy';
import type { ConceptKnowledgeState } from '@/services/knowledge-state.service';
import type { DueUrgency } from '@/services/learning-scheduler.service';

export type LearningSignalType =
  | 'AT_RISK'
  | 'INTERVENTION_REQUIRED'
  | 'VALIDATION_DEADLINE_APPROACHING'
  | 'VALIDATION_DEADLINE_OVERDUE'
  | 'RETENTION_REVIEW_DUE'
  | 'WAITING_FOR_RETENTION'
  | 'TRANSFER_REQUIRED'
  | 'FORGETTING_RISK'
  | 'EXAM_APPROACHING'
  | 'REMEDIATION_ACTIVE'
  | 'REMEDIATION_UNFINISHED'
  | 'PREREQUISITE_GAP'
  | 'DIAGNOSIS_REQUIRED'
  | 'RECURRING_MISCONCEPTION'
  | 'CRITICAL_MISCONCEPTION'
  | 'LEARNING_DEBT'
  | 'INDEPENDENCE_GAP'
  | 'LOW_UNDERSTANDING'
  | 'CALIBRATION_CONFLICT'
  /**
   * Phase 4A/4B reconciliation: sourced from the Phase 3/3-R certified
   * Digital Twin assessmentState (assessment-verification.service.ts's
   * getAssessmentStateForConcept), which this engine had zero awareness
   * of before Phase 4 -- it predates Phase 3. Fires when
   * `hasPendingVerification` is true: the student's most recent
   * Assessment-mode evidence for this concept still has an unresolved
   * verification attempt, so it cannot yet be treated as confirmed
   * independent proof. Never claims VALIDATED while this is true (see
   * computeLearningState).
   */
  | 'VERIFICATION_PENDING'
  /**
   * Phase 4A/4B reconciliation: fires when this concept's understanding
   * is otherwise adequate (real evidence exists, understanding at/above
   * policy threshold) but `assessmentState.lastIndependentEvidence` is
   * null -- i.e. every bit of that evidence was produced under PRACTICE/
   * COACH conditions, never once under INDEPENDENT or ASSESSMENT Evidence
   * Mode (or a real school exam). This is deliberately NOT the same
   * signal as INDEPENDENCE_GAP below: INDEPENDENCE_GAP compares two
   * numeric scores that both already exist (a measured gap); this signal
   * fires when independent evidence is completely ABSENT, which
   * INDEPENDENCE_GAP's own `independentMastery !== null` guard silently
   * skips today -- exactly the "high Practice performance, zero
   * independent confirmation" red-team scenario Phase 3 was built to
   * expose but this engine, until Phase 4, never consumed.
   */
  | 'INSUFFICIENT_INDEPENDENT_EVIDENCE';

/**
 * One true fact about one concept, from one source. Signals are never
 * merged or destroyed on the way in -- see consolidateSignals below --
 * so a concept with exam+debt+forgetting+independence issues keeps all
 * four, unlike NBA v2's single TodayReason per concept.
 */
export interface LearningSignal {
  type: LearningSignalType;
  source: string;
  /** The actionable concept this signal already points at -- the root cause where one exists (see targetConceptId), never the raw symptom concept. */
  conceptId: string;
  subjectId: string;
  dueAt?: string | null;
  temporalUrgency?: DueUrgency;
  remediationPathId?: string;
  diagnosisId?: string;
  occurrenceId?: string;
  misconceptionCode?: string;
  calibrationConflictId?: string;
  /**
   * Phase 4-R: set only on a `VERIFICATION_PENDING` signal -- the
   * server-owned identity of the EXISTING unresolved `verification_attempts`
   * row this signal describes (`AssessmentStateSummary.pendingVerification`,
   * unmodified from where it was already computed). Never a client-
   * supplied value, never used to construct a new attempt -- only to
   * resume this exact one through the certified /api/quizzes/verify
   * pipeline. See `selectActivityType`'s SOLO_VERIFY routing.
   */
  verificationAttemptId?: string;
  /** Phase 4-R: the quiz session `verificationAttemptId` belongs to -- required by /api/quizzes/verify's existing (quizId, conceptId, studentId)-scoped lookup; carried alongside verificationAttemptId rather than re-derived. */
  quizSessionId?: string;
  /** Set only when conceptId is a root-cause concept standing in for a different concept where the problem actually manifested (P0-B semantics, preserved here). */
  targetConceptId?: string;
  metadata: Record<string, unknown>;
}

/** One actionable concept's fully consolidated view -- every true signal survives, never collapsed into one scalar. */
export interface ConceptDecisionContext {
  actionConceptId: string;
  subjectId: string;
  knowledgeState: ConceptKnowledgeState | null;
  signals: LearningSignal[];
  targetConceptIds: string[];
  rootCauseConceptId?: string;
  remediationPathIds: string[];
  diagnosisIds: string[];
  occurrenceIds: string[];
  calibrationConflictIds: string[];
  /** Phase 4-R: collected from any VERIFICATION_PENDING signal(s), same array-of-provenance convention as remediationPathIds/diagnosisIds/occurrenceIds above (in practice at most one -- getAssessmentStateForConcept already deterministically selects the single actionable attempt, §Finding 4). */
  verificationAttemptIds: string[];
  quizSessionIds: string[];
}

export type TargetDimension =
  | 'UNDERSTANDING'
  | 'INDEPENDENCE'
  | 'APPLICATION'
  | 'RETENTION'
  | 'TRANSFER'
  | 'MISCONCEPTION'
  | 'PREREQUISITE'
  | 'VALIDATION'
  | 'EXAM_READINESS';

export type PedagogicalPriority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export interface LearningFact {
  kind: string;
  [key: string]: unknown;
}

/**
 * Phase 4B -- Canonical Learning State: "what is true about this concept
 * for this learner right now", strictly separate from the Next Best
 * Learning Action ("what should happen next", i.e. `activityType`
 * below). A state is never stored as an action and vice versa.
 *
 * This is NOT a new parallel classification invented from scratch --
 * it is a thin, deterministic reconciliation over already-certified
 * fields: `ConceptKnowledgeState.masteryState` (Phase 2.2A/B,
 * UNKNOWN/LEARNING/DEVELOPING/PROVISIONAL_MASTERY/VALIDATED_MASTERY/
 * AT_RISK/INTERVENTION_REQUIRED) and `.validationReadiness`
 * (READY/INSUFFICIENT_EVIDENCE/WAITING_FOR_RETENTION/TRANSFER_REQUIRED/
 * ACTIVE_CRITICAL_MISCONCEPTION) already answer most of this question.
 * The only genuinely NEW dimensions Phase 4 adds are the two Phase 3
 * Assessment/Verification facts this engine had zero awareness of
 * before Phase 4 (PENDING_VERIFICATION, INSUFFICIENT_INDEPENDENT_EVIDENCE)
 * and the concept-EXTERNAL relational facts Knowledge State itself
 * cannot see (a prerequisite gap or an active remediation belongs to a
 * DIFFERENT concept's evidence, not this one's own dimension scores).
 *
 * See computeLearningState's own doc comment for the exact, explicit
 * precedence order -- this is not a numeric score.
 */
export type LearningState =
  | 'NOT_STARTED'
  | 'MISCONCEPTION_BLOCKED'
  | 'PREREQUISITE_BLOCKED'
  | 'NEEDS_REPAIR'
  | 'PENDING_VERIFICATION'
  | 'INSUFFICIENT_INDEPENDENT_EVIDENCE'
  | 'RETENTION_RISK'
  | 'TRANSFER_GAP'
  | 'DEVELOPING'
  | 'VALIDATED';

/**
 * Phase 4A/4E: the deterministic policy version for THIS file
 * (adaptive-learning-policy.ts) specifically -- distinct from
 * `mastery_policies.version` (Phase 2.2's own, DB-configured, versions
 * the Knowledge State THRESHOLDS this file consumes but never redefines)
 * and from `PendingVerificationAttempt`/assessment-profile versioning.
 * This is a plain code constant, not a DB row, matching the fact that
 * this policy is itself pure code over already-loaded data (see the
 * file header) -- there is no runtime config to version.
 *
 * Bumped from Phase 3C's original (implicit, unversioned) release to 2
 * for Phase 4A/4B/4C/4D's real, disclosed rule changes: two new signal
 * types (VERIFICATION_PENDING, INSUFFICIENT_INDEPENDENT_EVIDENCE) and
 * two new priority bands.
 *
 * Bumped again, 2 -> 3, for Phase 4-R: `selectActivityType`'s actual
 * mapping for VERIFICATION_PENDING changed from "no dedicated branch,
 * silently falls through to whatever a lower-precedence check would
 * have picked" to an explicit `SOLO_VERIFY` selection -- a genuine,
 * disclosed change to which ActivityType this policy produces for that
 * signal, not merely an addition alongside unchanged existing behavior
 * (unlike the band/signal additions that justified 1 -> 2, this
 * one changes what an EXISTING signal already produced). Per this
 * constant's own contract ("never a silent rule change"), that
 * required a bump, audited and decided deliberately rather than left
 * at 2.
 *
 * Every LearningDecision carries this value (`policyVersion`) so a
 * consumer can always tell which rule set produced it.
 */
export const ADAPTIVE_LEARNING_POLICY_VERSION = 3;

export interface LearningDecision {
  actionConceptId: string;
  subjectId: string;
  targetConceptIds: string[];
  rootCauseConceptId?: string;
  signals: LearningSignal[];
  primarySignal: LearningSignal;
  /** Phase 4B: "what is true now" -- see LearningState's own doc comment. Never confused with `activityType` ("what should happen next"). */
  learningState: LearningState;
  targetDimension: TargetDimension;
  activityType: ActivityType;
  pedagogicalPriority: PedagogicalPriority;
  /** "When is this due?" -- from the Scheduling Clock, never re-derived here. Null when no signal for this concept carries a deadline. */
  temporalUrgency: DueUrgency | null;
  /** Derived purely from the deterministic band+modifier ordering below -- never an independent second decision mechanism. */
  priorityScore: number;
  /** Phase 4C.4: machine-readable reason -- a direct, explicit alias of `primarySignal.type` (no second, parallel reason-code taxonomy invented; see the Phase 4 report's §5.4). */
  reasonCode: LearningSignalType;
  facts: LearningFact[];
  remediationPathId?: string;
  diagnosisId?: string;
  occurrenceId?: string;
  /** Phase 4-R: present whenever this concept has an actionable pending verification (whether or not it drove this specific decision) -- same "collected from context, not just the primary signal" convention as remediationPathId/diagnosisId/occurrenceId above. See `selectActivityType`'s SOLO_VERIFY routing and `LearningSignal.verificationAttemptId`'s own doc comment. */
  verificationAttemptId?: string;
  /** Phase 4-R: the quiz session `verificationAttemptId` belongs to -- required by /api/quizzes/verify's existing lookup. */
  quizSessionId?: string;
  dueAt?: string | null;
  /** Phase 4E.2: see ADAPTIVE_LEARNING_POLICY_VERSION's own doc comment. */
  policyVersion: number;
}

/**
 * Groups signals by the actionable concept they already point at (see
 * LearningSignal.conceptId doc) into one ConceptDecisionContext per
 * concept. No signal is ever dropped, and multiple target concepts
 * sharing one root cause collapse into ONE context with the targets
 * preserved as provenance -- never duplicate recommendation rows.
 */
export function consolidateSignals(
  signals: LearningSignal[],
  knowledgeStateByConceptId: ReadonlyMap<string, ConceptKnowledgeState>
): ConceptDecisionContext[] {
  const byId = new Map<string, ConceptDecisionContext>();

  for (const signal of signals) {
    const id = signal.conceptId;
    let ctx = byId.get(id);
    if (!ctx) {
      ctx = {
        actionConceptId: id,
        subjectId: signal.subjectId,
        knowledgeState: knowledgeStateByConceptId.get(id) ?? null,
        signals: [],
        targetConceptIds: [],
        remediationPathIds: [],
        diagnosisIds: [],
        occurrenceIds: [],
        calibrationConflictIds: [],
        verificationAttemptIds: [],
        quizSessionIds: [],
      };
      byId.set(id, ctx);
    }
    ctx.signals.push(signal);

    if (signal.targetConceptId && signal.targetConceptId !== id) {
      if (!ctx.targetConceptIds.includes(signal.targetConceptId)) ctx.targetConceptIds.push(signal.targetConceptId);
      ctx.rootCauseConceptId = id;
    }
    if (signal.remediationPathId && !ctx.remediationPathIds.includes(signal.remediationPathId)) ctx.remediationPathIds.push(signal.remediationPathId);
    if (signal.diagnosisId && !ctx.diagnosisIds.includes(signal.diagnosisId)) ctx.diagnosisIds.push(signal.diagnosisId);
    if (signal.occurrenceId && !ctx.occurrenceIds.includes(signal.occurrenceId)) ctx.occurrenceIds.push(signal.occurrenceId);
    if (signal.calibrationConflictId && !ctx.calibrationConflictIds.includes(signal.calibrationConflictId)) {
      ctx.calibrationConflictIds.push(signal.calibrationConflictId);
    }
    if (signal.verificationAttemptId && !ctx.verificationAttemptIds.includes(signal.verificationAttemptId)) {
      ctx.verificationAttemptIds.push(signal.verificationAttemptId);
    }
    if (signal.quizSessionId && !ctx.quizSessionIds.includes(signal.quizSessionId)) {
      ctx.quizSessionIds.push(signal.quizSessionId);
    }
  }

  return [...byId.values()];
}

/**
 * Dominant-class priority bands -- highest number wins. Deliberately
 * lexicographic (band first, modifier second, clamped so a modifier can
 * never cross into the next band) rather than a naive additive sum, so
 * a pile of low-value secondary signals can never accidentally outrank
 * the deliberate imminent-exam override. Values are Phase 3C's own
 * policy, not a port of NBA v2's numeric constants -- only the ORDERING
 * invariants below are required to match (see
 * tests/unit/adaptive-learning-orchestrator.test.ts, "NBA v2 compatibility").
 */
const BAND = {
  IMMINENT_EXAM: 100,
  /** REMEDIATION_ACTIVE, INTERVENTION_REQUIRED, CRITICAL_MISCONCEPTION -- the system's own strongest already-escalated states. */
  ACTIVE_ESCALATION: 90,
  PREREQUISITE_GAP: 80,
  EXAM_APPROACHING: 70,
  LEARNING_DEBT: 60,
  /** DIAGNOSIS_REQUIRED and an actionable (non-data-quality-only) CALIBRATION_CONFLICT: both are "we need more evidence before we can act" states. */
  DIAGNOSTIC_EVIDENCE: 50,
  MISCONCEPTION: 40,
  /** AT_RISK / validation deadlines / retention-due / transfer-required -- Phase 2.2's own maintenance-of-proof signals. */
  VALIDATION: 35,
  /** Phase 4A/4B: VERIFICATION_PENDING is the Phase 3 Assessment/Verification analog of VALIDATION above -- "we need to close the loop before this evidence can be trusted" -- so it shares the same tier rather than inventing a new one. */
  VERIFICATION_PENDING: 35,
  FORGETTING_RISK: 30,
  INDEPENDENCE_GAP: 20,
  /** Phase 4A/4B: same tier as INDEPENDENCE_GAP -- both are "the evidence we have doesn't support trusting this concept as independently demonstrated yet" -- differing only in how the gap was detected (a measured score gap vs. a complete absence of independent/assessment evidence). */
  INSUFFICIENT_INDEPENDENT_EVIDENCE: 20,
  LOW_UNDERSTANDING: 10,
  BASELINE: 0,
} as const;

/** Matches today-plan.service.ts's own EXAM_CRITICAL_DAYS -- the one thing allowed to outrank active remediation. */
export const EXAM_CRITICAL_DAYS = 2;

function evaluateSignal(signal: LearningSignal): { band: number; modifier: number } | null {
  switch (signal.type) {
    case 'EXAM_APPROACHING': {
      const daysUntil = typeof signal.metadata.daysUntil === 'number' ? signal.metadata.daysUntil : 99;
      return daysUntil <= EXAM_CRITICAL_DAYS
        ? { band: BAND.IMMINENT_EXAM, modifier: EXAM_CRITICAL_DAYS - daysUntil }
        : { band: BAND.EXAM_APPROACHING, modifier: Math.max(0, 30 - daysUntil) };
    }
    case 'REMEDIATION_ACTIVE':
    case 'INTERVENTION_REQUIRED':
    case 'CRITICAL_MISCONCEPTION':
      return { band: BAND.ACTIVE_ESCALATION, modifier: 0 };
    case 'PREREQUISITE_GAP': {
      const unlockValue = typeof signal.metadata.unlockValue === 'number' ? signal.metadata.unlockValue : 0;
      return { band: BAND.PREREQUISITE_GAP, modifier: unlockValue };
    }
    case 'LEARNING_DEBT': {
      const severity = typeof signal.metadata.severity === 'number' ? signal.metadata.severity : 0;
      return { band: BAND.LEARNING_DEBT, modifier: severity };
    }
    case 'DIAGNOSIS_REQUIRED':
      return { band: BAND.DIAGNOSTIC_EVIDENCE, modifier: 0 };
    case 'CALIBRATION_CONFLICT': {
      // Data-quality-only caveats (LOW_MAPPING_CONFIDENCE/COVERAGE_MISMATCH
      // with no directional tag) never drive priority -- they must not be
      // promoted into a strong knowledge-gap claim (Phase 2.2C boundary).
      if (signal.metadata.actionable !== true) return null;
      const magnitude = typeof signal.metadata.conflictMagnitude === 'number' ? signal.metadata.conflictMagnitude : 0;
      return { band: BAND.DIAGNOSTIC_EVIDENCE, modifier: magnitude / 4 };
    }
    case 'RECURRING_MISCONCEPTION': {
      const occurrenceCount = typeof signal.metadata.occurrenceCount === 'number' ? signal.metadata.occurrenceCount : 0;
      return { band: BAND.MISCONCEPTION, modifier: occurrenceCount };
    }
    case 'AT_RISK':
    case 'VALIDATION_DEADLINE_OVERDUE':
    case 'VALIDATION_DEADLINE_APPROACHING':
    case 'WAITING_FOR_RETENTION':
    case 'RETENTION_REVIEW_DUE':
    case 'TRANSFER_REQUIRED':
      return { band: BAND.VALIDATION, modifier: 0 };
    case 'VERIFICATION_PENDING':
      return { band: BAND.VERIFICATION_PENDING, modifier: 0 };
    case 'FORGETTING_RISK': {
      const risk = typeof signal.metadata.forgettingRisk === 'number' ? signal.metadata.forgettingRisk : 0;
      return { band: BAND.FORGETTING_RISK, modifier: risk };
    }
    case 'INDEPENDENCE_GAP':
      return { band: BAND.INDEPENDENCE_GAP, modifier: 0 };
    case 'INSUFFICIENT_INDEPENDENT_EVIDENCE':
      return { band: BAND.INSUFFICIENT_INDEPENDENT_EVIDENCE, modifier: 0 };
    case 'LOW_UNDERSTANDING': {
      const gap = typeof signal.metadata.gap === 'number' ? signal.metadata.gap : 0;
      return { band: BAND.LOW_UNDERSTANDING, modifier: gap };
    }
    // REMEDIATION_UNFINISHED is corroborating provenance for
    // REMEDIATION_ACTIVE (the Scheduler's broader non-terminal-state
    // signal vs. remediation.service's own narrower "genuinely active
    // repair" states) -- it never drives priority on its own so the two
    // sources are never double-counted.
    case 'REMEDIATION_UNFINISHED':
      return null;
    default:
      return null;
  }
}

/** The single highest-priority signal driving this context's decision -- never a naive sum across all of them. */
export function dominantSignal(context: ConceptDecisionContext): { signal: LearningSignal; band: number; modifier: number } {
  let best: { signal: LearningSignal; band: number; modifier: number } | null = null;
  for (const signal of context.signals) {
    const evaluated = evaluateSignal(signal);
    if (!evaluated) continue;
    if (!best || evaluated.band > best.band || (evaluated.band === best.band && evaluated.modifier > best.modifier)) {
      best = { signal, ...evaluated };
    }
  }
  return best ?? { signal: context.signals[0], band: BAND.BASELINE, modifier: 0 };
}

function priorityLabelForBand(band: number): PedagogicalPriority {
  if (band >= BAND.ACTIVE_ESCALATION) return 'CRITICAL';
  if (band >= BAND.EXAM_APPROACHING) return 'HIGH';
  if (band >= BAND.MISCONCEPTION) return 'MEDIUM';
  return 'LOW';
}

const URGENCY_RANK: Record<DueUrgency, number> = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };

/**
 * Temporal urgency ("when is this due?") stays a wholly separate axis
 * from pedagogicalPriority ("what should happen first, given all
 * evidence?") -- reused verbatim from whichever Scheduling Clock
 * signal(s) carry it, never re-derived or blended into the priority
 * score. Null (never fabricated) when nothing for this concept carries
 * a deadline.
 */
export function computeTemporalUrgency(context: ConceptDecisionContext): DueUrgency | null {
  let best: DueUrgency | null = null;
  for (const s of context.signals) {
    if (!s.temporalUrgency) continue;
    if (!best || URGENCY_RANK[s.temporalUrgency] > URGENCY_RANK[best]) best = s.temporalUrgency;
  }
  return best;
}

function earliestDueAt(context: ConceptDecisionContext): string | null {
  let best: string | null = null;
  for (const s of context.signals) {
    if (!s.dueAt) continue;
    if (!best || new Date(s.dueAt).getTime() < new Date(best).getTime()) best = s.dueAt;
  }
  return best;
}

/**
 * Deterministic ActivityType selection -- section 8's policy encoded as
 * an explicit, ordered rule list (never a random/implicit choice):
 * continue an active repair, establish a root cause before repairing
 * it, apply the deterministic corrective activity for persistent
 * difficulty, then fall through Knowledge State's own dimensions
 * (Retention proof due -> RETENTION_CHECK, Transfer required ->
 * TRANSFER, Independence gap -> SOLO_CHECK), an actionable calibration
 * conflict needing more evidence -> DIAGNOSTIC_CHECK, and finally the
 * ordinary PRACTICE-vs-REVIEW split for plain low-understanding/debt
 * concepts. Never selects MOCK_EXAM/CUMULATIVE_ASSESSMENT here --
 * EXAM_APPROACHING is a priority/urgency modifier (see BAND above), not
 * permission to ignore the student's actual cognitive state.
 */
export function selectActivityType(context: ConceptDecisionContext): ActivityType {
  const types = new Set(context.signals.map((s) => s.type));

  // Continuing an already-active repair beats starting anything new.
  if (types.has('REMEDIATION_ACTIVE')) return 'REMEDIATION';

  // Never remediate a root cause that hasn't been established yet.
  if (types.has('DIAGNOSIS_REQUIRED')) return 'DIAGNOSTIC_CHECK';

  // Persistent difficulty with no remediation/diagnosis infrastructure
  // yet: the deterministic corrective activity is targeted practice,
  // not a light REVIEW pass -- see docs/architecture for the rule.
  if (types.has('INTERVENTION_REQUIRED')) return 'PRACTICE';

  if (types.has('CRITICAL_MISCONCEPTION') || (context.knowledgeState?.criticalMisconceptionCount ?? 0) > 0) return 'PRACTICE';

  // Confirmed root cause, no remediation path started yet: act on the
  // prerequisite itself. Diagnosis is already resolved (state is
  // CONFIRMED), so DIAGNOSTIC_CHECK doesn't apply -- the smallest
  // existing activity consistent with Cognitive Learning Engine
  // semantics is a targeted PRACTICE pass on the prerequisite concept.
  if (types.has('PREREQUISITE_GAP')) return 'PRACTICE';

  // Phase 4-R: a pending verification is a DIFFERENT concern from
  // "no independent evidence exists yet" (INSUFFICIENT_INDEPENDENT_EVIDENCE,
  // below) -- it means an ASSESSMENT-mode attempt already ran and a
  // verification question already fired, and it's specifically THAT
  // in-progress verification that must be completed, not a fresh
  // independent check. `SOLO_VERIFY` is the exact existing ActivityType
  // for "complete an already-created verification requirement" (vs.
  // `SOLO_CHECK`'s "obtain initial independent evidence") -- selected
  // here, ahead of RETENTION_CHECK/TRANSFER, positioned at the same
  // precedence tier `computeLearningState` already gives
  // PENDING_VERIFICATION (right after misconception/prerequisite/
  // repair, ahead of retention/transfer/independence). The execution
  // layer (`learning-session-engine.service.ts`) resumes the EXISTING
  // attempt via `verificationAttemptId`/`quizSessionId` -- it never
  // creates a new one.
  if (types.has('VERIFICATION_PENDING')) return 'SOLO_VERIFY';

  const readiness = context.knowledgeState?.validationReadiness;
  if (readiness === 'WAITING_FOR_RETENTION' || types.has('RETENTION_REVIEW_DUE') || types.has('WAITING_FOR_RETENTION')) return 'RETENTION_CHECK';
  if (readiness === 'TRANSFER_REQUIRED' || types.has('TRANSFER_REQUIRED')) return 'TRANSFER';
  // Phase 4A/4B: same activity as INDEPENDENCE_GAP -- SOLO_CHECK is the
  // one existing ActivityType whose EvidenceMode is INDEPENDENT, which
  // is exactly the missing evidence this signal reports. Distinct from
  // SOLO_VERIFY above: SOLO_CHECK obtains INITIAL independent evidence
  // where none exists yet; SOLO_VERIFY completes an ALREADY-CREATED
  // verification requirement. Never confused (Phase 4-R Finding 12,
  // regression-tested).
  if (types.has('INDEPENDENCE_GAP') || types.has('INSUFFICIENT_INDEPENDENT_EVIDENCE')) return 'SOLO_CHECK';

  if (types.has('CALIBRATION_CONFLICT')) {
    const actionable = context.signals.some((s) => s.type === 'CALIBRATION_CONFLICT' && s.metadata.actionable === true);
    if (actionable) return 'DIAGNOSTIC_CHECK';
  }

  // Plain low-understanding/learning-debt: REVIEW when real evidence
  // already exists and mastery is past the earliest LEARNING stage
  // (there's something to refresh), PRACTICE when understanding itself
  // is still the actual gap (nothing to review yet).
  const understanding = context.knowledgeState?.understandingScore ?? null;
  const masteryState = context.knowledgeState?.masteryState;
  if (understanding !== null && masteryState && masteryState !== 'LEARNING' && masteryState !== 'UNKNOWN') return 'REVIEW';
  return 'PRACTICE';
}

/** What kind of learning problem is being targeted -- never confused with MasteryState, and derived from the same driving reason as the ActivityType above. */
export function selectTargetDimension(context: ConceptDecisionContext, activityType: ActivityType): TargetDimension {
  const types = new Set(context.signals.map((s) => s.type));

  if (types.has('REMEDIATION_ACTIVE')) {
    const pattern = context.signals.find((s) => s.type === 'REMEDIATION_ACTIVE')?.metadata.pattern;
    if (pattern === 'LOW_RETENTION') return 'RETENTION';
    if (pattern === 'LOW_INDEPENDENCE') return 'INDEPENDENCE';
    if (pattern === 'TRANSFER_WEAKNESS') return 'TRANSFER';
    if (pattern === 'OVERCONFIDENT') return 'MISCONCEPTION';
    return 'UNDERSTANDING';
  }
  if (types.has('DIAGNOSIS_REQUIRED') || types.has('PREREQUISITE_GAP')) return 'PREREQUISITE';
  if (types.has('INTERVENTION_REQUIRED')) return 'VALIDATION';
  if (types.has('CRITICAL_MISCONCEPTION') || types.has('RECURRING_MISCONCEPTION')) return 'MISCONCEPTION';
  if (activityType === 'RETENTION_CHECK') return 'RETENTION';
  if (activityType === 'TRANSFER') return 'TRANSFER';
  // Phase 4-R: VALIDATION, not INDEPENDENCE -- completing an
  // already-triggered verification is a "confirm/close the loop on
  // evidence we already have" concern (the same category as
  // INTERVENTION_REQUIRED/CALIBRATION_CONFLICT below), distinct from
  // SOLO_CHECK's "build initial independent evidence" (INDEPENDENCE).
  if (activityType === 'SOLO_VERIFY') return 'VALIDATION';
  if (activityType === 'SOLO_CHECK') return 'INDEPENDENCE';
  if (types.has('CALIBRATION_CONFLICT')) return 'VALIDATION';
  if (types.has('EXAM_APPROACHING') && context.signals.every((s) => s.type === 'EXAM_APPROACHING')) return 'EXAM_READINESS';
  return 'UNDERSTANDING';
}

/** Structured, source-attributed facts -- never an LLM-generated sentence. UI/localization compose the actual prose from these later, exactly like today-plan.service.ts's existing WhyThisFact layer. */
export function buildFacts(context: ConceptDecisionContext): LearningFact[] {
  const facts: LearningFact[] = [];
  for (const s of context.signals) {
    switch (s.type) {
      case 'EXAM_APPROACHING':
        facts.push({ kind: 'examApproaching', daysUntil: s.metadata.daysUntil });
        break;
      case 'LEARNING_DEBT':
        facts.push({ kind: 'learningDebt', severity: s.metadata.severity });
        break;
      case 'RETENTION_REVIEW_DUE':
        facts.push({ kind: 'retentionReviewDue', dueAt: s.dueAt });
        break;
      case 'WAITING_FOR_RETENTION':
        facts.push({ kind: 'waitingForRetention' });
        break;
      case 'TRANSFER_REQUIRED':
        facts.push({ kind: 'transferRequired' });
        break;
      case 'FORGETTING_RISK':
        facts.push({ kind: 'forgettingRisk', forgettingRisk: s.metadata.forgettingRisk });
        break;
      case 'INDEPENDENCE_GAP':
        facts.push({ kind: 'independenceGap', independentMastery: s.metadata.independentMastery, masteryScore: s.metadata.masteryScore });
        break;
      case 'RECURRING_MISCONCEPTION':
        facts.push({ kind: 'recurringMisconception', misconceptionCode: s.misconceptionCode, occurrenceCount: s.metadata.occurrenceCount });
        break;
      case 'CRITICAL_MISCONCEPTION':
        facts.push({ kind: 'criticalMisconception' });
        break;
      case 'PREREQUISITE_GAP':
        facts.push({ kind: 'prerequisiteGap', blockedConceptCount: s.metadata.blockedConceptCount, unlockValue: s.metadata.unlockValue });
        break;
      case 'DIAGNOSIS_REQUIRED':
        facts.push({ kind: 'diagnosisRequired' });
        break;
      case 'REMEDIATION_ACTIVE':
        facts.push({ kind: 'activeRemediation', pattern: s.metadata.pattern });
        break;
      case 'INTERVENTION_REQUIRED':
        facts.push({ kind: 'interventionRequired' });
        break;
      case 'AT_RISK':
        facts.push({ kind: 'atRisk' });
        break;
      case 'VALIDATION_DEADLINE_OVERDUE':
        facts.push({ kind: 'validationDeadlineOverdue', dueAt: s.dueAt });
        break;
      case 'VALIDATION_DEADLINE_APPROACHING':
        facts.push({ kind: 'validationDeadlineApproaching', dueAt: s.dueAt });
        break;
      case 'CALIBRATION_CONFLICT':
        facts.push({ kind: 'calibrationConflict', tags: s.metadata.tags, actionable: s.metadata.actionable });
        break;
      case 'LOW_UNDERSTANDING':
        facts.push({ kind: 'lowUnderstanding', understandingScore: s.metadata.understandingScore });
        break;
      case 'VERIFICATION_PENDING':
        facts.push({ kind: 'verificationPending', verificationAttemptId: s.verificationAttemptId, createdAt: s.metadata.createdAt });
        break;
      case 'INSUFFICIENT_INDEPENDENT_EVIDENCE':
        facts.push({ kind: 'insufficientIndependentEvidence', understandingScore: s.metadata.understandingScore });
        break;
      case 'REMEDIATION_UNFINISHED':
        break; // corroborates REMEDIATION_ACTIVE -- no redundant duplicate fact
      default:
        break;
    }
  }
  return facts;
}

/**
 * Phase 4B -- deterministic Learning State derivation. Pure: takes only
 * the same `ConceptDecisionContext` (`.signals` + `.knowledgeState`)
 * every other function in this file already operates on -- no new IO,
 * no new data source.
 *
 * EXPLICIT PRECEDENCE (most-severe-first; the first matching rule wins,
 * exactly like `evaluateSignal`'s own dominant-band ordering above --
 * never a weighted/compensating combination):
 *   1. NOT_STARTED -- no Knowledge State row yet, or masteryState UNKNOWN
 *      (Phase 2.2A: UNKNOWN means evidenceCount === 0 -- nothing to
 *      classify further).
 *   2. MISCONCEPTION_BLOCKED -- a critical misconception is active
 *      (Knowledge State's own criticalMisconceptionCount, or the
 *      CRITICAL_MISCONCEPTION signal -- either source is sufficient).
 *   3. PREREQUISITE_BLOCKED -- a confirmed root-cause gap (PREREQUISITE_GAP)
 *      or an unresolved diagnosis (DIAGNOSIS_REQUIRED) exists for this
 *      concept. This is a concept-EXTERNAL relational fact Knowledge
 *      State's own per-concept dimensions cannot see.
 *   4. NEEDS_REPAIR -- Phase 2.2B's own INTERVENTION_REQUIRED masteryState,
 *      or an active remediation/intervention signal.
 *   5. PENDING_VERIFICATION -- Phase 3/3-R's assessmentState.hasPendingVerification,
 *      surfaced as VERIFICATION_PENDING. A concept never reads as
 *      confirmed-independent while this is true, regardless of any
 *      score.
 *   6. INSUFFICIENT_INDEPENDENT_EVIDENCE -- Phase 3's lastIndependentEvidence
 *      is null despite otherwise-adequate understanding (the "high
 *      Practice performance, zero independent proof" case).
 *   7. RETENTION_RISK -- Phase 2.2B's own AT_RISK masteryState, or
 *      WAITING_FOR_RETENTION/a real forgetting-risk signal.
 *   8. TRANSFER_GAP -- Phase 2.2's own TRANSFER_REQUIRED validationReadiness,
 *      or the corresponding signal.
 *   9. VALIDATED -- masteryState is already VALIDATED_MASTERY and none
 *      of the above blocked it.
 *   10. DEVELOPING -- the residual case (LEARNING/DEVELOPING/
 *       PROVISIONAL_MASTERY with nothing blocking) -- real progress
 *       exists, just not yet validated.
 *
 * Historical facts never poison this: a RESOLVED misconception no
 * longer counts toward criticalMisconceptionCount (Phase 2C's own
 * "currently active" definition), a CLOSED remediation path no longer
 * produces a REMEDIATION_ACTIVE signal (remediation.service's own
 * "active" definition), and a past verification_attempts row with
 * `outcome IS NOT NULL` no longer counts toward hasPendingVerification
 * -- every one of these facts is read fresh, current-state-only, from
 * already-certified sources; this function adds no historical lookback
 * of its own.
 */
export function computeLearningState(context: ConceptDecisionContext): LearningState {
  const types = new Set(context.signals.map((s) => s.type));
  const ks = context.knowledgeState;

  if (!ks || ks.masteryState === 'UNKNOWN') return 'NOT_STARTED';
  if (ks.criticalMisconceptionCount > 0 || types.has('CRITICAL_MISCONCEPTION')) return 'MISCONCEPTION_BLOCKED';
  if (types.has('PREREQUISITE_GAP') || types.has('DIAGNOSIS_REQUIRED')) return 'PREREQUISITE_BLOCKED';
  if (ks.masteryState === 'INTERVENTION_REQUIRED' || types.has('REMEDIATION_ACTIVE') || types.has('INTERVENTION_REQUIRED')) return 'NEEDS_REPAIR';
  if (types.has('VERIFICATION_PENDING')) return 'PENDING_VERIFICATION';
  if (types.has('INSUFFICIENT_INDEPENDENT_EVIDENCE')) return 'INSUFFICIENT_INDEPENDENT_EVIDENCE';
  if (ks.masteryState === 'AT_RISK' || ks.validationReadiness === 'WAITING_FOR_RETENTION' || types.has('WAITING_FOR_RETENTION') || types.has('RETENTION_REVIEW_DUE') || types.has('FORGETTING_RISK')) {
    return 'RETENTION_RISK';
  }
  if (ks.validationReadiness === 'TRANSFER_REQUIRED' || types.has('TRANSFER_REQUIRED')) return 'TRANSFER_GAP';
  if (ks.masteryState === 'VALIDATED_MASTERY') return 'VALIDATED';
  return 'DEVELOPING';
}

export function buildLearningDecision(context: ConceptDecisionContext): LearningDecision {
  const { signal: primarySignal, band, modifier } = dominantSignal(context);
  const activityType = selectActivityType(context);
  const targetDimension = selectTargetDimension(context, activityType);
  // Clamped so a modifier can never cross into the next band -- the
  // whole point of a lexicographic policy (section 10's "must not be a
  // naive sum" requirement).
  const clampedModifier = Math.max(0, Math.min(999, modifier));
  const priorityScore = band * 1000 + clampedModifier;

  return {
    actionConceptId: context.actionConceptId,
    subjectId: context.subjectId,
    targetConceptIds: context.targetConceptIds,
    rootCauseConceptId: context.rootCauseConceptId,
    signals: context.signals,
    primarySignal,
    learningState: computeLearningState(context),
    targetDimension,
    activityType,
    pedagogicalPriority: priorityLabelForBand(band),
    temporalUrgency: computeTemporalUrgency(context),
    priorityScore,
    reasonCode: primarySignal.type,
    facts: buildFacts(context),
    remediationPathId: context.remediationPathIds[0],
    diagnosisId: context.diagnosisIds[0],
    occurrenceId: context.occurrenceIds[0],
    verificationAttemptId: context.verificationAttemptIds[0],
    quizSessionId: context.quizSessionIds[0],
    dueAt: earliestDueAt(context),
    policyVersion: ADAPTIVE_LEARNING_POLICY_VERSION,
  };
}

export function buildLearningDecisions(contexts: ConceptDecisionContext[]): LearningDecision[] {
  return contexts.map(buildLearningDecision);
}

/**
 * Deterministic total ordering, independent of input array order (a
 * stronger guarantee than relying on a stable sort preserving whatever
 * order the DB/Promise.all happened to return things in): priority band
 * first, then soonest deadline, then subjectId, then actionConceptId.
 */
export function rankLearningDecisions(decisions: LearningDecision[]): LearningDecision[] {
  return [...decisions].sort((a, b) => {
    if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
    const aDue = a.dueAt ? new Date(a.dueAt).getTime() : Number.POSITIVE_INFINITY;
    const bDue = b.dueAt ? new Date(b.dueAt).getTime() : Number.POSITIVE_INFINITY;
    if (aDue !== bDue) return aDue - bDue;
    if (a.subjectId !== b.subjectId) return a.subjectId < b.subjectId ? -1 : 1;
    if (a.actionConceptId !== b.actionConceptId) return a.actionConceptId < b.actionConceptId ? -1 : 1;
    return 0;
  });
}
