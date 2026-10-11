/**
 * B5-D -- PUT /api/assessments/learning/[sessionId]/answers
 *
 * Saves the Student's answers in progress so a resume restores them. A draft is not evidence: this route
 * grades nothing, scores nothing and writes no evidence, mastery or Knowledge State. Only an active
 * canonical session of the signed-in Student accepts drafts.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { verifyAuth, getOrCreateStudentId } from '@/lib/auth';
import { saveDraftAnswers } from '@/lib/assessment-execution/assessment-draft.service';

const Schema = z.strictObject({ answers: z.array(z.strictObject({ itemKey: z.string().min(1).max(200), answer: z.string().max(20_000) })).max(200) });

async function handlePUT(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const { sessionId } = await params;
  const body = Schema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  const studentId = await getOrCreateStudentId(authContext.userId);
  const result = await saveDraftAnswers({ studentId, sessionId, answers: body.data.answers });
  if (!result.ok) return NextResponse.json({ success: false, reason: result.reason }, { status: result.reason === 'NOT_FOUND' ? 404 : 409 });
  return NextResponse.json({ success: true, data: { saved: result.saved, cleared: result.cleared } });
}

// Request metrics: one summary per request (src/lib/ai/request-metrics.ts). This route calls no model.
export const PUT = withAiRequestMetrics('PUT /api/assessments/learning/[sessionId]/answers', handlePUT);
