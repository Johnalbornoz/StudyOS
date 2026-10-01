/**
 * Track A -- GET /api/teacher/classes/[classId]/students/[studentId]
 * The Teacher learner view: one ACTIVE learner of a class the actor TEACHES,
 * scoped to the class's subject (read-only projection of the canonical read
 * models). Any other combination -- another class, another institution, a
 * learner not ACTIVE in this class, an institution admin, a pending teacher
 * -- is 403 with no data.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { allUuids } from '@/lib/institution/route-guard';
import { getTeacherLearnerView, TeacherLearnerAccessDeniedError } from '@/lib/teacher/learner-view.service';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

async function handleGET(_request: NextRequest, { params }: { params: Promise<{ classId: string; studentId: string }> }) {
  const { classId, studentId } = await params;
  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  if (!allUuids(classId, studentId)) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);
  try {
    return NextResponse.json({ success: true, data: await getTeacherLearnerView(actor.id, classId, studentId) });
  } catch (error) {
    if (error instanceof TeacherLearnerAccessDeniedError) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    throw error;
  }
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const GET = withAiRequestMetrics('GET /api/teacher/classes/[classId]/students/[studentId]', handleGET);
