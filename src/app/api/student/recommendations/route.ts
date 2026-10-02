/** Track A -- GET /api/student/recommendations: exam gaps (refreshed, idempotent), class plan, required, prerequisites, next concepts. */
import { NextResponse } from 'next/server';
import { requireStudentActor } from '@/lib/learning-plan/route-actors';
import { refreshExamGapRecommendations } from '@/lib/learning-plan/exam-bridge.service';
import { getStudentRecommendations } from '@/lib/learning-plan/recommendations.service';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

async function handleGET() {
  const actor = await requireStudentActor();
  if ('response' in actor) return actor.response;
  await refreshExamGapRecommendations(actor.studentId).catch((e) => console.error('[plan] exam gap refresh failed', (e as Error)?.message));
  const locale = await getInterfaceLanguage(actor.studentId).catch(() => 'es' as const);
  return NextResponse.json({ success: true, data: { recommendations: await getStudentRecommendations(actor.studentId, locale) } });
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const GET = withAiRequestMetrics('GET /api/student/recommendations', handleGET);
