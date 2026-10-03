/**
 * Exam V2 -- GET /api/exams/instances/[id]/submissions/[index]
 * The Student's submission for an open portfolio task: artifacts (with
 * short-lived signed URLs), completeness and status. Owner-only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireActor, ownStudentId } from '@/lib/exam-core/route-auth';
import { loadPortfolioContext, getSubmissionView } from '@/lib/exam-core/submissions/submission.service';
import { submissionErrorResponse, parseIndex } from '@/lib/exam-core/submissions/submission-http';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

async function handleGET(_request: NextRequest, { params }: { params: Promise<{ id: string; index: string }> }) {
  const { id, index } = await params;
  const gate = await requireActor('/api/exams/submissions:get', 120);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const idx = parseIndex(index);
  const studentId = await ownStudentId(gate.actorUserId);
  if (idx === null || !studentId || !/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  try {
    const ctx = await loadPortfolioContext(studentId, id, idx);
    return NextResponse.json({ success: true, data: { submission: await getSubmissionView(ctx) } });
  } catch (err) {
    return submissionErrorResponse(err);
  }
}

export const GET = withAiRequestMetrics('GET /api/exams/instances/[id]/submissions/[index]', handleGET);
