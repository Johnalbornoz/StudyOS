import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyStudentAccess } from '@/lib/auth';
import { evaluateExplanation, rubricScorePercent } from '@/services/explain-defend.service';
import { updateMastery } from '@/services/mastery.service';
import { classifyMisconception, recordStudentMisconception } from '@/services/misconception.service';
import { completeRemediationStep } from '@/services/remediation.service';
import { track } from '@/lib/analytics';
import type { AIProvenance } from '@/lib/ai';
import { recordDecisionEvent } from '@/lib/audit';
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

    let misconceptionAiExecution: AIProvenance | undefined;
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
        await recordStudentMisconception(validated.studentId, classified.signature.id, {
          source: 'explain_defend',
          prompt: validated.prompt,
        });
        // Phase 0E2 Step 18: only recorded when classification actually
        // resulted in a persisted occurrence -- never for a null/no-
        // misconception classification. Links the AI execution that
        // produced it (always unambiguous: one classification call).
        await recordDecisionEvent({
          decisionType: 'MISCONCEPTION_RECORDED',
          engine: 'misconception-engine',
          engineVersion: 'v1',
          studentId: validated.studentId,
          subjectId: validated.subjectId,
          conceptId: validated.conceptId,
          sourceEventType: 'student_misconceptions',
          newState: { misconceptionCode: classified.signature.misconceptionCode, isNew: classified.isNew, isCritical: classified.signature.isCritical },
          reasonCode: 'AI_MISCONCEPTION_CLASSIFIED',
          aiExecutionId: classified.aiExecution.aiExecutionId,
        });
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

    if (validated.remediationStepId) {
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
