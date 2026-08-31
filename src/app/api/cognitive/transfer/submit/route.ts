import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyStudentAccess } from '@/lib/auth';
import { evaluateTransferResponse, type TransferDistance } from '@/services/transfer.service';
import { updateMastery } from '@/services/mastery.service';
import { completeRemediationStep } from '@/services/remediation.service';
import { track } from '@/lib/analytics';
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
});

export async function POST(request: NextRequest) {
  try {
    const authContext = await verifyAuth();
    if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

    const validated = Schema.parse(await request.json());
    const canAccess = await verifyStudentAccess(authContext.userId, validated.studentId, authContext.role);
    if (!canAccess) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

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
      telemetry: { activityType: 'transfer', learningMode: 'SOLO' },
      // Phase 0E2: links the resulting MASTERY_UPDATED decision_events
      // row to the AI evaluation that produced this evidence -- always
      // unambiguous here (one grading call per submission).
      aiExecutionId: graded.aiExecution.aiExecutionId,
    });

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
        // Phase 0E1: AI provenance is additive here, same jsonb merge pattern already used for transferDistance/assisted.
        JSON.stringify({ transferDistance: validated.distance, assisted: false, aiExecution: graded.aiExecution }),
      ]
    );

    if (validated.remediationStepId) {
      await completeRemediationStep(validated.remediationStepId, { success: graded.result !== 'incorrect', score: scorePercent }).catch(
        (err) => console.error('Failed to complete remediation step:', err)
      );
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
