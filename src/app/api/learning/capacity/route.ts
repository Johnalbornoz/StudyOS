/**
 * Phase 8 -- Step 8F1: learner daily-capacity capture.
 *
 * POST only. Wraps the narrow `captureLearnerCapacity` boundary (which
 * UPSERTs ONLY `student_availability.max_daily_minutes`). A successful
 * change notifies the orchestrator so the plan is re-derived against
 * the new budget; the notify is fail-soft.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyStudentAccess } from '@/lib/auth';
import { captureLearnerCapacity } from '@/services/learning-orchestration-inputs.service';
import { notifyLearningOrchestrationChange } from '@/services/learning-plan-orchestration-trigger';
import { logOperationalWarning } from '@/lib/observability/operational-log';
import { z } from 'zod';

const Schema = z.object({ studentId: z.string().uuid(), maxDailyMinutes: z.number().int() });

export async function POST(request: NextRequest) {
  try {
    const authContext = await verifyAuth();
    if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

    const { studentId, maxDailyMinutes } = Schema.parse(await request.json());
    const canAccess = await verifyStudentAccess(authContext.userId, studentId, authContext.role);
    if (!canAccess) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

    const result = await captureLearnerCapacity(studentId, maxDailyMinutes);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

    await notifyLearningOrchestrationChange(studentId, 'AVAILABILITY_CHANGED');

    return NextResponse.json({ success: true, data: { maxDailyMinutes: result.maxDailyMinutes, created: result.created } });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'INVALID_INPUT', message: error.issues[0]?.message }, { status: 400 });
    }
    logOperationalWarning({
      subsystem: 'phase8-orchestrator',
      operation: 'captureLearnerCapacity',
      error,
      context: { route: 'POST /api/learning/capacity' },
    });
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
