/**
 * Phase 8 -- Step 8H1: the READ-ONLY orchestration KPI endpoint.
 *
 * GET only. Returns the two transparent, fully-derived orchestration
 * KPIs -- 14-day objective progress and plan adherence (numerator +
 * denominator). No opaque AI score, no plan mutation.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyStudentAccess } from '@/lib/auth';
import { readOrchestrationObjectiveProgress, readStudyPlanAdherence } from '@/lib/learner-twin/metrics';
import { logOperationalWarning } from '@/lib/observability/operational-log';
import { z } from 'zod';

const Schema = z.object({ studentId: z.string().uuid() });

export async function GET(request: NextRequest) {
  try {
    const authContext = await verifyAuth();
    if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

    const parsed = Schema.safeParse({ studentId: request.nextUrl.searchParams.get('studentId') });
    if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });

    const { studentId } = parsed.data;
    const canAccess = await verifyStudentAccess(authContext.userId, studentId, authContext.role);
    if (!canAccess) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

    const [objectiveProgress, adherence] = await Promise.all([
      readOrchestrationObjectiveProgress(studentId),
      readStudyPlanAdherence(studentId),
    ]);

    return NextResponse.json({ success: true, data: { objectiveProgress, adherence } });
  } catch (error: any) {
    logOperationalWarning({
      subsystem: 'phase8-orchestrator',
      operation: 'orchestrationKpis',
      error,
      context: { route: 'GET /api/learning/plan/progress' },
    });
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
