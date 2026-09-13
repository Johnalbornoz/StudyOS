/**
 * LX-4P-PERF-R1C C6 -- INDEPENDENT semantic quality verifier for
 * generated questions.
 *
 * Runs AFTER `checkQuestionQualityDeterministic`, only on the claims
 * deterministic validation cannot establish: concept alignment,
 * non-deterministic answer correctness, ambiguity, reasoning-requirement
 * consistency, distractor plausibility, scenario/pedagogical
 * appropriateness, visual dependence. Strict structured verdict only --
 * it never rewrites the question. The generator can NEVER self-certify.
 *
 * Routed to the stronger evaluation model (Terra) per CAPABILITY_ROUTING.
 */
import { executeAI, getPrompt, AIExecutionFailure } from '@/lib/ai';
import { callModel, parseCallModelUsage, type CallModelResult } from '@/lib/ai/adapters/call-model';
import { resolveModels } from '@/lib/ai/model-routing';
import { budgetFor } from '@/lib/ai/token-budgets';
import { QUESTION_QUALITY_VERDICT_SCHEMA, QUESTION_QUALITY_VERDICT_BATCH_SCHEMA } from '@/lib/ai/schemas';
import { parseAIJson } from '@/lib/ai-json';
import type { GeneratedQuestion } from '@/services/quiz-generation.service';
import type { SemanticVerdict } from '@/lib/ai/quality-runtime';
import type { ProviderUsage } from '@/lib/ai/usage';

export interface QuestionQualityVerdict {
  conceptAligned: boolean;
  answerCorrect: boolean;
  unambiguous: boolean;
  reasoningConsistent: boolean;
  distractorsPlausible: boolean;
  scenarioAppropriate: boolean;
  visualConsistent: boolean;
  issues: string[];
  confidence: number;
}

export const QUALITY_VERIFY_MIN_CONFIDENCE = 0.7;

/** Pure: a verdict passes only if every dimension holds with real confidence. */
export function evaluateQuestionQualityVerdict(v: QuestionQualityVerdict | null | undefined): SemanticVerdict {
  if (
    !v ||
    typeof v.conceptAligned !== 'boolean' ||
    typeof v.answerCorrect !== 'boolean' ||
    typeof v.confidence !== 'number' ||
    Number.isNaN(v.confidence)
  ) {
    return { pass: false, reason: 'QUALITY_VERIFY_ERROR' };
  }
  const failed: string[] = [];
  if (!v.conceptAligned) failed.push('concept-misaligned');
  if (!v.answerCorrect) failed.push('answer-incorrect');
  if (!v.unambiguous) failed.push('ambiguous');
  if (!v.reasoningConsistent) failed.push('reasoning-inconsistent');
  if (!v.distractorsPlausible) failed.push('weak-distractors');
  if (!v.scenarioAppropriate) failed.push('scenario-inappropriate');
  if (!v.visualConsistent) failed.push('visual-inconsistent');
  if (failed.length > 0) return { pass: false, reason: `SEMANTIC_QUALITY_FAIL: ${failed.join(',')}` };
  if (v.confidence < QUALITY_VERIFY_MIN_CONFIDENCE) return { pass: false, reason: 'QUALITY_LOW_CONFIDENCE' };
  return { pass: true, reason: '' };
}

function buildPrompt(q: GeneratedQuestion, requestedLanguage: string, hasVisual: boolean): { system: string; user: string } {
  const system = `You VERIFY the quality of one generated exam question. You do NOT rewrite, fix or improve it -- you only judge, on the dimensions below. Any "false" must be explained in "issues".

- conceptAligned: does the question genuinely test the stated concept (not a tangential fact)?
- answerCorrect: is the given correctAnswer actually correct for this question? (For choice questions, is exactly the intended option right and the others wrong?)
- unambiguous: is there exactly one defensible answer, with no contradictory or trick structure?
- reasoningConsistent: does the reasoning the question demands match its expectedReasoningType / cognitiveLevel tags (when present)?
- distractorsPlausible: (choice questions) are the wrong options plausible-but-wrong, not obviously absurd or duplicative?
- scenarioAppropriate: (scenario/case/justification/etc.) is the scenario realistic and pedagogically sound for this level?
- visualConsistent: (if a visual is present) does the visual's data agree with the stem and not contradict it? If no visual, return true.

Output ONLY this JSON: {"conceptAligned":<bool>,"answerCorrect":<bool>,"unambiguous":<bool>,"reasoningConsistent":<bool>,"distractorsPlausible":<bool>,"scenarioAppropriate":<bool>,"visualConsistent":<bool>,"issues":["..."],"confidence":<0..1>}
Be strict. If unsure, lower the confidence rather than guessing "true".`;

  const payload = {
    requestedLanguage,
    type: q.type,
    cognitiveLevel: q.cognitiveLevel ?? null,
    expectedReasoningType: q.expectedReasoningType ?? null,
    question: q.question,
    options: q.options?.map((o) => ({ id: o.id, text: o.text })) ?? null,
    correctAnswer: q.correctAnswer,
    explanation: q.explanation,
    visualAid: hasVisual ? q.visualAid : null,
  };
  return { system, user: `Verify this question. Return the JSON verdict.\n\n${JSON.stringify(payload, null, 2)}` };
}

/** Same per-question payload buildPrompt sends, tagged with the caller's own opaque id -- the ONLY thing that maps a batch verdict back to its candidate (never array position). */
function questionPayload(id: string, q: GeneratedQuestion, requestedLanguage: string): Record<string, unknown> {
  return {
    id,
    requestedLanguage,
    type: q.type,
    cognitiveLevel: q.cognitiveLevel ?? null,
    expectedReasoningType: q.expectedReasoningType ?? null,
    question: q.question,
    options: q.options?.map((o) => ({ id: o.id, text: o.text })) ?? null,
    correctAnswer: q.correctAnswer,
    explanation: q.explanation,
    visualAid: q.visualAid ? q.visualAid : null,
  };
}

function buildBatchPrompt(candidates: QuestionQualityBatchCandidate[], requestedLanguage: string): { system: string; user: string } {
  const system = `You VERIFY the quality of MULTIPLE generated exam questions in one pass. Judge EACH one ENTIRELY ON ITS OWN merits -- one candidate's content, quality, or issues must NEVER influence another candidate's verdict. You do NOT rewrite, fix, or improve any of them -- you only judge each one, on the dimensions below. Any "false" for a candidate must be explained in THAT candidate's own "issues".

- conceptAligned: does the question genuinely test the stated concept (not a tangential fact)?
- answerCorrect: is the given correctAnswer actually correct for this question? (For choice questions, is exactly the intended option right and the others wrong?)
- unambiguous: is there exactly one defensible answer, with no contradictory or trick structure?
- reasoningConsistent: does the reasoning the question demands match its expectedReasoningType / cognitiveLevel tags (when present)?
- distractorsPlausible: (choice questions) are the wrong options plausible-but-wrong, not obviously absurd or duplicative?
- scenarioAppropriate: (scenario/case/justification/etc.) is the scenario realistic and pedagogically sound for this level?
- visualConsistent: (if a visual is present) does the visual's data agree with the stem and not contradict it? If no visual, return true.

Output ONLY this JSON object: {"verdicts": [{"id":"<the exact id given for that candidate>","conceptAligned":<bool>,"answerCorrect":<bool>,"unambiguous":<bool>,"reasoningConsistent":<bool>,"distractorsPlausible":<bool>,"scenarioAppropriate":<bool>,"visualConsistent":<bool>,"issues":["..."],"confidence":<0..1>}, ...]} -- EXACTLY one verdict per candidate given, each carrying that candidate's OWN "id" back verbatim, in any order.
Be strict. If unsure about a candidate, lower THAT candidate's own confidence rather than guessing "true" -- never let uncertainty about one candidate lower another's.`;

  const user = `Verify these ${candidates.length} questions, independently of each other. Return the JSON verdict array.\n\n${JSON.stringify(
    candidates.map((c) => questionPayload(c.id, c.question, requestedLanguage)),
    null,
    2
  )}`;
  return { system, user };
}

/** Shared field-coercion for one raw verdict object -- the SAME normalization verifyQuestionQuality's own `validate` applies, reused so the batch path can never silently drift from the single-candidate contract. Returns null (fail closed) only on a structurally unusable shape (missing the two required boolean fields). */
function normalizeVerdictFields(p: any): QuestionQualityVerdict | null {
  if (!p || typeof p.conceptAligned !== 'boolean' || typeof p.answerCorrect !== 'boolean') return null;
  return {
    conceptAligned: p.conceptAligned,
    answerCorrect: p.answerCorrect,
    unambiguous: p.unambiguous !== false,
    reasoningConsistent: p.reasoningConsistent !== false,
    distractorsPlausible: p.distractorsPlausible !== false,
    scenarioAppropriate: p.scenarioAppropriate !== false,
    visualConsistent: p.visualConsistent !== false,
    issues: Array.isArray(p.issues) ? p.issues.slice(0, 12) : [],
    confidence: typeof p.confidence === 'number' ? p.confidence : 0,
  };
}

export interface QuestionQualityBatchCandidate {
  /** Opaque, caller-assigned id (e.g. an index-derived string) -- never the question's own content, and never reused across candidates in the same batch. */
  id: string;
  question: GeneratedQuestion;
}

export async function verifyQuestionQuality(input: {
  question: GeneratedQuestion;
  requestedLanguage: string;
  context?: { studentId?: string; subjectId?: string };
  /**
   * LX-4P-PERF-R1G: optional -- reports the REAL provider usage for this
   * ONE semantic-verification call, whatever the outcome (accepted
   * verdict, a rejected/invalid verdict shape, or a thrown
   * AIExecutionFailure). Never fabricated; omitted fields mean the
   * provider didn't report them. Purely additive.
   */
  onUsage?: (usage: ProviderUsage, model: string) => void;
}): Promise<QuestionQualityVerdict | null> {
  const { question, requestedLanguage, context } = input;
  const prompt = getPrompt('quiz.question_quality_verify');
  const route = resolveModels(prompt.capability); // EXPLANATION_EVALUATION -> Terra
  const budget = budgetFor('semantic_verification');
  const { system, user } = buildPrompt(question, requestedLanguage, !!question.visualAid);

  try {
    const { result, execution } = await executeAI<CallModelResult, QuestionQualityVerdict>({
      capability: prompt.capability,
      risk: 'HIGH_RISK',
      provider: route.provider,
      model: route.primary,
      promptId: prompt.id,
      promptVersion: prompt.version,
      context: { ...context, conceptId: question.conceptId, sourceComponent: 'question-quality-verifier.service.ts:verifyQuestionQuality' },
      call: (signal) =>
        callModel(
          { provider: route.provider, model: route.primary, system, user, maxTokens: budget.maxOutputTokens, jsonSchema: QUESTION_QUALITY_VERDICT_SCHEMA, reasoningEffort: budget.reasoningEffort },
          signal,
        ),
      // LX-4P-PERF-R1G: extracted right after `call` resolves, before
      // `validate` -- survives a rejected/invalid verdict shape.
      parseUsage: (raw) => parseCallModelUsage(raw),
      validate: (raw) => {
        try {
          const p = parseAIJson<QuestionQualityVerdict>(raw.text || '{}');
          const value = normalizeVerdictFields(p);
          if (!value) return { valid: false, errors: ['bad verdict shape'] };
          return { valid: true, value };
        } catch {
          return { valid: false, errors: ['parse error'] };
        }
      },
    });
    input.onUsage?.(
      { inputTokens: execution.inputTokens ?? null, cachedInputTokens: execution.cachedInputTokens ?? null, outputTokens: execution.outputTokens ?? null },
      route.primary,
    );
    return result;
  } catch (err) {
    // LX-4P-PERF-R1G: a StudyUS-side validation rejection (thrown as
    // AIExecutionFailure) still carries whatever real usage the provider
    // returned -- that call was already billed. A `call`-level failure
    // (timeout, network error) never obtained a response, so `execution`
    // carries no usage there, matching the provider's actual bill.
    if (err instanceof AIExecutionFailure) {
      input.onUsage?.(
        { inputTokens: err.execution.inputTokens ?? null, cachedInputTokens: err.execution.cachedInputTokens ?? null, outputTokens: err.execution.outputTokens ?? null },
        route.primary,
      );
    }
    return null;
  }
}

/**
 * LX-9R3 D3 -- verifies MULTIPLE candidates in ONE Terra call instead of
 * one call per candidate. Same independent, verify-only semantic gate as
 * `verifyQuestionQuality` (identical dimensions, identical Terra
 * routing, identical fail-closed philosophy) -- only the transport is
 * batched.
 *
 * Candidate isolation is structural, never left to prose compliance:
 * every result is looked up STRICTLY by the caller-assigned `id` a
 * verdict carries back, never by array position (a short, reordered, or
 * partially-malformed response can never silently shift one candidate's
 * verdict onto another). Every input id starts mapped to `null`
 * (fail-closed) BEFORE the call is even made; only a well-formed verdict
 * carrying that EXACT id overwrites it. A single call-level failure
 * (thrown AIExecutionFailure) fails EVERY candidate closed, identically
 * to what N independent calls each failing would already do -- it never
 * approves anything.
 */
export async function verifyQuestionQualityBatch(input: {
  candidates: QuestionQualityBatchCandidate[];
  requestedLanguage: string;
  context?: { studentId?: string; subjectId?: string };
  /** LX-4P-PERF-R1G-style usage reporting -- ONE entry for this ONE batched call (never fabricated per-candidate). */
  onUsage?: (usage: ProviderUsage, model: string) => void;
}): Promise<Map<string, QuestionQualityVerdict | null>> {
  const { candidates, requestedLanguage, context } = input;
  const results = new Map<string, QuestionQualityVerdict | null>();
  for (const c of candidates) results.set(c.id, null); // fail-closed default for every id, before the call is even attempted
  if (candidates.length === 0) return results;

  const prompt = getPrompt('quiz.question_quality_verify_batch');
  const route = resolveModels(prompt.capability); // EXPLANATION_EVALUATION -> Terra
  const perCandidateBudget = budgetFor('semantic_verification');
  // Scales with candidate count, same shape as this codebase's other
  // count-scaled budgets (e.g. quiz-generation.service.ts's batch
  // generation calls) -- bounded, never unbounded.
  const maxTokens = Math.min(16000, 300 + candidates.length * perCandidateBudget.maxOutputTokens);
  const { system, user } = buildBatchPrompt(candidates, requestedLanguage);
  const conceptIds = new Set(candidates.map((c) => c.question.conceptId));
  const conceptId = conceptIds.size === 1 ? candidates[0].question.conceptId : undefined;

  try {
    const { result, execution } = await executeAI<CallModelResult, Map<string, QuestionQualityVerdict | null>>({
      capability: prompt.capability,
      risk: 'HIGH_RISK',
      provider: route.provider,
      model: route.primary,
      promptId: prompt.id,
      promptVersion: prompt.version,
      context: { ...context, conceptId, sourceComponent: 'question-quality-verifier.service.ts:verifyQuestionQualityBatch' },
      call: (signal) =>
        callModel(
          { provider: route.provider, model: route.primary, system, user, maxTokens, jsonSchema: QUESTION_QUALITY_VERDICT_BATCH_SCHEMA, reasoningEffort: perCandidateBudget.reasoningEffort },
          signal,
        ),
      parseUsage: (raw) => parseCallModelUsage(raw),
      validate: (raw) => {
        try {
          const parsed = parseAIJson<{ verdicts?: unknown[] }>(raw.text || '{}');
          const verdicts = Array.isArray(parsed?.verdicts) ? parsed.verdicts : [];
          const byId = new Map(results); // starts as every id -> null
          for (const raw of verdicts) {
            const v = raw as any;
            if (!v || typeof v.id !== 'string' || !byId.has(v.id)) continue; // an unrecognized/foreign id is ignored, never assigned to any candidate
            const normalized = normalizeVerdictFields(v);
            if (normalized) byId.set(v.id, normalized); // a malformed verdict for this id simply leaves it at its null default -- never applied, never leaks onto another id
          }
          // Always "valid" -- a missing/malformed verdict degrades that
          // ONE candidate to null (fail-closed), never the whole batch;
          // there is no shape the batch response can take that should
          // throw this call away entirely once ANY well-formed verdict
          // was found for ANY candidate. An empty/garbage response still
          // leaves every id at its pre-seeded null default.
          return { valid: true, value: byId };
        } catch {
          return { valid: true, value: new Map(results) }; // parse failure -- every candidate stays at its fail-closed null default
        }
      },
    });
    input.onUsage?.(
      { inputTokens: execution.inputTokens ?? null, cachedInputTokens: execution.cachedInputTokens ?? null, outputTokens: execution.outputTokens ?? null },
      route.primary,
    );
    return result;
  } catch (err) {
    if (err instanceof AIExecutionFailure) {
      input.onUsage?.(
        { inputTokens: err.execution.inputTokens ?? null, cachedInputTokens: err.execution.cachedInputTokens ?? null, outputTokens: err.execution.outputTokens ?? null },
        route.primary,
      );
    }
    return results; // every id stays at its fail-closed null default
  }
}
