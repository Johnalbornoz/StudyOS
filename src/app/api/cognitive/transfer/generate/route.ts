import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { verifyAuth, verifyStudentAccess } from '@/lib/auth';
import { generateStructuredTransferActivity, type TransferDistance } from '@/services/transfer.service';
import {
  computeTransferPromptFingerprint,
  computeTransferPromptExactHash,
  computeTransferTaskFamilyId,
} from '@/lib/transfer-task-identity';
import {
  getRecentTransferFingerprints,
  evaluateTransferNoveltyGuard,
  type RecentTransferFingerprint,
} from '@/services/transfer-novelty.service';
import {
  persistTransferTaskInstance,
  getRecentTransferTaskFingerprints,
} from '@/services/transfer-task-instance.service';
import { logOperationalWarning } from '@/lib/observability/operational-log';
import { track } from '@/lib/analytics';
import { z } from 'zod';

/**
 * Phase 7 -- Step 7D1: structured Transfer generation + trusted task
 * instance bridge.
 *
 * This route is the ONLY place a transfer task's server-certified
 * metadata is minted. It writes one `transfer_task_instances` row per
 * served task, keyed by a server-minted `transferTaskId`, so
 * /transfer/submit can later trust that row instead of the browser for
 * transferDistance / transferModality / noveltyDimensions /
 * targetConceptIds / contextDomain / taskFamilyId / generator versions
 * / noveltyValidationPassed. 7D1 always writes
 * `noveltyValidationPassed = false`; only 7D2's deterministic
 * certifier ever flips it true.
 *
 * Bounded generation: normally ONE AI call. At most ONE extra call, and
 * only when the first candidate is a recent structural duplicate --
 * never a retry loop. Total AI calls per request <= 2.
 *
 * Expected failures return a typed status, never a raw 500:
 *   - every AI failure  -> 503 TRANSFER_GENERATION_TEMPORARILY_UNAVAILABLE
 *   - duplicate exhausted -> 409 TRANSFER_TASK_NOT_NOVEL_ENOUGH
 * Both emit ONE `[ops]` line with no studentId / prompt / answer /
 * fingerprint / prior task id.
 */
const MAX_GENERATION_AI_CALLS = 2;

const Schema = z.object({
  studentId: z.string().uuid(),
  conceptId: z.string().uuid(),
  subjectId: z.string().uuid().optional(),
  conceptLabel: z.string().min(1),
  learnedContext: z.string().default('the way it was originally taught'),
  distance: z.enum(['NEAR', 'MID', 'FAR']).default('NEAR'),
  language: z.string().optional(),
});

export async function POST(request: NextRequest) {
  let conceptIdForLog: string | undefined;
  let subjectIdForLog: string | undefined;
  try {
    const authContext = await verifyAuth();
    if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

    const validated = Schema.parse(await request.json());
    conceptIdForLog = validated.conceptId;
    subjectIdForLog = validated.subjectId;
    const canAccess = await verifyStudentAccess(authContext.userId, validated.studentId, authContext.role);
    if (!canAccess) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

    const language = validated.language || 'en';
    const distance = validated.distance as TransferDistance;

    // One bounded read of this learner's recent structural fingerprints
    // for this concept -- from BOTH canonical TRANSFER evidence and the
    // 7D1 task-instance registry (a task served but not yet submitted
    // still counts as "seen"). Neither source changes within this
    // request (generation writes no evidence), so it is read once and
    // reused for the initial candidate and the single regeneration.
    const [evidenceFps, instanceFps] = await Promise.all([
      getRecentTransferFingerprints(validated.studentId, validated.conceptId),
      getRecentTransferTaskFingerprints(validated.studentId, validated.conceptId, 20),
    ]);
    const recentFingerprints: RecentTransferFingerprint[] = [
      ...evidenceFps,
      ...instanceFps.map((r) => ({
        promptFingerprint: r.promptFingerprint,
        transferTaskId: r.transferTaskId,
        transferDistance: null,
        timestamp: new Date(),
      })),
    ];

    const aiContext = {
      studentId: validated.studentId,
      subjectId: validated.subjectId,
      conceptId: validated.conceptId,
    };

    let candidate: Awaited<ReturnType<typeof generateStructuredTransferActivity>> | null = null;
    let candidateFingerprint = '';
    let aiCalls = 0;
    let lastGuardEligible = false;

    while (aiCalls < MAX_GENERATION_AI_CALLS) {
      try {
        candidate = await generateStructuredTransferActivity(
          validated.conceptLabel,
          validated.learnedContext,
          distance,
          language,
          aiContext,
        );
      } catch (aiError) {
        // Every AI failure (timeout, provider error, invalid JSON) is
        // an EXPECTED transient outcome here -- typed 503, one WARN, no
        // learner-state write anywhere (generation is evidence-free).
        logOperationalWarning({
          subsystem: 'transfer',
          operation: 'generateStructuredTransferActivity',
          error: aiError,
          context: { route: 'POST /api/cognitive/transfer/generate', conceptId: validated.conceptId, subjectId: validated.subjectId, count: aiCalls + 1 },
        });
        return NextResponse.json({ error: 'TRANSFER_GENERATION_TEMPORARILY_UNAVAILABLE' }, { status: 503 });
      }
      aiCalls++;
      candidateFingerprint = computeTransferPromptFingerprint(candidate.prompt);
      const guard = evaluateTransferNoveltyGuard({ candidateFingerprint, recentFingerprints });
      if (guard.eligible) {
        lastGuardEligible = true;
        break;
      }
    }

    if (!candidate || !lastGuardEligible) {
      // Terminal structural duplicate: fail closed. No id minted, no
      // registry row, no learner evidence. One WARN -- no studentId /
      // prompt / fingerprint / prior task id.
      logOperationalWarning({
        subsystem: 'transfer',
        operation: 'generateStructuredTransferActivity.novelty',
        context: { route: 'POST /api/cognitive/transfer/generate', conceptId: validated.conceptId, subjectId: validated.subjectId, count: aiCalls },
      });
      return NextResponse.json({ error: 'TRANSFER_TASK_NOT_NOVEL_ENOUGH' }, { status: 409 });
    }

    // Server-minted canonical task identity. `activityId` is an exact
    // alias for current clients / the evidence idempotency key.
    const transferTaskId = randomUUID();
    const promptExactHash = computeTransferPromptExactHash(candidate.prompt);
    const taskFamilyId = computeTransferTaskFamilyId({
      sourceConceptId: validated.conceptId,
      transferDistance: candidate.distance,
      transferModality: candidate.transferModality,
      noveltyDimensions: candidate.noveltyDimensions,
      targetConceptIds: candidate.targetConceptIds,
      contextDomain: candidate.contextDomain,
    });

    // The trust bridge: persist the server's view of this task BEFORE
    // returning it. 7D1 never certifies novelty here -- that is 7D2.
    try {
      await persistTransferTaskInstance({
        id: transferTaskId,
        studentId: validated.studentId,
        conceptId: validated.conceptId,
        subjectId: validated.subjectId ?? null,
        transferDistance: candidate.distance,
        transferModality: candidate.transferModality,
        noveltyDimensions: candidate.noveltyDimensions,
        targetConceptIds: candidate.targetConceptIds,
        contextDomain: candidate.contextDomain,
        taskFamilyId,
        promptFingerprint: candidateFingerprint,
        promptExactHash,
        generatorVersion: null,
        generatorPromptVersion: candidate.generatorPromptVersion,
        noveltyValidationPassed: false,
      });
    } catch (persistError) {
      // Without a persisted instance /transfer/submit cannot trust the
      // task -- fail the generation rather than serve an untrusted one.
      logOperationalWarning({
        subsystem: 'transfer',
        operation: 'persistTransferTaskInstance',
        error: persistError,
        context: { route: 'POST /api/cognitive/transfer/generate', conceptId: validated.conceptId, subjectId: validated.subjectId },
      });
      return NextResponse.json({ error: 'TRANSFER_GENERATION_TEMPORARILY_UNAVAILABLE' }, { status: 503 });
    }

    track(validated.studentId, 'transfer_started', { conceptId: validated.conceptId, distance: validated.distance });

    // Learner-facing payload. `distance` + `promptFingerprint` are kept
    // for existing clients; the raw novelty metadata (dimensions /
    // modality / taskFamilyId / exact hash) is intentionally NOT
    // returned -- it lives only server-side in transfer_task_instances.
    return NextResponse.json({
      success: true,
      data: {
        distance: candidate.distance,
        context: candidate.context,
        prompt: candidate.prompt,
        transferTaskId,
        activityId: transferTaskId,
        promptFingerprint: candidateFingerprint,
      },
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'INVALID_INPUT', message: error.issues[0]?.message }, { status: 400 });
    }
    // Genuinely unexpected -- not an AI/novelty/persist outcome.
    logOperationalWarning({
      subsystem: 'transfer',
      operation: 'POST /api/cognitive/transfer/generate',
      error,
      context: { route: 'POST /api/cognitive/transfer/generate', conceptId: conceptIdForLog, subjectId: subjectIdForLog },
    });
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
