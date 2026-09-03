import type { MasteryState, ValidationReadiness, DimensionScores as KnowledgeStateDimensionScores, StateReason } from '@/services/knowledge-state.service';
import type { ConfidenceCalibration, EvidenceStrength } from '@/services/learner-model.service';
import type { RecurringMisconception } from '@/services/misconception.service';
import type {
  MetricResult,
  MetricProjection,
  DerivedMetricName,
  HelpDependencyComponents,
  LearningVelocitySummary,
  AggregateVelocitySummary,
  AggregateCalibrationSummary,
  PrerequisiteGapsSummary,
  TransferCoverageSummary,
  StudyPlanAdherenceSummary,
  PersistenceSummary,
} from './metrics/types';

/**
 * Logical StudyUs learner identifier (Phase 1C). Currently represented
 * by the SAME UUID value in both `students.id` and `profiles.id`,
 * under the certified compatibility contract (Phase 0C's identity
 * doc block in src/lib/auth.ts). The Digital Learning Twin's public
 * contract treats this as ONE opaque identifier -- it never exposes,
 * to a caller, which underlying FK family (`students`/`profiles`) a
 * given field's query actually used. Individual internal sub-readers
 * (src/lib/learner-twin/readers.ts) may query either table family as
 * appropriate to the domain they read from -- that split is an
 * internal implementation detail, never part of this module's public
 * types or function signatures.
 *
 * This is a plain alias, not a branded type -- every existing call
 * site in the app already passes a plain `string` studentId (from
 * `getOrCreateStudentId`), and introducing a hard brand here would
 * force a cast at every one of them for no real type-safety gain,
 * since there is no risk of confusing it with a different identifier
 * *type* in this codebase (conceptId/subjectId are equally plain
 * strings throughout). See the Phase 1C report's identity section for
 * the full reasoning.
 */
export type StudentId = string;

// ---------------------------------------------------------------------
// Data quality / provenance contract (Phase 1B Step 5, implemented practically)
// ---------------------------------------------------------------------

export type SignalSourceType =
  | 'SYSTEM_FACT'
  | 'DETERMINISTIC_DERIVATION'
  | 'AI_INFERENCE'
  | 'STUDENT_SELF_REPORT'
  | 'SCHOOL_REPORTED'
  | 'BEHAVIOR_OBSERVATION';

/**
 * Quality/provenance metadata attached at meaningful signal or group
 * boundaries -- never on every individual primitive (Phase 1C Step 7).
 * Only `sourceType` is always required; every other field is present
 * only when it is meaningful for that particular signal. Confidence is
 * never fabricated for a deterministic fact -- see the Phase 1C report
 * for the exact per-field rules.
 */
export interface SignalQuality {
  sourceType: SignalSourceType;
  lastUpdatedAt: string | null;
  sampleSize?: number;
  confidence?: number; // 0-1
  provenance?: { aiExecutionId?: string; algorithmVersion?: string };
}

/**
 * A future (Phase 1D/1E) capability that does not exist yet at
 * runtime. Never fabricated as 0/null-that-looks-like-a-real-value --
 * always explicit about *why* it is absent. `available` is the
 * discriminant a caller must check before reading `.value`.
 */
export type NotYetAvailable = {
  available: false;
  reason: 'NOT_AVAILABLE_YET';
  plannedPhase?: '1D' | '1E';
};
export type Capability<T> = { available: true; value: T } | NotYetAvailable;

export function notYetAvailable(plannedPhase?: '1D' | '1E'): NotYetAvailable {
  return { available: false, reason: 'NOT_AVAILABLE_YET', plannedPhase };
}
export function available<T>(value: T): { available: true; value: T } {
  return { available: true, value };
}

// ---------------------------------------------------------------------
// Shared building blocks
// ---------------------------------------------------------------------

export interface MasterySignal {
  score: number; // 0-100, mastery_records.mastery_score
  confidenceScore: number; // mastery_records.confidence_score (algorithmic, distinct from self-reported confidence)
  attemptCount: number;
  correctCount: number;
  incorrectCount: number;
  quality: SignalQuality;
}

export interface KnowledgeStateSignal {
  masteryState: MasteryState;
  dimensions: KnowledgeStateDimensionScores;
  validationReadiness: ValidationReadiness;
  stateReason: StateReason | null;
  quality: SignalQuality;
}

export interface RetentionSignal {
  retentionScore: number | null; // Knowledge State dimension (0-100)
  forgettingRisk: number | null; // 0-100, calculateForgettingRisk
  lastRetrievalAt: string | null; // mastery_records.last_practiced
  nextReviewAt: string | null; // mastery_records.next_review_date
  quality: SignalQuality;
}

export interface TransferSignal {
  transferScore: number | null;
  quality: SignalQuality;
}

export interface MetacognitionSignal {
  confidence: number | null; // average self-reported confidence, 0-100
  confidenceCalibration: ConfidenceCalibration;
  quality: SignalQuality;
}

export interface IndependenceSignal {
  independentMastery: number | null;
  evidenceStrength: EvidenceStrength | null;
  quality: SignalQuality;
}

export interface MisconceptionSummary {
  /** Phase 2C: CURRENTLY ACTIVE signatures only -- never a lifetime count. */
  activeCount: number;
  /** Phase 2C: ACTIVE + critical only -- what actually gates VALIDATED_MASTERY. A resolved critical misconception is not counted here. */
  criticalCount: number;
  /** Phase 2C: ACTIVE + occurrence_count >= 2 only. */
  recurringCount: number;
  /** Phase 2C, additive: currently RESOLVED signature count -- real learner history, not a current defect. */
  resolvedCount: number;
  quality: SignalQuality;
}

export interface EvidenceSummary {
  timestamp: string;
  sourceType: string;
  result: string;
  scorePercent: number | null;
  aiAssistanceType: string;
  learningMode: string | null;
}

export interface ErrorPatternSummary {
  errorType: string;
  count: number;
  lastOccurredAt: string;
}

// ---------------------------------------------------------------------
// Behavioral evidence (Phase 1D) -- RAW OBSERVATION only. This is
// captured fact, not interpretation: no FAST/SLOW/GUESS/FLUENT/
// STRUGGLE classification exists anywhere in this module. That
// derivation (item complexity, question type, learner baseline, sample
// size) is explicitly deferred to Phase 1E -- see the Phase 1D report.
// ---------------------------------------------------------------------

/** One response-time sample read back from learning_evidence.metadata.behavior. Only VALID/OUTLIER ever carry a real ms value -- see src/lib/algorithms/response-timing.ts. */
export interface ResponseTimingObservation {
  responseTimeMs: number;
  timingQuality: 'VALID' | 'OUTLIER';
  /** learning_evidence.timestamp of the row this observation came from -- NOT the client's own presentation/submission timestamps, which are not persisted (Step 10 data minimization). */
  observedAt: string;
  questionIndex?: number;
}

/**
 * Phase 1D-R: three mutually exclusive, unambiguous sample categories
 * -- no observation is ever counted in more than one.
 *
 *   validSampleCount   = quality === 'VALID' ONLY. The only class any
 *                        default analytical use (a future Phase 1E
 *                        minimum-sample gate, an average, etc.) may
 *                        treat as a usable behavioral sample.
 *   outlierSampleCount = quality === 'OUTLIER'. A REAL submitted
 *                        observation beyond the accepted ceiling --
 *                        preserved for transparency (also still present
 *                        in recentObservations), but NOT usable by
 *                        default. A future algorithm may deliberately
 *                        opt into outliers; nothing today does.
 *   invalidSampleCount = quality === 'INVALID' or 'CLOCK_SKEW'. No
 *                        usable duration exists for these at all.
 *
 * MISSING samples are never stored (Step 10 data minimization) and so
 * are not counted anywhere here -- see the Phase 1D report.
 */
export interface ResponseTimingSignal {
  /** Bounded, most-recent-first. Includes VALID and OUTLIER observations (both carry a real duration) -- INVALID/CLOCK_SKEW never appear here, since they have no duration to show. Empty when the concept has no timing-instrumented evidence yet -- NO_TIMING_DATA, never fabricated as 0ms or "fast". */
  recentObservations: ResponseTimingObservation[];
  /** quality === 'VALID' only. Use this for any default analytical/sample-size purpose. */
  validSampleCount: number;
  /** quality === 'OUTLIER' only. Preserved for transparency, deliberately excluded from validSampleCount. */
  outlierSampleCount: number;
  /** quality === 'INVALID' or 'CLOCK_SKEW'. No usable duration; distinct from outliers, which do have one. */
  invalidSampleCount: number;
  /** sampleSize here always equals validSampleCount -- never inflated by outliers. */
  quality: SignalQuality;
}

export interface StateTransitionEvent {
  decisionId: string;
  decisionType: 'MASTERY_UPDATED' | 'KNOWLEDGE_STATE_PROJECTED';
  createdAt: string;
  previousState: Record<string, unknown> | null;
  newState: Record<string, unknown> | null;
  reasonCode: string | null;
}

export interface LanguageContext {
  interfaceLanguage: string;
  preferredLearningLanguage: string;
  sourceContentLanguage: string;
  /** Only present when resolving for a specific subject -- subject-level overrides applied. */
  subjectInstructionLanguage?: string;
  quizLanguageMode?: 'match_interface' | 'fixed_english';
  quality: SignalQuality;
}

export interface AcademicContext {
  countryOfStudy: string;
  schoolYear: string | null;
  curriculumType: string;
  ibProgramme: 'MYP' | 'DP' | null;
  ibYear: string | null;
  academicYear: string | null;
  schoolName: string | null;
  profileCompleted: boolean;
  quality: SignalQuality;
}

export interface SubjectAcademicContext {
  ibSubjectGroup: string | null;
  ibLevel: string | null;
  targetLanguage: string | null;
  quizLanguageMode: 'match_interface' | 'fixed_english';
}

export interface PlanningContext {
  studyStartTime: string;
  studyEndTime: string;
  maxDailyMinutes: number;
  timezone: string;
  quality: SignalQuality;
}

export interface AssessmentPressure {
  upcomingOccurrence: boolean;
  daysUntil: number | null;
  examReadiness: number | null;
  quality: SignalQuality;
}

export interface DataQualitySummary {
  generatedAt: string;
  sourcesUsed: SignalSourceType[];
}

// ---------------------------------------------------------------------
// Projections
// ---------------------------------------------------------------------

export interface SubjectSummary {
  subjectId: string;
  subjectName: string;
  academicContext: SubjectAcademicContext;
  avgMasteryPercent: number | null;
  conceptCount: number;
  evidenceCoveragePercent: number | null;
}

export interface LearnerModel {
  studentId: StudentId;
  generatedAt: string;
  academicContext: AcademicContext;
  languageContext: LanguageContext;
  subjects: SubjectSummary[];
  planningContext: PlanningContext;
  /** Learner-level aggregate metrics that can already be truthfully computed today. Future metrics are absent, never fabricated -- see the Phase 1C report §15. */
  derivedMetrics: {
    evidenceCoveragePercent: number | null;
  };
  /** Phase 1E: derived learner metrics, learner-wide (pooled across all subjects). See docs/architecture/digital-learning-twin.md's "Derived Learner Metrics" section. */
  calibration: MetricResult<AggregateCalibrationSummary>;
  velocitySummary: MetricResult<AggregateVelocitySummary>;
  studyPlanAdherence: MetricResult<StudyPlanAdherenceSummary>;
  dataQuality: DataQualitySummary;
}

export interface ConceptSummary {
  conceptId: string;
  label: string;
  mastery: MasterySignal;
  knowledgeState: Pick<KnowledgeStateSignal, 'masteryState' | 'dimensions'>;
  needsAttention: { description: string; occurrenceCount: number }[];
}

export interface NeedsAttentionItem {
  conceptId: string;
  conceptLabel: string;
  severity: number;
}

export interface SubjectView {
  studentId: StudentId;
  subjectId: string;
  subjectName: string;
  generatedAt: string;
  academicContext: SubjectAcademicContext;
  cognitiveSummary: {
    avgMasteryPercent: number | null;
    avgRetentionScore: number | null;
    avgIndependentMastery: number | null;
    avgConfidenceCalibration: number | null;
    /** Full detail (not just the percent) -- the subject detail page's existing output needs evidencedConcepts/totalConcepts too. */
    evidenceCoverage: { totalConcepts: number; evidencedConcepts: number; percent: number } | null;
    activeLearningDebtCount: number;
    atRiskCount: number;
  };
  concepts: ConceptSummary[];
  needsAttention: NeedsAttentionItem[];
  /** Phase 1E: derived learner metrics, scoped to this subject. */
  aggregateCalibration: MetricResult<AggregateCalibrationSummary>;
  aggregateVelocity: MetricResult<AggregateVelocitySummary>;
  transferCoverage: MetricResult<TransferCoverageSummary>;
  dataQuality: DataQualitySummary;
}

export interface ConceptView {
  studentId: StudentId;
  conceptId: string;
  subjectId: string;
  conceptLabel: string;
  generatedAt: string;
  mastery: MasterySignal;
  knowledgeState: KnowledgeStateSignal;
  independence: IndependenceSignal;
  metacognition: MetacognitionSignal;
  retention: RetentionSignal;
  transfer: TransferSignal;
  misconceptions: MisconceptionSummary;
  recentEvidence: EvidenceSummary[];
  errorPatterns: ErrorPatternSummary[];
  assessmentContext: AssessmentPressure;
  /** Phase 1D: RAW OBSERVATION only -- see ResponseTimingSignal's doc comment. Not present on DecisionContext: no current decision consumer exists for it (Phase 1B/1D rule -- raw timing never goes into DecisionContext without one). */
  behavior: { responseTiming: ResponseTimingSignal };
  /** Present only when options.includeHistory is true. Sourced from decision_events -- see Phase 1C report §13. */
  stateHistory?: StateTransitionEvent[];
  /** Phase 1E: implemented -- see docs/architecture/digital-learning-twin.md's "Derived Learner Metrics" section. Each is independently evidence-gated; `available: false` is a valid, honest output, never a fabricated value. */
  prerequisiteGaps: MetricResult<PrerequisiteGapsSummary>;
  helpDependency: MetricResult<HelpDependencyComponents>;
  learningVelocity: MetricResult<LearningVelocitySummary>;
  persistence: MetricResult<PersistenceSummary>;
  dataQuality: DataQualitySummary;
}

export interface DecisionContext {
  studentId: StudentId;
  conceptId: string;
  subjectId: string;
  generatedAt: string;
  mastery: { score: number; confidence: number };
  knowledgeState: Pick<KnowledgeStateSignal, 'masteryState' | 'dimensions' | 'validationReadiness'>;
  metacognition: { confidenceCalibration: ConfidenceCalibration };
  independence: { independentMastery: number | null; evidenceStrength: EvidenceStrength | null };
  retention: { retentionScore: number | null; forgettingRisk: number | null; nextReviewAt: string | null };
  misconceptions: { activeCount: number; criticalCount: number; recurringCount: number };
  recentEvidence: EvidenceSummary[];
  assessmentPressure: AssessmentPressure;
  availability: { dailyMinutes: number };
  /**
   * Phase 1E: implemented, exposed ONLY as inputs for a FUTURE Learning
   * State & Decision Engine -- Step 24's invariant: no current
   * consumer (remediation/cognitive-diagnosis/tutor-strategy) reads
   * these fields, and this phase does not change that.
   *
   * Phase 1E-R: each is a `MetricProjection<T>`, not a bare
   * `MetricResult<T>` (and no longer wrapped in `Capability` -- that
   * wrapping was for "not built yet," which stopped being true in
   * Phase 1E). `getDecisionContext` computes these ONLY when the
   * caller's `options.derivedMetrics` explicitly requests them
   * (external review finding A: a projection must not eagerly compute
   * expensive data its caller didn't ask for). Default (no
   * `derivedMetrics` option): all three are `{requested: false}` and
   * zero additional queries run for them -- proven by a release-blocking
   * query-count regression test. A future Decision Engine passes
   * `{derivedMetrics: ['helpDependency', ...]}` or `{derivedMetrics: 'all'}`
   * to receive the real `MetricResult<T>` (itself still evidence-gated).
   */
  learningVelocity: MetricProjection<LearningVelocitySummary>;
  helpDependency: MetricProjection<HelpDependencyComponents>;
  prerequisiteGaps: MetricProjection<PrerequisiteGapsSummary>;
  dataQuality: DataQualitySummary;
}

/**
 * Phase 1E-R: which of DecisionContext's future-Decision-Engine-only
 * derived metrics (helpDependency/learningVelocity/prerequisiteGaps)
 * to actually compute for this `getDecisionContext` call. Omitted or
 * `undefined` -- the default -- computes NONE of them (current live
 * consumers never need them and must not pay their query cost).
 * `'all'` or an explicit array requests specific ones. Has no effect
 * on `getConceptView`/`getSubjectView`/`getOverview`, which continue
 * to compute their own derived metrics unconditionally (Finding A was
 * specific to DecisionContext's per-candidate-loop cost).
 */
export type DerivedMetricSelection = 'all' | DerivedMetricName[];

export interface ProjectionOptions {
  /** Bounds getSubjectView/getOverview's concept enumeration. Never all concepts by default. */
  conceptIds?: string[];
  subjectIds?: string[];
  includeHistory?: boolean;
  /** Bounds getConceptView(...,{includeHistory:true})'s decision_events read. Default 20. */
  historyLimit?: number;
  /** getDecisionContext only -- see DerivedMetricSelection's own doc comment. Default: none computed. */
  derivedMetrics?: DerivedMetricSelection;
}
