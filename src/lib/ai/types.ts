/**
 * StudyUs AI Contract -- shared, provider-neutral types (Phase 0E1).
 *
 * This is the vocabulary every AI call site in the app now speaks,
 * regardless of which provider/model actually answers the call. See
 * docs/architecture/ai-contract.md for the full design rationale.
 */

/** What kind of thing this AI call is doing -- drives risk classification, not the reverse. */
export type AICapability =
  | 'CONTENT_GENERATION'
  | 'QUESTION_GENERATION'
  | 'GRADING'
  | 'CLASSIFICATION'
  | 'COGNITIVE_ANALYSIS'
  | 'TRANSFER_EVALUATION'
  | 'EXPLANATION_EVALUATION'
  | 'EMBEDDING'
  | 'TUTOR'
  | 'OTHER';

/**
 * Consequence-based, not provider/model-based (Phase 0E1 Step 2).
 * HIGH_RISK: output can influence correctness, mastery evidence,
 * misconceptions, cognitive state, verification, assessment results,
 * or learning decisions. MEDIUM_RISK: affects the student's learning
 * experience/content but not learning state directly. LOW_RISK:
 * display-only, non-learning-state functionality.
 */
export type AIRiskLevel = 'LOW_RISK' | 'MEDIUM_RISK' | 'HIGH_RISK';

/** Providers actually used by StudyUs today. Do not add hypothetical providers (Step 5). */
export type AIProvider = 'anthropic' | 'openai';

/** Normalized error categories every provider-specific failure collapses into (Step 8). */
export type AIErrorCode =
  | 'TIMEOUT'
  | 'PROVIDER_ERROR'
  | 'RATE_LIMIT'
  | 'INVALID_RESPONSE'
  | 'VALIDATION_ERROR'
  | 'CONFIGURATION_ERROR';

/**
 * Execution metadata made available for every AI call (Step 3). Never
 * includes raw credentials, raw prompts, or raw responses -- see
 * src/lib/ai/logging.ts for the safe-logging boundary.
 */
export interface AIExecutionMetadata {
  executionId: string;
  capability: AICapability;
  risk: AIRiskLevel;
  provider: AIProvider;
  model: string;
  promptId: string;
  promptVersion: string;
  startedAt: string; // ISO 8601
  durationMs: number;
  success: boolean;
  validationStatus: 'PASSED' | 'FAILED' | 'NOT_APPLICABLE';
  fallbackUsed: boolean;
  errorCode?: AIErrorCode;
}

/** The safe, DB-storable subset of execution metadata -- what's allowed into learning_evidence.metadata (Step 18). */
export interface AIProvenance {
  aiExecutionId: string;
  aiProvider: AIProvider;
  aiModel: string;
  aiPromptId: string;
  aiPromptVersion: string;
}

/** Every structured AI response passes through one of these before a caller ever sees a typed result (Step 10/11). */
export interface AIValidationResult<T> {
  valid: boolean;
  value?: T;
  errors?: string[];
}

/** What a caller gets back from a successful gateway execution. */
export interface AIExecutionOutcome<TResult> {
  result: TResult;
  execution: AIExecutionMetadata;
  provenance: AIProvenance;
}

/**
 * Optional domain context for one AI execution (Phase 0E2 Step 11).
 * The gateway audits every execution regardless of whether this is
 * supplied -- this only enriches the persisted row with which
 * student/subject/concept/source operation it was for, when the
 * calling code happens to know. Never required, never used to infer
 * or fabricate identity, and never carries PII (no name/email/raw
 * content) -- just the same opaque uuids/labels already used
 * throughout the app's own domain tables.
 */
export interface AIExecutionContext {
  studentId?: string;
  subjectId?: string;
  conceptId?: string;
  /** e.g. 'quiz-generation.service.ts:gradeAnswer' -- which call site this was. */
  sourceComponent?: string;
  /** Caller-defined, e.g. a quiz session id -- opaque to the gateway. */
  sourceId?: string;
}
