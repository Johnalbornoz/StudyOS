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
import type { ReasoningEffort } from '../model-compatibility';

export interface CallModelParams {
  provider: AIProvider;
  model: string;
  system?: string;
  user: string;
  maxTokens: number;
  /** OpenAI Structured Outputs. Ignored by Anthropic (its adapter has no strict-schema mode) -- callers still validate. */
  jsonSchema?: OpenAIJsonSchema;
  promptCacheKey?: string;
  reasoningEffort?: ReasoningEffort;
  /**
   * LX-9 B3/B32: without `jsonSchema`, OpenAI calls default to
   * `response_format: json_object` (see below) -- correct for the
   * structured-classification/extraction callers this was built for,
   * but wrong for a genuinely conversational reply (prose, LaTeX,
   * fenced code blocks) that is never valid JSON. Set `plainText: true`
   * to opt OUT of that default and get the model's raw text back, the
   * same free-form contract Anthropic calls have always had. Ignored by
   * Anthropic (never forces a response format) and by any call that
   * also passes `jsonSchema` (schema always wins).
   */
  plainText?: boolean;
  /**
   * Exam V2: images attached to the user message (OpenAI vision content
   * parts). Already validated, scanned and size-bounded by the caller.
   */
  images?: { mediaType: 'image/png' | 'image/jpeg' | 'image/webp'; base64: string }[];
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
          p.images && p.images.length > 0
            ? {
                role: 'user' as const,
                content: [
                  { type: 'text' as const, text: p.user },
                  ...p.images.map((img) => ({ type: 'image_url' as const, image_url: { url: `data:${img.mediaType};base64,${img.base64}`, detail: 'high' as const } })),
                ],
              }
            : { role: 'user' as const, content: p.user },
        ],
        jsonSchema: p.jsonSchema,
        responseFormatJson: !p.jsonSchema && !p.plainText,
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
