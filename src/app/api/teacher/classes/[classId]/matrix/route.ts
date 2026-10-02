/** Track A -- GET: Concept × learning phase matrix of the class (read-only, ACTIVE learners only). */
import { NextRequest, NextResponse } from 'next/server';
import { requireUserActor, isUuid } from '@/lib/learning-plan/route-actors';
import { getUserInterfaceLanguage } from '@/lib/i18n/language';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { getClassLearnerMatrix, ClassPlanError } from '@/lib/learning-plan/class-plan.service';

function planError(error: unknown) {
  if (error instanceof ClassPlanError) {
    const status = error.code === 'NOT_TEACHER' ? 403 : error.code === 'NOT_FOUND' ? 404 : 422;
    return NextResponse.json({ error: error.code }, { status });
  }
  throw error;
}

async function handleGET(_request: NextRequest, { params }: { params: Promise<{ classId: string }> }) {
  const { classId } = await params;
  const actor = await requireUserActor();
  if ('response' in actor) return actor.response;
  if (!isUuid(classId)) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  const locale = await getUserInterfaceLanguage(actor.userId).catch(() => 'es' as const);
  try {
    return NextResponse.json({ success: true, data: await getClassLearnerMatrix(actor.userId, classId, locale) });
  } catch (error) {
    return planError(error);
  }
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const GET = withAiRequestMetrics('GET /api/teacher/classes/[classId]/matrix', handleGET);
