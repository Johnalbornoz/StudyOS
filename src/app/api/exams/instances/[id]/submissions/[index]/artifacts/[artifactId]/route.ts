/**
 * Exam V2 -- DELETE /api/exams/instances/[id]/submissions/[index]/artifacts/[artifactId]
 * Removes an artifact from a DRAFT submission and purges its file bytes.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireActor, ownStudentId } from '@/lib/exam-core/route-auth';
import { loadPortfolioContext, removeArtifact } from '@/lib/exam-core/submissions/submission.service';
import { submissionErrorResponse, parseIndex } from '@/lib/exam-core/submissions/submission-http';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

async function handleDELETE(_request: NextRequest, { params }: { params: Promise<{ id: string; index: string; artifactId: string }> }) {
  const { id, index, artifactId } = await params;
  const gate = await requireActor('/api/exams/submissions:artifact', 40);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const idx = parseIndex(index);
  const studentId = await ownStudentId(gate.actorUserId);
  if (idx === null || !studentId || !/^[0-9a-f-]{36}$/i.test(id) || !/^[0-9a-f-]{36}$/i.test(artifactId)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  try {
    const ctx = await loadPortfolioContext(studentId, id, idx);
    const removed = await removeArtifact(ctx, artifactId);
    return removed ? NextResponse.json({ success: true }) : NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  } catch (err) {
    return submissionErrorResponse(err);
  }
}

export const DELETE = withAiRequestMetrics('DELETE /api/exams/instances/[id]/submissions/[index]/artifacts/[artifactId]', handleDELETE);
