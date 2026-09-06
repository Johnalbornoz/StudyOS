import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyStudentAccess } from '@/lib/auth';
import { evaluateTransferResponse, type TransferDistance } from '@/services/transfer.service';
import { updateMastery } from '@/services/mastery.service';
import { completeRemediationStep } from '@/services/remediation.service';
import { track } from '@/lib/analytics';
import { normalizeResponseTiming, toResponseTimingEntries } from '@/lib/algorithms/response-timing';
import {
  computeTransferPromptFingerprint,
  computeTransferPromptExactHash,
  resolveTransferTaskId,
} from '@/lib/transfer-task-identity';
import { getRecentTransferFingerprints, isDuplicateTransferFingerprint } from '@/services/transfer-novelty.service';
import { loadTransferTaskInstance } from '@/services/transfer-task-instance.service';
import { logOperationalWarning } from '@/lib/observability/operational-log';
import { z } from 'zod';

const Schema = z.object({
  studentId: z.string().uuid(),
  subjectId: z.string().uuid(),
  conceptId: z.string().uuid(),
  conceptLabel: z.string().min(1),
  prompt: z.string().min(1),
  distance: z.enum(['NEAR', 'MID', 'FAR']).default('NEAR'),
  studentResponse: z.string().min(1),
  language: z.string().optional(),
  remediationStepId: z.string().uuid().optional(),
  // Phase 2B / Phase 7 (7B1): the stable logical identity for THIS one
  // transfer attempt's evidence, minted by /transfer/generate. During
  // the compatibility window `activityId === transferTaskId`; a client
  // may send either or both. Both-but-different is rejected (400), never
  // silently resolved -- see resolveTransferTaskId.
  transferTaskId: z.string().uuid().optional(),
  activityId: z.string().uuid().optional(),
  // Phase 1D: loose optional strings -- a malformed value degrades to a
  // quality label (normalizeResponseTiming), never fails this request.
  questionPresentedAt: z.string().optional(),
  answerSubmittedAt: z.string().optional(),
});
// NB: any client-sent `promptFingerprint` is dropped by Zod here on
// purpose -- the server always recomputes it from `prompt` below.

export async function POST(request: NextRequest) {
  try {
    const authContext = await verifyAuth();
    if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

    const validated = Schema.parse(await request.json());
    const canAccess = await verifyStudentAccess(authContext.userId, validated.studentId, authContext.role);
    if (!canAccess) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

    // Phase 7 (7B1): resolve the ONE canonical task id. Both-but-different
    // is a client bug, not something to guess through.
    const idResolution = resolveTransferTaskId({ transferTaskId: validated.transferTaskId, activityId: validated.activityId });
    if (!idResolution.ok) {
      return NextResponse.json({ error: 'INVALID_INPUT', message: idResolution.error }, { status: 400 });
    }
    const canonicalTaskId = idResolution.taskId;
    // Server is the sole fingerprint authority -- recomputed from the
    // prompt the browser actually submitted (which is the exact prompt
    // evaluateTransferResponse grades). Never trusts a client value.
    const promptFingerprint = computeTransferPromptFingerprint(validated.prompt);

    // Phase 7 (7D3): the trust bridge. Load the server's own record of
    // this task (minted + persisted by /transfer/generate). When it
    // exists it -- not the browser -- is authoritative for distance /
    // modality / novelty dimensions / task family / targets /
    // certification. A byte-level prompt_exact_hash check proves the
    // learner answered the exact task the server generated; a mismatch
    // is rejected BEFORE any AI grading or mastery write. A missing
    // instance (a task generated before 7D1, or a client bypassing
    // /transfer/generate) is NOT hard-failed -- the submission
    // degrades to the legacy, non-certified path (one WARN).
    const taskInstance = await loadTransferTaskInstance(canonicalTaskId);
    if (taskInstance) {
      if (taskInstance.studentId !== validated.studentId || taskInstance.conceptId !== validated.conceptId) {
        logOperationalWarning({
          subsystem: 'transfer',
          operation: 'submitTransferResponse.taskInstanceScope',
          context: { conceptId: validated.conceptId },
        });
        return NextResponse.json({ error: 'TRANSFER_TASK_MISMATCH' }, { status: 409 });
      }
      const submittedExactHash = computeTransferPromptExactHash(validated.prompt);
      if (submittedExactHash !== taskInstance.promptExactHash) {
        logOperationalWarning({
          subsystem: 'transfer',
          operation: 'submitTransferResponse.promptExactHash',
          context: { conceptId: validated.conceptId },
        });
        return NextResponse.json({ error: 'TRANSFER_TASK_PROMPT_MISMATCH' }, { status: 409 });
      }
    } else {
      logOperationalWarning({
        subsystem: 'transfer',
        operation: 'submitTransferResponse.taskInstanceMissing',
        context: { conceptId: validated.conceptId },
      });
    }

    // Trusted distance -- the server's generated value when we have the
    // instance, the client's claim only as a legacy fallback.
    const effectiveDistance: TransferDistance = taskInstance
      ? (taskInstance.transferDistance as TransferDistance)
      : (validated.distance as TransferDistance);

    // Phase 7 (7B2): anti-memorization at the submit boundary. A client
    // could bypass the guarded generation route and submit a task that
    // is structurally identical (same fingerprint) to one this learner
    // already did recently for this concept -- under a DIFFERENT
    // transferTaskId. Reject that before any AI grading / mastery
    // write. An idempotent resubmission of the SAME task (same
    // canonicalTaskId) is explicitly excluded, so operation_key
    // idempotency is untouched.
    const recentFingerprints = await getRecentTransferFingerprints(validated.studentId, validated.conceptId);
    const structuralDuplicate = isDuplicateTransferFingerprint({
      candidateFingerprint: promptFingerprint,
      recentFingerprints,
      excludeTransferTaskId: canonicalTaskId,
    });
    if (structuralDuplicate.duplicate) {
      logOperationalWarning({
        subsystem: 'transfer',
        operation: 'submitTransferResponse',
        context: { conceptId: validated.conceptId },
      });
      return NextResponse.json({ error: 'TRANSFER_TASK_DUPLICATE' }, { status: 409 });
    }

    const language = validated.language || 'en';
    const graded = await evaluateTransferResponse(validated.conceptLabel, validated.prompt, validated.studentResponse, language, {
      studentId: validated.studentId,
      subjectId: validated.subjectId,
      conceptId: validated.conceptId,
    });
    const scorePercent = graded.result === 'correct' ? 100 : graded.result === 'partial' ? 50 : 0;

    // Phase 1D: normalized BEFORE updateMastery now -- the client clock
    // stopped on submit, before evaluateTransferResponse's AI call ran,
    // so this never measures grading latency (Step 13). Moved above the
    // evidence write so it can be part of the SAME INSERT.
    const timing = normalizeResponseTiming({
      questionPresentedAt: validated.questionPresentedAt,
      answerSubmittedAt: validated.answerSubmittedAt,
    });
    const responseTimingEntries = toResponseTimingEntries([{ timing }]);

    // Phase 7 (7C1): canonical Transfer evidence metadata -- ALL
    // server-derived (no browser-supplied value is spread in). Passed
    // to updateMastery so it is written in the SAME learning_evidence
    // INSERT / SAME transaction as the canonical evidence row (the
    // future 7C2 projector must observe a complete evidence row before
    // COMMIT). Replaces the previous post-commit `UPDATE learning_evidence
    // SET metadata = ...` second statement. Additive: does not affect
    // computeTransferScore / Mastery / Knowledge State / MemoryPolicy,
    // and is not yet consumed by any qualification / novelty / depth
    // logic (7B2 guard runs earlier; 7C2+ is the projector).
    const evidenceMetadata: Record<string, unknown> = {
      transferDistance: effectiveDistance,
      assisted: false,
      aiExecution: graded.aiExecution,
      transferTaskId: canonicalTaskId,
      promptFingerprint,
      sourceConceptId: validated.conceptId,
      ...(responseTimingEntries.length > 0 ? { behavior: { responseTimes: responseTimingEntries } } : {}),
      // Phase 7 (7D3): server-trusted structured metadata from the task
      // registry, written in this same learning_evidence INSERT. Present
      // ONLY when the task instance was found -- this is exactly what
      // makes the row phase7-certified for the transfer projector
      // (toProjectionEvidence's gate: noveltyValidationPassed === true +
      // non-empty noveltyDimensions + task id + !assisted + valid
      // distance). No such value is ever taken from the browser.
      ...(taskInstance
        ? {
            noveltyValidationPassed: taskInstance.noveltyValidationPassed,
            noveltyDimensions: taskInstance.noveltyDimensions,
            transferModality: taskInstance.transferModality,
            taskFamilyId: taskInstance.taskFamilyId,
            promptExactHash: taskInstance.promptExactHash,
            targetConceptIds: taskInstance.targetConceptIds,
            ...(taskInstance.contextDomain ? { contextDomain: taskInstance.contextDomain } : {}),
            generatorPromptVersion: taskInstance.generatorPromptVersion,
          }
        : {}),
    };

    const masteryResult = await updateMastery({
      studentId: validated.studentId,
      conceptId: validated.conceptId,
      subjectId: validated.subjectId,
      evidence: {
        result: graded.result,
        difficulty: effectiveDistance === 'FAR' ? 5 : effectiveDistance === 'MID' ? 4 : 3,
        sourceType: 'TRANSFER',
        confidenceWeight: 0.85,
        scorePercent,
        sampleSize: 1,
      },
      identity: { operationType: 'TRANSFER', operationId: canonicalTaskId, conceptId: validated.conceptId },
      telemetry: { activityType: 'transfer', learningMode: 'SOLO' },
      // 7C1: written atomically inside updateMastery's own transaction.
      // On the operation_key duplicate path the whole INSERT is rolled
      // back, so a retry never mutates the original evidence row's
      // metadata -- exactly the idempotency guarantee the old
      // post-commit UPDATE had to replicate with a `!duplicate` guard.
      metadata: evidenceMetadata,
      // Phase 0E2: links the resulting MASTERY_UPDATED decision_events
      // row to the AI evaluation that produced this evidence -- always
      // unambiguous here (one grading call per submission).
      aiExecutionId: graded.aiExecution.aiExecutionId,
    });

    // Phase 2B: still a side effect of THIS ONE logical Transfer
    // attempt -- skipped on the duplicate (retry) path so a remediation
    // step is never double-completed.
    if (!masteryResult.duplicate && validated.remediationStepId) {
      await completeRemediationStep(validated.remediationStepId, { success: graded.result !== 'incorrect', score: scorePercent }).catch(
        (err) => console.error('Failed to complete remediation step:', err)
      );
    }

    track(validated.studentId, 'transfer_completed', { conceptId: validated.conceptId, distance: effectiveDistance, result: graded.result });

    return NextResponse.json({
      success: true,
      data: { result: graded.result, feedback: graded.feedback, mastery: { previous: masteryResult.oldMastery, current: masteryResult.newMastery, delta: masteryResult.delta } },
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'INVALID_INPUT', message: error.issues[0]?.message }, { status: 400 });
    }
    console.error('Transfer submit error:', error);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
