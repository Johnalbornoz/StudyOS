/**
 * F7 -- Assessment Framework Engine. One configurable engine, versioned
 * framework rules -- PAA/IB/Cambridge/Saber are rows here, never separate
 * code paths. See docs/implementation/f7/F7_TARGET_ASSESSMENT_ARCHITECTURE.md.
 * Nothing here has a studentId except Student Exam Profile/Preparation
 * Goal/Exam Attempt -- everything else is canonical/framework-scoped.
 */

export type CatalogStatus = 'DRAFT' | 'ACTIVE' | 'RETIRED';
export type ExamVersionStatus = 'DRAFT' | 'PUBLISHED' | 'SUPERSEDED' | 'RETIRED';
export type ComponentType = 'SECTION' | 'PAPER' | 'WRITTEN' | 'ORAL' | 'PRACTICAL' | 'COURSEWORK';
export type ConfigStatus = 'NOT_CONFIGURED' | 'CONFIGURED';
export type SupportStatus = 'UNSUPPORTED' | 'SUPPORTED';
export type ScoringType = 'BINARY' | 'PARTIAL_CREDIT' | 'RUBRIC' | 'MARK_SCHEME' | 'MULTI_PART';
export type BlueprintStatus = 'DRAFT' | 'PUBLISHED' | 'RETIRED';
export type WorkflowStatus = 'DRAFT' | 'PROPOSED' | 'IN_REVIEW' | 'APPROVED' | 'PUBLISHED' | 'REJECTED' | 'RETIRED';
export type ProfileStatus = 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'ARCHIVED';
export type GoalType = 'TARGET_SCORE' | 'TARGET_GRADE' | 'PERFORMANCE_LEVEL' | 'COMPETENCY_TARGET';
export type PolicyVerificationStatus = 'POLICY_PENDING' | 'VERIFIED';
export type AttemptStatus = 'IN_PROGRESS' | 'COMPLETED' | 'ABANDONED';

export interface ExamDefinition {
  id: string;
  academicProgrammeId: string | null;
  name: string;
  examFamily: string;
  purpose: string | null;
  domains: string[] | null;
  status: CatalogStatus;
}

export interface ScoringModel {
  id: string;
  name: string;
  scoringType: ScoringType;
  config: Record<string, unknown> | null;
  status: CatalogStatus;
}

export interface ExamVersion {
  id: string;
  examDefinitionId: string;
  versionLabel: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  navigationRules: Record<string, unknown> | null;
  scoringModelId: string | null;
  supportedModalities: string[] | null;
  status: ExamVersionStatus;
}

export interface AssessmentComponent {
  id: string;
  examVersionId: string;
  name: string;
  componentType: ComponentType;
  modality: string | null;
  academicSubjectId: string | null;
  timingStatus: ConfigStatus;
  durationMinutes: number | null;
  toolRuleStatus: ConfigStatus;
  toolRules: Record<string, unknown> | null;
  procedureRequired: boolean;
  simulationCapable: boolean;
  supportStatus: SupportStatus;
}

export interface CommandTerm {
  id: string;
  term: string;
  expectedReasoningType: string | null;
  status: CatalogStatus;
}

export interface AssessmentBlueprint {
  id: string;
  examVersionId: string;
  status: BlueprintStatus;
}

export interface BlueprintObjectiveTarget {
  id: string;
  blueprintId: string;
  learningObjectiveId: string;
  assessmentComponentId: string;
  targetItemCount: number | null;
  questionType: string | null;
  commandTermId: string | null;
  reasoningRequirement: string | null;
  difficultyMin: number | null;
  difficultyMax: number | null;
  skillId: string | null;
}

export interface ApprovedItem {
  id: string;
  approvedItemFamilyId: string | null;
  learningObjectiveId: string;
  questionType: string;
  content: Record<string, unknown>;
  status: WorkflowStatus;
  createdBy: string;
}

export interface StudentExamProfile {
  id: string;
  studentId: string;
  examDefinitionId: string;
  examVersionId: string | null;
  purpose: string | null;
  programmeContext: string | null;
  subjectFocus: string | null;
  examDate: string | null;
  timezone: string | null;
  institutionTargetId: string | null;
  status: ProfileStatus;
}

export interface PreparationGoal {
  id: string;
  studentExamProfileId: string;
  goalType: GoalType;
  targetValue: string | null;
  competencyId: string | null;
}

export interface InstitutionExamPolicy {
  id: string;
  institutionId: string;
  examDefinitionId: string;
  examVersionId: string | null;
  admissionContext: string | null;
  verificationStatus: PolicyVerificationStatus;
  sourceLocator: string | null;
  sectionsConsidered: Record<string, unknown> | null;
  thresholdRules: Record<string, unknown> | null;
  status: CatalogStatus;
  policyGroupId: string;
  version: number;
}

export interface GenerationContext {
  studentId: string;
  examVersionId: string;
  assessmentComponentId: string;
  blueprintObjectiveTargetId: string;
  learningObjectiveId: string;
  canonicalConceptIds: string[];
  skillIds: string[];
  competencyIds: string[];
  questionType: string | null;
  difficultyRange: { min: number; max: number } | null;
  reasoningRequirement: string | null;
  commandTerm: { id: string; term: string } | null;
  toolContext: { status: ConfigStatus; rules: Record<string, unknown> | null };
  timingContext: { status: ConfigStatus; durationMinutes: number | null };
}

export interface ValidationResult {
  valid: boolean;
  reasons: string[];
}

export interface EvaluationResult {
  rawResponse: unknown;
  score: number;
  maxScore: number;
  criteriaBreakdown: Record<string, unknown> | null;
  feedback: string | null;
  evaluationModelVersion: string | null;
  provenance: Record<string, unknown> | null;
}

export interface ExamAttempt {
  id: string;
  studentExamProfileId: string;
  examVersionId: string;
  blueprintId: string | null;
  institutionExamPolicyId: string | null;
  scoringModelId: string | null;
  frozenConfiguration: Record<string, unknown>;
  status: AttemptStatus;
}

export interface FullMockReadiness {
  ready: boolean;
  reasons: string[];
  miniMockObjectiveIds: string[];
}
