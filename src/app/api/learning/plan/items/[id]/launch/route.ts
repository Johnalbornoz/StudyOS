/**
 * Phase 8 -- Step 8E1: launch a scheduled plan item.
 *
 * POST-only. Revalidates the item against Phase 4 live BEFORE anything
 * launches -- the persisted `intended_activity_type` is never forced.
 * Returns the revalidation outcome and, when executable, the canonical
 * Phase 4 launch target.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyStudentAccess } from '@/lib/auth';
import { revalidateLearningPlanItem } from '@/services/learning-plan-revalidation.service';
import { logOperationalWarning } from '@/lib/observability/operational-log';
import { z } from 'zod';

const Schema = z.object({ studentId: z.string().uuid() });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authContext = await verifyAuth();
    if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'INVALID_INPUT', message: 'bad item id' }, { status: 400 });

    const { studentId } = Schema.parse(await request.json());
    const canAccess = await verifyStudentAccess(authContext.userId, studentId, authContext.role);
    if (!canAccess) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

    const todayIso = new Date().toISOString().slice(0, 10);
    const result = await revalidateLearningPlanItem(studentId, id, todayIso);

    return NextResponse.json({
      success: true,
      data: {
        outcome: result.outcome,
        launchTarget: result.launch?.launchTarget ?? null,
        launchStatus: result.launch?.launchStatus ?? null,
        activityType: result.decision?.activityType ?? null,
      },
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'INVALID_INPUT', message: error.issues[0]?.message }, { status: 400 });
    }
    logOperationalWarning({ subsystem: 'phase8-orchestrator', operation: 'revalidateLearningPlanItem', error, context: { route: 'POST /api/learning/plan/items/:id/launch' } });
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
