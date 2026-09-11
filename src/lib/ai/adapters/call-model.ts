/**
 * LX-4P-PERF-R1B B1/B2 -- one provider-neutral chat entry point.
 *
 * Feature services call `callModel({ provider, model, ... })` and never
 * import a provider adapter directly. Structured Outputs (OpenAI) and
 * plain text (both providers) go through here. Returns the raw provider
 * payload so `parseProviderUsage` can read token usage.
 */
import { callAnthropicMessages } from './anthropic';
import { callOpenAIChat, type OpenAIJsonSchema } from './openai';
import type { AIProvider } from '../types';
import { parseProviderUsage, type ProviderUsage } from '../usage';

export interface CallModelParams {
  provider: AIProvider;
  model: string;
  system?: string;
  user: string;
  maxTokens: number;
  /** OpenAI Structured Outputs. Ignored by Anthropic (its adapter has no strict-schema mode) -- callers still validate. */
  jsonSchema?: OpenAIJsonSchema;
  promptCacheKey?: string;
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';
}

export interface CallModelResult {
  text: string;
  raw: unknown;
  provider: AIProvider;
  model: string;
}

export async function callModel(p: CallModelParams, signal: AbortSignal): Promise<CallModelResult> {
  if (p.provider === 'openai') {
    const r = await callOpenAIChat(
      {
        model: p.model,
        messages: [
          ...(p.system ? [{ role: 'system' as const, content: p.system }] : []),
          { role: 'user' as const, content: p.user },
        ],
        jsonSchema: p.jsonSchema,
        responseFormatJson: !p.jsonSchema,
        maxTokens: p.maxTokens,
        promptCacheKey: p.promptCacheKey,
        reasoningEffort: p.reasoningEffort,
      },
      signal,
    );
    return { text: r.text, raw: r.raw, provider: 'openai', model: p.model };
  }

  const r = await callAnthropicMessages(
    { model: p.model, maxTokens: p.maxTokens, system: p.system, messages: [{ role: 'user', content: p.user }] },
    signal,
  );
  return { text: r.text, raw: r.raw, provider: 'anthropic', model: p.model };
}

/**
 * LX-4P-PERF-R1G -- the one place a `CallModelResult` becomes a
 * provider-neutral `ProviderUsage`. Every `executeAI({ parseUsage })`
 * call site that transports through `callModel` should pass this
 * directly rather than re-deriving `parseProviderUsage(provider, raw)`
 * itself.
 */
export function parseCallModelUsage(r: CallModelResult): ProviderUsage {
  return parseProviderUsage(r.provider, r.raw);
}
