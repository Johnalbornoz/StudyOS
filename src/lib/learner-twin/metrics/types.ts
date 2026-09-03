import type { MasteryState } from '@/services/knowledge-state.service';
import type { CalibrationLabel } from '@/services/learner-model.service';

/**
 * Phase 1E: derived learner metrics common contract.
 *
 * DERIVED METRIC != LEARNING DECISION. Every value here is a
 * measurement of past/current learner state, computed deterministically
 * from already-certified signals (Phase 0-1D). None of it is consumed
 * by any current decision algorithm (remediation, cognitive diagnosis,
 * tutor strategy) -- see the Phase 1E report's "Existing Decision
 * Consumer Invariant" section. It exists to be read by a FUTURE
 * Learning State & Decision Engine, not to reteach/advance/backtrack/
 * verify/space/transfer anything itself.
 *
 * `MetricResult<T>` is a PARALLEL type to Phase 1C's `Capability<T>`,
 * not a reuse of it -- deliberately. `Capability<T>`'s `NotYetAvailable`
 * means "this feature does not exist yet" (a build-time fact).
 * `MetricResult<T>`'s `unavailable` branch means "this specific
 * learner/concept does not currently have enough DATA" (a per-instance,
 * evidence-driven fact) -- a completely different axis. Both share the
 * same `{available: boolean}` discriminant shape for consistency.
 *
 * Phase 1E-R adds a THIRD, orthogonal axis for `DecisionContext`
 * specifically: `MetricProjection<T>` distinguishes "this metric was
 * never requested in THIS projection call" from "the metric was
 * requested and here is its (possibly still evidence-gated) result."
 * A projection must not eagerly compute expensive derived metrics a
 * caller did not ask for (external review finding A) -- but skipping
 * the computation must never be represented as `Capability`'s
 * `NOT_AVAILABLE_YET` (that would falsely claim the computation
 * doesn't exist) or as `MetricResult`'s `INSUFFICIENT_EVIDENCE` (that
 * would falsely claim the learner's data was checked and found
 * lacking). `{requested: false}` is neither -- it is simply "not asked
 * for this time." See getDecisionContext's `derivedMetrics` option.
 */
export type MetricUnavailableReason =
  | 'INSUFFICIENT_EVIDENCE'
  | 'INSUFFICIENT_TEMPORAL_HISTORY'
  | 'INSUFFICIENT_POLICY'
  | 'NOT_APPLICABLE';

export interface MetricUnavailable {
  available: false;
  reason: MetricUnavailableReason;
  /** Short, non-fabricated explanation of what evidence/policy is missing -- never a placeholder string. */
  detail: string;
}
export interface MetricAvailable<T> {
  available: true;
  value: T;
}
export type MetricResult<T> = MetricAvailable<T> | MetricUnavailable;

export function metricUnavailable(reason: MetricUnavailableReason, detail: string): MetricUnavailable {
  return { available: false, reason, detail };
}

/**
 * Phase 1E-R: whether a `DecisionContext`-only derived metric was
 * requested for THIS projection call at all. `requested: false` is the
 * default -- current live consumers (remediation, cognitive diagnosis,
 * tutor strategy) never ask for these, so they pay zero query cost for
 * them (see `getDecisionContext`'s `derivedMetrics` option). This is
 * deliberately a THIRD state, not a reuse of `Capability`'s
 * `NOT_AVAILABLE_YET` (the computation exists) or `MetricResult`'s
 * `INSUFFICIENT_EVIDENCE` (no evidence check was even performed).
 */
export interface MetricNotRequested {
  requested: false;
}
export interface MetricRequested<T> {
  requested: true;
  result: MetricResult<T>;
}
export type MetricProjection<T> = MetricNotRequested | MetricRequested<T>;

export const METRIC_NOT_REQUESTED: MetricNotRequested = { requested: false };
export function metricRequested<T>(result: MetricResult<T>): MetricRequested<T> {
  return { requested: true, result };
}

/**
 * The DecisionContext-only derived metrics a future Decision Engine may
 * explicitly request. Phase 2D/2E add `interventionState`/
 * `validationState` to the original Phase 1E three; Phase 3F adds
 * `assessmentState` -- same contract throughout: `{requested: false}`
 * by default, zero extra queries for current live consumers.
 */
export type DerivedMetricName =
  | 'helpDependency'
  | 'learningVelocity'
  | 'prerequisiteGaps'
  | 'interventionState'
  | 'validationState'
  | 'assessmentState';
export const ALL_DERIVED_METRIC_NAMES: readonly DerivedMetricName[] = [
  'helpDependency',
  'learningVelocity',
  'prerequisiteGaps',
  'interventionState',
  'validationState',
  'assessmentState',
];
export function metricAvailable<T>(value: T): MetricAvailable<T> {
  return { available: true, value };
}

/**
 * Attached to every derived metric value. `sourceType` is always
 * `DETERMINISTIC_DERIVATION` -- nothing in this module is an LLM
 * judgment call or a self-report. `modelVersion` is a plain code
 * constant per metric family (Step 26) -- bumped only if the metric's
 * deterministic logic changes in a way a future consumer must be able
 * to detect; not a configuration platform.
 */
export interface DerivedMetricQuality {
  sourceType: 'DETERMINISTIC_DERIVATION';
  sampleSize: number;
  lastUpdatedAt: string | null;
  /** 0-100 where the metric has a natural coverage/denominator concept (e.g. concepts with data / concepts considered). Omitted where not meaningful. */
  evidenceCoverage?: number;
  modelVersion: string;
}

export function quality(sampleSize: number, lastUpdatedAt: string | null, modelVersion: string, evidenceCoverage?: number): DerivedMetricQuality {
  return {
    sourceType: 'DETERMINISTIC_DERIVATION',
    sampleSize,
    lastUpdatedAt,
    modelVersion,
    ...(evidenceCoverage !== undefined ? { evidenceCoverage } : {}),
  };
}

// ---------------------------------------------------------------------
// 1. Help Dependency (student + concept)
// ---------------------------------------------------------------------

/**
 * Deliberately a component model, not a weighted score (Step 3): no
 * existing approved weighting between hints/AI-assistance/independence
 * was found in the codebase, so none was invented. `band` is always
 * `null` in Phase 1E for the same reason -- see the Phase 1E report §4.
 */
export interface HelpDependencyComponents {
  totalEvidenceCount: number;
  assistedEvidenceCount: number;
  independentEvidenceCount: number;
  assistedEvidenceShare: number; // 0-1
  independentEvidenceShare: number; // 0-1
  hintUsageShare: number; // 0-1, share of evidence rows with hints_used > 0
  /** Reuses learner-model.service.ts::getIndependentMastery verbatim -- may be null (its own <2-independent-rows sufficiency gate) even when this metric overall is `available`. */
  independentMastery: number | null;
  /** Null when the concept has zero resolved verification_attempts -- not 0. */
  verificationConsistency: {
    resolvedCount: number;
    confirmedCount: number;
    contradictedCount: number;
    inconclusiveCount: number;
    confirmedShare: number;
  } | null;
  /** Always null in Phase 1E -- no existing approved threshold to derive a band from. See the Phase 1E report §4. */
  band: null;
  quality: DerivedMetricQuality;
}

export const HELP_DEPENDENCY_MODEL_VERSION = 'v1';

// ---------------------------------------------------------------------
// 2. Learning Velocity (student + concept, and student/subject aggregate)
// ---------------------------------------------------------------------

/**
 * Disambiguates "not yet reached" from "reached, but before Phase 0E2's
 * decision_events audit trail began recording (2026-08-31)" -- Step 6.
 * Never estimated, never backfilled.
 */
export interface MilestoneTiming {
  reached: boolean;
  /** Only meaningful when reached=true. False means "reached before Phase 0E2's audit trail began (2026-08-31) -- date unknown, never estimated." Always false when reached=false. */
  historyComplete: boolean;
  /** Non-null only when reached=true AND historyComplete=true. */
  at: string | null;
}

export interface LearningVelocitySummary {
  firstEvidenceAt: string;
  provisionalMastery: MilestoneTiming;
  validatedMastery: MilestoneTiming;
  calendarDaysToProvisional: number | null;
  activeStudyDaysToProvisional: number | null;
  calendarDaysToValidated: number | null;
  activeStudyDaysToValidated: number | null;
  /** Largest gap, in days, between consecutive distinct active-study dates observed for this concept. Null with fewer than 2 active-study dates. */
  longestInactiveGapDays: number | null;
  quality: DerivedMetricQuality;
}

export interface AggregateVelocitySummary {
  medianCalendarDaysToProvisional: number | null;
  medianActiveStudyDaysToProvisional: number | null;
  medianCalendarDaysToValidated: number | null;
  medianActiveStudyDaysToValidated: number | null;
  /** Concepts contributing a historyComplete milestone timing -- the only ones the median is computed from. */
  qualifyingConceptCount: number;
  /** Concepts considered (evidenced concepts in scope) -- lets a caller see the aggregate's real coverage, per Step 8. */
  totalConceptCount: number;
  quality: DerivedMetricQuality;
}

export const LEARNING_VELOCITY_MODEL_VERSION = 'v1';

// ---------------------------------------------------------------------
// 3. Aggregate Confidence Calibration (student, and student + subject)
// ---------------------------------------------------------------------

export interface AggregateCalibrationSummary {
  /** Median of qualifying concepts' own computeConfidenceCalibration().score -- magnitude of calibration quality only (0-100, higher = better calibrated). Direction (over/under) is NOT collapsed into one aggregate label -- see labelDistribution. */
  medianCalibrationScore: number | null;
  /** Count of qualifying concepts by their own certified label -- exposes distribution honestly instead of fabricating one direction for the whole learner/subject (Step 10). */
  labelDistribution: Record<CalibrationLabel, number>;
  /** Concepts with >= the atomic function's own minimum-sample threshold (computeConfidenceCalibration's CALIBRATION_MIN_SAMPLES, reused unmodified via its own INSUFFICIENT_EVIDENCE label). */
  qualifyingConceptCount: number;
  /** Concepts with at least 1 confidence-tagged evidence row, even below the qualifying threshold. */
  totalRelevantConceptCount: number;
  totalConfidenceSamples: number;
  quality: DerivedMetricQuality;
}

export const CALIBRATION_AGGREGATE_MODEL_VERSION = 'v1';
/**
 * Phase-1E-introduced minimum, NOT derived from existing policy (none
 * exists for aggregate calibration) -- documented, not silently
 * invented. A median of 1 concept is not a real aggregate.
 *
 * Phase 1E-R classification (external review, Step 16):
 * APPROVED_AS_EVIDENCE_GATE. This constant answers only "is there
 * enough data for a statistically meaningful median" -- it gates
 * whether `AggregateCalibrationSummary` is computed at all. It MUST
 * NOT become a pedagogical decision threshold (e.g. "below this many
 * concepts, treat the learner as uncalibrated") -- no code anywhere
 * uses it that way, and none should. The value itself was not
 * reconsidered/changed by this classification review.
 */
export const AGGREGATE_CALIBRATION_MIN_QUALIFYING_CONCEPTS = 2;

// ---------------------------------------------------------------------
// 4. Prerequisite Gaps (student + concept)
// ---------------------------------------------------------------------

export interface PrerequisiteGapDetail {
  targetConceptId: string;
  prerequisiteConceptId: string;
  prerequisiteLabel: string;
  relationshipConfidence: number;
  prerequisiteMasteryScore: number | null;
  prerequisiteMasteryState: MasteryState | null;
  /**
   * True when the prerequisite's own already-certified MasteryState is
   * below PROVISIONAL_MASTERY (or no Knowledge State row exists at
   * all). Deliberately reuses the EXISTING categorical classification
   * the Knowledge State projector already produces (via real
   * mastery_policies thresholds) rather than inventing a new numeric
   * cutoff like `relationshipConfidence * (100 - mastery)` -- see the
   * Phase 1E report §7 for why that formula was rejected.
   */
  gap: boolean;
}

export interface PrerequisiteGapsSummary {
  gaps: PrerequisiteGapDetail[];
  gapCount: number;
  totalPrerequisiteCount: number;
  quality: DerivedMetricQuality;
}

export const PREREQUISITE_GAP_MODEL_VERSION = 'v1';

// ---------------------------------------------------------------------
// 5. Transfer Coverage (student + subject)
// ---------------------------------------------------------------------

export interface TransferCoverageSummary {
  transferEvidenceCount: number;
  successfulTransferCount: number;
  /** Concepts (within eligibleConceptCount) with >= 1 TRANSFER-source learning_evidence row. */
  coveredConceptCount: number;
  /**
   * Concepts in this subject where the student has a mastery_records
   * row -- i.e. concepts they have actually engaged with. NOT the full
   * subject curriculum (Step 13): a concept the student has never
   * touched cannot fairly be called "transfer-eligible" yet.
   */
  eligibleConceptCount: number;
  coveragePercent: number | null;
  lastTransferAt: string | null;
  quality: DerivedMetricQuality;
}

export const TRANSFER_COVERAGE_MODEL_VERSION = 'v1';

// ---------------------------------------------------------------------
// 6. Study Plan Adherence (student, learner-level -- plans span subjects)
// ---------------------------------------------------------------------

export interface StudyPlanAdherenceSummary {
  windowStart: string; // date (YYYY-MM-DD)
  windowEnd: string; // date (YYYY-MM-DD), never later than "today"
  scheduledSessions: number;
  /**
   * Phase 1E-R: a session counts as completed only when learning_evidence
   * exists for a CONCEPT that session's OWN study_session_items planned,
   * on that session's own scheduled_date -- concept-level matching, not
   * exact-question identity, but never "any evidence that day" regardless
   * of subject. See study-plan-adherence.ts's own doc comment for the
   * external-review finding this corrected.
   */
  completedSessions: number;
  missedSessions: number;
  completionRate: number | null;
  quality: DerivedMetricQuality;
}

export const STUDY_PLAN_ADHERENCE_MODEL_VERSION = 'v1';

// ---------------------------------------------------------------------
// 7. Persistence / Recovery Summary (student + concept)
// ---------------------------------------------------------------------

export interface PersistenceSummary {
  /** A maximal run of consecutive `incorrect` evidence rows = one episode. */
  failureEpisodeCount: number;
  /** Episodes where at least one more evidence row exists afterward (of any result). */
  returnAfterFailureCount: number;
  /** Episodes where a `correct` evidence row exists at any point afterward. */
  recoveryAfterFailureCount: number;
  /** Episodes with no later `correct` evidence (whether the learner returned or not). */
  unresolvedFailureCount: number;
  /** Length of the trailing run of `incorrect` evidence at the very end of the chronological sequence. 0 if the most recent evidence isn't incorrect. */
  currentConsecutiveFailureStreak: number;
  quality: DerivedMetricQuality;
}

export const PERSISTENCE_MODEL_VERSION = 'v1';
