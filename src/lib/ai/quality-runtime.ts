/**
 * LX-4P-PERF-R1B B5/B6 -- the fail-closed gated-generation pipeline.
 *
 *   Luna (route.primary)
 *     -> parse (strict structured output)
 *     -> deterministic gate
 *     -> semantic verification (optional; only where judgment is needed)
 *     -> ACCEPT
 *   any failure ->
 *   Terra (route.fallback) ONCE
 *     -> parse -> deterministic gate -> semantic verification
 *     -> ACCEPT / REJECT
 *
 * NEVER a third attempt. NEVER a Claude/Sonnet fallback -- the routing
 * map only ever names `openai`, and a missing OPENAI_API_KEY surfaces as
 * an explicit CONFIGURATION_ERROR, not a silent switch (B24).
 *
 * "the model returned JSON" is not acceptance -- only a full pipeline
 * PASS reaches the caller (B6).
 */
import { executeAI } from './gateway';
import { callModel } from './adapters/call-model';
import type { OpenAIJsonSchema } from './adapters/openai';
import { resolveModels } from './model-routing';
import { budgetFor, type TokenBudgetKey } from './token-budgets';
import { parseProviderUsage } from './usage';
import { buildRuntimeEvent, recordRuntimeEvent, type QualityGateResult } from './runtime-event';
import type { AICapability, AIRiskLevel, AIExecutionContext } from './types';

export interface DeterministicVerdict {
  pass: boolean;
  /** description for the fallback reason / report. */
  reason: string;
}
export interface SemanticVerdict {
  pass: boolean;
  reason: string;
}

export interface GatedGenerationRouting {
  provider: 'openai';
  model: string;
  fallbackUsed: boolean;
  fallbackReason?: string;
  qualityGateResult: QualityGateResult;
}

export type GatedGenerationResult<T> =
  | { ok: true; value: T; routing: GatedGenerationRouting }
  | { ok: false; routing: GatedGenerationRouting; error: string };

export interface GatedGenerationSpec<T> {
  capability: AICapability;
  risk: AIRiskLevel;
  budgetKey: TokenBudgetKey;
  promptId: string;
  promptVersion: string;
  /** Stable prefix -- pedagogical rules + schema + quality rules. Ordered first for prompt caching (B8). */
  systemPrompt: string;
  /** Dynamic tail -- concept / context / activity state. */
  buildUserMessage: () => string;
  /** Strict Structured Outputs schema. Omit for plain json_object mode (teaching content). */
  jsonSchema?: OpenAIJsonSchema;
  /** Turn the raw text into a typed candidate, or null if unusable. */
  parse: (text: string) => T | null;
  /** Deterministic gate -- runs first, no I/O. Omit for a pass-through (content whose only gate is "it parsed"). */
  deterministicGate?: (value: T) => DeterministicVerdict;
  /** Semantic verification -- only invoked when the deterministic gate is inconclusive/PASS but judgment is still needed. */
  semanticVerify?: (value: T) => Promise<SemanticVerdict>;
  /** Stable cache key for the system+schema prefix (B8). */
  promptCacheKey?: string;
  context?: AIExecutionContext;
}

const TIMEOUT_MS = 30_000;

async function attempt<T>(
  spec: GatedGenerationSpec<T>,
  model: string,
): Promise<
  | { pass: true; value: T; gate: QualityGateResult; usageRaw: unknown; latencyMs: number }
  | { pass: false; reason: string; gate: QualityGateResult; usageRaw: unknown; latencyMs: number }
> {
  const budget = budgetFor(spec.budgetKey);
  const startedAt = Date.now();
  let usageRaw: unknown = null;

  let value: T;
  try {
    const outcome = await executeAI<{ text: string; raw: unknown }, T>({
      capability: spec.capability,
      risk: spec.risk,
      provider: 'openai',
      model,
      promptId: spec.promptId,
      promptVersion: spec.promptVersion,
      timeoutMs: TIMEOUT_MS,
      context: spec.context,
      call: (signal) =>
        callModel(
          {
            provider: 'openai',
            model,
            system: spec.systemPrompt,
            user: spec.buildUserMessage(),
            maxTokens: budget.maxOutputTokens,
            jsonSchema: spec.jsonSchema,
            promptCacheKey: spec.promptCacheKey,
            reasoningEffort: budget.reasoningEffort,
          },
          signal,
        ),
      validate: (raw) => {
        usageRaw = raw.raw;
        const parsed = spec.parse(raw.text || '');
        return parsed == null ? { valid: false, errors: ['parse/schema failure'] } : { valid: true, value: parsed };
      },
    });
    value = outcome.result;
  } catch (e) {
    const code = (e as { code?: string } | null)?.code;
    const msg = e instanceof Error ? e.message : String(e);
    const reason =
      code === 'CONFIGURATION_ERROR' || /_API_KEY is not set/i.test(msg)
        ? 'PROVIDER_UNCONFIGURED'
        : code === 'VALIDATION_ERROR' || code === 'INVALID_RESPONSE'
          ? 'SCHEMA_INVALID'
          : msg.slice(0, 160) || 'PROVIDER_ERROR';
    return { pass: false, reason, gate: 'NOT_RUN', usageRaw, latencyMs: Date.now() - startedAt };
  }

  const det = spec.deterministicGate ? spec.deterministicGate(value) : { pass: true, reason: '' };
  if (!det.pass) {
    return { pass: false, reason: det.reason || 'DETERMINISTIC_FAIL', gate: 'DETERMINISTIC_FAIL', usageRaw, latencyMs: Date.now() - startedAt };
  }

  if (spec.semanticVerify) {
    let sem: SemanticVerdict;
    try {
      sem = await spec.semanticVerify(value);
    } catch (e) {
      return { pass: false, reason: `SEMANTIC_VERIFY_ERROR: ${e instanceof Error ? e.message.slice(0, 120) : ''}`, gate: 'SEMANTIC_FAIL', usageRaw, latencyMs: Date.now() - startedAt };
    }
    if (!sem.pass) {
      return { pass: false, reason: sem.reason || 'SEMANTIC_FAIL', gate: 'SEMANTIC_FAIL', usageRaw, latencyMs: Date.now() - startedAt };
    }
  }

  return { pass: true, value, gate: 'PASS', usageRaw, latencyMs: Date.now() - startedAt };
}

export async function generateWithQualityGate<T>(spec: GatedGenerationSpec<T>): Promise<GatedGenerationResult<T>> {
  const route = resolveModels(spec.capability);
  if (route.provider !== 'openai') {
    // The canonical learner runtime is OpenAI-only; any other provider here is a config bug, not a fallback.
    return {
      ok: false,
      routing: { provider: 'openai', model: route.primary, fallbackUsed: false, fallbackReason: 'ROUTING_MISCONFIGURED', qualityGateResult: 'REJECTED' },
      error: `capability ${spec.capability} is not routed to openai`,
    };
  }

  const emit = (model: string, r: { usageRaw: unknown; latencyMs: number }, fallbackUsed: boolean, gate: QualityGateResult, fallbackReason?: string) => {
    const usage = parseProviderUsage('openai', r.usageRaw);
    recordRuntimeEvent(
      buildRuntimeEvent({
        capability: spec.capability,
        provider: 'openai',
        model,
        promptId: spec.promptId,
        promptVersion: spec.promptVersion,
        reasoningEffort: budgetFor(spec.budgetKey).reasoningEffort,
        inputTokens: usage.inputTokens,
        cachedInputTokens: usage.cachedInputTokens,
        outputTokens: usage.outputTokens,
        latencyMs: r.latencyMs,
        fallbackUsed,
        fallbackReason,
        qualityGateResult: gate,
      }),
    );
  };

  // --- attempt 1: Luna (primary) ---
  const first = await attempt(spec, route.primary);
  if (first.pass) {
    emit(route.primary, first, false, 'PASS');
    return { ok: true, value: first.value, routing: { provider: 'openai', model: route.primary, fallbackUsed: false, qualityGateResult: 'PASS' } };
  }
  emit(route.primary, first, false, first.gate, first.reason);

  // --- attempt 2: Terra (single fallback) ---
  if (route.fallback === route.primary) {
    return {
      ok: false,
      routing: { provider: 'openai', model: route.primary, fallbackUsed: false, fallbackReason: first.reason, qualityGateResult: first.gate },
      error: `primary failed and no distinct fallback is configured: ${first.reason}`,
    };
  }
  const second = await attempt(spec, route.fallback);
  emit(route.fallback, second, true, second.pass ? 'PASS' : second.gate, second.pass ? first.reason : `${first.reason} -> ${second.reason}`);
  if (second.pass) {
    return { ok: true, value: second.value, routing: { provider: 'openai', model: route.fallback, fallbackUsed: true, fallbackReason: first.reason, qualityGateResult: 'PASS' } };
  }

  // --- fail closed ---
  return {
    ok: false,
    routing: { provider: 'openai', model: route.fallback, fallbackUsed: true, fallbackReason: `${first.reason} -> ${second.reason}`, qualityGateResult: 'REJECTED' },
    error: `Luna and Terra both failed the quality pipeline (${first.reason} -> ${second.reason})`,
  };
}
