/**
 * LX-4P-PERF-R1B B1 -- central capability -> model routing.
 *
 * THE single source of truth for which provider/model serves each
 * capability in the canonical learner runtime. Feature services must
 * NOT carry literal model names -- they call `resolveModels(capability)`.
 *
 * Primary  = gpt-5.6-luna   (OpenAI, Structured Outputs)
 * Fallback = gpt-5.6-terra  (OpenAI) -- one quality fallback, never a
 *            silent Anthropic/Sonnet fallback.
 * Evaluation / high answer-correctness risk is routed to Terra directly
 * (cost is justified by the consequence).
 */
import type { AICapability, AIProvider } from './types';

export const LUNA = 'gpt-5.6-luna' as const;
export const TERRA = 'gpt-5.6-terra' as const;

export interface CapabilityRoute {
  provider: AIProvider;
  /** Model tried first. */
  primary: string;
  /** Single quality fallback. May equal `primary` when there is nothing stronger to escalate to. */
  fallback: string;
  /** Human note for the audit/report. */
  rationale: string;
}

/**
 * Keyed by AICapability. Every canonical learner-runtime capability
 * resolves to OpenAI Luna->Terra. Embedding stays on its existing
 * OpenAI embedding model (handled by the embedding service, not here).
 */
export const CAPABILITY_ROUTING: Record<AICapability, CapabilityRoute> = {
  QUESTION_GENERATION: {
    provider: 'openai', primary: LUNA, fallback: TERRA,
    rationale: 'high-volume structured generation; Luna first, Terra on a failed quality gate',
  },
  CONTENT_GENERATION: {
    provider: 'openai', primary: LUNA, fallback: TERRA,
    rationale: 'explanation / worked example / guided practice / localization display text',
  },
  EXPLANATION_EVALUATION: {
    provider: 'openai', primary: TERRA, fallback: TERRA,
    rationale: 'semantic verification gates whether content reaches a learner -- run on the stronger model',
  },
  GRADING: {
    provider: 'openai', primary: TERRA, fallback: TERRA,
    rationale: 'answer-correctness consequence -- evaluation is not routed to Luna for savings',
  },
  TRANSFER_EVALUATION: {
    provider: 'openai', primary: TERRA, fallback: TERRA,
    rationale: 'evaluation of a learner attempt in a new context',
  },
  COGNITIVE_ANALYSIS: {
    provider: 'openai', primary: TERRA, fallback: TERRA,
    rationale: 'feeds cognitive/misconception state -- evaluation-grade',
  },
  CLASSIFICATION: {
    provider: 'openai', primary: LUNA, fallback: TERRA,
    rationale: 'structured labelling',
  },
  TUTOR: {
    provider: 'openai', primary: LUNA, fallback: TERRA,
    rationale: 'conversational; Luna first',
  },
  EMBEDDING: {
    provider: 'openai', primary: 'text-embedding-3-small', fallback: 'text-embedding-3-small',
    rationale: 'unchanged; embeddings are handled by embedding.service, listed for completeness',
  },
  OTHER: {
    provider: 'openai', primary: LUNA, fallback: TERRA,
    rationale: 'default',
  },
};

export function resolveModels(capability: AICapability): CapabilityRoute {
  return CAPABILITY_ROUTING[capability] ?? CAPABILITY_ROUTING.OTHER;
}

/** True iff `model` is a Claude/Anthropic model id -- used by guards/tests to prove Sonnet is out of the canonical runtime. */
export function isAnthropicModel(model: string): boolean {
  return /^claude[-.]/i.test(model) || model.startsWith('anthropic/');
}
