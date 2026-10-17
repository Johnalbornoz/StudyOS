/**
 * Overnight 2026-10-16 -- POST /api/quizzes/session/[quizId]/heartbeat { studentId }
 * The subject assessment runner's liveness signal for a TEACHER-assigned attempt in progress (every ~30 s): an attempt
 * started before the window close may be finished after it while this session lives; once the session is left (no
 * activity within the liveness window) it cannot be resumed after the close (operator rule V). Owner only. Writes no
 * evidence (a left attempt past the close is closed through the subject service's own submission).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyAuth } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { isOwner } from '@/lib/authorization';
import { heartbeatSubjectAssessmentSession } from '@/services/subject-assessment.service';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

const Schema = z.object({ studentId: z.string().uuid() });

async function handlePOST(request: NextRequest, { params }: { params: Promise<{ quizId: string }> }) {
  const { quizId } = await params;
  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  let body: z.infer<typeof Schema>;
  try {
    body = Schema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  }
  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);
  if (!(await isOwner(actor.id, body.studentId))) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  const r = await heartbeatSubjectAssessmentSession(body.studentId, quizId);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ success: true, data: r.data });
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const POST = withAiRequestMetrics('POST /api/quizzes/session/[quizId]/heartbeat', handlePOST);
