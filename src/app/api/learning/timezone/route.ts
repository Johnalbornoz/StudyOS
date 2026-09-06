/**
 * Phase 8 -- Step 8F1: learner timezone capture.
 *
 * POST only. Wraps the narrow `captureLearnerTimezone` boundary (which
 * UPSERTs ONLY `student_availability.timezone`). The server is the IANA
 * authority -- an unknown zone is rejected. Once captured the planner
 * treats the timezone as confirmed (`timezoneAssumed = false`) even if
 * the value is 'UTC'. A successful capture notifies the orchestrator so
 * an existing plan is re-derived on the learner's real local calendar;
 * that notify is fail-soft and never blocks the response.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyStudentAccess } from '@/lib/auth';
import { captureLearnerTimezone } from '@/services/learning-orchestration-inputs.service';
import { notifyLearningOrchestrationChange } from '@/services/learning-plan-orchestration-trigger';
import { logOperationalWarning } from '@/lib/observability/operational-log';
import { z } from 'zod';

const Schema = z.object({ studentId: z.string().uuid(), timezone: z.string().min(1).max(64) });

export async function POST(request: NextRequest) {
  try {
    const authContext = await verifyAuth();
    if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

    const { studentId, timezone } = Schema.parse(await request.json());
    const canAccess = await verifyStudentAccess(authContext.userId, studentId, authContext.role);
    if (!canAccess) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

    const result = await captureLearnerTimezone(studentId, timezone);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

    await notifyLearningOrchestrationChange(studentId, 'AVAILABILITY_CHANGED');

    return NextResponse.json({ success: true, data: { timezone: result.timezone, created: result.created } });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'INVALID_INPUT', message: error.issues[0]?.message }, { status: 400 });
    }
    logOperationalWarning({
      subsystem: 'phase8-orchestrator',
      operation: 'captureLearnerTimezone',
      error,
      context: { route: 'POST /api/learning/timezone' },
    });
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
