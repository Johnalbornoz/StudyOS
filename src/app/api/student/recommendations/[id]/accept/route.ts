/** Track A -- POST: accept MY exam recommendation (EXAM_GAP source on the one plan entry; returns the learner concept to launch). */
import { NextRequest, NextResponse } from 'next/server';
import { requireStudentActor, isUuid } from '@/lib/learning-plan/route-actors';
import { acceptExamRecommendation, RecommendationError } from '@/lib/learning-plan/exam-bridge.service';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

async function handlePOST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireStudentActor();
  if ('response' in actor) return actor.response;
  if (!isUuid(id)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  try {
    return NextResponse.json({ success: true, data: await acceptExamRecommendation(actor.studentId, id, actor.userId) });
  } catch (error) {
    if (error instanceof RecommendationError) return NextResponse.json({ error: error.code }, { status: 404 });
    throw error;
  }
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const POST = withAiRequestMetrics('POST /api/student/recommendations/[id]/accept', handlePOST);
