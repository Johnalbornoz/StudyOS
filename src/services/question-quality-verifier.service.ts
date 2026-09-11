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
import { QUESTION_QUALITY_VERDICT_SCHEMA } from '@/lib/ai/schemas';
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
          if (!p || typeof p.conceptAligned !== 'boolean' || typeof p.answerCorrect !== 'boolean') {
            return { valid: false, errors: ['bad verdict shape'] };
          }
          return {
            valid: true,
            value: {
              conceptAligned: p.conceptAligned,
              answerCorrect: p.answerCorrect,
              unambiguous: p.unambiguous !== false,
              reasoningConsistent: p.reasoningConsistent !== false,
              distractorsPlausible: p.distractorsPlausible !== false,
              scenarioAppropriate: p.scenarioAppropriate !== false,
              visualConsistent: p.visualConsistent !== false,
              issues: Array.isArray(p.issues) ? p.issues.slice(0, 12) : [],
              confidence: typeof p.confidence === 'number' ? p.confidence : 0,
            },
          };
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
