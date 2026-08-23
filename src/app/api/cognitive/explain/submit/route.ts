import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyStudentAccess } from '@/lib/auth';
import { evaluateExplanation, rubricScorePercent } from '@/services/explain-defend.service';
import { updateMastery } from '@/services/mastery.service';
import { classifyMisconception, recordStudentMisconception } from '@/services/misconception.service';
import { completeRemediationStep } from '@/services/remediation.service';
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
});

export async function POST(request: NextRequest) {
  try {
    const authContext = await verifyAuth();
    if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

    const validated = Schema.parse(await request.json());
    const canAccess = await verifyStudentAccess(authContext.userId, validated.studentId, authContext.role);
    if (!canAccess) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

    const language = validated.language || 'en';
    const rubric = await evaluateExplanation(validated.conceptLabel, validated.prompt, validated.expectedElements, validated.studentResponse, language);
    const scorePercent = rubricScorePercent(rubric);

    if (rubric.misconceptionDetected) {
      const classified = await classifyMisconception(
        validated.conceptId,
        validated.conceptLabel,
        validated.prompt,
        validated.studentResponse,
        validated.expectedElements.join('; '),
        language
      ).catch(() => null);
      if (classified) {
        await recordStudentMisconception(validated.studentId, classified.signature.id, {
          source: 'explain_defend',
          prompt: validated.prompt,
        });
      }
    }

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
    });

    if (validated.remediationStepId) {
      await completeRemediationStep(validated.remediationStepId, { success: scorePercent >= 60, score: scorePercent }).catch((err) =>
        console.error('Failed to complete remediation step:', err)
      );
    }

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
