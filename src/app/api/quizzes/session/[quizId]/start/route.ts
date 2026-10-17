/**
 * POST /api/quizzes/session/[quizId]/start -- start a SCHEDULED subject Test / Mock (overnight 2026-10-16). Early start
 * is allowed (any time before the end of its scheduled local date); once started it is active (a Mock's wall-clock
 * timer starts now). One attempt: a completed assessment is never restarted (409 ATTEMPT_ALREADY_USED), an expired one
 * cannot start (410), a started one is resumed, never restarted.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { z } from 'zod';
import { verifyAuth, verifyStudentAccess } from '@/lib/auth';
import { startSubjectAssessmentSession } from '@/services/subject-assessment.service';

const StartSchema = z.object({ studentId: z.string().uuid() });

async function handlePOST(request: NextRequest, { params }: { params: Promise<{ quizId: string }> }) {
  const { quizId } = await params;
  const auth = await verifyAuth();
  if (!auth) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  let body: z.infer<typeof StartSchema>;
  try {
    body = StartSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  }
  if (!(await verifyStudentAccess(auth.userId, body.studentId, auth.role))) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  const r = await startSubjectAssessmentSession(body.studentId, quizId);
  if (!r.ok) return NextResponse.json({ error: r.error, message: r.message }, { status: r.status });
  return NextResponse.json({ success: true, data: r.view });
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const POST = withAiRequestMetrics('POST /api/quizzes/session/[quizId]/start', handlePOST);
