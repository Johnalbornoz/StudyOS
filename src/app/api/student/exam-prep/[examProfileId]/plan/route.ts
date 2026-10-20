/** Track A -- GET: Exam Preparation Plan for ONE of MY exam profiles (blueprint × my learner model). */
import { NextRequest, NextResponse } from 'next/server';
import { requireStudentActor, isUuid } from '@/lib/learning-plan/route-actors';
import { getExamPreparationPlan, refreshExamGapRecommendations, ExamPlanError } from '@/lib/learning-plan/exam-bridge.service';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

async function handleGET(_request: NextRequest, { params }: { params: Promise<{ examProfileId: string }> }) {
  const { examProfileId } = await params;
  const actor = await requireStudentActor();
  if ('response' in actor) return actor.response;
  if (!isUuid(examProfileId)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  await refreshExamGapRecommendations(actor.studentId).catch(() => 0);
  const locale = await getInterfaceLanguage(actor.studentId).catch(() => 'es' as const);
  try {
    return NextResponse.json({ success: true, data: await getExamPreparationPlan(actor.studentId, examProfileId, locale) });
  } catch (error) {
    if (error instanceof ExamPlanError) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    throw error;
  }
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const GET = withAiRequestMetrics('GET /api/student/exam-prep/[examProfileId]/plan', handleGET);
