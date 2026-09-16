/**
 * CANON-V2-ARCH-CLEANUP -- THE ONE CERTIFIED CANONICAL RETAIN (RETENTION_CHECK)
 * GENERATION PIPELINE.
 *
 * Mirrors `canonical-prove-generation.service.ts` exactly (Part 8/9 of
 * this phase's own spec: "reuse the generic Prove-era chunking
 * infrastructure sized for count=10" rather than reparameterizing the
 * fragile, tuned legacy `generateRetentionCheckQuestions` -- Section 23
 * of the audit already established RETENTION_REQUIRED_COUNT stays fixed
 * at 6 for legacy `retention_check`, untouched by this phase). Concurrent
 * chunks -> exact-duplicate novelty filter -> at most one bounded
 * aggregate recovery -> exactly `targetCount` or a short result (the
 * caller decides what "short" means for its own contract -- exactly the
 * Prove precedent).
 *
 * The ONE difference from Prove: RETAIN's own frozen contract requires
 * items NOVEL against every prior canonical activity (Practice AND
 * Prove AND any earlier Retain), not just Practice -- see
 * `loadPriorCanonicalQuestionFingerprintsForRetain`'s own doc comment.
 *
 * Pure orchestration -- no HTTP, no request/response shape, no DB
 * writes of its own (the caller persists whatever it needs to).
 */
import {
  generateConcurrentChunkedBatch,
  generateBoundedRecoveryBatch,
  type GatedBatchInvocationDiagnostics,
} from '@/services/gated-question-generation.service';
import { loadPriorCanonicalQuestionFingerprintsForRetain } from '@/services/quiz-persistence.service';
import { filterExactDuplicates } from '@/lib/lx/exact-duplicate-novelty';
import { MAX_QUESTIONS_PER_CHUNK, ALL_QUESTION_TYPES, type GeneratedQuestion, type IBContext } from '@/services/quiz-generation.service';

export interface CanonicalRetainGenerationParams {
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
}

export interface CanonicalRetainNoveltyPassResult {
  noveltyPass: 'INITIAL' | 'RECOVERY';
  candidateCount: number;
  acceptedCount: number;
  rejectedExactDuplicateCount: number;
  remainingNeeded: number;
}

export interface CanonicalRetainInvocationResult extends GatedBatchInvocationDiagnostics {
  invocationType: 'CHUNK' | 'AGGREGATE_RECOVERY';
  chunkIndex: number | null;
}

export interface CanonicalRetainGenerationResult {
  questions: GeneratedQuestion[];
  chunkPlan: number[];
  priorHistoryMs: number;
  noveltyFilterMs: number;
  generationConcurrentMs: number;
  aggregateRecoveryUsed: boolean;
  aggregateRecoveryRequestedCount: number | null;
  aggregateRecoveryMs: number | null;
  initialAcceptedCount: number;
  invocations: CanonicalRetainInvocationResult[];
  noveltyPasses: CanonicalRetainNoveltyPassResult[];
  priorCanonicalFingerprintCount: number;
  rejectedExactDuplicateCount: number;
  finalQuestionCount: number;
}

/**
 * Never throws for a "couldn't reach targetCount" outcome -- returns a
 * result whose `finalQuestionCount < targetCount` (down to 0). Only a
 * genuinely unexpected error (a bug, not a generation shortfall) propagates.
 */
export async function generateCanonicalRetainQuestions(params: CanonicalRetainGenerationParams): Promise<CanonicalRetainGenerationResult> {
  const invocations: CanonicalRetainInvocationResult[] = [];
  const noveltyPasses: CanonicalRetainNoveltyPassResult[] = [];

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
  const priorFingerprints = await loadPriorCanonicalQuestionFingerprintsForRetain(params.studentId, params.conceptId);
  const priorHistoryMs = Date.now() - priorHistoryStartedAt;

  let noveltyFilterMs = 0;
  const initialFilterStartedAt = Date.now();
  const initialFiltered = filterExactDuplicates(chunked.accepted, priorFingerprints);
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
    const recoveryFiltered = filterExactDuplicates(recovery.accepted, excludeFingerprints);
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

  const questions = accepted.slice(0, params.targetCount);
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
    priorCanonicalFingerprintCount: priorFingerprints.size,
    rejectedExactDuplicateCount,
    finalQuestionCount: questions.length,
  };
}
