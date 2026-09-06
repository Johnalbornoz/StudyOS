/**
 * Phase 8 -- Step 8F1: learner-declared unavailable dates.
 *
 * POST only. Adds or removes one `student_unavailable_dates` row via
 * the narrow `setLearnerUnavailableDate` boundary, then notifies the
 * orchestrator so the plan re-derives with that day at zero capacity.
 * Additive rows only -- this never blocks canonical learning evidence
 * and never penalises cognitive state.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyStudentAccess } from '@/lib/auth';
import { setLearnerUnavailableDate } from '@/services/learning-orchestration-inputs.service';
import { notifyLearningOrchestrationChange } from '@/services/learning-plan-orchestration-trigger';
import { logOperationalWarning } from '@/lib/observability/operational-log';
import { z } from 'zod';

const Schema = z.object({
  studentId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  unavailable: z.boolean(),
});

export async function POST(request: NextRequest) {
  try {
    const authContext = await verifyAuth();
    if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

    const { studentId, date, unavailable } = Schema.parse(await request.json());
    const canAccess = await verifyStudentAccess(authContext.userId, studentId, authContext.role);
    if (!canAccess) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

    const result = await setLearnerUnavailableDate(studentId, date, unavailable);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

    await notifyLearningOrchestrationChange(studentId, 'AVAILABILITY_CHANGED');

    return NextResponse.json({ success: true, data: { date: result.date, action: result.action } });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'INVALID_INPUT', message: error.issues[0]?.message }, { status: 400 });
    }
    logOperationalWarning({
      subsystem: 'phase8-orchestrator',
      operation: 'setLearnerUnavailableDate',
      error,
      context: { route: 'POST /api/learning/plan/unavailable' },
    });
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
