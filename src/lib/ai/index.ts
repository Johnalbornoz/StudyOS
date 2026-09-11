/**
 * StudyUs AI Contract (Phase 0E1). See docs/architecture/ai-contract.md.
 *
 * DOMAIN SERVICE -> executeAI() -> provider adapter -> Anthropic/OpenAI
 *
 * Import from '@/lib/ai' rather than reaching into individual files
 * where practical -- this barrel is the intended public surface.
 */
export * from './types';
export * from './errors';
export { executeAI, AIExecutionFailure, DEFAULT_AI_TIMEOUT_MS } from './gateway';
export type { ExecuteAIOptions } from './gateway';
export { PROMPT_REGISTRY, getPrompt } from './prompt-registry';
export type { PromptId, PromptDefinition } from './prompt-registry';
export { ok, invalid, validateJson, checks, clamp } from './validation';
export type { RawTextResponse } from './validation';
export { logAIExecution, logAIDebugRaw } from './logging';
export { callAnthropicMessages } from './adapters/anthropic';
export type { AnthropicMessagesParams, AnthropicMessagesResult, AnthropicMessage, AnthropicContentBlock } from './adapters/anthropic';
export { callOpenAIChat, callOpenAIEmbedding } from './adapters/openai';
export type { OpenAIChatParams, OpenAIChatResult, OpenAIChatMessage, OpenAIEmbeddingParams, OpenAIEmbeddingResult, OpenAIJsonSchema } from './adapters/openai';
// LX-4P-PERF-R1B -- OpenAI quality-gated runtime.
export { callModel, parseCallModelUsage } from './adapters/call-model';
export type { CallModelParams, CallModelResult } from './adapters/call-model';
export { CAPABILITY_ROUTING, resolveModels, isAnthropicModel, LUNA, TERRA } from './model-routing';
export type { CapabilityRoute } from './model-routing';
export { TOKEN_BUDGETS, budgetFor, fitContextChunks } from './token-budgets';
export type { TokenBudget, TokenBudgetKey } from './token-budgets';
export { parseProviderUsage } from './usage';
export type { ProviderUsage } from './usage';
export { MODEL_PRICING, estimateCostUSD } from './pricing';
export type { ModelPrice, CostEstimate } from './pricing';
export { buildRuntimeEvent, buildAggregateRuntimeEvent, recordRuntimeEvent } from './runtime-event';
export type { AIRuntimeEvent, QualityGateResult } from './runtime-event';
// LX-4P-PERF-R1G -- usage/cost aggregation across multiple billable calls.
export { aggregateCost } from './usage-aggregation';
export type { BillableCallUsage, AggregatedCost } from './usage-aggregation';
export { generateWithQualityGate } from './quality-runtime';
export type { GatedGenerationSpec, GatedGenerationResult, GatedGenerationRouting } from './quality-runtime';
export { postgresAIExecutionAuditSink, noopAIExecutionAuditSink, setAIExecutionAuditSink, getAIExecutionAuditSink } from './audit';
export type { AIExecutionAuditSink, AIExecutionAuditEntry } from './audit';
