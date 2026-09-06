import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { verifyAuth, verifyStudentAccess } from '@/lib/auth';
import { generateTransferActivity, type TransferDistance } from '@/services/transfer.service';
import { computeTransferPromptFingerprint } from '@/lib/transfer-task-identity';
import { track } from '@/lib/analytics';
import { z } from 'zod';

const Schema = z.object({
  studentId: z.string().uuid(),
  conceptId: z.string().uuid(),
  conceptLabel: z.string().min(1),
  learnedContext: z.string().default('the way it was originally taught'),
  distance: z.enum(['NEAR', 'MID', 'FAR']).default('NEAR'),
  language: z.string().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const authContext = await verifyAuth();
    if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

    const validated = Schema.parse(await request.json());
    const canAccess = await verifyStudentAccess(authContext.userId, validated.studentId, authContext.role);
    if (!canAccess) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

    const result = await generateTransferActivity(
      validated.conceptLabel,
      validated.learnedContext,
      validated.distance as TransferDistance,
      validated.language || 'en'
    );
    track(validated.studentId, 'transfer_started', { conceptId: validated.conceptId, distance: validated.distance });
    // Phase 2B / Phase 7 (7B1): ONE server-minted id per generated
    // task. `transferTaskId` is the canonical Phase 7 task identity;
    // `activityId` is kept as an exact alias (activityId ===
    // transferTaskId) for current clients and the existing evidence
    // idempotency key. Never two different ids for the same task.
    // `promptFingerprint` is a non-authoritative convenience for the
    // client -- the server recomputes it from the submitted prompt on
    // /transfer/submit.
    const transferTaskId = randomUUID();
    return NextResponse.json({
      success: true,
      data: {
        ...result,
        transferTaskId,
        activityId: transferTaskId,
        promptFingerprint: computeTransferPromptFingerprint(result.prompt),
      },
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'INVALID_INPUT', message: error.issues[0]?.message }, { status: 400 });
    }
    console.error('Transfer generate error:', error);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
