import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyStudentAccess } from '@/lib/auth';
import { evaluateTransferResponse, type TransferDistance } from '@/services/transfer.service';
import { updateMastery } from '@/services/mastery.service';
import { completeRemediationStep } from '@/services/remediation.service';
import { track } from '@/lib/analytics';
import { normalizeResponseTiming, toResponseTimingEntries } from '@/lib/algorithms/response-timing';
import { computeTransferPromptFingerprint, resolveTransferTaskId } from '@/lib/transfer-task-identity';
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

    const language = validated.language || 'en';
    const graded = await evaluateTransferResponse(validated.conceptLabel, validated.prompt, validated.studentResponse, language, {
      studentId: validated.studentId,
      subjectId: validated.subjectId,
      conceptId: validated.conceptId,
    });
    const scorePercent = graded.result === 'correct' ? 100 : graded.result === 'partial' ? 50 : 0;

    const masteryResult = await updateMastery({
      studentId: validated.studentId,
      conceptId: validated.conceptId,
      subjectId: validated.subjectId,
      evidence: {
        result: graded.result,
        difficulty: validated.distance === 'FAR' ? 5 : validated.distance === 'MID' ? 4 : 3,
        sourceType: 'TRANSFER',
        confidenceWeight: 0.85,
        scorePercent,
        sampleSize: 1,
      },
      identity: { operationType: 'TRANSFER', operationId: canonicalTaskId, conceptId: validated.conceptId },
      telemetry: { activityType: 'transfer', learningMode: 'SOLO' },
      // Phase 0E2: links the resulting MASTERY_UPDATED decision_events
      // row to the AI evaluation that produced this evidence -- always
      // unambiguous here (one grading call per submission).
      aiExecutionId: graded.aiExecution.aiExecutionId,
    });

    // Phase 1D: normalized here -- the client clock stopped on submit,
    // before evaluateTransferResponse's AI call above ran, so this never
    // measures grading latency (Step 13).
    const timing = normalizeResponseTiming({
      questionPresentedAt: validated.questionPresentedAt,
      answerSubmittedAt: validated.answerSubmittedAt,
    });
    const responseTimingEntries = toResponseTimingEntries([{ timing }]);

    // Phase 2B: this metadata UPDATE and the remediation-step
    // completion below are both side effects of THIS ONE logical
    // Transfer attempt, same as the evidence row itself -- if
    // updateMastery just reported a duplicate (a retry of an
    // already-applied attempt), skip both rather than overwrite the
    // original application's stamped metadata with THIS retry's fresh
    // AI re-grading (grading itself is not gated by the idempotency
    // key -- Phase 2B Step 15 -- so a retry's aiExecution is a
    // genuinely different value that must not clobber the first
    // application's) or double-complete a remediation step.
    if (!masteryResult.duplicate) {
      // metadata isn't part of MasteryUpdateInput's telemetry shape --
      // stamp transferDistance onto the just-written evidence row
      // directly so computeTransferScore can read it back later.
      const { db } = await import('@/lib/db');
      await db.query(
        `UPDATE learning_evidence SET metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb
         WHERE id = (
           SELECT id FROM learning_evidence
           WHERE student_id = $1 AND concept_id = $2 AND source_type = 'TRANSFER'
           ORDER BY timestamp DESC LIMIT 1
         )`,
        [
          validated.studentId,
          validated.conceptId,
          // Phase 0E1: AI provenance is additive here, same jsonb merge
          // pattern already used for transferDistance/assisted. Phase 1D:
          // behavior.responseTimes only included when timing was usable.
          JSON.stringify({
            transferDistance: validated.distance,
            assisted: false,
            aiExecution: graded.aiExecution,
            // Phase 7 (7B1): canonical task identity + server-computed
            // structural prompt fingerprint. Additive metadata only --
            // does not affect computeTransferScore / mastery / KS /
            // memory, and is not yet consumed by any qualification or
            // novelty logic (that is 7B2+).
            transferTaskId: canonicalTaskId,
            promptFingerprint,
            sourceConceptId: validated.conceptId,
            ...(responseTimingEntries.length > 0 ? { behavior: { responseTimes: responseTimingEntries } } : {}),
          }),
        ]
      );

      if (validated.remediationStepId) {
        await completeRemediationStep(validated.remediationStepId, { success: graded.result !== 'incorrect', score: scorePercent }).catch(
          (err) => console.error('Failed to complete remediation step:', err)
        );
      }
    }

    track(validated.studentId, 'transfer_completed', { conceptId: validated.conceptId, distance: validated.distance, result: graded.result });

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
