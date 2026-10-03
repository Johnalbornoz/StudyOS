/**
 * Question Bank Factory -- the AI calls (generation, independent validation,
 * repair) through the ONE shared execution path (`executeAI`: global AI cap,
 * timeout, audit, usage). Background only: nothing here is reachable from a
 * Student request.
 *
 * Cost: generation and validation run on the routed primary model (Luna);
 * the stronger model (Terra) is used only to re-check a validation the
 * primary was not confident about. Every prompt passes `assertPromptPrivacy`
 * before a provider is contacted.
 */
import { executeAI } from '@/lib/ai/gateway';
import { callModel, parseCallModelUsage } from '@/lib/ai/adapters/call-model';
import { resolveModels } from '@/lib/ai/model-routing';
import { getPrompt } from '@/lib/ai/prompt-registry';
import { validateJson } from '@/lib/ai/validation';
import type { ApprovedItemContent } from '../items';
import {
  GENERATION_SCHEMA, VALIDATOR_SCHEMA, assertPromptPrivacy, generationSystemPrompt, generationUserPrompt, parseGenerationOutput,
  parseValidatorOutput, repairUserPrompt, validatorSystemPrompt, validatorUserPrompt, type GeneratedCandidate, type GenerationContext,
} from './prompts';
import type { ValidatorVerdict } from './validation';

export interface AICallUsage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUSD: number;
  rateLimited: boolean;
  provider: string | null;
  model: string | null;
  errorCode: string | null;
}

export interface FactoryAI {
  generate(ctx: GenerationContext): Promise<{ candidates: GeneratedCandidate[]; usage: AICallUsage }>;
  validate(content: ApprovedItemContent, strong: boolean): Promise<{ verdict: ValidatorVerdict | null; usage: AICallUsage }>;
  repair(ctx: GenerationContext, previous: GeneratedCandidate, issues: Array<{ code: string; detail?: string }>): Promise<{ candidate: GeneratedCandidate | null; usage: AICallUsage }>;
}

function usageOf(execution: { inputTokens?: number | null; outputTokens?: number | null; estimatedCostUSD?: number | null; errorCode?: string; provider: string; model: string }): AICallUsage {
  return {
    calls: 1,
    inputTokens: execution.inputTokens ?? 0,
    outputTokens: execution.outputTokens ?? 0,
    costUSD: execution.estimatedCostUSD ?? 0,
    rateLimited: execution.errorCode === 'RATE_LIMIT',
    provider: execution.provider,
    model: execution.model,
    errorCode: execution.errorCode ?? null,
  };
}

const SOURCE = 'question-bank/ai-runner.ts';

export const gatewayFactoryAI: FactoryAI = {
  async generate(ctx) {
    const route = resolveModels('QUESTION_GENERATION');
    const prompt = getPrompt('question_bank.generate_items');
    const system = generationSystemPrompt(ctx.spec.language);
    const user = generationUserPrompt(ctx);
    assertPromptPrivacy(system + user);
    const out = await executeAI({
      capability: prompt.capability,
      risk: 'HIGH_RISK',
      provider: route.provider,
      model: route.primary,
      promptId: prompt.id,
      promptVersion: prompt.version,
      timeoutMs: 90_000,
      context: { sourceComponent: SOURCE },
      call: (signal) => callModel({ provider: route.provider, model: route.primary, maxTokens: 6000, system, user, jsonSchema: GENERATION_SCHEMA }, signal),
      parseUsage: parseCallModelUsage,
      validate: (raw) => validateJson(raw, (parsed) => parseGenerationOutput(parsed, { count: ctx.count, optionCount: ctx.spec.optionCount })),
      fallback: () => [] as GeneratedCandidate[],
    });
    return { candidates: out.result ?? [], usage: usageOf(out.execution) };
  },

  async validate(content, strong) {
    const route = resolveModels(strong ? 'EXPLANATION_EVALUATION' : 'CLASSIFICATION');
    const prompt = getPrompt('question_bank.validate_item');
    const system = validatorSystemPrompt();
    const user = validatorUserPrompt(content);
    assertPromptPrivacy(system + user);
    const ids = (content.options ?? []).map((o) => o.id);
    const out = await executeAI({
      capability: prompt.capability,
      risk: 'HIGH_RISK',
      provider: route.provider,
      model: route.primary,
      promptId: prompt.id,
      promptVersion: prompt.version,
      timeoutMs: 60_000,
      context: { sourceComponent: SOURCE },
      call: (signal) => callModel({ provider: route.provider, model: route.primary, maxTokens: 1200, system, user, jsonSchema: VALIDATOR_SCHEMA }, signal),
      parseUsage: parseCallModelUsage,
      validate: (raw) => validateJson(raw, (parsed) => parseValidatorOutput(parsed, ids)),
      fallback: () => null as unknown as ValidatorVerdict,
    });
    return { verdict: out.result ?? null, usage: usageOf(out.execution) };
  },

  async repair(ctx, previous, issues) {
    const route = resolveModels('QUESTION_GENERATION');
    const prompt = getPrompt('question_bank.repair_item');
    const system = generationSystemPrompt(ctx.spec.language);
    const user = repairUserPrompt(ctx, previous, issues);
    assertPromptPrivacy(system + user);
    const out = await executeAI({
      capability: prompt.capability,
      risk: 'HIGH_RISK',
      provider: route.provider,
      model: route.primary,
      promptId: prompt.id,
      promptVersion: prompt.version,
      timeoutMs: 90_000,
      context: { sourceComponent: SOURCE },
      call: (signal) => callModel({ provider: route.provider, model: route.primary, maxTokens: 3000, system, user, jsonSchema: GENERATION_SCHEMA }, signal),
      parseUsage: parseCallModelUsage,
      validate: (raw) => validateJson(raw, (parsed) => parseGenerationOutput(parsed, { count: 1, optionCount: ctx.spec.optionCount })),
      fallback: () => [] as GeneratedCandidate[],
    });
    return { candidate: out.result?.[0] ?? null, usage: usageOf(out.execution) };
  },
};
