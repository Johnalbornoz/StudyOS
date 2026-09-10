/**
 * LX-4P-PERF-R1C C5/C7/C8 -- the canonical Practice question path,
 * quality-gated.
 *
 *   Luna generation
 *     -> per-question deterministic Question Quality Contract
 *        (drop FAIL; keep PASS / NOT_DETERMINISTICALLY_VERIFIED)
 *     -> per-question SEMANTIC verification for the not-deterministic ones
 *        (Terra; drop failures)
 *     -> ACCEPT the survivors
 *   If NOTHING survives ->
 *   ONE Terra regeneration -> same gates -> ACCEPT / REJECT ([]).
 *
 * Never a 3rd model call. Never a Claude fallback. `[]` is a recoverable
 * "couldn't prepare Practice" -- the client already handles it
 * (genState:'error' -> retry), never a dead end, never fabricated
 * questions.
 */
import { resolveModels, TERRA } from '@/lib/ai/model-routing';
import { recordRuntimeEvent, buildRuntimeEvent } from '@/lib/ai/runtime-event';
import { checkQuestionQualityDeterministic } from '@/lib/lx/question-quality-contract';
import { verifyQuestionQuality, evaluateQuestionQualityVerdict } from '@/services/question-quality-verifier.service';
import { generateQuestionsForConcept, type GeneratedQuestion } from '@/services/quiz-generation.service';

export interface GatedPracticeOptions {
  count?: number;
  difficulty?: number;
  guidance?: string;
  language?: string;
  visualAidRate?: number;
  ibContext?: any;
}

/**
 * Run the quality gate over a generated batch. Returns only the
 * questions that clear BOTH the deterministic contract and (where
 * needed) semantic verification.
 */
export async function applyQuestionQualityGate(
  questions: GeneratedQuestion[],
  req: { conceptId: string; language?: string; context?: { studentId?: string; subjectId?: string } },
): Promise<{ accepted: GeneratedQuestion[]; deterministicRejected: number; semanticRejected: number }> {
  const survivors: GeneratedQuestion[] = [];
  let deterministicRejected = 0;
  let semanticRejected = 0;

  for (const q of questions) {
    const det = checkQuestionQualityDeterministic(q, {
      conceptId: req.conceptId,
      cognitiveLevel: q.cognitiveLevel,
      expectedReasoningType: q.expectedReasoningType,
      difficulty: q.difficulty,
      activityLanguage: req.language,
    });
    if (det.status === 'FAIL') {
      deterministicRejected++;
      continue;
    }
    if (det.status === 'PASS') {
      survivors.push(q);
      continue;
    }
    // NOT_DETERMINISTICALLY_VERIFIED -> independent semantic verdict.
    const verdict = await verifyQuestionQuality({ question: q, requestedLanguage: req.language || 'en', context: req.context });
    const evaluated = evaluateQuestionQualityVerdict(verdict);
    if (evaluated.pass) survivors.push(q);
    else semanticRejected++;
  }

  return { accepted: survivors, deterministicRejected, semanticRejected };
}

/**
 * Canonical Practice batch, quality-gated. `count` stays the canonical
 * Evidence Sufficiency count -- this never restores 20-question Practice.
 */
export async function generateGatedPracticeBatch(
  conceptId: string,
  studentId: string,
  subjectId: string,
  opts: GatedPracticeOptions,
): Promise<GeneratedQuestion[]> {
  const route = resolveModels('QUESTION_GENERATION');
  const ctx = { studentId, subjectId };
  const baseGenOpts = {
    count: opts.count,
    difficulty: opts.difficulty,
    guidance: opts.guidance,
    language: opts.language,
    visualAidRate: opts.visualAidRate,
    ibContext: opts.ibContext ?? null,
  };

  const emit = (model: string, fallbackUsed: boolean, gate: 'PASS' | 'REJECTED', fallbackReason?: string) =>
    recordRuntimeEvent(
      buildRuntimeEvent({
        capability: 'QUESTION_GENERATION',
        provider: 'openai',
        model,
        promptId: 'quiz.question_generation',
        promptVersion: 'v3',
        inputTokens: null,
        cachedInputTokens: null,
        outputTokens: null,
        latencyMs: 0,
        fallbackUsed,
        fallbackReason,
        qualityGateResult: gate,
      }),
    );

  // --- attempt 1: Luna ---
  const luna = await generateQuestionsForConcept(conceptId, studentId, subjectId, baseGenOpts).catch(() => [] as GeneratedQuestion[]);
  const g1 = await applyQuestionQualityGate(luna, { conceptId, language: opts.language, context: ctx });
  if (g1.accepted.length > 0) {
    emit(route.primary, false, 'PASS');
    return g1.accepted;
  }
  const reason1 = `luna: ${luna.length} generated, ${g1.deterministicRejected} deterministic-fail, ${g1.semanticRejected} semantic-fail`;
  emit(route.primary, false, 'REJECTED', reason1);

  // --- attempt 2: Terra (single fallback) ---
  const terra = await generateQuestionsForConcept(conceptId, studentId, subjectId, { ...baseGenOpts, modelOverride: TERRA }).catch(
    () => [] as GeneratedQuestion[],
  );
  const g2 = await applyQuestionQualityGate(terra, { conceptId, language: opts.language, context: ctx });
  if (g2.accepted.length > 0) {
    emit(TERRA, true, 'PASS', reason1);
    return g2.accepted;
  }

  // --- fail closed: recoverable empty batch ---
  emit(TERRA, true, 'REJECTED', `${reason1} -> terra: ${terra.length} generated, ${g2.deterministicRejected} det-fail, ${g2.semanticRejected} sem-fail`);
  return [];
}
