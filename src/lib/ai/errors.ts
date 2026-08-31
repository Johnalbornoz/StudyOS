import type { AIErrorCode, AIProvider } from './types';

/**
 * Every failure that can come out of the AI gateway -- transport,
 * provider HTTP error, timeout, or a validation failure -- surfaces as
 * this one typed error (Step 8). Callers that already have a
 * try/catch around their AI call keep working unmodified: this is
 * still a plain `Error` with a `.message`, just with a normalized
 * `.code` on top for callers that want to branch on it.
 */
export class AIExecutionError extends Error {
  readonly code: AIErrorCode;

  constructor(code: AIErrorCode, message: string) {
    super(message);
    this.name = 'AIExecutionError';
    this.code = code;
  }
}

export function isAIExecutionError(error: unknown): error is AIExecutionError {
  return error instanceof AIExecutionError;
}

/** Collapses a thrown value (network failure, abort, unknown) into a normalized AIExecutionError. */
export function normalizeProviderError(error: unknown, aborted: boolean): AIExecutionError {
  if (error instanceof AIExecutionError) return error;
  if (aborted || (error instanceof Error && error.name === 'AbortError')) {
    return new AIExecutionError('TIMEOUT', 'AI request timed out');
  }
  if (error instanceof Error) {
    return new AIExecutionError('PROVIDER_ERROR', error.message);
  }
  return new AIExecutionError('PROVIDER_ERROR', String(error));
}

/**
 * Maps a non-ok HTTP response from a provider into a normalized error.
 * `body` is the provider's own error response text (never user/student
 * content) -- truncated defensively, matching what the pre-existing
 * per-service error messages already included.
 */
export function providerHttpError(provider: AIProvider, status: number, body: string): AIExecutionError {
  const safeBody = body ? body.slice(0, 500) : '';
  const suffix = safeBody ? `: ${safeBody}` : '';
  if (status === 429) {
    return new AIExecutionError('RATE_LIMIT', `${provider} rate limit exceeded (HTTP 429)${suffix}`);
  }
  if (status === 401 || status === 403) {
    return new AIExecutionError('CONFIGURATION_ERROR', `${provider} authentication/authorization error (HTTP ${status})${suffix}`);
  }
  return new AIExecutionError('PROVIDER_ERROR', `${provider} API error (HTTP ${status})${suffix}`);
}
