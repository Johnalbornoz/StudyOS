/**
 * QUESTION FACTORY CANARY 250 -- from the run log to every derived result (pure: no network, no clock, no file IO).
 * FROZEN with generator version 3, validators revision 4, the reviewer and its decision policy.
 *
 * FIRST ATTEMPTS ONLY. MAX_AUTOMATIC_REGENERATIONS = 0. A slot has one generation call and, when it produced a
 * candidate, one review call. Whatever a call returned is what the slot is: nothing is retried, repaired or rescued.
 *
 * GENERATOR. Harness version 3, unchanged, renders the prompt of each slot (attempt 1; do-not-reuse lists from
 * QB-R2D and QB-R2E only, which are fixed). THE CANARY ADDS ONE MEMBER to the instruction that is sent,
 * `slotGuidance` -- version 3 has no place for it -- so the request that leaves is the version-3 prompt plus that
 * member. Both are identified: `promptHash` is version 3's (it is what the lineage carries), `requestHash` is the
 * hash of what was actually sent. A recorded call whose requestHash is not the planned one is refused on replay.
 *
 * PROMPTS DO NOT DEPEND ON OTHER ANSWERS OF THE RUN, so generation calls can run side by side and in any order;
 * every derived result is computed in manifest order from the log, whatever order the log was written in.
 * REVIEWS DEPEND ON THE WHOLE BATCH (the validator results a reviewer is shown include originality and batch
 * diversity), so no review is planned until every slot's generation is closed.
 */
import { sha256OfCanonicalJson } from '@/lib/assessment-adaptation/canonical-hash';
import type { CandidateStimulus } from '@/lib/exam-core/question-bank/production/generation-contract';
import { RecordedResponseProvider } from '@/lib/exam-core/question-bank/production/generator/provider';
import { parseSpecificationWireResponse, SpecificationGenerationV2Error } from '@/lib/exam-core/question-bank/production/generator/specification-generation-v2';
import { generateFromSpecificationV3, renderSpecificationPromptV3, SPECIFICATION_GENERATION_HARNESS_V3, SPECIFICATION_TEMPLATE_REGISTRY_V3, SpecificationGenerationV3Error, type AvoidLists } from '@/lib/exam-core/question-bank/production/generator/specification-generation-v3';
import { constructIntegrityOf, constructVocabularyOf } from '@/lib/exam-core/question-bank/production/math-construct-registry';
import type { SpecificationCandidate } from '@/lib/exam-core/question-bank/production/specification-candidate';
import { SPECIFICATION_VALIDATORS_REVISION_4, validateSpecificationCandidateR4, type SpecificationItemValidationR4 } from '@/lib/exam-core/question-bank/production/specification-validators-r4';
import type { CanaryEvidence } from './evidence';
import { CANARY_SLOT_GUIDANCE, SLOT_GUIDANCE_RULE, type CanaryManifest, type CanarySlot } from './manifest';
import { AI_REVIEW_KIND, buildReviewInput, decide, parseReviewResponse, renderReviewRequest, REVIEW_STATUS_UNCHANGED, REVIEWER_VERSION, ReviewRefusedError, validatorStrictPass, type AiDecision, type RenderedReview, type ReviewResponse } from './reviewer';
import type { RunLog } from './run-log';

export const MAX_AUTOMATIC_REGENERATIONS = 0 as const;
export const CANARY_BATCH_KEY = 'qb-canary-250' as const;
export const CANARY_POLICY = { id: 'qb-canary-250-generation', version: '1' } as const;
export const CANARY_REQUESTED_BY = 'qb-canary-250-lane' as const;
export const CANARY_LABEL = 'EPHEMERAL -- NOT INGESTED -- DEV_TEST_CONTENT -- RIGHTS_NOT_ESTABLISHED -- AUTOMATED VALIDATION AND AI REVIEW ONLY, NO HUMAN REVIEW' as const;
export const CANARY_VERSIONS = {
  generator: { harness: SPECIFICATION_GENERATION_HARNESS_V3, slotGuidance: CANARY_SLOT_GUIDANCE }, validators: { revision: SPECIFICATION_VALIDATORS_REVISION_4 }, reviewer: REVIEWER_VERSION,
} as const;
/** A scenario of an earlier run is passed on as at most this many characters. */
const AVOID_SCENARIO_MAX_CHARACTERS = 120;

export const canaryPolicyFor = (model: string, language: string) => ({ policyId: CANARY_POLICY.id, policyVersion: CANARY_POLICY.version, author: { kind: 'MODEL' as const, model, promptVersion: 'specification-prompt@3', requestedBy: CANARY_REQUESTED_BY }, language, copyReferenceExpression: false as const });
export const unitKeyOf = (slotId: string): string => `${slotId}#a1`;
const sortedParameters = (c: SpecificationCandidate): Record<string, number> => Object.fromEntries(Object.entries(c.content.declaredModel.parameters).sort(([a], [b]) => (a < b ? -1 : 1)));
/** What a slot is told not to reuse: the parameter sets of its construct and the scenarios of its family in QB-R2D and QB-R2E. Fixed; nothing of this run. */
export function avoidListsOf(slot: CanarySlot, evidence: Pick<CanaryEvidence, 'priorCandidates'>): AvoidLists {
  const unique = <T>(xs: T[]): T[] => { const seen = new Set<string>(); return xs.filter((x) => { const k = JSON.stringify(x); if (seen.has(k)) return false; seen.add(k); return true; }); };
  return {
    parameterSets: unique(evidence.priorCandidates.filter((c) => c.content.declaredModel.construct === slot.construct).map(sortedParameters)),
    scenarios: unique(evidence.priorCandidates.filter((c) => c.lineage.taskFamily.id === slot.familyId).map((c) => c.content.context.description.replace(/\s+/g, ' ').trim().slice(0, AVOID_SCENARIO_MAX_CHARACTERS))),
  };
}
const inputOf = (slot: CanarySlot, model: string, avoid: AvoidLists) => ({ unit: { unitKey: unitKeyOf(slot.slotId), specification: slot.specification, attempt: 1, avoid }, constructVocabulary: constructVocabularyOf(slot.construct), constructIntegrity: constructIntegrityOf(slot.construct), policy: canaryPolicyFor(model, slot.specification.variable.language), templateRegistry: SPECIFICATION_TEMPLATE_REGISTRY_V3 });

export interface PlannedGeneration { slotId: string; unitKey: string; promptHash: string; requestHash: string; system: string; user: string; avoid: AvoidLists }
export function planGeneration(slot: CanarySlot, model: string, evidence: Pick<CanaryEvidence, 'priorCandidates'>): PlannedGeneration {
  const avoid = avoidListsOf(slot, evidence);
  const rendered = renderSpecificationPromptV3({ ...inputOf(slot, model, avoid), provider: { id: 'render', model, generate: async () => { throw new Error('RENDER_ONLY'); } } });
  const instruction = { ...rendered.prompt.instruction, slotGuidance: { id: CANARY_SLOT_GUIDANCE.id, ...slot.guidance, rule: SLOT_GUIDANCE_RULE } };
  return { slotId: slot.slotId, unitKey: unitKeyOf(slot.slotId), promptHash: rendered.promptHash, requestHash: sha256OfCanonicalJson({ system: rendered.prompt.system, instruction }), system: rendered.prompt.system, user: JSON.stringify(instruction), avoid };
}
export function generationMalformedCodeOf(rawText: string): string | null {
  try { parseSpecificationWireResponse(rawText); return null; } catch (e) { return e instanceof SpecificationGenerationV2Error ? e.code : 'PROVIDER_RESPONSE_NOT_JSON'; }
}

/**
 * What a slot's generation came to.
 *   CANDIDATE                 the harness accepted the answer
 *   REFUSED_BY_HARNESS        a well-formed answer the harness refused by one of its named rules   -> HARNESS_REFUSAL
 *   MALFORMED                 an answer that is not the strict response shape (not JSON, schema, empty, truncated,
 *                             a provider refusal)                                                   -> PROVIDER_FAILURE
 *   NO_CONTENT                a transport failure, a rejected request, or a call started and never recorded
 *                                                                                                   -> PROVIDER_FAILURE
 *   NOT_CALLED_BUDGET_STOP    the budget refused the call
 *   NOT_RUN                   the run has not reached it
 */
export type GenerationState = 'CANDIDATE' | 'REFUSED_BY_HARNESS' | 'MALFORMED' | 'NO_CONTENT' | 'NOT_CALLED_BUDGET_STOP' | 'NOT_RUN';
export interface GenerationResult { slot: CanarySlot; plan: PlannedGeneration; state: GenerationState; code: string | null; detail: string | null; candidate: SpecificationCandidate | null; stimulus: CandidateStimulus | null; guidanceFollowed: boolean | null }
export class ReplayMismatchError extends Error { constructor(detail: string) { super(`RECORDED_CALL_IS_NOT_THE_PLANNED_ONE: ${detail}`); this.name = 'ReplayMismatchError'; } }

function guidanceFollowed(slot: CanarySlot, c: SpecificationCandidate): boolean {
  const P = c.content.declaredModel.parameters;
  const pinned = Object.entries(slot.guidance.pinnedParameters).every(([k, v]) => typeof P[k] === 'number' && Math.abs(P[k] - v) < 1e-9);
  const claim = slot.guidance.claim;
  const target = c.content.selected?.target ?? c.content.numeric?.target ?? null;
  const verdicts = [target, ...(c.content.constructed?.parts.map((p) => p.target) ?? [])].flatMap((t) => (t && (t.kind === 'VERDICT' ? [t.value] : t.kind === 'COMPARISON' && t.verdict ? [t.verdict] : [])));
  return pinned && (claim === null || verdicts.length === 0 || verdicts.includes(claim.verdict));
}
export async function deriveGeneration(manifest: CanaryManifest, log: RunLog, evidence: Pick<CanaryEvidence, 'priorCandidates'>, model: string): Promise<GenerationResult[]> {
  const out: GenerationResult[] = [];
  const header = log.header();
  for (const slot of manifest.slots) {
    const plan = planGeneration(slot, model, evidence);
    const o = log.outcomeOf('GENERATION', slot.slotId);
    const none = { slot, plan, candidate: null, stimulus: null, guidanceFollowed: null };
    if (o.state === 'NOT_RUN') { out.push({ ...none, state: 'NOT_RUN', code: null, detail: null }); continue; }
    if (o.state === 'NOT_CALLED_BUDGET_STOP') { out.push({ ...none, state: 'NOT_CALLED_BUDGET_STOP', code: o.line.reason, detail: o.line.detail }); continue; }
    if (o.started.requestHash !== plan.requestHash) throw new ReplayMismatchError(`${slot.slotId} GENERATION ${o.started.requestHash.slice(0, 12)} / ${plan.requestHash.slice(0, 12)}`);
    if (o.state === 'NO_RESPONSE_RECORDED') { out.push({ ...none, state: 'NO_CONTENT', code: 'NO_RESPONSE_RECORDED', detail: null }); continue; }
    const f = o.finished;
    if (f.status === 'TRANSPORT_ERROR' || f.status === 'REQUEST_REJECTED') { out.push({ ...none, state: 'NO_CONTENT', code: f.status, detail: f.detail }); continue; }
    try {
      const r = await generateFromSpecificationV3({ ...inputOf(slot, model, plan.avoid), provider: new RecordedResponseProvider(o.started.provider, model, { [plan.promptHash]: f.rawText }), runId: header?.runId ?? 'no-run', batchKey: CANARY_BATCH_KEY, now: f.at });
      out.push({ slot, plan, state: 'CANDIDATE', code: null, detail: null, candidate: r.candidate, stimulus: r.stimulus, guidanceFollowed: guidanceFollowed(slot, r.candidate) });
    } catch (e) {
      if (!(e instanceof SpecificationGenerationV3Error)) throw e;
      out.push({ ...none, state: e.code === 'PROVIDER_RESPONSE_NOT_JSON' || e.code === 'PROVIDER_RESPONSE_SCHEMA_INVALID' ? 'MALFORMED' : 'REFUSED_BY_HARNESS', code: e.code, detail: e.detail });
    }
  }
  return out;
}
export const generationIsClosed = (results: readonly GenerationResult[]): boolean => results.every((r) => r.state !== 'NOT_RUN');

/** Revision 4 on every candidate, each against every other fresh candidate and every candidate of QB-R2D and QB-R2E. */
export function validateBatch(results: readonly GenerationResult[], evidence: Pick<CanaryEvidence, 'priorCandidates' | 'pilotCorpus'>): Map<string, SpecificationItemValidationR4> {
  const fresh = results.flatMap((r) => (r.candidate ? [r.candidate] : []));
  const out = new Map<string, SpecificationItemValidationR4>();
  for (const r of results) {
    if (!r.candidate) continue;
    const others = fresh.filter((c) => c !== r.candidate);
    out.set(r.slot.slotId, validateSpecificationCandidateR4({
      candidate: r.candidate, specification: r.slot.specification, stimulus: r.stimulus, siblings: [...others, ...evidence.priorCandidates], extraCorpus: evidence.pilotCorpus,
      peers: [...others.map((candidate) => ({ candidate, sameRun: true })), ...evidence.priorCandidates.map((candidate) => ({ candidate, sameRun: false }))],
    }));
  }
  return out;
}

export interface PlannedReview extends RenderedReview { slotId: string }
/** The review requests of a batch whose generation is closed, in manifest order: one per candidate. */
export function planReviews(results: readonly GenerationResult[], validations: ReadonlyMap<string, SpecificationItemValidationR4>): PlannedReview[] {
  if (!generationIsClosed(results)) return [];
  return results.flatMap((r) => (r.candidate ? [{ slotId: r.slot.slotId, ...renderReviewRequest(buildReviewInput({ slotId: r.slot.slotId, specification: r.slot.specification, candidate: r.candidate, stimulus: r.stimulus, validation: validations.get(r.slot.slotId)! })) }] : []));
}
/**
 *   REVIEWED            a review the harness accepted, and the decision policy's classification
 *   REVIEWER_FAILURE    no usable review: transport failure, rejected request, a call never recorded, a truncated
 *                       answer, a provider refusal, a malformed answer, or one refused by the no-repair rule
 *   NOT_CALLED_BUDGET_STOP / NOT_RUN / NO_CANDIDATE
 */
export type ReviewState = 'REVIEWED' | 'REVIEWER_FAILURE' | 'NOT_CALLED_BUDGET_STOP' | 'NOT_RUN' | 'NO_CANDIDATE';
export interface ReviewResult { slotId: string; kind: typeof AI_REVIEW_KIND; isHumanReview: false; reviewStatus: typeof REVIEW_STATUS_UNCHANGED; state: ReviewState; code: string | null; detail: string | null; requestHash: string | null; review: ReviewResponse | null; decision: AiDecision | null }
export function deriveReviews(results: readonly GenerationResult[], validations: ReadonlyMap<string, SpecificationItemValidationR4>, log: RunLog): ReviewResult[] {
  const plans = new Map(planReviews(results, validations).map((p) => [p.slotId, p]));
  return results.map((r): ReviewResult => {
    const base = { slotId: r.slot.slotId, kind: AI_REVIEW_KIND, isHumanReview: false as const, reviewStatus: REVIEW_STATUS_UNCHANGED, review: null, decision: null };
    if (!r.candidate) return { ...base, state: 'NO_CANDIDATE', code: null, detail: null, requestHash: null };
    const plan = plans.get(r.slot.slotId);
    const o = log.outcomeOf('REVIEW', r.slot.slotId);
    if (!plan || o.state === 'NOT_RUN') return { ...base, state: 'NOT_RUN', code: null, detail: null, requestHash: plan?.requestHash ?? null };
    if (o.state === 'NOT_CALLED_BUDGET_STOP') return { ...base, state: 'NOT_CALLED_BUDGET_STOP', code: o.line.reason, detail: o.line.detail, requestHash: plan.requestHash };
    if (o.started.requestHash !== plan.requestHash) throw new ReplayMismatchError(`${r.slot.slotId} REVIEW ${o.started.requestHash.slice(0, 12)} / ${plan.requestHash.slice(0, 12)}`);
    const failure = (code: string, detail: string | null): ReviewResult => ({ ...base, state: 'REVIEWER_FAILURE', code, detail, requestHash: plan.requestHash });
    if (o.state === 'NO_RESPONSE_RECORDED') return failure('NO_RESPONSE_RECORDED', null);
    const f = o.finished;
    if (f.status === 'TRANSPORT_ERROR' || f.status === 'REQUEST_REJECTED') return failure(f.status, f.detail);
    if (f.finishReason === 'refusal') return failure('REVIEWER_REFUSED_BY_PROVIDER', f.detail);
    if (f.finishReason === 'max_tokens') return failure('REVIEW_TRUNCATED', null);
    try {
      const review = parseReviewResponse(f.rawText);
      return { ...base, state: 'REVIEWED', code: null, detail: null, requestHash: plan.requestHash, review, decision: decide(review, validations.get(r.slot.slotId)!.gates) };
    } catch (e) {
      if (!(e instanceof ReviewRefusedError)) throw e;
      return failure(e.code, e.detail);
    }
  });
}
export { validatorStrictPass };
