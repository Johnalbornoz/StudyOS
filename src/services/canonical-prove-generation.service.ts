/**
 * CANON-R6-PERF-R2 -- THE ONE CERTIFIED CANONICAL PROVE GENERATION
 * PIPELINE.
 *
 * Extracted from `generate-and-take/route.ts`'s own canonical_prove
 * branch (CANON-R6-PERF-R1) so BOTH the live/cold-cache request path
 * AND the new background pre-generation path (CANON-R6-PERF-R2) call
 * the EXACT SAME code -- never a second, cheaper "pre-generation only"
 * implementation. Part 6's own requirement: concurrent chunks -> Quality
 * Gate -> semantic verification -> exact-duplicate novelty -> at most
 * one bounded aggregate recovery -> exactly `targetCount` or a short
 * result (the caller decides what "short" means for its own contract:
 * `generate-and-take` fails the learner's request closed;
 * `canonical-prepared-activity.service.ts` marks a prepared row FAILED).
 *
 * Pure orchestration -- no HTTP, no request/response shape, no DB
 * writes of its own (the caller persists whatever it needs to).
 */
import {
  generateConcurrentChunkedBatch,
  generateBoundedRecoveryBatch,
  type GatedBatchInvocationDiagnostics,
} from '@/services/gated-question-generation.service';
import { loadProveExactNoveltyExclusions } from '@/services/prove-exact-novelty.service';
import { filterExactDuplicates, fingerprintQuestion } from '@/lib/lx/exact-duplicate-novelty';
import { servedLevelCounts } from '@/lib/pedagogical-engine/difficulty-policy';
import { avoidanceBrief, diversityReport, leastSimilarFirst, selectDiverse, type DiversityReport } from '@/lib/lx/question-diversity';
import { MAX_QUESTIONS_PER_CHUNK, ALL_QUESTION_TYPES, type GeneratedQuestion, type IBContext } from '@/services/quiz-generation.service';

export interface CanonicalProveGenerationParams {
  conceptId: string;
  studentId: string;
  subjectId: string;
  targetCount: number;
  difficulty: number;
  guidance: string;
  language: string;
  visualAidRate: number;
  ibContext: IBContext | null;
  activityType: string;
  quizMode: string;
  parentOperationId: string;
  /**
   * D79 -- the PROVE level mix (10 x L3, or 7 x L3 + 3 x L4). When present, every accepted item
   * must carry the generator's OWN reported difficulty equal to its slot's level (never
   * relabelled); off-level items are discarded and their slots regenerated through the same
   * bounded rounds. Short of any level count = a short result (`levelMixSupplyShortage`).
   */
  levelMix?: Array<{ level: number; count: number }>;
}

export interface CanonicalProveNoveltyPassResult {
  noveltyPass: 'INITIAL' | 'RECOVERY';
  candidateCount: number;
  acceptedCount: number;
  rejectedExactDuplicateCount: number;
  remainingNeeded: number;
}

export interface CanonicalProveInvocationResult extends GatedBatchInvocationDiagnostics {
  invocationType: 'CHUNK' | 'AGGREGATE_RECOVERY' | 'DIVERSITY_REGENERATION';
  chunkIndex: number | null;
}

export interface CanonicalProveGenerationResult {
  questions: GeneratedQuestion[];
  chunkPlan: number[];
  priorHistoryMs: number;
  noveltyFilterMs: number;
  generationConcurrentMs: number;
  aggregateRecoveryUsed: boolean;
  aggregateRecoveryRequestedCount: number | null;
  aggregateRecoveryMs: number | null;
  initialAcceptedCount: number;
  invocations: CanonicalProveInvocationResult[];
  noveltyPasses: CanonicalProveNoveltyPassResult[];
  priorPracticeFingerprintCount: number;
  /** D75: exact items of prior PROVE attempts for this (student, concept), also excluded. */
  priorProveFingerprintCount: number;
  rejectedExactDuplicateCount: number;
  /**
   * D75: true when the result is short AND exact-novelty rejections are why
   * (after every bounded regeneration round) -- the caller reports
   * PROVE_EXACT_NOVELTY_SUPPLY_SHORTAGE instead of ever reusing a prior item.
   */
  exactNoveltySupplyShortage: boolean;
  finalQuestionCount: number;
  /** PROVE_INTRA_SESSION_NOVELTY: candidates rejected as near duplicates / over-used templates. */
  diversityRejectedCount: number;
  /** Targeted regeneration rounds (only the rejected slots, never the whole set). */
  diversityRegenerations: number;
  /** True only when the deterministic fallback had to fill with the least-similar rejected candidates. */
  diversityDegraded: boolean;
  diversity: DiversityReport;
  /** D79 -- candidates discarded because the generator reported a level other than their slot's. */
  levelRejectedCount: number;
  /** D79 -- true when a level mix was requested and some level count could not be met. */
  levelMixSupplyShortage: boolean;
  /** D79 -- the level counts of `questions` (sorted by level). */
  levelCounts: Array<{ level: number; count: number }>;
}

/** D79 -- a PROVE level mix whose level counts the bounded rounds could not meet (fail closed, never relabelled). */
export const PROVE_LEVEL_MIX_SUPPLY_SHORTAGE = 'PROVE_LEVEL_MIX_SUPPLY_SHORTAGE' as const;

/** At most this many targeted regeneration rounds for rejected slots. */
export const MAX_DIVERSITY_REGENERATIONS = 2;

/**
 * Never throws for a "couldn't reach targetCount" outcome -- returns a
 * result whose `finalQuestionCount < targetCount` (down to 0). Only a
 * genuinely unexpected error (a bug, not a generation shortfall) propagates.
 */
export async function generateCanonicalProveQuestions(params: CanonicalProveGenerationParams): Promise<CanonicalProveGenerationResult> {
  const mix = params.levelMix?.filter((g) => g.count > 0) ?? [];
  if (mix.length === 0) return generateProveGroup(params, {});
  if (mix.length === 1) {
    const r = await generateProveGroup({ ...params, targetCount: mix[0].count, difficulty: mix[0].level }, { requireLevel: mix[0].level });
    return { ...r, levelMixSupplyShortage: r.finalQuestionCount < mix[0].count };
  }
  return generateProveLevelMix(params, mix);
}

/**
 * D79 -- a multi-level PROVE: each level group runs the certified pipeline at its own requested
 * level in parallel; the higher-level group is then checked for exact duplicates and semantic
 * diversity against the base group, and its lost slots get ONE more targeted group run (told what
 * not to repeat). Exactly the mix's counts, or a short result -- never another level as filler.
 */
async function generateProveLevelMix(params: CanonicalProveGenerationParams, mix: Array<{ level: number; count: number }>): Promise<CanonicalProveGenerationResult> {
  const groups = [...mix].sort((a, b) => a.level - b.level);
  const results = await Promise.all(
    groups.map((g) => generateProveGroup({ ...params, targetCount: g.count, difficulty: g.level }, { requireLevel: g.level })),
  );
  let kept: GeneratedQuestion[] = [...results[0].questions];
  const extra: CanonicalProveGenerationResult[] = [];
  for (let i = 1; i < groups.length; i++) {
    const g = groups[i];
    const exact = filterExactDuplicates(results[i].questions, new Set(kept.map((q) => fingerprintQuestion(q))));
    let groupKept = selectDiverse(exact.accepted, kept.length + g.count, params.language, kept).kept.slice(0, g.count);
    if (groupKept.length < g.count) {
      const retry = await generateProveGroup(
        { ...params, targetCount: g.count - groupKept.length, difficulty: g.level },
        { requireLevel: g.level, keptBefore: [...kept, ...groupKept] },
      );
      extra.push(retry);
      const retryExact = filterExactDuplicates(retry.questions, new Set([...kept, ...groupKept].map((q) => fingerprintQuestion(q))));
      groupKept = groupKept.concat(selectDiverse(retryExact.accepted, kept.length + g.count, params.language, [...kept, ...groupKept]).kept.slice(0, g.count - groupKept.length));
    }
    kept = kept.concat(groupKept);
  }
  const all = [...results, ...extra];
  const sum = (f: (r: CanonicalProveGenerationResult) => number) => all.reduce((a, r) => a + f(r), 0);
  const targetCount = groups.reduce((a, g) => a + g.count, 0);
  const levelCounts = servedLevelCounts(kept.map((q) => q.difficulty));
  const levelMixSupplyShortage = groups.some((g) => (levelCounts.find((c) => c.level === g.level)?.count ?? 0) < g.count);
  const questions = kept.slice(0, targetCount);
  const first = results[0];
  return {
    questions,
    chunkPlan: all.flatMap((r) => r.chunkPlan),
    priorHistoryMs: Math.max(...all.map((r) => r.priorHistoryMs)),
    noveltyFilterMs: sum((r) => r.noveltyFilterMs),
    generationConcurrentMs: Math.max(...results.map((r) => r.generationConcurrentMs)),
    aggregateRecoveryUsed: all.some((r) => r.aggregateRecoveryUsed),
    aggregateRecoveryRequestedCount: all.some((r) => r.aggregateRecoveryRequestedCount != null) ? sum((r) => r.aggregateRecoveryRequestedCount ?? 0) : null,
    aggregateRecoveryMs: all.some((r) => r.aggregateRecoveryMs != null) ? sum((r) => r.aggregateRecoveryMs ?? 0) : null,
    initialAcceptedCount: sum((r) => r.initialAcceptedCount),
    invocations: all.flatMap((r) => r.invocations),
    noveltyPasses: all.flatMap((r) => r.noveltyPasses),
    priorPracticeFingerprintCount: first.priorPracticeFingerprintCount,
    priorProveFingerprintCount: first.priorProveFingerprintCount,
    rejectedExactDuplicateCount: sum((r) => r.rejectedExactDuplicateCount),
    exactNoveltySupplyShortage: questions.length < targetCount && all.some((r) => r.exactNoveltySupplyShortage),
    diversityRejectedCount: sum((r) => r.diversityRejectedCount),
    diversityRegenerations: sum((r) => r.diversityRegenerations),
    diversityDegraded: all.some((r) => r.diversityDegraded),
    diversity: diversityReport(questions, params.language),
    levelRejectedCount: sum((r) => r.levelRejectedCount),
    levelMixSupplyShortage,
    levelCounts,
    finalQuestionCount: questions.length,
  };
}

/** The certified single-level pipeline (unchanged behaviour when `requireLevel` / `keptBefore` are absent). */
async function generateProveGroup(
  params: CanonicalProveGenerationParams,
  opts: { requireLevel?: number; keptBefore?: GeneratedQuestion[] },
): Promise<CanonicalProveGenerationResult> {
  const keptBefore = opts.keptBefore ?? [];
  let levelRejectedCount = 0;
  // D79: the generator's own reported level must equal the slot's level (never relabelled)
  const atLevel = (qs: GeneratedQuestion[]): GeneratedQuestion[] => {
    if (opts.requireLevel === undefined) return qs;
    const ok = qs.filter((q) => Math.round(q.difficulty) === opts.requireLevel);
    levelRejectedCount += qs.length - ok.length;
    return ok;
  };
  const invocations: CanonicalProveInvocationResult[] = [];
  const noveltyPasses: CanonicalProveNoveltyPassResult[] = [];

  const chunkStartedAt = Date.now();
  const chunked = await generateConcurrentChunkedBatch(params.conceptId, params.studentId, params.subjectId, {
    count: params.targetCount,
    difficulty: params.difficulty,
    types: ALL_QUESTION_TYPES,
    guidance: params.guidance,
    language: params.language,
    visualAidRate: params.visualAidRate,
    ibContext: params.ibContext,
    activityType: params.activityType,
    quizMode: params.quizMode,
    parentOperationId: params.parentOperationId,
  });
  const generationConcurrentMs = Date.now() - chunkStartedAt;
  invocations.push(...chunked.chunkDiagnostics.map((diag, chunkIndex) => ({ invocationType: 'CHUNK' as const, chunkIndex, ...diag })));

  const priorHistoryStartedAt = Date.now();
  // D75: exact prior PRACTICE items AND exact prior PROVE items are both excluded.
  const exclusions = await loadProveExactNoveltyExclusions(params.studentId, params.conceptId);
  const priorFingerprints = exclusions.fingerprints;
  const priorHistoryMs = Date.now() - priorHistoryStartedAt;

  let noveltyFilterMs = 0;
  const initialFilterStartedAt = Date.now();
  const initialFiltered = filterExactDuplicates(atLevel(chunked.accepted), new Set([...priorFingerprints, ...keptBefore.map((q) => fingerprintQuestion(q))]));
  noveltyFilterMs += Date.now() - initialFilterStartedAt;
  let accepted = initialFiltered.accepted;
  let excludeFingerprints = initialFiltered.fingerprints;
  let rejectedExactDuplicateCount = initialFiltered.rejectedCount;
  noveltyPasses.push({
    noveltyPass: 'INITIAL',
    candidateCount: chunked.accepted.length,
    acceptedCount: initialFiltered.accepted.length,
    rejectedExactDuplicateCount: initialFiltered.rejectedCount,
    remainingNeeded: Math.max(0, params.targetCount - accepted.length),
  });

  let aggregateRecoveryUsed = false;
  let aggregateRecoveryRequestedCount: number | null = null;
  let aggregateRecoveryMs: number | null = null;

  if (accepted.length < params.targetCount) {
    // Reuses generatePracticeQuestions's own proven surplus formula
    // (deficit + 1, capped at 2x the per-chunk max) -- see CANON-R6-PERF-R1's
    // own report for why this is preferred over a bare, unpadded deficit.
    const deficit = params.targetCount - accepted.length;
    const recoveryRequestedCount = Math.min(MAX_QUESTIONS_PER_CHUNK * 2, deficit + 1);
    aggregateRecoveryUsed = true;
    aggregateRecoveryRequestedCount = recoveryRequestedCount;
    const recoveryStartedAt = Date.now();
    const recovery = await generateBoundedRecoveryBatch(params.conceptId, params.studentId, params.subjectId, {
      count: recoveryRequestedCount,
      difficulty: params.difficulty,
      types: ALL_QUESTION_TYPES,
      guidance: params.guidance,
      language: params.language,
      visualAidRate: params.visualAidRate,
      ibContext: params.ibContext,
      activityType: params.activityType,
      quizMode: params.quizMode,
      parentOperationId: params.parentOperationId,
    });
    aggregateRecoveryMs = Date.now() - recoveryStartedAt;
    invocations.push({ invocationType: 'AGGREGATE_RECOVERY', chunkIndex: null, ...recovery.diagnostics });

    const recoveryFilterStartedAt = Date.now();
    const recoveryFiltered = filterExactDuplicates(atLevel(recovery.accepted), excludeFingerprints);
    noveltyFilterMs += Date.now() - recoveryFilterStartedAt;
    excludeFingerprints = recoveryFiltered.fingerprints;
    rejectedExactDuplicateCount += recoveryFiltered.rejectedCount;
    accepted = accepted.concat(recoveryFiltered.accepted);
    noveltyPasses.push({
      noveltyPass: 'RECOVERY',
      candidateCount: recovery.accepted.length,
      acceptedCount: recoveryFiltered.accepted.length,
      rejectedExactDuplicateCount: recoveryFiltered.rejectedCount,
      remainingNeeded: Math.max(0, params.targetCount - accepted.length),
    });
  }

  // PROVE_INTRA_SESSION_NOVELTY -- semantic diversity before the set is
  // accepted (question-diversity.ts). Exact-text novelty above cannot see
  // that two differently-worded items are the same problem (real Prove:
  // #1 and #9, "5 cuadernos / 40 € -> 8 cuadernos / 64 €"). Near duplicates
  // and over-used templates are dropped; ONLY those slots are regenerated
  // (same certified bounded recovery + Quality Gate), told what not to
  // repeat; after MAX_DIVERSITY_REGENERATIONS rounds a deterministic
  // fallback fills from the least-similar rejected candidates so the
  // contract stays exactly targetCount -- never fewer questions.
  const firstPass = selectDiverse(accepted, keptBefore.length + params.targetCount, params.language, keptBefore);
  let kept = firstPass.kept;
  const rejectedPool = firstPass.rejected.map((r) => r.item);
  let diversityRejectedCount = firstPass.rejected.length;
  let diversityRegenerations = 0;
  // D75: a slot lost to an exact prior-item rejection is regenerated through
  // the SAME bounded rounds (never filled by reusing the prior item).
  for (let round = 0; round < MAX_DIVERSITY_REGENERATIONS && kept.length < params.targetCount && (diversityRejectedCount > 0 || rejectedExactDuplicateCount > 0 || levelRejectedCount > 0); round++) {
    const missing = params.targetCount - kept.length;
    diversityRegenerations++;
    const regen = await generateBoundedRecoveryBatch(params.conceptId, params.studentId, params.subjectId, {
      count: missing,
      difficulty: params.difficulty,
      types: ALL_QUESTION_TYPES,
      guidance: `${params.guidance}\n\nDIVERSITY: this assessment already contains the questions below. Each NEW question must use a different situation and quantities, different numbers, and a different reasoning demand -- never a variation of one of these:\n${avoidanceBrief([...keptBefore, ...kept], params.language)}`,
      language: params.language,
      visualAidRate: params.visualAidRate,
      ibContext: params.ibContext,
      activityType: params.activityType,
      quizMode: params.quizMode,
      parentOperationId: params.parentOperationId,
    });
    invocations.push({ invocationType: 'DIVERSITY_REGENERATION', chunkIndex: null, ...regen.diagnostics });
    const regenFiltered = filterExactDuplicates(atLevel(regen.accepted), excludeFingerprints);
    excludeFingerprints = regenFiltered.fingerprints;
    rejectedExactDuplicateCount += regenFiltered.rejectedCount;
    const more = selectDiverse(regenFiltered.accepted, keptBefore.length + params.targetCount, params.language, [...keptBefore, ...kept]);
    kept = kept.concat(more.kept);
    rejectedPool.push(...more.rejected.map((r) => r.item));
    diversityRejectedCount += more.rejected.length;
  }
  let diversityDegraded = false;
  if (kept.length < params.targetCount && rejectedPool.length > 0) {
    kept = kept.concat(leastSimilarFirst(rejectedPool, [...keptBefore, ...kept], params.language).slice(0, params.targetCount - kept.length));
    diversityDegraded = true;
  }
  const questions = kept.slice(0, params.targetCount);
  const diversity = diversityReport(questions, params.language);
  try {
    console.log('[prove-diversity]', JSON.stringify({ parentOperationId: params.parentOperationId, conceptId: params.conceptId, diversityRejectedCount, diversityRegenerations, diversityDegraded, ...diversity }));
  } catch { /* observability never breaks generation */ }
  return {
    questions,
    chunkPlan: chunked.chunkPlan,
    priorHistoryMs,
    noveltyFilterMs,
    generationConcurrentMs,
    aggregateRecoveryUsed,
    aggregateRecoveryRequestedCount,
    aggregateRecoveryMs,
    initialAcceptedCount: initialFiltered.accepted.length,
    invocations,
    noveltyPasses,
    priorPracticeFingerprintCount: priorFingerprints.size,
    priorProveFingerprintCount: exclusions.priorProveCount,
    rejectedExactDuplicateCount,
    exactNoveltySupplyShortage: questions.length < params.targetCount && rejectedExactDuplicateCount > 0,
    diversityRejectedCount,
    diversityRegenerations,
    diversityDegraded,
    diversity,
    levelRejectedCount,
    levelMixSupplyShortage: false,
    levelCounts: servedLevelCounts(questions.map((q) => q.difficulty)),
    finalQuestionCount: questions.length,
  };
}
