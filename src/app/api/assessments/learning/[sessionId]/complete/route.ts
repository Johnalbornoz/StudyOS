/**
 * B5-R -- POST /api/assessments/learning/[sessionId]/complete
 *
 * The canonical completion of a learning assessment. It passes the submitted answers to the one completion
 * authority and returns its PostAssessmentState. This route grades nothing itself, writes no evidence,
 * computes no mastery, attributes no concept and builds no operation key.
 *
 * A legacy session (no frozen assessment snapshot) is refused here: it completes on the existing path.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { z } from 'zod';
import { verifyAuth, requireStudentId } from '@/lib/auth';
import { completeLearningAssessment } from '@/lib/assessment-execution/assessment-completion.service';

const Schema = z.strictObject({ answers: z.array(z.strictObject({ itemKey: z.string().min(1).max(200), answer: z.string().max(20_000) })).max(200) });

async function handlePOST(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const { sessionId } = await params;
  const body = Schema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });

  const studentId = await requireStudentId(authContext.userId);
  if (!studentId) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  const result = await completeLearningAssessment({ studentId, sessionId, answers: body.data.answers });
  if (!result.ok) {
    const status = result.reason === 'NOT_FOUND' ? 404 : result.reason === 'GRADING_FAILED' ? 502 : 409;
    return NextResponse.json({ success: false, reason: result.reason }, { status });
  }
  // B5-F: after the response, keep what was just practised supplied (the existing async worker, deduplicated).
  // It is not part of the result: it cannot delay it, change it or fail it.
  // OE-014: completing an assessment never asks for supply.
  return NextResponse.json({ success: true, data: { state: result.state } });
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const POST = withAiRequestMetrics('POST /api/assessments/learning/[sessionId]/complete', handlePOST);
