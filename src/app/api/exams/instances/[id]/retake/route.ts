/**
 * Exam V2 -- POST /api/exams/instances/[id]/retake
 * A new attempt is always a NEW instance from zero (same papers / mode; a
 * Mock gets a fresh form that prefers unseen items). The original is untouched.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireActor, requireOwnerOf } from '@/lib/exam-core/route-auth';
import { getExamInstance, newInstanceFromExisting, toInstanceView, ExamInstanceError } from '@/lib/exam-core/exam-instance.service';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

async function handlePOST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await requireActor('/api/exams/instances:create', 20);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  const prev = await getExamInstance(id);
  if (!prev) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const owner = await requireOwnerOf(gate.actorUserId, prev.studentId, { entitled: true });
  if (!owner.ok) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  try {
    return NextResponse.json({ success: true, data: { instance: await toInstanceView(await newInstanceFromExisting(id)) } });
  } catch (err) {
    if (err instanceof ExamInstanceError) return NextResponse.json({ error: err.code }, { status: 409 });
    throw err;
  }
}

export const POST = withAiRequestMetrics('POST /api/exams/instances/[id]/retake', handlePOST);
