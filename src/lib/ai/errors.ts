import type { AIErrorCode, AIProvider } from './types';

/**
 * LX-9R7 PART A -- safe, structured provider error detail, parsed once
 * at the HTTP boundary (`providerHttpError`) and carried on the thrown
 * `AIExecutionError` for the rest of the call's lifetime. Every field is
 * either the raw HTTP status or content the PROVIDER itself put in its
 * own JSON error body (`error.type`/`error.code`/`error.param`/
 * `error.message`) -- never the API key, never authorization headers,
 * never StudyUS's own prompt/question content, never student PII.
 */
export interface ProviderErrorDetail {
  status: number;
  type: string | null;
  code: string | null;
  param: string | null;
  message: string | null;
}

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
  /** LX-9R7 PART A -- present only for a provider HTTP error (see providerHttpError). */
  readonly providerDetail?: ProviderErrorDetail;

  constructor(code: AIErrorCode, message: string, providerDetail?: ProviderErrorDetail) {
    super(message);
    this.name = 'AIExecutionError';
    this.code = code;
    this.providerDetail = providerDetail;
  }
}

/**
 * LX-9R7 PART D -- the ONE retryability authority every domain generator
 * (quick_check/practice/retention/gated-batch) must consult before
 * deciding to retry a failed generation call on Terra. A deterministic
 * bad-request (`INVALID_REQUEST`: HTTP 400/404 -- malformed request
 * shape or an invalid model/endpoint) or an auth/permission failure
 * (`CONFIGURATION_ERROR`: HTTP 401/403) will fail again, identically, on
 * ANY model -- the request that was rejected is the one about to be
 * resent. Every other code (`TIMEOUT`, `RATE_LIMIT`, the transient-
 * provider-failure sense of `PROVIDER_ERROR`, and the StudyUS-side
 * `VALIDATION_ERROR`/`INVALID_RESPONSE` codes, where a DIFFERENT model
 * genuinely might behave differently) remains retryable, preserving
 * every existing bounded-fallback behavior.
 */
export function isRetryableAIError(code: AIErrorCode | undefined | null): boolean {
  if (!code) return true;
  return code !== 'INVALID_REQUEST' && code !== 'CONFIGURATION_ERROR';
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
 * LX-9R7 PART A -- best-effort parse of a provider's own JSON error
 * envelope (OpenAI/Anthropic both use `{"error": {"message","type",
 * "param","code"}}`). Never throws: a non-JSON or unexpected-shape body
 * degrades to all-null fields rather than failing the caller's own
 * error handling. Only reads fields the provider itself put in ITS OWN
 * error response -- never touches request content.
 */
function parseProviderErrorBody(status: number, body: string): ProviderErrorDetail {
  try {
    const parsed = JSON.parse(body);
    const err = parsed?.error;
    if (err && typeof err === 'object') {
      return {
        status,
        type: typeof err.type === 'string' ? err.type : null,
        code: typeof err.code === 'string' ? err.code : null,
        param: typeof err.param === 'string' ? err.param : null,
        message: typeof err.message === 'string' ? err.message.slice(0, 500) : null,
      };
    }
  } catch {
    // Non-JSON body (e.g. an HTML error page from an intermediary proxy) -- fields stay null, never thrown.
  }
  return { status, type: null, code: null, param: null, message: null };
}

/**
 * Maps a non-ok HTTP response from a provider into a normalized error.
 * `body` is the provider's own error response text (never user/student
 * content) -- truncated defensively, matching what the pre-existing
 * per-service error messages already included. LX-9R7 PART A/D: also
 * parses the provider's own structured error envelope (attached as
 * `.providerDetail`, safe fields only) and classifies the HTTP status
 * into a retryability-aware `AIErrorCode` (`isRetryableAIError`) -- HTTP
 * 400/404 (a deterministically malformed request, or an invalid model/
 * endpoint -- the SAME request would be rejected again on ANY model) is
 * now `INVALID_REQUEST`, never the generic `PROVIDER_ERROR` a 5xx gets.
 */
export function providerHttpError(provider: AIProvider, status: number, body: string): AIExecutionError {
  const safeBody = body ? body.slice(0, 500) : '';
  const suffix = safeBody ? `: ${safeBody}` : '';
  const detail = parseProviderErrorBody(status, body);
  if (status === 429) {
    return new AIExecutionError('RATE_LIMIT', `${provider} rate limit exceeded (HTTP 429)${suffix}`, detail);
  }
  if (status === 401 || status === 403) {
    return new AIExecutionError('CONFIGURATION_ERROR', `${provider} authentication/authorization error (HTTP ${status})${suffix}`, detail);
  }
  if (status === 400 || status === 404) {
    return new AIExecutionError('INVALID_REQUEST', `${provider} rejected the request as invalid (HTTP ${status})${suffix}`, detail);
  }
  return new AIExecutionError('PROVIDER_ERROR', `${provider} API error (HTTP ${status})${suffix}`, detail);
}
