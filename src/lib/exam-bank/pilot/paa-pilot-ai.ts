/**
 * PAA pilot -- the provider calls, through the ONE shared StudyUs AI execution path (`executeAI`: global cap,
 * timeout, audit, usage accounting) and the shared provider client (`callModel`). No second AI stack.
 *
 * OFFLINE ONLY. Imported by scripts/operations/exam-bank/paa-pilot-factory.ts and by nothing a request can reach.
 * The generator is a candidate producer: what it returns is certified, or not, by paa-pilot-contract.ts.
 */
import { executeAI } from '@/lib/ai/gateway';
import { callModel, parseCallModelUsage } from '@/lib/ai/adapters/call-model';
import { resolveModels } from '@/lib/ai/model-routing';
import { getPrompt } from '@/lib/ai/prompt-registry';
import { estimateCostUSD, MODEL_PRICING } from '@/lib/ai/pricing';
import { validateJson } from '@/lib/ai/validation';
import { GENERATED_UNIT_JSON_SCHEMA, GeneratedUnitSchema, generationSystemPrompt, generationUserPrompt, VERIFICATION_JSON_SCHEMA, VERIFICATION_SYSTEM_PROMPT, VerificationSchema, verificationUserPrompt, type CandidateUnit, type GeneratedUnit, type GenerationProvenance, type SolverRun, type UnitPlan, type Verification } from './paa-pilot-contract';

export const PAA_PILOT_GENERATION_SERVICE = 'studyus-ai-gateway/executeAI+callModel';
const SOURCE = 'exam-bank/pilot/paa-pilot-ai.ts';
export const GENERATION_MAX_TOKENS = 9000;
export const VERIFICATION_MAX_TOKENS = 5000;

export interface CallCost { executionId: string; provider: string; model: string; inputTokens: number; outputTokens: number; costUsd: number; costComplete: boolean; errorCode: string | null }
/** The most a call can cost: its whole output budget at the model's price, plus a generous input allowance. Reserved BEFORE the call. */
export function worstCaseUsd(model: string, maxTokens: number, inputAllowance = 6000): number {
  const p = MODEL_PRICING[model];
  if (!p || (p.inputPerM === 0 && p.outputPerM === 0)) throw new Error(`PAA_PILOT_MODEL_HAS_NO_CONFIGURED_PRICE: ${model} -- its cost cannot be bounded`);
  return (inputAllowance / 1_000_000) * p.inputPerM + (maxTokens / 1_000_000) * p.outputPerM;
}
const costOf = (e: { executionId: string; provider: string; model: string; inputTokens?: number | null; outputTokens?: number | null; errorCode?: string }): CallCost => {
  const est = estimateCostUSD({ model: e.model, inputTokens: e.inputTokens ?? null, cachedInputTokens: null, outputTokens: e.outputTokens ?? null });
  return { executionId: e.executionId, provider: e.provider, model: e.model, inputTokens: e.inputTokens ?? 0, outputTokens: e.outputTokens ?? 0, costUsd: est.usd ?? 0, costComplete: est.complete, errorCode: e.errorCode ?? null };
};

/** The model a generation runs on: the quality model of the shared QUESTION_GENERATION route. */
export const generationModel = (): { provider: 'openai' | 'anthropic'; model: string } => { const r = resolveModels('QUESTION_GENERATION'); return { provider: r.provider as 'openai' | 'anthropic', model: r.fallback }; };
/** Two independent solvers: the two models of the shared CLASSIFICATION route. */
export const solverModels = (): { solver: string; provider: 'openai' | 'anthropic'; model: string }[] => { const r = resolveModels('CLASSIFICATION'); return [{ solver: 'A', provider: r.provider as 'openai' | 'anthropic', model: r.fallback }, { solver: 'B', provider: r.provider as 'openai' | 'anthropic', model: r.primary }]; };

export async function generateUnit(plan: UnitPlan): Promise<{ generated: GeneratedUnit | null; provenance: GenerationProvenance; cost: CallCost }> {
  const { provider, model } = generationModel();
  const prompt = getPrompt('exam_bank.paa_pilot.generate_unit');
  const system = generationSystemPrompt(plan.language);
  const user = generationUserPrompt(plan);
  const out = await executeAI({
    capability: prompt.capability, risk: 'HIGH_RISK', provider, model, promptId: prompt.id, promptVersion: prompt.version, timeoutMs: 240_000, context: { sourceComponent: SOURCE },
    call: (signal) => callModel({ provider, model, maxTokens: GENERATION_MAX_TOKENS, system, user, jsonSchema: GENERATED_UNIT_JSON_SCHEMA as never }, signal),
    parseUsage: parseCallModelUsage,
    validate: (raw) => validateJson(raw, (parsed) => { const r = GeneratedUnitSchema.safeParse(parsed); return r.success ? { value: r.data as GeneratedUnit | null, errors: [] } : { value: null, errors: r.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`) }; }),
    fallback: () => null,
  });
  const e = out.execution;
  return { generated: out.result ?? null, provenance: { generationService: PAA_PILOT_GENERATION_SERVICE, provider: e.provider, model: e.model, promptId: prompt.id, promptVersion: prompt.version, executionId: e.executionId, generatedAt: new Date().toISOString(), unitId: plan.unitId }, cost: costOf(e) };
}

export async function solveUnit(unit: CandidateUnit, s: { solver: string; provider: 'openai' | 'anthropic'; model: string }): Promise<{ run: SolverRun | null; cost: CallCost }> {
  const prompt = getPrompt('exam_bank.paa_pilot.verify_unit');
  const user = verificationUserPrompt(unit, s.solver);
  const out = await executeAI({
    capability: prompt.capability, risk: 'HIGH_RISK', provider: s.provider, model: s.model, promptId: prompt.id, promptVersion: prompt.version, timeoutMs: 180_000, context: { sourceComponent: SOURCE },
    call: (signal) => callModel({ provider: s.provider, model: s.model, maxTokens: VERIFICATION_MAX_TOKENS, system: VERIFICATION_SYSTEM_PROMPT, user, jsonSchema: VERIFICATION_JSON_SCHEMA as never }, signal),
    parseUsage: parseCallModelUsage,
    validate: (raw) => validateJson(raw, (parsed) => { const r = VerificationSchema.safeParse(parsed); return r.success ? { value: r.data as Verification | null, errors: [] } : { value: null, errors: r.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`) }; }),
    fallback: () => null,
  });
  const e = out.execution;
  return { run: out.result ? { solver: s.solver, provider: e.provider, model: e.model, executionId: e.executionId, verification: out.result } : null, cost: costOf(e) };
}
