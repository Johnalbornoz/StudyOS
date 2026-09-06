/**
 * Phase 8 -- Step 8E1: explicit daily maintenance.
 *
 * POST-only. The client calls this AT MOST once per local day, when the
 * read service reports `maintenanceNeeded` -- there is no cron
 * infrastructure in this deployment, and a GET must never mutate a
 * plan. Idempotent.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyStudentAccess } from '@/lib/auth';
import { maintainLearningPlan } from '@/services/learning-plan-maintenance.service';
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

    const result = await maintainLearningPlan(studentId, new Date());
    return NextResponse.json({
      success: true,
      data: {
        maintained: result.maintained,
        reason: result.reason ?? null,
        completed: result.completed,
        expired: result.expired,
        planAction: result.rebuild?.planResult.planAction ?? null,
        diff: result.rebuild?.planResult.diff ?? null,
      },
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'INVALID_INPUT', message: error.issues[0]?.message }, { status: 400 });
    }
    logOperationalWarning({ subsystem: 'phase8-orchestrator', operation: 'maintainLearningPlan', error, context: { route: 'POST /api/learning/plan/maintain' } });
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
