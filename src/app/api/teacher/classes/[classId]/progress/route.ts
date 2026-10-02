/**
 * Track A -- GET /api/teacher/classes/[classId]/progress
 *   ?period=7d|30d|period|all&periodLabel=&topic=&concept=&assignment=&students=a,b
 * Class Progress Intelligence for the class's Teacher only (read-only).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireUserActor, isUuid } from '@/lib/learning-plan/route-actors';
import { getUserInterfaceLanguage } from '@/lib/i18n/language';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { getClassProgress, parseProgressFilters, ClassProgressError } from '@/lib/teacher/class-progress.service';

async function handleGET(request: NextRequest, { params }: { params: Promise<{ classId: string }> }) {
  const { classId } = await params;
  const actor = await requireUserActor();
  if ('response' in actor) return actor.response;
  if (!isUuid(classId)) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  const sp = Object.fromEntries(new URL(request.url).searchParams.entries());
  const locale = await getUserInterfaceLanguage(actor.userId).catch(() => 'es' as const);
  try {
    return NextResponse.json({ success: true, data: await getClassProgress(actor.userId, classId, parseProgressFilters(sp), locale) });
  } catch (error) {
    if (error instanceof ClassProgressError) return NextResponse.json({ error: error.code }, { status: error.code === 'NOT_TEACHER' ? 403 : 422 });
    throw error;
  }
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const GET = withAiRequestMetrics('GET /api/teacher/classes/[classId]/progress', handleGET);
