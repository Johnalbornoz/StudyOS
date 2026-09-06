import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { verifyAuth, verifyStudentAccess } from '@/lib/auth';
import { generateTransferActivity, type TransferDistance } from '@/services/transfer.service';
import { computeTransferPromptFingerprint } from '@/lib/transfer-task-identity';
import {
  getRecentTransferFingerprints,
  evaluateTransferNoveltyGuard,
} from '@/services/transfer-novelty.service';
import { logOperationalWarning } from '@/lib/observability/operational-log';
import { track } from '@/lib/analytics';
import { z } from 'zod';

/**
 * 7B2: initial candidate + at most this many regenerations when the
 * candidate is a recent structural duplicate. The transfer generator
 * is non-deterministic, so a single re-call usually yields a
 * structurally different task. Strictly bounded so a duplicate never
 * amplifies the pre-existing intermittent generation timeout.
 */
const MAX_DUPLICATE_REGENERATION_ATTEMPTS = 1;

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

    const language = validated.language || 'en';
    const distance = validated.distance as TransferDistance;

    // 7B2: one bounded read of this learner's recent TRANSFER
    // fingerprints for this concept -- reused for the initial candidate
    // AND any regeneration check (generation writes no evidence, so the
    // recent set cannot change within the request).
    const recentFingerprints = await getRecentTransferFingerprints(validated.studentId, validated.conceptId);

    let result = await generateTransferActivity(validated.conceptLabel, validated.learnedContext, distance, language);
    let candidateFingerprint = computeTransferPromptFingerprint(result.prompt);
    let aiCalls = 1;
    let guard = evaluateTransferNoveltyGuard({ candidateFingerprint, recentFingerprints });

    // Bounded regeneration: at most one extra AI call if the first
    // candidate is a recent structural duplicate. Not a retry loop.
    for (let attempt = 0; !guard.eligible && attempt < MAX_DUPLICATE_REGENERATION_ATTEMPTS; attempt++) {
      result = await generateTransferActivity(validated.conceptLabel, validated.learnedContext, distance, language);
      candidateFingerprint = computeTransferPromptFingerprint(result.prompt);
      aiCalls++;
      guard = evaluateTransferNoveltyGuard({ candidateFingerprint, recentFingerprints });
    }

    if (!guard.eligible) {
      // Terminal duplicate: fail closed. No learner evidence, no
      // mastery/KS/memory/decision write -- generation is evidence-free.
      // One structured WARN; no studentId / prompt / fingerprint / prior
      // task id in the log.
      logOperationalWarning({
        subsystem: 'transfer',
        operation: 'generateTransferActivity',
        context: { conceptId: validated.conceptId, count: aiCalls },
      });
      return NextResponse.json({ error: 'TRANSFER_TASK_NOT_NOVEL_ENOUGH' }, { status: 409 });
    }

    track(validated.studentId, 'transfer_started', { conceptId: validated.conceptId, distance: validated.distance });
    // Phase 2B / Phase 7 (7B1): ONE server-minted id per served task.
    // `transferTaskId` is the canonical Phase 7 task identity;
    // `activityId` is an exact alias (activityId === transferTaskId)
    // for current clients and the existing evidence idempotency key.
    // `promptFingerprint` is a non-authoritative client convenience --
    // the server recomputes it from the submitted prompt on
    // /transfer/submit. A rejected duplicate candidate never gets an id.
    const transferTaskId = randomUUID();
    return NextResponse.json({
      success: true,
      data: {
        ...result,
        transferTaskId,
        activityId: transferTaskId,
        promptFingerprint: candidateFingerprint,
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
