/**
 * Phase 8 -- Step 8F1: learner skip of one plan item.
 *
 * POST only. The SERVER decides: only the two lowest-precedence
 * classes (ordinary curriculum progression, self-requested extra
 * practice) are skippable -- every integrity obligation is refused
 * with SKIP_NOT_ALLOWED. On success the item moves to SKIPPED through
 * the 8B write boundary; cognitive state is untouched. No GET handler.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyStudentAccess } from '@/lib/auth';
import { skipLearningPlanItem } from '@/services/learning-plan-agency.service';
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

    const result = await skipLearningPlanItem(studentId, id);
    if (!result.ok) {
      const status = result.error === 'ITEM_NOT_FOUND' ? 404 : result.error === 'SKIP_NOT_ALLOWED' ? 403 : 409;
      return NextResponse.json({ error: result.error }, { status });
    }

    return NextResponse.json({ success: true, data: { outcome: result.outcome } });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'INVALID_INPUT', message: error.issues[0]?.message }, { status: 400 });
    }
    logOperationalWarning({
      subsystem: 'phase8-orchestrator',
      operation: 'skipLearningPlanItem',
      error,
      context: { route: 'POST /api/learning/plan/items/:id/skip' },
    });
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
