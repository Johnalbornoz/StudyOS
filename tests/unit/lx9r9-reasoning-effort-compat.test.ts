/**
 * LX-9R9 -- MODEL-COMPATIBLE REASONING EFFORT. Required tests 1, 4-7,
 * 9-12, 13-19, in order. Tests 2-3, 8 (the actual outbound HTTP request
 * shape) live in the sibling file
 * lx9r9-r1-outbound-request-contract.test.ts, which mocks `fetch` and
 * exercises `callOpenAIChat` for real -- this file runs the pure
 * `resolveReasoningEffort` authority and reads real, unmocked source
 * (token-budgets.ts / model-routing.ts / errors.ts).
 *
 * LIVE ROOT CAUSE: a quick_check request to gpt-5.6-luna failed with
 * HTTP 400 `unsupported_value` on `reasoning_effort: 'minimal'` --
 * `question_generation_slot`'s configured budget. The provider's own
 * error named the model's actual supported set: 'none', 'low',
 * 'medium', 'high', 'xhigh'. `'minimal'` was invented locally and never
 * validated against what any routed model actually supports.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');

import { resolveReasoningEffort, REASONING_EFFORT_LEVELS, type ReasoningEffort } from '@/lib/ai/model-compatibility';
import { LUNA, TERRA, CAPABILITY_ROUTING } from '@/lib/ai/model-routing';
import { TOKEN_BUDGETS } from '@/lib/ai/token-budgets';
import { isRetryableAIError } from '@/lib/ai/errors';

/* ================================================================= *
 * REQUIRED TEST 1 -- quick_check no longer configures unsupported     *
 * 'minimal' for Luna.                                                 *
 * ================================================================= */

describe('LX-9R9 1 -- quick_check no longer configures unsupported reasoning_effort', () => {
  it("question_generation_slot's reasoningEffort is a canonical, model-supported value, never 'minimal'", () => {
    expect(TOKEN_BUDGETS.question_generation_slot.reasoningEffort).toBe('none');
    expect(TOKEN_BUDGETS.question_generation_slot.reasoningEffort).not.toBe('minimal' as any);
  });

  it("the TokenBudget type itself no longer admits 'minimal' -- a new budget cannot reintroduce this defect and still typecheck", () => {
    const SRC = read('src/lib/ai/token-budgets.ts');
    expect(SRC).toMatch(/reasoningEffort\?: ReasoningEffort/);
    expect(SRC).not.toMatch(/'minimal' \| 'low' \| 'medium' \| 'high'/);
  });
});

/* ================================================================= *
 * REQUIRED TEST 4 -- the resolve helper is deterministic.             *
 * ================================================================= */

describe('LX-9R9 4 -- resolveReasoningEffort is pure and deterministic', () => {
  it('the same (model, requestedEffort) input always resolves identically', () => {
    const a = resolveReasoningEffort({ model: LUNA, requestedEffort: 'minimal' });
    const b = resolveReasoningEffort({ model: LUNA, requestedEffort: 'minimal' });
    expect(a).toEqual(b);
  });

  it('undefined always resolves UNCHANGED with value undefined -- omitting the parameter is always safe', () => {
    expect(resolveReasoningEffort({ model: LUNA, requestedEffort: undefined })).toEqual({ status: 'UNCHANGED', value: undefined });
    expect(resolveReasoningEffort({ model: TERRA, requestedEffort: undefined })).toEqual({ status: 'UNCHANGED', value: undefined });
    expect(resolveReasoningEffort({ model: 'some-unregistered-model', requestedEffort: undefined })).toEqual({ status: 'UNCHANGED', value: undefined });
  });
});

/* ================================================================= *
 * REQUIRED TEST 5 -- supported values pass unchanged.                 *
 * ================================================================= */

describe('LX-9R9 5 -- every canonical reasoning-effort level passes unchanged for both Luna and Terra', () => {
  it.each(REASONING_EFFORT_LEVELS)('%s resolves UNCHANGED for Luna and Terra', (effort) => {
    expect(resolveReasoningEffort({ model: LUNA, requestedEffort: effort })).toEqual({ status: 'UNCHANGED', value: effort });
    expect(resolveReasoningEffort({ model: TERRA, requestedEffort: effort })).toEqual({ status: 'UNCHANGED', value: effort });
  });
});

/* ================================================================= *
 * REQUIRED TEST 6 -- an invalid-but-compatible legacy value           *
 * normalizes safely where a policy exists.                           *
 * ================================================================= */

describe("LX-9R9 6 -- 'minimal' (the proven live-failing value) normalizes safely to the lowest supported level", () => {
  it("resolveReasoningEffort({ model: LUNA, requestedEffort: 'minimal' }) normalizes to 'none', never silently to 'low' or higher", () => {
    const resolution = resolveReasoningEffort({ model: LUNA, requestedEffort: 'minimal' });
    expect(resolution).toMatchObject({ status: 'NORMALIZED', value: 'none', requestedValue: 'minimal' });
    expect(typeof (resolution as any).reason).toBe('string');
  });

  it('the SAME normalization applies to Terra -- PART F, no primary/fallback divergence', () => {
    const resolution = resolveReasoningEffort({ model: TERRA, requestedEffort: 'minimal' });
    expect(resolution).toMatchObject({ status: 'NORMALIZED', value: 'none', requestedValue: 'minimal' });
  });
});

/* ================================================================= *
 * REQUIRED TEST 7 -- an unsafe/unknown value fails locally.           *
 * ================================================================= */

describe('LX-9R9 7 -- an unknown value with no safe mapping resolves UNRESOLVABLE, never guessed', () => {
  it('a nonsense value has no alias and is UNRESOLVABLE for a registered model', () => {
    const resolution = resolveReasoningEffort({ model: LUNA, requestedEffort: 'ultra-deep-think' });
    expect(resolution.status).toBe('UNRESOLVABLE');
  });

  it('a value for an UNREGISTERED model is UNRESOLVABLE even if the value itself is otherwise canonical -- never assumes compatibility', () => {
    const resolution = resolveReasoningEffort({ model: 'gpt-9000-hypothetical', requestedEffort: 'low' });
    expect(resolution.status).toBe('UNRESOLVABLE');
  });
});

/* ================================================================= *
 * REQUIRED TEST 9 -- question_generation_slot remains low-latency     *
 * oriented (the fix only touched reasoningEffort, nothing else).      *
 * ================================================================= */

describe('LX-9R9 9 -- question_generation_slot stays low-latency/low-cost oriented', () => {
  it('maxOutputTokens/maxContextChars are unchanged by this phase -- only reasoningEffort moved', () => {
    expect(TOKEN_BUDGETS.question_generation_slot.maxOutputTokens).toBe(2400);
    expect(TOKEN_BUDGETS.question_generation_slot.maxContextChars).toBe(4000);
  });

  it("'none' is still the LOWEST canonical level -- the replacement preserves, never inflates, the original low-effort intent", () => {
    expect(REASONING_EFFORT_LEVELS[0]).toBe('none');
    expect(TOKEN_BUDGETS.question_generation_slot.reasoningEffort).toBe(REASONING_EFFORT_LEVELS[0]);
  });
});

/* ================================================================= *
 * REQUIRED TESTS 10-11 -- contextual_help / question_localization     *
 * audited and fixed alongside quick_check.                            *
 * ================================================================= */

describe('LX-9R9 10 -- contextual_help audited: no longer configures an unsupported value', () => {
  it("contextual_help's reasoningEffort is 'none', the same fix applied to question_generation_slot", () => {
    expect(TOKEN_BUDGETS.contextual_help.reasoningEffort).toBe('none');
  });

  it('resolves UNCHANGED for both Luna and Terra (the hint capability routes OTHER -> Luna/Terra)', () => {
    expect(resolveReasoningEffort({ model: LUNA, requestedEffort: TOKEN_BUDGETS.contextual_help.reasoningEffort })).toEqual({ status: 'UNCHANGED', value: 'none' });
    expect(resolveReasoningEffort({ model: TERRA, requestedEffort: TOKEN_BUDGETS.contextual_help.reasoningEffort })).toEqual({ status: 'UNCHANGED', value: 'none' });
  });
});

describe('LX-9R9 11 -- question_localization audited: no longer configures an unsupported value', () => {
  it("question_localization's reasoningEffort is 'none', the same fix applied to question_generation_slot", () => {
    expect(TOKEN_BUDGETS.question_localization.reasoningEffort).toBe('none');
  });

  it('resolves UNCHANGED for both Luna and Terra (localization routes CONTENT_GENERATION -> Luna/Terra)', () => {
    expect(resolveReasoningEffort({ model: LUNA, requestedEffort: TOKEN_BUDGETS.question_localization.reasoningEffort })).toEqual({ status: 'UNCHANGED', value: 'none' });
    expect(resolveReasoningEffort({ model: TERRA, requestedEffort: TOKEN_BUDGETS.question_localization.reasoningEffort })).toEqual({ status: 'UNCHANGED', value: 'none' });
  });
});

/* ================================================================= *
 * REQUIRED TEST 12 -- PART K: the full provider-capability contract:  *
 * every reachable (model, reasoningEffort) pair validates.            *
 * ================================================================= */

describe('LX-9R9 12 -- provider-capability contract: every reachable (model, budget reasoningEffort) pair is valid', () => {
  // Every model any capability can route to (excluding EMBEDDING, which
  // never takes a reasoning-effort parameter -- callOpenAIEmbedding has
  // no such field at all).
  const routedModels = new Set<string>();
  for (const [capability, route] of Object.entries(CAPABILITY_ROUTING)) {
    if (capability === 'EMBEDDING') continue;
    routedModels.add(route.primary);
    routedModels.add(route.fallback);
  }
  const configuredEfforts = Object.entries(TOKEN_BUDGETS)
    .filter(([, b]) => (b as { reasoningEffort?: ReasoningEffort }).reasoningEffort !== undefined)
    .map(([key, b]) => ({ key, effort: (b as { reasoningEffort?: ReasoningEffort }).reasoningEffort! }));

  it('the matrix is not accidentally empty (sanity)', () => {
    expect(routedModels.size).toBeGreaterThanOrEqual(2);
    expect(routedModels.has(LUNA)).toBe(true);
    expect(routedModels.has(TERRA)).toBe(true);
    expect(configuredEfforts.length).toBeGreaterThan(0);
  });

  it('every routed model resolves every configured budget effort as UNCHANGED -- no silent normalization is load-bearing in production config', () => {
    const failures: string[] = [];
    for (const model of routedModels) {
      for (const { key, effort } of configuredEfforts) {
        const resolution = resolveReasoningEffort({ model, requestedEffort: effort });
        if (resolution.status !== 'UNCHANGED') {
          failures.push(`budget "${key}" (${effort}) against model "${model}" -> ${resolution.status}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });
});

/* ================================================================= *
 * REQUIRED TEST 13 -- HTTP 400 remains non-retryable (LX-9R7          *
 * behavior preserved; CONFIGURATION_ERROR is also non-retryable, so   *
 * the new local-fail-fast path preserves the same safety property).   *
 * ================================================================= */

describe('LX-9R9 13 -- retry classification is unchanged', () => {
  it('INVALID_REQUEST (a real provider 400) and CONFIGURATION_ERROR (a local, pre-provider-call failure) are BOTH non-retryable', () => {
    expect(isRetryableAIError('INVALID_REQUEST')).toBe(false);
    expect(isRetryableAIError('CONFIGURATION_ERROR')).toBe(false);
  });

  it('every other error code remains retryable, unchanged', () => {
    expect(isRetryableAIError('TIMEOUT')).toBe(true);
    expect(isRetryableAIError('RATE_LIMIT')).toBe(true);
    expect(isRetryableAIError('PROVIDER_ERROR')).toBe(true);
    expect(isRetryableAIError('VALIDATION_ERROR')).toBe(true);
    expect(isRetryableAIError('INVALID_RESPONSE')).toBe(true);
  });
});

/* ================================================================= *
 * REQUIRED TESTS 14-19 -- regression: this phase touched ONLY the     *
 * reasoning-effort plumbing (model-compatibility.ts, token-budgets.ts *
 * value/type, the openai.ts adapter's guard) -- every other canonical *
 * contract this phase was told not to touch is verified still present*
 * and untouched.                                                      *
 * ================================================================= */

describe('LX-9R9 14 -- quick_check exact-6 contract unchanged', () => {
  it('QUICK_CHECK_SLOT_COUNT is still 6, and the all-or-nothing recovery structure is untouched', () => {
    const SRC = read('src/services/quiz-generation.service.ts');
    expect(SRC).toMatch(/const QUICK_CHECK_SLOT_COUNT = 6;/);
    expect(SRC).toMatch(/QUICK_CHECK_GENERATION_INSUFFICIENT/);
  });
});

describe('LX-9R9 15 -- Structured Output contract unchanged', () => {
  it('callOpenAIChat still builds strict json_schema response_format exactly as before', () => {
    const SRC = read('src/lib/ai/adapters/openai.ts');
    expect(SRC).toMatch(/response_format: \{ type: 'json_schema', json_schema: \{ name: params\.jsonSchema\.name, strict: true, schema: params\.jsonSchema\.schema \} \}/);
  });
});

describe('LX-9R9 16 -- Question Quality Gate unchanged', () => {
  it('applyQuestionQualityGate / gateUnitWithTerraFallback are untouched by this phase', () => {
    const SRC = read('src/services/gated-question-generation.service.ts');
    expect(SRC).toMatch(/export async function applyQuestionQualityGate/);
    expect(SRC).toMatch(/export async function gateUnitWithTerraFallback/);
    expect(SRC).toMatch(/semanticRejectionHistogram/); // LX-9R8's histogram, still present
  });
});

describe('LX-9R9 17 -- difficulty calibration unchanged', () => {
  it('describeDifficultyTier and the verifier difficulty payload from LX-9R8 are untouched', () => {
    const GEN_SRC = read('src/services/quiz-generation.service.ts');
    const VERIFIER_SRC = read('src/services/question-quality-verifier.service.ts');
    expect(GEN_SRC).toMatch(/export function describeDifficultyTier\(difficulty: number\): string/);
    expect(VERIFIER_SRC).toMatch(/describeDifficultyTier\(q\.difficulty\)/);
  });
});

describe('LX-9R9 18 -- novelty/dedupe logic unchanged', () => {
  it('the cross-chunk normalizeText dedupe from LX-9R8 is untouched', () => {
    const SRC = read('src/services/quiz-generation.service.ts');
    expect(SRC).toMatch(/const key = normalizeText\(q\.question\)\.toLowerCase\(\);/);
  });
});

describe('LX-9R9 19 -- canonical progression (zero-gap Practice) unchanged', () => {
  it('isZeroGapPracticeMismatch from LX-9R8 is untouched', () => {
    const SRC = read('src/lib/lx/evidence-sufficiency-contract.ts');
    expect(SRC).toMatch(/export function isZeroGapPracticeMismatch/);
    expect(SRC).toMatch(/pedagogicalRequirement === 0/);
  });
});
