/**
 * LX-4P-PERF-R1C C5/C7/C8 + R1C-R1 -- the UNIVERSAL Question Quality
 * Gate for every learner-facing generated question.
 *
 *   Luna generation
 *     -> per-question deterministic Question Quality Contract
 *        (drop FAIL; keep PASS / NOT_DETERMINISTICALLY_VERIFIED)
 *     -> per-question SEMANTIC verification for the not-deterministic ones
 *        (Terra; run in PARALLEL; drop failures)
 *     -> ACCEPT the survivors
 *   If a unit (batch / chunk / slot) has NOTHING (or, for
 *   all-or-nothing modes, fewer than it owes) ->
 *   ONE Terra regeneration of THAT unit -> same gates -> ACCEPT / REJECT.
 *
 * Never a 3rd model call per unit. Never a Claude fallback. `[]` (or a
 * short-of-target unit) is a recoverable "couldn't prepare" that the
 * caller maps to its own mode semantics (partial-tolerant vs
 * all-or-nothing) -- never fabricated questions, never an unvalidated
 * question reaching a learner.
 *
 * The number of questions requested never determines whether the gate
 * runs -- `<=4` canonical Practice, `>4` parallel chunks, Quick Check,
 * Retention, cumulative / exam, and variant generation all pass through
 * here (or through `applyQuestionQualityGate` directly).
 */
import { randomUUID } from 'crypto';
import { resolveModels, TERRA } from '@/lib/ai/model-routing';
import { recordRuntimeEvent, buildRuntimeEvent, buildAggregateRuntimeEvent, type BillableCallUsage } from '@/lib/ai/runtime-event';
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
  /** cumulative / exam / diagnostic pass the full catalog; canonical Practice leaves it default. */
  types?: any;
}

export interface QualityGateReq {
  conceptId: string;
  language?: string;
  context?: { studentId?: string; subjectId?: string };
}

/** Normalised text key for cheap, AI-free cross-source dedup of merged units. */
function textKey(q: GeneratedQuestion): string {
  return (q.question || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Run the quality gate over an already-generated batch. Returns only the
 * questions that clear BOTH the deterministic contract and (where the
 * contract is inconclusive) an INDEPENDENT semantic verdict. The
 * semantic checks run in PARALLEL -- the gate never serialises N Terra
 * round-trips.
 */
export async function applyQuestionQualityGate(
  questions: GeneratedQuestion[],
  req: QualityGateReq,
): Promise<{
  accepted: GeneratedQuestion[];
  deterministicRejected: number;
  semanticRejected: number;
  /**
   * LX-4P-PERF-R1G R9 -- the REAL usage of every Terra semantic-
   * verification call this gate run made (one per question that needed
   * one). These are billable AI calls in their own right; a caller
   * aggregating this unit's true cost must include them, not just the
   * generation call that produced the questions being verified.
   */
  semanticCalls: BillableCallUsage[];
}> {
  let deterministicRejected = 0;
  const needsSemantic: GeneratedQuestion[] = [];
  const passed: GeneratedQuestion[] = [];

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
      passed.push(q);
      continue;
    }
    needsSemantic.push(q); // NOT_DETERMINISTICALLY_VERIFIED
  }

  // Independent semantic verdicts, in parallel -- fail-closed on any
  // rejected/low-confidence/malformed verdict.
  const semanticCalls: BillableCallUsage[] = [];
  const verdicts = await Promise.all(
    needsSemantic.map(async (q) => {
      const verdict = await verifyQuestionQuality({
        question: q,
        requestedLanguage: req.language || 'en',
        context: req.context,
        onUsage: (usage, model) => {
          semanticCalls.push({ model, usage });
        },
      }).catch(() => null);
      return { q, ok: evaluateQuestionQualityVerdict(verdict).pass };
    }),
  );
  let semanticRejected = 0;
  const semanticSurvivors: GeneratedQuestion[] = [];
  for (const { q, ok } of verdicts) {
    if (ok) semanticSurvivors.push(q);
    else semanticRejected++;
  }

  // Preserve the caller's original ordering.
  const kept = new Set<GeneratedQuestion>([...passed, ...semanticSurvivors]);
  const accepted = questions.filter((q) => kept.has(q));
  return { accepted, deterministicRejected, semanticRejected, semanticCalls };
}

const QGEN_ROUTE = resolveModels('QUESTION_GENERATION');

function emitGateEvent(args: {
  model: string;
  fallbackUsed: boolean;
  fallbackReason?: string;
  acceptedCount: number;
  rejectedCount: number;
  gate: 'PASS' | 'DETERMINISTIC_FAIL' | 'SEMANTIC_FAIL' | 'REJECTED';
}): void {
  recordRuntimeEvent(
    buildRuntimeEvent({
      capability: 'QUESTION_GENERATION',
      provider: 'openai',
      model: args.model,
      promptId: 'quiz.question_generation',
      promptVersion: 'v3',
      inputTokens: null,
      cachedInputTokens: null,
      outputTokens: null,
      latencyMs: 0,
      fallbackUsed: args.fallbackUsed,
      fallbackReason: args.fallbackReason,
      qualityGateResult: args.gate,
      acceptedCount: args.acceptedCount,
      rejectedCount: args.rejectedCount,
    }),
  );
}

/**
 * LX-4P-PERF-R1G -- an OPERATION-level variant of `emitGateEvent`: prices
 * every REAL billable call this attempt made (its own generation call
 * plus every semantic-verification call the gate ran against it) and
 * tags the event with `operationId` so it can be correlated with the
 * OTHER attempt's event (e.g. Luna's event and a Terra fallback's event)
 * without ever summing them into one another -- each event still
 * reports only what THAT attempt itself consumed.
 */
function emitAggregateGateEvent(args: {
  model: string;
  fallbackUsed: boolean;
  fallbackReason?: string;
  acceptedCount: number;
  rejectedCount: number;
  gate: 'PASS' | 'DETERMINISTIC_FAIL' | 'SEMANTIC_FAIL' | 'REJECTED';
  operationId: string;
  calls: BillableCallUsage[];
}): void {
  recordRuntimeEvent(
    buildAggregateRuntimeEvent(
      {
        capability: 'QUESTION_GENERATION',
        provider: 'openai',
        model: args.model,
        promptId: 'quiz.question_generation',
        promptVersion: 'v3',
        latencyMs: 0,
        fallbackUsed: args.fallbackUsed,
        fallbackReason: args.fallbackReason,
        qualityGateResult: args.gate,
        acceptedCount: args.acceptedCount,
        rejectedCount: args.rejectedCount,
        operationId: args.operationId,
      },
      args.calls,
    ),
  );
}

function gateVerdict(accepted: number, det: number, sem: number): 'PASS' | 'DETERMINISTIC_FAIL' | 'SEMANTIC_FAIL' | 'REJECTED' {
  if (accepted > 0) return 'PASS';
  if (det > 0 && det >= sem) return 'DETERMINISTIC_FAIL';
  if (sem > 0) return 'SEMANTIC_FAIL';
  return 'REJECTED';
}

export interface GateUnitResult {
  accepted: GeneratedQuestion[];
  lunaAccepted: number;
  lunaRejected: number;
  terraAccepted: number;
  terraRejected: number;
  fallbackUsed: boolean;
  fallbackReason?: string;
}

/**
 * LX-4P-PERF-R1G R7/R8 -- optional real-usage plumbing for
 * `gateUnitWithTerraFallback`. Absent entirely, the function behaves
 * EXACTLY as before (hardcoded-null `[ai-runtime]` events via
 * `emitGateEvent`) -- this is how the >4 practice-chunk path stays
 * byte-for-byte unaffected by this repair. Present, the caller has
 * already collected every generation call it made (Luna's, and Terra's
 * if a fallback fires) via `generateQuestionsForConcept`'s `onUsage`,
 * and `operationId` correlates this unit's (up to two) `[ai-runtime]`
 * events with each other and with every constituent `[ai]` call log.
 */
export interface GateUnitTelemetry {
  lunaGenerationCalls: BillableCallUsage[];
  terraGenerationCalls: BillableCallUsage[];
  operationId: string;
}

/**
 * Gate ONE generation unit (a batch, a parallel chunk, or a single
 * slot's worth of questions) with at most ONE narrow Terra regeneration
 * of that same unit.
 *
 * `fallbackWhen`:
 *   - `'EMPTY'`  (partial-tolerant modes): Terra fires only when the
 *     gated Luna output is completely empty.
 *   - `'SHORT'`  (all-or-nothing modes): Terra fires when the gated Luna
 *     output has fewer than `targetCount` survivors.
 *
 * `regenerateWithTerra` re-runs generation for THIS unit only, on Terra
 * -- never the whole batch. No third attempt, ever.
 */
export async function gateUnitWithTerraFallback(
  luna: GeneratedQuestion[],
  req: QualityGateReq & { targetCount: number; fallbackWhen: 'EMPTY' | 'SHORT' },
  regenerateWithTerra: () => Promise<GeneratedQuestion[]>,
  telemetry?: GateUnitTelemetry,
): Promise<GateUnitResult> {
  const g1 = await applyQuestionQualityGate(luna, req);
  const lunaRejected = g1.deterministicRejected + g1.semanticRejected;
  const lunaGate = gateVerdict(g1.accepted.length, g1.deterministicRejected, g1.semanticRejected);
  if (telemetry) {
    emitAggregateGateEvent({
      model: QGEN_ROUTE.primary,
      fallbackUsed: false,
      acceptedCount: g1.accepted.length,
      rejectedCount: lunaRejected,
      gate: lunaGate,
      operationId: telemetry.operationId,
      calls: [...telemetry.lunaGenerationCalls, ...g1.semanticCalls],
    });
  } else {
    emitGateEvent({
      model: QGEN_ROUTE.primary,
      fallbackUsed: false,
      acceptedCount: g1.accepted.length,
      rejectedCount: lunaRejected,
      gate: lunaGate,
    });
  }

  const enough =
    req.fallbackWhen === 'EMPTY' ? g1.accepted.length > 0 : g1.accepted.length >= req.targetCount;
  if (enough) {
    return {
      accepted: g1.accepted.slice(0, req.targetCount),
      lunaAccepted: g1.accepted.length,
      lunaRejected,
      terraAccepted: 0,
      terraRejected: 0,
      fallbackUsed: false,
    };
  }

  const fallbackReason = `luna: ${luna.length} generated, ${g1.accepted.length} passed, ${g1.deterministicRejected} det-fail, ${g1.semanticRejected} sem-fail`;
  const terra = await regenerateWithTerra().catch(() => [] as GeneratedQuestion[]);
  const g2 = await applyQuestionQualityGate(terra, req);
  const terraRejected = g2.deterministicRejected + g2.semanticRejected;
  const terraGate = gateVerdict(g2.accepted.length, g2.deterministicRejected, g2.semanticRejected);
  if (telemetry) {
    emitAggregateGateEvent({
      model: TERRA,
      fallbackUsed: true,
      fallbackReason,
      acceptedCount: g2.accepted.length,
      rejectedCount: terraRejected,
      gate: terraGate,
      operationId: telemetry.operationId,
      calls: [...telemetry.terraGenerationCalls, ...g2.semanticCalls],
    });
  } else {
    emitGateEvent({
      model: TERRA,
      fallbackUsed: true,
      fallbackReason,
      acceptedCount: g2.accepted.length,
      rejectedCount: terraRejected,
      gate: terraGate,
    });
  }

  // Merge Luna survivors + Terra survivors, AI-free dedup, cap at target.
  const seen = new Set<string>();
  const merged: GeneratedQuestion[] = [];
  for (const q of [...g1.accepted, ...g2.accepted]) {
    const k = textKey(q);
    if (seen.has(k)) continue;
    seen.add(k);
    merged.push(q);
  }
  return {
    accepted: merged.slice(0, req.targetCount),
    lunaAccepted: g1.accepted.length,
    lunaRejected,
    terraAccepted: g2.accepted.length,
    terraRejected,
    fallbackUsed: true,
    fallbackReason,
  };
}

/**
 * The general gated single-batch path: Luna `generateQuestionsForConcept`
 * -> gate -> if empty, ONE Terra regeneration -> gate -> `[]`.
 *
 * `count` stays whatever the caller resolved (canonical Evidence
 * Sufficiency for Practice; per-concept cap for cumulative / exam) --
 * this never restores 20-question Practice and never changes a count.
 */
export async function generateGatedQuestionBatch(
  conceptId: string,
  studentId: string,
  subjectId: string,
  opts: GatedPracticeOptions,
): Promise<GeneratedQuestion[]> {
  const ctx = { studentId, subjectId };
  const baseGenOpts = {
    count: opts.count,
    difficulty: opts.difficulty,
    guidance: opts.guidance,
    language: opts.language,
    visualAidRate: opts.visualAidRate,
    ibContext: opts.ibContext ?? null,
    ...(opts.types ? { types: opts.types } : {}),
  };
  const target = Math.max(1, opts.count ?? 1);

  // LX-4P-PERF-R1G R7/R8 -- a fresh id correlates this operation's (up
  // to two) [ai-runtime] events with each other, and each generation
  // call's REAL usage is captured via onUsage as it happens (survives
  // whatever the Quality Gate later decides about the questions).
  const operationId = randomUUID();
  const lunaGenerationCalls: BillableCallUsage[] = [];
  const terraGenerationCalls: BillableCallUsage[] = [];

  const luna = await generateQuestionsForConcept(conceptId, studentId, subjectId, {
    ...baseGenOpts,
    onUsage: (usage) => {
      lunaGenerationCalls.push({ model: QGEN_ROUTE.primary, usage });
    },
  }).catch(() => [] as GeneratedQuestion[]);
  const result = await gateUnitWithTerraFallback(
    luna,
    { conceptId, language: opts.language, context: ctx, targetCount: target, fallbackWhen: 'EMPTY' },
    () =>
      generateQuestionsForConcept(conceptId, studentId, subjectId, {
        ...baseGenOpts,
        modelOverride: TERRA,
        onUsage: (usage) => {
          terraGenerationCalls.push({ model: TERRA, usage });
        },
      }).catch(() => [] as GeneratedQuestion[]),
    { lunaGenerationCalls, terraGenerationCalls, operationId },
  );
  return result.accepted;
}

/** Back-compat alias -- the canonical ~3-question Practice path. */
export const generateGatedPracticeBatch = generateGatedQuestionBatch;
