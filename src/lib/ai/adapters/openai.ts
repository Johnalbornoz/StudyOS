import { AIExecutionError, providerHttpError } from '../errors';

const OPENAI_CHAT_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const OPENAI_EMBEDDINGS_ENDPOINT = 'https://api.openai.com/v1/embeddings';

export interface OpenAIChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OpenAIChatParams {
  model: string;
  messages: OpenAIChatMessage[];
  /** Mirrors interactive-formula.service.ts's existing `response_format: { type: 'json_object' }` usage. */
  responseFormatJson?: boolean;
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

  const response = await fetch(OPENAI_CHAT_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: params.model,
      messages: params.messages,
      ...(params.responseFormatJson ? { response_format: { type: 'json_object' } } : {}),
    }),
    signal,
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw providerHttpError('openai', response.status, errText);
  }

  const data: any = await response.json();
  const text = data?.choices?.[0]?.message?.content ?? '';
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
