/**
 * Exam V2 -- GET/DELETE /api/exams/instances/[id]
 * GET: the client-safe instance view. DELETE: the deletion rules of
 * exam-instance.service.ts (an in-progress or completed instance needs
 * `{"confirm": true}`). Owner-only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireActor, requireOwnerOf } from '@/lib/exam-core/route-auth';
import { getExamInstance, deleteExamInstance, toInstanceView, ExamInstanceError } from '@/lib/exam-core/exam-instance.service';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

const UUID = /^[0-9a-f-]{36}$/i;

async function load(id: string, actorUserId: string) {
  if (!UUID.test(id)) return { error: NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 }) };
  const instance = await getExamInstance(id);
  if (!instance || instance.status === 'DELETED') return { error: NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 }) };
  const owner = await requireOwnerOf(actorUserId, instance.studentId);
  // 404, not 403: a guessed id never confirms another Student's exam exists.
  if (!owner.ok) return { error: NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 }) };
  return { instance };
}

async function handleGET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await requireActor();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const r = await load(id, gate.actorUserId);
  if ('error' in r) return r.error;
  return NextResponse.json({ success: true, data: { instance: await toInstanceView(r.instance!) } });
}

const DeleteSchema = z.strictObject({ confirm: z.boolean().default(false), reason: z.string().max(200).optional() });

async function handleDELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await requireActor('/api/exams/instances:delete', 20);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const parsed = DeleteSchema.safeParse((await request.json().catch(() => ({}))) ?? {});
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  const r = await load(id, gate.actorUserId);
  if ('error' in r) return r.error;
  try {
    const out = await deleteExamInstance(r.instance!.id, { ...parsed.data, ownerStudentId: r.instance!.studentId });
    return NextResponse.json({ success: true, data: { status: out.instance.status, resultPreserved: out.resultPreserved, attemptAbandoned: out.attemptAbandoned } });
  } catch (err) {
    if (err instanceof ExamInstanceError) return NextResponse.json({ error: err.code }, { status: 409 });
    throw err;
  }
}

export const GET = withAiRequestMetrics('GET /api/exams/instances/[id]', handleGET);
export const DELETE = withAiRequestMetrics('DELETE /api/exams/instances/[id]', handleDELETE);
