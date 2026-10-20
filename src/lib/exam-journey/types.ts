/**
 * Student Exam Journey V2 -- J2 resolver CONTRACT (types only).
 *
 * Design: docs/journey/STUDENT_EXAM_JOURNEY_V2.md (§B state machine, §L data
 * requirements, §O approved decisions). The journey state is DERIVED from facts
 * and never stored: `resolveStudentExamJourney(facts)` is pure and
 * deterministic. The facts are what Exam Core, the catalogue / Blueprint, the
 * Question Bank and the Learning OS already know; a fact that does not exist
 * yet is passed as `null` / empty and the resolver says so (a reason), it
 * never invents it.
 */
import type { ReadinessState } from '@/lib/exam-core/catalog/readiness';
import type { Capability, UnavailableReason } from '@/lib/exam-core/objectives/capabilities';
import type { RecommendationAction, RequirementStatus } from '@/lib/exam-core/objectives/preparation-plan';
import type { ContextField, InstitutionalContextSummary } from './institutional-context';
import type { TargetDateSource, TargetScheduleFacts } from './exam-target';

// ------------------------------------------------------------------ phases / states (design §B.3)

/** The 7 phases of the design. No second taxonomy. */
export const JOURNEY_PHASES = ['NONE', 'HORIZON', 'ACTIVATION', 'PREPARATION', 'SIMULATION', 'PROJECTION', 'CLOSING'] as const;
export type JourneyPhase = (typeof JOURNEY_PHASES)[number];

/** Learner-level states (design §B.2). They qualify the Student, never a target. */
export const LEARNER_STATES = ['NO_ACADEMIC_PROFILE', 'EXAM_ONLY_PROFILE', 'ACADEMIC_PATH_DEFINED'] as const;
export type LearnerJourneyState = (typeof LEARNER_STATES)[number];

/** Target-level states, grouped by phase (design §B.3). */
export const PHASE_STATES = {
  NONE: ['NO_EXAM_TARGET'],
  HORIZON: ['FUTURE_EXAM_IDENTIFIED', 'EXAM_PREPARATION_NOT_DUE', 'FOUNDATION_BUILDING'],
  ACTIVATION: ['EXAM_READINESS_AVAILABLE', 'DIAGNOSTIC_DUE'],
  PREPARATION: ['PREPARATION_ACTIVE', 'PRACTICE_ACTIVE', 'PAPER_TRAINING'],
  SIMULATION: ['MOCK_AVAILABLE', 'MOCK_1_COMPLETED', 'EARLY_PREDICTION_AVAILABLE', 'REINFORCEMENT_ACTIVE', 'MOCK_2_AVAILABLE', 'MOCK_2_COMPLETED', 'UPDATED_PREDICTION_AVAILABLE'],
  PROJECTION: ['ADDITIONAL_COMPONENTS_REQUIRED', 'FULL_PREDICTION_AVAILABLE'],
  CLOSING: ['FINAL_PREPARATION', 'EXAM_READY', 'EXAM_COMPLETED', 'RESULT_RECORDED'],
} as const satisfies Record<JourneyPhase, readonly string[]>;
export type JourneyState = (typeof PHASE_STATES)[JourneyPhase][number];

/**
 * Every state of the design -> its phase. The brief's 24 states (22 target
 * states + NO_ACADEMIC_PROFILE + ACADEMIC_PATH_DEFINED) plus the design's
 * EXAM_ONLY_PROFILE. Learner-level states belong to phase NONE: they describe
 * the Student-level layer that exists before (or without) any target.
 */
export const STATE_PHASE: Record<JourneyState | LearnerJourneyState, JourneyPhase> = {
  NO_ACADEMIC_PROFILE: 'NONE',
  EXAM_ONLY_PROFILE: 'NONE',
  ACADEMIC_PATH_DEFINED: 'NONE',
  ...(Object.fromEntries(
    (Object.entries(PHASE_STATES) as Array<[JourneyPhase, readonly JourneyState[]]>).flatMap(([phase, states]) => states.map((s) => [s, phase]))
  ) as Record<JourneyState, JourneyPhase>),
};

// ------------------------------------------------------------------ blockers (orthogonal to states)

/**
 * A blocker says an action CANNOT happen (it is impossible, not merely not
 * recommended -- O-04). A recommendation is never a blocker.
 */
export type BlockerCode =
  | 'BLUEPRINT_INCOMPLETE' // no verified structure for the target (catalogue only / no published version)
  | 'BLUEPRINT_VERSION_INVALID' // the syllabus / version is known to be invalid for the target
  | 'CONTENT_UNAVAILABLE' // the structure exists but the Question Bank cannot run the mode
  | 'TARGET_EXAM_UNCONFIRMED' // a suggested target the Student has not confirmed
  | 'EXAM_DATE_UNKNOWN' // no date / session: the preparation window cannot be computed
  | 'INSTITUTIONAL_RELEASE_REQUIRED' // an institution-gated exam not yet released to the Student
  | 'ATTEMPT_IN_PROGRESS' // Exam Core allows one open attempt per preparation
  | 'NO_CONCEPT_MAPPINGS' // no reviewed requirement -> concept links: no learning bridge
  | 'PREDICTION_MODEL_UNAVAILABLE' // O-02 NO_MODEL: no projection of any kind
  | 'PREDICTION_NOT_READY' // a model exists, the evidence does not support a projection yet
  | 'REQUIRED_COMPONENT_MISSING' // a non-simulated component (e.g. IA) has no usable estimate
  | 'INSTITUTION_CONTEXT_INCOMPLETE' // J1: a fact the target needs is institution-owned and missing (never asked to the Student)
  | 'ACADEMIC_CONTEXT_CONFLICT'; // J1: institution and Student (or two institutional sources) disagree on a fact the target needs

export type BlockerScope = 'TARGET' | 'STRUCTURE' | 'PRACTICE' | 'DIAGNOSTIC' | 'MOCK' | 'LEARNING_BRIDGE' | 'PREDICTION';
export type DetailValue = string | number | boolean | null;
export interface JourneyBlocker {
  code: BlockerCode;
  scope: BlockerScope;
  detail?: Record<string, DetailValue>;
}

// ------------------------------------------------------------------ facts (INPUT contract)

export type TargetSource = 'STUDENT' | 'EXAM_INSTANCE' | 'INSTITUTION' | 'INSTITUTION_ASSIGNMENT';
export type TargetConfirmation = 'ASSIGNED' | 'CONFIRMED' | 'SUGGESTED' | 'NOT_CONFIRMED';
export type EstimateSource = 'STUDENT_ESTIMATE' | 'TEACHER_ESTIMATE' | 'TEACHER_MARKED' | 'MODERATED';
/** O-02: the ONLY prediction model classes. */
export type PredictionModelClass = 'OFFICIAL_OR_KNOWN_MODEL' | 'HISTORICAL_ESTIMATE' | 'NO_MODEL';
export type ProvenanceSource = 'INSTITUTION' | 'STUDENT';
/**
 * O-06 (APPROVED): provenance of an exam result. Only VERIFIED_DOCUMENT and
 * OFFICIAL_INTEGRATION are verified; a result a Student types in is never
 * verified, and StudyUs never alters an official result.
 */
export type ResultProvenance = 'STUDENT_REPORTED' | 'INSTITUTION_REPORTED' | 'VERIFIED_DOCUMENT' | 'OFFICIAL_INTEGRATION';
export const VERIFIED_RESULT_PROVENANCES: readonly ResultProvenance[] = ['VERIFIED_DOCUMENT', 'OFFICIAL_INTEGRATION'];

export interface LearnerFacts {
  /** The Student's own academic profile (self-declared), or null when there is none. */
  academicProfile: {
    complete: boolean;
    countryCode: string | null;
    gradeLevel: number | null;
    programmeId: string | null;
    academicSubjects: Array<{ academicSubjectId: string; level: string | null }>;
  } | null;
  /** What the institution already knows (ACTIVE enrollments in ACTIVE classes). */
  institution: {
    activeEnrollments: number;
    classProgrammes: Array<{ classId: string; programmeId: string | null; academicSubjectId: string | null }>;
    assignedObjectiveKeys: string[];
    /** J1.2: the resolved institutional context (status, missing links, conflicts, provenance). Absent = not loaded. */
    context?: InstitutionalContextSummary;
  };
  subjectCount: number;
  examTargetCount: number;
}

export interface ExamTargetFacts {
  /** student_exam_profiles.id; null for an institution assignment not yet taken up as a preparation. */
  examTargetId: string | null;
  objectiveKey: string;
  /** Catalogue framework of the objective (e.g. PAA, SABER11, IB_DP) -- data, never branched on. */
  framework: string | null;
  objectiveKind: 'EXAM' | 'SUBJECT_LEVEL' | 'PROGRAMME_PLAN' | null;
  examDefinitionId: string | null;
  level: string | null;
  /** YYYY-MM-DD. */
  examDate: string | null;
  /** Official session code (e.g. M27) -- not stored yet (G-06): null today. */
  sessionCode: string | null;
  status: 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'ARCHIVED';
  source: TargetSource;
  confirmation: TargetConfirmation;
  /** The Student (or institution) confirmed the exam was sat -- not stored yet: false today. */
  satConfirmed: boolean;
  /** Logged "start preparing now" opt-in -- not stored yet: false today. */
  optedInEarly: boolean;
  previousResult: { scale: string; value: string; provenance: ResultProvenance } | null;
  actualResult: { scale: string; value: string; provenance: ResultProvenance } | null;
  /**
   * J3.2: the target's schedule facts (official session, authoritative / Student-reported exam
   * date, personal target date, estimated month). Absent = legacy: `examDate` is both the sitting
   * and the planning date (pre-J3 behaviour, unchanged).
   */
  schedule?: TargetScheduleFacts;
  /** J1.2: institutional context fields this target needs to resolve (none today). */
  contextDependencies?: ContextField[];
}

/** Academic facts from the catalogue / Blueprint (what the exam IS). */
export interface BlueprintReadinessFacts {
  readiness: ReadinessState;
  structureVisible: boolean;
  /** At least one launchable entry bound to a published exam version. */
  publishedVersion: boolean;
  versionValidity: 'VALID' | 'INVALID' | 'UNVERIFIED';
  /** A programme container (AICE Diploma): activities live in its subject targets. */
  programmePlan: boolean;
  institutionalRelease: 'NOT_APPLICABLE' | 'RELEASED' | 'PENDING';
}

/** What the Question Bank can execute today (from the capability contract). */
export interface ContentReadinessFacts {
  practice: boolean;
  diagnostic: boolean;
  reducedMock: boolean;
  fullMock: boolean;
  learningBridge: boolean;
  unavailable: Array<{ capability: Capability; reason: UnavailableReason }>;
  reducedMockLengthCoveragePercent: number | null;
}

/** The preparation plan's reading of the Learning OS (existing `buildPreparationPlan`). */
export interface LearningEvidenceFacts {
  mappedRequirements: number;
  mappedWithEvidence: number;
  counts: Record<RequirementStatus, number>;
  /** Blueprint-weighted share of mapped requirements at ALREADY_STRONG or NEEDS_CONFIRMATION (0..1). */
  weightedReadyShare: number | null;
  topRecommendation: { action: RecommendationAction; band: 'HIGH' | 'MEDIUM' | 'LOW' } | null;
  /** Latest learning evidence on the target's mapped concepts (ISO timestamp). */
  lastMappedLearningEvidenceAt: string | null;
  /**
   * G6: mapped concepts whose knowledge THIS target uses although it also rests
   * partly on another exam's attempt evidence (one longitudinal Knowledge State
   * per concept; the plan never lets it reach "already strong" here). Evidence
   * that is entirely another exam's is excluded from the plan, not counted here.
   * Reported, never hidden.
   */
  crossExamEvidenceConcepts: number;
  /** Requirements whose only evidence is another exam's result (context only: excluded from readiness). */
  otherExamOnlyRequirements: number;
}

export interface ExamInstanceFact {
  /** Opaque reference (instance id); used for ordering ties only, never logged. */
  instanceRef: string;
  mode: 'PRACTICE' | 'MOCK' | 'CHALLENGE';
  purpose: 'DIAGNOSTIC' | null;
  status: 'DRAFT' | 'READY' | 'IN_PROGRESS' | 'COMPLETED' | 'ARCHIVED' | 'DELETED';
  timingMode: 'UNTIMED' | 'TRAINING_TIMED' | 'OFFICIAL_SIMULATION_TIMED';
  /** Covers a subset of the exam's components (paper / component training). */
  componentScoped: boolean;
  fidelity: 'FULL' | 'REDUCED' | null;
  completedAt: string | null;
  result: 'SCORED' | 'INVALIDATED' | 'NO_SCORING_POLICY' | null;
  coveredComponentIds: string[];
}

export interface ExamEvidenceFacts {
  instances: ExamInstanceFact[];
  openAttempt: boolean;
}

export interface PredictionCapabilityFacts {
  modelClass: PredictionModelClass;
  /** The model's required components (empty when there is no model). */
  components: Array<{ componentId: string; simulated: boolean }>;
  /** Current component estimates (append-only history reduced to the latest per source). */
  estimates: Array<{ componentId: string; source: EstimateSource }>;
}

export interface StudentExamJourneyFacts {
  /** Evaluation day, YYYY-MM-DD. The resolver never reads the clock. */
  asOf: string;
  learner: LearnerFacts;
  /** null = the Student has no exam target. */
  target: ExamTargetFacts | null;
  blueprint: BlueprintReadinessFacts | null;
  content: ContentReadinessFacts | null;
  /** null = not available (never invented). */
  learning: LearningEvidenceFacts | null;
  exam: ExamEvidenceFacts;
  prediction: PredictionCapabilityFacts;
}

// ------------------------------------------------------------------ resolution (OUTPUT contract)

export type NextActionKind =
  | 'CONTINUE_LEARNING'
  | 'NOTIFY_WHEN_AVAILABLE'
  | 'CONFIRM_TARGET'
  | 'SET_EXAM_DATE'
  | 'RESUME_ATTEMPT'
  | 'PLAN_PROGRAMME'
  | 'REVIEW_STRUCTURE'
  | 'START_DIAGNOSTIC'
  | 'REINFORCE_CONCEPT'
  | 'PRACTICE'
  | 'PAPER_TRAINING'
  | 'TAKE_MOCK'
  | 'REVIEW_MOCK_RESULT'
  | 'REVIEW_PROJECTION'
  | 'REINFORCE_GAPS'
  | 'ENTER_COMPONENT_ESTIMATE'
  | 'FINAL_REVIEW'
  | 'EXAM_DAY_LOGISTICS'
  | 'CONFIRM_EXAM_SAT'
  | 'RECORD_RESULT'
  | 'REVIEW_RESULT';

export type ReasonCode =
  // learner
  | 'ACADEMIC_CONTEXT_FROM_INSTITUTION'
  | 'ACADEMIC_CONTEXT_FROM_STUDENT'
  | 'EXAM_TARGET_IS_FIRST_ACADEMIC_OBJECT'
  | 'NO_ACADEMIC_CONTEXT'
  // target
  | 'NO_EXAM_TARGET'
  | 'TARGET_ARCHIVED'
  | 'TARGET_ASSIGNED_BY_INSTITUTION'
  | 'TARGET_NOT_YET_A_PREPARATION'
  | 'TARGET_UNCONFIRMED'
  | 'PREVIOUS_RESULT_RECORDED'
  // blueprint / content
  | 'BLUEPRINT_NOT_CONFIGURED'
  | 'BLUEPRINT_VERSION_UNVERIFIED'
  | 'PROGRAMME_PLANNED_BY_SUBJECT'
  | 'CONTENT_STRUCTURE_ONLY'
  | 'CONTENT_BANK_IN_PROGRESS'
  | 'MOCK_REDUCED_FORM_ONLY'
  // window (O-01: journey policy over facts)
  | 'EXAM_DATE_UNKNOWN'
  | 'WINDOW_OPEN_BY_DATE'
  | 'WINDOW_OPEN_BY_ENGAGEMENT'
  | 'WINDOW_OPEN_BY_OPT_IN'
  | 'WINDOW_NOT_OPEN'
  | 'RECENT_LEARNING_ON_TARGET_CONCEPTS'
  | 'NO_RECENT_LEARNING_ON_TARGET_CONCEPTS'
  | 'EXAM_DATE_PASSED'
  | 'EXAM_SAT_NOT_CONFIRMED'
  | 'FINAL_WINDOW'
  | 'READY_WINDOW'
  // schedule (J3.2)
  | 'DATE_NOT_OFFICIAL'
  | 'DATE_PRECISION_MONTH'
  | 'OFFICIAL_SESSION_WITHOUT_DATE'
  // institutional context (J1.2)
  | 'INSTITUTION_CONTEXT_INCOMPLETE'
  | 'ACADEMIC_CONTEXT_CONFLICT'
  // evidence
  | 'LEARNING_EVIDENCE_UNAVAILABLE'
  | 'NO_MAPPED_REQUIREMENTS'
  | 'EVIDENCE_BELOW_DIAGNOSTIC_THRESHOLD'
  | 'DIAGNOSTIC_COMPLETED'
  | 'PRIOR_EVIDENCE_SUFFICIENT'
  | 'PRACTICE_COMPLETED'
  | 'PAPER_TRAINING_COMPLETED'
  | 'HIGH_PRIORITY_GAP'
  | 'CROSS_EXAM_EVIDENCE_RISK'
  // mocks (O-04)
  | 'MOCK_GUIDANCE_MET'
  | 'MOCK_GUIDANCE_NOT_MET'
  | 'MOCK_TIME_OVERRIDE'
  | 'MOCK_COMPLETED'
  | 'ACTIVITY_SINCE_LAST_MOCK'
  | 'NEXT_MOCK_GUIDANCE_MET'
  // prediction (O-02, O-03)
  | 'PREDICTION_MODEL_OFFICIAL_OR_KNOWN'
  | 'PREDICTION_MODEL_HISTORICAL_ESTIMATE'
  | 'NO_PREDICTION_MODEL'
  | 'NO_SCORED_MOCK'
  | 'MOCK_COMPONENT_COVERAGE_INCOMPLETE'
  | 'STUDENT_ESTIMATE_SCENARIO_ONLY'
  | 'TEACHER_COMPONENT_INPUT_PENDING'
  // closing (O-06)
  | 'ACTUAL_RESULT_RECORDED'
  | 'RESULT_STUDENT_REPORTED'
  | 'RESULT_INSTITUTION_REPORTED'
  | 'RESULT_VERIFIED'
  | 'OPEN_ATTEMPT';

export interface ResolutionReason {
  code: ReasonCode;
  detail?: Record<string, DetailValue>;
}

/** O-04: a guidance item is a recommendation, never a lock. */
export type MockGuidanceCode =
  | 'DIAGNOSTIC_OR_EVIDENCE_PENDING'
  | 'READINESS_BELOW_GUIDANCE'
  | 'TOO_SOON_AFTER_LAST_MOCK'
  | 'NO_ACTIVITY_SINCE_LAST_MOCK'
  | 'EXAM_TOO_CLOSE';

export interface ReadinessStatus {
  status: 'NOT_AVAILABLE' | 'INSUFFICIENT_EVIDENCE' | 'AVAILABLE';
  mappedRequirements: number;
  /** Share of mapped requirements with any evidence (0..1). */
  evidenceCoverage: number | null;
  /** Weighted share at ALREADY_STRONG / NEEDS_CONFIRMATION (0..1). */
  readyShare: number | null;
  /** G6: this target's readiness may be influenced by another exam's evidence. */
  crossExamEvidenceRisk: boolean;
}

export interface MockStatus {
  status: 'NOT_APPLICABLE' | 'UNAVAILABLE' | 'IN_PROGRESS' | 'AVAILABLE_NOT_RECOMMENDED' | 'RECOMMENDED';
  /** O-04: false ONLY when the mock cannot run (a blocker), never because of low readiness. */
  startable: boolean;
  fidelity: 'FULL' | 'REDUCED' | null;
  completedMocks: number;
  nextMockNumber: number | null;
  guidance: MockGuidanceCode[];
}

export interface PredictionStatus {
  status: 'NOT_APPLICABLE' | 'PREDICTION_MODEL_UNAVAILABLE' | 'PREDICTION_NOT_READY' | 'EARLY_AVAILABLE' | 'UPDATED_AVAILABLE' | 'COMPONENTS_REQUIRED' | 'FULL_AVAILABLE';
  modelClass: PredictionModelClass;
  basisMocks: number;
  missingComponentIds: string[];
  /** O-02: a StudyUs projection is NEVER an official result. */
  official: false;
}

export interface LearnerResolution {
  state: LearnerJourneyState;
  contextSource: ProvenanceSource | null;
  /** False when the academic context is already known (institution) or not needed (exam-only). */
  requiresAcademicInput: boolean;
}

export interface StudentExamJourneyResolution {
  resolverVersion: string;
  policyVersion: string;
  asOf: string;
  examTargetId: string | null;
  objectiveKey: string | null;
  learner: LearnerResolution;
  phase: JourneyPhase;
  state: JourneyState;
  blockers: JourneyBlocker[];
  recommendedNextAction: { kind: NextActionKind; mockNumber?: number; reasonCode: ReasonCode };
  readinessStatus: ReadinessStatus;
  mockStatus: MockStatus;
  predictionStatus: PredictionStatus;
  /** O-06: the recorded exam result with its provenance; `verified` only for verified provenances. */
  examResult: { provenance: ResultProvenance; verified: boolean } | null;
  /** J1.2: the institutional context the learner was resolved with (null = not loaded / not affiliated data absent). */
  academicContext: {
    status: InstitutionalContextSummary['status'];
    confidence: InstitutionalContextSummary['confidence'];
    completeness: 'COMPLETE' | 'PARTIAL' | 'NONE';
    missing: string[];
    conflicts: string[];
  } | null;
  /** J3.2: which date sources drove the resolution (null for no target). */
  schedule: {
    targetDateSource: TargetDateSource;
    officialSession: 'KNOWN' | 'UNKNOWN';
    sittingDateSource: TargetDateSource | null;
    planningDateSource: TargetDateSource | null;
    planningPrecision: 'DAY' | 'MONTH' | null;
  } | null;
  resolutionReasons: ResolutionReason[];
}
