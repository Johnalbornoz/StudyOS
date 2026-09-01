import type { MasteryState, ValidationReadiness, DimensionScores as KnowledgeStateDimensionScores, StateReason } from '@/services/knowledge-state.service';
import type { ConfidenceCalibration, EvidenceStrength } from '@/services/learner-model.service';
import type { RecurringMisconception } from '@/services/misconception.service';

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
  activeCount: number;
  criticalCount: number;
  recurringCount: number;
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

export interface PrerequisiteGap {
  targetConceptId: string;
  prerequisiteConceptId: string;
  relationshipConfidence: number;
  prerequisiteMasteryScore: number | null;
  prerequisiteMasteryState: MasteryState | null;
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
  /** Present only when options.includeHistory is true. Sourced from decision_events -- see Phase 1C report §13. */
  stateHistory?: StateTransitionEvent[];
  /** Deferred to Phase 1E -- see Phase 1B §21. Always NOT_AVAILABLE_YET in Phase 1C. */
  prerequisiteGaps: Capability<PrerequisiteGap[]>;
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
  /** Deferred capabilities -- always NOT_AVAILABLE_YET in Phase 1C. Never fabricated. */
  learningVelocity: Capability<unknown>;
  helpDependency: Capability<unknown>;
  prerequisiteGaps: Capability<PrerequisiteGap[]>;
  dataQuality: DataQualitySummary;
}

export interface ProjectionOptions {
  /** Bounds getSubjectView/getOverview's concept enumeration. Never all concepts by default. */
  conceptIds?: string[];
  subjectIds?: string[];
  includeHistory?: boolean;
  /** Bounds getConceptView(...,{includeHistory:true})'s decision_events read. Default 20. */
  historyLimit?: number;
}
