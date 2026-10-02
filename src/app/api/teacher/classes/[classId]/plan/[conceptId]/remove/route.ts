/** Track A -- POST: remove a concept from the class plan (only CLASS_PLAN sources retire; no learning is deleted). */
import { NextRequest, NextResponse } from 'next/server';
import { requireUserActor, isUuid } from '@/lib/learning-plan/route-actors';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { removeFromClassPlan, ClassPlanError } from '@/lib/learning-plan/class-plan.service';

function planError(error: unknown) {
  if (error instanceof ClassPlanError) {
    const status = error.code === 'NOT_TEACHER' ? 403 : error.code === 'NOT_FOUND' ? 404 : 422;
    return NextResponse.json({ error: error.code }, { status });
  }
  throw error;
}

async function handlePOST(_request: NextRequest, { params }: { params: Promise<{ classId: string; conceptId: string }> }) {
  const { classId, conceptId } = await params;
  const actor = await requireUserActor();
  if ('response' in actor) return actor.response;
  if (!isUuid(classId) || !isUuid(conceptId)) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  try {
    return NextResponse.json({ success: true, data: await removeFromClassPlan(actor.userId, classId, conceptId) });
  } catch (error) {
    return planError(error);
  }
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const POST = withAiRequestMetrics('POST /api/teacher/classes/[classId]/plan/[conceptId]/remove', handlePOST);
