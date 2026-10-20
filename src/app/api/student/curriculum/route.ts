/**
 * Track A -- GET /api/student/curriculum?subject=<catalogKey>&context=<academicSubjectId>
 * The suggested curriculum for one of MY subjects (or any catalog subject),
 * resolved from my context (exam profile, academic profile) or the general
 * StudyUs curriculum, overlaid with my plan status. Available ≠ in plan.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireStudentActor } from '@/lib/learning-plan/route-actors';
import { getStudentCurriculumView } from '@/lib/learning-plan/student-views.service';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

async function handleGET(request: NextRequest) {
  const actor = await requireStudentActor();
  if ('response' in actor) return actor.response;
  const url = new URL(request.url);
  const locale = await getInterfaceLanguage(actor.studentId).catch(() => 'es' as const);
  const view = await getStudentCurriculumView(actor.studentId, url.searchParams.get('subject'), url.searchParams.get('context'), locale);
  return NextResponse.json({ success: true, data: view });
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const GET = withAiRequestMetrics('GET /api/student/curriculum', handleGET);
