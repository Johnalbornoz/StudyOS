/**
 * Phase 8 -- Step 8D1: the EXPLICIT plan-rebuild boundary.
 *
 * POST-only. Authenticated, scoped to a student the caller may access
 * (verifyStudentAccess -- the existing permission model; a learner may
 * only rebuild their own plan). Idempotent: the same learner state +
 * policy version + clock produces the same plan, and a second POST with
 * no change is a semantic no-op in the projector.
 *
 * There is deliberately NO GET handler -- a read must never rebuild,
 * roll, or reconcile a plan (8A0 invariant).
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyStudentAccess } from '@/lib/auth';
import { rebuildLearningPlan } from '@/services/learning-orchestration.service';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { logOperationalWarning } from '@/lib/observability/operational-log';
import { z } from 'zod';

const Schema = z.object({ studentId: z.string().uuid() });

export async function POST(request: NextRequest) {
  try {
    const authContext = await verifyAuth();
    if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

    const { studentId } = Schema.parse(await request.json());
    const canAccess = await verifyStudentAccess(authContext.userId, studentId, authContext.role);
    if (!canAccess) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

    const preferredLanguage = await getInterfaceLanguage(studentId);
    const result = await rebuildLearningPlan(studentId, { preferredLanguage });

    return NextResponse.json({
      success: true,
      data: {
        planId: result.planResult.planId,
        planAction: result.planResult.planAction,
        diff: result.planResult.diff,
        stateChanged: result.planResult.stateChanged,
        placedCount: result.placedCount,
        deferredCount: result.deferred.length,
        unsatisfiedDeadlines: result.unsatisfiedDeadlines,
        capacityPressure: result.capacityPressure,
        horizonStart: result.horizonStart,
        horizonEnd: result.horizonEnd,
        timezoneAssumed: result.timezoneAssumed,
        capacityAssumed: result.capacityAssumed,
      },
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'INVALID_INPUT', message: error.issues[0]?.message }, { status: 400 });
    }
    // Phase 8 is downstream orchestration -- a rebuild failure is a
    // 500 here, but it never touched cognitive state and Today's
    // Phase 4 hero is unaffected.
    logOperationalWarning({
      subsystem: 'phase8-orchestrator',
      operation: 'rebuildLearningPlan',
      error,
      context: { route: 'POST /api/learning/plan/rebuild' },
    });
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
