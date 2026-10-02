/** Track A -- GET ?canonicalConceptId=&studentIds=a,b: who already has it / will add it / is already advanced. */
import { NextRequest, NextResponse } from 'next/server';
import { requireUserActor, isUuid } from '@/lib/learning-plan/route-actors';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { previewAssignment, ClassPlanError } from '@/lib/learning-plan/class-plan.service';

function planError(error: unknown) {
  if (error instanceof ClassPlanError) {
    const status = error.code === 'NOT_TEACHER' ? 403 : error.code === 'NOT_FOUND' ? 404 : 422;
    return NextResponse.json({ error: error.code }, { status });
  }
  throw error;
}

async function handleGET(request: NextRequest, { params }: { params: Promise<{ classId: string }> }) {
  const { classId } = await params;
  const actor = await requireUserActor();
  if ('response' in actor) return actor.response;
  const url = new URL(request.url);
  const conceptId = url.searchParams.get('canonicalConceptId');
  const studentIds = (url.searchParams.get('studentIds') ?? '').split(',').filter(isUuid);
  if (!isUuid(classId) || !isUuid(conceptId)) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  try {
    return NextResponse.json({ success: true, data: await previewAssignment(actor.userId, classId, conceptId, studentIds) });
  } catch (error) {
    return planError(error);
  }
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const GET = withAiRequestMetrics('GET /api/teacher/classes/[classId]/assignment-preview', handleGET);
