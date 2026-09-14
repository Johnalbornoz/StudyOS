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
import type { AIErrorCode } from '@/lib/ai/types';
import { checkQuestionQualityDeterministic } from '@/lib/lx/question-quality-contract';
import {
  verifyQuestionQuality,
  verifyQuestionQualityBatch,
  evaluateQuestionQualityVerdict,
  classifyQualityRejectionReasons,
  type QuestionQualityVerdict,
  type QualityRejectionReasonCode,
} from '@/services/question-quality-verifier.service';
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
  /** LX-9R6-R1 O1/O3: safe, aggregate-only observability context -- never required, never affects generation. */
  activityType?: string;
  quizMode?: string;
  /** LX-9R6-R1 O3: when this call is one unit of a multi-concept parent request (cumulative_assessment/exam_simulation), the caller's own operationId -- correlates every per-concept `[gated_batch]` line with the parent request without inventing a second identity for the same operation. */
  parentOperationId?: string;
}

/** LX-9R6-R1 O1: safe, aggregate-only observability for one gated-batch generation call -- same shape/intent as logRetention/logQuickCheck, never learner answer/question content. */
function logGatedBatch(label: string, meta: Record<string, unknown> = {}): void {
  try {
    // eslint-disable-next-line no-console
    console.log('[gated_batch]', JSON.stringify({ label, ...meta }));
  } catch { /* logging must never break generation */ }
}

export interface QualityGateReq {
  conceptId: string;
  language?: string;
  context?: { studentId?: string; subjectId?: string };
  /** LX-9R8 PART B/B3: safe, aggregate-only observability context for a rejected candidate's log line -- never required, never affects the gate's decision. */
  operationId?: string;
  activityType?: string;
}

/** LX-9R8 PART B/B3: one safe, structured line per SEMANTICALLY rejected candidate -- operationId/candidateId/activityType/difficulty/verdict/reasonCode only, NEVER question text, correct answer, or student data. */
function logSemanticRejection(meta: {
  operationId?: string;
  candidateId: string;
  activityType?: string;
  difficulty: number;
  verdict: 'SEMANTIC_FAIL' | 'VERIFY_ERROR';
  reasonCodes: QualityRejectionReasonCode[];
}): void {
  try {
    // eslint-disable-next-line no-console
    console.log('[quality_gate_rejection]', JSON.stringify({
      operationId: meta.operationId ?? null,
      candidateId: meta.candidateId,
      activityType: meta.activityType ?? null,
      difficulty: meta.difficulty,
      verdict: meta.verdict,
      reasonCode: meta.reasonCodes,
    }));
  } catch { /* logging must never break generation */ }
}

/** LX-9R8 PART B3: aggregate rejection-reason histogram for one gate call -- e.g. { AMBIGUOUS: 1, WEAK_DISTRACTORS: 0, ... }. Every code in the taxonomy is always present (0 when unseen), so a caller can diff two runs without missing-key ambiguity. */
function emptyRejectionHistogram(): Record<QualityRejectionReasonCode, number> {
  return {
    OUT_OF_SCOPE: 0, ANSWER_INCORRECT: 0, AMBIGUOUS: 0, REASONING_MISMATCH: 0,
    WEAK_DISTRACTORS: 0, SCENARIO_INAPPROPRIATE: 0, VISUAL_INCONSISTENT: 0,
    LOW_CONFIDENCE: 0, VERIFY_ERROR: 0,
  };
}

/**
 * LX-9R8 PART B3: one safe, structured aggregate-count line per
 * `applyQuestionQualityGate` call, emitted from the ONE shared gate
 * authority so EVERY caller (quick_check/practice/retention/gated_batch/
 * variant) reports it identically, without each caller re-deriving its
 * own aggregate. Never question/answer/student content -- counts and the
 * already-computed rejection histogram only.
 */
function logQualityGateSummary(meta: {
  operationId?: string;
  activityType?: string;
  generatedCandidates: number;
  semanticChecked: number;
  semanticAccepted: number;
  semanticRejected: number;
  deterministicRejected: number;
  rejectionHistogram: Record<QualityRejectionReasonCode, number>;
}): void {
  try {
    // eslint-disable-next-line no-console
    console.log('[quality_gate_summary]', JSON.stringify({
      operationId: meta.operationId ?? null,
      activityType: meta.activityType ?? null,
      generatedCandidates: meta.generatedCandidates,
      semanticChecked: meta.semanticChecked,
      semanticAccepted: meta.semanticAccepted,
      semanticRejected: meta.semanticRejected,
      deterministicRejected: meta.deterministicRejected,
      rejectionHistogram: meta.rejectionHistogram,
    }));
  } catch { /* logging must never break generation */ }
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
  /** LX-9R8 PART B3: aggregate rejection-reason histogram across every SEMANTICALLY rejected candidate in this gate call. Every taxonomy code always present (0 when unseen). Deterministic rejections are NOT included here -- they have their own, separate, already-audited contract (question-quality-contract.ts). */
  semanticRejectionHistogram: Record<QualityRejectionReasonCode, number>;
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

  // LX-9R3 D3: independent semantic verdicts. More than one candidate
  // needing verification goes through ONE batched Terra call
  // (verifyQuestionQualityBatch) instead of N separate ones -- exactly
  // one candidate still uses the original single-candidate call (no
  // batching benefit, avoids the batch prompt/schema overhead for the
  // trivial case). Both paths are fail-closed identically: a missing,
  // malformed, or foreign-id verdict can only ever reject the ONE
  // candidate it belongs to, never approve or affect any other.
  const semanticCalls: BillableCallUsage[] = [];
  let semanticRejected = 0;
  const semanticSurvivors: GeneratedQuestion[] = [];
  const semanticRejectionHistogram = emptyRejectionHistogram();

  // LX-9R8 PART B/B3: one safe, structured log line per rejected
  // candidate -- reasonCode(s) from the SAME taxonomy the histogram
  // tallies, never question text/answer/student data.
  const recordRejection = (candidateId: string, q: GeneratedQuestion, verdict: QuestionQualityVerdict | null) => {
    const reasonCodes: QualityRejectionReasonCode[] = verdict
      ? classifyQualityRejectionReasons(verdict).length > 0
        ? classifyQualityRejectionReasons(verdict)
        : ['LOW_CONFIDENCE'] // every dimension passed but confidence was still below QUALITY_VERIFY_MIN_CONFIDENCE
      : ['VERIFY_ERROR']; // missing/malformed verdict -- fails closed
    for (const code of reasonCodes) semanticRejectionHistogram[code]++;
    logSemanticRejection({
      operationId: req.operationId,
      candidateId,
      activityType: req.activityType,
      difficulty: q.difficulty,
      verdict: verdict ? 'SEMANTIC_FAIL' : 'VERIFY_ERROR',
      reasonCodes,
    });
  };

  if (needsSemantic.length > 1) {
    const candidates = needsSemantic.map((q, i) => ({ id: String(i), question: q }));
    const verdictsById = await verifyQuestionQualityBatch({
      candidates,
      requestedLanguage: req.language || 'en',
      context: req.context,
      onUsage: (usage, model) => {
        semanticCalls.push({ model, usage });
      },
    }).catch(() => new Map<string, QuestionQualityVerdict | null>());
    for (const { id, question } of candidates) {
      const verdict = verdictsById.get(id) ?? null;
      if (evaluateQuestionQualityVerdict(verdict).pass) {
        semanticSurvivors.push(question);
      } else {
        semanticRejected++;
        recordRejection(id, question, verdict);
      }
    }
  } else if (needsSemantic.length === 1) {
    const q = needsSemantic[0];
    const verdict = await verifyQuestionQuality({
      question: q,
      requestedLanguage: req.language || 'en',
      context: req.context,
      onUsage: (usage, model) => {
        semanticCalls.push({ model, usage });
      },
    }).catch(() => null);
    if (evaluateQuestionQualityVerdict(verdict).pass) {
      semanticSurvivors.push(q);
    } else {
      semanticRejected++;
      recordRejection('0', q, verdict);
    }
  }

  // Preserve the caller's original ordering.
  const kept = new Set<GeneratedQuestion>([...passed, ...semanticSurvivors]);
  const accepted = questions.filter((q) => kept.has(q));

  // LX-9R8 PART B3: one aggregate summary line per gate call, from the
  // single shared authority so every caller reports it identically.
  logQualityGateSummary({
    operationId: req.operationId,
    activityType: req.activityType,
    generatedCandidates: questions.length,
    semanticChecked: needsSemantic.length,
    semanticAccepted: semanticSurvivors.length,
    semanticRejected,
    deterministicRejected,
    rejectionHistogram: semanticRejectionHistogram,
  });

  return { accepted, deterministicRejected, semanticRejected, semanticCalls, semanticRejectionHistogram };
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
  /** LX-9R6-R1 C2: true iff `accepted.length < req.targetCount` even after any Terra fallback -- the ONE signal every caller now checks to fail closed rather than publish a shorter-than-required unit. */
  insufficientCount: boolean;
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
      insufficientCount: g1.accepted.length < req.targetCount,
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
    insufficientCount: merged.length < req.targetCount,
  };
}

/**
 * The general gated single-batch path: Luna `generateQuestionsForConcept`
 * -> gate -> if SHORT of `count` (LX-9R6-R1 C2/C4: not just fully
 * empty), ONE Terra regeneration of the whole unit -> gate -> merge ->
 * publish exactly `count` or fail closed with `QUESTION_COUNT_INSUFFICIENT`.
 *
 * `count` stays whatever the caller resolved (canonical Evidence
 * Sufficiency for Practice; per-concept cap for cumulative / exam /
 * diagnostic) -- this never restores 20-question Practice and never
 * changes a count; it only makes THIS count reliable: StudyUS decides
 * the exact number of questions in a valid activity, never the
 * provider. `[]` (never a shorter-than-`count` array) is the ONE
 * recoverable "couldn't prepare" signal every caller (route.ts's
 * `questions.length === 0` gate) already understands.
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
  // LX-9R6-R1 O1/O3: the SAME operationId also correlates this call's
  // `[gated_batch]` telemetry lines, and (when this is one unit of a
  // multi-concept cumulative/exam request) `opts.parentOperationId`
  // correlates every per-concept call back to the ONE parent request.
  const operationId = randomUUID();
  const startedAt = Date.now();
  const log = (label: string, meta: Record<string, unknown> = {}) =>
    logGatedBatch(label, { operationId, parentOperationId: opts.parentOperationId ?? null, activityType: opts.activityType ?? null, quizMode: opts.quizMode ?? null, conceptCount: 1, targetDifficulty: opts.difficulty ?? null, requiredQuestionCount: target, ...meta });
  const lunaGenerationCalls: BillableCallUsage[] = [];
  const terraGenerationCalls: BillableCallUsage[] = [];

  try {
    log('GATED_BATCH_GENERATION_STARTED');

    // LX-9R7 PART D: captured, not thrown -- generateQuestionsForConcept
    // still returns its existing [] contract on ANY failure; this ONLY
    // tells us whether that [] came from a non-retryable provider error
    // (a malformed request/auth failure that would be rejected again,
    // identically, on Terra) so the Terra regeneration below can be
    // skipped entirely rather than repeating the same rejected request.
    let nonRetryableCode: AIErrorCode | null = null;
    const luna = await generateQuestionsForConcept(conceptId, studentId, subjectId, {
      ...baseGenOpts,
      onUsage: (usage) => {
        lunaGenerationCalls.push({ model: QGEN_ROUTE.primary, usage });
      },
      onNonRetryableError: (code) => {
        nonRetryableCode = code;
      },
    }).catch(() => [] as GeneratedQuestion[]);
    log('GATED_BATCH_INITIAL_GENERATION_COMPLETE', { candidateCount: luna.length });

    if (nonRetryableCode) {
      log('GATED_BATCH_GENERATION_INSUFFICIENT', {
        errorCode: nonRetryableCode,
        reason: 'NON_RETRYABLE_PROVIDER_ERROR',
        publishedCount: 0,
        generationCalls: 1,
        recoveryCalls: 0,
        durationMs: Date.now() - startedAt,
        success: false,
      });
      return [];
    }

    const result = await gateUnitWithTerraFallback(
      luna,
      // LX-9R8 PART B/B3: threading operationId/activityType through so
      // a rejected candidate's log line is correlatable back to this
      // generation operation.
      { conceptId, language: opts.language, context: ctx, targetCount: target, fallbackWhen: 'SHORT', operationId, activityType: opts.activityType },
      () => {
        log('GATED_BATCH_RECOVERY_STARTED', { candidateCount: luna.length });
        return generateQuestionsForConcept(conceptId, studentId, subjectId, {
          ...baseGenOpts,
          modelOverride: TERRA,
          onUsage: (usage) => {
            terraGenerationCalls.push({ model: TERRA, usage });
          },
        }).catch(() => [] as GeneratedQuestion[]);
      },
      { lunaGenerationCalls, terraGenerationCalls, operationId },
    );
    if (result.fallbackUsed) {
      log('GATED_BATCH_RECOVERY_COMPLETE', { acceptedCount: result.accepted.length, lunaAccepted: result.lunaAccepted, terraAccepted: result.terraAccepted });
    }

    const totalGenerationCalls = 1 + (result.fallbackUsed ? 1 : 0);
    if (result.insufficientCount) {
      log('GATED_BATCH_GENERATION_INSUFFICIENT', {
        errorCode: 'QUESTION_COUNT_INSUFFICIENT',
        publishedCount: result.accepted.length,
        acceptedCount: result.accepted.length,
        generationCalls: totalGenerationCalls,
        recoveryCalls: result.fallbackUsed ? 1 : 0,
        durationMs: Date.now() - startedAt,
        success: false,
      });
      return [];
    }
    log('GATED_BATCH_GENERATION_SUCCEEDED', {
      publishedCount: result.accepted.length,
      acceptedCount: result.accepted.length,
      generationCalls: totalGenerationCalls,
      recoveryCalls: result.fallbackUsed ? 1 : 0,
      durationMs: Date.now() - startedAt,
      success: true,
    });
    return result.accepted;
  } catch (error) {
    log('GATED_BATCH_GENERATION_INSUFFICIENT', { errorCode: 'UNEXPECTED_GENERATION_ERROR', durationMs: Date.now() - startedAt, success: false });
    console.error('Error in generateGatedQuestionBatch:', error);
    return [];
  }
}

/** Back-compat alias -- the canonical ~3-question Practice path. */
export const generateGatedPracticeBatch = generateGatedQuestionBatch;
