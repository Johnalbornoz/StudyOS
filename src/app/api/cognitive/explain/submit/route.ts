import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyStudentAccess } from '@/lib/auth';
import { evaluateExplanation, rubricScorePercent } from '@/services/explain-defend.service';
import { updateMastery, type MasteryUpdateInput } from '@/services/mastery.service';
import { classifyMisconception } from '@/services/misconception.service';
import { completeRemediationStep } from '@/services/remediation.service';
import { track } from '@/lib/analytics';
import type { AIProvenance } from '@/lib/ai';
import { normalizeResponseTiming, toResponseTimingEntries, withBehaviorMetadata } from '@/lib/algorithms/response-timing';
import { z } from 'zod';

const Schema = z.object({
  studentId: z.string().uuid(),
  subjectId: z.string().uuid(),
  conceptId: z.string().uuid(),
  conceptLabel: z.string().min(1),
  prompt: z.string().min(1),
  expectedElements: z.array(z.string()).default([]),
  studentResponse: z.string().min(1),
  language: z.string().optional(),
  remediationStepId: z.string().uuid().optional(),
  // Phase 2B: minted by /explain/generate, round-tripped unchanged --
  // the stable logical identity for this ONE Explain & Defend
  // attempt's evidence. A transport retry of this same submission
  // reuses it; a genuinely new attempt only ever has one because
  // /explain/generate mints a fresh one every time it's called.
  activityId: z.string().uuid(),
  // Phase 1D: loose optional strings -- a malformed value degrades to a
  // quality label (normalizeResponseTiming), never fails this request.
  questionPresentedAt: z.string().optional(),
  answerSubmittedAt: z.string().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const authContext = await verifyAuth();
    if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

    const validated = Schema.parse(await request.json());
    const canAccess = await verifyStudentAccess(authContext.userId, validated.studentId, authContext.role);
    if (!canAccess) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

    const language = validated.language || 'en';
    const rubric = await evaluateExplanation(validated.conceptLabel, validated.prompt, validated.expectedElements, validated.studentResponse, language, {
      studentId: validated.studentId,
      subjectId: validated.subjectId,
      conceptId: validated.conceptId,
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
        validated.conceptId,
        validated.conceptLabel,
        validated.prompt,
        validated.studentResponse,
        validated.expectedElements.join('; '),
        language,
        { studentId: validated.studentId, subjectId: validated.subjectId }
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
          evidenceRef: { source: 'explain_defend', prompt: validated.prompt },
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
      conceptId: validated.conceptId,
      subjectId: validated.subjectId,
      evidence: {
        result: scorePercent >= 70 ? 'correct' : scorePercent >= 40 ? 'partial' : 'incorrect',
        difficulty: 3,
        sourceType: 'EXPLANATION',
        confidenceWeight: 0.85,
        scorePercent,
        sampleSize: 1,
      },
      identity: { operationType: 'EXPLAIN_DEFEND', operationId: validated.activityId, conceptId: validated.conceptId },
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

    // Phase 2B: this is a side effect of THIS ONE logical Explain &
    // Defend attempt, same as the evidence row -- skip it on a
    // detected duplicate (a retry of an already-applied attempt)
    // rather than double-complete the remediation step.
    if (validated.remediationStepId && !masteryResult.duplicate) {
      await completeRemediationStep(validated.remediationStepId, { success: scorePercent >= 60, score: scorePercent }).catch((err) =>
        console.error('Failed to complete remediation step:', err)
      );
    }

    track(validated.studentId, 'explain_defend_completed', { conceptId: validated.conceptId, scorePercent, misconceptionDetected: rubric.misconceptionDetected });

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
