/**
 * F10 -- GET /api/parent/learners/[studentId]/subjects?subjectId=
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { getParentSubjectProgress, ParentAccessDeniedError } from '@/lib/parent/read-model.service';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

async function handleGET(request: NextRequest, { params }: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await params;
  const subjectId = request.nextUrl.searchParams.get('subjectId') || undefined;

  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);

  try {
    const subjects = await getParentSubjectProgress(actor.id, studentId, subjectId);
    return NextResponse.json({ success: true, data: { subjects } });
  } catch (error) {
    if (error instanceof ParentAccessDeniedError) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    throw error;
  }
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const GET = withAiRequestMetrics('GET /api/parent/learners/[studentId]/subjects', handleGET);
