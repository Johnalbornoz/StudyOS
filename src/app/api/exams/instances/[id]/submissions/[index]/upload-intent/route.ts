/**
 * Exam V2 -- POST /api/exams/instances/[id]/submissions/[index]/upload-intent
 * Issues a short-lived SIGNED upload intent bound to this Student, instance,
 * task position and artifact kind (checked again by the upload route).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireActor, ownStudentId } from '@/lib/exam-core/route-auth';
import { loadPortfolioContext, artifactAllowance } from '@/lib/exam-core/submissions/submission.service';
import { createUploadIntent } from '@/lib/exam-core/media/media.service';
import { MAX_MEDIA_BYTES } from '@/lib/exam-core/media/media-scan';
import { submissionErrorResponse, parseIndex } from '@/lib/exam-core/submissions/submission-http';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

const Schema = z.strictObject({ kind: z.enum(['IMAGE', 'PDF', 'AUDIO', 'VIDEO', 'PRESENTATION', 'PORTFOLIO_PAGE', 'PROCESS_EVIDENCE']) });

async function handlePOST(request: NextRequest, { params }: { params: Promise<{ id: string; index: string }> }) {
  const { id, index } = await params;
  const gate = await requireActor('/api/exams/submissions:intent', 60);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const parsed = Schema.safeParse(await request.json().catch(() => null));
  const idx = parseIndex(index);
  const studentId = await ownStudentId(gate.actorUserId);
  if (!parsed.success || idx === null) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  if (!studentId || !/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  try {
    const ctx = await loadPortfolioContext(studentId, id, idx);
    if (!artifactAllowance(ctx.item.exam.portfolio, parsed.data.kind).allowed) return NextResponse.json({ error: 'ARTIFACT_KIND_NOT_ALLOWED' }, { status: 422 });
    const token = createUploadIntent({ studentId, instanceId: id, targetIndex: idx, kind: parsed.data.kind, maxBytes: MAX_MEDIA_BYTES });
    return NextResponse.json({ success: true, data: { token, maxBytes: MAX_MEDIA_BYTES, expiresInSeconds: 300 } });
  } catch (err) {
    return submissionErrorResponse(err);
  }
}

export const POST = withAiRequestMetrics('POST /api/exams/instances/[id]/submissions/[index]/upload-intent', handlePOST);
