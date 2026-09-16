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
import { loadPriorPracticeQuestionFingerprints } from '@/services/quiz-persistence.service';
import { filterExactDuplicates } from '@/lib/lx/exact-duplicate-novelty';
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
}

export interface CanonicalProveNoveltyPassResult {
  noveltyPass: 'INITIAL' | 'RECOVERY';
  candidateCount: number;
  acceptedCount: number;
  rejectedExactDuplicateCount: number;
  remainingNeeded: number;
}

export interface CanonicalProveInvocationResult extends GatedBatchInvocationDiagnostics {
  invocationType: 'CHUNK' | 'AGGREGATE_RECOVERY';
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
  rejectedExactDuplicateCount: number;
  finalQuestionCount: number;
}

/**
 * Never throws for a "couldn't reach targetCount" outcome -- returns a
 * result whose `finalQuestionCount < targetCount` (down to 0). Only a
 * genuinely unexpected error (a bug, not a generation shortfall) propagates.
 */
export async function generateCanonicalProveQuestions(params: CanonicalProveGenerationParams): Promise<CanonicalProveGenerationResult> {
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
  const priorFingerprints = await loadPriorPracticeQuestionFingerprints(params.studentId, params.conceptId);
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
    priorPracticeFingerprintCount: priorFingerprints.size,
    rejectedExactDuplicateCount,
    finalQuestionCount: questions.length,
  };
}
