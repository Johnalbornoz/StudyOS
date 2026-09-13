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

/**
 * Normalized error categories every provider-specific failure collapses
 * into (Step 8). LX-9R7 PART D: this is also the retryability boundary
 * -- `INVALID_REQUEST` (HTTP 400/404: a deterministically malformed
 * request or an invalid model/endpoint) and `CONFIGURATION_ERROR`
 * (HTTP 401/403: auth/permission) can NEVER succeed on retry with a
 * different model, since the SAME malformed request shape is what would
 * be sent again -- see `isRetryableAIError`. `PROVIDER_ERROR` is
 * reserved for genuinely transient provider-side failures (5xx, network)
 * and `RATE_LIMIT`/`TIMEOUT` are retryable by definition.
 */
export type AIErrorCode =
  | 'TIMEOUT'
  | 'PROVIDER_ERROR'
  | 'RATE_LIMIT'
  | 'INVALID_RESPONSE'
  | 'VALIDATION_ERROR'
  | 'CONFIGURATION_ERROR'
  | 'INVALID_REQUEST';

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
  /**
   * LX-4P-PERF-R1G -- REAL provider usage/cost for this ONE execution,
   * present only when the call site opted in via `parseUsage` AND the
   * provider actually returned a response (absent for a call-level
   * failure such as a timeout, network error, or provider refusal --
   * no response was ever obtained to read usage from). Never fabricated;
   * a StudyUS-side validation/parsing rejection does NOT erase these --
   * they reflect what the provider already billed, regardless of
   * `success`/`validationStatus`.
   */
  inputTokens?: number | null;
  cachedInputTokens?: number | null;
  outputTokens?: number | null;
  estimatedCostUSD?: number | null;
  /** true only when every figure needed to compute estimatedCostUSD was known -- never fabricated as complete. */
  costComplete?: boolean;
  /**
   * LX-9R7 PART A -- present only when this execution failed with a
   * provider HTTP error. Safe, structured fields parsed from the
   * provider's own JSON error body: never the API key, never
   * authorization headers, never the prompt/question content, never
   * student PII. `providerErrorMessage` is the PROVIDER's own error
   * description (e.g. "Unknown parameter: 'foo'"), not StudyUS content.
   */
  providerHttpStatus?: number;
  providerErrorType?: string | null;
  providerErrorCode?: string | null;
  providerErrorParam?: string | null;
  providerErrorMessage?: string | null;
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
