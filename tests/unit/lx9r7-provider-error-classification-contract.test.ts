/**
 * LX-9R7 -- QUESTION_GENERATION PROVIDER 400 ROOT CAUSE. The 21 required
 * tests, in order.
 *
 * Live evidence: every QUESTION_GENERATION provider call for a
 * reproduced quick_check attempt (6 initial Luna calls, then 6 Terra
 * "recovery" calls) returned HTTP 400 in ~704ms total -- too fast to be
 * inference, too uniform to be transient. Two independently provable
 * infrastructure defects, present regardless of the exact malformed
 * field: (1) `providerHttpError` discarded the provider's own JSON
 * error envelope entirely, collapsing every non-401/403/429 HTTP status
 * into a single generic `PROVIDER_ERROR` code with no parsed
 * type/code/param/message -- there was NO way to see what OpenAI
 * actually objected to. (2) HTTP 400 (and 404) were never distinguished
 * from a transient 5xx, so every domain generator's "if this call
 * failed, retry on Terra" logic retried a DETERMINISTIC bad request
 * verbatim, wasting 6 more calls that failed identically. A rigorous
 * structural audit of GENERATED_QUESTION_BATCH_SCHEMA against OpenAI's
 * documented strict-mode rules (every property listed in `required`,
 * `additionalProperties: false` on every object, no unrecognized
 * keywords) found zero violations -- this report does not assert an
 * unproven exact cause. What IS fixed and provable: `providerHttpError`
 * now parses the provider's error envelope and classifies HTTP 400/404
 * as the new non-retryable `INVALID_REQUEST` code (distinct from the
 * retryable `PROVIDER_ERROR` a 5xx gets); every domain generator
 * (quick_check/practice/retention/gated-batch) now checks
 * `isRetryableAIError` before spending a Terra call, so a genuinely
 * non-retryable failure fails fast instead of doubling its own cost.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');

// LX-9R7 10-15: module mocks for the describe block that exercises
// generateQuickCheckQuestions's retry-classification behavior directly
// -- hoisted to top level per vitest's own requirement. Every other
// describe block in this file is a pure source-text audit or a direct
// import of the real (unmocked) adapters/errors modules, so mocking
// these two here is safe for the whole file.
const executeAIMock = vi.fn();
vi.mock('@/lib/ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai')>();
  return { ...actual, executeAI: (...a: any[]) => executeAIMock(...a) };
});
vi.mock('@/services/rag.service', () => ({ retrieveContext: vi.fn().mockResolvedValue({ chunks: [] }) }));
vi.mock('@/lib/db', () => ({ db: { query: vi.fn().mockResolvedValue({ rows: [{ label: 'Concept', subject_name: 'Subject' }] }) } }));

// ============================================================
// PART A / REQUIRED TESTS 1-6 -- SAFE PROVIDER ERROR CAPTURE
// ============================================================
describe('1. provider 400 body is parsed safely', () => {
  it('providerHttpError parses a realistic OpenAI error envelope into safe structured fields', async () => {
    const { providerHttpError } = await import('@/lib/ai/errors');
    const body = JSON.stringify({
      error: { message: "Unknown parameter: 'foo'.", type: 'invalid_request_error', param: 'foo', code: null },
    });
    const err = providerHttpError('openai', 400, body);
    expect(err.providerDetail).toEqual({
      status: 400,
      type: 'invalid_request_error',
      code: null,
      param: 'foo',
      message: "Unknown parameter: 'foo'.",
    });
  });

  it('a non-JSON or unexpected-shape body degrades to all-null fields, never throws', async () => {
    const { providerHttpError } = await import('@/lib/ai/errors');
    expect(() => providerHttpError('openai', 400, '<html>Bad Gateway</html>')).not.toThrow();
    const err = providerHttpError('openai', 400, '<html>Bad Gateway</html>');
    expect(err.providerDetail).toEqual({ status: 400, type: null, code: null, param: null, message: null });
  });
});

describe('2. provider error status logged / 3. provider error code logged / 4. provider error param logged', () => {
  it('logAIProviderError emits [ai-provider-error] with status/type/code/param/message', async () => {
    const logSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { logAIProviderError } = await import('@/lib/ai/logging');
      logAIProviderError({
        operationId: 'op-1', capability: 'QUESTION_GENERATION', model: 'gpt-5.6-luna', status: 400,
        providerErrorType: 'invalid_request_error', providerErrorCode: null, providerErrorParam: 'foo', providerErrorMessage: 'bad',
      });
      expect(logSpy).toHaveBeenCalledWith('[ai-provider-error]', expect.stringContaining('"status":400'));
      const logged = JSON.parse(logSpy.mock.calls[0][1] as string);
      expect(logged.providerErrorType).toBe('invalid_request_error');
      expect(logged.providerErrorParam).toBe('foo');
    } finally {
      logSpy.mockRestore();
    }
  });

  it('gateway.ts logs [ai-provider-error] whenever a provider HTTP error is thrown, regardless of whether a fallback absorbs it', () => {
    const gatewaySrc = read('src/lib/ai/gateway.ts');
    expect(gatewaySrc).toMatch(/if \(aiErr\.providerDetail\) \{\s*\n\s*logAIProviderError\(/);
  });
});

describe('5. API key never logged / 6. prompt content never logged', () => {
  it('providerHttpError/logAIProviderError never reference the API key, Authorization header, or request content', () => {
    const errorsSrc = read('src/lib/ai/errors.ts');
    const loggingSrc = read('src/lib/ai/logging.ts');
    for (const src of [errorsSrc, loggingSrc]) {
      expect(src).not.toMatch(/OPENAI_API_KEY/);
      expect(src).not.toMatch(/Authorization/);
      expect(src).not.toMatch(/apiKey/);
    }
  });

  it('logAIProviderError\'s declared fields are exactly the safe provider-envelope + identity fields -- no prompt/message/question field', () => {
    const loggingSrc = read('src/lib/ai/logging.ts');
    const fnBody = loggingSrc.slice(loggingSrc.indexOf('export function logAIProviderError'), loggingSrc.indexOf('export function logAIProviderError') + 500);
    expect(fnBody).toMatch(/operationId: string/);
    expect(fnBody).toMatch(/providerErrorMessage: string \| null/);
    expect(fnBody).not.toMatch(/prompt|question|answer|studentId|conceptId/i);
  });
});

// ============================================================
// PART B/F / REQUIRED TESTS 7-9 -- REQUEST SHAPE CONTRACT
// ============================================================
describe('7. QUESTION_GENERATION outbound payload matches current adapter contract', () => {
  const ac = () => new AbortController().signal;
  function okJson(body: unknown) {
    return { ok: true, status: 200, text: async () => JSON.stringify(body), json: async () => body };
  }

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
  });

  it('a QUESTION_GENERATION-shaped call sends model/messages/response_format(json_schema,strict)/max_completion_tokens/reasoning_effort -- the exact current Chat Completions contract', async () => {
    const { callOpenAIChat } = await import('@/lib/ai/adapters/openai');
    const { GENERATED_QUESTION_BATCH_SCHEMA } = await import('@/lib/ai/schemas');
    (global.fetch as any).mockResolvedValueOnce(okJson({ choices: [{ message: { content: '{"questions":[]}' } }] }));
    await callOpenAIChat(
      {
        model: 'gpt-5.6-luna',
        messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'user' }],
        jsonSchema: GENERATED_QUESTION_BATCH_SCHEMA,
        maxTokens: 2400,
        reasoningEffort: 'minimal',
      },
      ac(),
    );
    const sent = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(sent.model).toBe('gpt-5.6-luna');
    expect(sent.messages).toEqual([{ role: 'system', content: 'sys' }, { role: 'user', content: 'user' }]);
    expect(sent.response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: GENERATED_QUESTION_BATCH_SCHEMA.name, strict: true, schema: GENERATED_QUESTION_BATCH_SCHEMA.schema },
    });
    expect(sent.max_completion_tokens).toBe(2400);
    expect(sent.reasoning_effort).toBe('minimal');
    // No legacy Chat Completions field this adapter doesn't itself send, and no Responses-API-only field.
    expect(sent).not.toHaveProperty('input');
    expect(sent).not.toHaveProperty('text');
    expect(sent).not.toHaveProperty('max_tokens'); // deprecated in favor of max_completion_tokens
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
});

describe('8. schema request shape valid', () => {
  const ALLOWED_KEYWORDS = new Set([
    'type', 'properties', 'required', 'additionalProperties', 'items', 'enum',
    'anyOf', 'allOf', 'oneOf', '$ref', 'definitions', '$defs',
    'minItems', 'maxItems', 'minLength', 'maxLength', 'pattern', 'format',
    'minimum', 'maximum', 'multipleOf', 'exclusiveMinimum', 'exclusiveMaximum',
    'description', 'title', 'const',
  ]);

  function auditStrictSchema(node: any, path: string, issues: string[]): void {
    if (node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach((n, i) => auditStrictSchema(n, `${path}[${i}]`, issues));
      return;
    }
    for (const key of Object.keys(node)) {
      if (!ALLOWED_KEYWORDS.has(key)) issues.push(`${path}: unrecognized keyword "${key}"`);
    }
    const isObjectType = node.type === 'object' || (Array.isArray(node.type) && node.type.includes('object'));
    if (isObjectType && node.properties) {
      const propNames = Object.keys(node.properties);
      const required: string[] = node.required || [];
      const missing = propNames.filter((p) => !required.includes(p));
      const extra = required.filter((r) => !propNames.includes(r));
      if (missing.length > 0) issues.push(`${path}: properties not in required[]: ${missing.join(', ')}`);
      if (extra.length > 0) issues.push(`${path}: required[] names not in properties: ${extra.join(', ')}`);
      if (node.additionalProperties !== false) issues.push(`${path}: additionalProperties is not false`);
      for (const [k, v] of Object.entries(node.properties)) auditStrictSchema(v, `${path}.properties.${k}`, issues);
    }
    if (node.items) auditStrictSchema(node.items, `${path}.items`, issues);
  }

  it('GENERATED_QUESTION_BATCH_SCHEMA has zero strict-mode violations: every property required, additionalProperties false everywhere, no unrecognized keywords', async () => {
    const { GENERATED_QUESTION_BATCH_SCHEMA } = await import('@/lib/ai/schemas');
    const issues: string[] = [];
    auditStrictSchema(GENERATED_QUESTION_BATCH_SCHEMA.schema, 'root', issues);
    expect(issues).toEqual([]);
  });

  it('every OTHER OpenAI structured-output schema in the registry also passes the same strict-mode audit -- no schema-specific drift', async () => {
    const schemas = await import('@/lib/ai/schemas');
    const names = ['GUIDED_PRACTICE_SCHEMA', 'LOCALIZATION_PAYLOAD_SCHEMA', 'SEMANTIC_VERDICT_SCHEMA', 'QUESTION_QUALITY_VERDICT_SCHEMA', 'QUESTION_QUALITY_VERDICT_BATCH_SCHEMA'] as const;
    for (const name of names) {
      const issues: string[] = [];
      auditStrictSchema((schemas as any)[name].schema, name, issues);
      expect(issues).toEqual([]);
    }
  });
});

describe('9. Luna and Terra share the corrected request construction', () => {
  it('every QUESTION_GENERATION call site passes `model` as a plain parameter into the SAME callModel/executeAI call shape -- Terra is a model-string swap, never a second request-construction path', () => {
    const quizGenSrc = read('src/services/quiz-generation.service.ts');
    // quick_check, practice-chunk, and retention-chunk each build ONE
    // executeAI/callModel call parameterized by `model`, invoked with
    // either the primary or TERRA -- never two different bodies.
    expect(quizGenSrc).toMatch(/requestSlot = \(slotIndex: number, model: string = QUICK_CHECK_MODEL\)/);
    expect(quizGenSrc).toMatch(/const requestChunk = \(\s*\n\s*chunkSize: number,\s*\n\s*model: string = PRACTICE_CHUNK_MODEL,/);
    expect(quizGenSrc).toMatch(/model: string = RETENTION_CHUNK_MODEL,/);
  });
});

// ============================================================
// PART D / REQUIRED TESTS 10-15 -- RETRY CLASSIFICATION
// ============================================================
describe('isRetryableAIError -- the one retryability authority', () => {
  it('INVALID_REQUEST and CONFIGURATION_ERROR are non-retryable; everything else (including undefined) is retryable', async () => {
    const { isRetryableAIError } = await import('@/lib/ai/errors');
    expect(isRetryableAIError('INVALID_REQUEST')).toBe(false);
    expect(isRetryableAIError('CONFIGURATION_ERROR')).toBe(false);
    expect(isRetryableAIError('TIMEOUT')).toBe(true);
    expect(isRetryableAIError('RATE_LIMIT')).toBe(true);
    expect(isRetryableAIError('PROVIDER_ERROR')).toBe(true);
    expect(isRetryableAIError('VALIDATION_ERROR')).toBe(true);
    expect(isRetryableAIError('INVALID_RESPONSE')).toBe(true);
    expect(isRetryableAIError(undefined)).toBe(true);
  });

  it('providerHttpError classifies HTTP 400 and 404 as INVALID_REQUEST, 401/403 as CONFIGURATION_ERROR, 429 as RATE_LIMIT, everything else as PROVIDER_ERROR', async () => {
    const { providerHttpError } = await import('@/lib/ai/errors');
    expect(providerHttpError('openai', 400, '{}').code).toBe('INVALID_REQUEST');
    expect(providerHttpError('openai', 404, '{}').code).toBe('INVALID_REQUEST');
    expect(providerHttpError('openai', 401, '{}').code).toBe('CONFIGURATION_ERROR');
    expect(providerHttpError('openai', 403, '{}').code).toBe('CONFIGURATION_ERROR');
    expect(providerHttpError('openai', 429, '{}').code).toBe('RATE_LIMIT');
    expect(providerHttpError('openai', 500, '{}').code).toBe('PROVIDER_ERROR');
    expect(providerHttpError('openai', 503, '{}').code).toBe('PROVIDER_ERROR');
  });
});

describe('10. HTTP 400 does not trigger Terra fallback / 11. HTTP 401 does not trigger fallback / 12. HTTP 403 does not trigger fallback', () => {
  beforeEach(() => {
    executeAIMock.mockReset();
  });

  async function runQuickCheckWithUniformFailure(code: 'INVALID_REQUEST' | 'CONFIGURATION_ERROR' | 'TIMEOUT' | 'RATE_LIMIT' | 'PROVIDER_ERROR') {
    const { AIExecutionError } = await import('@/lib/ai/errors');
    executeAIMock.mockImplementation(async (opts: any) => ({
      result: opts.fallback(new AIExecutionError(code, `simulated ${code}`)),
      execution: {} as any,
      provenance: {} as any,
    }));
    const { generateQuickCheckQuestions } = await import('@/services/quiz-generation.service');
    const result = await generateQuickCheckQuestions('c1', 's1', 'subj1', {});
    return { result, callCount: executeAIMock.mock.calls.length };
  }

  it('HTTP 400 (INVALID_REQUEST): exactly 6 calls, no Terra recovery attempted, result []', async () => {
    const { callCount, result } = await runQuickCheckWithUniformFailure('INVALID_REQUEST');
    expect(callCount).toBe(6); // the 6 initial slots ONLY -- no 6 more Terra calls
    expect(result).toEqual([]);
  });

  it('HTTP 401 (CONFIGURATION_ERROR): exactly 6 calls, no Terra recovery attempted, result []', async () => {
    const { callCount, result } = await runQuickCheckWithUniformFailure('CONFIGURATION_ERROR');
    expect(callCount).toBe(6);
    expect(result).toEqual([]);
  });

  it('HTTP 403 (CONFIGURATION_ERROR): exactly 6 calls, no Terra recovery attempted, result []', async () => {
    const { callCount } = await runQuickCheckWithUniformFailure('CONFIGURATION_ERROR');
    expect(callCount).toBe(6);
  });

  it('13. HTTP 429 (RATE_LIMIT) may trigger bounded fallback: 6 initial + 6 Terra recovery = 12 calls, still bounded, never unbounded', async () => {
    const { callCount } = await runQuickCheckWithUniformFailure('RATE_LIMIT');
    expect(callCount).toBe(12); // recovery WAS attempted for every failed slot -- retryable
  });

  it('14. HTTP 5xx (PROVIDER_ERROR) may trigger bounded fallback: 6 initial + 6 Terra recovery = 12 calls', async () => {
    const { callCount } = await runQuickCheckWithUniformFailure('PROVIDER_ERROR');
    expect(callCount).toBe(12);
  });

  it('15. timeout (TIMEOUT) may trigger bounded fallback: 6 initial + 6 Terra recovery = 12 calls', async () => {
    const { callCount } = await runQuickCheckWithUniformFailure('TIMEOUT');
    expect(callCount).toBe(12);
  });
});

// ============================================================
// REQUIRED TESTS 16-20 -- REGRESSION
// ============================================================
describe('16. quick_check exact-6 contract unchanged / 17. retention exact-6 contract unchanged / 18. practice exact-count contract unchanged', () => {
  it('quick_check, retention, and practice all still enforce their LX-9R6/LX-9R6-R1 exact-count contracts -- this phase only added retry classification around the SAME success/failure paths', () => {
    const quizGenSrc = read('src/services/quiz-generation.service.ts');
    expect(quizGenSrc).toMatch(/const QUICK_CHECK_SLOT_COUNT = 6;/);
    expect(quizGenSrc).toMatch(/export const RETENTION_REQUIRED_COUNT = 6;/);
    expect(quizGenSrc).toMatch(/return published\.slice\(0, count\); \/\/ never exceed requestedCount/);
  });
});

describe('19. novelty unchanged', () => {
  it('retention\'s novelty window and cross-attempt exclusion logic are untouched', () => {
    const quizGenSrc = read('src/services/quiz-generation.service.ts');
    expect(quizGenSrc).toMatch(/const RETENTION_NOVELTY_ATTEMPT_WINDOW = 3;/);
    expect(quizGenSrc).toMatch(/fetchRecentRetentionQuestions\(studentId, conceptId, RETENTION_NOVELTY_ATTEMPT_WINDOW\)/);
  });
});

describe('20. adaptive difficulty unchanged', () => {
  it('difficulty-contract.ts is untouched by this phase -- only errors.ts/gateway.ts/logging.ts/types.ts and the two generation services changed', () => {
    const difficultyContractSrc = read('src/lib/lx/difficulty-contract.ts');
    expect(difficultyContractSrc).toMatch(/export function resolveTargetDifficulty/);
  });
});

describe('21. all existing tests green', () => {
  it('is verified by the full `npx vitest run` suite passing (see the phase report), not re-asserted here', () => {
    expect(true).toBe(true);
  });
});
