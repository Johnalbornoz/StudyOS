import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyStudentAccess, verifyRemediationStepAccess } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { canUseCapability } from '@/lib/entitlements';
import { clientRubricFieldsPresent, loadExplainTaskForSubmission, markExplainTaskConsumed } from '@/services/explain-defend-task.service';
import { evaluateExplanation, rubricScorePercent } from '@/services/explain-defend.service';
import { updateMastery, type MasteryUpdateInput } from '@/services/mastery.service';
import { classifyMisconception } from '@/services/misconception.service';
import { completeRemediationStep } from '@/services/remediation.service';
import { track } from '@/lib/analytics';
import type { AIProvenance } from '@/lib/ai';
import { normalizeResponseTiming, toResponseTimingEntries, withBehaviorMetadata } from '@/lib/algorithms/response-timing';
import { z } from 'zod';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { studentTextSafetyResponse } from '@/lib/safety/safety-route';

// Human Agency P0-3: the request carries the Student's ANSWER and the
// server-minted activityId -- never the question, the rubric or the concept
// label. Those come only from explain_defend_task_instances (see
// explain-defend-task.service.ts); a body that tries to send any of them is
// rejected outright (CLIENT_RUBRIC_FIELDS), so no payload can alter the
// criteria used to grade and update mastery.
const Schema = z.object({
  studentId: z.string().uuid(),
  // Optional cross-checks only: when present they must match the task.
  subjectId: z.string().uuid().optional(),
  conceptId: z.string().uuid().optional(),
  studentResponse: z.string().min(1),
  language: z.string().optional(),
  remediationStepId: z.string().uuid().optional(),
  // Phase 2B: minted by /explain/generate, round-tripped unchanged --
  // the stable logical identity for this ONE Explain & Defend
  // attempt's evidence AND (P0-3) the key of its server-held task.
  activityId: z.string().uuid(),
  // Phase 1D: loose optional strings -- a malformed value degrades to a
  // quality label (normalizeResponseTiming), never fails this request.
  questionPresentedAt: z.string().optional(),
  answerSubmittedAt: z.string().optional(),
});

const TASK_ERROR_STATUS: Record<string, number> = { TASK_NOT_FOUND: 404, TASK_EXPIRED: 410, RUBRIC_VERSION_MISMATCH: 409, TASK_MISMATCH: 409 };

async function handlePOST(request: NextRequest) {
  try {
    const authContext = await verifyAuth();
    if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

    const raw = await request.json();
    const validated = Schema.parse(raw);
    const canAccess = await verifyStudentAccess(authContext.userId, validated.studentId, authContext.role);
    if (!canAccess) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

    // Human Agency P0-4 (Layer B): deterministic safety gate FIRST -- before any
    // other check (a signal is never lost behind a task/entitlement error) and
    // before any model call.
    const safetyBlock = await studentTextSafetyResponse(validated.studentResponse, { studentId: validated.studentId, surface: 'EXPLAIN_DEFEND', locale: validated.language || 'es' });
    if (safetyBlock) return safetyBlock;

    // P0-3: a body that tries to author or alter the grading criteria is
    // refused outright -- it is never silently ignored-and-graded.
    const forbidden = clientRubricFieldsPresent(raw);
    if (forbidden.length > 0) {
      return NextResponse.json({ error: 'CLIENT_RUBRIC_REJECTED', fields: forbidden }, { status: 400 });
    }

    const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);
    const entitled = await canUseCapability(actor.id, validated.studentId, 'LEARNING_FULL_ACCESS');
    if (!entitled) return NextResponse.json({ error: 'ENTITLEMENT_REQUIRED' }, { status: 403 });

    if (validated.remediationStepId && !(await verifyRemediationStepAccess(validated.studentId, validated.remediationStepId))) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }

    const loaded = await loadExplainTaskForSubmission(validated.activityId, {
      studentId: validated.studentId,
      subjectId: validated.subjectId,
      conceptId: validated.conceptId,
    });
    if (!loaded.ok) return NextResponse.json({ error: loaded.code }, { status: TASK_ERROR_STATUS[loaded.code] ?? 409 });
    const task = loaded.task;

    const language = task.language || validated.language || 'en';
    const rubric = await evaluateExplanation(task.conceptLabel, task.prompt, task.expectedElements, validated.studentResponse, language, {
      studentId: validated.studentId,
      subjectId: task.subjectId,
      conceptId: task.conceptId,
    });
    const scorePercent = rubricScorePercent(rubric);

    // Phase 2C: classification (AI) still runs here, before the
    // transaction -- acceptable cost, same as grading (Phase 2B Step
    // 15/2C Step 8/9). PERSISTENCE is not: the classified signature is
    // handed to updateMastery as `misconceptionObservation` and only
    // actually written if that call's own operation_key gate confirms
    // this is a genuinely new application, inside that same
    // transaction. A transport retry that re-runs classification here
    // still cannot double-persist -- only the winning application's
    // classification result is ever used.
    let misconceptionAiExecution: AIProvenance | undefined;
    let misconceptionObservation: MasteryUpdateInput['misconceptionObservation'];
    if (rubric.misconceptionDetected) {
      const classified = await classifyMisconception(
        task.conceptId,
        task.conceptLabel,
        task.prompt,
        validated.studentResponse,
        task.expectedElements.join('; '),
        language,
        { studentId: validated.studentId, subjectId: task.subjectId }
      ).catch(() => null);
      if (classified) {
        misconceptionAiExecution = classified.aiExecution;
        misconceptionObservation = {
          signatureId: classified.signature.id,
          misconceptionCode: classified.signature.misconceptionCode,
          isCritical: classified.signature.isCritical,
          // Phase 2C Step 17: no raw answer content beyond what this
          // route already, pre-existingly, stamped here (unchanged
          // shape) -- the NEW resolved/observed-by linkage uses the
          // opaque learning_evidence id instead (see
          // recordStudentMisconception's own signature).
          evidenceRef: { source: 'explain_defend', prompt: task.prompt },
          aiExecution: classified.aiExecution,
        };
      }
    }

    // Phase 1D: normalized once here -- the client clock stopped on
    // submit, before evaluateExplanation's AI call above ever ran, so
    // this never measures rubric-evaluation latency (Step 13).
    const timing = normalizeResponseTiming({
      questionPresentedAt: validated.questionPresentedAt,
      answerSubmittedAt: validated.answerSubmittedAt,
    });

    const masteryResult = await updateMastery({
      studentId: validated.studentId,
      conceptId: task.conceptId,
      subjectId: task.subjectId,
      evidence: {
        result: scorePercent >= 70 ? 'correct' : scorePercent >= 40 ? 'partial' : 'incorrect',
        difficulty: 3,
        sourceType: 'EXPLANATION',
        confidenceWeight: 0.85,
        scorePercent,
        sampleSize: 1,
      },
      identity: { operationType: 'EXPLAIN_DEFEND', operationId: validated.activityId, conceptId: task.conceptId },
      misconceptionObservation,
      telemetry: { activityType: 'explain_defend', learningMode: 'COACH' },
      // Phase 0E1: AI provenance for the rubric evaluation, and for
      // misconception classification when it ran -- additive metadata,
      // doesn't change any existing evidence field's meaning. Phase 1D:
      // withBehaviorMetadata additively appends behavior.responseTimes
      // only when timing was actually usable.
      metadata: withBehaviorMetadata(
        {
          aiExecution: rubric.aiExecution,
          ...(misconceptionAiExecution ? { misconceptionAiExecution } : {}),
        },
        toResponseTimingEntries([{ timing }])
      ),
      // Phase 0E2: links the resulting MASTERY_UPDATED decision_events
      // row to the rubric evaluation that produced this evidence --
      // always unambiguous here (one evaluation call per submission).
      aiExecutionId: rubric.aiExecution.aiExecutionId,
    });

    await markExplainTaskConsumed(task.id).catch((err) => console.error('Failed to mark explain task consumed:', err));

    // Phase 2B: this is a side effect of THIS ONE logical Explain &
    // Defend attempt, same as the evidence row -- skip it on a
    // detected duplicate (a retry of an already-applied attempt)
    // rather than double-complete the remediation step.
    if (validated.remediationStepId && !masteryResult.duplicate) {
      await completeRemediationStep(validated.remediationStepId, { success: scorePercent >= 60, score: scorePercent }).catch((err) =>
        console.error('Failed to complete remediation step:', err)
      );
    }

    track(validated.studentId, 'explain_defend_completed', { conceptId: task.conceptId, scorePercent, misconceptionDetected: rubric.misconceptionDetected });

    return NextResponse.json({
      success: true,
      data: { rubric, scorePercent, mastery: { previous: masteryResult.oldMastery, current: masteryResult.newMastery, delta: masteryResult.delta } },
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'INVALID_INPUT', message: error.issues[0]?.message }, { status: 400 });
    }
    console.error('Explain submit error:', error);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const POST = withAiRequestMetrics('POST /api/cognitive/explain/submit', handlePOST);
