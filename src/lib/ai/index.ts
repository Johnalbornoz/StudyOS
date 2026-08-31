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
export type { OpenAIChatParams, OpenAIChatResult, OpenAIChatMessage, OpenAIEmbeddingParams, OpenAIEmbeddingResult } from './adapters/openai';
export { postgresAIExecutionAuditSink, noopAIExecutionAuditSink, setAIExecutionAuditSink, getAIExecutionAuditSink } from './audit';
export type { AIExecutionAuditSink, AIExecutionAuditEntry } from './audit';
