import { AIExecutionError, providerHttpError } from '../errors';

const OPENAI_CHAT_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const OPENAI_EMBEDDINGS_ENDPOINT = 'https://api.openai.com/v1/embeddings';

export interface OpenAIChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** LX-4P-PERF-R1B B2 -- a strict JSON Schema for OpenAI Structured Outputs. */
export interface OpenAIJsonSchema {
  name: string;
  /** A JSON Schema object. `strict: true` is applied automatically. */
  schema: Record<string, unknown>;
}

export interface OpenAIChatParams {
  model: string;
  messages: OpenAIChatMessage[];
  /** Legacy: `response_format: { type: 'json_object' }`. */
  responseFormatJson?: boolean;
  /** B2: strict Structured Outputs -- takes precedence over `responseFormatJson`. */
  jsonSchema?: OpenAIJsonSchema;
  /** B7: bounded output. Maps to `max_completion_tokens`. */
  maxTokens?: number;
  /** B8: stable prefix cache key so a shared system/schema prefix is billed once. */
  promptCacheKey?: string;
  /** B7: reasoning-effort hint for models that accept it. */
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';
}

export interface OpenAIChatResult {
  text: string;
  raw: unknown;
}

function requireOpenAIKey(): string {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new AIExecutionError('CONFIGURATION_ERROR', 'OPENAI_API_KEY is not set');
  }
  return apiKey;
}

/** The one place StudyUs constructs a request to OpenAI's Chat Completions API. */
export async function callOpenAIChat(params: OpenAIChatParams, signal: AbortSignal): Promise<OpenAIChatResult> {
  const apiKey = requireOpenAIKey();

  const responseFormat = params.jsonSchema
    ? { response_format: { type: 'json_schema', json_schema: { name: params.jsonSchema.name, strict: true, schema: params.jsonSchema.schema } } }
    : params.responseFormatJson
      ? { response_format: { type: 'json_object' } }
      : {};

  const response = await fetch(OPENAI_CHAT_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: params.model,
      messages: params.messages,
      ...responseFormat,
      ...(typeof params.maxTokens === 'number' ? { max_completion_tokens: params.maxTokens } : {}),
      ...(params.promptCacheKey ? { prompt_cache_key: params.promptCacheKey } : {}),
      ...(params.reasoningEffort ? { reasoning_effort: params.reasoningEffort } : {}),
    }),
    signal,
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw providerHttpError('openai', response.status, errText);
  }

  const data: any = await response.json();
  // A strict-schema refusal comes back as `message.refusal`; surface it as an invalid response, never silent empty text.
  const choice = data?.choices?.[0]?.message;
  if (choice?.refusal) {
    throw new AIExecutionError('INVALID_RESPONSE', `OpenAI refused the structured request: ${String(choice.refusal).slice(0, 200)}`);
  }
  const text = choice?.content ?? '';
  return { text, raw: data };
}

export interface OpenAIEmbeddingParams {
  model: string;
  input: string;
}

export interface OpenAIEmbeddingResult {
  embedding: number[];
  raw: unknown;
}

/** The one place StudyUs constructs a request to OpenAI's Embeddings API. */
export async function callOpenAIEmbedding(params: OpenAIEmbeddingParams, signal: AbortSignal): Promise<OpenAIEmbeddingResult> {
  const apiKey = requireOpenAIKey();

  const response = await fetch(OPENAI_EMBEDDINGS_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ input: params.input, model: params.model }),
    signal,
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw providerHttpError('openai', response.status, errText);
  }

  const data: any = await response.json();
  const embedding = data?.data?.[0]?.embedding;
  if (!Array.isArray(embedding)) {
    throw new AIExecutionError('INVALID_RESPONSE', 'OpenAI embeddings response missing data[0].embedding');
  }
  return { embedding, raw: data };
}
