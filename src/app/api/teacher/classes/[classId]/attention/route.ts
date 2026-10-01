/**
 * Track A -- GET /api/teacher/classes/[classId]/attention
 * "Who needs help" for a class the actor TEACHES: every ACTIVE learner with
 * what needs attention, why, and the suggested Teacher action. Read-only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { allUuids } from '@/lib/institution/route-guard';
import { listClassLearnerAttention, TeacherLearnerAccessDeniedError } from '@/lib/teacher/learner-view.service';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

async function handleGET(_request: NextRequest, { params }: { params: Promise<{ classId: string }> }) {
  const { classId } = await params;
  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  if (!allUuids(classId)) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);
  try {
    return NextResponse.json({ success: true, data: await listClassLearnerAttention(actor.id, classId) });
  } catch (error) {
    if (error instanceof TeacherLearnerAccessDeniedError) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    throw error;
  }
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const GET = withAiRequestMetrics('GET /api/teacher/classes/[classId]/attention', handleGET);
