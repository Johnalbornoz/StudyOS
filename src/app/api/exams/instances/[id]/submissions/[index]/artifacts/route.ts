/**
 * Exam V2 -- POST /api/exams/instances/[id]/submissions/[index]/artifacts
 *
 *   multipart/form-data  file + token (signed upload intent) + caption   -> a media artifact
 *   application/json     { kind: STATEMENT | TEXT | BIBLIOGRAPHY, text } -> a text artifact
 *
 * The file is size-checked before it is read, then scanned (declared type
 * never trusted), thumbnailed and stored owner-scoped. A rejected file is
 * reported with its reason and never attached.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireActor, ownStudentId } from '@/lib/exam-core/route-auth';
import { loadPortfolioContext, addArtifact } from '@/lib/exam-core/submissions/submission.service';
import { storeMedia, verifyUploadIntent } from '@/lib/exam-core/media/media.service';
import { MAX_MEDIA_BYTES } from '@/lib/exam-core/media/media-scan';
import { submissionErrorResponse, parseIndex } from '@/lib/exam-core/submissions/submission-http';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

const TextSchema = z.strictObject({ kind: z.enum(['STATEMENT', 'TEXT', 'BIBLIOGRAPHY']), text: z.string().min(1).max(30000), caption: z.string().max(500).optional() });

async function handlePOST(request: NextRequest, { params }: { params: Promise<{ id: string; index: string }> }) {
  const { id, index } = await params;
  const gate = await requireActor('/api/exams/submissions:artifact', 40);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const idx = parseIndex(index);
  const studentId = await ownStudentId(gate.actorUserId);
  if (idx === null) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  if (!studentId || !/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  try {
    const ctx = await loadPortfolioContext(studentId, id, idx);
    const type = request.headers.get('content-type') ?? '';
    if (type.startsWith('application/json')) {
      const parsed = TextSchema.safeParse(await request.json().catch(() => null));
      if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
      const out = await addArtifact(ctx, { kind: parsed.data.kind, text: parsed.data.text, caption: parsed.data.caption });
      return NextResponse.json({ success: true, data: out });
    }
    if (!type.startsWith('multipart/form-data')) return NextResponse.json({ error: 'UNSUPPORTED_MEDIA_TYPE' }, { status: 415 });
    const declaredLength = Number(request.headers.get('content-length') ?? '0');
    if (declaredLength > MAX_MEDIA_BYTES + 64 * 1024) return NextResponse.json({ error: 'TOO_LARGE', maxBytes: MAX_MEDIA_BYTES }, { status: 413 });
    const form = await request.formData();
    const token = String(form.get('token') ?? '');
    const intent = verifyUploadIntent(token);
    if (intent.studentId !== studentId || intent.instanceId !== id || intent.targetIndex !== idx) return NextResponse.json({ error: 'BAD_SIGNATURE' }, { status: 403 });
    const file = form.get('file');
    if (!(file instanceof File)) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
    if (file.size > Math.min(intent.maxBytes, MAX_MEDIA_BYTES)) return NextResponse.json({ error: 'TOO_LARGE', maxBytes: MAX_MEDIA_BYTES }, { status: 413 });
    const bytes = new Uint8Array(await file.arrayBuffer());
    const stored = await storeMedia({ studentId, bytes, declaredMime: file.type || 'application/octet-stream', originalName: file.name || null });
    if (stored.scan.status !== 'CLEAN') return NextResponse.json({ error: 'FILE_REJECTED', reason: stored.scan.detail }, { status: 422 });
    const caption = form.get('caption');
    const out = await addArtifact(ctx, { kind: intent.kind, mediaId: stored.id, caption: typeof caption === 'string' ? caption : undefined });
    return NextResponse.json({ success: true, data: { ...out, mediaId: stored.id } });
  } catch (err) {
    return submissionErrorResponse(err);
  }
}

export const POST = withAiRequestMetrics('POST /api/exams/instances/[id]/submissions/[index]/artifacts', handlePOST);
