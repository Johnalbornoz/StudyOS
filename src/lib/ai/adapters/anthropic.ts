import { AIExecutionError, providerHttpError } from '../errors';

const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

export type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

export interface AnthropicMessagesParams {
  model: string;
  maxTokens: number;
  system?: string;
  messages: AnthropicMessage[];
}

export interface AnthropicMessagesResult {
  /** The concatenated text of every text content block in the response. */
  text: string;
  raw: unknown;
}

/**
 * The one place StudyUs constructs a request to Anthropic's Messages
 * API. Preserves the exact request shape every migrated call site
 * used directly (model/max_tokens/system/messages, x-api-key +
 * anthropic-version headers) -- this phase centralizes transport, it
 * does not change what gets sent (Step 5-6).
 */
export async function callAnthropicMessages(params: AnthropicMessagesParams, signal: AbortSignal): Promise<AnthropicMessagesResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new AIExecutionError('CONFIGURATION_ERROR', 'ANTHROPIC_API_KEY is not set');
  }

  const response = await fetch(ANTHROPIC_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: params.model,
      max_tokens: params.maxTokens,
      ...(params.system ? { system: params.system } : {}),
      messages: params.messages,
    }),
    signal,
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw providerHttpError('anthropic', response.status, errText);
  }

  const data: any = await response.json();
  const text = Array.isArray(data?.content) ? data.content.find((b: any) => b?.type === 'text')?.text ?? '' : '';
  return { text, raw: data };
}
