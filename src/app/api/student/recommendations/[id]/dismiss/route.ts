/** Track A -- POST: dismiss MY open exam recommendation (audited; nothing else changes). */
import { NextRequest, NextResponse } from 'next/server';
import { requireStudentActor, isUuid } from '@/lib/learning-plan/route-actors';
import { dismissExamRecommendation } from '@/lib/learning-plan/exam-bridge.service';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

async function handlePOST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireStudentActor();
  if ('response' in actor) return actor.response;
  if (!isUuid(id)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const ok = await dismissExamRecommendation(actor.studentId, id, actor.userId);
  return ok ? NextResponse.json({ success: true }) : NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const POST = withAiRequestMetrics('POST /api/student/recommendations/[id]/dismiss', handlePOST);
