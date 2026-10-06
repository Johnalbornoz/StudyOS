import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyStudentAccess } from '@/lib/auth';
import { getConceptExplanation } from '@/services/concept-explanation.service';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { instructionalAssistanceLockedResponse } from '@/lib/ai/instructional-assistance-guard';

async function handleGET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const authContext = await verifyAuth();
  if (!authContext) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const studentId = searchParams.get('studentId');
  const language = searchParams.get('language') || 'en';
  if (!studentId) {
    return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  }

  const canAccess = await verifyStudentAccess(authContext.userId, studentId, authContext.role);
  if (!canAccess) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  // Human Agency P0-1: student-wide, server-authoritative, fail-closed.
  const assistanceLocked = await instructionalAssistanceLockedResponse(studentId);
  if (assistanceLocked) return assistanceLocked;

  try {
    const explanation = await getConceptExplanation(studentId, id, language);
    return NextResponse.json({ success: true, data: { explanation } });
  } catch (error: any) {
    if (error.message === 'CONCEPT_NOT_FOUND') {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }
    if (error.message === 'FORBIDDEN') {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    }
    console.error('Get concept explanation error:', error);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const GET = withAiRequestMetrics('GET /api/concepts/[id]/explanation', handleGET);
